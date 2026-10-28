-- Briefs are client-editable. All generated artifacts are worker-written and owner-readable.
create type public.project_status as enum ('draft', 'queued', 'generating', 'awaiting_approval', 'approved', 'failed');
create type public.generation_status as enum ('queued', 'running', 'partial', 'reviewing', 'awaiting_approval', 'approved', 'failed');
create type public.step_status as enum ('pending', 'running', 'succeeded', 'failed');
create type public.agent_type as enum ('planner', 'writer', 'images', 'voice', 'renderer', 'reviewer');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  product_name text not null check (char_length(btrim(product_name)) between 2 and 120),
  description text not null check (char_length(btrim(description)) between 20 and 4000),
  target_audience text not null check (char_length(btrim(target_audience)) between 2 and 500),
  tone text not null check (char_length(btrim(tone)) between 2 and 120),
  duration smallint not null check (duration in (15, 30)),
  website_url text check (website_url is null or (website_url ~* '^https?://' and char_length(website_url) <= 2048)),
  goal text not null check (char_length(btrim(goal)) between 2 and 500),
  status public.project_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_generation_id uuid references public.generations(id),
  version integer not null check (version > 0),
  brief_snapshot jsonb not null check (jsonb_typeof(brief_snapshot) = 'object'),
  prompt text not null,
  status public.generation_status not null default 'queued',
  overall_score numeric(3,1) check (overall_score between 1 and 10),
  quality_threshold numeric(3,1) not null default 8 check (quality_threshold between 1 and 10),
  automatic_revision smallint not null default 0 check (automatic_revision between 0 and 2),
  revision_reason text,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version),
  check ((status = 'approved' and approved_at is not null and approved_by is not null) or (status <> 'approved' and approved_at is null and approved_by is null))
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.generations(id) on delete cascade,
  agent_type public.agent_type not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  status public.step_status not null default 'pending',
  attempt integer not null default 1 check (attempt > 0),
  provider text,
  model text,
  execution_time integer check (execution_time >= 0), -- milliseconds
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.generations(id) on delete cascade,
  scene_number smallint not null check (scene_number between 1 and 5),
  voiceover text not null,
  caption text not null,
  visual_prompt text not null,
  image_url text, -- private storage object path; sign URLs at read time
  duration numeric(6,3) not null check (duration > 0 and duration <= 30),
  status public.step_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  unique (generation_id, scene_number)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null unique references public.generations(id) on delete cascade,
  hook_strength numeric(3,1) not null check (hook_strength between 1 and 10),
  clarity numeric(3,1) not null check (clarity between 1 and 10),
  audience_relevance numeric(3,1) not null check (audience_relevance between 1 and 10),
  cta_strength numeric(3,1) not null check (cta_strength between 1 and 10),
  overall_score numeric(3,1) not null check (overall_score between 1 and 10),
  problems jsonb not null default '[]'::jsonb check (jsonb_typeof(problems) = 'array'),
  suggestions jsonb not null default '[]'::jsonb check (jsonb_typeof(suggestions) = 'array'),
  created_at timestamptz not null default now()
);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null unique references public.generations(id) on delete cascade,
  video_url text,
  voice_url text,
  status public.step_status not null default 'pending',
  duration numeric(6,3),
  size_bytes bigint check (size_bytes > 0),
  error_message text,
  created_at timestamptz not null default now()
);

-- Durable worker foundation: leases support reclaim after a process crash.
-- Claim/enqueue RPCs and the worker are introduced in the asynchronous generation phase.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.generations(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  kind text not null check (kind in ('generate', 'regenerate_scene', 'render')),
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_owner_created_idx on public.projects(user_id, created_at desc);
create index generations_project_idx on public.generations(project_id, version desc);
create index agent_runs_generation_idx on public.agent_runs(generation_id, created_at);
create index jobs_claim_idx on public.jobs(available_at) where status in ('queued', 'running');
create index jobs_generation_idx on public.jobs(generation_id);

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger generations_touch before update on public.generations for each row execute function public.touch_updated_at();
create trigger jobs_touch before update on public.jobs for each row execute function public.touch_updated_at();

alter table public.projects enable row level security;
alter table public.generations enable row level security;
alter table public.agent_runs enable row level security;
alter table public.scenes enable row level security;
alter table public.reviews enable row level security;
alter table public.videos enable row level security;
alter table public.jobs enable row level security;

revoke all on public.projects, public.generations, public.agent_runs, public.scenes, public.reviews, public.videos, public.jobs from anon, authenticated;
grant select on public.projects, public.generations, public.agent_runs, public.scenes, public.reviews, public.videos, public.jobs to authenticated;
grant insert (user_id, name, product_name, description, target_audience, tone, duration, website_url, goal) on public.projects to authenticated;
grant update (name, product_name, description, target_audience, tone, duration, website_url, goal) on public.projects to authenticated;
grant delete on public.projects to authenticated;
grant all on public.projects, public.generations, public.agent_runs, public.scenes, public.reviews, public.videos, public.jobs to service_role;

create policy projects_read on public.projects for select to authenticated using ((select auth.uid()) = user_id);
create policy projects_create on public.projects for insert to authenticated with check ((select auth.uid()) = user_id and status = 'draft');
create policy projects_edit on public.projects for update to authenticated
  using ((select auth.uid()) = user_id and status = 'draft' and not exists (select 1 from public.generations g where g.project_id = projects.id))
  with check ((select auth.uid()) = user_id and status = 'draft');
create policy projects_delete on public.projects for delete to authenticated
  using ((select auth.uid()) = user_id and status = 'draft' and not exists (select 1 from public.generations g where g.project_id = projects.id));

create policy generations_read on public.generations for select to authenticated
  using (exists (select 1 from public.projects p where p.id = generations.project_id and p.user_id = (select auth.uid())));

do $$
declare child_table text;
begin
  foreach child_table in array array['agent_runs', 'scenes', 'reviews', 'videos', 'jobs'] loop
    execute format('create policy owner_read on public.%I for select to authenticated using (exists (select 1 from public.generations g join public.projects p on p.id = g.project_id where g.id = %I.generation_id and p.user_id = (select auth.uid())))', child_table, child_table);
  end loop;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creative-assets', 'creative-assets', false, 104857600, array['image/png', 'image/jpeg', 'audio/mpeg', 'audio/wav', 'video/mp4'])
on conflict (id) do nothing;
-- Object names: <user_id>/<project_id>/<generation_id>/<asset>. Worker-only writes.
create policy creative_assets_read on storage.objects for select to authenticated
  using (bucket_id = 'creative-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
