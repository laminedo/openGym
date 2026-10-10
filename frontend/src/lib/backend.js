// Which backend this build talks to. Its own module, apart from api.js, because many tests replace
// api.js wholesale and every reader of this flag would then find it missing.
//
// SUPABASE: the free setup with no openGym server (docs/START_HERE.md), where sign-in and sync go
// to Supabase (lib/supabase-api.js). Set at build time by frontend/.env.supabase; absent
// everywhere else, and then nothing behaves any differently.
export const SUPABASE = !!import.meta.env.VITE_SUPABASE_URL
