-- ============================================================
-- 050_country_leaderboard.sql
--
-- Country scope leaderboard RPC. Single function branching by
-- metric (reps, score, streak, session). Returns country_code,
-- metric_value, member_count. Country names resolved client-side.
-- ============================================================

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
language plpgsql stable security definer
as $$
declare
  v_row record;
  v_tz text;
  v_day date;
  v_prev date;
  v_run int;
  v_longest int;
begin
  -- Temp table to collect results for all metric types
  create temp table if not exists _country_results (
    country_code text,
    metric_value bigint,
    member_count bigint
  );
  truncate _country_results;

  if p_metric = 'reps' then
    insert into _country_results
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
    group by p.nationality_code;

  elsif p_metric = 'score' then
    insert into _country_results
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
    group by p.nationality_code;

  elsif p_metric = 'streak' then
    -- Per-user streak calculation, then MAX per country
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
        -- Upsert: keep the MAX streak per country
        if exists (select 1 from _country_results cr where cr.country_code = v_row.nc) then
          update _country_results
            set metric_value = greatest(metric_value, v_longest::bigint),
                member_count = member_count + 1
            where country_code = v_row.nc;
        else
          insert into _country_results values (v_row.nc, v_longest::bigint, 1);
        end if;
      end if;
    end loop;

  elsif p_metric = 'session' then
    -- Best individual session per user, then MAX per country
    insert into _country_results
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
    group by sub.nationality_code;

  end if;

  return query
    select cr.country_code, cr.metric_value, cr.member_count
    from _country_results cr
    where cr.metric_value > 0
    order by cr.metric_value desc
    limit p_limit;
end;
$$;
