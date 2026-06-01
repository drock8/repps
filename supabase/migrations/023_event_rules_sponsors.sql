-- ============================================================
-- 023_event_rules_sponsors.sql
--   Add rules (text), sponsors (jsonb), and richer prize_description
--   to events. Create event-sponsors storage bucket.
-- ============================================================

-- 1. Add rules column
alter table events add column if not exists rules text check (rules is null or char_length(rules) <= 2000);

-- 2. Add sponsors column (jsonb array of {name, logo_url, link_url})
alter table events add column if not exists sponsors jsonb default '[]'::jsonb;

-- 3. Widen prize_description to 1000 chars
-- (drop old check if any, add new)
alter table events drop constraint if exists events_prize_description_check;
alter table events add constraint events_prize_description_check
  check (prize_description is null or char_length(prize_description) <= 1000);

-- 4. event-sponsors storage bucket
insert into storage.buckets (id, name, public)
values ('event-sponsors', 'event-sponsors', true)
on conflict (id) do nothing;

create policy "Authenticated users can upload sponsor logos"
on storage.objects for insert
to authenticated
with check (bucket_id = 'event-sponsors');

create policy "Authenticated users can update sponsor logos"
on storage.objects for update
to authenticated
using (bucket_id = 'event-sponsors');

create policy "Public read access for sponsor logos"
on storage.objects for select
to public
using (bucket_id = 'event-sponsors');

create policy "Authenticated users can delete sponsor logos"
on storage.objects for delete
to authenticated
using (bucket_id = 'event-sponsors');

-- 5. Update create_event RPC to accept rules and sponsors
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
  p_sprint_duration_minutes int default null,
  p_rules text default null,
  p_sponsors jsonb default '[]'::jsonb
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

  if char_length(trim(p_name)) < 3 or char_length(trim(p_name)) > 60 then
    return jsonb_build_object('success', false, 'error', 'name_invalid',
      'message', 'Event name must be 3–60 characters');
  end if;

  if p_competition_mode not in (
    'global_target', 'individual_most', 'individual_target',
    'team_most', 'team_target', 'team_vs_team', 'live_sprint'
  ) then
    return jsonb_build_object('success', false, 'error', 'invalid_competition_mode');
  end if;

  if p_ends_at <= p_starts_at then
    return jsonb_build_object('success', false, 'error', 'invalid_timing',
      'message', 'End time must be after start time');
  end if;

  if p_competition_mode in ('global_target', 'individual_target', 'team_target')
     and (p_target_reps is null or p_target_reps <= 0) then
    return jsonb_build_object('success', false, 'error', 'target_required',
      'message', 'Target reps required for target-based competition modes');
  end if;

  if p_competition_mode = 'live_sprint' and (p_sprint_duration_minutes is null or p_sprint_duration_minutes <= 0) then
    return jsonb_build_object('success', false, 'error', 'sprint_duration_required',
      'message', 'Sprint duration is required for live sprint events');
  end if;

  if p_scoring_method not in ('raw_reps', 'rep_score') then
    return jsonb_build_object('success', false, 'error', 'invalid_scoring_method');
  end if;

  if p_category not in ('official', 'community') then
    return jsonb_build_object('success', false, 'error', 'invalid_category');
  end if;

  if p_visibility not in ('public', 'invite_only') then
    return jsonb_build_object('success', false, 'error', 'invalid_visibility');
  end if;

  if p_prize_type not in ('bragging_rights', 'custom_prize') then
    return jsonb_build_object('success', false, 'error', 'invalid_prize_type');
  end if;

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

  loop
    v_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from events where join_code = v_join_code);
  end loop;

  insert into events (
    name, description, banner_url, category, competition_mode,
    target_reps, scoring_method, visibility, join_code,
    prize_type, prize_description, max_participants, max_teams,
    allow_late_join, retroactive_reps, starts_at, ends_at,
    status, created_by, location, sprint_duration_minutes,
    rules, sponsors
  ) values (
    trim(p_name), p_description, p_banner_url, p_category, p_competition_mode,
    p_target_reps, p_scoring_method, p_visibility, v_join_code,
    p_prize_type, p_prize_description, p_max_participants, p_max_teams,
    p_allow_late_join, p_retroactive_reps, p_starts_at, p_ends_at,
    'draft', v_user_id, p_location, p_sprint_duration_minutes,
    p_rules, p_sponsors
  )
  returning id into v_event_id;

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

-- 6. Update update_event RPC to accept rules and sponsors
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
  p_clear_description boolean default false,
  p_rules text default null,
  p_clear_rules boolean default false,
  p_sponsors jsonb default null
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

  if p_name is not null and (char_length(trim(p_name)) < 3 or char_length(trim(p_name)) > 60) then
    return jsonb_build_object('success', false, 'error', 'name_invalid',
      'message', 'Event name must be 3–60 characters');
  end if;

  if p_competition_mode is not null and p_competition_mode not in (
    'global_target', 'individual_most', 'individual_target',
    'team_most', 'team_target', 'team_vs_team', 'live_sprint'
  ) then
    return jsonb_build_object('success', false, 'error', 'invalid_competition_mode');
  end if;

  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    return jsonb_build_object('success', false, 'error', 'invalid_timing',
      'message', 'End time must be after start time');
  end if;

  if p_category is not null and p_category not in ('official', 'community') then
    return jsonb_build_object('success', false, 'error', 'invalid_category');
  end if;

  if p_visibility is not null and p_visibility not in ('public', 'invite_only') then
    return jsonb_build_object('success', false, 'error', 'invalid_visibility');
  end if;

  if p_scoring_method is not null and p_scoring_method not in ('raw_reps', 'rep_score') then
    return jsonb_build_object('success', false, 'error', 'invalid_scoring_method');
  end if;

  if p_prize_type is not null and p_prize_type not in ('bragging_rights', 'custom_prize') then
    return jsonb_build_object('success', false, 'error', 'invalid_prize_type');
  end if;

  if coalesce(p_competition_mode, v_event.competition_mode) = 'live_sprint'
     and p_sprint_duration_minutes is not null
     and p_sprint_duration_minutes <= 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_sprint_duration');
  end if;

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
    sprint_duration_minutes = coalesce(p_sprint_duration_minutes, sprint_duration_minutes),
    rules = case when p_clear_rules then null else coalesce(p_rules, rules) end,
    sponsors = coalesce(p_sponsors, sponsors)
  where id = p_event_id;

  return jsonb_build_object('success', true, 'event_id', p_event_id);
end;
$$;
