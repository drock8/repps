-- ============================================================
-- 009_scoring_engine.sql — Phase 10: Rep Score scoring engine
--   get_team_streak, calculate_user_rep_score
-- ============================================================

-- Index for per-day rep grouping used heavily by the scoring engine
create index if not exists idx_reps_user_validated
  on reps (user_id, validated_at);

-- ============================================================
-- 1. get_team_streak(p_team_id)
--    Returns current and longest consecutive-day team streak.
--    A qualifying day = all current members hit the daily target.
--    Team must have exactly 3 members (active state).
-- ============================================================

create or replace function get_team_streak(p_team_id uuid)
returns table (current_streak int, longest_streak int)
language plpgsql stable security definer
as $$
declare
  v_daily_target int;
  v_member_count int;
  v_current int := 0;
  v_longest int := 0;
  v_run int := 0;
  v_prev date;
  v_day date;
  v_today date := current_date;
begin
  select coalesce(s.value::int, 5) into v_daily_target
  from settings s where s.key = 'team_daily_target';
  if v_daily_target < 1 then v_daily_target := 1; end if;

  select count(*) into v_member_count
  from profiles where team_id = p_team_id;

  if v_member_count != 3 then
    return query select 0, 0;
    return;
  end if;

  for v_day in
    select qd.day
    from (
      select
        (r.validated_at at time zone 'UTC')::date as day,
        r.user_id,
        count(*) as day_count
      from reps r
      where r.user_id in (select id from profiles where team_id = p_team_id)
      group by (r.validated_at at time zone 'UTC')::date, r.user_id
      having count(*) >= v_daily_target
    ) qd
    group by qd.day
    having count(*) = 3
    order by qd.day
  loop
    if v_prev is null or v_day = v_prev + 1 then
      v_run := v_run + 1;
    else
      v_run := 1;
    end if;
    if v_run > v_longest then
      v_longest := v_run;
    end if;
    v_prev := v_day;
  end loop;

  if v_prev = v_today or v_prev = v_today - 1 then
    v_current := v_run;
  else
    v_current := 0;
  end if;

  return query select v_current, v_longest;
end;
$$;

-- ============================================================
-- 2. calculate_user_rep_score(p_user_id, p_period)
--    Full Rep Score with all 4 multipliers.
--    p_period: 'daily', 'weekly', 'monthly', 'yearly', 'all'
--
--    Walks all of the user's rep days chronologically to build
--    streak state, but only accumulates score within the period.
--
--    Returns jsonb: { score, base_reps, period,
--                     individual_streak, team_streak }
-- ============================================================

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
    -- === Individual streak (based on hitting daily target) ===
    if v_day_reps >= v_daily_target then
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
