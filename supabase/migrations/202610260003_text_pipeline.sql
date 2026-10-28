alter table public.generations add column request_key uuid not null default gen_random_uuid();
alter table public.generations add column plan jsonb;
alter table public.generations add column script jsonb;
alter table public.generations add constraint generations_request_unique unique (project_id, request_key);
alter table public.agent_runs add column usage jsonb;
alter table public.jobs drop constraint jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('generate', 'plan_and_write', 'regenerate_scene', 'render'));
create index generations_owner_rate_idx on public.generations(project_id, created_at);
create unique index agent_attempt_unique on public.agent_runs(generation_id, agent_type, attempt) where agent_type in ('planner', 'writer');
create unique index one_active_generation_per_project on public.generations(project_id) where status in ('queued', 'running', 'reviewing');

-- A normal authenticated session can enqueue only its own project. No web service-role key.
create function public.enqueue_text_generation(p_project_id uuid, p_request_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  project public.projects;
  existing_id uuid;
  generation_id uuid := gen_random_uuid();
  next_version integer;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_request_key is null then raise exception 'Request key required' using errcode = '22023'; end if;
  -- Serialize a user's enqueues to make quota checks and repeated clicks race-safe.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));
  select * into project from public.projects where id = p_project_id and user_id = owner_id for update;
  if not found then raise exception 'Campaign not found' using errcode = '42501'; end if;

  select id into existing_id from public.generations where project_id = p_project_id and request_key = p_request_key;
  if found then return existing_id; end if;
  select id into existing_id from public.generations where project_id = p_project_id and status in ('queued', 'running', 'reviewing');
  if found then return existing_id; end if;
  if (select count(*) from public.generations g join public.projects p on p.id = g.project_id where p.user_id = owner_id and g.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'Daily generation limit reached' using errcode = 'P0001';
  end if;
  if (select count(*) from public.generations g join public.projects p on p.id = g.project_id where p.user_id = owner_id and g.status in ('queued', 'running', 'reviewing')) >= 3 then
    raise exception 'Too many active generations' using errcode = 'P0001';
  end if;
  select coalesce(max(version), 0) + 1 into next_version from public.generations where project_id = p_project_id;
  insert into public.generations (id, project_id, version, brief_snapshot, prompt, request_key)
  values (generation_id, p_project_id, next_version,
    to_jsonb(project) - array['id', 'user_id', 'status', 'created_at', 'updated_at'],
    'Plan and write a ' || project.duration || '-second advertisement for ' || project.product_name,
    p_request_key);
  insert into public.jobs (generation_id, kind, idempotency_key, max_attempts)
  values (generation_id, 'plan_and_write', 'text:' || generation_id::text, 5);
  update public.projects set status = 'queued' where id = p_project_id;
  return generation_id;
end;
$$;

-- All writes from a worker are fenced by a fresh token and an unexpired lease.
create function public.require_text_lease(p_job_id uuid, p_token text)
returns public.jobs language plpgsql security definer set search_path = '' as $$
declare job public.jobs;
begin
  select * into job from public.jobs where id = p_job_id for update;
  if not found or job.kind <> 'plan_and_write' or job.status <> 'running'
    or p_token is null or job.locked_by is distinct from p_token or job.locked_until is null or job.locked_until <= clock_timestamp() then
    raise exception 'Worker lease lost' using errcode = '55000';
  end if;
  return job;
end;
$$;

create function public.claim_text_job(p_worker_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare job public.jobs; exhausted public.jobs;
begin
  if p_worker_id is null then raise exception 'Worker identifier required' using errcode = '22023'; end if;
  -- A worker that dies on its last allowed claim must not leave a permanently running job.
  for exhausted in select * from public.jobs
    where kind = 'plan_and_write' and status = 'running' and locked_until <= clock_timestamp() and attempts >= max_attempts
    for update skip locked
  loop
    update public.jobs set status = 'failed', locked_by = null, locked_until = null, last_error = 'Worker recovery limit reached.' where id = exhausted.id;
    update public.agent_runs set status = 'failed', error_code = 'worker_interrupted', error_message = 'Worker stopped before the result was saved.', completed_at = now()
      where generation_id = exhausted.generation_id and status = 'running';
    update public.generations set status = 'failed' where id = exhausted.generation_id;
    update public.projects set status = 'failed' where id = (select project_id from public.generations where id = exhausted.generation_id);
  end loop;

  select * into job from public.jobs
    where kind = 'plan_and_write' and attempts < max_attempts and
      ((status = 'queued' and available_at <= clock_timestamp()) or (status = 'running' and locked_until <= clock_timestamp()))
    order by available_at, created_at limit 1 for update skip locked;
  if not found then return null; end if;

  update public.agent_runs set status = 'failed', error_code = 'worker_interrupted', error_message = 'Worker stopped before the result was saved.', completed_at = now()
    where generation_id = job.generation_id and status = 'running';
  update public.jobs set status = 'running', attempts = attempts + 1,
    locked_by = p_worker_id::text || ':' || gen_random_uuid()::text,
    locked_until = clock_timestamp() + interval '120 seconds'
    where id = job.id returning * into job;
  update public.generations set status = 'running' where id = job.generation_id;
  update public.projects set status = 'generating' where id = (select project_id from public.generations where id = job.generation_id);
  return to_jsonb(job);
end;
$$;

create function public.heartbeat_text_job(p_job_id uuid, p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.jobs set locked_until = clock_timestamp() + interval '120 seconds'
    where id = p_job_id and kind = 'plan_and_write' and status = 'running' and locked_by = p_token and locked_until > clock_timestamp();
  return found;
end;
$$;

create function public.begin_text_agent(p_job_id uuid, p_token text, p_agent public.agent_type, p_input jsonb, p_provider text, p_model text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare job public.jobs; attempt_number integer; run_id uuid := gen_random_uuid();
begin
  job := public.require_text_lease(p_job_id, p_token);
  if p_agent not in ('planner', 'writer') then raise exception 'Unsupported text agent' using errcode = '22023'; end if;
  if exists (select 1 from public.agent_runs where generation_id = job.generation_id and agent_type = p_agent and status = 'succeeded') then
    raise exception 'Agent already completed' using errcode = '55000';
  end if;
  if exists (select 1 from public.agent_runs where generation_id = job.generation_id and status = 'running') then
    raise exception 'An agent is already running' using errcode = '55000';
  end if;
  select coalesce(max(attempt), 0) + 1 into attempt_number from public.agent_runs where generation_id = job.generation_id and agent_type = p_agent;
  if attempt_number > 3 then raise exception 'Agent attempt limit reached' using errcode = '54000'; end if;
  if p_agent = 'writer' and (select plan from public.generations where id = job.generation_id) is null then
    raise exception 'Planner result required' using errcode = '55000';
  end if;
  insert into public.agent_runs (id, generation_id, agent_type, input, status, attempt, provider, model)
    values (run_id, job.generation_id, p_agent, p_input, 'running', attempt_number, p_provider, p_model);
  update public.generations set updated_at = now() where id = job.generation_id;
  return jsonb_build_object('id', run_id, 'attempt', attempt_number);
end;
$$;

create function public.record_text_attempt(
  p_job_id uuid, p_token text, p_run_id uuid, p_status public.step_status,
  p_output jsonb, p_usage jsonb, p_model text, p_execution_time integer,
  p_error_code text, p_error_message text
)
returns void language plpgsql security definer set search_path = '' as $$
declare job public.jobs; agent public.agent_runs; requested_duration integer;
begin
  job := public.require_text_lease(p_job_id, p_token);
  select * into agent from public.agent_runs where id = p_run_id and generation_id = job.generation_id and status = 'running' for update;
  if not found then raise exception 'Running attempt not found' using errcode = '55000'; end if;
  if p_status not in ('succeeded', 'failed') then raise exception 'Invalid attempt result' using errcode = '22023'; end if;
  if p_status = 'succeeded' and (p_output is null or jsonb_typeof(p_output) <> 'object') then raise exception 'Structured output required' using errcode = '22023'; end if;

  update public.agent_runs set status = p_status, output = p_output, usage = p_usage, model = p_model,
    execution_time = p_execution_time, error_code = p_error_code, error_message = p_error_message, completed_at = now() where id = p_run_id;
  if p_status = 'failed' then return; end if;
  if agent.agent_type = 'planner' then
    update public.generations set plan = p_output where id = job.generation_id;
    return;
  end if;

  select (brief_snapshot->>'duration')::integer into requested_duration from public.generations where id = job.generation_id;
  if jsonb_typeof(p_output->'scenes') is distinct from 'array' or jsonb_array_length(p_output->'scenes') not between 3 and 5 then
    raise exception 'Three to five scenes required' using errcode = '22023';
  end if;
  if abs((select sum((scene->>'duration')::numeric) from jsonb_array_elements(p_output->'scenes') scene) - requested_duration) > 0.01 then
    raise exception 'Scene durations do not match brief' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_output->'scenes') with ordinality as items(scene, position) where (scene->>'sceneNumber')::integer is distinct from position::integer) then
    raise exception 'Scenes must be consecutively numbered' using errcode = '22023';
  end if;
  -- Script, scenes, successful attempt and terminal job state commit together.
  insert into public.scenes (generation_id, scene_number, voiceover, caption, visual_prompt, duration)
    select job.generation_id, (scene->>'sceneNumber')::smallint, scene->>'voiceover', scene->>'caption', scene->>'visualPrompt', (scene->>'duration')::numeric
    from jsonb_array_elements(p_output->'scenes') scene;
  update public.generations set script = p_output, status = 'script_ready' where id = job.generation_id;
  update public.projects set status = 'script_ready' where id = (select project_id from public.generations where id = job.generation_id);
  update public.jobs set status = 'succeeded', locked_by = null, locked_until = null, last_error = null where id = job.id;
end;
$$;

create function public.defer_text_job(p_job_id uuid, p_token text, p_retry boolean, p_delay_ms bigint, p_error text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare job public.jobs; will_retry boolean;
begin
  job := public.require_text_lease(p_job_id, p_token);
  will_retry := p_retry and job.attempts < job.max_attempts and not exists (
    select 1 from public.agent_runs where generation_id = job.generation_id and agent_type in ('planner', 'writer')
    group by agent_type having max(attempt) >= 3 and not bool_or(status = 'succeeded')
  );
  update public.jobs set status = case when will_retry then 'queued' else 'failed' end,
    available_at = clock_timestamp() + make_interval(secs => greatest(coalesce(p_delay_ms, 0), 0)::double precision / 1000),
    locked_by = null, locked_until = null, last_error = left(p_error, 1000) where id = job.id;
  update public.generations set status = (case when will_retry then 'queued' else 'failed' end)::public.generation_status where id = job.generation_id;
  update public.projects set status = (case when will_retry then 'queued' else 'failed' end)::public.project_status where id = (select project_id from public.generations where id = job.generation_id);
  return will_retry;
end;
$$;

revoke all on function public.enqueue_text_generation(uuid, uuid) from public, anon;
grant execute on function public.enqueue_text_generation(uuid, uuid) to authenticated;

revoke all on function public.require_text_lease(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_text_job(uuid) from public, anon, authenticated;
revoke all on function public.heartbeat_text_job(uuid, text) from public, anon, authenticated;
revoke all on function public.begin_text_agent(uuid, text, public.agent_type, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.record_text_attempt(uuid, text, uuid, public.step_status, jsonb, jsonb, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.defer_text_job(uuid, text, boolean, bigint, text) from public, anon, authenticated;
grant execute on function public.require_text_lease(uuid, text), public.claim_text_job(uuid), public.heartbeat_text_job(uuid, text), public.begin_text_agent(uuid, text, public.agent_type, jsonb, text, text), public.record_text_attempt(uuid, text, uuid, public.step_status, jsonb, jsonb, text, integer, text, text), public.defer_text_job(uuid, text, boolean, bigint, text) to service_role;
