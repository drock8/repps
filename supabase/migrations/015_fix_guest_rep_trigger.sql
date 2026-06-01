-- Fix: skip rep_scores refresh trigger for guest reps (user_id is null)
create or replace function trg_refresh_rep_scores()
returns trigger
language plpgsql security definer
as $$
declare
  v_team_id uuid;
  v_teammate_id uuid;
begin
  if new.user_id is null then
    return new;
  end if;

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
