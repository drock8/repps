-- S0.1: Lock down get_pending_reminders to service_role only
-- Previously any authenticated user could call this and get all users'
-- push subscription credentials (endpoint URLs, p256dh keys, auth keys).

create or replace function get_pending_reminders()
returns table (
  user_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  today_count bigint
)
language plpgsql
security definer
as $$
declare
  v_role text;
begin
  v_role := coalesce(
    current_setting('request.jwt.claims', true)::json->>'role',
    ''
  );
  if v_role != 'service_role' then
    return;
  end if;

  return query
  with user_subs as (
    select ps.user_id, ps.endpoint, ps.p256dh, ps.auth, ps.reminder_time
    from push_subscriptions ps
    where ps.reminder_enabled = true
      and current_time >= ps.reminder_time
      and current_time < ps.reminder_time + interval '30 minutes'
  ),
  today_reps as (
    select r.user_id, count(*) as cnt
    from reps r
    where r.validated_at >= date_trunc('day', now())
    group by r.user_id
  )
  select
    us.user_id,
    us.endpoint,
    us.p256dh,
    us.auth,
    coalesce(tr.cnt, 0) as today_count
  from user_subs us
  left join today_reps tr on tr.user_id = us.user_id
  left join (
    select value::int as target
    from settings
    where key = 'team_daily_target'
  ) s on true
  where coalesce(tr.cnt, 0) < coalesce(s.target, 5);
end;
$$;
