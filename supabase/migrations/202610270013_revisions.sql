alter table public.generations add column revision_mode text not null default 'initial'
  check (revision_mode in ('initial','feedback','automatic','script_edit','scene'));
alter table public.generations add column revision_context jsonb not null default '{}'::jsonb check(jsonb_typeof(revision_context)='object');
alter table public.generations add column automatic_revision_limit smallint check(automatic_revision_limit between 0 and 2);
alter table public.generations add column automatic_revision_stop_reason text check(automatic_revision_stop_reason in ('limit_reached','quota_reached','manual_edit'));
create unique index one_automatic_child on public.generations(parent_generation_id) where revision_mode='automatic';
create index generation_parent_idx on public.generations(parent_generation_id);

-- Reused media points to the original immutable asset row, not a copy of its bytes.
alter table public.scenes add constraint scene_id_generation_unique unique(id,generation_id);
alter table public.scenes add column source_scene_id uuid;
alter table public.scenes add column source_generation_id uuid;
alter table public.scenes add foreign key(source_scene_id,source_generation_id) references public.scenes(id,generation_id);
alter table public.scenes add check((source_scene_id is null)=(source_generation_id is null));
alter table public.voiceovers add constraint voice_id_generation_unique unique(id,generation_id);
alter table public.voiceovers add column source_voiceover_id uuid;
alter table public.voiceovers add column source_generation_id uuid;
alter table public.voiceovers add foreign key(source_voiceover_id,source_generation_id) references public.voiceovers(id,generation_id);
alter table public.voiceovers add check((source_voiceover_id is null)=(source_generation_id is null));

create function public.normalized_copy(p_text text) returns text language sql immutable set search_path='' as $$
  select btrim(regexp_replace(p_text,'\s+',' ','g'));
$$;
create function public.validate_revision_script(p_script jsonb,p_duration integer)
returns void language plpgsql set search_path='' as $$
declare scene jsonb; position integer:=0; duration numeric; total numeric:=0; joined text:=''; field text;
begin
  if jsonb_typeof(p_script) is distinct from 'object' or pg_column_size(p_script)>65536
    or exists(select 1 from jsonb_object_keys(p_script) k where k not in ('script','voiceover','scenes'))
    or jsonb_typeof(p_script->'script') is distinct from 'string' or char_length(btrim(p_script->>'script')) not between 1 and 8000
    or jsonb_typeof(p_script->'voiceover') is distinct from 'string' or char_length(btrim(p_script->>'voiceover')) not between 1 and 2000
    or jsonb_typeof(p_script->'scenes') is distinct from 'array' then raise exception 'Invalid edited script' using errcode='22023'; end if;
  if jsonb_array_length(p_script->'scenes') not between 3 and 5 then raise exception 'Three to five scenes required' using errcode='22023'; end if;
  for scene in select * from jsonb_array_elements(p_script->'scenes') loop
    position:=position+1;
    if jsonb_typeof(scene) is distinct from 'object' or exists(select 1 from jsonb_object_keys(scene) k where k not in ('sceneNumber','duration','voiceover','caption','visualPrompt'))
      or jsonb_typeof(scene->'sceneNumber') is distinct from 'number' or (scene->>'sceneNumber')::numeric<>position
      or jsonb_typeof(scene->'duration') is distinct from 'number' then raise exception 'Invalid scene structure' using errcode='22023'; end if;
    duration:=(scene->>'duration')::numeric;
    if duration<=0 or duration>30 then raise exception 'Invalid scene duration' using errcode='22023'; end if;
    foreach field in array array['voiceover','caption','visualPrompt'] loop
      if jsonb_typeof(scene->field) is distinct from 'string' or char_length(btrim(scene->>field))<1 then raise exception 'Scene copy is required' using errcode='22023'; end if;
    end loop;
    if char_length(scene->>'voiceover')>1000 or char_length(scene->>'caption')>80 or char_length(scene->>'visualPrompt') not between 20 and 3000
      or cardinality(regexp_split_to_array(public.normalized_copy(scene->>'voiceover'),'\s+'))>floor(duration*2.8) then
      raise exception 'Scene copy exceeds length or speech budget' using errcode='22023'; end if;
    total:=total+duration; joined:=joined || ' ' || (scene->>'voiceover');
  end loop;
  if abs(total-p_duration)>0.01 or public.normalized_copy(joined)<>public.normalized_copy(p_script->>'voiceover')
    or cardinality(regexp_split_to_array(public.normalized_copy(p_script->>'voiceover'),'\s+'))>floor(p_duration*2.5) then
    raise exception 'Edited script timing or narration does not match' using errcode='22023'; end if;
end;
$$;

create or replace function public.queue_scene_images(p_generation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.jobs(generation_id,scene_id,kind,idempotency_key,max_attempts)
    select generation_id,id,'generate_image','image:' || id::text,3 from public.scenes
      where generation_id=p_generation_id and status='pending' on conflict do nothing;
  perform public.refresh_image_progress(p_generation_id);
end;
$$;
create or replace function public.queue_voice(p_generation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.voiceovers(generation_id,narration)
    select id,script->>'voiceover' from public.generations where id=p_generation_id on conflict do nothing;
  insert into public.jobs(generation_id,kind,idempotency_key,max_attempts)
    select generation_id,'synthesize_voice','voice:' || generation_id::text,3 from public.voiceovers
      where generation_id=p_generation_id and status='pending' on conflict do nothing;
end;
$$;

-- Internal creation primitive. Public/manual and automatic entry points enforce their own authority.
create function public.create_revision(p_parent_id uuid,p_request_key uuid,p_mode text,p_instruction text,p_script jsonb,p_scene_id uuid,p_visual_prompt text)
returns uuid language plpgsql security definer set search_path='' as $$
declare parent public.generations; owner_id uuid; project_id_value uuid; existing public.generations; new_id uuid:=gen_random_uuid(); next_version integer;
  edited jsonb; source public.scenes; item jsonb; new_scene_id uuid; speech public.voiceovers; review_data jsonb; context jsonb; reason text; request_hash text;
begin
  select g.project_id,p.user_id into project_id_value,owner_id from public.generations g join public.projects p on p.id=g.project_id where g.id=p_parent_id;
  if owner_id is null then raise exception 'Parent generation not found' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,0));
  perform 1 from public.projects where id=project_id_value for update;
  select * into parent from public.generations where id=p_parent_id for update;
  if p_mode not in ('feedback','automatic','script_edit','scene') or p_mode is null or p_request_key is null or char_length(coalesce(p_instruction,''))>2000 then
    raise exception 'Invalid revision request' using errcode='22023'; end if;
  -- Detect accidental idempotency-key reuse with different content; not an authorization hash.
  request_hash:=md5(jsonb_build_object('mode',p_mode,'instruction',p_instruction,'script',p_script,'scene',p_scene_id,'prompt',p_visual_prompt)::text);
  select * into existing from public.generations where project_id=parent.project_id and request_key=p_request_key;
  if found then
    if existing.parent_generation_id is distinct from parent.id or existing.revision_mode<>p_mode or existing.revision_context->>'requestHash' is distinct from request_hash then raise exception 'Request key already used' using errcode='22023'; end if;
    return existing.id;
  end if;
  if p_mode='automatic' then
    select * into existing from public.generations where parent_generation_id=parent.id and revision_mode='automatic';
    if found then return existing.id; end if;
    if parent.status<>'needs_revision' or parent.automatic_revision>=coalesce(parent.automatic_revision_limit,0)
      or not exists(select 1 from public.reviews where generation_id=parent.id) then raise exception 'Automatic revision is not eligible' using errcode='55000'; end if;
  end if;
  if parent.status in ('queued','running','reviewing') or parent.script is null or parent.plan is null
    or exists(select 1 from public.generations where project_id=parent.project_id and status in ('queued','running','reviewing')) then
    raise exception 'Wait for the active generation to finish' using errcode='55000'; end if;
  if (select count(*) from public.generations g join public.projects p on p.id=g.project_id where p.user_id=owner_id and g.created_at>now()-interval '24 hours')>=20
    or (select count(*) from public.generations g join public.projects p on p.id=g.project_id where p.user_id=owner_id and g.status in ('queued','running','reviewing'))>=3 then
    raise exception 'Generation quota reached' using errcode='P0001'; end if;
  select jsonb_build_object('hook_strength',hook_strength,'clarity',clarity,'audience_relevance',audience_relevance,'cta_strength',cta_strength,
    'overall_score',overall_score,'problems',problems,'suggestions',suggestions) into review_data from public.reviews where generation_id=parent.id;
  reason:=coalesce(nullif(btrim(p_instruction),''),case p_mode when 'automatic' then 'Improve the creative using the saved below-threshold review.' when 'feedback' then 'Improve the previous creative using its review feedback.' when 'script_edit' then 'Apply the edited script.' else 'Regenerate the selected scene image.' end);
  context:=jsonb_build_object('sourceGenerationId',parent.id,'previousScript',parent.script,'review',review_data,'instruction',reason,'requestHash',request_hash);
  if p_mode='script_edit' then edited:=p_script;
  elsif p_mode='scene' then
    select * into source from public.scenes where id=p_scene_id and generation_id=parent.id;
    if not found or char_length(btrim(coalesce(p_visual_prompt,''))) not between 20 and 3000 then raise exception 'Invalid scene selection or visual prompt' using errcode='22023'; end if;
    edited:=jsonb_set(parent.script,array['scenes',(source.scene_number-1)::text,'visualPrompt'],to_jsonb(p_visual_prompt));
    context:=context || jsonb_build_object('requestedSceneId',p_scene_id,'requestedVisualPrompt',p_visual_prompt);
  end if;
  if edited is not null then perform public.validate_revision_script(edited,(parent.brief_snapshot->>'duration')::integer); end if;
  if p_mode='script_edit' and edited is null then raise exception 'Edited script required' using errcode='22023'; end if;
  select coalesce(max(version),0)+1 into next_version from public.generations where project_id=parent.project_id;
  insert into public.generations(id,project_id,parent_generation_id,version,request_key,brief_snapshot,prompt,revision_mode,revision_context,revision_reason,
    automatic_revision,automatic_revision_limit,quality_threshold,plan,script)
  values(new_id,parent.project_id,parent.id,next_version,p_request_key,parent.brief_snapshot,reason,p_mode,context,reason,
    case when p_mode='automatic' then parent.automatic_revision+1 else 0 end,
    case when p_mode in ('script_edit','scene') then 0 when p_mode='automatic' then parent.automatic_revision_limit else null end,parent.quality_threshold,
    case when edited is not null then parent.plan else null end,edited);
  if edited is null then
    insert into public.jobs(generation_id,kind,idempotency_key,max_attempts) values(new_id,'plan_and_write','text:' || new_id::text,5);
    update public.projects set status='queued' where id=parent.project_id;
    return new_id;
  end if;
  -- Human edits and single-scene requests never silently trigger a broader AI rewrite.
  insert into public.agent_runs(generation_id,agent_type,input,output,status,provider,model,execution_time,completed_at)
    values(new_id,'planner',jsonb_build_object('sourceGenerationId',parent.id),parent.plan,'succeeded','reuse','saved-plan',0,now()),
    (new_id,'writer',jsonb_build_object('sourceGenerationId',parent.id,'userId',auth.uid(),'revisionMode',p_mode),edited,'succeeded',case when p_mode='script_edit' then 'human' else 'revision' end,'saved-script',0,now());
  for item in select * from jsonb_array_elements(edited->'scenes') loop
    select * into source from public.scenes where generation_id=parent.id and scene_number=(item->>'sceneNumber')::integer
      and visual_prompt=item->>'visualPrompt' and status='succeeded' and image_url is not null
      and (p_mode<>'scene' or id<>p_scene_id);
    new_scene_id:=gen_random_uuid();
    insert into public.scenes(id,generation_id,scene_number,voiceover,caption,visual_prompt,duration,status,image_url,source_scene_id,source_generation_id)
      values(new_scene_id,new_id,(item->>'sceneNumber')::smallint,item->>'voiceover',item->>'caption',item->>'visualPrompt',(item->>'duration')::numeric,
        case when source.id is null then 'pending'::public.step_status else 'succeeded'::public.step_status end,source.image_url,
        case when source.id is not null then coalesce(source.source_scene_id,source.id) end,
        case when source.id is not null then coalesce(source.source_generation_id,source.generation_id) end);
    if source.id is not null then
      insert into public.agent_runs(generation_id,scene_id,agent_type,input,output,status,provider,model,execution_time,completed_at)
      values(new_id,new_scene_id,'images',jsonb_build_object('sourceSceneId',source.id,'sourceGenerationId',parent.id),jsonb_build_object('path',source.image_url,'reused',true),'succeeded','reuse','saved-image',0,now());
    end if;
  end loop;
  select * into speech from public.voiceovers where generation_id=parent.id and status='succeeded'
    and public.normalized_copy(narration)=public.normalized_copy(edited->>'voiceover');
  if found then
    insert into public.voiceovers(generation_id,narration,status,audio_path,duration_seconds,sample_rate,size_bytes,provider,model,voice,source_voiceover_id,source_generation_id)
      values(new_id,edited->>'voiceover','succeeded',speech.audio_path,speech.duration_seconds,speech.sample_rate,speech.size_bytes,speech.provider,speech.model,speech.voice,
        coalesce(speech.source_voiceover_id,speech.id),coalesce(speech.source_generation_id,speech.generation_id));
    insert into public.agent_runs(generation_id,agent_type,input,output,status,provider,model,execution_time,completed_at)
      values(new_id,'voice',jsonb_build_object('sourceGenerationId',parent.id),jsonb_build_object('path',speech.audio_path,'reused',true),'succeeded','reuse','saved-voice',0,now());
  end if;
  perform public.queue_scene_images(new_id);
  return new_id;
end;
$$;

create function public.enqueue_revision(p_parent_id uuid,p_request_key uuid,p_mode text,p_instruction text default '',p_script jsonb default null,p_scene_id uuid default null,p_visual_prompt text default null)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.generations g join public.projects p on p.id=g.project_id where g.id=p_parent_id and p.user_id=auth.uid()) then
    raise exception 'Generation not found' using errcode='42501'; end if;
  if p_mode is null or p_mode not in ('feedback','script_edit','scene') then raise exception 'Invalid revision mode' using errcode='22023'; end if;
  return public.create_revision(p_parent_id,p_request_key,p_mode,p_instruction,p_script,p_scene_id,p_visual_prompt);
end;
$$;

create function public.maybe_queue_automatic_revision(p_generation_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare gen public.generations; child uuid;
begin
  select * into gen from public.generations where id=p_generation_id for update;
  if gen.status<>'needs_revision' then return null; end if;
  select id into child from public.generations where parent_generation_id=gen.id and revision_mode='automatic';
  if found then return child; end if;
  if gen.automatic_revision>=coalesce(gen.automatic_revision_limit,0) then
    update public.generations set automatic_revision_stop_reason=case when revision_mode in ('script_edit','scene') then 'manual_edit' else 'limit_reached' end where id=gen.id;
    return null;
  end if;
  begin
    child:=public.create_revision(gen.id,gen_random_uuid(),'automatic','',null,null,null);
  exception when sqlstate 'P0001' then
    update public.generations set automatic_revision_stop_reason='quota_reached' where id=gen.id;
    return null;
  end;
  return child;
end;
$$;

-- Keep the validated scoring transaction, then append quality-loop scheduling atomically.
alter function public.finish_review_attempt(uuid,text,uuid,jsonb,integer,text,text,boolean,bigint,text,jsonb) rename to commit_review_result;
revoke all on function public.commit_review_result(uuid,text,uuid,jsonb,integer,text,text,boolean,bigint,text,jsonb) from public,anon,authenticated,service_role;
create function public.finish_review_attempt(p_job_id uuid,p_token text,p_run_id uuid,p_output jsonb,p_execution_time integer,
  p_error_code text,p_error_message text,p_retry boolean,p_delay_ms bigint,p_model text,p_usage jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare owner_id uuid; project_id_value uuid; generation_id_value uuid; result boolean;
begin
  select p.user_id,p.id,g.id into owner_id,project_id_value,generation_id_value from public.jobs j join public.generations g on g.id=j.generation_id join public.projects p on p.id=g.project_id where j.id=p_job_id;
  if owner_id is null then raise exception 'Job not found' using errcode='55000'; end if;
  -- Match authenticated enqueue lock ordering before allocating a new version/quota slot.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,0));
  perform 1 from public.projects where id=project_id_value for update;
  result:=public.commit_review_result(p_job_id,p_token,p_run_id,p_output,p_execution_time,p_error_code,p_error_message,p_retry,p_delay_ms,p_model,p_usage);
  if p_error_code is null then perform public.maybe_queue_automatic_revision(generation_id_value); end if;
  return result;
end;
$$;
revoke all on function public.normalized_copy(text),public.validate_revision_script(jsonb,integer),public.create_revision(uuid,uuid,text,text,jsonb,uuid,text),
  public.enqueue_revision(uuid,uuid,text,text,jsonb,uuid,text),public.maybe_queue_automatic_revision(uuid),public.finish_review_attempt(uuid,text,uuid,jsonb,integer,text,text,boolean,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_revision(uuid,uuid,text,text,jsonb,uuid,text) to authenticated;
grant execute on function public.finish_review_attempt(uuid,text,uuid,jsonb,integer,text,text,boolean,bigint,text,jsonb) to service_role;

drop function public.claim_review_job(uuid,numeric);
create function public.claim_review_job(p_worker_id uuid,p_quality_threshold numeric,p_max_automatic_revisions integer default 2)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.jobs; exhausted public.jobs;
begin
  if p_max_automatic_revisions is null or p_max_automatic_revisions not between 0 and 2 or p_worker_id is null or p_quality_threshold is null or p_quality_threshold not between 1 and 10 or p_quality_threshold<>round(p_quality_threshold,1) then
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
  update public.generations set quality_threshold=p_quality_threshold where id=job.generation_id and parent_generation_id is null
    and exists(select 1 from public.review_tasks where generation_id=job.generation_id and attempts=0);
  update public.generations set automatic_revision_limit=coalesce(automatic_revision_limit,p_max_automatic_revisions) where id=job.generation_id;
  update public.agent_runs set status='failed',error_code='worker_interrupted',error_message='Worker stopped before saving the review.',completed_at=now()
    where generation_id=job.generation_id and agent_type='reviewer' and status='running';
  update public.jobs set status='running',attempts=attempts+1,locked_by=p_worker_id::text || ':' || gen_random_uuid()::text,
    locked_until=clock_timestamp()+interval '120 seconds' where id=job.id returning * into job;
  update public.review_tasks set status='running',attempts=attempts+1,error_message=null where generation_id=job.generation_id;
  update public.generations set updated_at=clock_timestamp() where id=job.generation_id;
  return to_jsonb(job);
end;
$$;


revoke all on function public.claim_review_job(uuid,numeric,integer) from public,anon,authenticated;
grant execute on function public.claim_review_job(uuid,numeric,integer) to service_role;
