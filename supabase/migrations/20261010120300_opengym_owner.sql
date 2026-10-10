-- openGym on Supabase, part 4 of 4 (see 20261010120000_opengym_tables.sql).

-- ------------------------------------------------- for the owner, in the SQL editor only --
-- Not reachable from the app or the REST API (schema og is not exposed, and nobody but the owner
-- may run them). In Supabase: SQL Editor, then for example:
--   select og.make_reset_code('Lamine');    -- a one-time code for a forgotten password (24 h)
--   select og.set_invite_only(true);        -- close sign-ups; false opens them again
--   select og.new_invite();                 -- a code that lets one more person sign up

create function og.make_reset_code(p_name text) returns text language plpgsql volatile set search_path = '' as $$
declare
  v_user og.users;
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_raw text := '';
  v_b bytea := extensions.gen_random_bytes(12);
begin
  select * into v_user from og.users u where u.name_key = og.fold(p_name) or u.email = og.fold(p_name);
  if v_user.id is null then raise exception 'no profile named %', p_name; end if;
  for i in 0..11 loop
    v_raw := v_raw || substr(v_alpha, get_byte(v_b, i) % 32 + 1, 1);
  end loop;
  insert into og.resets (user_id, code_hash, expires)
  values (v_user.id, encode(extensions.digest('opengym-reset:' || v_raw, 'sha256'), 'hex'), now() + interval '24 hours')
  on conflict (user_id) do update set code_hash = excluded.code_hash, expires = excluded.expires;
  return substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4) || '-' || substr(v_raw, 9, 4);
end $$;

create function og.set_invite_only(p_on boolean) returns text language sql volatile set search_path = '' as $$
  update og.settings set invite_only = p_on;
  select case when p_on then 'sign-ups closed: new profiles need an invite code (select og.new_invite())'
              else 'sign-ups open' end;
$$;

create function og.new_invite() returns text language sql volatile set search_path = '' as $$
  insert into og.invites (code) values (upper(substr(md5(encode(extensions.gen_random_bytes(16), 'hex')), 1, 10)))
  returning code;
$$;

-- ----------------------------------------------------------------------------- rights --

revoke all on all tables in schema og from public, anon, authenticated;
revoke all on all functions in schema og from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'og_config()', 'og_register(text, text, text, text)', 'og_login(text, text)', 'og_logout(text)',
    'og_logout_all(text)', 'og_me(text)', 'og_get_state(text)', 'og_get_rev(text)',
    'og_put_state(text, jsonb, integer, text)', 'og_password_status(text)',
    'og_password_change(text, text, text)', 'og_email(text, text, text)', 'og_reset_redeem(text, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
