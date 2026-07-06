-- S0.2: Add admin check to update_feedback_priority
-- Previously any authenticated user could reorder all feedback.

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
    select value into v_admin_csv from settings where key = 'admin_users';
    if v_admin_csv is not null and v_admin_csv != '' then
      v_is_admin := v_user_id::text = any(string_to_array(replace(v_admin_csv, ' ', ''), ','));
    end if;
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
