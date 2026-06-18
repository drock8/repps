-- Push notification subscriptions for Web Push API
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  reminder_time time not null default '18:00',
  reminder_enabled boolean not null default true,
  team_nudges boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

alter table push_subscriptions enable row level security;

create policy "Users can manage their own subscriptions"
  on push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- RPC for the cron job to read subscriptions (bypasses RLS)
create or replace function get_pending_reminders()
returns table (
  user_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  today_count bigint
)
language sql
security definer
as $$
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
$$;
