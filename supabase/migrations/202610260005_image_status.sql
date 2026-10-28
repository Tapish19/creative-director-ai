-- Enum values must commit before functions in the next migration use them.
alter type public.generation_status add value 'images_ready';
alter type public.project_status add value 'images_ready';
alter type public.project_status add value 'partial';
