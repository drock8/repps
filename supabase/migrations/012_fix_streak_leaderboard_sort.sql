-- Fix streak leaderboard: sort by longest streak descending instead of arbitrary profile order
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
language plpgsql
as $$
declare
  v_row record;
  v_day date;
  v_prev date;
  v_run int;
  v_longest int;
  v_current int;
  v_today date := current_date;
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
      insert into _streak_results values (v_row.uid, v_row.uname, v_row.uavatar, v_row.ugender, v_longest, v_current);
    end if;
  end loop;

  return query
    select sr.uid, sr.uname, sr.uavatar, sr.ugender, sr.longest, sr.current_s
    from _streak_results sr
    order by sr.longest desc, sr.current_s desc, sr.uname asc
    limit p_limit;
end;
$$;
