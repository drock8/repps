-- Guest rep insertion RPC — bypasses RLS like insert_rep does for authenticated users
create or replace function insert_guest_rep(p_exercise_type text default 'burpee')
returns jsonb
language plpgsql security definer
as $$
declare
  v_id uuid;
begin
  insert into reps (user_id, exercise_type)
  values (null, p_exercise_type)
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;
