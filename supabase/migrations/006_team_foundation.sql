-- ============================================================
-- 006_team_foundation.sql — Phase 7: DB foundation for v0.2 team system
-- ============================================================

-- ============================================================
-- 1. teams table
-- ============================================================

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 24),
  join_code text unique not null,
  captain_id uuid not null references profiles(id),
  status text not null default 'forming' check (status in ('forming', 'active', 'disbanded')),
  created_at timestamptz not null default now()
);

alter table teams enable row level security;

create policy "Anyone can read teams"
  on teams for select
  to authenticated, anon
  using (true);

create policy "Authenticated users can insert teams"
  on teams for insert
  to authenticated
  with check (captain_id = auth.uid());

create policy "Captain can update own team"
  on teams for update
  to authenticated
  using (captain_id = auth.uid());

-- ============================================================
-- 2. Add team_id and team_joined_at to profiles
--    (must come before RLS policies that reference profiles.team_id)
-- ============================================================

alter table profiles
  add column if not exists team_id uuid references teams(id) on delete set null,
  add column if not exists team_joined_at timestamptz;

-- ============================================================
-- 3. team_member_history table (RLS references profiles.team_id from step 2)
-- ============================================================

create table team_member_history (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  event text not null check (event in ('joined', 'left', 'promoted_captain')),
  created_at timestamptz not null default now()
);

alter table team_member_history enable row level security;

create policy "Team members can read own team history"
  on team_member_history for select
  to authenticated
  using (
    team_id in (
      select p.team_id from profiles p where p.id = auth.uid()
    )
  );

-- ============================================================
-- 4. team_messages table
-- ============================================================

create table team_messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  message_key text not null check (message_key in (
    'lets_go', 'dont_forget', 'just_did_mine', 'whos_in', 'almost_there', 'nice_work'
  )),
  created_at timestamptz not null default now()
);

alter table team_messages enable row level security;

create policy "Team members can read own team messages"
  on team_messages for select
  to authenticated
  using (
    team_id in (
      select p.team_id from profiles p where p.id = auth.uid()
    )
  );

create policy "Team members can insert own team messages"
  on team_messages for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and team_id in (
      select p.team_id from profiles p where p.id = auth.uid()
    )
  );

-- ============================================================
-- 5. nudges table
-- ============================================================

create table nudges (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  nudged_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (sender_id, recipient_id, nudged_on)
);

alter table nudges enable row level security;

create policy "Team members can read own team nudges"
  on nudges for select
  to authenticated
  using (
    team_id in (
      select p.team_id from profiles p where p.id = auth.uid()
    )
  );

create policy "Authenticated users can insert nudges"
  on nudges for insert
  to authenticated
  with check (sender_id = auth.uid());

-- ============================================================
-- 6. Seed team-related admin settings
-- ============================================================

insert into settings (key, value) values
  ('team_daily_target', '5'),
  ('team_daily_multiplier', '3'),
  ('team_weekly_days_required', '5'),
  ('team_weekly_multiplier', '2'),
  ('streak_bonus_base', '1'),
  ('streak_bonus_cap', '11'),
  ('streak_escalation_interval', '10'),
  ('team_streak_bonus_base', '3'),
  ('team_streak_bonus_cap', '33')
on conflict (key) do nothing;

-- ============================================================
-- 7. Enable Realtime on team_messages (for preset chat)
-- ============================================================

alter publication supabase_realtime add table team_messages;

-- ============================================================
-- 8. Indexes for common queries
-- ============================================================

create index idx_team_member_history_team_id on team_member_history(team_id);
create index idx_team_messages_team_id on team_messages(team_id, created_at desc);
create index idx_nudges_team_id on nudges(team_id);
create index idx_nudges_rate_limit on nudges(sender_id, recipient_id, nudged_on);
create index idx_profiles_team_id on profiles(team_id);
