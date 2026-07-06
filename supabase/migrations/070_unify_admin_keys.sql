-- S0.6: Unify admin key names — standardize on admin_emails
-- Previously 3 different keys: admin_users (UUIDs), admin_user_ids (UUIDs), admin_emails

-- 1. Update feature_event to use admin_emails (email-based check)
create or replace function feature_event(p_event_id uuid)
returns jsonb
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_event record;
  v_admin_csv text;
  v_is_admin boolean := false;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select email into v_email from auth.users where id = v_user_id;

  select value into v_admin_csv from settings where key = 'admin_emails';
  if v_admin_csv is not null and v_admin_csv != '' then
    v_is_admin := v_email = any(string_to_array(replace(v_admin_csv, ' ', ''), ','));
  end if;

  select * into v_event from events where id = p_event_id;
  if v_event is null then
    return jsonb_build_object('success', false, 'error', 'event_not_found');
  end if;

  if not v_is_admin and v_event.created_by != v_user_id then
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  update events set is_featured = true where id = p_event_id;
  update events set is_featured = false where id != p_event_id and is_featured = true;

  return jsonb_build_object('success', true);
end;
$$;

-- 2. Update feedback RLS policies to use admin_emails (email-based check)
drop policy if exists "Admins can update feedback" on public.feedback;
drop policy if exists "Admins can delete feedback" on public.feedback;

create policy "Admins can update feedback" on public.feedback for update
using (
  (select email from auth.users where id = auth.uid()) in (
    select unnest(string_to_array(replace(value, ' ', ''), ','))
    from public.settings
    where key = 'admin_emails'
  )
  or auth.uid() = user_id
);

create policy "Admins can delete feedback" on public.feedback for delete
using (
  (select email from auth.users where id = auth.uid()) in (
    select unnest(string_to_array(replace(value, ' ', ''), ','))
    from public.settings
    where key = 'admin_emails'
  )
);

-- 3. Clean up update_feedback_priority — remove fallback to admin_users
create or replace function public.update_feedback_priority(p_items jsonb)
returns void language plpgsql security definer as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_admin_csv text;
  v_is_admin boolean := false;
  v_item jsonb;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select email into v_email from auth.users where id = v_user_id;

  select value into v_admin_csv from settings where key = 'admin_emails';
  if v_admin_csv is not null and v_admin_csv != '' then
    v_is_admin := v_email = any(string_to_array(replace(v_admin_csv, ' ', ''), ','));
  end if;

  if not v_is_admin then
    raise exception 'not_authorized';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    update public.feedback
    set priority_order = (v_item->>'priority_order')::integer,
        status = coalesce(v_item->>'status', status),
        updated_at = now()
    where id = (v_item->>'id')::uuid;
  end loop;
end;
$$;

-- 4. Clean up admin_upsert_setting — remove fallback to admin_users
create or replace function admin_upsert_setting(p_key text, p_value text)
returns jsonb
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_admin_csv text;
  v_is_admin boolean := false;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select email into v_email from auth.users where id = v_user_id;

  select value into v_admin_csv from settings where key = 'admin_emails';
  if v_admin_csv is not null and v_admin_csv != '' then
    v_is_admin := v_email = any(string_to_array(replace(v_admin_csv, ' ', ''), ','));
  end if;

  if not v_is_admin then
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  insert into settings (key, value, updated_at)
  values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return jsonb_build_object('success', true);
end;
$$;
