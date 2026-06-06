-- 059_competition_team_invites.sql
-- Team pairing flow: scan QR → send invite → approve → join team
-- Supports teams of 2, 3, 4, or more based on competition team_size

-- Track pending team invites on participants
alter table competition_participants
  add column if not exists team_invite_from uuid references profiles(id);

-- RPC: send_team_invite
-- Scanner calls this with the scanned user's ID.
-- If scanner is already on a team, invites target to join that team.
-- If neither is on a team, just sets the invite for pairing.
create or replace function send_team_invite(
  p_competition_id uuid,
  p_target_user_id uuid
)
returns jsonb
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_comp competition_settings%rowtype;
  v_my_participant competition_participants%rowtype;
  v_target_participant competition_participants%rowtype;
  v_team_count integer;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if v_uid = p_target_user_id then
    return jsonb_build_object('success', false, 'error', 'cannot_invite_self');
  end if;

  select * into v_comp from competition_settings where id = p_competition_id;
  if v_comp.id is null then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  if v_comp.team_size <= 1 then
    return jsonb_build_object('success', false, 'error', 'individual_competition');
  end if;

  -- Lock both rows to prevent race conditions (consistent ordering by user_id)
  if v_uid < p_target_user_id then
    select * into v_my_participant
    from competition_participants
    where competition_id = p_competition_id and user_id = v_uid and status != 'withdrawn'
    for update;

    select * into v_target_participant
    from competition_participants
    where competition_id = p_competition_id and user_id = p_target_user_id and status != 'withdrawn'
    for update;
  else
    select * into v_target_participant
    from competition_participants
    where competition_id = p_competition_id and user_id = p_target_user_id and status != 'withdrawn'
    for update;

    select * into v_my_participant
    from competition_participants
    where competition_id = p_competition_id and user_id = v_uid and status != 'withdrawn'
    for update;
  end if;

  if v_my_participant.id is null then
    return jsonb_build_object('success', false, 'error', 'not_participant');
  end if;

  if v_target_participant.id is null then
    return jsonb_build_object('success', false, 'error', 'target_not_participant');
  end if;

  -- Target can't already be on a team
  if v_target_participant.competition_team_id is not null then
    return jsonb_build_object('success', false, 'error', 'target_already_on_team');
  end if;

  -- If scanner is on a team, check capacity
  if v_my_participant.competition_team_id is not null then
    select count(*) into v_team_count
    from competition_participants
    where competition_team_id = v_my_participant.competition_team_id and status != 'withdrawn';

    if v_team_count >= v_comp.team_size then
      return jsonb_build_object('success', false, 'error', 'team_full');
    end if;
  end if;

  -- Target can't already have a pending invite
  if v_target_participant.team_invite_from is not null then
    return jsonb_build_object('success', false, 'error', 'target_has_pending_invite');
  end if;

  -- Set the invite
  update competition_participants
  set team_invite_from = v_uid
  where id = v_target_participant.id;

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: respond_team_invite
-- Target approves or declines.
-- On approve: if inviter has a team, join it. Otherwise create a new team.
create or replace function respond_team_invite(
  p_competition_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_comp competition_settings%rowtype;
  v_my_participant competition_participants%rowtype;
  v_inviter_participant competition_participants%rowtype;
  v_team_id uuid;
  v_team_name text;
  v_team_count integer;
  v_inviter_name text;
  v_my_name text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_comp from competition_settings where id = p_competition_id;
  if v_comp.id is null then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  -- Lock my row
  select * into v_my_participant
  from competition_participants
  where competition_id = p_competition_id and user_id = v_uid and status != 'withdrawn'
  for update;

  if v_my_participant.id is null or v_my_participant.team_invite_from is null then
    return jsonb_build_object('success', false, 'error', 'no_pending_invite');
  end if;

  if not p_accept then
    update competition_participants
    set team_invite_from = null
    where id = v_my_participant.id;
    return jsonb_build_object('success', true, 'action', 'declined');
  end if;

  -- Accept: lock inviter's row too
  select * into v_inviter_participant
  from competition_participants
  where competition_id = p_competition_id
    and user_id = v_my_participant.team_invite_from
    and status != 'withdrawn'
  for update;

  if v_inviter_participant.id is null then
    update competition_participants set team_invite_from = null where id = v_my_participant.id;
    return jsonb_build_object('success', false, 'error', 'inviter_left');
  end if;

  -- If I already got placed on a team (e.g. race condition), abort
  if v_my_participant.competition_team_id is not null then
    update competition_participants set team_invite_from = null where id = v_my_participant.id;
    return jsonb_build_object('success', false, 'error', 'already_on_team');
  end if;

  -- Case 1: Inviter already on a team → join that team
  if v_inviter_participant.competition_team_id is not null then
    v_team_id := v_inviter_participant.competition_team_id;

    -- Check capacity with lock
    select count(*) into v_team_count
    from competition_participants
    where competition_team_id = v_team_id and status != 'withdrawn'
    for update;

    if v_team_count >= v_comp.team_size then
      update competition_participants set team_invite_from = null where id = v_my_participant.id;
      return jsonb_build_object('success', false, 'error', 'team_full');
    end if;

    update competition_participants
    set competition_team_id = v_team_id, entry_type = 'new_team', team_invite_from = null
    where id = v_my_participant.id;

    select name into v_team_name from competition_teams where id = v_team_id;
    return jsonb_build_object('success', true, 'action', 'accepted', 'team_id', v_team_id, 'team_name', v_team_name);
  end if;

  -- Case 2: Neither on a team → create new team
  select name into v_inviter_name from profiles where id = v_my_participant.team_invite_from;
  select name into v_my_name from profiles where id = v_uid;
  v_team_name := coalesce(split_part(v_inviter_name, ' ', 1), 'A') || ' & ' || coalesce(split_part(v_my_name, ' ', 1), 'B');

  if exists (select 1 from competition_teams where competition_id = p_competition_id and name = v_team_name) then
    v_team_name := v_team_name || ' ' || substr(gen_random_uuid()::text, 1, 4);
  end if;

  insert into competition_teams (competition_id, name, created_by)
  values (p_competition_id, v_team_name, v_my_participant.team_invite_from)
  returning id into v_team_id;

  update competition_participants
  set competition_team_id = v_team_id, entry_type = 'new_team', team_invite_from = null
  where id = v_my_participant.id;

  update competition_participants
  set competition_team_id = v_team_id, entry_type = 'new_team', team_invite_from = null
  where id = v_inviter_participant.id;

  return jsonb_build_object('success', true, 'action', 'accepted', 'team_id', v_team_id, 'team_name', v_team_name);
end;
$$;
