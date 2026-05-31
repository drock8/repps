-- 011_team_leaderboard_reps.sql — Add combined_reps and per-member base_reps to team score leaderboard

drop function if exists get_team_score_leaderboard(text, integer);

create or replace function get_team_score_leaderboard(
  p_period text default 'all',
  p_limit int default 50
)
returns table (
  team_id uuid,
  team_name text,
  combined_score int,
  combined_reps int,
  member_scores jsonb
)
language sql stable security definer
as $$
  select
    t.id as team_id,
    t.name as team_name,
    sum(rs.score)::int as combined_score,
    sum(rs.base_reps)::int as combined_reps,
    jsonb_agg(
      jsonb_build_object(
        'user_id', p.id,
        'name', p.name,
        'avatar_url', p.avatar_url,
        'score', rs.score,
        'base_reps', rs.base_reps
      )
      order by rs.score desc
    ) as member_scores
  from teams t
  join profiles p on p.team_id = t.id
  join rep_scores rs on rs.user_id = p.id and rs.period = p_period
  where t.status in ('active', 'forming')
  group by t.id, t.name
  having sum(rs.score) > 0
  order by combined_score desc
  limit p_limit;
$$;
