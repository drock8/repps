-- ============================================================
-- 051_consistency_and_heatmap.sql
--
-- 1. get_consistency_leaderboard — individual, team, country
-- 2. get_activity_heatmap — global (per-user TZ) and personal
-- 3. Update get_country_leaderboard to handle consistency metric
-- ============================================================

-- ============================================================
-- 1. Consistency leaderboard
-- ============================================================

create or replace function get_consistency_leaderboard(
  p_scope text default 'individual',
  p_gender text default null,
  p_age_min int default null,
  p_age_max int default null,
  p_country text default null,
  p_period text default 'all',
  p_limit int default 50
)
returns table (
  out_entity_id text,
  out_name text,
  out_avatar_url text,
  out_consistency_score bigint,
  out_qualifying_weeks int,
  out_avg_weekly_reps int,
  out_total_reps bigint
)
language plpgsql security definer
as $$
declare
  v_threshold int;
  v_days_required int;
  v_user record;
  v_tz text;
  v_week_start date;
  v_day date;
  v_day_count int;
  v_week_reps int;
  v_qual_weeks int;
  v_total_reps bigint;
  v_total_weekly_reps bigint;
  v_score bigint;
  v_period_start timestamptz;
  -- team vars
  v_team record;
  v_member record;
  v_all_qualify boolean;
  v_team_week_reps int;
  v_team_qual_weeks int;
  v_team_total_reps bigint;
  v_team_total_weekly bigint;
begin
  v_threshold := coalesce((select value::int from settings where key = 'consistency_daily_threshold'), 30);
  v_days_required := coalesce((select value::int from settings where key = 'consistency_weekly_days_required'), 5);

  -- Period start
  v_period_start := case p_period
    when 'daily'   then now() - interval '1 day'
    when 'weekly'  then now() - interval '7 days'
    when 'monthly' then now() - interval '30 days'
    when 'yearly'  then now() - interval '365 days'
    else null
  end;

  create temp table if not exists _consistency_results (
    entity_id text,
    entity_name text,
    entity_avatar text,
    consistency_score bigint,
    qualifying_weeks int,
    avg_weekly_reps int,
    total_reps bigint
  );
  truncate _consistency_results;

  if p_scope = 'individual' then
    for v_user in
      select p.id as uid, p.name as uname, p.avatar_url as uavatar, p.timezone as utz
      from profiles p
      where (p_gender is null or p.gender = p_gender)
        and (p_country is null or p.nationality_code = p_country)
        and (p_age_min is null or (p.dob is not null and extract(year from age(current_date, p.dob)) between p_age_min and coalesce(p_age_max, 200)))
        and exists (select 1 from reps r where r.user_id = p.id)
    loop
      v_tz := coalesce(nullif(trim(v_user.utz), ''), 'UTC');
      v_qual_weeks := 0;
      v_total_reps := 0;
      v_total_weekly_reps := 0;

      for v_week_start in
        select distinct date_trunc('week', (r.validated_at at time zone v_tz)::date)::date
        from reps r
        where r.user_id = v_user.uid
          and (v_period_start is null or r.validated_at >= v_period_start)
        order by 1
      loop
        v_day_count := 0;
        v_week_reps := 0;
        for v_day in
          select d, cnt from (
            select (r.validated_at at time zone v_tz)::date as d, count(*) as cnt
            from reps r
            where r.user_id = v_user.uid
              and (r.validated_at at time zone v_tz)::date >= v_week_start
              and (r.validated_at at time zone v_tz)::date < v_week_start + 7
            group by 1
          ) sub
        loop
          v_week_reps := v_week_reps + v_day.cnt;
          if v_day.cnt >= v_threshold then
            v_day_count := v_day_count + 1;
          end if;
        end loop;

        v_total_reps := v_total_reps + v_week_reps;
        if v_day_count >= v_days_required then
          v_qual_weeks := v_qual_weeks + 1;
          v_total_weekly_reps := v_total_weekly_reps + v_week_reps;
        end if;
      end loop;

      if v_qual_weeks > 0 then
        v_score := (v_total_weekly_reps / v_qual_weeks) * v_qual_weeks;
        insert into _consistency_results values (
          v_user.uid::text, v_user.uname, v_user.uavatar,
          v_score, v_qual_weeks, (v_total_weekly_reps / v_qual_weeks)::int, v_total_reps
        );
      end if;
    end loop;

  elsif p_scope = 'team' then
    for v_team in
      select t.id as tid, t.name as tname, t.logo_url as tlogo
      from teams t
      where t.status in ('active', 'forming')
        and (p_gender is null or exists (
          select 1 from profiles mp where mp.team_id = t.id and mp.gender = p_gender
        ))
        and (p_age_min is null or exists (
          select 1 from profiles mp where mp.team_id = t.id
            and mp.dob is not null and extract(year from age(current_date, mp.dob)) between p_age_min and coalesce(p_age_max, 200)
        ))
    loop
      v_team_qual_weeks := 0;
      v_team_total_reps := 0;
      v_team_total_weekly := 0;

      -- Get all weeks where any team member had reps
      for v_week_start in
        select distinct date_trunc('week', (r.validated_at at time zone coalesce(nullif(trim(p.timezone), ''), 'UTC'))::date)::date
        from reps r
        join profiles p on p.id = r.user_id
        where p.team_id = v_team.tid
          and (v_period_start is null or r.validated_at >= v_period_start)
        order by 1
      loop
        v_all_qualify := true;
        v_team_week_reps := 0;

        for v_member in
          select p.id as uid, p.timezone as utz
          from profiles p where p.team_id = v_team.tid
        loop
          v_tz := coalesce(nullif(trim(v_member.utz), ''), 'UTC');
          v_day_count := 0;
          v_week_reps := 0;

          for v_day in
            select d, cnt from (
              select (r.validated_at at time zone v_tz)::date as d, count(*) as cnt
              from reps r
              where r.user_id = v_member.uid
                and (r.validated_at at time zone v_tz)::date >= v_week_start
                and (r.validated_at at time zone v_tz)::date < v_week_start + 7
              group by 1
            ) sub
          loop
            v_week_reps := v_week_reps + v_day.cnt;
            if v_day.cnt >= v_threshold then
              v_day_count := v_day_count + 1;
            end if;
          end loop;

          v_team_week_reps := v_team_week_reps + v_week_reps;
          if v_day_count < v_days_required then
            v_all_qualify := false;
          end if;
        end loop;

        v_team_total_reps := v_team_total_reps + v_team_week_reps;
        if v_all_qualify then
          v_team_qual_weeks := v_team_qual_weeks + 1;
          v_team_total_weekly := v_team_total_weekly + v_team_week_reps;
        end if;
      end loop;

      if v_team_qual_weeks > 0 then
        v_score := (v_team_total_weekly / v_team_qual_weeks) * v_team_qual_weeks;
        insert into _consistency_results values (
          v_team.tid::text, v_team.tname, v_team.tlogo,
          v_score, v_team_qual_weeks, (v_team_total_weekly / v_team_qual_weeks)::int, v_team_total_reps
        );
      end if;
    end loop;

  elsif p_scope = 'country' then
    -- Average individual consistency scores per country
    -- First compute individual scores into temp, then average by nationality
    for v_user in
      select p.id as uid, p.nationality_code as nc, p.timezone as utz
      from profiles p
      where p.nationality_code is not null
        and (p_gender is null or p.gender = p_gender)
        and (p_age_min is null or (p.dob is not null and extract(year from age(current_date, p.dob)) between p_age_min and coalesce(p_age_max, 200)))
        and exists (select 1 from reps r where r.user_id = p.id)
    loop
      v_tz := coalesce(nullif(trim(v_user.utz), ''), 'UTC');
      v_qual_weeks := 0;
      v_total_reps := 0;
      v_total_weekly_reps := 0;

      for v_week_start in
        select distinct date_trunc('week', (r.validated_at at time zone v_tz)::date)::date
        from reps r
        where r.user_id = v_user.uid
          and (v_period_start is null or r.validated_at >= v_period_start)
        order by 1
      loop
        v_day_count := 0;
        v_week_reps := 0;
        for v_day in
          select d, cnt from (
            select (r.validated_at at time zone v_tz)::date as d, count(*) as cnt
            from reps r
            where r.user_id = v_user.uid
              and (r.validated_at at time zone v_tz)::date >= v_week_start
              and (r.validated_at at time zone v_tz)::date < v_week_start + 7
            group by 1
          ) sub
        loop
          v_week_reps := v_week_reps + v_day.cnt;
          if v_day.cnt >= v_threshold then
            v_day_count := v_day_count + 1;
          end if;
        end loop;

        v_total_reps := v_total_reps + v_week_reps;
        if v_day_count >= v_days_required then
          v_qual_weeks := v_qual_weeks + 1;
          v_total_weekly_reps := v_total_weekly_reps + v_week_reps;
        end if;
      end loop;

      if v_qual_weeks > 0 then
        v_score := (v_total_weekly_reps / v_qual_weeks) * v_qual_weeks;
        -- Upsert: accumulate for averaging
        if exists (select 1 from _consistency_results cr where cr.entity_id = v_user.nc) then
          update _consistency_results
            set consistency_score = consistency_score + v_score,
                qualifying_weeks = qualifying_weeks + v_qual_weeks,
                avg_weekly_reps = avg_weekly_reps + 1,  -- reuse as member_count
                total_reps = total_reps + v_total_reps
            where entity_id = v_user.nc;
        else
          insert into _consistency_results values (
            v_user.nc, v_user.nc, null,
            v_score, v_qual_weeks, 1, v_total_reps
          );
        end if;
      end if;
    end loop;

    -- Now average: consistency_score / member_count, qualifying_weeks / member_count
    update _consistency_results
      set consistency_score = consistency_score / greatest(avg_weekly_reps, 1),
          qualifying_weeks = qualifying_weeks / greatest(avg_weekly_reps, 1);
    -- avg_weekly_reps was used as member_count; recalc as total_reps / qualifying_weeks
    update _consistency_results
      set avg_weekly_reps = case when qualifying_weeks > 0 then (total_reps / qualifying_weeks)::int else 0 end;
  end if;

  return query
    select cr.entity_id, cr.entity_name, cr.entity_avatar,
           cr.consistency_score, cr.qualifying_weeks, cr.avg_weekly_reps, cr.total_reps
    from _consistency_results cr
    where cr.consistency_score > 0
    order by cr.consistency_score desc
    limit p_limit;
end;
$$;

-- ============================================================
-- 2. Activity heatmap
-- ============================================================

create or replace function get_activity_heatmap(
  p_scope text default 'global',
  p_user_id uuid default null
)
returns table (
  out_day_of_week int,
  out_hour int,
  out_rep_count bigint
)
language sql stable security definer
as $$
  select
    extract(isodow from (r.validated_at at time zone coalesce(
      nullif(trim(p.timezone), ''), 'UTC'
    )))::int - 1 as day_of_week,  -- 0=Mon, 6=Sun
    extract(hour from (r.validated_at at time zone coalesce(
      nullif(trim(p.timezone), ''), 'UTC'
    )))::int as hour,
    count(*)::bigint as rep_count
  from reps r
  join profiles p on p.id = r.user_id
  where r.validated_at >= now() - interval '90 days'
    and (p_scope = 'global' or r.user_id = p_user_id)
  group by 1, 2
  order by 1, 2;
$$;
