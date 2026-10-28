-- Avoid projects -> generations -> projects RLS recursion on UPDATE/DELETE.
-- The definer sees the lineage, but this helper returns information only for the caller's project.
create function public.has_own_generations(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.generations g join public.projects p on p.id = g.project_id
    where p.id = p_project_id and p.user_id = (select auth.uid())
  );
$$;
revoke all on function public.has_own_generations(uuid) from public, anon;
grant execute on function public.has_own_generations(uuid) to authenticated;

drop policy projects_edit on public.projects;
drop policy projects_delete on public.projects;
create policy projects_edit on public.projects for update to authenticated
  using ((select auth.uid()) = user_id and status = 'draft' and not public.has_own_generations(id))
  with check ((select auth.uid()) = user_id and status = 'draft');
create policy projects_delete on public.projects for delete to authenticated
  using ((select auth.uid()) = user_id and status = 'draft' and not public.has_own_generations(id));
