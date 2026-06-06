-- 061_competition_rename_delete.sql
-- Allow organizers to rename and delete competitions

-- RPC: rename_competition
create or replace function rename_competition(
  p_competition_id uuid,
  p_name text
)
returns jsonb
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_comp competition_settings%rowtype;
  v_clean text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  v_clean := btrim(p_name);
  if length(v_clean) < 1 or length(v_clean) > 60 then
    return jsonb_build_object('success', false, 'error', 'invalid_name');
  end if;

  select * into v_comp from competition_settings where id = p_competition_id;
  if v_comp.id is null then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  if not exists (
    select 1 from events where id = v_comp.event_id and created_by = v_uid
  ) then
    return jsonb_build_object('success', false, 'error', 'not_organizer');
  end if;

  update competition_settings set name = v_clean where id = p_competition_id;
  return jsonb_build_object('success', true, 'name', v_clean);
end;
$$;

-- RPC: delete_competition
create or replace function delete_competition(
  p_competition_id uuid
)
returns jsonb
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_comp competition_settings%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_comp from competition_settings where id = p_competition_id;
  if v_comp.id is null then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  if not exists (
    select 1 from events where id = v_comp.event_id and created_by = v_uid
  ) then
    return jsonb_build_object('success', false, 'error', 'not_organizer');
  end if;

  if v_comp.state in ('live', 'countdown') then
    return jsonb_build_object('success', false, 'error', 'cannot_delete_live');
  end if;

  delete from competition_settings where id = p_competition_id;
  return jsonb_build_object('success', true);
end;
$$;
