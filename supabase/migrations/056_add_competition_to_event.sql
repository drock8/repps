-- 056_add_competition_to_event.sql
-- RPC to add a competition session to an existing event

create or replace function add_competition_to_event(
  p_event_id uuid,
  p_name text default 'Live Competition',
  p_duration_seconds integer default 300,
  p_team_size integer default 1,
  p_target_type text default 'timer',
  p_target_reps integer default null
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

  loop
    v_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from competition_settings where join_code = v_join_code);
  end loop;

  insert into competition_settings (
    event_id, name, state, team_size,
    duration_seconds, target_reps, target_type,
    join_code
  ) values (
    p_event_id, trim(p_name), 'draft', p_team_size,
    p_duration_seconds, p_target_reps, p_target_type,
    v_join_code
  ) returning id into v_comp_id;

  return jsonb_build_object(
    'success', true,
    'competition_id', v_comp_id,
    'join_code', v_join_code
  );
end;
$$;
