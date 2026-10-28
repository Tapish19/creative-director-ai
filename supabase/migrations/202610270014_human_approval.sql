-- Human decisions are separate from AI agent runs and bind to the reviewed MP4.
create table public.generation_approvals (
  generation_id uuid primary key references public.generations(id),
  video_id uuid not null references public.videos(id),
  review_id uuid not null references public.reviews(id),
  video_path text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  overall_score numeric not null check (overall_score between 1 and 10),
  quality_threshold numeric not null check (quality_threshold between 1 and 10),
  accepted_below_threshold boolean not null,
  note text not null default '' check (char_length(note)<=2000),
  check (accepted_below_threshold = (overall_score < quality_threshold))
);
alter table public.generation_approvals enable row level security;
revoke all on public.generation_approvals from public,anon,authenticated,service_role;
grant select on public.generation_approvals to authenticated,service_role;
create policy approval_owner_read on public.generation_approvals for select to authenticated
  using (exists(select 1 from public.generations g join public.projects p on p.id=g.project_id
    where g.id=generation_id and p.user_id=(select auth.uid())));

create function public.approve_generation(p_generation_id uuid,p_video_id uuid,p_review_id uuid,
  p_confirmed boolean,p_accept_low_score boolean default false,p_note text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); project_id_value uuid; gen public.generations;
  video public.videos; review public.reviews; saved public.generation_approvals; decided_at timestamptz;
begin
  select g.project_id into project_id_value from public.generations g join public.projects p on p.id=g.project_id
    where g.id=p_generation_id and p.user_id=owner_id;
  if owner_id is null or project_id_value is null then raise exception 'Generation unavailable' using errcode='42501'; end if;
  if p_confirmed is distinct from true or p_video_id is null or p_review_id is null
    or p_accept_low_score is null or p_note is null or char_length(p_note)>2000 then
    raise exception 'Confirm the reviewed version before approval' using errcode='22023'; end if;
  -- Same ordering as enqueue and automatic revision completion.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,0));
  perform 1 from public.projects where id=project_id_value for update;
  select * into gen from public.generations where id=p_generation_id for update;
  select * into saved from public.generation_approvals where generation_id=gen.id;
  if found then
    if saved.video_id is distinct from p_video_id or saved.review_id is distinct from p_review_id then
      raise exception 'Approval refers to different media' using errcode='55000'; end if;
    -- Repeated delivery preserves the original actor, timestamp and note, even if a child is now active.
    return gen.id;
  end if;
  if gen.status not in ('awaiting_approval','needs_revision')
    or exists(select 1 from public.generations where project_id=project_id_value and status in ('queued','running','reviewing'))
    or exists(select 1 from public.jobs j join public.generations g on g.id=j.generation_id
      where g.project_id=project_id_value and j.status in ('queued','running')) then
    raise exception 'Wait for campaign processing and review to finish' using errcode='55000'; end if;
  select * into video from public.videos where generation_id=gen.id for update;
  select * into review from public.reviews where generation_id=gen.id for update;
  if video.id is distinct from p_video_id or video.status is distinct from 'succeeded' or video.video_url is null
    or review.id is distinct from p_review_id or review.video_id is distinct from video.id
    or coalesce(review.source_sha256,'') !~ '^[a-f0-9]{64}$'
    or review.input_manifest->>'sourcePath' is distinct from video.video_url
    or review.input_manifest->>'sourceSha256' is distinct from review.source_sha256
    or review.input_manifest->>'scope' is distinct from 'video_and_audio'
    or (video.metadata->>'sha256' is not null and video.metadata->>'sha256' is distinct from review.source_sha256)
    or review.overall_score is distinct from gen.overall_score or review.quality_threshold is distinct from gen.quality_threshold
    or not exists(select 1 from public.review_tasks where generation_id=gen.id and status='succeeded') then
    raise exception 'The video or review changed; reload this version' using errcode='55000'; end if;
  if review.overall_score<review.quality_threshold and not p_accept_low_score then
    raise exception 'Acknowledge the below-threshold score' using errcode='22023'; end if;
  decided_at:=clock_timestamp();
  insert into public.generation_approvals(generation_id,video_id,review_id,video_path,source_sha256,approved_by,approved_at,
    overall_score,quality_threshold,accepted_below_threshold,note)
  values(gen.id,video.id,review.id,video.video_url,review.source_sha256,owner_id,decided_at,
    review.overall_score,review.quality_threshold,review.overall_score<review.quality_threshold,btrim(p_note));
  update public.generations set status='approved',approved_by=owner_id,approved_at=decided_at where id=gen.id;
  update public.projects set status='approved' where id=project_id_value;
  return gen.id;
end;
$$;
revoke all on function public.approve_generation(uuid,uuid,uuid,boolean,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.approve_generation(uuid,uuid,uuid,boolean,boolean,text) to authenticated;

-- A later worker refresh cannot silently remove a human decision.
create function public.protect_approved_generation() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='approved' and not exists(select 1 from public.generation_approvals
    where generation_id=new.id and approved_by=new.approved_by and approved_at=new.approved_at) then
    raise exception 'A human approval record is required' using errcode='55000'; end if;
  if old.status='approved' and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
    raise exception 'Approved versions are immutable; create a new version' using errcode='55000'; end if;
  return new;
end;
$$;
revoke all on function public.protect_approved_generation() from public,anon,authenticated,service_role;
create trigger protect_approved_generation before update on public.generations
  for each row execute function public.protect_approved_generation();

create function public.protect_approved_artifact() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.generation_approvals where generation_id=old.generation_id) then
    raise exception 'Approved video and review are immutable' using errcode='55000'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.protect_approved_artifact() from public,anon,authenticated,service_role;
create trigger protect_approved_video before update or delete on public.videos
  for each row execute function public.protect_approved_artifact();
create trigger protect_approved_review before update or delete on public.reviews
  for each row execute function public.protect_approved_artifact();
