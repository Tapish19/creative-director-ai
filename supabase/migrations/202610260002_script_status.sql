-- Enum additions must commit before a following migration uses the new values.
alter type public.project_status add value if not exists 'script_ready';
alter type public.generation_status add value if not exists 'script_ready';
