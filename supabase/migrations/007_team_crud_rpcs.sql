-- ============================================================
-- 007_team_crud_rpcs.sql — Phase 8: Team CRUD RPCs
--   create_team, join_team, leave_team
-- ============================================================

-- ============================================================
-- 1. create_team(p_name)
--    - Validate name 3–24 chars
--    - Generate 6-char alphanumeric join code
--    - Create team, set caller as captain
--    - Update caller's profile (team_id, team_joined_at)
--    - Log 'joined' history event
-- ============================================================

create or replace function create_team(p_name text)
returns jsonb
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_team_id uuid;
  v_join_code text;
  v_existing_team uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if char_length(trim(p_name)) < 3 or char_length(trim(p_name)) > 24 then
    return jsonb_build_object('success', false, 'error', 'name_invalid', 'message', 'Team name must be 3–24 characters');
  end if;

  select team_id into v_existing_team from profiles where id = v_user_id;
  if v_existing_team is not null then
    return jsonb_build_object('success', false, 'error', 'already_on_team');
  end if;

  -- Generate unique 6-char join code (retry on collision)
  loop
    v_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from teams where join_code = v_join_code);
  end loop;

  insert into teams (name, join_code, captain_id, status)
  values (trim(p_name), v_join_code, v_user_id, 'forming')
  returning id into v_team_id;

  update profiles
  set team_id = v_team_id, team_joined_at = now()
  where id = v_user_id;

  insert into team_member_history (team_id, user_id, event)
  values (v_team_id, v_user_id, 'joined');

  return jsonb_build_object(
    'success', true,
    'team_id', v_team_id,
    'join_code', v_join_code
  );
end;
$$;

-- ============================================================
-- 2. join_team(p_join_code)
--    - Validate team exists, not full, not disbanded
--    - Validate caller has no team
--    - Add member, log history
--    - Auto-set status to 'active' when 3rd member joins
-- ============================================================

create or replace function join_team(p_join_code text)
returns jsonb
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_team record;
  v_member_count int;
  v_existing_team uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select team_id into v_existing_team from profiles where id = v_user_id;
  if v_existing_team is not null then
    return jsonb_build_object('success', false, 'error', 'already_on_team');
  end if;

  select * into v_team from teams where join_code = upper(trim(p_join_code));
  if v_team is null then
    return jsonb_build_object('success', false, 'error', 'team_not_found');
  end if;

  if v_team.status = 'disbanded' then
    return jsonb_build_object('success', false, 'error', 'team_disbanded');
  end if;

  select count(*) into v_member_count
  from profiles where team_id = v_team.id;

  if v_member_count >= 3 then
    return jsonb_build_object('success', false, 'error', 'team_full');
  end if;

  update profiles
  set team_id = v_team.id, team_joined_at = now()
  where id = v_user_id;

  insert into team_member_history (team_id, user_id, event)
  values (v_team.id, v_user_id, 'joined');

  -- Auto-activate when 3rd member joins
  if v_member_count + 1 >= 3 then
    update teams set status = 'active' where id = v_team.id;
  end if;

  return jsonb_build_object(
    'success', true,
    'team_id', v_team.id,
    'team_name', v_team.name,
    'status', case when v_member_count + 1 >= 3 then 'active' else v_team.status end
  );
end;
$$;

-- ============================================================
-- 3. leave_team()
--    - Remove caller from team
--    - Log 'left' history event
--    - Captain succession: longest-tenured remaining member
--    - Revert to 'forming' (2→1 member) or 'disbanded' (1→0)
-- ============================================================

create or replace function leave_team()
returns jsonb
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_team_id uuid;
  v_team_status text;
  v_captain_id uuid;
  v_remaining_count int;
  v_new_captain_id uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select team_id into v_team_id from profiles where id = v_user_id;
  if v_team_id is null then
    return jsonb_build_object('success', false, 'error', 'not_on_team');
  end if;

  select captain_id into v_captain_id from teams where id = v_team_id;

  -- Remove caller from team
  update profiles
  set team_id = null, team_joined_at = null
  where id = v_user_id;

  insert into team_member_history (team_id, user_id, event)
  values (v_team_id, v_user_id, 'left');

  -- Count remaining members
  select count(*) into v_remaining_count
  from profiles where team_id = v_team_id;

  if v_remaining_count = 0 then
    -- No members left — disband
    update teams set status = 'disbanded' where id = v_team_id;
    return jsonb_build_object('success', true, 'team_status', 'disbanded');
  end if;

  -- Revert to forming if was active
  update teams set status = 'forming' where id = v_team_id and status = 'active';

  -- Captain succession if the leaver was captain
  if v_captain_id = v_user_id then
    select id into v_new_captain_id
    from profiles
    where team_id = v_team_id
    order by team_joined_at asc
    limit 1;

    update teams set captain_id = v_new_captain_id where id = v_team_id;

    insert into team_member_history (team_id, user_id, event)
    values (v_team_id, v_new_captain_id, 'promoted_captain');
  end if;

  return jsonb_build_object(
    'success', true,
    'team_status', 'forming',
    'new_captain_id', v_new_captain_id
  );
end;
$$;
