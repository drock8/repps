-- 016_team_logo.sql — Add logo_url and pending_logo_url to teams, create storage bucket

alter table teams add column if not exists logo_url text;
alter table teams add column if not exists pending_logo_url text;
alter table teams add column if not exists pending_logo_uploaded_by uuid references profiles(id);

-- Storage bucket for team logos (public read, authenticated upload)
insert into storage.buckets (id, name, public)
values ('team-logos', 'team-logos', true)
on conflict (id) do nothing;

-- Allow authenticated users to upload to team-logos bucket
create policy "Authenticated users can upload team logos"
on storage.objects for insert
to authenticated
with check (bucket_id = 'team-logos');

-- Allow authenticated users to update (upsert) their uploads
create policy "Authenticated users can update team logos"
on storage.objects for update
to authenticated
using (bucket_id = 'team-logos');

-- Allow public read access
create policy "Public read access for team logos"
on storage.objects for select
to public
using (bucket_id = 'team-logos');

-- Allow authenticated users to delete team logos
create policy "Authenticated users can delete team logos"
on storage.objects for delete
to authenticated
using (bucket_id = 'team-logos');
