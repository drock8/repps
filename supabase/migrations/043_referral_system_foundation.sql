-- ============================================================
-- 043_referral_system_foundation.sql — Referral (Sparks) foundation
--
-- Adds referral_code to profiles (6-char, unique, backfilled),
-- creates referrals table with RLS, seeds referral settings.
-- ============================================================

-- 1. Add referral_code column to profiles
alter table profiles
  add column if not exists referral_code text;

-- 2. Backfill existing users with unique 6-char codes
do $$
declare
  r record;
  v_code text;
begin
  for r in select id from profiles where referral_code is null loop
    loop
      v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      exit when not exists (select 1 from profiles where referral_code = v_code);
    end loop;
    update profiles set referral_code = v_code where id = r.id;
  end loop;
end;
$$;

-- 3. Now make it NOT NULL + UNIQUE
alter table profiles
  alter column referral_code set not null,
  alter column referral_code set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

create unique index if not exists profiles_referral_code_idx
  on profiles (referral_code);

-- 4. Create referrals table
create table if not exists referrals (
  id            uuid primary key default gen_random_uuid(),
  referrer_id   uuid not null references profiles(id) on delete cascade,
  referred_id   uuid not null references profiles(id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'activated', 'bonus_awarded')),
  points_awarded int not null default 0,
  created_at    timestamptz not null default now(),
  activated_at  timestamptz
);

-- One referrer per user — first link wins
create unique index if not exists referrals_referred_id_idx
  on referrals (referred_id);

-- Fast lookup by referrer
create index if not exists referrals_referrer_id_idx
  on referrals (referrer_id);

-- 5. RLS policies for referrals
alter table referrals enable row level security;

drop policy if exists "Referrers can read own referrals" on referrals;
create policy "Referrers can read own referrals"
  on referrals for select
  using (auth.uid() = referrer_id);

drop policy if exists "Referred users can read own row" on referrals;
create policy "Referred users can read own row"
  on referrals for select
  using (auth.uid() = referred_id);

-- No direct insert/update/delete — only RPCs (security definer) write

-- 6. Seed referral settings
insert into settings (key, value, updated_at) values
  ('referral_base_points', '11', now()),
  ('referral_bonus_points', '15', now())
on conflict (key) do nothing;
