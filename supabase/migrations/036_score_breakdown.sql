-- ============================================================
-- 036_score_breakdown.sql — Add multiplier breakdown to rep_scores
--
-- Adds columns for each scoring component so the UI can show
-- a proper breakdown instead of just the total.
-- ============================================================

-- 0. Ensure profiles.timezone column and get_user_tz exist (defined in 034, may be missing)
alter table profiles add column if not exists timezone text not null default 'UTC';

create or replace function get_user_tz(p_user_id uuid)
returns text
language sql stable
as $$
  select coalesce(nullif(trim(p.timezone), ''), 'UTC')
  from profiles p where p.id = p_user_id;
$$;

-- 1. Add breakdown columns to rep_scores
alter table rep_scores
  add column if not exists daily_multiplier_pts int not null default 0,
  add column if not exists streak_bonus_pts int not null default 0,
  add column if not exists team_streak_bonus_pts int not null default 0,
  add column if not exists weekly_multiplier_pts int not null default 0,
  add column if not exists daily_multiplier int not null default 1,
  add column if not exists has_active_team boolean not null default false;

-- 2. Update calculate_user_rep_score to return breakdown
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

  -- Breakdown accumulators
  v_total_daily_multiplier_pts numeric := 0;
  v_total_streak_bonus_pts numeric := 0;
  v_total_team_streak_bonus_pts numeric := 0;
  v_total_weekly_multiplier_pts numeric := 0;

  -- Per-week breakdown tracking
  v_cur_week_daily_mult numeric := 0;
  v_cur_week_streak numeric := 0;
  v_cur_week_team_streak numeric := 0;
  v_cur_week_base numeric := 0;
begin
  v_tz := get_user_tz(p_user_id);
  v_today := (now() at time zone v_tz)::date;
  v_period_end := v_today;

  select coalesce(s.value::int, 5) into v_daily_target
    from settings s where s.key = 'team_daily_target';
  if v_daily_target < 1 then v_daily_target := 1; end if;

  select coalesce(s.value::int, 1) into v_individual_daily_target
    from settings s where s.key = 'individual_daily_target';
  if v_individual_daily_target < 1 then v_individual_daily_target := 1; end if;

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

  for v_day, v_day_reps in
    select
      (r.validated_at at time zone v_tz)::date as d,
      count(*)::int as cnt
    from reps r
    where r.user_id = p_user_id
    group by d
    order by d
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

      -- Accumulate breakdown for this day (after week boundary flush)
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

-- 3. Update refresh_user_rep_scores to store breakdown
create or replace function refresh_user_rep_scores(p_user_id uuid)
returns void
language plpgsql security definer
as $$
declare
  v_period text;
  v_result jsonb;
begin
  foreach v_period in array array['daily','weekly','monthly','yearly','all']
  loop
    v_result := calculate_user_rep_score(p_user_id, v_period);

    insert into rep_scores (
      user_id, period, score, base_reps, individual_streak, team_streak,
      daily_multiplier_pts, streak_bonus_pts, team_streak_bonus_pts,
      weekly_multiplier_pts, daily_multiplier, has_active_team, updated_at
    )
    values (
      p_user_id,
      v_period,
      coalesce((v_result->>'score')::int, 0),
      coalesce((v_result->>'base_reps')::int, 0),
      coalesce((v_result->>'individual_streak')::int, 0),
      coalesce((v_result->>'team_streak')::int, 0),
      coalesce((v_result->>'daily_multiplier_pts')::int, 0),
      coalesce((v_result->>'streak_bonus_pts')::int, 0),
      coalesce((v_result->>'team_streak_bonus_pts')::int, 0),
      coalesce((v_result->>'weekly_multiplier_pts')::int, 0),
      coalesce((v_result->>'daily_multiplier')::int, 1),
      coalesce((v_result->>'has_active_team')::boolean, false),
      now()
    )
    on conflict (user_id, period) do update set
      score = excluded.score,
      base_reps = excluded.base_reps,
      individual_streak = excluded.individual_streak,
      team_streak = excluded.team_streak,
      daily_multiplier_pts = excluded.daily_multiplier_pts,
      streak_bonus_pts = excluded.streak_bonus_pts,
      team_streak_bonus_pts = excluded.team_streak_bonus_pts,
      weekly_multiplier_pts = excluded.weekly_multiplier_pts,
      daily_multiplier = excluded.daily_multiplier,
      has_active_team = excluded.has_active_team,
      updated_at = excluded.updated_at;
  end loop;
end;
$$;

-- 4. Update get_rep_score_leaderboard to return breakdown
drop function if exists get_rep_score_leaderboard(text, text, int);
create or replace function get_rep_score_leaderboard(
  p_gender text default null,
  p_period text default 'all',
  p_limit int default 50
)
returns table (
  user_id uuid,
  name text,
  avatar_url text,
  gender text,
  score int,
  base_reps int,
  individual_streak int,
  team_streak int,
  daily_multiplier_pts int,
  streak_bonus_pts int,
  team_streak_bonus_pts int,
  weekly_multiplier_pts int,
  daily_multiplier int,
  has_active_team boolean
)
language sql stable security definer
as $$
  select
    rs.user_id,
    p.name,
    p.avatar_url,
    p.gender,
    rs.score,
    rs.base_reps,
    rs.individual_streak,
    rs.team_streak,
    rs.daily_multiplier_pts,
    rs.streak_bonus_pts,
    rs.team_streak_bonus_pts,
    rs.weekly_multiplier_pts,
    rs.daily_multiplier,
    rs.has_active_team
  from rep_scores rs
  join profiles p on p.id = rs.user_id
  where rs.period = p_period
    and rs.score > 0
    and (p_gender is null or p.gender = p_gender)
  order by rs.score desc, p.created_at asc
  limit p_limit;
$$;

-- 5. Backfill: refresh all existing users so breakdown columns are populated
do $$
declare
  v_uid uuid;
begin
  for v_uid in select id from profiles loop
    perform refresh_user_rep_scores(v_uid);
  end loop;
end;
$$;

-- 6. Create get_user_score_history (from 034, updated for 2+ member teams)
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
      select count(distinct uid) = v_team_member_count into v_all_hit
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
