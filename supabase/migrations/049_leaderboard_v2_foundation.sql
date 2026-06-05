-- ============================================================
-- 049_leaderboard_v2_foundation.sql
--
-- Leaderboard v2: indexes, settings, extend existing RPCs with
-- age/country params, add team reps/streak/session leaderboards.
-- ============================================================

-- 1. Indexes for age bracket and country filtering
create index if not exists idx_profiles_nationality
  on profiles (nationality_code) where nationality_code is not null;

create index if not exists idx_profiles_dob
  on profiles (dob) where dob is not null;

-- 2. Consistency settings (used in Phase 3)
insert into settings (key, value, updated_at) values
  ('consistency_daily_threshold', '30', now()),
  ('consistency_weekly_days_required', '5', now())
on conflict (key) do nothing;

-- ============================================================
-- 3. get_leaderboard — add age/country filters
-- ============================================================
drop function if exists get_leaderboard(text, text, int);

create or replace function get_leaderboard(
  p_gender text default null,
  p_period text default 'all',
  p_limit int default 50,
  p_age_min int default null,
  p_age_max int default null,
  p_country text default null
)
returns table (
  user_id uuid,
  name text,
  avatar_url text,
  gender text,
  created_at timestamptz,
  rep_count bigint
)
language sql stable
as $$
  select
    r.user_id,
    p.name,
    p.avatar_url,
    p.gender,
    p.created_at,
    count(*) as rep_count
  from reps r
  join profiles p on p.id = r.user_id
  where
    (p_gender is null or p.gender = p_gender)
    and (p_country is null or p.nationality_code = p_country)
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
  group by r.user_id, p.name, p.avatar_url, p.gender, p.created_at
  order by rep_count desc, p.created_at asc
  limit p_limit;
$$;

-- ============================================================
-- 4. get_best_session_leaderboard — add age/country/period
-- ============================================================
drop function if exists get_best_session_leaderboard(text, int);

create or replace function get_best_session_leaderboard(
  p_gender text default null,
  p_limit int default 50,
  p_age_min int default null,
  p_age_max int default null,
  p_country text default null,
  p_period text default 'all'
)
returns table (
  user_id uuid,
  name text,
  avatar_url text,
  gender text,
  rep_count bigint,
  duration_seconds double precision,
  session_start timestamptz
)
language sql stable
as $$
  with all_sessions as (
    select
      r.user_id,
      r.validated_at,
      r.validated_at - lag(r.validated_at) over (partition by r.user_id order by r.validated_at) as gap
    from reps r
    join profiles p on p.id = r.user_id
    where (p_gender is null or p.gender = p_gender)
      and (p_country is null or p.nationality_code = p_country)
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
  ),
  session_boundaries as (
    select
      user_id,
      validated_at,
      sum(case when gap is null or gap > interval '60 seconds' then 1 else 0 end)
        over (partition by user_id order by validated_at) as session_id
    from all_sessions
  ),
  sessions as (
    select
      user_id,
      min(validated_at) as session_start,
      max(validated_at) as session_end,
      count(*) as rep_count,
      extract(epoch from max(validated_at) - min(validated_at)) as duration_seconds
    from session_boundaries
    group by user_id, session_id
  ),
  best_per_user as (
    select distinct on (user_id)
      user_id, session_start, rep_count, duration_seconds
    from sessions
    order by user_id, rep_count desc, session_start
  )
  select
    b.user_id,
    p.name,
    p.avatar_url,
    p.gender,
    b.rep_count,
    b.duration_seconds,
    b.session_start
  from best_per_user b
  join profiles p on p.id = b.user_id
  order by b.rep_count desc, b.session_start asc
  limit p_limit;
$$;

-- ============================================================
-- 5. get_streak_leaderboard — add age/country filters
-- ============================================================
drop function if exists get_streak_leaderboard(text, int);

create or replace function get_streak_leaderboard(
  p_gender text default null,
  p_limit int default 50,
  p_age_min int default null,
  p_age_max int default null,
  p_country text default null
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
      and (p_country is null or p.nationality_code = p_country)
      and (
        p_age_min is null
        or (p.dob is not null and extract(year from age(current_date, p.dob)) between p_age_min and coalesce(p_age_max, 200))
      )
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
-- 6. get_rep_score_leaderboard — add age/country filters
--    Preserves all 15 return columns including reward_pts.
-- ============================================================
drop function if exists get_rep_score_leaderboard(text, text, int);

create or replace function get_rep_score_leaderboard(
  p_gender text default null,
  p_period text default 'all',
  p_limit int default 50,
  p_age_min int default null,
  p_age_max int default null,
  p_country text default null
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
  has_active_team boolean,
  reward_pts int
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
    rs.has_active_team,
    rs.reward_pts
  from rep_scores rs
  join profiles p on p.id = rs.user_id
  where rs.period = p_period
    and rs.score > 0
    and (p_gender is null or p.gender = p_gender)
    and (p_country is null or p.nationality_code = p_country)
    and (
      p_age_min is null
      or (p.dob is not null and extract(year from age(current_date, p.dob)) between p_age_min and coalesce(p_age_max, 200))
    )
  order by rs.score desc, p.created_at asc
  limit p_limit;
$$;

-- ============================================================
-- 7. get_team_score_leaderboard — add gender/age filters
--    Team appears if ANY member matches the filter.
--    Full member_scores array preserved (all members).
-- ============================================================
drop function if exists get_team_score_leaderboard(text, int);

create or replace function get_team_score_leaderboard(
  p_period text default 'all',
  p_limit int default 50,
  p_gender text default null,
  p_age_min int default null,
  p_age_max int default null
)
returns table (
  team_id uuid,
  team_name text,
  team_logo_url text,
  combined_score int,
  combined_reps int,
  member_scores jsonb
)
language sql stable security definer
as $$
  select
    t.id as team_id,
    t.name as team_name,
    t.logo_url as team_logo_url,
    sum(rs.score)::int as combined_score,
    sum(rs.base_reps)::int as combined_reps,
    jsonb_agg(
      jsonb_build_object(
        'user_id', p.id,
        'name', p.name,
        'avatar_url', p.avatar_url,
        'score', rs.score,
        'base_reps', rs.base_reps
      )
      order by rs.score desc
    ) as member_scores
  from teams t
  join profiles p on p.team_id = t.id
  join rep_scores rs on rs.user_id = p.id and rs.period = p_period
  where t.status in ('active', 'forming')
    and exists (
      select 1 from profiles mp
      where mp.team_id = t.id
        and (p_gender is null or mp.gender = p_gender)
        and (
          p_age_min is null
          or (mp.dob is not null and extract(year from age(current_date, mp.dob)) between p_age_min and coalesce(p_age_max, 200))
        )
    )
  group by t.id, t.name, t.logo_url
  having sum(rs.score) > 0
  order by combined_score desc
  limit p_limit;
$$;

-- ============================================================
-- 8. get_team_reps_leaderboard — Team/Repps (combined raw count)
-- ============================================================
create or replace function get_team_reps_leaderboard(
  p_period text default 'all',
  p_limit int default 50,
  p_gender text default null,
  p_age_min int default null,
  p_age_max int default null
)
returns table (
  team_id uuid,
  team_name text,
  team_logo_url text,
  combined_reps bigint,
  member_reps jsonb
)
language sql stable security definer
as $$
  with team_member_reps as (
    select
      p.team_id,
      p.id as user_id,
      p.name,
      p.avatar_url,
      count(r.id) as rep_count
    from profiles p
    join reps r on r.user_id = p.id
    where p.team_id is not null
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
    group by p.team_id, p.id, p.name, p.avatar_url
  )
  select
    t.id as team_id,
    t.name as team_name,
    t.logo_url as team_logo_url,
    coalesce(sum(tmr.rep_count), 0) as combined_reps,
    jsonb_agg(
      jsonb_build_object(
        'user_id', tmr.user_id,
        'name', tmr.name,
        'avatar_url', tmr.avatar_url,
        'rep_count', tmr.rep_count
      )
      order by tmr.rep_count desc
    ) as member_reps
  from teams t
  join team_member_reps tmr on tmr.team_id = t.id
  where t.status in ('active', 'forming')
    and exists (
      select 1 from profiles mp
      where mp.team_id = t.id
        and (p_gender is null or mp.gender = p_gender)
        and (
          p_age_min is null
          or (mp.dob is not null and extract(year from age(current_date, mp.dob)) between p_age_min and coalesce(p_age_max, 200))
        )
    )
  group by t.id, t.name, t.logo_url
  having sum(tmr.rep_count) > 0
  order by combined_reps desc
  limit p_limit;
$$;

-- ============================================================
-- 9. get_team_streak_leaderboard — rank teams by team streak
-- ============================================================
create or replace function get_team_streak_leaderboard(
  p_limit int default 50,
  p_gender text default null,
  p_age_min int default null,
  p_age_max int default null
)
returns table (
  out_team_id uuid,
  out_team_name text,
  out_team_logo_url text,
  out_longest_streak int,
  out_current_streak int
)
language plpgsql stable security definer
as $$
declare
  v_team record;
  v_streak record;
begin
  create temp table if not exists _team_streak_results (
    tid uuid,
    tname text,
    tlogo text,
    longest int,
    current_s int
  );
  truncate _team_streak_results;

  for v_team in
    select t.id, t.name, t.logo_url
    from teams t
    where t.status in ('active', 'forming')
      and (select count(*) from profiles where team_id = t.id) >= 2
      and exists (
        select 1 from profiles mp
        where mp.team_id = t.id
          and (p_gender is null or mp.gender = p_gender)
          and (
            p_age_min is null
            or (mp.dob is not null and extract(year from age(current_date, mp.dob)) between p_age_min and coalesce(p_age_max, 200))
          )
      )
  loop
    select * into v_streak from get_team_streak(v_team.id);
    if v_streak.longest_streak > 0 then
      insert into _team_streak_results values
        (v_team.id, v_team.name, v_team.logo_url, v_streak.longest_streak, v_streak.current_streak);
    end if;
  end loop;

  return query
    select tsr.tid, tsr.tname, tsr.tlogo, tsr.longest, tsr.current_s
    from _team_streak_results tsr
    order by tsr.longest desc, tsr.current_s desc, tsr.tname asc
    limit p_limit;
end;
$$;

-- ============================================================
-- 10. get_team_session_leaderboard — best session per team
--     Best individual session from any team member.
-- ============================================================
create or replace function get_team_session_leaderboard(
  p_limit int default 50,
  p_gender text default null,
  p_age_min int default null,
  p_age_max int default null,
  p_period text default 'all'
)
returns table (
  out_team_id uuid,
  out_team_name text,
  out_team_logo_url text,
  out_rep_count bigint,
  out_duration_seconds double precision,
  out_best_member_name text
)
language sql stable security definer
as $$
  with all_sessions as (
    select
      r.user_id,
      r.validated_at,
      r.validated_at - lag(r.validated_at) over (partition by r.user_id order by r.validated_at) as gap
    from reps r
    join profiles p on p.id = r.user_id
    where p.team_id is not null
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
  ),
  session_boundaries as (
    select
      user_id, validated_at,
      sum(case when gap is null or gap > interval '60 seconds' then 1 else 0 end)
        over (partition by user_id order by validated_at) as session_id
    from all_sessions
  ),
  sessions as (
    select
      user_id,
      count(*) as rep_count,
      extract(epoch from max(validated_at) - min(validated_at)) as duration_seconds
    from session_boundaries
    group by user_id, session_id
  ),
  best_per_user as (
    select distinct on (user_id)
      user_id, rep_count, duration_seconds
    from sessions
    order by user_id, rep_count desc
  ),
  best_per_team as (
    select distinct on (p.team_id)
      p.team_id,
      b.rep_count,
      b.duration_seconds,
      p.name as best_member_name
    from best_per_user b
    join profiles p on p.id = b.user_id
    where p.team_id is not null
    order by p.team_id, b.rep_count desc
  )
  select
    t.id as out_team_id,
    t.name as out_team_name,
    t.logo_url as out_team_logo_url,
    bpt.rep_count as out_rep_count,
    bpt.duration_seconds as out_duration_seconds,
    bpt.best_member_name as out_best_member_name
  from best_per_team bpt
  join teams t on t.id = bpt.team_id
  where t.status in ('active', 'forming')
    and exists (
      select 1 from profiles mp
      where mp.team_id = t.id
        and (p_gender is null or mp.gender = p_gender)
        and (
          p_age_min is null
          or (mp.dob is not null and extract(year from age(current_date, mp.dob)) between p_age_min and coalesce(p_age_max, 200))
        )
    )
  order by bpt.rep_count desc
  limit p_limit;
$$;
