-- ============================================================
-- 039_fix_daily_counts_tz.sql — Re-apply timezone-aware daily counts
--
-- Ensures get_user_daily_counts uses per-user timezone (not UTC).
-- Also fixes the p_since filter to correctly use midnight in the
-- user's timezone rather than the server timezone.
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
      (r.validated_at at time zone v_tz)::date as day,
      count(*) as count
    from reps r
    where r.user_id = p_user_id
      and r.validated_at >= (v_since::text || ' 00:00:00 ' || v_tz)::timestamptz
    group by day
    order by day;
end;
$$;

-- Also re-apply get_user_stats_summary with timezone-aware bucketing
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
