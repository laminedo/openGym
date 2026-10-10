-- openGym on Supabase, part 3 of 4 (see 20261010120000_opengym_tables.sql).

-- ---------------------------------------------------------- what the app calls (REST) --

-- GET /api/config
create function public.og_config() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', 200, 'invite_only', s.invite_only, 'allow_guest', s.allow_guest,
                            'password_login', true, 'passkeys', false)
  from og.settings s
$$;

-- POST /api/register/password
create function public.og_register(p_name text, p_password text, p_code text default '', p_email text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_name text := left(regexp_replace(coalesce(p_name, ''), '^\s+|\s+$', '', 'g'), 40);
  v_key text;
  v_email text;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '^\s+|\s+$', '', 'g'));
  v_set og.settings;
  v_inv og.invites;
  v_problem text;
  v_id text;
  v_user og.users;
begin
  if v_name = '' then return og.err(400, 'missing', 'name required'); end if;
  v_key := og.fold(v_name);
  -- One sign-up at a time: the count, the name and the invite hold until the insert.
  perform og.one_at_a_time('register');
  select * into v_set from og.settings;
  if (select count(*) from og.users) >= v_set.max_users then
    return og.err(403, 'full', 'this app already has as many profiles as it takes');
  end if;
  if v_set.invite_only then
    select * into v_inv from og.invites i where i.code = v_code and i.used_by is null and not i.revoked;
    if v_inv.code is null then return og.err(403, 'invite', 'a valid invite code is required'); end if;
  end if;
  v_problem := og.pw_problem(p_password);
  if v_problem is not null then return og.err(400, v_problem, og.pw_error(v_problem)); end if;
  if exists (select 1 from og.users u where u.name_key = v_key or u.email = v_key) then
    return og.err(409, 'name-taken', 'another profile already signs in with this name');
  end if;
  if p_email is not null and btrim(p_email) <> '' then
    v_email := og.fold(p_email);
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]{2,}$' or char_length(v_email) > 254 then
      return og.err(400, 'email-invalid', 'that is not an e-mail address');
    end if;
    if exists (select 1 from og.users u where u.email = v_email or u.name_key = v_email) then
      return og.err(409, 'email-taken', 'another profile already uses this e-mail address');
    end if;
  end if;
  v_id := og.new_id(12);
  insert into og.users (id, name, name_key, email, pw_hash, pw_set, admin, invited_by)
  values (v_id, v_name, v_key, v_email, og.hash_pw(p_password), now(),
          not exists (select 1 from og.users), v_inv.code)
  returning * into v_user;
  if v_inv.code is not null then
    update og.invites i set used_by = v_id, used_at = now() where i.code = v_inv.code;
  end if;
  return jsonb_build_object('status', 200, 'user', og.pub(v_user), 'token', og.new_session(v_id));
end $$;

-- POST /api/login/password. The identifier is the profile name, or its e-mail when it has one.
create function public.og_login(p_ident text, p_password text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_k text := left(og.fold(p_ident), 300);
  v_user og.users;
  v_key text;
  v_locked jsonb;
begin
  if v_k = '' or coalesce(p_password, '') = '' then return og.err(400, 'missing', 'name and password required'); end if;
  if position('@' in v_k) > 0 then select * into v_user from og.users u where u.email = v_k; end if;
  if v_user.id is null then select * into v_user from og.users u where u.name_key = v_k; end if;
  -- Counted against the profile when there is one, else against what was typed: an unknown name
  -- is paused exactly like a known one.
  v_key := case when v_user.id is null then 'id:' || v_k else 'acct:' || v_user.id end;
  perform og.one_at_a_time(v_key);
  v_locked := og.locked(v_key);
  if v_locked is not null then return v_locked; end if;
  if char_length(p_password) > 1024 or not og.pw_ok(p_password, v_user.pw_hash) then
    perform og.fail(v_key);
    return og.err(401, 'bad-credentials', 'wrong name or password');
  end if;
  if v_user.disabled then return og.err(403, 'disabled', 'this account has been disabled'); end if;
  perform og.clear(v_key);
  return jsonb_build_object('status', 200, 'user', og.pub(v_user), 'token', og.new_session(v_user.id));
end $$;

-- POST /api/logout. A session is ended by expiring it, here and below, rather than deleted:
-- og.who refuses it at once, and og.new_session clears expired ones out.
create function public.og_logout(p_token text)
returns jsonb language sql volatile security definer set search_path = '' as $$
  update og.sessions set expires = now() where token_hash = og.token_hash(p_token);
  select jsonb_build_object('status', 200, 'ok', true);
$$;

-- POST /api/logout/all: every session of the profile, on every device, ends.
create function public.og_logout_all(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_user og.users := og.who(p_token);
begin
  if v_user.id is null then return og.err(401, null, 'not signed in'); end if;
  update og.users set sv = sv + 1 where id = v_user.id;
  update og.sessions set expires = now() where user_id = v_user.id;
  return jsonb_build_object('status', 200, 'ok', true);
end $$;

-- GET /api/me. Opening the app keeps its session going: one in use never runs out, one left
-- alone for 90 days does.
create function public.og_me(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_user og.users := og.who(p_token);
begin
  if v_user.id is null then return og.err(401, null, 'not signed in'); end if;
  update og.sessions set expires = now() + interval '90 days'
  where token_hash = og.token_hash(p_token) and expires < now() + interval '89 days';
  return jsonb_build_object('status', 200, 'user', og.pub(v_user));
end $$;

-- GET /api/data
create function public.og_get_state(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user og.users := og.who(p_token); v_st og.states;
begin
  if v_user.id is null then return og.err(401, null, 'not signed in'); end if;
  select * into v_st from og.states s where s.user_id = v_user.id;
  return jsonb_build_object('status', 200, 'state', v_st.doc, 'rev', coalesce(v_st.rev, 0), 'wid', v_st.wid);
end $$;

-- GET /api/data/rev
create function public.og_get_rev(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user og.users := og.who(p_token); v_rev integer; v_wid text;
begin
  if v_user.id is null then return og.err(401, null, 'not signed in'); end if;
  select s.rev, s.wid into v_rev, v_wid from og.states s where s.user_id = v_user.id;
  return jsonb_build_object('status', 200, 'rev', coalesce(v_rev, 0), 'wid', v_wid);
end $$;

-- PUT /api/data, the write itself. The app works out the document the way PUT /api/data does
-- (frontend/src/lib/supabase-api.js, with api/sync-stamps.js) from the copy it just read here;
-- this stores it only if that copy is still the stored one (revision and write id), so two
-- devices saving at once never overwrite each other: the second gets the 409 and merges.
create function public.og_put_state(p_token text, p_doc jsonb, p_expect_rev integer, p_expect_wid text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_user og.users := og.who(p_token); v_st og.states; v_rev integer; v_new integer;
begin
  if v_user.id is null then return og.err(401, null, 'not signed in'); end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then return og.err(400, null, 'state required'); end if;
  if octet_length(p_doc::text) > 5 * 1024 * 1024 then return og.err(413, null, 'body too large'); end if;
  if coalesce(p_doc->>'_rev', '') !~ '^[0-9]{1,9}$' then return og.err(400, null, 'invalid state'); end if;
  perform og.one_at_a_time('state:' || v_user.id);
  select * into v_st from og.states s where s.user_id = v_user.id;
  v_rev := coalesce(v_st.rev, 0);
  if v_rev is distinct from p_expect_rev or v_st.wid is distinct from p_expect_wid then
    return og.err(409, 'conflict', 'conflict') || jsonb_build_object('rev', v_rev, 'wid', v_st.wid, 'state', v_st.doc);
  end if;
  v_new := (p_doc->>'_rev')::integer;
  if v_new <= v_rev then return og.err(400, null, 'invalid state'); end if;
  insert into og.states (user_id, doc, rev, wid, updated)
  values (v_user.id, p_doc, v_new, p_doc->>'_wid', now())
  on conflict (user_id) do update set doc = excluded.doc, rev = excluded.rev, wid = excluded.wid, updated = now();
  return jsonb_build_object('status', 200, 'ok', true, 'rev', v_new, 'wid', p_doc->>'_wid');
end $$;

-- GET /api/account/password
create function public.og_password_status(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user og.users := og.who(p_token);
begin
  if v_user.id is null then return og.err(401, null, 'not signed in'); end if;
  return jsonb_build_object('status', 200, 'set', v_user.pw_hash is not null, 'setAt', v_user.pw_set,
    'passkeys', 0, 'name', v_user.name, 'nameTaken', false, 'email', v_user.email);
end $$;

-- The current password, proving it is the owner who asks (api/server.js proveOwner). Null when
-- it is right; otherwise the refusal to answer with.
create function og.prove(v_user og.users, p_current text) returns jsonb language plpgsql volatile set search_path = '' as $$
declare v_key text := 'acct:' || v_user.id; v_locked jsonb;
begin
  if coalesce(p_current, '') = '' then return og.err(403, 'current-required', 'enter your current password'); end if;
  perform og.one_at_a_time(v_key);
  v_locked := og.locked(v_key);
  if v_locked is not null then return v_locked; end if;
  if char_length(p_current) > 1024 or not og.pw_ok(p_current, v_user.pw_hash) then
    perform og.fail(v_key);
    return og.err(403, 'current-wrong', 'your current password is not right');
  end if;
  perform og.clear(v_key);
  return null;
end $$;

-- POST /api/account/password: a new password, confirmed with the current one. It ends every other
-- session of the profile; the caller gets a fresh token.
create function public.og_password_change(p_token text, p_current text, p_next text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_user og.users := og.who(p_token); v_problem text; v_refused jsonb;
begin
  if v_user.id is null then return og.err(401, null, 'not signed in'); end if;
  v_problem := og.pw_problem(p_next);
  if v_problem is not null then return og.err(400, v_problem, og.pw_error(v_problem)); end if;
  v_refused := og.prove(v_user, p_current);
  if v_refused is not null then return v_refused; end if;
  update og.users set pw_hash = og.hash_pw(p_next), pw_set = now(), sv = sv + 1 where id = v_user.id;
  update og.sessions set expires = now() where user_id = v_user.id;
  update og.resets set expires = now() where user_id = v_user.id;
  return jsonb_build_object('status', 200, 'ok', true, 'token', og.new_session(v_user.id));
end $$;

-- POST /api/account/email (an empty one removes it): a second name to sign in with, confirmed
-- with the current password. Nothing is ever sent to it.
create function public.og_email(p_token text, p_email text, p_current text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_user og.users := og.who(p_token); v_email text; v_refused jsonb;
begin
  if v_user.id is null then return og.err(401, null, 'not signed in'); end if;
  if p_email is null or btrim(p_email) = '' then
    if v_user.email is null then return jsonb_build_object('status', 200, 'ok', true, 'email', null); end if;
    v_refused := og.prove(v_user, p_current);
    if v_refused is not null then return v_refused; end if;
    update og.users set email = null where id = v_user.id;
    return jsonb_build_object('status', 200, 'ok', true, 'email', null);
  end if;
  v_email := og.fold(p_email);
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]{2,}$' or char_length(v_email) > 254 then
    return og.err(400, 'email-invalid', 'that is not an e-mail address');
  end if;
  if v_email = v_user.email then return jsonb_build_object('status', 200, 'ok', true, 'email', v_email); end if;
  v_refused := og.prove(v_user, p_current);
  if v_refused is not null then return v_refused; end if;
  if exists (select 1 from og.users u where u.id <> v_user.id and (u.email = v_email or u.name_key = v_email)) then
    return og.err(409, 'email-taken', 'another profile already uses this e-mail address');
  end if;
  update og.users set email = v_email where id = v_user.id;
  return jsonb_build_object('status', 200, 'ok', true, 'email', v_email);
end $$;

-- POST /api/login/password-reset: a reset code made by the owner (og.make_reset_code, below)
-- and a new password.
create function public.og_reset_redeem(p_ident text, p_code text, p_next text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_k text := left(og.fold(p_ident), 300);
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_key text;
  v_user og.users;
  v_locked jsonb;
  v_problem text;
begin
  if v_k = '' or v_code = '' then return og.err(400, 'missing', 'name and code required'); end if;
  v_key := 'reset:' || v_k;
  perform og.one_at_a_time(v_key);
  v_locked := og.locked(v_key);
  if v_locked is not null then return v_locked; end if;
  select u.* into v_user from og.users u join og.resets r on r.user_id = u.id
  where (u.name_key = v_k or u.email = v_k) and r.expires > now()
    and r.code_hash = encode(extensions.digest('opengym-reset:' || v_code, 'sha256'), 'hex');
  if v_user.id is null then
    perform og.fail(v_key);
    return og.err(400, 'reset-invalid', 'that reset code is wrong or has expired');
  end if;
  if v_user.disabled then return og.err(403, 'disabled', 'this account has been disabled'); end if;
  v_problem := og.pw_problem(p_next);
  if v_problem is not null then return og.err(400, v_problem, og.pw_error(v_problem)); end if;
  update og.users set pw_hash = og.hash_pw(p_next), pw_set = now(), sv = sv + 1 where id = v_user.id;
  update og.resets set expires = now() where user_id = v_user.id;
  update og.sessions set expires = now() where user_id = v_user.id;
  perform og.clear(v_key);
  perform og.clear('acct:' || v_user.id);
  return jsonb_build_object('status', 200, 'user', og.pub(v_user), 'token', og.new_session(v_user.id));
end $$;
