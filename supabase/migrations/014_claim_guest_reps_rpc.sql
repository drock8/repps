-- RPC to claim guest reps — security definer bypasses RLS
create or replace function claim_guest_reps(p_user_id uuid, p_rep_ids uuid[])
returns jsonb
language plpgsql security definer
as $$
declare
  v_claimed int;
begin
  update reps
  set user_id = p_user_id
  where id = any(p_rep_ids)
    and user_id is null;

  get diagnostics v_claimed = row_count;

  return jsonb_build_object('success', true, 'claimed', v_claimed);
end;
$$;
