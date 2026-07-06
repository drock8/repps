-- S0.5: Restrict profiles table to hide PII (DOB, nationality, gender) from other users
-- Create a public_profiles view with only display-safe columns.
-- Restrict direct profiles SELECT to own row only.

-- 1. Create public_profiles view (safe columns only)
create or replace view public_profiles as
select
  id,
  name,
  avatar_url,
  team_id,
  team_joined_at,
  referral_code,
  created_at
from profiles;

-- Grant access to the view for authenticated and anon roles
grant select on public_profiles to authenticated, anon;

-- 2. Drop any broad SELECT policies on profiles
-- Common names from Supabase dashboard and prior migrations
drop policy if exists "Public profiles are viewable by everyone." on profiles;
drop policy if exists "Public profiles are viewable by everyone" on profiles;
drop policy if exists "Profiles are viewable by everyone" on profiles;
drop policy if exists "Enable read access for all users" on profiles;
drop policy if exists "Anyone can read profiles" on profiles;
drop policy if exists "profiles_select_policy" on profiles;

-- 3. Ensure RLS is enabled
alter table profiles enable row level security;

-- 4. Create restrictive SELECT policy — users can only read their own full profile
create policy "Users can read own profile"
  on profiles for select
  using (auth.uid() = id);

-- 5. Ensure update policy exists for own profile
drop policy if exists "Users can update own profile." on profiles;
drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 6. Ensure insert policy exists (for profile creation on signup)
drop policy if exists "Users can insert their own profile." on profiles;
drop policy if exists "Users can insert their own profile" on profiles;
create policy "Users can insert own profile"
  on profiles for insert
  with check (auth.uid() = id);
