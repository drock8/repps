-- 019_events_foundation.sql — Events DB foundation: tables, storage, RLS, indexes

-- ============================================================
-- events table
-- ============================================================
create table events (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(name) between 3 and 60),
  description       text check (description is null or char_length(description) <= 500),
  banner_url        text,
  category          text not null default 'community'
                    check (category in ('official', 'community')),
  competition_mode  text not null
                    check (competition_mode in (
                      'global_target', 'individual_most', 'individual_target',
                      'team_most', 'team_target', 'team_vs_team'
                    )),
  target_reps       integer check (target_reps is null or target_reps > 0),
  scoring_method    text not null default 'raw_reps'
                    check (scoring_method in ('raw_reps', 'rep_score')),
  visibility        text not null default 'public'
                    check (visibility in ('public', 'invite_only')),
  join_code         text unique not null,
  prize_type        text not null default 'bragging_rights'
                    check (prize_type in ('bragging_rights', 'custom_prize')),
  prize_description text,
  max_participants  integer check (max_participants is null or max_participants > 0),
  max_teams         integer check (max_teams is null or max_teams > 0),
  allow_late_join   boolean not null default true,
  retroactive_reps  boolean not null default true,
  is_featured       boolean not null default false,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null check (ends_at > starts_at),
  status            text not null default 'draft'
                    check (status in (
                      'draft', 'announced', 'active', 'completed', 'archived'
                    )),
  created_by        uuid not null references profiles(id),
  created_at        timestamptz not null default now()
);

create index idx_events_status on events(status);
create index idx_events_featured on events(is_featured) where is_featured = true;
create index idx_events_join_code on events(join_code);
create index idx_events_starts_at on events(starts_at);

alter table events enable row level security;

-- ============================================================
-- event_participants table
-- ============================================================
create table event_participants (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references events(id) on delete cascade,
  user_id   uuid not null references profiles(id) on delete cascade,
  team_id   uuid references teams(id),
  joined_at timestamptz not null default now(),
  status    text not null default 'active'
            check (status in ('active', 'withdrawn')),
  unique(event_id, user_id)
);

create index idx_event_participants_event on event_participants(event_id);
create index idx_event_participants_user on event_participants(user_id);

alter table event_participants enable row level security;

-- ============================================================
-- event_results table (materialized on event completion)
-- ============================================================
create table event_results (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  user_id     uuid references profiles(id),
  team_id     uuid references teams(id),
  final_reps  integer not null,
  final_score integer,
  rank        integer not null,
  is_winner   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index idx_event_results_event on event_results(event_id);

alter table event_results enable row level security;

-- ============================================================
-- event-banners storage bucket (same pattern as team-logos)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('event-banners', 'event-banners', true)
on conflict (id) do nothing;

create policy "Authenticated users can upload event banners"
on storage.objects for insert
to authenticated
with check (bucket_id = 'event-banners');

create policy "Authenticated users can update event banners"
on storage.objects for update
to authenticated
using (bucket_id = 'event-banners');

create policy "Public read access for event banners"
on storage.objects for select
to public
using (bucket_id = 'event-banners');

create policy "Authenticated users can delete event banners"
on storage.objects for delete
to authenticated
using (bucket_id = 'event-banners');

-- ============================================================
-- RLS policies — events
-- ============================================================
create policy "Anyone can read non-draft events"
on events for select
to public
using (status != 'draft');

create policy "Creator can read own drafts"
on events for select
to authenticated
using (created_by = auth.uid());

create policy "Authenticated users can create events"
on events for insert
to authenticated
with check (created_by = auth.uid());

create policy "Creator can update own events"
on events for update
to authenticated
using (created_by = auth.uid());

-- ============================================================
-- RLS policies — event_participants
-- ============================================================
create policy "Anyone can read event participants"
on event_participants for select
to public
using (true);

-- ============================================================
-- RLS policies — event_results
-- ============================================================
create policy "Anyone can read event results"
on event_results for select
to public
using (true);
