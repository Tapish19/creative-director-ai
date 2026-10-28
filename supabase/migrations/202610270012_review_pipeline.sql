-- Completed reviews stay immutable. Scheduling and retries have their own state row.
create table public.review_tasks (
  generation_id uuid primary key references public.generations(id) on delete cascade,
  status public.step_status not null default 'pending',
  attempts integer not null default 0 check (attempts>=0),
  retry_count integer not null default 0 check (retry_count between 0 and 2),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger review_tasks_updated_at before update on public.review_tasks for each row execute function public.touch_updated_at();
alter table public.review_tasks enable row level security;
revoke all on public.review_tasks from anon,authenticated;
grant select on public.review_tasks to authenticated;
grant all on public.review_tasks to service_role;
create policy review_tasks_read on public.review_tasks for select to authenticated using
  (exists(select 1 from public.generations g join public.projects p on p.id=g.project_id where g.id=review_tasks.generation_id and p.user_id=(select auth.uid())));

alter table public.reviews add column video_id uuid references public.videos(id);
alter table public.reviews add column source_sha256 text check (source_sha256 ~ '^[a-f0-9]{64}$');
alter table public.reviews add column quality_threshold numeric(3,1) not null default 8 check (quality_threshold between 1 and 10);
alter table public.reviews add column input_manifest jsonb;
alter table public.reviews add column provider text;
alter table public.reviews add column model text;
alter table public.reviews add column prompt_version text;
alter table public.jobs drop constraint jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check(kind in ('generate','regenerate_scene','render','plan_and_write','generate_image','synthesize_voice','review'));
create unique index review_job_unique on public.jobs(generation_id) where kind='review';
create unique index review_attempt_unique on public.agent_runs(generation_id,attempt) where agent_type='reviewer';

create function public.queue_review(p_generation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.videos where generation_id=p_generation_id and status='succeeded') then
    raise exception 'Completed video required' using errcode='55000'; end if;
  insert into public.review_tasks(generation_id) values(p_generation_id) on conflict do nothing;
  insert into public.jobs(generation_id,kind,idempotency_key,max_attempts)
    values(p_generation_id,'review','review:' || p_generation_id::text,3) on conflict do nothing;
end;
$$;

create function public.refresh_review_progress(p_generation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare gen public.generations; task public.review_tasks; next_status public.generation_status;
begin
  select * into gen from public.generations where id=p_generation_id for update;
  select * into task from public.review_tasks where generation_id=gen.id;
  if task.status='succeeded' then
    next_status:=case when gen.overall_score>=gen.quality_threshold then 'awaiting_approval'::public.generation_status else 'needs_revision'::public.generation_status end;
  elsif task.status='failed' then next_status:='review_failed';
  else next_status:='reviewing'; end if;
  update public.generations set status=next_status where id=gen.id;
  update public.projects set status=(case next_status when 'reviewing' then 'generating' else next_status::text end)::public.project_status where id=gen.project_id;
end;
$$;

create function public.enqueue_review(p_generation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); project_id_value uuid; gen public.generations; task public.review_tasks;
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
  if gen.status not in ('video_ready','review_failed') or exists(select 1 from public.reviews where generation_id=gen.id)
    or not exists(select 1 from public.videos where generation_id=gen.id and status='succeeded') then
    raise exception 'Review cannot be started' using errcode='55000'; end if;
  select * into task from public.review_tasks where generation_id=gen.id for update;
  if found then
    if task.status<>'failed' or task.retry_count>=2 then raise exception 'Review restart limit reached' using errcode='55000'; end if;
    update public.review_tasks set status='pending',retry_count=retry_count+1,error_message=null where generation_id=gen.id;
    update public.jobs set status='queued',attempts=0,available_at=now(),locked_by=null,locked_until=null,last_error=null where generation_id=gen.id and kind='review';
  else perform public.queue_review(gen.id); end if;
  perform public.refresh_review_progress(gen.id);
end;
$$;

create function public.require_review_lease(p_job_id uuid,p_token text)
returns public.jobs language plpgsql security definer set search_path='' as $$
declare job public.jobs;
begin
  select * into job from public.jobs where id=p_job_id for update;
  if not found or job.kind<>'review' or job.status<>'running' or p_token is null or job.locked_by is distinct from p_token
    or job.locked_until is null or job.locked_until<=clock_timestamp() then raise exception 'Worker lease lost' using errcode='55000'; end if;
  return job;
end;
$$;

create function public.claim_review_job(p_worker_id uuid,p_quality_threshold numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.jobs; exhausted public.jobs;
begin
  if p_worker_id is null or p_quality_threshold is null or p_quality_threshold not between 1 and 10 or p_quality_threshold<>round(p_quality_threshold,1) then
    raise exception 'Invalid review worker configuration' using errcode='22023'; end if;
  for exhausted in select * from public.jobs where kind='review' and status='running' and locked_until<=clock_timestamp() and attempts>=max_attempts for update skip locked
  loop
    perform 1 from public.generations where id=exhausted.generation_id for update;
    update public.jobs set status='failed',locked_by=null,locked_until=null,last_error='Review worker recovery limit reached.' where id=exhausted.id;
    update public.review_tasks set status='failed',error_message='Review worker recovery limit reached.' where generation_id=exhausted.generation_id;
    update public.agent_runs set status='failed',error_code='worker_interrupted',error_message='Worker stopped before saving the review.',completed_at=now()
      where generation_id=exhausted.generation_id and agent_type='reviewer' and status='running';
    perform public.refresh_review_progress(exhausted.generation_id);
  end loop;
  select * into job from public.jobs where kind='review' and attempts<max_attempts
    and ((status='queued' and available_at<=clock_timestamp()) or (status='running' and locked_until<=clock_timestamp()))
    order by available_at,created_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  perform 1 from public.generations where id=job.generation_id for update;
  -- The first claim snapshots the worker configuration. Restarts cannot change the gate.
  update public.generations set quality_threshold=p_quality_threshold where id=job.generation_id
    and exists(select 1 from public.review_tasks where generation_id=job.generation_id and attempts=0);
  update public.agent_runs set status='failed',error_code='worker_interrupted',error_message='Worker stopped before saving the review.',completed_at=now()
    where generation_id=job.generation_id and agent_type='reviewer' and status='running';
  update public.jobs set status='running',attempts=attempts+1,locked_by=p_worker_id::text || ':' || gen_random_uuid()::text,
    locked_until=clock_timestamp()+interval '120 seconds' where id=job.id returning * into job;
  update public.review_tasks set status='running',attempts=attempts+1,error_message=null where generation_id=job.generation_id;
  update public.generations set updated_at=clock_timestamp() where id=job.generation_id;
  return to_jsonb(job);
end;
$$;

create function public.heartbeat_review_job(p_job_id uuid,p_token text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.jobs set locked_until=clock_timestamp()+interval '120 seconds' where id=p_job_id and kind='review' and status='running' and locked_by=p_token and locked_until>clock_timestamp();
  return found;
end;
$$;

create function public.begin_review_attempt(p_job_id uuid,p_token text,p_input jsonb,p_provider text,p_model text)
returns uuid language plpgsql security definer set search_path='' as $$
declare job public.jobs; run_id uuid:=gen_random_uuid(); attempt_number integer;
begin
  job:=public.require_review_lease(p_job_id,p_token);
  if exists(select 1 from public.agent_runs where generation_id=job.generation_id and agent_type='reviewer' and status='running') then
    raise exception 'Review attempt already running' using errcode='55000'; end if;
  select attempts into attempt_number from public.review_tasks where generation_id=job.generation_id;
  insert into public.agent_runs(id,generation_id,agent_type,input,status,attempt,provider,model)
    values(run_id,job.generation_id,'reviewer',p_input,'running',attempt_number,p_provider,p_model);
  update public.generations set updated_at=clock_timestamp() where id=job.generation_id;
  return run_id;
end;
$$;

create function public.finish_review_attempt(p_job_id uuid,p_token text,p_run_id uuid,p_output jsonb,p_execution_time integer,
  p_error_code text,p_error_message text,p_retry boolean,p_delay_ms bigint,p_model text,p_usage jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare job public.jobs; gen public.generations; video public.videos; will_retry boolean:=false; result jsonb; field text; value numeric; manifest jsonb;
begin
  job:=public.require_review_lease(p_job_id,p_token);
  select * into gen from public.generations where id=job.generation_id for update;
  if not exists(select 1 from public.agent_runs where id=p_run_id and generation_id=gen.id and agent_type='reviewer' and status='running') then
    raise exception 'Review attempt state changed' using errcode='55000'; end if;
  if p_error_code is null then
    select * into video from public.videos where generation_id=gen.id and status='succeeded';
    result:=p_output->'review'; manifest:=p_output->'manifest';
    if video.id is null or result is null or jsonb_typeof(result)<>'object' or manifest is null or jsonb_typeof(manifest)<>'object'
      or manifest->>'videoId' is distinct from video.id::text or manifest->>'sourcePath' is distinct from video.video_url
      or coalesce(manifest->>'sourceSha256','') !~ '^[a-f0-9]{64}$' or coalesce(manifest->>'submittedSha256','') !~ '^[a-f0-9]{64}$'
      or (video.metadata->>'sha256' is not null and manifest->>'sourceSha256' is distinct from video.metadata->>'sha256')
      or manifest->>'scope' is distinct from 'video_and_audio' then raise exception 'Invalid review evidence' using errcode='22023'; end if;
    foreach field in array array['hook_strength','clarity','audience_relevance','cta_strength','overall_score'] loop
      if jsonb_typeof(result->field) is distinct from 'number' then raise exception 'Invalid score' using errcode='22023'; end if;
      value:=(result->>field)::numeric;
      if value not between 1 and 10 or value<>round(value,1) then raise exception 'Invalid score' using errcode='22023'; end if;
    end loop;
    if (result->>'overall_score')::numeric<>round(((result->>'hook_strength')::numeric+(result->>'clarity')::numeric+(result->>'audience_relevance')::numeric+(result->>'cta_strength')::numeric)/4,1) then
      raise exception 'Overall score must equal the rounded mean' using errcode='22023'; end if;
    foreach field in array array['problems','suggestions'] loop
      if jsonb_typeof(result->field) is distinct from 'array' then raise exception 'Invalid feedback' using errcode='22023'; end if;
      if jsonb_array_length(result->field)>20 or exists(select 1 from jsonb_array_elements(result->field) e where jsonb_typeof(e)<>'string' or char_length(btrim(e#>>'{}')) not between 1 and 500) then
        raise exception 'Invalid feedback' using errcode='22023'; end if;
    end loop;
    if jsonb_array_length(result->'suggestions')=0 or ((result->>'overall_score')::numeric<gen.quality_threshold and jsonb_array_length(result->'problems')=0) then
      raise exception 'Actionable feedback required' using errcode='22023'; end if;
    insert into public.reviews(generation_id,video_id,source_sha256,quality_threshold,input_manifest,provider,model,prompt_version,
      hook_strength,clarity,audience_relevance,cta_strength,overall_score,problems,suggestions)
    select gen.id,video.id,manifest->>'sourceSha256',gen.quality_threshold,manifest,r.provider,p_model,r.input->>'promptVersion',
      (result->>'hook_strength')::numeric,(result->>'clarity')::numeric,(result->>'audience_relevance')::numeric,(result->>'cta_strength')::numeric,(result->>'overall_score')::numeric,result->'problems',result->'suggestions'
      from public.agent_runs r where r.id=p_run_id;
    update public.generations set overall_score=(result->>'overall_score')::numeric where id=gen.id;
    update public.review_tasks set status='succeeded',error_message=null where generation_id=gen.id;
    update public.jobs set status='succeeded',locked_by=null,locked_until=null,last_error=null where id=job.id;
    update public.agent_runs set status='succeeded',output=p_output,model=p_model,usage=p_usage,execution_time=greatest(0,p_execution_time),completed_at=now() where id=p_run_id;
  else
    will_retry:=coalesce(p_retry,false) and job.attempts<job.max_attempts;
    update public.review_tasks set status=(case when will_retry then 'pending' else 'failed' end)::public.step_status,error_message=left(p_error_message,500) where generation_id=gen.id;
    update public.jobs set status=case when will_retry then 'queued' else 'failed' end,available_at=clock_timestamp()+greatest(0,coalesce(p_delay_ms,0))*interval '1 millisecond',locked_by=null,locked_until=null,last_error=left(p_error_message,500) where id=job.id;
    update public.agent_runs set status='failed',output=p_output,error_code=left(p_error_code,80),error_message=left(p_error_message,500),model=p_model,usage=p_usage,execution_time=greatest(0,p_execution_time),completed_at=now() where id=p_run_id;
  end if;
  perform public.refresh_review_progress(gen.id);
  return will_retry;
end;
$$;
revoke all on function public.queue_review(uuid),public.refresh_review_progress(uuid),public.enqueue_review(uuid),public.require_review_lease(uuid,text),public.claim_review_job(uuid,numeric),
  public.heartbeat_review_job(uuid,text),public.begin_review_attempt(uuid,text,jsonb,text,text),public.finish_review_attempt(uuid,text,uuid,jsonb,integer,text,text,boolean,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_review(uuid) to authenticated;
grant execute on function public.claim_review_job(uuid,numeric),public.heartbeat_review_job(uuid,text),public.begin_review_attempt(uuid,text,jsonb,text,text),
  public.finish_review_attempt(uuid,text,uuid,jsonb,integer,text,text,boolean,bigint,text,jsonb) to service_role;

create or replace function public.refresh_image_progress(p_generation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare gen public.generations; speech public.voiceovers; video public.videos; next_status public.generation_status;
begin
  select * into gen from public.generations where id=p_generation_id for update;
  if exists(select 1 from public.scenes where generation_id=gen.id and status in ('pending','running')) then next_status:='running';
  elsif exists(select 1 from public.scenes where generation_id=gen.id and status='failed') then next_status:='partial';
  else
    perform public.queue_voice(gen.id);
    select * into speech from public.voiceovers where generation_id=gen.id;
    if speech.status='succeeded' then
      perform public.queue_render(gen.id);
      select * into video from public.videos where generation_id=gen.id;
      if video.status='succeeded' then
        perform public.queue_review(gen.id);
        perform public.refresh_review_progress(gen.id);
        return;
      elsif video.status='failed' then next_status:='partial';
      else next_status:='running'; end if;
    elsif speech.status='failed' then next_status:='partial';
    else next_status:='running'; end if;
  end if;
  update public.generations set status=next_status where id=gen.id;
  update public.projects set status=(case next_status when 'running' then 'generating' else next_status::text end)::public.project_status where id=gen.project_id;
end;
$$;
