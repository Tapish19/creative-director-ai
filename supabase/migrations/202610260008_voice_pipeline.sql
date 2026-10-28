create table public.voiceovers (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null unique references public.generations(id) on delete cascade,
  narration text not null check (char_length(narration) between 1 and 2000),
  status public.step_status not null default 'pending',
  audio_path text,
  duration_seconds double precision check (duration_seconds > 0 and duration_seconds <= 120),
  sample_rate integer check (sample_rate between 8000 and 48000),
  size_bytes integer check (size_bytes > 44 and size_bytes <= 12582912),
  provider text, model text, voice text,
  attempts integer not null default 0 check (attempts >= 0),
  retry_count integer not null default 0 check (retry_count between 0 and 2),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'succeeded' or (audio_path is not null and duration_seconds is not null and sample_rate is not null and size_bytes is not null and provider is not null and model is not null and voice is not null))
);
create trigger voiceovers_updated_at before update on public.voiceovers for each row execute function public.touch_updated_at();
alter table public.voiceovers enable row level security;
revoke all on public.voiceovers from public, anon, authenticated;
grant select on public.voiceovers to authenticated;
grant all on public.voiceovers to service_role;
create policy voiceovers_read on public.voiceovers for select to authenticated using (exists (
  select 1 from public.generations g join public.projects p on p.id=g.project_id where g.id=voiceovers.generation_id and p.user_id=(select auth.uid())
));
alter table public.jobs drop constraint jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('generate','plan_and_write','generate_image','synthesize_voice','regenerate_scene','render'));
create unique index voice_job_unique on public.jobs(generation_id) where kind='synthesize_voice';
create unique index voice_attempt_unique on public.agent_runs(generation_id, attempt) where agent_type='voice';

create function public.queue_voice(p_generation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.voiceovers(generation_id,narration)
    select id, script->>'voiceover' from public.generations where id=p_generation_id on conflict do nothing;
  insert into public.jobs(generation_id,kind,idempotency_key,max_attempts)
    values(p_generation_id,'synthesize_voice','voice:' || p_generation_id::text,3) on conflict do nothing;
end;
$$;

-- This existing entry point now aggregates both media stages. Image success
-- schedules speech atomically, without transiently marking the campaign complete.
create or replace function public.refresh_image_progress(p_generation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare gen public.generations; speech public.voiceovers; next_status public.generation_status;
begin
  select * into gen from public.generations where id=p_generation_id for update;
  if exists(select 1 from public.scenes where generation_id=gen.id and status in ('pending','running')) then next_status:='running';
  elsif exists(select 1 from public.scenes where generation_id=gen.id and status='failed') then next_status:='partial';
  else
    perform public.queue_voice(gen.id);
    select * into speech from public.voiceovers where generation_id=gen.id;
    if speech.status='succeeded' then next_status:='media_ready';
    elsif speech.status='failed' then next_status:='partial';
    else next_status:='running'; end if;
  end if;
  update public.generations set status=next_status where id=gen.id;
  update public.projects set status=(case next_status when 'running' then 'generating' else next_status::text end)::public.project_status where id=gen.project_id;
end;
$$;

create function public.enqueue_voice(p_generation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); project_id_value uuid; gen public.generations; speech public.voiceovers;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,0));
  select p.id into project_id_value from public.projects p join public.generations g on g.project_id=p.id
    where g.id=p_generation_id and p.user_id=owner_id for update of p;
  if not found then raise exception 'Generation not found' using errcode='42501'; end if;
  if exists(select 1 from public.generations where project_id=project_id_value and status in ('queued','running','reviewing')) then
    raise exception 'Generation is active' using errcode='55000'; end if;
  if (select count(*) from public.generations g join public.projects p on p.id=g.project_id where p.user_id=owner_id and g.status in ('queued','running','reviewing'))>=3 then
    raise exception 'Too many active generations' using errcode='P0001'; end if;
  select * into gen from public.generations where id=p_generation_id for update;
  if gen.status not in ('images_ready','partial') or gen.script is null
    or not exists(select 1 from public.scenes where generation_id=gen.id)
    or exists(select 1 from public.scenes where generation_id=gen.id and status<>'succeeded') then
    raise exception 'Images must finish before voice generation' using errcode='55000'; end if;
  select * into speech from public.voiceovers where generation_id=gen.id for update;
  if found then
    if speech.status<>'failed' or speech.retry_count>=2 then raise exception 'Voice cannot be retried' using errcode='55000'; end if;
    update public.voiceovers set status='pending', retry_count=retry_count+1, error_message=null where id=speech.id;
    update public.jobs set status='queued', attempts=0, available_at=now(), locked_by=null, locked_until=null, last_error=null
      where generation_id=gen.id and kind='synthesize_voice';
  else perform public.queue_voice(gen.id); end if;
  perform public.refresh_image_progress(gen.id);
end;
$$;

create function public.require_voice_lease(p_job_id uuid,p_token text)
returns public.jobs language plpgsql security definer set search_path='' as $$
declare job public.jobs;
begin
  select * into job from public.jobs where id=p_job_id for update;
  if not found or job.kind<>'synthesize_voice' or job.status<>'running' or p_token is null or job.locked_by is distinct from p_token
    or job.locked_until is null or job.locked_until<=clock_timestamp() then raise exception 'Worker lease lost' using errcode='55000'; end if;
  return job;
end;
$$;

create function public.claim_voice_job(p_worker_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.jobs; exhausted public.jobs;
begin
  if p_worker_id is null then raise exception 'Worker identifier required' using errcode='22023'; end if;
  for exhausted in select * from public.jobs where kind='synthesize_voice' and status='running' and locked_until<=clock_timestamp() and attempts>=max_attempts for update skip locked
  loop
    perform 1 from public.generations where id=exhausted.generation_id for update;
    update public.jobs set status='failed',locked_by=null,locked_until=null,last_error='Voice worker recovery limit reached.' where id=exhausted.id;
    update public.voiceovers set status='failed',error_message='Voice worker recovery limit reached.' where generation_id=exhausted.generation_id;
    update public.agent_runs set status='failed',error_code='worker_interrupted',error_message='Worker stopped before saving audio.',completed_at=now()
      where generation_id=exhausted.generation_id and agent_type='voice' and status='running';
    perform public.refresh_image_progress(exhausted.generation_id);
  end loop;
  select * into job from public.jobs where kind='synthesize_voice' and attempts<max_attempts
    and ((status='queued' and available_at<=clock_timestamp()) or (status='running' and locked_until<=clock_timestamp()))
    order by available_at,created_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  perform 1 from public.generations where id=job.generation_id for update;
  update public.agent_runs set status='failed',error_code='worker_interrupted',error_message='Worker stopped before saving audio.',completed_at=now()
    where generation_id=job.generation_id and agent_type='voice' and status='running';
  update public.jobs set status='running',attempts=attempts+1,locked_by=p_worker_id::text || ':' || gen_random_uuid()::text,
    locked_until=clock_timestamp()+interval '120 seconds' where id=job.id returning * into job;
  update public.voiceovers set status='running',attempts=attempts+1,error_message=null where generation_id=job.generation_id;
  update public.generations set updated_at=clock_timestamp() where id=job.generation_id;
  return to_jsonb(job);
end;
$$;

create function public.heartbeat_voice_job(p_job_id uuid,p_token text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.jobs set locked_until=clock_timestamp()+interval '120 seconds' where id=p_job_id and kind='synthesize_voice' and status='running' and locked_by=p_token and locked_until>clock_timestamp();
  return found;
end;
$$;

create function public.begin_voice_attempt(p_job_id uuid,p_token text,p_input jsonb,p_provider text,p_model text)
returns uuid language plpgsql security definer set search_path='' as $$
declare job public.jobs; run_id uuid:=gen_random_uuid(); attempt_number integer;
begin
  job:=public.require_voice_lease(p_job_id,p_token);
  if exists(select 1 from public.agent_runs where generation_id=job.generation_id and agent_type='voice' and status='running') then
    raise exception 'Voice attempt already running' using errcode='55000'; end if;
  select attempts into attempt_number from public.voiceovers where generation_id=job.generation_id;
  insert into public.agent_runs(id,generation_id,agent_type,input,status,attempt,provider,model)
    values(run_id,job.generation_id,'voice',p_input,'running',attempt_number,p_provider,p_model);
  update public.generations set updated_at=clock_timestamp() where id=job.generation_id;
  return run_id;
end;
$$;

create function public.finish_voice_attempt(p_job_id uuid,p_token text,p_run_id uuid,p_output jsonb,p_execution_time integer,
  p_error_code text,p_error_message text,p_retry boolean,p_delay_ms bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare job public.jobs; owner_id uuid; expected_path text; will_retry boolean:=false;
begin
  job:=public.require_voice_lease(p_job_id,p_token);
  perform 1 from public.generations where id=job.generation_id for update;
  if not exists(select 1 from public.agent_runs where id=p_run_id and generation_id=job.generation_id and agent_type='voice' and status='running') then
    raise exception 'Voice attempt state changed' using errcode='55000'; end if;
  if p_error_code is null then
    select p.user_id into owner_id from public.projects p join public.generations g on g.project_id=p.id where g.id=job.generation_id;
    expected_path:=owner_id::text || '/' || job.generation_id::text || '/voice/' || p_run_id::text || '.wav';
    if p_output is null or p_output->>'path' is distinct from expected_path or p_output->>'contentType' is distinct from 'audio/wav' then
      raise exception 'Invalid private audio path' using errcode='22023'; end if;
    update public.voiceovers set status='succeeded', audio_path=expected_path,duration_seconds=(p_output->>'durationSeconds')::double precision,
      sample_rate=(p_output->>'sampleRate')::integer,size_bytes=(p_output->>'sizeBytes')::integer,
      provider=p_output->>'provider',model=p_output->>'model',voice=p_output->>'voice',error_message=null where generation_id=job.generation_id;
    update public.jobs set status='succeeded',locked_by=null,locked_until=null,last_error=null where id=job.id;
    update public.agent_runs set status='succeeded',output=p_output,execution_time=greatest(0,p_execution_time),completed_at=now() where id=p_run_id;
  else
    will_retry:=coalesce(p_retry,false) and job.attempts<job.max_attempts;
    update public.voiceovers set status=(case when will_retry then 'pending' else 'failed' end)::public.step_status,error_message=left(p_error_message,500) where generation_id=job.generation_id;
    update public.jobs set status=case when will_retry then 'queued' else 'failed' end,
      available_at=clock_timestamp()+greatest(0,coalesce(p_delay_ms,0))*interval '1 millisecond',locked_by=null,locked_until=null,last_error=left(p_error_message,500) where id=job.id;
    update public.agent_runs set status='failed',error_code=left(p_error_code,80),error_message=left(p_error_message,500),execution_time=greatest(0,p_execution_time),completed_at=now() where id=p_run_id;
  end if;
  perform public.refresh_image_progress(job.generation_id);
  return will_retry;
end;
$$;

revoke all on function public.queue_voice(uuid), public.enqueue_voice(uuid), public.require_voice_lease(uuid,text), public.claim_voice_job(uuid),
  public.heartbeat_voice_job(uuid,text), public.begin_voice_attempt(uuid,text,jsonb,text,text),
  public.finish_voice_attempt(uuid,text,uuid,jsonb,integer,text,text,boolean,bigint) from public,anon,authenticated;
grant execute on function public.enqueue_voice(uuid) to authenticated;
grant execute on function public.claim_voice_job(uuid),public.heartbeat_voice_job(uuid,text),public.begin_voice_attempt(uuid,text,jsonb,text,text),
  public.finish_voice_attempt(uuid,text,uuid,jsonb,integer,text,text,boolean,bigint) to service_role;
