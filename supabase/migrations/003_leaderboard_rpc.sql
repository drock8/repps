-- Leaderboard: server-side GROUP BY + COUNT + JOIN, avoids fetching all reps client-side.
-- Uses server time (now()) for cutoff, not client clock.

create or replace function get_leaderboard(
  p_gender text default null,
  p_period text default 'all',
  p_limit int default 50
)
returns table (
  user_id uuid,
  name text,
  avatar_url text,
  gender text,
  created_at timestamptz,
  rep_count bigint
)
language sql stable
as $$
  select
    r.user_id,
    p.name,
    p.avatar_url,
    p.gender,
    p.created_at,
    count(*) as rep_count
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
  group by r.user_id, p.name, p.avatar_url, p.gender, p.created_at
  order by rep_count desc, p.created_at asc
  limit p_limit;
$$;

-- Distinct active user count: returns a single integer.
create or replace function get_mover_count()
returns bigint
language sql stable
as $$
  select count(distinct user_id) from reps;
$$;
