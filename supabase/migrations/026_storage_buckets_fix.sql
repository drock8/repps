-- 026_storage_buckets_fix.sql — Ensure all storage buckets + RLS policies exist
-- Fixes: avatars bucket missing policies, team-logos bucket never created on remote
-- Uses DO blocks to skip policy creation if policy already exists

-- ============================================================
-- avatars bucket (may already exist from manual creation)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Authenticated users can upload avatars' and tablename = 'objects') then
    create policy "Authenticated users can upload avatars" on storage.objects for insert to authenticated with check (bucket_id = 'avatars');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Authenticated users can update avatars' and tablename = 'objects') then
    create policy "Authenticated users can update avatars" on storage.objects for update to authenticated using (bucket_id = 'avatars');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Public read access for avatars' and tablename = 'objects') then
    create policy "Public read access for avatars" on storage.objects for select to public using (bucket_id = 'avatars');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Authenticated users can delete avatars' and tablename = 'objects') then
    create policy "Authenticated users can delete avatars" on storage.objects for delete to authenticated using (bucket_id = 'avatars');
  end if;
end $$;

-- ============================================================
-- team-logos bucket (defined in 016 but missing on remote)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('team-logos', 'team-logos', true)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Authenticated users can upload team logos' and tablename = 'objects') then
    create policy "Authenticated users can upload team logos" on storage.objects for insert to authenticated with check (bucket_id = 'team-logos');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Authenticated users can update team logos' and tablename = 'objects') then
    create policy "Authenticated users can update team logos" on storage.objects for update to authenticated using (bucket_id = 'team-logos');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Public read access for team logos' and tablename = 'objects') then
    create policy "Public read access for team logos" on storage.objects for select to public using (bucket_id = 'team-logos');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Authenticated users can delete team logos' and tablename = 'objects') then
    create policy "Authenticated users can delete team logos" on storage.objects for delete to authenticated using (bucket_id = 'team-logos');
  end if;
end $$;

-- ============================================================
-- event-banners bucket (should exist, ensure policies)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('event-banners', 'event-banners', true)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Authenticated users can upload event banners' and tablename = 'objects') then
    create policy "Authenticated users can upload event banners" on storage.objects for insert to authenticated with check (bucket_id = 'event-banners');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Authenticated users can update event banners' and tablename = 'objects') then
    create policy "Authenticated users can update event banners" on storage.objects for update to authenticated using (bucket_id = 'event-banners');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Public read access for event banners' and tablename = 'objects') then
    create policy "Public read access for event banners" on storage.objects for select to public using (bucket_id = 'event-banners');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Authenticated users can delete event banners' and tablename = 'objects') then
    create policy "Authenticated users can delete event banners" on storage.objects for delete to authenticated using (bucket_id = 'event-banners');
  end if;
end $$;

-- ============================================================
-- event-sponsors bucket (should exist, ensure policies)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('event-sponsors', 'event-sponsors', true)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Authenticated users can upload event sponsor logos' and tablename = 'objects') then
    create policy "Authenticated users can upload event sponsor logos" on storage.objects for insert to authenticated with check (bucket_id = 'event-sponsors');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Authenticated users can update event sponsor logos' and tablename = 'objects') then
    create policy "Authenticated users can update event sponsor logos" on storage.objects for update to authenticated using (bucket_id = 'event-sponsors');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Public read access for event sponsor logos' and tablename = 'objects') then
    create policy "Public read access for event sponsor logos" on storage.objects for select to public using (bucket_id = 'event-sponsors');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Authenticated users can delete event sponsor logos' and tablename = 'objects') then
    create policy "Authenticated users can delete event sponsor logos" on storage.objects for delete to authenticated using (bucket_id = 'event-sponsors');
  end if;
end $$;
