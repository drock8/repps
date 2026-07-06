-- S0.3: Replace overly broad storage bucket policies with ownership-based ones
-- Previously any authenticated user could upload/update/delete ANY object in all buckets.

-- ============================================================
-- event-banners: path is {user_id}/{filename}
-- Only the uploading user (folder owner) can write/delete
-- ============================================================

drop policy if exists "Authenticated users can upload event banners" on storage.objects;
drop policy if exists "Authenticated users can update event banners" on storage.objects;
drop policy if exists "Authenticated users can delete event banners" on storage.objects;

create policy "Event banner owner can upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'event-banners'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Event banner owner can update" on storage.objects
for update to authenticated
using (
  bucket_id = 'event-banners'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Event banner owner can delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'event-banners'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ============================================================
-- event-sponsors: path is {user_id}/{filename}
-- Only the uploading user (folder owner) can write/delete
-- ============================================================

drop policy if exists "Authenticated users can upload event sponsor logos" on storage.objects;
drop policy if exists "Authenticated users can update event sponsor logos" on storage.objects;
drop policy if exists "Authenticated users can delete event sponsor logos" on storage.objects;

create policy "Event sponsor logo owner can upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'event-sponsors'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Event sponsor logo owner can update" on storage.objects
for update to authenticated
using (
  bucket_id = 'event-sponsors'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Event sponsor logo owner can delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'event-sponsors'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ============================================================
-- team-logos: path is {team_id}/logo-{timestamp}.{ext}
-- Only the team captain can write/delete
-- ============================================================

drop policy if exists "Authenticated users can upload team logos" on storage.objects;
drop policy if exists "Authenticated users can update team logos" on storage.objects;
drop policy if exists "Authenticated users can delete team logos" on storage.objects;

create policy "Team captain can upload logo" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'team-logos'
  and (storage.foldername(name))[1] in (
    select id::text from teams where captain_id = auth.uid()
  )
);

create policy "Team captain can update logo" on storage.objects
for update to authenticated
using (
  bucket_id = 'team-logos'
  and (storage.foldername(name))[1] in (
    select id::text from teams where captain_id = auth.uid()
  )
);

create policy "Team captain can delete logo" on storage.objects
for delete to authenticated
using (
  bucket_id = 'team-logos'
  and (storage.foldername(name))[1] in (
    select id::text from teams where captain_id = auth.uid()
  )
);

-- ============================================================
-- feedback-screenshots: path is {user_id}/{filename}
-- Only the uploading user (folder owner) can write/delete
-- ============================================================

drop policy if exists "Authenticated upload feedback screenshots" on storage.objects;

create policy "Feedback screenshot owner can upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'feedback-screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Feedback screenshot owner can delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'feedback-screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
);
