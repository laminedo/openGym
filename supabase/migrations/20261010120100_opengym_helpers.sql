-- openGym on Supabase, part 2 of 4 (see 20261010120000_opengym_tables.sql).

-- ---------------------------------------------------------------------------- helpers --
-- Called only from the og_* functions below (which run as the owner); nobody else may.

-- How names, e-mails and sign-in identifiers are compared: NFKC, trimmed, lower-cased
-- (api/password.js nameKey).
create function og.fold(v text) returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(normalize(coalesce(v, ''), NFKC), '^\s+|\s+$', '', 'g'))
$$;

create function og.pw_input(pw text) returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(normalize(coalesce(pw, ''), NFKC), 'sha256'), 'hex')
$$;

create function og.hash_pw(pw text) returns text language sql volatile set search_path = '' as $$
  select extensions.crypt(og.pw_input(pw), extensions.gen_salt('bf', 10))
$$;

-- true only when `pw` matches `h`. No hash at all (an unknown name) does the same work against the
-- dummy hash and answers false.
create function og.pw_ok(pw text, h text) returns boolean language plpgsql volatile set search_path = '' as $$
declare d text;
begin
  if h is null then
    select s.dummy_hash into d from og.settings s;
    perform extensions.crypt(og.pw_input(pw), d);
    return false;
  end if;
  return h = extensions.crypt(og.pw_input(pw), h);
end $$;

-- The length rules of api/password.js passwordProblem. The list of common passwords is checked by
-- the app before it asks (frontend/src/lib/password-policy.js).
create function og.pw_problem(pw text) returns text language plpgsql immutable set search_path = '' as $$
declare n text := normalize(coalesce(pw, ''), NFKC);
begin
  if pw is null or char_length(n) < 10 then return 'too-short'; end if;
  if char_length(n) > 256 then return 'too-long'; end if;
  if (select count(distinct c) from regexp_split_to_table(lower(n), '') c) <= 2 then return 'too-common'; end if;
  return null;
end $$;

create function og.pw_error(problem text) returns text language sql immutable set search_path = '' as $$
  select case problem
    when 'too-short' then 'the password needs at least 10 characters'
    when 'too-long' then 'the password can have at most 256 characters'
    else 'this password is too easy to guess' end
$$;

create function og.err(st integer, code text, msg text) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('status', st, 'code', code, 'error', msg)
$$;

create function og.pub(u og.users) returns jsonb language sql immutable set search_path = '' as $$
  -- admin: false — the admin dashboard needs the openGym server; this setup has none.
  select jsonb_build_object('id', u.id, 'name', u.name, 'admin', false)
$$;

create function og.token_hash(t text) returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(coalesce(t, ''), 'sha256'), 'hex')
$$;

create function og.new_id(bytes integer) returns text language sql volatile set search_path = '' as $$
  select translate(encode(extensions.gen_random_bytes(bytes), 'base64'), '+/=', '-_')
$$;

create function og.new_session(uid text) returns text language plpgsql volatile set search_path = '' as $$
declare t text := og.new_id(32);
begin
  delete from og.sessions where expires < now();
  insert into og.sessions (token_hash, user_id, sv, expires)
    select og.token_hash(t), u.id, u.sv, now() + interval '90 days' from og.users u where u.id = uid;
  return t;
end $$;

-- The profile a session token belongs to, or a row of nulls: unknown, expired, ended by "sign out
-- everywhere" or a password change (sv), or a disabled profile.
create function og.who(t text) returns og.users language sql stable set search_path = '' as $$
  select u.* from og.sessions s join og.users u on u.id = s.user_id
  where s.token_hash = og.token_hash(t) and s.expires > now() and s.sv = u.sv and not u.disabled
$$;

create function og.wait_for(k text) returns integer language sql stable set search_path = '' as $$
  select coalesce((select greatest(0, ceil(extract(epoch from (f.locked_until - now()))))::integer
                   from og.fails f where f.key = k and f.locked_until is not null), 0)
$$;

-- One wrong answer for `k`: 5 free, then 1 minute doubling up to an hour; forgotten after a day.
create function og.fail(k text) returns void language plpgsql volatile set search_path = '' as $$
declare n integer;
begin
  delete from og.fails where last < now() - interval '2 days';
  insert into og.fails as f (key, fails, last) values (k, 1, now())
  on conflict (key) do update set
    fails = case when f.last < now() - interval '1 day' then 1 else f.fails + 1 end,
    last = now()
  returning f.fails into n;
  if n > 5 then
    update og.fails set locked_until = now() + least(interval '1 hour', interval '1 minute' * power(2, n - 6))
    where key = k;
  end if;
end $$;

create function og.clear(k text) returns void language sql volatile set search_path = '' as $$
  delete from og.fails where key = k
$$;

-- Attempts on one profile (or one typed name) run one at a time, so a burst sent at once cannot
-- all be checked under the same five free tries.
create function og.one_at_a_time(k text) returns void language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtext('og:' || k))
$$;

create function og.locked(k text) returns jsonb language sql stable set search_path = '' as $$
  select case when og.wait_for(k) > 0
    then og.err(429, 'locked', 'too many attempts, try again later') || jsonb_build_object('retryAfter', og.wait_for(k))
  end
$$;
