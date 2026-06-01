-- ============================================================
-- 020_event_rpcs.sql — Phase 14: Event RPCs
--   create_event, announce_event, join_event, leave_event,
--   get_event_leaderboard, get_event_progress,
--   complete_event, feature_event
-- ============================================================


-- ============================================================
-- 1. create_event(params)
--    Validate all params, generate 6-char join code,
--    insert event, auto-add creator as first participant.
--    For team events, validate creator has an active team.
-- ============================================================

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
  p_banner_url text default null
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
    'team_most', 'team_target', 'team_vs_team'
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
    status, created_by
  ) values (
    trim(p_name), p_description, p_banner_url, p_category, p_competition_mode,
    p_target_reps, p_scoring_method, p_visibility, v_join_code,
    p_prize_type, p_prize_description, p_max_participants, p_max_teams,
    p_allow_late_join, p_retroactive_reps, p_starts_at, p_ends_at,
    'draft', v_user_id
  )
  returning id into v_event_id;

  -- Auto-add creator as first participant
  if v_is_team_mode then
    -- Enroll all team members
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


-- ============================================================
-- 2. announce_event(p_event_id)
--    Move draft → announced. Only creator.
--    Validate required fields are set.
-- ============================================================

create or replace function announce_event(p_event_id uuid)
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

  if v_event.status != 'draft' then
    return jsonb_build_object('success', false, 'error', 'not_draft',
      'message', 'Event must be in draft status to announce');
  end if;

  -- Validate required fields are present
  if v_event.name is null or char_length(v_event.name) < 3 then
    return jsonb_build_object('success', false, 'error', 'missing_name');
  end if;

  if v_event.starts_at is null or v_event.ends_at is null then
    return jsonb_build_object('success', false, 'error', 'missing_timing');
  end if;

  if v_event.competition_mode in ('global_target', 'individual_target', 'team_target')
     and (v_event.target_reps is null or v_event.target_reps <= 0) then
    return jsonb_build_object('success', false, 'error', 'missing_target',
      'message', 'Target reps required for target-based competition modes');
  end if;

  update events set status = 'announced' where id = p_event_id;

  return jsonb_build_object('success', true, 'status', 'announced');
end;
$$;


-- ============================================================
-- 3. join_event(p_join_code)
--    Validate event is announced/active, not full, user not
--    already in. For team events: validate user has active team,
--    enroll all team members.
-- ============================================================

create or replace function join_event(p_join_code text)
returns jsonb
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_event record;
  v_is_team_mode boolean;
  v_team_id uuid;
  v_team_status text;
  v_participant_count int;
  v_team_count int;
  v_already_in boolean;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_event
  from events where join_code = upper(trim(p_join_code));

  if v_event is null then
    return jsonb_build_object('success', false, 'error', 'event_not_found');
  end if;

  -- Must be announced or active
  if v_event.status not in ('announced', 'active') then
    return jsonb_build_object('success', false, 'error', 'event_not_joinable',
      'message', 'This event is not currently accepting participants');
  end if;

  -- If active, check allow_late_join
  if v_event.status = 'active' and not v_event.allow_late_join then
    return jsonb_build_object('success', false, 'error', 'late_join_disabled',
      'message', 'This event does not allow late joins');
  end if;

  -- Check if user is already a participant
  select exists(
    select 1 from event_participants
    where event_id = v_event.id and user_id = v_user_id and status = 'active'
  ) into v_already_in;

  if v_already_in then
    return jsonb_build_object('success', false, 'error', 'already_joined');
  end if;

  v_is_team_mode := v_event.competition_mode in ('team_most', 'team_target', 'team_vs_team');

  if v_is_team_mode then
    -- Validate user has an active team
    select p.team_id into v_team_id from profiles p where p.id = v_user_id;
    if v_team_id is null then
      return jsonb_build_object('success', false, 'error', 'no_team',
        'message', 'You must be on an active team to join a team event');
    end if;

    select t.status into v_team_status from teams t where t.id = v_team_id;
    if v_team_status != 'active' then
      return jsonb_build_object('success', false, 'error', 'team_not_active',
        'message', 'Your team must be active (3 members) to join a team event');
    end if;

    -- Check max_teams limit
    if v_event.max_teams is not null then
      select count(distinct ep.team_id) into v_team_count
      from event_participants ep
      where ep.event_id = v_event.id and ep.status = 'active' and ep.team_id is not null;

      if v_team_count >= v_event.max_teams then
        return jsonb_build_object('success', false, 'error', 'event_full',
          'message', 'This event has reached its team limit');
      end if;
    end if;

    -- team_vs_team: exactly 2 teams allowed
    if v_event.competition_mode = 'team_vs_team' then
      select count(distinct ep.team_id) into v_team_count
      from event_participants ep
      where ep.event_id = v_event.id and ep.status = 'active' and ep.team_id is not null;

      if v_team_count >= 2 then
        return jsonb_build_object('success', false, 'error', 'event_full',
          'message', 'Team vs Team events are limited to 2 teams');
      end if;
    end if;

    -- Enroll all team members (upsert in case some were previously withdrawn)
    insert into event_participants (event_id, user_id, team_id, status)
    select v_event.id, p.id, v_team_id, 'active'
    from profiles p
    where p.team_id = v_team_id
    on conflict (event_id, user_id)
    do update set status = 'active', team_id = v_team_id, joined_at = now();

  else
    -- Individual mode: check max_participants
    if v_event.max_participants is not null then
      select count(*) into v_participant_count
      from event_participants
      where event_id = v_event.id and status = 'active';

      if v_participant_count >= v_event.max_participants then
        return jsonb_build_object('success', false, 'error', 'event_full',
          'message', 'This event has reached its participant limit');
      end if;
    end if;

    -- Upsert participant (re-activate if previously withdrawn)
    insert into event_participants (event_id, user_id, status)
    values (v_event.id, v_user_id, 'active')
    on conflict (event_id, user_id)
    do update set status = 'active', joined_at = now();
  end if;

  return jsonb_build_object(
    'success', true,
    'event_id', v_event.id,
    'event_name', v_event.name
  );
end;
$$;


-- ============================================================
-- 4. leave_event(p_event_id)
--    Set participant status to 'withdrawn'.
--    For team events, withdraw all team members.
-- ============================================================

create or replace function leave_event(p_event_id uuid)
returns jsonb
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_event record;
  v_participant record;
  v_is_team_mode boolean;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_event from events where id = p_event_id;

  if v_event is null then
    return jsonb_build_object('success', false, 'error', 'event_not_found');
  end if;

  -- Can only leave announced or active events
  if v_event.status not in ('announced', 'active') then
    return jsonb_build_object('success', false, 'error', 'event_not_leavable',
      'message', 'Cannot leave a completed or archived event');
  end if;

  select * into v_participant
  from event_participants
  where event_id = p_event_id and user_id = v_user_id and status = 'active';

  if v_participant is null then
    return jsonb_build_object('success', false, 'error', 'not_participant');
  end if;

  v_is_team_mode := v_event.competition_mode in ('team_most', 'team_target', 'team_vs_team');

  if v_is_team_mode and v_participant.team_id is not null then
    -- Withdraw all team members
    update event_participants
    set status = 'withdrawn'
    where event_id = p_event_id
      and team_id = v_participant.team_id
      and status = 'active';
  else
    update event_participants
    set status = 'withdrawn'
    where event_id = p_event_id and user_id = v_user_id;
  end if;

  return jsonb_build_object('success', true);
end;
$$;


-- ============================================================
-- 5. get_event_leaderboard(p_event_id, p_limit)
--    Query reps table filtered by event window + participants.
--    Handle all 6 competition modes.
--    Return top N + caller's position.
-- ============================================================

create or replace function get_event_leaderboard(
  p_event_id uuid,
  p_limit int default 50
)
returns jsonb
language plpgsql stable security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_event record;
  v_is_team_mode boolean;
  v_leaderboard jsonb;
  v_caller_entry jsonb;
  v_caller_rank int;
  v_caller_reps bigint;
  v_caller_team_id uuid;
begin
  select * into v_event from events where id = p_event_id;
  if v_event is null then
    return jsonb_build_object('success', false, 'error', 'event_not_found');
  end if;

  v_is_team_mode := v_event.competition_mode in ('team_most', 'team_target', 'team_vs_team');

  if v_is_team_mode then
    -- ---- Team leaderboard ----
    -- Aggregate reps by team
    with team_reps as (
      select
        ep.team_id,
        t.name as team_name,
        sum(case
          when v_event.retroactive_reps then
            (select count(*) from reps r
             where r.user_id = ep.user_id
               and r.validated_at >= v_event.starts_at
               and r.validated_at <= coalesce(
                 case when v_event.status = 'completed' then v_event.ends_at else now() end,
                 now()))
          else
            (select count(*) from reps r
             where r.user_id = ep.user_id
               and r.validated_at >= ep.joined_at
               and r.validated_at <= coalesce(
                 case when v_event.status = 'completed' then v_event.ends_at else now() end,
                 now()))
        end)::bigint as total_reps
      from event_participants ep
      join teams t on t.id = ep.team_id
      where ep.event_id = p_event_id
        and ep.status = 'active'
        and ep.team_id is not null
      group by ep.team_id, t.name
    ),
    ranked as (
      select
        team_id, team_name, total_reps,
        row_number() over (order by total_reps desc, team_id) as rank
      from team_reps
    )
    select jsonb_agg(
      jsonb_build_object(
        'team_id', team_id,
        'team_name', team_name,
        'total_reps', total_reps,
        'rank', rank
      ) order by rank
    )
    into v_leaderboard
    from ranked
    where rank <= p_limit;

    -- Caller's team position
    if v_user_id is not null then
      select p.team_id into v_caller_team_id from profiles p where p.id = v_user_id;
      if v_caller_team_id is not null then
        with team_reps as (
          select
            ep.team_id,
            sum(case
              when v_event.retroactive_reps then
                (select count(*) from reps r
                 where r.user_id = ep.user_id
                   and r.validated_at >= v_event.starts_at
                   and r.validated_at <= coalesce(
                     case when v_event.status = 'completed' then v_event.ends_at else now() end,
                     now()))
              else
                (select count(*) from reps r
                 where r.user_id = ep.user_id
                   and r.validated_at >= ep.joined_at
                   and r.validated_at <= coalesce(
                     case when v_event.status = 'completed' then v_event.ends_at else now() end,
                     now()))
            end)::bigint as total_reps
          from event_participants ep
          where ep.event_id = p_event_id
            and ep.status = 'active'
            and ep.team_id is not null
          group by ep.team_id
        ),
        ranked as (
          select team_id, total_reps,
            row_number() over (order by total_reps desc, team_id) as rank
          from team_reps
        )
        select rank, total_reps into v_caller_rank, v_caller_reps
        from ranked where team_id = v_caller_team_id;
      end if;
    end if;

  else
    -- ---- Individual leaderboard ----
    if v_event.scoring_method = 'rep_score' then
      -- Use the full scoring engine
      with participant_scores as (
        select
          ep.user_id,
          pr.name as user_name,
          pr.avatar_url,
          (calculate_user_rep_score(ep.user_id, 'all')->>'score')::bigint as total_reps
        from event_participants ep
        join profiles pr on pr.id = ep.user_id
        where ep.event_id = p_event_id and ep.status = 'active'
      ),
      ranked as (
        select user_id, user_name, avatar_url, total_reps,
          row_number() over (order by total_reps desc, user_id) as rank
        from participant_scores
      )
      select jsonb_agg(
        jsonb_build_object(
          'user_id', user_id,
          'user_name', user_name,
          'avatar_url', avatar_url,
          'total_reps', total_reps,
          'rank', rank
        ) order by rank
      )
      into v_leaderboard
      from ranked
      where rank <= p_limit;

      -- Caller position
      if v_user_id is not null then
        with participant_scores as (
          select
            ep.user_id,
            (calculate_user_rep_score(ep.user_id, 'all')->>'score')::bigint as total_reps
          from event_participants ep
          where ep.event_id = p_event_id and ep.status = 'active'
        ),
        ranked as (
          select user_id, total_reps,
            row_number() over (order by total_reps desc, user_id) as rank
          from participant_scores
        )
        select rank, total_reps into v_caller_rank, v_caller_reps
        from ranked where user_id = v_user_id;
      end if;

    else
      -- raw_reps mode
      with participant_reps as (
        select
          ep.user_id,
          pr.name as user_name,
          pr.avatar_url,
          (select count(*) from reps r
           where r.user_id = ep.user_id
             and r.validated_at >= case
               when v_event.retroactive_reps then v_event.starts_at
               else ep.joined_at
             end
             and r.validated_at <= coalesce(
               case when v_event.status = 'completed' then v_event.ends_at else now() end,
               now())
          )::bigint as total_reps
        from event_participants ep
        join profiles pr on pr.id = ep.user_id
        where ep.event_id = p_event_id and ep.status = 'active'
      ),
      ranked as (
        select user_id, user_name, avatar_url, total_reps,
          row_number() over (order by total_reps desc, user_id) as rank
        from participant_reps
      )
      select jsonb_agg(
        jsonb_build_object(
          'user_id', user_id,
          'user_name', user_name,
          'avatar_url', avatar_url,
          'total_reps', total_reps,
          'rank', rank
        ) order by rank
      )
      into v_leaderboard
      from ranked
      where rank <= p_limit;

      -- Caller position
      if v_user_id is not null then
        with participant_reps as (
          select
            ep.user_id,
            (select count(*) from reps r
             where r.user_id = ep.user_id
               and r.validated_at >= case
                 when v_event.retroactive_reps then v_event.starts_at
                 else ep.joined_at
               end
               and r.validated_at <= coalesce(
                 case when v_event.status = 'completed' then v_event.ends_at else now() end,
                 now())
            )::bigint as total_reps
          from event_participants ep
          where ep.event_id = p_event_id and ep.status = 'active'
        ),
        ranked as (
          select user_id, total_reps,
            row_number() over (order by total_reps desc, user_id) as rank
          from participant_reps
        )
        select rank, total_reps into v_caller_rank, v_caller_reps
        from ranked where user_id = v_user_id;
      end if;
    end if;
  end if;

  v_caller_entry := null;
  if v_caller_rank is not null then
    v_caller_entry := jsonb_build_object(
      'rank', v_caller_rank,
      'total_reps', v_caller_reps
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'competition_mode', v_event.competition_mode,
    'scoring_method', v_event.scoring_method,
    'leaderboard', coalesce(v_leaderboard, '[]'::jsonb),
    'caller', v_caller_entry
  );
end;
$$;


-- ============================================================
-- 6. get_event_progress(p_event_id)
--    For target modes: total reps toward target, percentage.
--    For ranked modes: top 3 + total participants.
-- ============================================================

create or replace function get_event_progress(p_event_id uuid)
returns jsonb
language plpgsql stable security definer
as $$
declare
  v_event record;
  v_total_reps bigint := 0;
  v_participant_count int := 0;
  v_team_count int := 0;
  v_top3 jsonb;
  v_is_team_mode boolean;
  v_is_target_mode boolean;
  v_end_boundary timestamptz;
begin
  select * into v_event from events where id = p_event_id;
  if v_event is null then
    return jsonb_build_object('success', false, 'error', 'event_not_found');
  end if;

  v_is_team_mode := v_event.competition_mode in ('team_most', 'team_target', 'team_vs_team');
  v_is_target_mode := v_event.competition_mode in ('global_target', 'individual_target', 'team_target');

  v_end_boundary := case
    when v_event.status = 'completed' then v_event.ends_at
    else least(now(), v_event.ends_at)
  end;

  -- Total active participants
  select count(*) into v_participant_count
  from event_participants where event_id = p_event_id and status = 'active';

  -- Total active teams
  if v_is_team_mode then
    select count(distinct team_id) into v_team_count
    from event_participants
    where event_id = p_event_id and status = 'active' and team_id is not null;
  end if;

  -- Total reps across all active participants
  select coalesce(sum(sub.reps), 0) into v_total_reps
  from (
    select
      (select count(*) from reps r
       where r.user_id = ep.user_id
         and r.validated_at >= case
           when v_event.retroactive_reps then v_event.starts_at
           else ep.joined_at
         end
         and r.validated_at <= v_end_boundary
      ) as reps
    from event_participants ep
    where ep.event_id = p_event_id and ep.status = 'active'
  ) sub;

  if v_is_target_mode then
    -- Return progress toward target
    return jsonb_build_object(
      'success', true,
      'competition_mode', v_event.competition_mode,
      'total_reps', v_total_reps,
      'target_reps', v_event.target_reps,
      'percentage', case
        when v_event.target_reps > 0
        then round((v_total_reps::numeric / v_event.target_reps) * 100, 1)
        else 0
      end,
      'participant_count', v_participant_count,
      'team_count', v_team_count
    );
  end if;

  -- Ranked modes: return top 3 + counts
  if v_is_team_mode then
    with team_reps as (
      select
        ep.team_id,
        t.name as team_name,
        sum(
          (select count(*) from reps r
           where r.user_id = ep.user_id
             and r.validated_at >= case
               when v_event.retroactive_reps then v_event.starts_at
               else ep.joined_at
             end
             and r.validated_at <= v_end_boundary)
        )::bigint as total_reps
      from event_participants ep
      join teams t on t.id = ep.team_id
      where ep.event_id = p_event_id
        and ep.status = 'active'
        and ep.team_id is not null
      group by ep.team_id, t.name
      order by total_reps desc
      limit 3
    )
    select jsonb_agg(jsonb_build_object(
      'team_id', team_id, 'team_name', team_name, 'total_reps', total_reps
    ))
    into v_top3
    from team_reps;
  else
    with user_reps as (
      select
        ep.user_id,
        pr.name as user_name,
        pr.avatar_url,
        (select count(*) from reps r
         where r.user_id = ep.user_id
           and r.validated_at >= case
             when v_event.retroactive_reps then v_event.starts_at
             else ep.joined_at
           end
           and r.validated_at <= v_end_boundary
        )::bigint as total_reps
      from event_participants ep
      join profiles pr on pr.id = ep.user_id
      where ep.event_id = p_event_id and ep.status = 'active'
      order by total_reps desc
      limit 3
    )
    select jsonb_agg(jsonb_build_object(
      'user_id', user_id, 'user_name', user_name,
      'avatar_url', avatar_url, 'total_reps', total_reps
    ))
    into v_top3
    from user_reps;
  end if;

  return jsonb_build_object(
    'success', true,
    'competition_mode', v_event.competition_mode,
    'total_reps', v_total_reps,
    'top3', coalesce(v_top3, '[]'::jsonb),
    'participant_count', v_participant_count,
    'team_count', v_team_count
  );
end;
$$;


-- ============================================================
-- 7. complete_event(p_event_id)
--    Called by creator or auto when past ends_at.
--    Materialize rankings into event_results, declare winners.
-- ============================================================

create or replace function complete_event(p_event_id uuid)
returns jsonb
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_event record;
  v_is_team_mode boolean;
  v_end_boundary timestamptz;
  v_already_completed boolean;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_event from events where id = p_event_id;
  if v_event is null then
    return jsonb_build_object('success', false, 'error', 'event_not_found');
  end if;

  -- Only creator can manually complete, or anyone can trigger auto-complete past ends_at
  if v_event.created_by != v_user_id and now() < v_event.ends_at then
    return jsonb_build_object('success', false, 'error', 'not_authorized',
      'message', 'Only the event creator can complete an event before it ends');
  end if;

  if v_event.status not in ('announced', 'active') then
    return jsonb_build_object('success', false, 'error', 'not_completable',
      'message', 'Event must be announced or active to complete');
  end if;

  -- Check if results already exist (idempotency)
  select exists(select 1 from event_results where event_id = p_event_id)
  into v_already_completed;
  if v_already_completed then
    update events set status = 'completed' where id = p_event_id;
    return jsonb_build_object('success', true, 'status', 'completed', 'note', 'already_materialized');
  end if;

  v_is_team_mode := v_event.competition_mode in ('team_most', 'team_target', 'team_vs_team');
  v_end_boundary := v_event.ends_at;

  if v_is_team_mode then
    -- Materialize team results
    with team_reps as (
      select
        ep.team_id,
        sum(
          (select count(*) from reps r
           where r.user_id = ep.user_id
             and r.validated_at >= case
               when v_event.retroactive_reps then v_event.starts_at
               else ep.joined_at
             end
             and r.validated_at <= v_end_boundary)
        )::int as final_reps
      from event_participants ep
      where ep.event_id = p_event_id
        and ep.status = 'active'
        and ep.team_id is not null
      group by ep.team_id
    ),
    ranked as (
      select
        team_id, final_reps,
        row_number() over (order by final_reps desc, team_id) as rank
      from team_reps
    )
    insert into event_results (event_id, team_id, final_reps, rank, is_winner)
    select
      p_event_id,
      team_id,
      final_reps,
      rank::int,
      case
        when v_event.competition_mode = 'team_target' and final_reps >= v_event.target_reps then true
        when v_event.competition_mode in ('team_most', 'team_vs_team') and rank = 1 then true
        else false
      end
    from ranked;

  else
    -- Materialize individual results
    if v_event.scoring_method = 'rep_score' then
      with participant_scores as (
        select
          ep.user_id,
          (calculate_user_rep_score(ep.user_id, 'all')->>'score')::int as final_score,
          (select count(*) from reps r
           where r.user_id = ep.user_id
             and r.validated_at >= case
               when v_event.retroactive_reps then v_event.starts_at
               else ep.joined_at
             end
             and r.validated_at <= v_end_boundary)::int as final_reps
        from event_participants ep
        where ep.event_id = p_event_id and ep.status = 'active'
      ),
      ranked as (
        select user_id, final_reps, final_score,
          row_number() over (order by final_score desc, user_id) as rank
        from participant_scores
      )
      insert into event_results (event_id, user_id, final_reps, final_score, rank, is_winner)
      select
        p_event_id, user_id, final_reps, final_score, rank::int,
        case
          when v_event.competition_mode = 'individual_target' and final_score >= v_event.target_reps then true
          when v_event.competition_mode in ('individual_most', 'global_target') and rank = 1 then true
          else false
        end
      from ranked;

    else
      -- raw_reps scoring
      with participant_reps as (
        select
          ep.user_id,
          (select count(*) from reps r
           where r.user_id = ep.user_id
             and r.validated_at >= case
               when v_event.retroactive_reps then v_event.starts_at
               else ep.joined_at
             end
             and r.validated_at <= v_end_boundary)::int as final_reps
        from event_participants ep
        where ep.event_id = p_event_id and ep.status = 'active'
      ),
      ranked as (
        select user_id, final_reps,
          row_number() over (order by final_reps desc, user_id) as rank
        from participant_reps
      )
      insert into event_results (event_id, user_id, final_reps, rank, is_winner)
      select
        p_event_id, user_id, final_reps, rank::int,
        case
          when v_event.competition_mode = 'global_target' then
            -- Global target: everyone wins if collective target reached
            (select sum(pr.final_reps) >= v_event.target_reps
             from (select final_reps from participant_reps) pr)
          when v_event.competition_mode = 'individual_target' and final_reps >= v_event.target_reps then true
          when v_event.competition_mode = 'individual_most' and rank = 1 then true
          else false
        end
      from ranked;
    end if;
  end if;

  update events set status = 'completed' where id = p_event_id;

  return jsonb_build_object('success', true, 'status', 'completed');
end;
$$;


-- ============================================================
-- 8. feature_event(p_event_id)
--    Unfeature any current featured event, feature this one.
--    Official events only.
-- ============================================================

create or replace function feature_event(p_event_id uuid)
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

  if v_event.category != 'official' then
    return jsonb_build_object('success', false, 'error', 'not_official',
      'message', 'Only official events can be featured');
  end if;

  -- Unfeature all currently featured events
  update events set is_featured = false where is_featured = true;

  -- Feature this one
  update events set is_featured = true where id = p_event_id;

  return jsonb_build_object('success', true, 'event_id', p_event_id);
end;
$$;
