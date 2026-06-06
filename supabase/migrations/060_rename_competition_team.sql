-- 060_rename_competition_team.sql
-- Allow team members to rename their competition team

create or replace function rename_competition_team(
  p_competition_id uuid,
  p_team_name text
)
returns jsonb
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_participant competition_participants%rowtype;
  v_clean_name text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  v_clean_name := btrim(p_team_name);
  if length(v_clean_name) < 1 or length(v_clean_name) > 40 then
    return jsonb_build_object('success', false, 'error', 'invalid_name');
  end if;

  select * into v_participant
  from competition_participants
  where competition_id = p_competition_id and user_id = v_uid and status != 'withdrawn';

  if v_participant.id is null or v_participant.competition_team_id is null then
    return jsonb_build_object('success', false, 'error', 'not_on_team');
  end if;

  if exists (
    select 1 from competition_teams
    where competition_id = p_competition_id
      and name = v_clean_name
      and id != v_participant.competition_team_id
  ) then
    return jsonb_build_object('success', false, 'error', 'name_taken');
  end if;

  update competition_teams
  set name = v_clean_name
  where id = v_participant.competition_team_id;

  return jsonb_build_object('success', true, 'name', v_clean_name);
end;
$$;
