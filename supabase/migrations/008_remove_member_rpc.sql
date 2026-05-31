-- ============================================================
-- 008_remove_member_rpc.sql — Captain can remove a team member
-- ============================================================

-- 1. Expand the event check constraint to allow 'removed'
alter table team_member_history
  drop constraint if exists team_member_history_event_check;

alter table team_member_history
  add constraint team_member_history_event_check
  check (event in ('joined', 'left', 'promoted_captain', 'removed'));

-- 2. remove_member(p_user_id) RPC
--    - Only the captain can remove members
--    - Cannot remove yourself (use leave_team instead)
--    - Logs 'removed' history event
--    - Reverts team to 'forming' if was 'active'

create or replace function remove_member(p_user_id uuid)
returns jsonb
language plpgsql security definer
as $$
declare
  v_caller_id uuid := auth.uid();
  v_team_id uuid;
  v_captain_id uuid;
  v_target_team_id uuid;
  v_remaining_count int;
begin
  if v_caller_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select team_id into v_team_id from profiles where id = v_caller_id;
  if v_team_id is null then
    return jsonb_build_object('success', false, 'error', 'not_on_team');
  end if;

  select captain_id into v_captain_id from teams where id = v_team_id;
  if v_captain_id != v_caller_id then
    return jsonb_build_object('success', false, 'error', 'not_captain');
  end if;

  if p_user_id = v_caller_id then
    return jsonb_build_object('success', false, 'error', 'cannot_remove_self');
  end if;

  select team_id into v_target_team_id from profiles where id = p_user_id;
  if v_target_team_id is null or v_target_team_id != v_team_id then
    return jsonb_build_object('success', false, 'error', 'not_on_your_team');
  end if;

  -- Remove the member
  update profiles
  set team_id = null, team_joined_at = null
  where id = p_user_id;

  insert into team_member_history (team_id, user_id, event)
  values (v_team_id, p_user_id, 'removed');

  -- Revert to forming if was active
  update teams set status = 'forming' where id = v_team_id and status = 'active';

  select count(*) into v_remaining_count
  from profiles where team_id = v_team_id;

  return jsonb_build_object(
    'success', true,
    'remaining_count', v_remaining_count
  );
end;
$$;
