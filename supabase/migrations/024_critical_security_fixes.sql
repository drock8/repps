-- ============================================================
-- 024_critical_security_fixes.sql — Critical security fixes from brutalist audit
--
-- Fixes:
--   1. rep_scores table missing RLS
--   2. Reps direct INSERT bypass (policy name mismatch in 004)
--   3. claim_guest_reps has no auth.uid() validation
--   4. insert_guest_rep has no rate limiting
-- ============================================================


-- ============================================================
-- FIX 1: rep_scores — enable RLS + read-only public access
--
-- Writes to rep_scores only happen via refresh_user_rep_scores()
-- which is SECURITY DEFINER. No public write policy needed.
-- ============================================================

alter table rep_scores enable row level security;

create policy "Anyone can read rep scores"
  on rep_scores for select
  using (true);

-- No INSERT/UPDATE/DELETE policies — all writes go through
-- the SECURITY DEFINER trigger function trg_refresh_rep_scores.


-- ============================================================
-- FIX 2: Drop the permissive INSERT policy that 004 missed
--
-- Migration 004 tried to drop "Users can insert own reps" but
-- migration 002 named it "Authenticated users insert own reps".
-- The DROP IF EXISTS silently did nothing — the permissive
-- policy still allows direct INSERTs, bypassing the RPC rate limit.
-- ============================================================

drop policy if exists "Authenticated users insert own reps" on reps;


-- ============================================================
-- FIX 3: claim_guest_reps — require auth.uid() match
--
-- The original function accepted p_user_id as a parameter and
-- used it directly in a SECURITY DEFINER context with no
-- validation. Any authenticated user could claim guest reps
-- to any account.
-- ============================================================

create or replace function claim_guest_reps(p_user_id uuid, p_rep_ids uuid[])
returns jsonb
language plpgsql security definer
as $$
declare
  v_claimed int;
begin
  if p_user_id is distinct from auth.uid() then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update reps
  set user_id = p_user_id
  where id = any(p_rep_ids)
    and user_id is null;

  get diagnostics v_claimed = row_count;

  return jsonb_build_object('success', true, 'claimed', v_claimed);
end;
$$;


-- ============================================================
-- FIX 4: insert_guest_rep — add rate limiting
--
-- Guest reps are anonymous (user_id IS NULL) so we can't
-- throttle per-user. Instead, use a global throttle: no more
-- than one guest rep per 3 seconds from the same DB connection.
-- This matches the authenticated insert_rep() cooldown.
-- ============================================================

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

  if v_last is not null and (now() - v_last) < interval '3 seconds' then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  insert into reps (user_id, exercise_type)
  values (null, p_exercise_type)
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;
