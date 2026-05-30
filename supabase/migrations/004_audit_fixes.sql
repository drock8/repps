-- ============================================================
-- 004_audit_fixes.sql — Security & consistency fixes from brutalist audit
-- ============================================================

-- 1. Rate-limited rep insertion RPC
--    Enforces auth + 3-second cooldown between reps per user.

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

  if v_last is not null and (now() - v_last) < interval '3 seconds' then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  insert into reps (user_id, exercise_type)
  values (v_user_id, p_exercise_type);

  return jsonb_build_object('success', true);
end;
$$;

-- Revoke direct INSERT for authenticated users.
-- Drop the existing permissive insert policy (name from initial migration).
drop policy if exists "Users can insert own reps" on reps;

-- Replace with a deny-all insert policy for authenticated role.
-- All inserts must go through the insert_rep() RPC (security definer).
create policy "Deny direct inserts"
  on reps for insert
  to authenticated
  with check (false);

-- 6. Dedicated user rank RPC
--    Returns rank + total count for a single user within a filter.

create or replace function get_user_rank(
  p_user_id uuid,
  p_gender text default null,
  p_period text default 'all'
)
returns table (rank bigint, total_count bigint)
language sql stable
as $$
  with ranked as (
    select
      r.user_id,
      count(*) as rep_count,
      row_number() over (order by count(*) desc, p.created_at asc) as rn
    from reps r
    join profiles p on p.id = r.user_id
    where
      (p_gender is null or p.gender = p_gender)
      and (
        p_period = 'all'
        or r.validated_at >= (
          case p_period
            when 'daily'   then now() - interval '1 day'
            when 'weekly'  then now() - interval '7 days'
            when 'monthly' then now() - interval '30 days'
            when 'yearly'  then now() - interval '365 days'
          end
        )
      )
    group by r.user_id, p.created_at
  )
  select
    coalesce((select rn from ranked where user_id = p_user_id), (select count(*) + 1 from ranked)) as rank,
    (select count(*) from ranked) as total_count;
$$;
