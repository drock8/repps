-- ============================================================
-- 032_rename_team_rpc.sql — Captain can rename their team
-- ============================================================

create or replace function rename_team(p_name text)
returns jsonb
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_team_id uuid;
  v_captain_id uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select team_id into v_team_id from profiles where id = v_user_id;
  if v_team_id is null then
    return jsonb_build_object('success', false, 'error', 'not_on_team');
  end if;

  select captain_id into v_captain_id from teams where id = v_team_id;
  if v_captain_id != v_user_id then
    return jsonb_build_object('success', false, 'error', 'not_captain');
  end if;

  if char_length(trim(p_name)) < 3 or char_length(trim(p_name)) > 24 then
    return jsonb_build_object('success', false, 'error', 'name_invalid', 'message', 'Team name must be 3–24 characters');
  end if;

  update teams set name = trim(p_name) where id = v_team_id;

  return jsonb_build_object('success', true, 'name', trim(p_name));
end;
$$;
