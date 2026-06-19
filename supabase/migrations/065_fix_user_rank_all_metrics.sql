-- Update get_user_rank to also return the user's period-filtered rep count.
-- The pinned card was using get_user_stats_summary (always all-time total_reps)
-- even when the leaderboard was filtered to a specific period.

drop function if exists get_user_rank(uuid, text, text, int, int, text);

create or replace function get_user_rank(
  p_user_id uuid,
  p_gender text default null,
  p_period text default 'all',
  p_age_min int default null,
  p_age_max int default null,
  p_country text default null
)
returns table (rank bigint, total_count bigint, metric_value bigint)
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
      and (p_country is null or p.nationality_code = p_country)
      and (
        p_age_min is null
        or (p.dob is not null and extract(year from age(current_date, p.dob)) between p_age_min and coalesce(p_age_max, 200))
      )
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
    (select count(*) from ranked) as total_count,
    coalesce((select rep_count from ranked where user_id = p_user_id), 0) as metric_value;
$$;
