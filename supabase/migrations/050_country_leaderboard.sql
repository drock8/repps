-- ============================================================
-- 050_country_leaderboard.sql
--
-- Country scope leaderboard RPC. Single function branching by
-- metric (reps, score, streak, session). Returns country_code,
-- metric_value, member_count. Country names resolved client-side.
-- ============================================================

drop function if exists get_country_leaderboard(text, text, int, int, text, int);

create or replace function get_country_leaderboard(
  p_metric text default 'reps',
  p_gender text default null,
  p_age_min int default null,
  p_age_max int default null,
  p_period text default 'all',
  p_limit int default 50
)
returns table (
  out_country_code text,
  out_metric_value bigint,
  out_member_count bigint
)
language plpgsql security definer
as $$
declare
  v_row record;
  v_tz text;
  v_day date;
  v_prev date;
  v_run int;
  v_longest int;
begin
  if p_metric = 'reps' then
    return query
    select
      p.nationality_code,
      count(*)::bigint,
      count(distinct p.id)::bigint
    from reps r
    join profiles p on p.id = r.user_id
    where p.nationality_code is not null
      and (p_gender is null or p.gender = p_gender)
      and (
        p_age_min is null
        or (p.dob is not null and extract(year from age(current_date, p.dob)) between p_age_min and coalesce(p_age_max, 200))
      )
      and (
        p_period = 'all'
        or r.validated_at >= (
          case p_period
            when 'daily'   then now() - interval '1 day'
            when 'weekly'  then now() - interval '7 days'
            when 'monthly' then now() - interval '30 days'
            when 'yearly'  then now() - interval '365 days'
          end
        )
      )
    group by p.nationality_code
    having count(*) > 0
    order by count(*) desc
    limit p_limit;

  elsif p_metric = 'score' then
    return query
    select
      p.nationality_code,
      sum(rs.score)::bigint,
      count(distinct p.id)::bigint
    from rep_scores rs
    join profiles p on p.id = rs.user_id
    where p.nationality_code is not null
      and rs.period = p_period
      and rs.score > 0
      and (p_gender is null or p.gender = p_gender)
      and (
        p_age_min is null
        or (p.dob is not null and extract(year from age(current_date, p.dob)) between p_age_min and coalesce(p_age_max, 200))
      )
    group by p.nationality_code
    having sum(rs.score) > 0
    order by sum(rs.score) desc
    limit p_limit;

  elsif p_metric = 'streak' then
    -- Per-user streak calculation, then MAX per country
    -- Use temp table (function is volatile, not stable)
    create temp table if not exists _country_streak (
      country_code text,
      best_streak bigint,
      member_count bigint
    );
    truncate _country_streak;

    for v_row in
      select p.id as uid, p.nationality_code as nc, p.timezone as utz
      from profiles p
      where p.nationality_code is not null
        and (p_gender is null or p.gender = p_gender)
        and (
          p_age_min is null
          or (p.dob is not null and extract(year from age(current_date, p.dob)) between p_age_min and coalesce(p_age_max, 200))
        )
        and exists (select 1 from reps r where r.user_id = p.id)
    loop
      v_tz := coalesce(nullif(trim(v_row.utz), ''), 'UTC');
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

      if v_longest > 0 then
        if exists (select 1 from _country_streak cs where cs.country_code = v_row.nc) then
          update _country_streak
            set best_streak = greatest(best_streak, v_longest::bigint),
                member_count = member_count + 1
            where country_code = v_row.nc;
        else
          insert into _country_streak values (v_row.nc, v_longest::bigint, 1);
        end if;
      end if;
    end loop;

    return query
    select cs.country_code, cs.best_streak, cs.member_count
    from _country_streak cs
    where cs.best_streak > 0
    order by cs.best_streak desc
    limit p_limit;

  elsif p_metric = 'session' then
    return query
    select
      sub.nationality_code,
      max(sub.best_reps)::bigint,
      count(*)::bigint
    from (
      select
        p.nationality_code,
        p.id as uid,
        (
          select max(s.rep_count)
          from (
            select
              count(*) as rep_count
            from (
              select
                r2.validated_at,
                sum(case when r2.validated_at - lag(r2.validated_at) over (order by r2.validated_at) > interval '60 seconds' or lag(r2.validated_at) over (order by r2.validated_at) is null then 1 else 0 end)
                  over (order by r2.validated_at) as session_id
              from reps r2
              where r2.user_id = p.id
                and (
                  p_period = 'all'
                  or r2.validated_at >= (
                    case p_period
                      when 'daily'   then now() - interval '1 day'
                      when 'weekly'  then now() - interval '7 days'
                      when 'monthly' then now() - interval '30 days'
                      when 'yearly'  then now() - interval '365 days'
                    end
                  )
                )
            ) x
            group by session_id
          ) s
        ) as best_reps
      from profiles p
      where p.nationality_code is not null
        and (p_gender is null or p.gender = p_gender)
        and (
          p_age_min is null
          or (p.dob is not null and extract(year from age(current_date, p.dob)) between p_age_min and coalesce(p_age_max, 200))
        )
        and exists (select 1 from reps r where r.user_id = p.id)
    ) sub
    where sub.best_reps is not null
    group by sub.nationality_code
    having max(sub.best_reps) > 0
    order by max(sub.best_reps) desc
    limit p_limit;

  end if;
end;
$$;
