-- ============================================================
-- 010_leaderboard_expansion.sql — Phase 11: Rep Score + Team Score leaderboards
--
-- Design for scale: materialized rep_scores table with trigger-based
-- refresh on rep insert. Leaderboard queries are simple indexed SELECTs,
-- not per-user scoring loops.
-- ============================================================

-- ============================================================
-- 1. Materialized score cache
-- ============================================================

create table if not exists rep_scores (
  user_id uuid not null references profiles(id) on delete cascade,
  period text not null check (period in ('daily','weekly','monthly','yearly','all')),
  score int not null default 0,
  base_reps int not null default 0,
  individual_streak int not null default 0,
  team_streak int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, period)
);

create index if not exists idx_rep_scores_period_score
  on rep_scores (period, score desc);

create index if not exists idx_rep_scores_score_all
  on rep_scores (score desc) where period = 'all';

-- ============================================================
-- 2. refresh_user_rep_scores(p_user_id)
--    Recalculates all 5 period scores for one user via the
--    existing calculate_user_rep_score RPC. Called by trigger.
-- ============================================================

create or replace function refresh_user_rep_scores(p_user_id uuid)
returns void
language plpgsql security definer
as $$
declare
  v_period text;
  v_result jsonb;
begin
  foreach v_period in array array['daily','weekly','monthly','yearly','all']
  loop
    v_result := calculate_user_rep_score(p_user_id, v_period);

    insert into rep_scores (user_id, period, score, base_reps, individual_streak, team_streak, updated_at)
    values (
      p_user_id,
      v_period,
      coalesce((v_result->>'score')::int, 0),
      coalesce((v_result->>'base_reps')::int, 0),
      coalesce((v_result->>'individual_streak')::int, 0),
      coalesce((v_result->>'team_streak')::int, 0),
      now()
    )
    on conflict (user_id, period) do update set
      score = excluded.score,
      base_reps = excluded.base_reps,
      individual_streak = excluded.individual_streak,
      team_streak = excluded.team_streak,
      updated_at = excluded.updated_at;
  end loop;
end;
$$;

-- ============================================================
-- 3. Trigger: refresh scores on rep insert
--    Also refreshes teammates (their team multipliers may change).
-- ============================================================

create or replace function trg_refresh_rep_scores()
returns trigger
language plpgsql security definer
as $$
declare
  v_team_id uuid;
  v_teammate_id uuid;
begin
  perform refresh_user_rep_scores(new.user_id);

  select team_id into v_team_id from profiles where id = new.user_id;
  if v_team_id is not null then
    for v_teammate_id in
      select id from profiles
      where team_id = v_team_id and id != new.user_id
    loop
      perform refresh_user_rep_scores(v_teammate_id);
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reps_refresh_scores on reps;
create trigger trg_reps_refresh_scores
  after insert on reps
  for each row
  execute function trg_refresh_rep_scores();

-- ============================================================
-- 4. Backfill: seed scores for all existing users
-- ============================================================

do $$
declare
  v_uid uuid;
begin
  for v_uid in
    select distinct user_id from reps
  loop
    perform refresh_user_rep_scores(v_uid);
  end loop;
end;
$$;

-- ============================================================
-- 5. get_rep_score_leaderboard — fast indexed query
-- ============================================================

create or replace function get_rep_score_leaderboard(
  p_gender text default null,
  p_period text default 'all',
  p_limit int default 50
)
returns table (
  user_id uuid,
  name text,
  avatar_url text,
  gender text,
  score int,
  base_reps int,
  individual_streak int,
  team_streak int
)
language sql stable security definer
as $$
  select
    rs.user_id,
    p.name,
    p.avatar_url,
    p.gender,
    rs.score,
    rs.base_reps,
    rs.individual_streak,
    rs.team_streak
  from rep_scores rs
  join profiles p on p.id = rs.user_id
  where rs.period = p_period
    and rs.score > 0
    and (p_gender is null or p.gender = p_gender)
  order by rs.score desc, p.created_at asc
  limit p_limit;
$$;

-- ============================================================
-- 6. get_team_score_leaderboard — aggregates from rep_scores
-- ============================================================

create or replace function get_team_score_leaderboard(
  p_period text default 'all',
  p_limit int default 50
)
returns table (
  team_id uuid,
  team_name text,
  combined_score int,
  member_scores jsonb
)
language sql stable security definer
as $$
  select
    t.id as team_id,
    t.name as team_name,
    sum(rs.score)::int as combined_score,
    jsonb_agg(
      jsonb_build_object(
        'user_id', p.id,
        'name', p.name,
        'avatar_url', p.avatar_url,
        'score', rs.score
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

-- ============================================================
-- 7. get_user_rep_score_rank — user's rank when outside top 50
-- ============================================================

create or replace function get_user_rep_score_rank(
  p_user_id uuid,
  p_gender text default null,
  p_period text default 'all'
)
returns table (rank bigint, total_count bigint)
language sql stable security definer
as $$
  with ranked as (
    select
      rs.user_id,
      row_number() over (order by rs.score desc, p.created_at asc) as rn,
      count(*) over () as total
    from rep_scores rs
    join profiles p on p.id = rs.user_id
    where rs.period = p_period
      and rs.score > 0
      and (p_gender is null or p.gender = p_gender)
  )
  select rn as rank, total as total_count
  from ranked
  where user_id = p_user_id;
$$;
