alter table public.jobs drop constraint jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('generate', 'plan_and_write', 'generate_image', 'regenerate_scene', 'render'));
alter table public.jobs add column scene_id uuid references public.scenes(id) on delete cascade;
alter table public.jobs add constraint image_job_scene check ((kind = 'generate_image') = (scene_id is not null));
create unique index one_image_job_per_scene on public.jobs(scene_id) where kind = 'generate_image';
alter table public.agent_runs add column scene_id uuid references public.scenes(id) on delete cascade;
create unique index image_attempt_unique on public.agent_runs(scene_id, attempt) where agent_type = 'images';
alter table public.scenes add column retry_count integer not null default 0 check (retry_count between 0 and 2);

-- Called inside the text completion transaction. Existing Phase 2 versions can also
-- enter through the authenticated RPC; successful images are never overwritten.
create function public.queue_scene_images(p_generation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.jobs (generation_id, scene_id, kind, idempotency_key, max_attempts)
    select generation_id, id, 'generate_image', 'image:' || id::text, 3
    from public.scenes where generation_id = p_generation_id
    on conflict do nothing;
  update public.generations set status = 'running' where id = p_generation_id;
  update public.projects set status = 'generating' where id = (select project_id from public.generations where id = p_generation_id);
end;
$$;

create function public.queue_images_after_script()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'plan_and_write' and new.status = 'succeeded' and old.status <> 'succeeded' then
    perform public.queue_scene_images(new.generation_id);
  end if;
  return new;
end;
$$;
create trigger queue_images_after_script after update of status on public.jobs
for each row execute function public.queue_images_after_script();

create function public.enqueue_scene_images(p_generation_id uuid, p_scene_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); gen public.generations; scene public.scenes; project_id_value uuid;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));
  select p.id into project_id_value from public.projects p join public.generations g on g.project_id = p.id
    where g.id = p_generation_id and p.user_id = owner_id for update of p;
  if not found then raise exception 'Generation not found' using errcode = '42501'; end if;
  -- Only terminal image batches may be restarted; this also prevents retries from
  -- racing an in-flight worker and prevents two active versions of one campaign.
  if exists (select 1 from public.generations where project_id = project_id_value and status in ('queued', 'running', 'reviewing')) then
    raise exception 'A generation is already active' using errcode = '55000';
  end if;
  if (select count(*) from public.generations g join public.projects p on p.id = g.project_id
      where p.user_id = owner_id and g.status in ('queued', 'running', 'reviewing')) >= 3 then
    raise exception 'Too many active generations' using errcode = 'P0001';
  end if;
  select * into gen from public.generations where id = p_generation_id for update;
  if p_scene_id is null then
    if gen.status <> 'script_ready' or gen.script is null or
       not exists (select 1 from public.scenes where generation_id = gen.id) then
      raise exception 'Script is not ready for images' using errcode = '55000';
    end if;
    perform public.queue_scene_images(gen.id);
  else
    select * into scene from public.scenes where id = p_scene_id and generation_id = gen.id for update;
    if not found or gen.status <> 'partial' or scene.status <> 'failed' or scene.retry_count >= 2 then
      raise exception 'Scene cannot be retried' using errcode = '55000';
    end if;
    update public.jobs set status = 'queued', attempts = 0, available_at = now(), last_error = null,
      locked_by = null, locked_until = null where scene_id = scene.id and kind = 'generate_image';
    update public.scenes set status = 'pending', error_message = null, retry_count = retry_count + 1 where id = scene.id;
    update public.generations set status = 'running' where id = gen.id;
    update public.projects set status = 'generating' where id = gen.project_id;
  end if;
end;
$$;

-- Serialize aggregation per generation, so concurrent scene completions cannot
-- both observe an unfinished sibling and leave the batch permanently running.
create function public.refresh_image_progress(p_generation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare gen public.generations; next_status public.generation_status;
begin
  select * into gen from public.generations where id = p_generation_id for update;
  if exists (select 1 from public.scenes where generation_id = gen.id and status in ('pending', 'running')) then
    next_status := 'running';
  elsif exists (select 1 from public.scenes where generation_id = gen.id and status = 'failed') then
    next_status := 'partial';
  else next_status := 'images_ready'; end if;
  update public.generations set status = next_status where id = gen.id;
  update public.projects set status = (case next_status when 'running' then 'generating' else next_status::text end)::public.project_status where id = gen.project_id;
end;
$$;

create function public.require_image_lease(p_job_id uuid, p_token text)
returns public.jobs language plpgsql security definer set search_path = '' as $$
declare job public.jobs;
begin
  select * into job from public.jobs where id = p_job_id for update;
  if not found or job.kind <> 'generate_image' or job.status <> 'running' or p_token is null
    or job.locked_by is distinct from p_token or job.locked_until is null or job.locked_until <= clock_timestamp() then
    raise exception 'Worker lease lost' using errcode = '55000';
  end if;
  return job;
end;
$$;

create function public.claim_image_job(p_worker_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare job public.jobs; exhausted public.jobs;
begin
  if p_worker_id is null then raise exception 'Worker identifier required' using errcode = '22023'; end if;
  for exhausted in select * from public.jobs where kind = 'generate_image' and status = 'running'
    and locked_until <= clock_timestamp() and attempts >= max_attempts for update skip locked
  loop
    perform 1 from public.generations where id = exhausted.generation_id for update;
    update public.jobs set status = 'failed', locked_by = null, locked_until = null, last_error = 'Image worker recovery limit reached.' where id = exhausted.id;
    update public.scenes set status = 'failed', error_message = 'Image worker recovery limit reached.' where id = exhausted.scene_id;
    update public.agent_runs set status = 'failed', error_code = 'worker_interrupted', error_message = 'Worker stopped before saving this image.', completed_at = now()
      where scene_id = exhausted.scene_id and status = 'running';
    perform public.refresh_image_progress(exhausted.generation_id);
  end loop;
  select * into job from public.jobs where kind = 'generate_image' and attempts < max_attempts
    and ((status = 'queued' and available_at <= clock_timestamp()) or (status = 'running' and locked_until <= clock_timestamp()))
    order by available_at, created_at, id limit 1 for update skip locked;
  if not found then return null; end if;
  perform 1 from public.generations where id = job.generation_id for update;
  update public.agent_runs set status = 'failed', error_code = 'worker_interrupted', error_message = 'Worker stopped before saving this image.', completed_at = now()
    where scene_id = job.scene_id and status = 'running';
  update public.jobs set status = 'running', attempts = attempts + 1, locked_by = p_worker_id::text || ':' || gen_random_uuid()::text,
    locked_until = clock_timestamp() + interval '120 seconds' where id = job.id returning * into job;
  update public.scenes set status = 'running', attempts = attempts + 1, error_message = null where id = job.scene_id;
  update public.generations set updated_at = clock_timestamp() where id = job.generation_id;
  return to_jsonb(job);
end;
$$;

create function public.heartbeat_image_job(p_job_id uuid, p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.jobs set locked_until = clock_timestamp() + interval '120 seconds'
    where id = p_job_id and kind = 'generate_image' and status = 'running' and locked_by = p_token and locked_until > clock_timestamp();
  return found;
end;
$$;

create function public.begin_image_attempt(p_job_id uuid, p_token text, p_input jsonb, p_provider text, p_model text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare job public.jobs; run_id uuid := gen_random_uuid(); attempt_number integer;
begin
  job := public.require_image_lease(p_job_id, p_token);
  if exists (select 1 from public.agent_runs where scene_id = job.scene_id and status = 'running') then
    raise exception 'Image attempt is already running' using errcode = '55000';
  end if;
  select attempts into attempt_number from public.scenes where id = job.scene_id;
  insert into public.agent_runs(id, generation_id, scene_id, agent_type, input, status, attempt, provider, model)
    values (run_id, job.generation_id, job.scene_id, 'images', p_input, 'running', attempt_number, p_provider, p_model);
  update public.generations set updated_at = clock_timestamp() where id = job.generation_id;
  return run_id;
end;
$$;

create function public.finish_image_attempt(p_job_id uuid, p_token text, p_run_id uuid, p_output jsonb,
  p_execution_time integer, p_error_code text, p_error_message text, p_retry boolean, p_delay_ms bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare job public.jobs; will_retry boolean; object_path text; owner_id uuid;
begin
  job := public.require_image_lease(p_job_id, p_token);
  perform 1 from public.generations where id = job.generation_id for update;
  if not exists (select 1 from public.agent_runs where id = p_run_id and scene_id = job.scene_id and status = 'running') then
    raise exception 'Image attempt state changed' using errcode = '55000';
  end if;
  if p_error_code is null then
    select p.user_id into owner_id from public.projects p join public.generations g on g.project_id = p.id where g.id = job.generation_id;
    object_path := owner_id::text || '/' || job.generation_id::text || '/' || job.scene_id::text || '/' || p_run_id::text || '.jpg';
    if p_output is null or p_output->>'path' is distinct from object_path then
      raise exception 'Invalid private image path' using errcode = '22023';
    end if;
    update public.scenes set status = 'succeeded', image_url = object_path, error_message = null where id = job.scene_id;
    update public.jobs set status = 'succeeded', locked_by = null, locked_until = null, last_error = null where id = job.id;
    update public.agent_runs set status = 'succeeded', output = p_output, execution_time = greatest(0, p_execution_time), completed_at = now() where id = p_run_id;
    will_retry := false;
  else
    will_retry := coalesce(p_retry, false) and job.attempts < job.max_attempts;
    update public.scenes set status = (case when will_retry then 'pending' else 'failed' end)::public.step_status,
      error_message = left(p_error_message, 500) where id = job.scene_id;
    update public.jobs set status = case when will_retry then 'queued' else 'failed' end,
      available_at = clock_timestamp() + greatest(0, coalesce(p_delay_ms, 0)) * interval '1 millisecond',
      locked_by = null, locked_until = null, last_error = left(p_error_message, 500) where id = job.id;
    update public.agent_runs set status = 'failed', error_code = left(p_error_code, 80), error_message = left(p_error_message, 500),
      execution_time = greatest(0, p_execution_time), completed_at = now() where id = p_run_id;
  end if;
  perform public.refresh_image_progress(job.generation_id);
  return will_retry;
end;
$$;

revoke all on function public.queue_scene_images(uuid), public.queue_images_after_script(), public.refresh_image_progress(uuid),
  public.require_image_lease(uuid,text), public.claim_image_job(uuid), public.heartbeat_image_job(uuid,text),
  public.begin_image_attempt(uuid,text,jsonb,text,text), public.finish_image_attempt(uuid,text,uuid,jsonb,integer,text,text,boolean,bigint),
  public.enqueue_scene_images(uuid,uuid) from public, anon, authenticated;
grant execute on function public.enqueue_scene_images(uuid,uuid) to authenticated;
grant execute on function public.claim_image_job(uuid), public.heartbeat_image_job(uuid,text), public.begin_image_attempt(uuid,text,jsonb,text,text),
  public.finish_image_attempt(uuid,text,uuid,jsonb,integer,text,text,boolean,bigint) to service_role;
