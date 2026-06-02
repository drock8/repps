-- ============================================================
-- 033_score_history_rpc.sql — Per-day score breakdown for profile
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
  v_daily_target int;
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

  -- Collect rows then apply weekly multiplier
  v_rows record;
begin
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

  select p.team_id into v_team_id from profiles p where p.id = p_user_id;
  if v_team_id is not null then
    select t.status into v_team_status from teams t where t.id = v_team_id;
    select count(*) into v_team_member_count from profiles where team_id = v_team_id;
    v_has_active_team := (v_team_status = 'active' and v_team_member_count = 3);
  end if;

  -- Use temp table to collect rows, then apply weekly multiplier
  create temp table _score_rows (
    d date, reps int, daily_mult int, str_bonus int, team_str_bonus int,
    wk_applied boolean default false, total int
  ) on commit drop;

  for v_day, v_day_reps in
    select (r.validated_at at time zone 'UTC')::date as d, count(*)::int as cnt
    from reps r where r.user_id = p_user_id
    group by d order by d
  loop
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

    -- Track weekly qualification
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

  -- Flush last week
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
