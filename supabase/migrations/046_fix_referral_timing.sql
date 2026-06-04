-- 046_fix_referral_timing.sql — Fix timing: trigger activation inside create_referral
--
-- Problem: if the referred user already has reps when the referral link is clicked,
-- process_referral_activation never fires because insert_rep already ran.
-- Fix: call process_referral_activation at the end of create_referral so it
-- catches up immediately if reps already exist.

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

  select id into v_referrer_id
    from profiles
    where referral_code = upper(trim(p_referral_code));

  if v_referrer_id is null then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;

  if v_referrer_id = v_referred_id then
    return jsonb_build_object('success', false, 'error', 'self_referral');
  end if;

  insert into referrals (referrer_id, referred_id, status)
  values (v_referrer_id, v_referred_id, 'pending')
  on conflict (referred_id) do nothing;

  -- Immediately check if referred user already has reps — catch up on activation
  if exists (select 1 from reps where user_id = v_referred_id limit 1) then
    perform process_referral_activation(v_referred_id);
  end if;

  return jsonb_build_object('success', true);
end;
$$;
