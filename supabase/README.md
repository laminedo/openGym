# openGym on Supabase

The free setup of this fork: the app on GitHub Pages, and instead of the openGym server
(`api/`), a Supabase project for sign-in and sync. The person-facing guide is
[docs/START_HERE.md](../docs/START_HERE.md).

## How it fits together

- `migrations/` creates everything, in order: the tables in a schema of their own (`og`), helpers,
  the functions the app calls (`public.og_*`), and the owner's tools. It is the server's sign-in
  and sync (`api/server.js`, `api/password.js`) as Postgres functions:
  - profiles with a name and a password (bcrypt over SHA-256, pgcrypto)
  - session tokens (stored hashed, 90 days from last use)
  - the wrong-password pause (5 free, then 1 minute doubling to an hour)
  - one document per profile, written only over the revision and write id it was read at
- `frontend/src/lib/supabase-api.js` answers the app's `/api/*` requests by calling those
  functions over Supabase's REST API (`POST /rest/v1/rpc/og_*`), in the shapes the server answers.
  `PUT /api/data` is worked out there with the server's own stamping rules
  (`api/sync-stamps.js`).
- `frontend/.env.supabase` names the project (URL and publishable key, both public by design).
  `npm run build -- --mode supabase` builds the app for it, and `.github/workflows/pages.yml`
  does that and publishes to GitHub Pages on every push to `main`. Builds without that mode are
  the usual openGym and contain none of this.

## Security model

- The REST API's roles (`anon`, `authenticated`) have no rights on schema `og` or its tables, and
  row level security is on there with no policies. Supabase's advisor lists both as notes
  ("RLS enabled, no policy"; "public can execute SECURITY DEFINER function"). Both are
  intended: the `og_*` functions are the API.
- Every `og_*` function is `SECURITY DEFINER` with `search_path = ''` and checks the caller's
  session token itself; nothing returns another profile's data.
- Not here: passkeys, push, media uploads, the Coach, the admin dashboard and phone pairing. The
  app hides them (`frontend/src/lib/backend.js`).

## Changing it

Add a new migration file rather than editing an applied one. Test it against a local Postgres
first. The functions run unchanged on Postgres 17 with roles `anon` and `authenticated` and a
schema `extensions` holding pgcrypto, plus PostgREST in front for the app.
