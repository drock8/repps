-- ============================================================
-- 021_live_sprint_and_location.sql
--   Add live_sprint competition mode, location field,
--   sprint_duration_minutes column, and update RPCs.
-- ============================================================

-- 1. Add new columns
alter table events add column if not exists location text check (location is null or char_length(location) <= 200);
alter table events add column if not exists sprint_duration_minutes integer check (sprint_duration_minutes is null or sprint_duration_minutes > 0);

-- 2. Update competition_mode check constraint to include live_sprint
alter table events drop constraint if exists events_competition_mode_check;
alter table events add constraint events_competition_mode_check
  check (competition_mode in (
    'global_target', 'individual_most', 'individual_target',
    'team_most', 'team_target', 'team_vs_team', 'live_sprint'
  ));

-- 3. Update create_event RPC to accept new params
create or replace function create_event(
  p_name text,
  p_competition_mode text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_description text default null,
  p_category text default 'community',
  p_target_reps int default null,
  p_scoring_method text default 'raw_reps',
  p_visibility text default 'public',
  p_prize_type text default 'bragging_rights',
  p_prize_description text default null,
  p_max_participants int default null,
  p_max_teams int default null,
  p_allow_late_join boolean default true,
  p_retroactive_reps boolean default true,
  p_banner_url text default null,
  p_location text default null,
  p_sprint_duration_minutes int default null
)
returns jsonb
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_event_id uuid;
  v_join_code text;
  v_team_id uuid;
  v_team_status text;
  v_is_team_mode boolean;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  -- Validate name
  if char_length(trim(p_name)) < 3 or char_length(trim(p_name)) > 60 then
    return jsonb_build_object('success', false, 'error', 'name_invalid',
      'message', 'Event name must be 3–60 characters');
  end if;

  -- Validate competition mode
  if p_competition_mode not in (
    'global_target', 'individual_most', 'individual_target',
    'team_most', 'team_target', 'team_vs_team', 'live_sprint'
  ) then
    return jsonb_build_object('success', false, 'error', 'invalid_competition_mode');
  end if;

  -- Validate timing
  if p_ends_at <= p_starts_at then
    return jsonb_build_object('success', false, 'error', 'invalid_timing',
      'message', 'End time must be after start time');
  end if;

  -- Validate target_reps for target modes
  if p_competition_mode in ('global_target', 'individual_target', 'team_target')
     and (p_target_reps is null or p_target_reps <= 0) then
    return jsonb_build_object('success', false, 'error', 'target_required',
      'message', 'Target reps required for target-based competition modes');
  end if;

  -- Validate sprint duration for live_sprint mode
  if p_competition_mode = 'live_sprint' and (p_sprint_duration_minutes is null or p_sprint_duration_minutes <= 0) then
    return jsonb_build_object('success', false, 'error', 'sprint_duration_required',
      'message', 'Sprint duration is required for live sprint events');
  end if;

  -- Validate scoring method
  if p_scoring_method not in ('raw_reps', 'rep_score') then
    return jsonb_build_object('success', false, 'error', 'invalid_scoring_method');
  end if;

  -- Validate category
  if p_category not in ('official', 'community') then
    return jsonb_build_object('success', false, 'error', 'invalid_category');
  end if;

  -- Validate visibility
  if p_visibility not in ('public', 'invite_only') then
    return jsonb_build_object('success', false, 'error', 'invalid_visibility');
  end if;

  -- Validate prize_type
  if p_prize_type not in ('bragging_rights', 'custom_prize') then
    return jsonb_build_object('success', false, 'error', 'invalid_prize_type');
  end if;

  -- Team mode validation
  v_is_team_mode := p_competition_mode in ('team_most', 'team_target', 'team_vs_team');
  if v_is_team_mode then
    select p.team_id into v_team_id from profiles p where p.id = v_user_id;
    if v_team_id is null then
      return jsonb_build_object('success', false, 'error', 'no_team',
        'message', 'You must be on an active team to create a team event');
    end if;
    select t.status into v_team_status from teams t where t.id = v_team_id;
    if v_team_status != 'active' then
      return jsonb_build_object('success', false, 'error', 'team_not_active',
        'message', 'Your team must be active (3 members) to create a team event');
    end if;
  end if;

  -- Generate unique 6-char join code (retry on collision)
  loop
    v_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from events where join_code = v_join_code);
  end loop;

  insert into events (
    name, description, banner_url, category, competition_mode,
    target_reps, scoring_method, visibility, join_code,
    prize_type, prize_description, max_participants, max_teams,
    allow_late_join, retroactive_reps, starts_at, ends_at,
    status, created_by, location, sprint_duration_minutes
  ) values (
    trim(p_name), p_description, p_banner_url, p_category, p_competition_mode,
    p_target_reps, p_scoring_method, p_visibility, v_join_code,
    p_prize_type, p_prize_description, p_max_participants, p_max_teams,
    p_allow_late_join, p_retroactive_reps, p_starts_at, p_ends_at,
    'draft', v_user_id, p_location, p_sprint_duration_minutes
  )
  returning id into v_event_id;

  -- Auto-add creator as first participant
  if v_is_team_mode then
    insert into event_participants (event_id, user_id, team_id)
    select v_event_id, p.id, v_team_id
    from profiles p
    where p.team_id = v_team_id;
  else
    insert into event_participants (event_id, user_id)
    values (v_event_id, v_user_id);
  end if;

  return jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'join_code', v_join_code
  );
end;
$$;
