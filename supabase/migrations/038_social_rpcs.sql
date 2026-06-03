-- Phase 19: Social RPCs
-- send_message, send_nudge, send_team_message, get_inbox,
-- get_conversation_messages, mark_read, get_unread_count,
-- block_user, unblock_user, get_public_profile

-- ─── Helper: find or create DM conversation ───
create or replace function _find_or_create_dm(p_user_a uuid, p_user_b uuid)
returns uuid
language plpgsql security definer as $$
declare
  v_convo_id uuid;
begin
  -- Look for existing DM between these two users
  select cp1.conversation_id into v_convo_id
  from conversation_participants cp1
  join conversation_participants cp2 on cp1.conversation_id = cp2.conversation_id
  join conversations c on c.id = cp1.conversation_id
  where c.type = 'dm'
    and cp1.user_id = p_user_a
    and cp2.user_id = p_user_b;

  if v_convo_id is not null then
    return v_convo_id;
  end if;

  -- Create new DM conversation
  insert into conversations (type) values ('dm')
  returning id into v_convo_id;

  insert into conversation_participants (conversation_id, user_id)
  values (v_convo_id, p_user_a), (v_convo_id, p_user_b);

  return v_convo_id;
end;
$$;

-- ─── send_message ───
create or replace function send_message(p_recipient_id uuid, p_message_key text)
returns jsonb
language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
  v_convo_id uuid;
  v_blocked boolean;
begin
  if v_caller is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if v_caller = p_recipient_id then
    return jsonb_build_object('success', false, 'error', 'cannot_message_self');
  end if;

  -- Check recipient exists
  if not exists (select 1 from profiles where id = p_recipient_id) then
    return jsonb_build_object('success', false, 'error', 'recipient_not_found');
  end if;

  -- Check caller hasn't blocked the recipient
  select exists(select 1 from blocks where blocker_id = v_caller and blocked_id = p_recipient_id)
  into v_blocked;
  if v_blocked then
    return jsonb_build_object('success', false, 'error', 'you_blocked_this_user');
  end if;

  v_convo_id := _find_or_create_dm(v_caller, p_recipient_id);

  insert into messages (conversation_id, sender_id, message_type, message_key)
  values (v_convo_id, v_caller, 'preset', p_message_key);

  return jsonb_build_object('success', true, 'conversation_id', v_convo_id);
end;
$$;

-- ─── send_nudge ───
create or replace function send_nudge(p_recipient_id uuid)
returns jsonb
language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
  v_convo_id uuid;
  v_blocked boolean;
  v_already_nudged boolean;
begin
  if v_caller is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if v_caller = p_recipient_id then
    return jsonb_build_object('success', false, 'error', 'cannot_nudge_self');
  end if;

  if not exists (select 1 from profiles where id = p_recipient_id) then
    return jsonb_build_object('success', false, 'error', 'recipient_not_found');
  end if;

  select exists(select 1 from blocks where blocker_id = v_caller and blocked_id = p_recipient_id)
  into v_blocked;
  if v_blocked then
    return jsonb_build_object('success', false, 'error', 'you_blocked_this_user');
  end if;

  v_convo_id := _find_or_create_dm(v_caller, p_recipient_id);

  -- Rate limit: 1 nudge per sender per conversation per day
  select exists(
    select 1 from messages
    where conversation_id = v_convo_id
      and sender_id = v_caller
      and message_type = 'nudge'
      and created_at::date = current_date
  ) into v_already_nudged;

  if v_already_nudged then
    return jsonb_build_object('success', false, 'error', 'already_nudged_today');
  end if;

  insert into messages (conversation_id, sender_id, message_type)
  values (v_convo_id, v_caller, 'nudge');

  return jsonb_build_object('success', true, 'conversation_id', v_convo_id);
end;
$$;

-- ─── send_team_message ───
create or replace function send_team_message(p_message_key text)
returns jsonb
language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
  v_team_id uuid;
  v_convo_id uuid;
  v_member record;
begin
  if v_caller is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select team_id into v_team_id from profiles where id = v_caller;
  if v_team_id is null then
    return jsonb_build_object('success', false, 'error', 'no_team');
  end if;

  -- Find existing team conversation
  select id into v_convo_id from conversations
  where type = 'team' and team_id = v_team_id;

  -- Create if not exists
  if v_convo_id is null then
    insert into conversations (type, team_id) values ('team', v_team_id)
    returning id into v_convo_id;

    -- Add all current team members
    for v_member in
      select id from profiles where team_id = v_team_id
    loop
      insert into conversation_participants (conversation_id, user_id)
      values (v_convo_id, v_member.id)
      on conflict (conversation_id, user_id) do nothing;
    end loop;
  end if;

  insert into messages (conversation_id, sender_id, message_type, message_key)
  values (v_convo_id, v_caller, 'preset', p_message_key);

  return jsonb_build_object('success', true, 'conversation_id', v_convo_id);
end;
$$;

-- ─── get_inbox ───
create or replace function get_inbox()
returns jsonb
language plpgsql security definer stable as $$
declare
  v_caller uuid := auth.uid();
  v_result jsonb := '[]'::jsonb;
  v_row record;
begin
  if v_caller is null then
    return '[]'::jsonb;
  end if;

  for v_row in
    with my_convos as (
      select cp.conversation_id, cp.last_read_at, cp.joined_at
      from conversation_participants cp
      where cp.user_id = v_caller
    ),
    last_msgs as (
      select distinct on (m.conversation_id)
        m.conversation_id,
        m.id as message_id,
        m.message_type,
        m.message_key,
        m.body,
        m.sender_id,
        m.created_at,
        p.name as sender_name
      from messages m
      join my_convos mc on mc.conversation_id = m.conversation_id
      join profiles p on p.id = m.sender_id
      where m.created_at >= mc.joined_at
      order by m.conversation_id, m.created_at desc
    ),
    unread_counts as (
      select mc.conversation_id,
        count(*) filter (where m.created_at > mc.last_read_at and m.created_at >= mc.joined_at) as unread
      from my_convos mc
      left join messages m on m.conversation_id = mc.conversation_id
      group by mc.conversation_id
    )
    select
      c.id as conversation_id,
      c.type,
      c.team_id,
      lm.message_type,
      lm.message_key,
      lm.body,
      lm.sender_id,
      lm.sender_name,
      lm.created_at as last_message_at,
      coalesce(uc.unread, 0) as unread_count,
      -- DM: other participant info
      case when c.type = 'dm' then (
        select jsonb_build_object(
          'user_id', op.id,
          'name', op.name,
          'avatar_url', op.avatar_url
        )
        from conversation_participants ocp
        join profiles op on op.id = ocp.user_id
        where ocp.conversation_id = c.id and ocp.user_id != v_caller
        limit 1
      ) end as other_user,
      -- Team: team info
      case when c.type = 'team' then (
        select jsonb_build_object(
          'team_name', t.name,
          'member_count', (select count(*) from profiles where team_id = t.id)
        )
        from teams t where t.id = c.team_id
      ) end as team_info
    from conversations c
    join my_convos mc on mc.conversation_id = c.id
    left join last_msgs lm on lm.conversation_id = c.id
    left join unread_counts uc on uc.conversation_id = c.id
    where lm.message_id is not null  -- only convos with at least one message
      -- Exclude DM convos where other user is blocked by caller
      and not (
        c.type = 'dm'
        and exists (
          select 1
          from conversation_participants ocp
          join blocks b on b.blocker_id = v_caller and b.blocked_id = ocp.user_id
          where ocp.conversation_id = c.id and ocp.user_id != v_caller
        )
      )
    order by lm.created_at desc
  loop
    v_result := v_result || jsonb_build_object(
      'conversation_id', v_row.conversation_id,
      'type', v_row.type,
      'team_id', v_row.team_id,
      'last_message', jsonb_build_object(
        'message_type', v_row.message_type,
        'message_key', v_row.message_key,
        'body', v_row.body,
        'sender_id', v_row.sender_id,
        'sender_name', v_row.sender_name,
        'created_at', v_row.last_message_at
      ),
      'unread_count', v_row.unread_count,
      'other_user', v_row.other_user,
      'team_info', v_row.team_info
    );
  end loop;

  return v_result;
end;
$$;

-- ─── get_conversation_messages ───
create or replace function get_conversation_messages(
  p_conversation_id uuid,
  p_limit int default 50,
  p_before timestamptz default null
)
returns jsonb
language plpgsql security definer stable as $$
declare
  v_caller uuid := auth.uid();
  v_joined_at timestamptz;
  v_convo_type text;
  v_result jsonb := '[]'::jsonb;
  v_row record;
begin
  if v_caller is null then
    return '[]'::jsonb;
  end if;

  -- Validate caller is participant
  select cp.joined_at, c.type
  into v_joined_at, v_convo_type
  from conversation_participants cp
  join conversations c on c.id = cp.conversation_id
  where cp.conversation_id = p_conversation_id and cp.user_id = v_caller;

  if v_joined_at is null then
    return '[]'::jsonb;
  end if;

  for v_row in
    select
      m.id,
      m.conversation_id,
      m.sender_id,
      m.message_type,
      m.message_key,
      m.body,
      m.created_at,
      p.name as sender_name,
      p.avatar_url as sender_avatar_url
    from messages m
    join profiles p on p.id = m.sender_id
    where m.conversation_id = p_conversation_id
      and m.created_at >= v_joined_at
      and (p_before is null or m.created_at < p_before)
    order by m.created_at desc
    limit p_limit
  loop
    v_result := v_result || jsonb_build_object(
      'id', v_row.id,
      'conversation_id', v_row.conversation_id,
      'sender_id', v_row.sender_id,
      'message_type', v_row.message_type,
      'message_key', v_row.message_key,
      'body', v_row.body,
      'created_at', v_row.created_at,
      'sender_name', v_row.sender_name,
      'sender_avatar_url', v_row.sender_avatar_url
    );
  end loop;

  return v_result;
end;
$$;

-- ─── mark_read ───
create or replace function mark_read(p_conversation_id uuid)
returns jsonb
language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return jsonb_build_object('success', false);
  end if;

  update conversation_participants
  set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = v_caller;

  return jsonb_build_object('success', true);
end;
$$;

-- ─── get_unread_count ───
create or replace function get_unread_count()
returns jsonb
language plpgsql security definer stable as $$
declare
  v_caller uuid := auth.uid();
  v_count int;
begin
  if v_caller is null then
    return jsonb_build_object('count', 0);
  end if;

  select count(distinct cp.conversation_id) into v_count
  from conversation_participants cp
  join conversations c on c.id = cp.conversation_id
  where cp.user_id = v_caller
    and exists (
      select 1 from messages m
      where m.conversation_id = cp.conversation_id
        and m.created_at > cp.last_read_at
        and m.created_at >= cp.joined_at
    )
    -- Exclude blocked DMs
    and not (
      c.type = 'dm'
      and exists (
        select 1
        from conversation_participants ocp
        join blocks b on b.blocker_id = v_caller and b.blocked_id = ocp.user_id
        where ocp.conversation_id = cp.conversation_id and ocp.user_id != v_caller
      )
    );

  return jsonb_build_object('count', v_count);
end;
$$;

-- ─── block_user ───
create or replace function block_user(p_user_id uuid)
returns jsonb
language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if v_caller = p_user_id then
    return jsonb_build_object('success', false, 'error', 'cannot_block_self');
  end if;

  insert into blocks (blocker_id, blocked_id)
  values (v_caller, p_user_id)
  on conflict (blocker_id, blocked_id) do nothing;

  return jsonb_build_object('success', true);
end;
$$;

-- ─── unblock_user ───
create or replace function unblock_user(p_user_id uuid)
returns jsonb
language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  delete from blocks where blocker_id = v_caller and blocked_id = p_user_id;

  return jsonb_build_object('success', true);
end;
$$;

-- ─── get_public_profile ───
create or replace function get_public_profile(p_user_id uuid)
returns jsonb
language plpgsql security definer stable as $$
declare
  v_caller uuid := auth.uid();
  v_profile record;
  v_total_reps bigint;
  v_streak int := 0;
  v_rep_score numeric := 0;
  v_team_name text;
  v_nudged_today boolean := false;
  v_is_blocked boolean := false;
  v_check_date date;
begin
  -- Fetch profile
  select id, name, avatar_url, gender, created_at, team_id
  into v_profile
  from profiles where id = p_user_id;

  if v_profile.id is null then
    return jsonb_build_object('success', false, 'error', 'user_not_found');
  end if;

  -- Total reps
  select count(*) into v_total_reps from reps where user_id = p_user_id;

  -- Current streak: count backward from today
  v_check_date := current_date;
  loop
    if exists (
      select 1 from reps
      where user_id = p_user_id
        and validated_at::date = v_check_date
    ) then
      v_streak := v_streak + 1;
      v_check_date := v_check_date - 1;
    else
      exit;
    end if;
  end loop;

  -- Rep Score (use calculate_user_rep_score if available)
  begin
    select (r.score)::numeric into v_rep_score
    from calculate_user_rep_score(p_user_id, 'all') r;
  exception when others then
    v_rep_score := v_total_reps;
  end;

  -- Team name
  if v_profile.team_id is not null then
    select name into v_team_name from teams where id = v_profile.team_id;
  end if;

  -- Nudged today check
  if v_caller is not null and v_caller != p_user_id then
    select exists(
      select 1 from messages m
      join conversation_participants cp1 on cp1.conversation_id = m.conversation_id and cp1.user_id = v_caller
      join conversation_participants cp2 on cp2.conversation_id = m.conversation_id and cp2.user_id = p_user_id
      join conversations c on c.id = m.conversation_id and c.type = 'dm'
      where m.sender_id = v_caller
        and m.message_type = 'nudge'
        and m.created_at::date = current_date
    ) into v_nudged_today;

    select exists(select 1 from blocks where blocker_id = v_caller and blocked_id = p_user_id)
    into v_is_blocked;
  end if;

  return jsonb_build_object(
    'success', true,
    'user_id', v_profile.id,
    'name', v_profile.name,
    'avatar_url', v_profile.avatar_url,
    'gender', case when v_profile.gender != 'unspecified' then v_profile.gender else null end,
    'created_at', v_profile.created_at,
    'total_reps', v_total_reps,
    'streak', v_streak,
    'rep_score', v_rep_score,
    'team_id', v_profile.team_id,
    'team_name', v_team_name,
    'nudged_today', v_nudged_today,
    'is_blocked', v_is_blocked
  );
end;
$$;
