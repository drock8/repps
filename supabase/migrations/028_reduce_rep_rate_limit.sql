-- ============================================================
-- 028_reduce_rep_rate_limit.sql — Reduce rep insert cooldown from 3s to 1s
-- The 3-second rate limit was silently dropping legitimate reps
-- when users completed burpees faster than 3 seconds apart.
-- Detection engines already enforce a 1.5s minimum rep duration,
-- so 1 second still blocks scripted abuse without penalizing real users.
-- ============================================================

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

  return jsonb_build_object('success', true);
end;
$$;

create or replace function insert_guest_rep(p_exercise_type text default 'burpee')
returns jsonb
language plpgsql security definer
as $$
declare
  v_id uuid;
  v_last timestamptz;
begin
  select max(validated_at) into v_last
  from reps
  where user_id is null;

  if v_last is not null and (now() - v_last) < interval '1 second' then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  insert into reps (user_id, exercise_type)
  values (null, p_exercise_type)
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;
