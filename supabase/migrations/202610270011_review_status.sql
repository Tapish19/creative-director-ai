alter type public.generation_status add value if not exists 'needs_revision';
alter type public.generation_status add value if not exists 'review_failed';
alter type public.project_status add value if not exists 'needs_revision';
alter type public.project_status add value if not exists 'review_failed';
