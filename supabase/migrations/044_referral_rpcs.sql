-- ============================================================
-- 044_referral_rpcs.sql — Referral system RPCs
--
-- process_referral_activation: awards Sparks points via bonus_points
-- get_my_sparks: returns referred users for profile display
-- create_referral: links a referrer to a new user (called after signup)
-- ============================================================

-- 1. create_referral — called after signup when referral code is present
create or replace function create_referral(p_referral_code text)
returns jsonb
language plpgsql volatile security definer
as $$
declare
  v_referred_id uuid;
  v_referrer_id uuid;
begin
  v_referred_id := auth.uid();
  if v_referred_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  -- Find referrer by code
  select id into v_referrer_id
    from profiles
    where referral_code = upper(trim(p_referral_code));

  if v_referrer_id is null then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;

  -- Can't refer yourself
  if v_referrer_id = v_referred_id then
    return jsonb_build_object('success', false, 'error', 'self_referral');
  end if;

  -- Insert referral row (unique constraint on referred_id prevents duplicates)
  insert into referrals (referrer_id, referred_id, status)
  values (v_referrer_id, v_referred_id, 'pending')
  on conflict (referred_id) do nothing;

  return jsonb_build_object('success', true);
end;
$$;

-- 2. process_referral_activation — called when a rep is logged
--    Checks if user has a pending/activated referral, awards points to referrer.
--    Idempotent: won't double-award.
create or replace function process_referral_activation(p_referred_id uuid)
returns void
language plpgsql volatile security definer
as $$
declare
  v_referral record;
  v_base_points int;
  v_bonus_points int;
  v_mdr int;
  v_first_rep_day date;
  v_today_reps int;
  v_tz text;
begin
  -- Find the referral row (pending or activated — skip bonus_awarded)
  select * into v_referral
    from referrals
    where referred_id = p_referred_id
      and status in ('pending', 'activated')
    limit 1;

  if not found then
    return;
  end if;

  -- Read settings
  select coalesce(s.value::int, 11) into v_base_points
    from settings s where s.key = 'referral_base_points';
  if v_base_points is null then v_base_points := 11; end if;

  select coalesce(s.value::int, 15) into v_bonus_points
    from settings s where s.key = 'referral_bonus_points';
  if v_bonus_points is null then v_bonus_points := 15; end if;

  select coalesce(s.value::int, 5) into v_mdr
    from settings s where s.key = 'individual_daily_target';
  if v_mdr is null then v_mdr := 5; end if;

  v_tz := get_user_tz(p_referred_id);

  -- STEP 1: If pending, check if this is first rep ever → activate
  if v_referral.status = 'pending' then
    -- Award base points to referrer
    insert into bonus_points (user_id, category, label, points)
    values (v_referral.referrer_id, 'referral', 'spark_activated:' || p_referred_id, v_base_points)
    on conflict (user_id, category, label) do nothing;

    update referrals
      set status = 'activated',
          points_awarded = v_base_points,
          activated_at = now()
      where id = v_referral.id
        and status = 'pending';

    -- Refresh referrer's scores
    perform refresh_user_rep_scores(v_referral.referrer_id);

    -- Re-read the referral to get updated status
    select * into v_referral
      from referrals where id = v_referral.id;
  end if;

  -- STEP 2: If activated, check if referred user hit MDR on their first-rep day → bonus
  if v_referral.status = 'activated' and v_referral.activated_at is not null then
    v_first_rep_day := (v_referral.activated_at at time zone v_tz)::date;

    -- Count reps on first-rep day
    select count(*)::int into v_today_reps
      from reps
      where user_id = p_referred_id
        and (validated_at at time zone v_tz)::date = v_first_rep_day;

    if v_today_reps >= v_mdr then
      -- Award bonus points (difference between total and base)
      insert into bonus_points (user_id, category, label, points)
      values (v_referral.referrer_id, 'referral', 'spark_bonus:' || p_referred_id, v_bonus_points - v_base_points)
      on conflict (user_id, category, label) do nothing;

      update referrals
        set status = 'bonus_awarded',
            points_awarded = v_bonus_points
        where id = v_referral.id
          and status = 'activated';

      perform refresh_user_rep_scores(v_referral.referrer_id);
    end if;
  end if;
end;
$$;

-- 3. Hook into insert_rep — call process_referral_activation after each rep
create or replace function insert_rep(p_exercise_type text default 'burpee')
returns jsonb
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_last timestamptz;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select max(validated_at) into v_last
  from reps
  where user_id = v_user_id;

  if v_last is not null and (now() - v_last) < interval '1 second' then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  insert into reps (user_id, exercise_type)
  values (v_user_id, p_exercise_type);

  -- Check referral activation after each rep
  perform process_referral_activation(v_user_id);

  return jsonb_build_object('success', true);
end;
$$;

-- 4. get_my_sparks — returns referred users for the Sparks list on profile
create or replace function get_my_sparks()
returns table (
  referred_id uuid,
  name text,
  avatar_url text,
  status text,
  points_awarded int,
  created_at timestamptz,
  activated_at timestamptz
)
language sql stable security definer
as $$
  select
    r.referred_id,
    p.name,
    p.avatar_url,
    r.status,
    r.points_awarded,
    r.created_at,
    r.activated_at
  from referrals r
  join profiles p on p.id = r.referred_id
  where r.referrer_id = auth.uid()
  order by r.created_at desc;
$$;
