-- Admin-only RPC to upsert a setting, bypassing RLS.
-- Checks the caller's email against the admin_emails setting (comma-separated).

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

  -- Check email-based admin list
  select value into v_admin_csv from settings where key = 'admin_emails';
  if v_admin_csv is not null and v_admin_csv != '' then
    v_is_admin := v_email = any(string_to_array(replace(v_admin_csv, ' ', ''), ','));
  end if;

  -- Fallback: check UUID-based admin list
  if not v_is_admin then
    select value into v_admin_csv from settings where key = 'admin_users';
    if v_admin_csv is not null and v_admin_csv != '' then
      v_is_admin := v_user_id::text = any(string_to_array(replace(v_admin_csv, ' ', ''), ','));
    end if;
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

-- Seed admin_emails with the super admin email
insert into settings (key, value, updated_at)
values ('admin_emails', 'superflyasia@gmail.com', now())
on conflict (key) do nothing;
