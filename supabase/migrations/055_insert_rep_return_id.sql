-- 055_insert_rep_return_id.sql
-- Update insert_rep to return the rep_id (needed for competition dual-write)

create or replace function insert_rep(p_exercise_type text default 'burpee')
returns jsonb
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_last timestamptz;
  v_rep_id uuid;
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
  values (v_user_id, p_exercise_type)
  returning id into v_rep_id;

  perform process_referral_activation(v_user_id);

  return jsonb_build_object('success', true, 'rep_id', v_rep_id);
end;
$$;
