-- ============================================================
-- 022_update_event_rpc.sql
--   update_event RPC — allows event creator to edit event
--   details while status is draft or announced.
-- ============================================================

create or replace function update_event(
  p_event_id uuid,
  p_name text default null,
  p_description text default null,
  p_banner_url text default null,
  p_category text default null,
  p_visibility text default null,
  p_competition_mode text default null,
  p_target_reps int default null,
  p_scoring_method text default null,
  p_max_participants int default null,
  p_max_teams int default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_prize_type text default null,
  p_prize_description text default null,
  p_allow_late_join boolean default null,
  p_retroactive_reps boolean default null,
  p_location text default null,
  p_sprint_duration_minutes int default null,
  p_clear_banner boolean default false,
  p_clear_location boolean default false,
  p_clear_description boolean default false
)
returns jsonb
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_event record;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_event from events where id = p_event_id;

  if v_event is null then
    return jsonb_build_object('success', false, 'error', 'event_not_found');
  end if;

  if v_event.created_by != v_user_id then
    return jsonb_build_object('success', false, 'error', 'not_creator');
  end if;

  if v_event.status not in ('draft', 'announced') then
    return jsonb_build_object('success', false, 'error', 'not_editable',
      'message', 'Can only edit draft or announced events');
  end if;

  -- Validate name if provided
  if p_name is not null and (char_length(trim(p_name)) < 3 or char_length(trim(p_name)) > 60) then
    return jsonb_build_object('success', false, 'error', 'name_invalid',
      'message', 'Event name must be 3–60 characters');
  end if;

  -- Validate competition mode if provided
  if p_competition_mode is not null and p_competition_mode not in (
    'global_target', 'individual_most', 'individual_target',
    'team_most', 'team_target', 'team_vs_team', 'live_sprint'
  ) then
    return jsonb_build_object('success', false, 'error', 'invalid_competition_mode');
  end if;

  -- Validate timing if both provided
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    return jsonb_build_object('success', false, 'error', 'invalid_timing',
      'message', 'End time must be after start time');
  end if;

  -- Validate category if provided
  if p_category is not null and p_category not in ('official', 'community') then
    return jsonb_build_object('success', false, 'error', 'invalid_category');
  end if;

  -- Validate visibility if provided
  if p_visibility is not null and p_visibility not in ('public', 'invite_only') then
    return jsonb_build_object('success', false, 'error', 'invalid_visibility');
  end if;

  -- Validate scoring method if provided
  if p_scoring_method is not null and p_scoring_method not in ('raw_reps', 'rep_score') then
    return jsonb_build_object('success', false, 'error', 'invalid_scoring_method');
  end if;

  -- Validate prize_type if provided
  if p_prize_type is not null and p_prize_type not in ('bragging_rights', 'custom_prize') then
    return jsonb_build_object('success', false, 'error', 'invalid_prize_type');
  end if;

  -- Validate sprint duration for live_sprint
  if coalesce(p_competition_mode, v_event.competition_mode) = 'live_sprint'
     and p_sprint_duration_minutes is not null
     and p_sprint_duration_minutes <= 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_sprint_duration');
  end if;

  -- Apply updates (only non-null params override)
  update events set
    name = coalesce(trim(p_name), name),
    description = case when p_clear_description then null else coalesce(p_description, description) end,
    banner_url = case when p_clear_banner then null else coalesce(p_banner_url, banner_url) end,
    category = coalesce(p_category, category),
    visibility = coalesce(p_visibility, visibility),
    competition_mode = coalesce(p_competition_mode, competition_mode),
    target_reps = coalesce(p_target_reps, target_reps),
    scoring_method = coalesce(p_scoring_method, scoring_method),
    max_participants = coalesce(p_max_participants, max_participants),
    max_teams = coalesce(p_max_teams, max_teams),
    starts_at = coalesce(p_starts_at, starts_at),
    ends_at = coalesce(p_ends_at, ends_at),
    prize_type = coalesce(p_prize_type, prize_type),
    prize_description = coalesce(p_prize_description, prize_description),
    allow_late_join = coalesce(p_allow_late_join, allow_late_join),
    retroactive_reps = coalesce(p_retroactive_reps, retroactive_reps),
    location = case when p_clear_location then null else coalesce(p_location, location) end,
    sprint_duration_minutes = coalesce(p_sprint_duration_minutes, sprint_duration_minutes)
  where id = p_event_id;

  return jsonb_build_object('success', true, 'event_id', p_event_id);
end;
$$;
