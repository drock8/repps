-- ============================================================
-- 052_fix_referral_mdr.sql — Fix referral bonus firing on 1 rep
--
-- Bug: process_referral_activation used individual_daily_target (=1)
-- as the MDR threshold, so the bonus always fired on the first rep.
-- Fix: use dedicated referral_mdr setting (=5).
-- Also revokes the incorrectly-awarded spark_bonus rows.
-- ============================================================

-- 1. Add dedicated referral MDR setting
insert into settings (key, value, updated_at)
values ('referral_mdr', '5', now())
on conflict (key) do nothing;

-- 2. Fix process_referral_activation to use referral_mdr
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
  select * into v_referral
    from referrals
    where referred_id = p_referred_id
      and status in ('pending', 'activated')
    limit 1;

  if not found then
    return;
  end if;

  select coalesce(s.value::int, 50) into v_base_points
    from settings s where s.key = 'referral_base_points';
  if v_base_points is null then v_base_points := 50; end if;

  select coalesce(s.value::int, 100) into v_bonus_points
    from settings s where s.key = 'referral_bonus_points';
  if v_bonus_points is null then v_bonus_points := 100; end if;

  select coalesce(s.value::int, 5) into v_mdr
    from settings s where s.key = 'referral_mdr';
  if v_mdr is null then v_mdr := 5; end if;

  v_tz := get_user_tz(p_referred_id);

  -- STEP 1: If pending, first rep ever → activate with base points
  if v_referral.status = 'pending' then
    insert into bonus_points (user_id, category, label, points)
    values (v_referral.referrer_id, 'referral', 'spark_activated:' || p_referred_id, v_base_points)
    on conflict (user_id, category, label) do nothing;

    update referrals
      set status = 'activated',
          points_awarded = v_base_points,
          activated_at = now()
      where id = v_referral.id
        and status = 'pending';

    perform refresh_user_rep_scores(v_referral.referrer_id);

    select * into v_referral
      from referrals where id = v_referral.id;
  end if;

  -- STEP 2: If activated, check if referred user hit MDR on their first-rep day → bonus
  if v_referral.status = 'activated' and v_referral.activated_at is not null then
    v_first_rep_day := (v_referral.activated_at at time zone v_tz)::date;

    select count(*)::int into v_today_reps
      from reps
      where user_id = p_referred_id
        and (validated_at at time zone v_tz)::date = v_first_rep_day;

    if v_today_reps >= v_mdr then
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

-- 3. Revoke incorrectly-awarded spark_bonus rows where referred user
--    did NOT actually hit 5 reps on their first day
do $$
declare
  v_rec record;
  v_tz text;
  v_first_day date;
  v_reps int;
  v_mdr int := 5;
begin
  for v_rec in
    select bp.id as bp_id, bp.user_id as referrer_id, r.referred_id, r.id as referral_id, r.activated_at
    from bonus_points bp
    join referrals r on bp.label = 'spark_bonus:' || r.referred_id
      and bp.user_id = r.referrer_id
    where bp.category = 'referral'
      and bp.label like 'spark_bonus:%'
  loop
    if v_rec.activated_at is not null then
      v_tz := get_user_tz(v_rec.referred_id);
      v_first_day := (v_rec.activated_at at time zone v_tz)::date;

      select count(*)::int into v_reps
        from reps
        where user_id = v_rec.referred_id
          and (validated_at at time zone v_tz)::date = v_first_day;

      if v_reps < v_mdr then
        -- Remove the undeserved bonus
        delete from bonus_points where id = v_rec.bp_id;

        -- Revert referral status from bonus_awarded back to activated
        update referrals
          set status = 'activated',
              points_awarded = points_awarded - 50
          where id = v_rec.referral_id
            and status = 'bonus_awarded';

        -- Refresh the referrer's scores
        perform refresh_user_rep_scores(v_rec.referrer_id);
      end if;
    end if;
  end loop;
end;
$$;
