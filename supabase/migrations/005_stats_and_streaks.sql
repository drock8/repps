-- ============================================================
-- 005_stats_and_streaks.sql — User stats, session clustering, streak tracking,
--                             and new leaderboard RPCs (best session, longest streak)
-- ============================================================

-- 1. get_user_daily_counts
--    Returns day + count for each day a user has reps.
--    Used by the activity heatmap on the Profile page.

create or replace function get_user_daily_counts(
  p_user_id uuid,
  p_since date default (current_date - interval '90 days')::date
)
returns table (day date, count bigint)
language sql stable
as $$
  select
    (validated_at at time zone 'UTC')::date as day,
    count(*) as count
  from reps
  where user_id = p_user_id
    and validated_at >= p_since::timestamptz
  group by day
  order by day;
$$;

-- 2. get_user_sessions
--    Clusters reps into sessions using a 60-second gap threshold.
--    Returns one row per session: start time, end time, rep count, duration in seconds.

create or replace function get_user_sessions(
  p_user_id uuid,
  p_limit int default 50
)
returns table (
  session_start timestamptz,
  session_end timestamptz,
  rep_count bigint,
  duration_seconds double precision
)
language sql stable
as $$
  with ordered_reps as (
    select
      validated_at,
      validated_at - lag(validated_at) over (order by validated_at) as gap
    from reps
    where user_id = p_user_id
  ),
  session_boundaries as (
    select
      validated_at,
      sum(case when gap is null or gap > interval '60 seconds' then 1 else 0 end)
        over (order by validated_at) as session_id
    from ordered_reps
  )
  select
    min(validated_at) as session_start,
    max(validated_at) as session_end,
    count(*) as rep_count,
    extract(epoch from max(validated_at) - min(validated_at)) as duration_seconds
  from session_boundaries
  group by session_id
  order by session_start desc
  limit p_limit;
$$;

-- 3. get_user_streaks
--    Returns current streak and longest streak (consecutive days with >= 1 rep).

create or replace function get_user_streaks(p_user_id uuid)
returns table (current_streak int, longest_streak int)
language plpgsql stable
as $$
declare
  v_current int := 0;
  v_longest int := 0;
  v_run int := 0;
  v_prev date;
  v_day date;
  v_today date := current_date;
begin
  for v_day in
    select distinct (validated_at at time zone 'UTC')::date as d
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

  -- current streak: the run must include today or yesterday (still active)
  if v_prev = v_today or v_prev = v_today - 1 then
    v_current := v_run;
  else
    v_current := 0;
  end if;

  return query select v_current, v_longest;
end;
$$;

-- 4. get_user_stats_summary
--    Single call to get all Profile stats: total reps, days active,
--    today's count, best session, current/longest streak.

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
  v_total bigint;
  v_days bigint;
  v_today bigint;
  v_best_count bigint;
  v_best_duration double precision;
  v_current int;
  v_longest int;
begin
  -- total reps
  select count(*) into v_total from reps where user_id = p_user_id;

  -- days active
  select count(distinct (validated_at at time zone 'UTC')::date) into v_days
  from reps where user_id = p_user_id;

  -- today's count
  select count(*) into v_today
  from reps
  where user_id = p_user_id
    and (validated_at at time zone 'UTC')::date = current_date;

  -- best session (most reps in a single session)
  select s.rep_count, s.duration_seconds into v_best_count, v_best_duration
  from get_user_sessions(p_user_id, 1000) s
  order by s.rep_count desc
  limit 1;

  -- streaks
  select s.current_streak, s.longest_streak into v_current, v_longest
  from get_user_streaks(p_user_id) s;

  return query select
    coalesce(v_total, 0),
    coalesce(v_days, 0),
    coalesce(v_today, 0),
    coalesce(v_best_count, 0),
    coalesce(v_best_duration, 0),
    coalesce(v_current, 0),
    coalesce(v_longest, 0);
end;
$$;

-- 5. get_best_session_leaderboard
--    Leaderboard ranked by most reps in a single session.
--    Uses the same 60-second gap clustering.

create or replace function get_best_session_leaderboard(
  p_gender text default null,
  p_limit int default 50
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

-- 6. get_streak_leaderboard
--    Leaderboard ranked by longest unbroken streak (consecutive days with >= 1 rep).
--    Shows each user's longest streak ever.

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
language plpgsql stable
as $$
declare
  v_row record;
  v_day date;
  v_prev date;
  v_run int;
  v_longest int;
  v_current int;
  v_today date := current_date;
  v_count int := 0;
begin
  for v_row in
    select p.id as uid, p.name as uname, p.avatar_url as uavatar, p.gender as ugender
    from profiles p
    where (p_gender is null or p.gender = p_gender)
      and exists (select 1 from reps r where r.user_id = p.id)
  loop
    v_run := 0;
    v_longest := 0;
    v_prev := null;

    for v_day in
      select distinct (r.validated_at at time zone 'UTC')::date as d
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
      out_user_id := v_row.uid;
      out_name := v_row.uname;
      out_avatar_url := v_row.uavatar;
      out_gender := v_row.ugender;
      out_longest_streak := v_longest;
      out_current_streak := v_current;
      return next;
      v_count := v_count + 1;
      if v_count >= p_limit then exit; end if;
    end if;
  end loop;

  return;
end;
$$;
