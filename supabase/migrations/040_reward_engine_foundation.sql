-- ============================================================
-- 040_reward_engine_foundation.sql — Reward Engine foundation
--
-- Creates bonus_points table, adds profile completion fields,
-- seeds reward settings, and sets up RLS policies.
-- ============================================================

-- 1. Add profile completion fields to profiles
alter table profiles
  add column if not exists dob date,
  add column if not exists nationality_code text,
  add column if not exists nationality_name text;

-- 2. Create bonus_points table
create table if not exists bonus_points (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  category    text not null,
  label       text not null,
  points      int not null,
  created_at  timestamptz not null default now()
);

-- Prevent double-claiming any specific bonus
create unique index if not exists bonus_points_user_category_label_idx
  on bonus_points (user_id, category, label);

-- Fast lookup by user
create index if not exists bonus_points_user_id_idx
  on bonus_points (user_id);

-- 3. RLS policies for bonus_points
alter table bonus_points enable row level security;

-- Users can read their own bonus points
create policy "Users can read own bonus points"
  on bonus_points for select
  using (auth.uid() = user_id);

-- No direct insert/update/delete — only RPCs (security definer) write to this table

-- 4. Seed reward settings (admin-adjustable)
insert into settings (key, value, updated_at) values
  ('reward_profile_dob', '100', now()),
  ('reward_profile_nationality', '100', now())
on conflict (key) do nothing;
