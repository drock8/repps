-- ============================================================
-- 041_claim_profile_reward_rpc.sql — Claim profile completion reward
--
-- RPC that awards bonus points for completing DOB or nationality.
-- Uses auth.uid() — no user_id parameter needed.
-- ============================================================

create or replace function claim_profile_reward(p_field text)
returns int
language plpgsql volatile security definer
as $$
declare
  v_user_id uuid;
  v_points int;
  v_setting_key text;
  v_row_count int;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Validate field name
  if p_field not in ('dob', 'nationality') then
    raise exception 'Invalid field: %', p_field;
  end if;

  -- Check the corresponding profile column is filled
  if p_field = 'dob' then
    if not exists (
      select 1 from profiles where id = v_user_id and dob is not null
    ) then
      raise exception 'DOB not set';
    end if;
  elsif p_field = 'nationality' then
    if not exists (
      select 1 from profiles where id = v_user_id and nationality_code is not null
    ) then
      raise exception 'Nationality not set';
    end if;
  end if;

  -- Read reward value from settings
  v_setting_key := 'reward_profile_' || p_field;
  select coalesce(s.value::int, 100) into v_points
    from settings s where s.key = v_setting_key;
  if v_points is null then v_points := 100; end if;

  -- Insert bonus points (unique constraint prevents double-claim)
  insert into bonus_points (user_id, category, label, points)
  values (v_user_id, 'profile', p_field, v_points)
  on conflict (user_id, category, label) do nothing;

  -- Check if row was actually inserted
  get diagnostics v_row_count = row_count;
  if v_row_count = 0 then
    return 0;
  end if;

  -- Refresh rep scores so leaderboard picks up the new total
  perform refresh_user_rep_scores(v_user_id);

  return v_points;
end;
$$;
