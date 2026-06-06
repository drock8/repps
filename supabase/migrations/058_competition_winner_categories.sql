-- 058_competition_winner_categories.sql
-- Add winner_categories validation to create_competition and add_competition_to_event RPCs

-- Re-create create_competition with winner_categories validation
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

  if exists (
    select 1 from jsonb_array_elements_text(p_winner_categories) as cat
    where cat not in ('overall', 'most_reps', 'highest_avg')
  ) then
    return jsonb_build_object('success', false, 'error', 'invalid_winner_category');
  end if;

  loop
    v_event_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from events where join_code = v_event_join_code);
  end loop;

  loop
    v_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from competition_settings where join_code = v_join_code)
          and v_join_code != v_event_join_code;
  end loop;

  insert into events (
    name, competition_mode, starts_at, ends_at,
    join_code, status, created_by, category
  ) values (
    trim(p_name), 'live_sprint', now(), now() + interval '24 hours',
    v_event_join_code, 'active', v_uid, 'community'
  ) returning id into v_event_id;

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

-- Re-create add_competition_to_event with winner_categories param + validation

create or replace function add_competition_to_event(
  p_event_id uuid,
  p_name text default 'Live Competition',
  p_duration_seconds integer default 300,
  p_team_size integer default 1,
  p_target_type text default 'timer',
  p_target_reps integer default null,
  p_winner_categories jsonb default '["overall"]'::jsonb
)
returns jsonb
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_event events%rowtype;
  v_comp_id uuid;
  v_join_code text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_event from events where id = p_event_id;
  if v_event.id is null then
    return jsonb_build_object('success', false, 'error', 'event_not_found');
  end if;

  if v_event.created_by != v_uid then
    return jsonb_build_object('success', false, 'error', 'not_organizer');
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

  -- Validate winner_categories contains only known values
  if exists (
    select 1 from jsonb_array_elements_text(p_winner_categories) as cat
    where cat not in ('overall', 'most_reps', 'highest_avg')
  ) then
    return jsonb_build_object('success', false, 'error', 'invalid_winner_category');
  end if;

  loop
    v_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from competition_settings where join_code = v_join_code);
  end loop;

  insert into competition_settings (
    event_id, name, state, team_size,
    duration_seconds, target_reps, target_type,
    winner_categories, join_code
  ) values (
    p_event_id, trim(p_name), 'draft', p_team_size,
    p_duration_seconds, p_target_reps, p_target_type,
    p_winner_categories, v_join_code
  ) returning id into v_comp_id;

  return jsonb_build_object(
    'success', true,
    'competition_id', v_comp_id,
    'join_code', v_join_code
  );
end;
$$;
