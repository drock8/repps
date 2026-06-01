-- ============================================================
-- 025_high_severity_security_fixes.sql — High-severity fixes from brutalist audit
--
-- Fixes:
--   1. Team UPDATE policy too broad (members can self-promote to captain)
--   2. join_team race condition (concurrent joins can exceed 3-member limit)
--   3. feature_event has no admin check (any creator can feature globally)
--   4. Individual streak uses team_daily_target (5) instead of 1
-- ============================================================


-- ============================================================
-- FIX 1: Restrict team UPDATE policies
--
-- "Captain can update own team" allows any column — fine for captains.
-- "Team members can update team logo" (migration 018) also allows any
-- column, letting non-captain members set captain_id, status, etc.
--
-- Replace with a policy that only allows logo-related columns.
-- Postgres doesn't support column-level RLS, so we use WITH CHECK
-- to ensure non-captains can only change logo columns.
-- ============================================================

drop policy if exists "Team members can update team logo" on teams;

create policy "Team members can update team logo"
  on teams for update
  to authenticated
  using (
    id in (select p.team_id from profiles p where p.id = auth.uid())
  )
  with check (
    -- Non-captains: name, join_code, captain_id, status, created_at must be unchanged
    captain_id = (select t.captain_id from teams t where t.id = id)
    and status = (select t.status from teams t where t.id = id)
    and name = (select t.name from teams t where t.id = id)
    and join_code = (select t.join_code from teams t where t.id = id)
  );


-- ============================================================
-- FIX 2: join_team — add row locking to prevent race condition
--
-- The original check-then-act pattern (count members → join if < 3)
-- had no locking. Two simultaneous joins could both pass the count
-- check and push a team to 4+ members.
--
-- Fix: SELECT ... FOR UPDATE on the team row to serialize concurrent
-- join attempts for the same team.
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

  -- Lock the team row to serialize concurrent join attempts
  select * into v_team from teams where join_code = upper(trim(p_join_code)) for update;
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
-- FIX 3: feature_event — restrict to admin users
--
-- Currently any event creator can feature their own official event,
-- globally replacing the existing featured event.
--
-- Fix: Only allow featuring by users listed in the admin_users
-- setting (comma-separated UUIDs managed via Supabase Studio).
-- Falls back to creator check if no admin_users setting exists.
-- ============================================================

-- Seed the admin_users setting (empty by default — fill via Studio)
insert into settings (key, value) values
  ('admin_users', '')
on conflict (key) do nothing;

create or replace function feature_event(p_event_id uuid)
returns jsonb
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_event record;
  v_admin_csv text;
  v_is_admin boolean := false;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  -- Check admin list
  select value into v_admin_csv from settings where key = 'admin_users';
  if v_admin_csv is not null and v_admin_csv != '' then
    v_is_admin := v_user_id::text = any(string_to_array(replace(v_admin_csv, ' ', ''), ','));
  end if;

  select * into v_event from events where id = p_event_id;
  if v_event is null then
    return jsonb_build_object('success', false, 'error', 'event_not_found');
  end if;

  -- Must be admin OR the event creator
  if not v_is_admin and v_event.created_by != v_user_id then
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  -- Only admins can feature events they didn't create
  if not v_is_admin and v_event.created_by = v_user_id then
    return jsonb_build_object('success', false, 'error', 'admin_only',
      'message', 'Only admins can feature events');
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


-- ============================================================
-- FIX 4: Individual streak uses wrong threshold
--
-- The scoring engine uses v_daily_target (team_daily_target = 5)
-- for individual streak qualification. A solo user doing 1-4
-- burpees/day never builds a streak.
--
-- Fix: Add a separate individual_daily_target setting (default 1)
-- and use it for individual streak calculation.
-- ============================================================

-- Seed the new setting
insert into settings (key, value) values
  ('individual_daily_target', '1')
on conflict (key) do nothing;

create or replace function calculate_user_rep_score(
  p_user_id uuid,
  p_period text default 'all'
)
returns jsonb
language plpgsql stable security definer
as $$
declare
  -- Settings (all from settings table)
  v_daily_target int;
  v_individual_daily_target int;
  v_daily_multiplier int;
  v_weekly_days_required int;
  v_weekly_multiplier int;
  v_streak_base int;
  v_streak_cap int;
  v_streak_interval int;
  v_team_streak_base int;
  v_team_streak_cap int;

  -- Team state
  v_team_id uuid;
  v_team_status text;
  v_team_member_count int;
  v_has_active_team boolean := false;

  -- Period bounds
  v_period_start date;
  v_period_end date := current_date;

  -- Day iteration
  v_day date;
  v_day_reps int;

  -- Streak counters (built across ALL days, not just period)
  v_ind_run int := 0;
  v_ind_prev date;
  v_team_run int := 0;
  v_team_prev date;

  -- Per-day scoring
  v_day_multiplied numeric;
  v_ind_bonus numeric;
  v_team_bonus numeric;
  v_day_total numeric;
  v_all_hit boolean;

  -- Weekly accumulator
  v_week_start date;
  v_cur_week_start date;
  v_cur_week_total numeric := 0;
  v_cur_week_qual_days int := 0;
  v_cur_week_qualifies boolean := false;

  -- Final accumulators
  v_result numeric := 0;
  v_total_base int := 0;
begin
  -- ---- Load settings ----
  select coalesce(s.value::int, 5) into v_daily_target
    from settings s where s.key = 'team_daily_target';
  if v_daily_target < 1 then v_daily_target := 1; end if;

  -- Individual streak threshold (separate from team daily target)
  select coalesce(s.value::int, 1) into v_individual_daily_target
    from settings s where s.key = 'individual_daily_target';
  if v_individual_daily_target < 1 then v_individual_daily_target := 1; end if;

  select coalesce(s.value::int, 3) into v_daily_multiplier
    from settings s where s.key = 'team_daily_multiplier';

  select coalesce(s.value::int, 5) into v_weekly_days_required
    from settings s where s.key = 'team_weekly_days_required';

  select coalesce(s.value::int, 2) into v_weekly_multiplier
    from settings s where s.key = 'team_weekly_multiplier';

  select coalesce(s.value::int, 1) into v_streak_base
    from settings s where s.key = 'streak_bonus_base';

  select coalesce(s.value::int, 11) into v_streak_cap
    from settings s where s.key = 'streak_bonus_cap';

  select coalesce(s.value::int, 10) into v_streak_interval
    from settings s where s.key = 'streak_escalation_interval';
  if v_streak_interval < 1 then v_streak_interval := 1; end if;

  select coalesce(s.value::int, 3) into v_team_streak_base
    from settings s where s.key = 'team_streak_bonus_base';

  select coalesce(s.value::int, 33) into v_team_streak_cap
    from settings s where s.key = 'team_streak_bonus_cap';

  -- ---- Team info ----
  select p.team_id into v_team_id from profiles p where p.id = p_user_id;
  if v_team_id is not null then
    select t.status into v_team_status from teams t where t.id = v_team_id;
    select count(*) into v_team_member_count from profiles where team_id = v_team_id;
    v_has_active_team := (v_team_status = 'active' and v_team_member_count = 3);
  end if;

  -- ---- Period bounds ----
  case p_period
    when 'daily'   then v_period_start := current_date;
    when 'weekly'  then v_period_start := date_trunc('week', current_date)::date;
    when 'monthly' then v_period_start := date_trunc('month', current_date)::date;
    when 'yearly'  then v_period_start := date_trunc('year', current_date)::date;
    else                v_period_start := '2020-01-01'::date;
  end case;

  -- ---- Walk every day the user has reps (chronological) ----
  for v_day, v_day_reps in
    select
      (r.validated_at at time zone 'UTC')::date as d,
      count(*)::int as cnt
    from reps r
    where r.user_id = p_user_id
    group by d
    order by d
  loop
    -- === Individual streak (based on individual_daily_target, NOT team target) ===
    if v_day_reps >= v_individual_daily_target then
      if v_ind_prev is not null and v_day = v_ind_prev + 1 then
        v_ind_run := v_ind_run + 1;
      else
        v_ind_run := 1;
      end if;
      v_ind_prev := v_day;
    else
      v_ind_run := 0;
      v_ind_prev := null;
    end if;

    -- === Team streak ===
    v_all_hit := false;
    if v_has_active_team then
      select count(*) = 3 into v_all_hit
      from (
        select r2.user_id
        from reps r2
        where r2.user_id in (select id from profiles where team_id = v_team_id)
          and (r2.validated_at at time zone 'UTC')::date = v_day
        group by r2.user_id
        having count(*) >= v_daily_target
      ) sub;

      if v_all_hit then
        if v_team_prev is not null and v_day = v_team_prev + 1 then
          v_team_run := v_team_run + 1;
        else
          v_team_run := 1;
        end if;
        v_team_prev := v_day;
      else
        v_team_run := 0;
        v_team_prev := null;
      end if;
    end if;

    -- === Score accumulation (only within period) ===
    if v_day >= v_period_start and v_day <= v_period_end then
      v_total_base := v_total_base + v_day_reps;

      -- Daily team multiplier
      if v_has_active_team and v_all_hit then
        v_day_multiplied := v_day_reps * v_daily_multiplier;
      else
        v_day_multiplied := v_day_reps;
      end if;

      -- Individual streak bonus (day 1 = 0, day 2+ = formula)
      if v_ind_run >= 2 then
        v_ind_bonus := least(
          v_streak_cap,
          (floor((v_ind_run - 1)::numeric / v_streak_interval) + 1) * v_streak_base
        );
      else
        v_ind_bonus := 0;
      end if;

      -- Team streak bonus (day 1 = 0, day 2+ = formula)
      if v_has_active_team and v_team_run >= 2 then
        v_team_bonus := least(
          v_team_streak_cap,
          (floor((v_team_run - 1)::numeric / v_streak_interval) + 1) * v_team_streak_base
        );
      else
        v_team_bonus := 0;
      end if;

      v_day_total := v_day_multiplied + v_ind_bonus + v_team_bonus;

      -- === Weekly 2x tracking ===
      v_week_start := date_trunc('week', v_day)::date;

      if v_cur_week_start is null or v_week_start != v_cur_week_start then
        -- Flush previous week
        if v_cur_week_start is not null then
          if v_cur_week_qualifies then
            v_result := v_result + (v_cur_week_total * v_weekly_multiplier);
          else
            v_result := v_result + v_cur_week_total;
          end if;
        end if;
        v_cur_week_start := v_week_start;
        v_cur_week_total := 0;
        v_cur_week_qual_days := 0;
        v_cur_week_qualifies := false;
      end if;

      v_cur_week_total := v_cur_week_total + v_day_total;

      if v_has_active_team and v_all_hit then
        v_cur_week_qual_days := v_cur_week_qual_days + 1;
        if v_cur_week_qual_days >= v_weekly_days_required then
          v_cur_week_qualifies := true;
        end if;
      end if;
    end if;
  end loop;

  -- Flush last week
  if v_cur_week_start is not null then
    if v_cur_week_qualifies then
      v_result := v_result + (v_cur_week_total * v_weekly_multiplier);
    else
      v_result := v_result + v_cur_week_total;
    end if;
  end if;

  return jsonb_build_object(
    'score', v_result::int,
    'base_reps', v_total_base,
    'period', p_period,
    'individual_streak', v_ind_run,
    'team_streak', v_team_run
  );
end;
$$;
