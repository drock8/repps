-- 054_competition_foundation.sql
-- Live competition system: tables, RLS, Realtime, RPCs

-- ============================================================
-- competition_settings — per-session config (1+ per event)
-- ============================================================
create table competition_settings (
  id                   uuid primary key default gen_random_uuid(),
  event_id             uuid not null references events(id) on delete cascade,
  name                 text not null default 'Main Competition',
  state                text not null default 'draft'
                       check (state in (
                         'draft','announced','join_open','join_closed',
                         'countdown','live','finished','results'
                       )),
  team_size            integer not null default 1 check (team_size between 1 and 5),
  duration_seconds     integer check (duration_seconds is null or duration_seconds > 0),
  target_reps          integer check (target_reps is null or target_reps > 0),
  target_type          text not null default 'timer'
                       check (target_type in ('timer','target')),
  allow_individual     boolean not null default true,
  allow_new_teams      boolean not null default true,
  allow_existing_teams boolean not null default true,
  dashboard_public     boolean not null default true,
  winner_categories    jsonb not null default '["overall"]'::jsonb,
  join_code            text unique not null,
  started_at           timestamptz,
  finished_at          timestamptz,
  created_at           timestamptz not null default now(),

  constraint timer_or_target check (
    (target_type = 'timer' and duration_seconds is not null) or
    (target_type = 'target' and target_reps is not null)
  )
);

create index idx_comp_settings_event on competition_settings(event_id);
create index idx_comp_settings_state on competition_settings(state);
create index idx_comp_settings_join_code on competition_settings(join_code);

alter table competition_settings enable row level security;

-- ============================================================
-- competition_teams — ephemeral, per-competition
-- ============================================================
create table competition_teams (
  id              uuid primary key default gen_random_uuid(),
  competition_id  uuid not null references competition_settings(id) on delete cascade,
  name            text not null check (char_length(name) between 2 and 24),
  created_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now(),
  unique(competition_id, name)
);

create index idx_comp_teams_competition on competition_teams(competition_id);

alter table competition_teams enable row level security;

-- ============================================================
-- competition_participants
-- ============================================================
create table competition_participants (
  id                  uuid primary key default gen_random_uuid(),
  competition_id      uuid not null references competition_settings(id) on delete cascade,
  user_id             uuid not null references profiles(id) on delete cascade,
  competition_team_id uuid references competition_teams(id) on delete set null,
  status              text not null default 'joined'
                      check (status in ('joined','camera_ready','live','withdrawn')),
  entry_type          text not null default 'individual'
                      check (entry_type in ('individual','existing_team','new_team')),
  joined_at           timestamptz not null default now(),
  unique(competition_id, user_id)
);

create index idx_comp_participants_comp on competition_participants(competition_id);
create index idx_comp_participants_user on competition_participants(user_id);
create index idx_comp_participants_team on competition_participants(competition_team_id);

alter table competition_participants enable row level security;

-- ============================================================
-- competition_reps — dual-written alongside reps
-- ============================================================
create table competition_reps (
  id               uuid primary key default gen_random_uuid(),
  competition_id   uuid not null references competition_settings(id) on delete cascade,
  user_id          uuid not null references profiles(id) on delete cascade,
  rep_id           uuid not null references reps(id) on delete cascade,
  qualified        boolean not null default true,
  rejection_reason text check (rejection_reason in (
    'incomplete_down','incomplete_up','too_slow','no_jump', null
  )),
  created_at       timestamptz not null default now()
);

create index idx_comp_reps_comp_user on competition_reps(competition_id, user_id);
create index idx_comp_reps_comp_qualified on competition_reps(competition_id) where qualified = true;

alter table competition_reps enable row level security;

-- ============================================================
-- Enable Realtime
-- ============================================================
alter publication supabase_realtime add table competition_participants;
alter publication supabase_realtime add table competition_reps;
alter publication supabase_realtime add table competition_settings;

-- ============================================================
-- RLS policies — competition_settings
-- ============================================================
create policy "Anyone can read non-draft competitions"
on competition_settings for select to public
using (state != 'draft');

create policy "Creator can read own draft competitions"
on competition_settings for select to authenticated
using (
  exists (select 1 from events e where e.id = event_id and e.created_by = auth.uid())
);

create policy "Creator can insert competitions"
on competition_settings for insert to authenticated
with check (
  exists (select 1 from events e where e.id = event_id and e.created_by = auth.uid())
);

create policy "Creator can update own competitions"
on competition_settings for update to authenticated
using (
  exists (select 1 from events e where e.id = event_id and e.created_by = auth.uid())
);

-- ============================================================
-- RLS policies — competition_teams
-- ============================================================
create policy "Anyone can read competition teams"
on competition_teams for select to public using (true);

create policy "Authenticated can create competition teams"
on competition_teams for insert to authenticated
with check (created_by = auth.uid());

-- ============================================================
-- RLS policies — competition_participants
-- ============================================================
create policy "Anyone can read competition participants"
on competition_participants for select to public using (true);

create policy "Users can insert own participation"
on competition_participants for insert to authenticated
with check (user_id = auth.uid());

create policy "Users can update own participation"
on competition_participants for update to authenticated
using (user_id = auth.uid());

-- ============================================================
-- RLS policies — competition_reps
-- ============================================================
create policy "Anyone can read competition reps"
on competition_reps for select to public using (true);

create policy "Users can insert own competition reps"
on competition_reps for insert to authenticated
with check (user_id = auth.uid());

-- ============================================================
-- RPC: create_competition
-- ============================================================
create or replace function create_competition(
  p_name text,
  p_duration_seconds integer default 300,
  p_team_size integer default 1,
  p_target_type text default 'timer',
  p_target_reps integer default null,
  p_allow_individual boolean default true,
  p_allow_new_teams boolean default true,
  p_winner_categories jsonb default '["overall"]'::jsonb
)
returns jsonb
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_event_id uuid;
  v_comp_id uuid;
  v_join_code text;
  v_event_join_code text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if char_length(trim(p_name)) < 3 or char_length(trim(p_name)) > 60 then
    return jsonb_build_object('success', false, 'error', 'name_invalid');
  end if;

  if p_target_type = 'timer' and (p_duration_seconds is null or p_duration_seconds <= 0) then
    return jsonb_build_object('success', false, 'error', 'duration_required');
  end if;

  if p_target_type = 'target' and (p_target_reps is null or p_target_reps <= 0) then
    return jsonb_build_object('success', false, 'error', 'target_required');
  end if;

  -- Generate unique join codes
  loop
    v_event_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from events where join_code = v_event_join_code);
  end loop;

  loop
    v_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from competition_settings where join_code = v_join_code)
          and v_join_code != v_event_join_code;
  end loop;

  -- Create the parent event (live_sprint mode, short time window)
  insert into events (
    name, competition_mode, starts_at, ends_at,
    join_code, status, created_by, category
  ) values (
    trim(p_name), 'live_sprint', now(), now() + interval '24 hours',
    v_event_join_code, 'active', v_uid, 'community'
  ) returning id into v_event_id;

  -- Create competition settings
  insert into competition_settings (
    event_id, name, state, team_size,
    duration_seconds, target_reps, target_type,
    allow_individual, allow_new_teams, allow_existing_teams,
    winner_categories, join_code
  ) values (
    v_event_id, trim(p_name), 'draft', p_team_size,
    p_duration_seconds, p_target_reps, p_target_type,
    p_allow_individual, p_allow_new_teams, true,
    p_winner_categories, v_join_code
  ) returning id into v_comp_id;

  return jsonb_build_object(
    'success', true,
    'competition_id', v_comp_id,
    'event_id', v_event_id,
    'join_code', v_join_code
  );
end;
$$;

-- ============================================================
-- RPC: enter_competition
-- ============================================================
create or replace function enter_competition(
  p_join_code text,
  p_entry_type text default 'individual',
  p_team_name text default null
)
returns jsonb
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_comp competition_settings%rowtype;
  v_team_id uuid;
  v_participant_id uuid;
  v_count integer;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_comp
  from competition_settings
  where join_code = upper(trim(p_join_code));

  if v_comp.id is null then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  if v_comp.state not in ('join_open', 'join_closed') then
    return jsonb_build_object('success', false, 'error', 'join_not_open',
      'message', 'Competition is not accepting entries');
  end if;

  -- Reject if already joined
  if exists (
    select 1 from competition_participants
    where competition_id = v_comp.id and user_id = v_uid and status != 'withdrawn'
  ) then
    return jsonb_build_object('success', false, 'error', 'already_joined');
  end if;

  -- Handle team creation for new_team entry
  if p_entry_type = 'new_team' then
    if v_comp.team_size <= 1 then
      return jsonb_build_object('success', false, 'error', 'no_teams',
        'message', 'This is an individual competition');
    end if;
    if p_team_name is null or char_length(trim(p_team_name)) < 2 then
      return jsonb_build_object('success', false, 'error', 'team_name_required');
    end if;

    -- Check team name uniqueness within competition
    if exists (
      select 1 from competition_teams
      where competition_id = v_comp.id and lower(name) = lower(trim(p_team_name))
    ) then
      return jsonb_build_object('success', false, 'error', 'team_name_taken');
    end if;

    insert into competition_teams (competition_id, name, created_by)
    values (v_comp.id, trim(p_team_name), v_uid)
    returning id into v_team_id;
  end if;

  insert into competition_participants (
    competition_id, user_id, competition_team_id, entry_type
  ) values (
    v_comp.id, v_uid, v_team_id, p_entry_type
  ) returning id into v_participant_id;

  -- Also add to event_participants if not already there
  insert into event_participants (event_id, user_id)
  values (v_comp.event_id, v_uid)
  on conflict (event_id, user_id) do nothing;

  return jsonb_build_object(
    'success', true,
    'participant_id', v_participant_id,
    'competition_team_id', v_team_id,
    'competition_id', v_comp.id
  );
end;
$$;

-- ============================================================
-- RPC: join_competition_team
-- ============================================================
create or replace function join_competition_team(
  p_competition_team_id uuid
)
returns jsonb
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_team competition_teams%rowtype;
  v_comp competition_settings%rowtype;
  v_member_count integer;
  v_participant_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_team from competition_teams where id = p_competition_team_id;
  if v_team.id is null then
    return jsonb_build_object('success', false, 'error', 'team_not_found');
  end if;

  select * into v_comp from competition_settings where id = v_team.competition_id;

  if v_comp.state not in ('join_open', 'join_closed') then
    return jsonb_build_object('success', false, 'error', 'join_not_open');
  end if;

  -- Check team capacity
  select count(*) into v_member_count
  from competition_participants
  where competition_team_id = v_team.id and status != 'withdrawn';

  if v_member_count >= v_comp.team_size then
    return jsonb_build_object('success', false, 'error', 'team_full');
  end if;

  -- Already in competition?
  if exists (
    select 1 from competition_participants
    where competition_id = v_comp.id and user_id = v_uid and status != 'withdrawn'
  ) then
    return jsonb_build_object('success', false, 'error', 'already_joined');
  end if;

  insert into competition_participants (
    competition_id, user_id, competition_team_id, entry_type
  ) values (
    v_comp.id, v_uid, v_team.id, 'new_team'
  ) returning id into v_participant_id;

  insert into event_participants (event_id, user_id)
  values (v_comp.event_id, v_uid)
  on conflict (event_id, user_id) do nothing;

  return jsonb_build_object(
    'success', true,
    'participant_id', v_participant_id,
    'competition_id', v_comp.id
  );
end;
$$;

-- ============================================================
-- RPC: transition_competition_state
-- ============================================================
create or replace function transition_competition_state(
  p_competition_id uuid,
  p_new_state text
)
returns jsonb
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_comp competition_settings%rowtype;
  v_valid boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_comp from competition_settings where id = p_competition_id;
  if v_comp.id is null then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  -- Only event creator can transition state
  if not exists (
    select 1 from events where id = v_comp.event_id and created_by = v_uid
  ) then
    return jsonb_build_object('success', false, 'error', 'not_organizer');
  end if;

  -- Validate state transitions
  v_valid := case
    when v_comp.state = 'draft'       and p_new_state = 'announced'   then true
    when v_comp.state = 'draft'       and p_new_state = 'join_open'   then true
    when v_comp.state = 'announced'   and p_new_state = 'join_open'   then true
    when v_comp.state = 'join_open'   and p_new_state = 'join_closed' then true
    when v_comp.state = 'join_open'   and p_new_state = 'countdown'   then true
    when v_comp.state = 'join_closed' and p_new_state = 'join_open'   then true
    when v_comp.state = 'join_closed' and p_new_state = 'countdown'   then true
    when v_comp.state = 'countdown'   and p_new_state = 'live'        then true
    when v_comp.state = 'countdown'   and p_new_state = 'join_closed' then true
    when v_comp.state = 'live'        and p_new_state = 'finished'    then true
    when v_comp.state = 'finished'    and p_new_state = 'results'     then true
    else false
  end;

  if not v_valid then
    return jsonb_build_object('success', false, 'error', 'invalid_transition',
      'message', format('Cannot go from %s to %s', v_comp.state, p_new_state));
  end if;

  -- Set timestamps on key transitions
  if p_new_state = 'live' then
    update competition_settings
    set state = p_new_state, started_at = now()
    where id = p_competition_id;
  elsif p_new_state = 'finished' then
    update competition_settings
    set state = p_new_state, finished_at = now()
    where id = p_competition_id;
  else
    update competition_settings
    set state = p_new_state
    where id = p_competition_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'state', p_new_state
  );
end;
$$;

-- ============================================================
-- RPC: record_competition_rep
-- ============================================================
create or replace function record_competition_rep(
  p_competition_id uuid,
  p_rep_id uuid,
  p_qualified boolean default true,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_comp_state text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select state into v_comp_state
  from competition_settings where id = p_competition_id;

  if v_comp_state is null then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  if v_comp_state != 'live' then
    return jsonb_build_object('success', false, 'error', 'not_live');
  end if;

  -- Verify user is a participant
  if not exists (
    select 1 from competition_participants
    where competition_id = p_competition_id and user_id = v_uid and status != 'withdrawn'
  ) then
    return jsonb_build_object('success', false, 'error', 'not_participant');
  end if;

  insert into competition_reps (
    competition_id, user_id, rep_id, qualified, rejection_reason
  ) values (
    p_competition_id, v_uid, p_rep_id, p_qualified, p_rejection_reason
  );

  return jsonb_build_object('success', true);
end;
$$;

-- ============================================================
-- RPC: get_competition_dashboard
-- ============================================================
create or replace function get_competition_dashboard(
  p_competition_id uuid
)
returns jsonb
language plpgsql security definer
as $$
declare
  v_comp competition_settings%rowtype;
  v_event events%rowtype;
  v_participants jsonb;
  v_teams jsonb;
  v_reps jsonb;
  v_total_reps integer;
begin
  select * into v_comp from competition_settings where id = p_competition_id;
  if v_comp.id is null then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  select * into v_event from events where id = v_comp.event_id;

  -- Participants with profile info
  select coalesce(jsonb_agg(row_to_json(p)::jsonb), '[]'::jsonb) into v_participants
  from (
    select
      cp.id as participant_id,
      cp.user_id,
      cp.competition_team_id,
      cp.status,
      cp.entry_type,
      cp.joined_at,
      pr.name,
      pr.avatar_url,
      pr.nationality_code,
      pr.nationality_name,
      pr.gender
    from competition_participants cp
    join profiles pr on pr.id = cp.user_id
    where cp.competition_id = p_competition_id
      and cp.status != 'withdrawn'
    order by cp.joined_at
  ) p;

  -- Teams
  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) into v_teams
  from (
    select ct.id, ct.name, ct.created_by
    from competition_teams ct
    where ct.competition_id = p_competition_id
    order by ct.created_at
  ) t;

  -- Rep counts per user (qualified only)
  select coalesce(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb) into v_reps
  from (
    select
      cr.user_id,
      count(*) filter (where cr.qualified) as qualified_reps,
      count(*) filter (where not cr.qualified) as failed_reps,
      max(cr.created_at) as last_rep_at
    from competition_reps cr
    where cr.competition_id = p_competition_id
    group by cr.user_id
  ) r;

  select count(*) into v_total_reps
  from competition_reps
  where competition_id = p_competition_id and qualified = true;

  return jsonb_build_object(
    'success', true,
    'competition', jsonb_build_object(
      'id', v_comp.id,
      'name', v_comp.name,
      'state', v_comp.state,
      'team_size', v_comp.team_size,
      'duration_seconds', v_comp.duration_seconds,
      'target_reps', v_comp.target_reps,
      'target_type', v_comp.target_type,
      'join_code', v_comp.join_code,
      'started_at', v_comp.started_at,
      'finished_at', v_comp.finished_at,
      'winner_categories', v_comp.winner_categories
    ),
    'event', jsonb_build_object(
      'id', v_event.id,
      'name', v_event.name,
      'banner_url', v_event.banner_url,
      'created_by', v_event.created_by
    ),
    'participants', v_participants,
    'teams', v_teams,
    'reps', v_reps,
    'total_qualified_reps', v_total_reps
  );
end;
$$;

-- ============================================================
-- RPC: update_participant_status
-- ============================================================
create or replace function update_participant_status(
  p_competition_id uuid,
  p_status text
)
returns jsonb
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if p_status not in ('joined','camera_ready','live','withdrawn') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  update competition_participants
  set status = p_status
  where competition_id = p_competition_id
    and user_id = v_uid;

  if not found then
    return jsonb_build_object('success', false, 'error', 'not_participant');
  end if;

  return jsonb_build_object('success', true);
end;
$$;
