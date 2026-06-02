-- ============================================================
-- 035_2_member_teams.sql — Allow 2-member teams
--
-- Teams now activate at 2 members (instead of 3).
-- Max team size remains 3.
-- Daily multiplier scales with member count:
--   2 members = 2x, 3 members = 3x
-- All other multipliers unchanged.
-- ============================================================


-- ============================================================
-- 1. join_team — activate at 2 members instead of 3
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

  if v_member_count + 1 >= 2 then
    update teams set status = 'active' where id = v_team.id;
  end if;

  return jsonb_build_object(
    'success', true,
    'team_id', v_team.id,
    'team_name', v_team.name,
    'status', case when v_member_count + 1 >= 2 then 'active' else v_team.status end
  );
end;
$$;


-- ============================================================
-- 2. leave_team — only revert to forming if remaining < 2
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
  v_new_status text;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select team_id into v_team_id from profiles where id = v_user_id;
  if v_team_id is null then
    return jsonb_build_object('success', false, 'error', 'not_on_team');
  end if;

  select captain_id into v_captain_id from teams where id = v_team_id;

  update profiles
  set team_id = null, team_joined_at = null
  where id = v_user_id;

  insert into team_member_history (team_id, user_id, event)
  values (v_team_id, v_user_id, 'left');

  select count(*) into v_remaining_count
  from profiles where team_id = v_team_id;

  if v_remaining_count = 0 then
    update teams set status = 'disbanded' where id = v_team_id;
    return jsonb_build_object('success', true, 'team_status', 'disbanded');
  end if;

  if v_remaining_count < 2 then
    update teams set status = 'forming' where id = v_team_id and status = 'active';
    v_new_status := 'forming';
  else
    v_new_status := 'active';
  end if;

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
    'team_status', v_new_status,
    'new_captain_id', v_new_captain_id
  );
end;
$$;


-- ============================================================
-- 3. get_team_streak — allow 2+ member teams
--    Daily multiplier = member count (2 or 3)
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

  if v_member_count < 2 then
    return query select 0, 0;
    return;
  end if;

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
    having count(distinct d.user_id) = v_member_count
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
-- 4. calculate_user_rep_score — 2+ member teams, dynamic multiplier
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

  -- Team info — dynamic multipliers scale with member count
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
-- 5. get_user_score_history — 2+ member teams, dynamic multiplier
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
  -- Dynamic multipliers scale with member count
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


-- ============================================================
-- 6. Refresh all rep_scores with updated calculations
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
