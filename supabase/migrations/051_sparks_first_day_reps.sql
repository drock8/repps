-- ============================================================
-- 051_sparks_first_day_reps.sql — Add first_day_reps to get_my_sparks
-- ============================================================

drop function if exists get_my_sparks();

create or replace function get_my_sparks()
returns table (
  referred_id uuid,
  name text,
  avatar_url text,
  status text,
  points_awarded int,
  created_at timestamptz,
  activated_at timestamptz,
  first_day_reps int
)
language plpgsql stable security definer
as $$
declare
  v_rec record;
  v_tz text;
  v_first_day date;
  v_reps int;
begin
  for v_rec in
    select r.referred_id, p.name, p.avatar_url, r.status, r.points_awarded,
           r.created_at, r.activated_at
    from referrals r
    join profiles p on p.id = r.referred_id
    where r.referrer_id = auth.uid()
    order by r.created_at desc
  loop
    v_reps := 0;
    if v_rec.activated_at is not null then
      v_tz := get_user_tz(v_rec.referred_id);
      v_first_day := (v_rec.activated_at at time zone v_tz)::date;
      select count(*)::int into v_reps
        from reps
        where user_id = v_rec.referred_id
          and (validated_at at time zone v_tz)::date = v_first_day;
    end if;

    referred_id := v_rec.referred_id;
    name := v_rec.name;
    avatar_url := v_rec.avatar_url;
    status := v_rec.status;
    points_awarded := v_rec.points_awarded;
    created_at := v_rec.created_at;
    activated_at := v_rec.activated_at;
    first_day_reps := v_reps;
    return next;
  end loop;
end;
$$;
