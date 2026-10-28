-- Run against a migrated local Supabase database: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'owner-one@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'owner-two@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
insert into public.projects (user_id, name, product_name, description, target_audience, tone, duration, goal)
values ('10000000-0000-4000-8000-000000000001', 'Owner one campaign', 'MyHotelLine', 'Hotel and restaurant management software', 'Independent hotel owners', 'Confident', 15, 'Book a demo');
select is((select count(*)::integer from public.projects), 1, 'owner can create and read their own campaign');
select throws_ok($$insert into public.projects (user_id, name, product_name, description, target_audience, tone, duration, goal) values ('10000000-0000-4000-8000-000000000002', 'Forged campaign', 'MyHotelLine', 'Hotel and restaurant management software', 'Hotel owners', 'Confident', 15, 'Book a demo')$$, '42501', null, 'ownership cannot be forged');
select throws_ok($$update public.projects set status = 'approved'$$, '42501', null, 'client cannot approve via project update');
select throws_ok($$update public.projects set user_id = '10000000-0000-4000-8000-000000000002'$$, '42501', null, 'client cannot transfer ownership');
update public.projects set tone = 'Warm';
select is((select tone from public.projects), 'Warm', 'owner can edit an ungenerated draft');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.projects), 0, 'other tenant cannot see campaign');
with changed as (update public.projects set name = 'Hijacked campaign' returning *) select is((select count(*)::integer from changed), 0, 'other tenant cannot edit campaign');
with removed as (delete from public.projects returning *) select is((select count(*)::integer from removed), 0, 'other tenant cannot delete campaign');

reset role;
insert into public.generations (project_id, version, brief_snapshot, prompt)
select id, 1, '{}'::jsonb, 'Create an advertisement' from public.projects where name = 'Owner one campaign';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
with changed as (update public.projects set tone = 'Changed after generation' returning *) select is((select count(*)::integer from changed), 0, 'brief is frozen after a generation exists');
with removed as (delete from public.projects returning *) select is((select count(*)::integer from removed), 0, 'generation lineage cannot be deleted by client');
select is((select count(*)::integer from public.generations), 1, 'owner can read generation history');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.generations), 0, 'generation history is private to its owner');

select * from finish();
rollback;
