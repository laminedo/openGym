-- openGym on Supabase: the free "GitHub Pages + Supabase" setup (docs/START_HERE.md).
--
-- What the openGym server (api/server.js) does for sign-in and sync, as Postgres functions the app
-- calls over Supabase's REST API (frontend/src/lib/supabase-api.js): profiles with a name and a
-- password, sessions, and each profile's one document with its revision. Nothing else of the
-- server is here — no passkeys, push, photos, Coach or admin dashboard; the app hides those.
--
-- The tables live in their own schema `og`, which the REST API does not expose and the API's
-- roles (anon, authenticated) have no rights on: every read and write goes through the og_*
-- functions below, which run as their owner (SECURITY DEFINER) with an empty search_path and check
-- the caller's session token themselves. Row level security is on as well, with no policies, so
-- the tables stay closed even if the schema were ever exposed.
--
-- Passwords: bcrypt (pgcrypto, cost 10) over the SHA-256 of the NFKC-normalised password — the
-- pre-hash keeps passwords longer than bcrypt's 72 bytes whole. Wrong passwords are counted per
-- profile (5 free, then a pause of 1 minute that doubles up to 1 hour, forgotten after a day
-- without one), like the server's ACCOUNT_FAILS. Session tokens are 256 random bits, stored only as
-- their SHA-256, and last 90 days from the last time the app was opened.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists og;
revoke all on schema og from public, anon, authenticated;

-- ---------------------------------------------------------------------------- tables --

create table og.settings (
  id boolean primary key default true check (id),
  invite_only boolean not null default false,   -- sign-up needs an invite code (og.new_invite)
  allow_guest boolean not null default false,   -- "Continue without account" (never syncs)
  max_users integer not null default 25,        -- a ceiling against sign-up spam
  dummy_hash text not null                      -- checked against for an unknown name, so it takes as long
);
insert into og.settings (dummy_hash)
  values (extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf', 10)));

create table og.users (
  id text primary key,
  name text not null,
  name_key text not null unique,                -- og.fold(name): how sign-in compares names
  email text unique,                            -- optional second name to sign in with (folded)
  pw_hash text,
  pw_set timestamptz,
  created timestamptz not null default now(),
  admin boolean not null default false,         -- the first profile; nothing in the app uses it here
  disabled boolean not null default false,
  sv integer not null default 0,                -- session version: bumped to end every session
  invited_by text
);

create table og.sessions (
  token_hash text primary key,
  user_id text not null references og.users (id) on delete cascade,
  sv integer not null,
  created timestamptz not null default now(),
  expires timestamptz not null
);
create index sessions_user_id on og.sessions (user_id);

create table og.states (
  user_id text primary key references og.users (id) on delete cascade,
  doc jsonb not null,
  rev integer not null,
  wid text,
  updated timestamptz not null default now()
);

create table og.fails (
  key text primary key,
  fails integer not null default 0,
  locked_until timestamptz,
  last timestamptz not null default now()
);

create table og.invites (
  code text primary key,
  created timestamptz not null default now(),
  used_by text,
  used_at timestamptz,
  revoked boolean not null default false
);

create table og.resets (
  user_id text primary key references og.users (id) on delete cascade,
  code_hash text not null,
  expires timestamptz not null
);

alter table og.settings enable row level security;
alter table og.users enable row level security;
alter table og.sessions enable row level security;
alter table og.states enable row level security;
alter table og.fails enable row level security;
alter table og.invites enable row level security;
alter table og.resets enable row level security;
