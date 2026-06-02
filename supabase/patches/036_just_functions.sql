-- Run this standalone to update the scoring functions
-- (bypasses migration issues with alter table / backfill)

create or replace function calculate_user_rep_score(
  p_user_id uuid,
  p_period text default 'all'
)
returns jsonb
language plpgsql volatile security definer
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
  v_today date;
  v_period_start date;
  v_period_end date;
  v_day date;
  v_day_reps int;
  v_ind_run int := 0;
  v_ind_prev date;
  v_team_run int := 0;
  v_team_prev date;
  v_day_multiplied numeric;
  v_ind_bonus numeric;
  v_team_bonus numeric;
  v_day_total numeric;
  v_all_hit boolean;
  v_week_start date;
  v_cur_week_start date;
  v_cur_week_total numeric := 0;
  v_cur_week_qual_days int := 0;
  v_cur_week_qualifies boolean := false;
  v_result numeric := 0;
  v_total_base int := 0;
  v_total_daily_multiplier_pts numeric := 0;
  v_total_streak_bonus_pts numeric := 0;
  v_total_team_streak_bonus_pts numeric := 0;
  v_total_weekly_multiplier_pts numeric := 0;
  v_cur_week_daily_mult numeric := 0;
  v_cur_week_streak numeric := 0;
  v_cur_week_team_streak numeric := 0;
  v_cur_week_base numeric := 0;
begin
  v_tz := get_user_tz(p_user_id);
  v_today := (now() at time zone v_tz)::date;
  v_period_end := v_today;

  select coalesce(s.value::int, 5) into v_daily_target from settings s where s.key = 'team_daily_target';
  if v_daily_target < 1 then v_daily_target := 1; end if;
  select coalesce(s.value::int, 1) into v_individual_daily_target from settings s where s.key = 'individual_daily_target';
  if v_individual_daily_target < 1 then v_individual_daily_target := 1; end if;
  select coalesce(s.value::int, 5) into v_weekly_days_required from settings s where s.key = 'team_weekly_days_required';
  select coalesce(s.value::int, 2) into v_weekly_multiplier from settings s where s.key = 'team_weekly_multiplier';
  select coalesce(s.value::int, 1) into v_streak_base from settings s where s.key = 'streak_bonus_base';
  select coalesce(s.value::int, 11) into v_streak_cap from settings s where s.key = 'streak_bonus_cap';
  select coalesce(s.value::int, 10) into v_streak_interval from settings s where s.key = 'streak_escalation_interval';
  if v_streak_interval < 1 then v_streak_interval := 1; end if;

  select p.team_id into v_team_id from profiles p where p.id = p_user_id;
  if v_team_id is not null then
    select t.status into v_team_status from teams t where t.id = v_team_id;
    select count(*) into v_team_member_count from profiles where team_id = v_team_id;
    v_has_active_team := (v_team_status = 'active' and v_team_member_count >= 2);
    v_daily_multiplier := v_team_member_count;
    v_team_streak_base := v_team_member_count;
    v_team_streak_cap := v_team_member_count * 11;
  else
    v_daily_multiplier := 1;
    v_team_streak_base := 0;
    v_team_streak_cap := 0;
  end if;

  case p_period
    when 'daily'   then v_period_start := v_today;
    when 'weekly'  then v_period_start := date_trunc('week', v_today)::date;
    when 'monthly' then v_period_start := date_trunc('month', v_today)::date;
    when 'yearly'  then v_period_start := date_trunc('year', v_today)::date;
    else                v_period_start := '2020-01-01'::date;
  end case;

  if v_has_active_team then
    create temp table if not exists _teammate_days (uid uuid, qual_day date);
    truncate _teammate_days;
    insert into _teammate_days (uid, qual_day)
    select p.id, (r.validated_at at time zone coalesce(nullif(trim(p.timezone), ''), 'UTC'))::date
    from reps r join profiles p on p.id = r.user_id
    where p.team_id = v_team_id
    group by p.id, (r.validated_at at time zone coalesce(nullif(trim(p.timezone), ''), 'UTC'))::date
    having count(*) >= v_daily_target;
  end if;

  for v_day, v_day_reps in
    select (r.validated_at at time zone v_tz)::date as d, count(*)::int as cnt
    from reps r where r.user_id = p_user_id group by d order by d
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
      select count(distinct uid) = v_team_member_count into v_all_hit
      from _teammate_days where qual_day = v_day;
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

    if v_day >= v_period_start and v_day <= v_period_end then
      v_total_base := v_total_base + v_day_reps;

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

      -- Week boundary check FIRST
      v_week_start := date_trunc('week', v_day)::date;
      if v_cur_week_start is null or v_week_start != v_cur_week_start then
        if v_cur_week_start is not null then
          if v_cur_week_qualifies then
            v_result := v_result + (v_cur_week_total * v_weekly_multiplier);
            v_total_weekly_multiplier_pts := v_total_weekly_multiplier_pts + (v_cur_week_total * (v_weekly_multiplier - 1));
            v_total_daily_multiplier_pts := v_total_daily_multiplier_pts + (v_cur_week_daily_mult * v_weekly_multiplier);
            v_total_streak_bonus_pts := v_total_streak_bonus_pts + (v_cur_week_streak * v_weekly_multiplier);
            v_total_team_streak_bonus_pts := v_total_team_streak_bonus_pts + (v_cur_week_team_streak * v_weekly_multiplier);
          else
            v_result := v_result + v_cur_week_total;
            v_total_daily_multiplier_pts := v_total_daily_multiplier_pts + v_cur_week_daily_mult;
            v_total_streak_bonus_pts := v_total_streak_bonus_pts + v_cur_week_streak;
            v_total_team_streak_bonus_pts := v_total_team_streak_bonus_pts + v_cur_week_team_streak;
          end if;
        end if;
        v_cur_week_start := v_week_start;
        v_cur_week_total := 0;
        v_cur_week_qual_days := 0;
        v_cur_week_qualifies := false;
        v_cur_week_daily_mult := 0;
        v_cur_week_streak := 0;
        v_cur_week_team_streak := 0;
        v_cur_week_base := 0;
      end if;

      -- THEN accumulate this day's breakdown
      v_cur_week_daily_mult := v_cur_week_daily_mult + (v_day_multiplied - v_day_reps);
      v_cur_week_streak := v_cur_week_streak + v_ind_bonus;
      v_cur_week_team_streak := v_cur_week_team_streak + v_team_bonus;
      v_cur_week_base := v_cur_week_base + v_day_reps;
      v_cur_week_total := v_cur_week_total + v_day_total;

      if v_has_active_team and v_all_hit then
        v_cur_week_qual_days := v_cur_week_qual_days + 1;
        if v_cur_week_qual_days >= v_weekly_days_required then
          v_cur_week_qualifies := true;
        end if;
      end if;
    end if;
  end loop;

  -- Flush final week
  if v_cur_week_start is not null then
    if v_cur_week_qualifies then
      v_result := v_result + (v_cur_week_total * v_weekly_multiplier);
      v_total_weekly_multiplier_pts := v_total_weekly_multiplier_pts + (v_cur_week_total * (v_weekly_multiplier - 1));
      v_total_daily_multiplier_pts := v_total_daily_multiplier_pts + (v_cur_week_daily_mult * v_weekly_multiplier);
      v_total_streak_bonus_pts := v_total_streak_bonus_pts + (v_cur_week_streak * v_weekly_multiplier);
      v_total_team_streak_bonus_pts := v_total_team_streak_bonus_pts + (v_cur_week_team_streak * v_weekly_multiplier);
    else
      v_result := v_result + v_cur_week_total;
      v_total_daily_multiplier_pts := v_total_daily_multiplier_pts + v_cur_week_daily_mult;
      v_total_streak_bonus_pts := v_total_streak_bonus_pts + v_cur_week_streak;
      v_total_team_streak_bonus_pts := v_total_team_streak_bonus_pts + v_cur_week_team_streak;
    end if;
  end if;

  return jsonb_build_object(
    'score', v_result::int,
    'base_reps', v_total_base,
    'period', p_period,
    'individual_streak', v_ind_run,
    'team_streak', v_team_run,
    'daily_multiplier_pts', v_total_daily_multiplier_pts::int,
    'streak_bonus_pts', v_total_streak_bonus_pts::int,
    'team_streak_bonus_pts', v_total_team_streak_bonus_pts::int,
    'weekly_multiplier_pts', v_total_weekly_multiplier_pts::int,
    'daily_multiplier', v_daily_multiplier,
    'has_active_team', v_has_active_team
  );
end;
$$;
