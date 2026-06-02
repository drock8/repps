-- ============================================================
-- 034_per_user_timezone.sql — Per-user timezone support
--
-- Adds timezone column to profiles. Rewrites all RPCs that
-- bucket reps by day to use each user's local timezone instead
-- of hardcoded UTC. "Today" is always the user's local today.
--
-- Team daily check: "did each member hit target in THEIR local
-- version of that date?"
-- ============================================================

-- ============================================================
-- 1. Add timezone column to profiles
-- ============================================================

alter table profiles
  add column if not exists timezone text not null default 'UTC';

-- ============================================================
-- 2. Helper: get a user's timezone safely (falls back to UTC)
-- ============================================================

create or replace function get_user_tz(p_user_id uuid)
returns text
language sql stable
as $$
  select coalesce(nullif(trim(p.timezone), ''), 'UTC')
  from profiles p where p.id = p_user_id;
$$;

-- ============================================================
-- 3. get_user_daily_counts — heatmap data
--    Now buckets reps by the user's local timezone.
-- ============================================================

create or replace function get_user_daily_counts(
  p_user_id uuid,
  p_since date default null
)
returns table (day date, count bigint)
language plpgsql stable
as $$
declare
  v_tz text;
  v_since date;
begin
  v_tz := get_user_tz(p_user_id);
  v_since := coalesce(p_since, ((now() at time zone v_tz)::date - 90));

  return query
    select
      (validated_at at time zone v_tz)::date as day,
      count(*) as count
    from reps
    where user_id = p_user_id
      and validated_at >= (v_since::text || ' 00:00:00')::timestamptz at time zone v_tz
    group by day
    order by day;
end;
$$;

-- ============================================================
-- 4. get_user_streaks — individual streak calculation
--    Uses the user's local day boundaries.
-- ============================================================

create or replace function get_user_streaks(p_user_id uuid)
returns table (current_streak int, longest_streak int)
language plpgsql stable
as $$
declare
  v_tz text;
  v_current int := 0;
  v_longest int := 0;
  v_run int := 0;
  v_prev date;
  v_day date;
  v_today date;
begin
  v_tz := get_user_tz(p_user_id);
  v_today := (now() at time zone v_tz)::date;

  for v_day in
    select distinct (validated_at at time zone v_tz)::date as d
    from reps
    where user_id = p_user_id
    order by d
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
-- 5. get_user_stats_summary — profile stats
--    Uses user's local timezone for days_active and today_count.
-- ============================================================

create or replace function get_user_stats_summary(p_user_id uuid)
returns table (
  total_reps bigint,
  days_active bigint,
  today_count bigint,
  best_session_count bigint,
  best_session_duration double precision,
  current_streak int,
  longest_streak int
)
language plpgsql stable
as $$
declare
  v_tz text;
  v_today date;
  v_total bigint;
  v_days bigint;
  v_today_ct bigint;
  v_best_count bigint;
  v_best_duration double precision;
  v_current int;
  v_longest int;
begin
  v_tz := get_user_tz(p_user_id);
  v_today := (now() at time zone v_tz)::date;

  select count(*) into v_total from reps where user_id = p_user_id;

  select count(distinct (validated_at at time zone v_tz)::date) into v_days
  from reps where user_id = p_user_id;

  select count(*) into v_today_ct
  from reps
  where user_id = p_user_id
    and (validated_at at time zone v_tz)::date = v_today;

  select s.rep_count, s.duration_seconds into v_best_count, v_best_duration
  from get_user_sessions(p_user_id, 1000) s
  order by s.rep_count desc
  limit 1;

  select s.current_streak, s.longest_streak into v_current, v_longest
  from get_user_streaks(p_user_id) s;

  return query select
    coalesce(v_total, 0),
    coalesce(v_days, 0),
    coalesce(v_today_ct, 0),
    coalesce(v_best_count, 0),
    coalesce(v_best_duration, 0),
    coalesce(v_current, 0),
    coalesce(v_longest, 0);
end;
$$;

-- ============================================================
-- 6. get_streak_leaderboard
--    Each user's streak uses their own timezone.
-- ============================================================

create or replace function get_streak_leaderboard(
  p_gender text default null,
  p_limit int default 50
)
returns table (
  out_user_id uuid,
  out_name text,
  out_avatar_url text,
  out_gender text,
  out_longest_streak int,
  out_current_streak int
)
language plpgsql
as $$
declare
  v_row record;
  v_tz text;
  v_day date;
  v_prev date;
  v_run int;
  v_longest int;
  v_current int;
  v_today date;
begin
  create temp table if not exists _streak_results (
    uid uuid,
    uname text,
    uavatar text,
    ugender text,
    longest int,
    current_s int
  );
  truncate _streak_results;

  for v_row in
    select p.id as uid, p.name as uname, p.avatar_url as uavatar,
           p.gender as ugender, p.timezone as utz
    from profiles p
    where (p_gender is null or p.gender = p_gender)
      and exists (select 1 from reps r where r.user_id = p.id)
  loop
    v_tz := coalesce(nullif(trim(v_row.utz), ''), 'UTC');
    v_today := (now() at time zone v_tz)::date;
    v_run := 0;
    v_longest := 0;
    v_prev := null;

    for v_day in
      select distinct (r.validated_at at time zone v_tz)::date as d
      from reps r where r.user_id = v_row.uid
      order by d
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

    if v_longest > 0 then
      insert into _streak_results values
        (v_row.uid, v_row.uname, v_row.uavatar, v_row.ugender, v_longest, v_current);
    end if;
  end loop;

  return query
    select sr.uid, sr.uname, sr.uavatar, sr.ugender, sr.longest, sr.current_s
    from _streak_results sr
    order by sr.longest desc, sr.current_s desc, sr.uname asc
    limit p_limit;
end;
$$;

-- ============================================================
-- 7. get_team_streak — team streak with per-member timezones
--
--    A qualifying day for the team: for a given calendar date D,
--    each member hit the daily target when D is measured in
--    THAT MEMBER's timezone. This means each member's reps are
--    bucketed by their own local day.
-- ============================================================

create or replace function get_team_streak(p_team_id uuid)
returns table (current_streak int, longest_streak int)
language plpgsql stable security definer
as $$
declare
  v_daily_target int;
  v_member_count int;
  v_members record;
  v_current int := 0;
  v_longest int := 0;
  v_run int := 0;
  v_prev date;
  v_day date;
  v_today date;
  v_captain_tz text;
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

  -- Use a temp table to collect each member's qualifying days in THEIR timezone,
  -- then find dates where all 3 members qualify.
  create temp table if not exists _team_member_days (
    user_id uuid,
    qual_day date
  );
  truncate _team_member_days;

  for v_members in
    select p.id as uid, coalesce(nullif(trim(p.timezone), ''), 'UTC') as tz
    from profiles p where p.team_id = p_team_id
  loop
    insert into _team_member_days (user_id, qual_day)
    select v_members.uid, (r.validated_at at time zone v_members.tz)::date
    from reps r
    where r.user_id = v_members.uid
    group by (r.validated_at at time zone v_members.tz)::date
    having count(*) >= v_daily_target;
  end loop;

  -- "Today" for the team: use captain's timezone as reference for
  -- determining if the streak is still active (today or yesterday)
  select coalesce(nullif(trim(p.timezone), ''), 'UTC') into v_captain_tz
  from profiles p
  join teams t on t.captain_id = p.id
  where t.id = p_team_id;
  v_captain_tz := coalesce(v_captain_tz, 'UTC');
  v_today := (now() at time zone v_captain_tz)::date;

  for v_day in
    select d.qual_day
    from _team_member_days d
    group by d.qual_day
    having count(distinct d.user_id) = 3
    order by d.qual_day
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
-- 8. calculate_user_rep_score — full scoring engine with per-user TZ
--
--    Individual day bucketing uses the target user's timezone.
--    Team daily check: for each date in the target user's timeline,
--    check if EACH teammate also hit target on that same calendar
--    date in THEIR OWN timezone.
-- ============================================================

create or replace function calculate_user_rep_score(
  p_user_id uuid,
  p_period text default 'all'
)
returns jsonb
language plpgsql stable security definer
as $$
declare
  v_tz text;

  -- Settings
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

  -- Period bounds (in user's local timezone)
  v_today date;
  v_period_start date;
  v_period_end date;

  -- Day iteration
  v_day date;
  v_day_reps int;

  -- Streak counters
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
  v_tz := get_user_tz(p_user_id);
  v_today := (now() at time zone v_tz)::date;
  v_period_end := v_today;

  -- ---- Load settings ----
  select coalesce(s.value::int, 5) into v_daily_target
    from settings s where s.key = 'team_daily_target';
  if v_daily_target < 1 then v_daily_target := 1; end if;

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

  -- ---- Period bounds (user's local timezone) ----
  case p_period
    when 'daily'   then v_period_start := v_today;
    when 'weekly'  then v_period_start := date_trunc('week', v_today)::date;
    when 'monthly' then v_period_start := date_trunc('month', v_today)::date;
    when 'yearly'  then v_period_start := date_trunc('year', v_today)::date;
    else                v_period_start := '2020-01-01'::date;
  end case;

  -- Pre-compute teammate qualifying days (each in their own TZ) for team checks
  if v_has_active_team then
    create temp table if not exists _teammate_days (
      uid uuid,
      qual_day date
    );
    truncate _teammate_days;

    insert into _teammate_days (uid, qual_day)
    select p.id, (r.validated_at at time zone coalesce(nullif(trim(p.timezone), ''), 'UTC'))::date
    from reps r
    join profiles p on p.id = r.user_id
    where p.team_id = v_team_id
    group by p.id, (r.validated_at at time zone coalesce(nullif(trim(p.timezone), ''), 'UTC'))::date
    having count(*) >= v_daily_target;
  end if;

  -- ---- Walk every day the user has reps (in their local TZ) ----
  for v_day, v_day_reps in
    select
      (r.validated_at at time zone v_tz)::date as d,
      count(*)::int as cnt
    from reps r
    where r.user_id = p_user_id
    group by d
    order by d
  loop
    -- === Individual streak ===
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

    -- === Team streak: did all 3 members hit target on this calendar date? ===
    v_all_hit := false;
    if v_has_active_team then
      select count(distinct uid) = 3 into v_all_hit
      from _teammate_days
      where qual_day = v_day;

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

      if v_has_active_team and v_all_hit then
        v_day_multiplied := v_day_reps * v_daily_multiplier;
      else
        v_day_multiplied := v_day_reps;
      end if;

      if v_ind_run >= 2 then
        v_ind_bonus := least(
          v_streak_cap,
          (floor((v_ind_run - 1)::numeric / v_streak_interval) + 1) * v_streak_base
        );
      else
        v_ind_bonus := 0;
      end if;

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

-- ============================================================
-- 9. get_user_score_history — per-day breakdown with user's TZ
-- ============================================================

create or replace function get_user_score_history(
  p_user_id uuid,
  p_limit int default 90
)
returns table (
  day date,
  reps int,
  daily_multiplied int,
  streak_bonus int,
  team_streak_bonus int,
  weekly_multiplier_applied boolean,
  day_total int
)
language plpgsql stable security definer
as $$
declare
  v_tz text;

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

  v_team_id uuid;
  v_team_status text;
  v_team_member_count int;
  v_has_active_team boolean := false;

  v_day date;
  v_day_reps int;
  v_ind_run int := 0;
  v_ind_prev date;
  v_team_run int := 0;
  v_team_prev date;
  v_all_hit boolean;
  v_day_multiplied numeric;
  v_ind_bonus numeric;
  v_team_bonus numeric;
  v_day_total numeric;

  v_week_start date;
  v_cur_week_start date;
  v_cur_week_qual_days int := 0;
  v_cur_week_qualifies boolean := false;
begin
  v_tz := get_user_tz(p_user_id);

  select coalesce(s.value::int, 5) into v_daily_target
    from settings s where s.key = 'team_daily_target';
  if v_daily_target < 1 then v_daily_target := 1; end if;

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

  select p.team_id into v_team_id from profiles p where p.id = p_user_id;
  if v_team_id is not null then
    select t.status into v_team_status from teams t where t.id = v_team_id;
    select count(*) into v_team_member_count from profiles where team_id = v_team_id;
    v_has_active_team := (v_team_status = 'active' and v_team_member_count = 3);
  end if;

  -- Pre-compute teammate qualifying days in their own timezones
  if v_has_active_team then
    create temp table if not exists _hist_teammate_days (
      uid uuid,
      qual_day date
    );
    truncate _hist_teammate_days;

    insert into _hist_teammate_days (uid, qual_day)
    select p.id, (r.validated_at at time zone coalesce(nullif(trim(p.timezone), ''), 'UTC'))::date
    from reps r
    join profiles p on p.id = r.user_id
    where p.team_id = v_team_id
    group by p.id, (r.validated_at at time zone coalesce(nullif(trim(p.timezone), ''), 'UTC'))::date
    having count(*) >= v_daily_target;
  end if;

  create temp table _score_rows (
    d date, reps int, daily_mult int, str_bonus int, team_str_bonus int,
    wk_applied boolean default false, total int
  ) on commit drop;

  for v_day, v_day_reps in
    select (r.validated_at at time zone v_tz)::date as d, count(*)::int as cnt
    from reps r where r.user_id = p_user_id
    group by d order by d
  loop
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

    v_all_hit := false;
    if v_has_active_team then
      select count(distinct uid) = 3 into v_all_hit
      from _hist_teammate_days
      where qual_day = v_day;

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

    if v_has_active_team and v_all_hit then
      v_day_multiplied := v_day_reps * v_daily_multiplier;
    else
      v_day_multiplied := v_day_reps;
    end if;

    if v_ind_run >= 2 then
      v_ind_bonus := least(v_streak_cap, (floor((v_ind_run - 1)::numeric / v_streak_interval) + 1) * v_streak_base);
    else
      v_ind_bonus := 0;
    end if;

    if v_has_active_team and v_team_run >= 2 then
      v_team_bonus := least(v_team_streak_cap, (floor((v_team_run - 1)::numeric / v_streak_interval) + 1) * v_team_streak_base);
    else
      v_team_bonus := 0;
    end if;

    v_day_total := v_day_multiplied + v_ind_bonus + v_team_bonus;

    insert into _score_rows (d, reps, daily_mult, str_bonus, team_str_bonus, total)
    values (v_day, v_day_reps, v_day_multiplied::int, v_ind_bonus::int, v_team_bonus::int, v_day_total::int);

    v_week_start := date_trunc('week', v_day)::date;
    if v_cur_week_start is null or v_week_start != v_cur_week_start then
      if v_cur_week_start is not null and v_cur_week_qualifies then
        update _score_rows set wk_applied = true, total = total * v_weekly_multiplier
        where d >= v_cur_week_start and d < v_week_start;
      end if;
      v_cur_week_start := v_week_start;
      v_cur_week_qual_days := 0;
      v_cur_week_qualifies := false;
    end if;
    if v_has_active_team and v_all_hit then
      v_cur_week_qual_days := v_cur_week_qual_days + 1;
      if v_cur_week_qual_days >= v_weekly_days_required then
        v_cur_week_qualifies := true;
      end if;
    end if;
  end loop;

  if v_cur_week_start is not null and v_cur_week_qualifies then
    update _score_rows set wk_applied = true, total = total * v_weekly_multiplier
    where d >= v_cur_week_start;
  end if;

  return query
    select sr.d, sr.reps, sr.daily_mult, sr.str_bonus, sr.team_str_bonus, sr.wk_applied, sr.total
    from _score_rows sr
    order by sr.d desc
    limit p_limit;
end;
$$;

-- ============================================================
-- 10. Backfill rep_scores with new timezone-aware calculations
-- ============================================================

do $$
declare
  v_uid uuid;
begin
  for v_uid in
    select distinct user_id from reps
  loop
    perform refresh_user_rep_scores(v_uid);
  end loop;
end;
$$;
