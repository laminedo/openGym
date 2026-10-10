/* openGym with no openGym server: sign-in and sync through Supabase (docs/START_HERE.md, the free
   setup). Built in only when VITE_SUPABASE_URL is set at build time (frontend/.env.supabase).

   The app keeps talking to "/api/…" through api() (lib/api.js) exactly as before; api() hands each
   request to this module instead of the network, and the answer — or the error, with the same
   `status` and `data` the server would give — comes back in the same shape. What the server does
   for sign-in and sync runs as Postgres functions in Supabase (supabase/migrations), reached with
   one POST per call to Supabase's REST API. What needs the server itself — passkeys, push,
   photos and videos, the Coach, the admin dashboard, pairing the phone app — is absent: the
   config this answers says so, and the app hides those.

   The session is a token the functions hand out at sign-in, kept in localStorage where the
   server would have set a cookie, and sent along with every call.

   PUT /api/data is worked out here the way api/server.js does it, with the server's own stamping
   rules (api/sync-stamps.js): the document is read, checked against the revision the device last
   saw, stamped, and written back only if it is still the stored one — Supabase compares revision
   and write id inside the same call, so two devices saving at once cannot both win. */
import { stampPut } from '../../../api/sync-stamps.js'
import { passwordProblem, passwordLength, normalizeEmail, POLICY_ERRORS, EMAIL_INVALID, MAX_LENGTH } from './password-policy.js'

export const TOKEN_KEY = 'gym_sb_token'
const WID_KEEP = 50   // api/server.js: write ids kept on a document

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const record = v => isObj(v)
const records = v => (Array.isArray(v) ? v.filter(record) : [])
const clone = v => JSON.parse(JSON.stringify(v))
// api/server.js forClient: the server's own notes on a document never go to a client.
function forClient(S) {
  if (!isObj(S) || !('_unstamped' in S || '_prior' in S)) return S
  const { _unstamped, _prior, ...rest } = S
  return rest
}
const randomHex = bytes => {
  const a = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(a)
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('')
}

function memoryStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const browserStorage = () => {
  try { if (typeof localStorage !== 'undefined') return localStorage } catch { /* blocked */ }
  return memoryStorage()
}

/** An error the way lib/api.js's exchange() makes one for a refused request. */
function refusal(status, body) {
  const data = isObj(body) ? body : {}
  return Object.assign(new Error(data.error || 'HTTP ' + status), { status, data })
}

/**
 * The adapter. `url` and `key` are the Supabase project's address and publishable key.
 * Returns sbApi(path, init) → Promise of the parsed answer, like api(path, init).
 */
export function createSupabaseApi({ url, key, fetchImpl, storage, now = () => Date.now(), newWid = () => randomHex(8) } = {}) {
  const base = String(url || '').replace(/\/+$/, '')
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a))
  const store = storage || browserStorage()
  let lastName = ''   // the signed-in profile's name, for the password rules (a password may not be the name)

  const token = () => { try { return store.getItem(TOKEN_KEY) || '' } catch { return '' } }
  const setToken = t => { try { if (t) store.setItem(TOKEN_KEY, t); else store.removeItem(TOKEN_KEY) } catch { /* blocked */ } }

  // One Postgres function over Supabase's REST API. A publishable key (sb_publishable_…) goes in
  // `apikey` only; a legacy anon key is a JWT and goes in Authorization as well.
  async function rpc(fn, args, signal) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', apikey: key }
    if (!String(key).startsWith('sb_')) headers.Authorization = 'Bearer ' + key
    const r = await doFetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args || {}), cache: 'no-store', signal })
    let body = null
    try { body = await r.json() } catch { /* not JSON */ }
    // Supabase itself refusing (a wrong key, a function missing, an outage) is the service being
    // unavailable, never "not signed in": a 401 from the gateway must not sign anybody out.
    if (!r.ok) throw Object.assign(new Error((body && (body.message || body.error)) || 'HTTP ' + r.status), { status: 503, code: 'backend', data: {} })
    if (!isObj(body) || typeof body.status !== 'number') throw Object.assign(new Error('The server answered with something other than openGym data.'), { status: r.status, code: 'bad-response', data: {} })
    const { status, ...rest } = body
    if (status !== 200) throw refusal(status, rest)
    return rest
  }

  const bodyOf = init => {
    if (!init || init.body == null) return {}
    if (typeof init.body !== 'string') return isObj(init.body) ? init.body : {}
    try { const b = JSON.parse(init.body); return isObj(b) ? b : null } catch { return null }
  }
  const text = v => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
  const policyRefusal = problem => refusal(400, { error: POLICY_ERRORS[problem], code: problem })
  const signedIn = r => { if (r.token) setToken(r.token); if (r.user?.name) lastName = r.user.name; return { user: r.user } }

  async function putData(body, signal) {
    if (!body.state || typeof body.state !== 'object') throw refusal(400, { error: 'state required' })
    if (!Array.isArray(body.state) && !Object.keys(body.state).some(k => k !== '_rev' && k !== '_ts')) throw refusal(400, { error: 'state required' })
    const list = v => v == null || Array.isArray(v)
    if (Array.isArray(body.state) || !list(body.state.workouts) || !list(body.state.routines)) throw refusal(400, { error: 'invalid state' })
    for (const k of ['workouts', 'routines']) if (Array.isArray(body.state[k])) body.state[k] = records(body.state[k])
    // A write without a baseRev (a backup restored over the profile) overwrites: if another device
    // slips in between the read and the write, it is simply read again and written over.
    for (let attempt = 0; attempt < 5; attempt++) {
      const got = await rpc('og_get_state', { p_token: token() }, signal)
      const cur = isObj(got.state) ? got.state : null
      const curRev = got.rev || 0
      const curWid = got.wid ?? null
      if ((body.baseRev != null && body.baseRev !== curRev) ||
          (body.baseRev != null && typeof body.baseWid === 'string' && cur?._wid && body.baseWid !== cur._wid)) {
        throw refusal(409, { error: 'conflict', rev: curRev, state: forClient(cur) })
      }
      const next = clone(body.state)
      delete next.active   // in-progress workouts stay device-local
      const storedReset = Number(cur?.resetAt) || 0
      if (storedReset > (Number(next.resetAt) || 0)) {
        next.resetAt = cur.resetAt
        if (isObj(cur.resetIds)) next.resetIds = cur.resetIds
        else delete next.resetIds
      }
      const report = {}
      try { stampPut(cur, next, { overRead: body.baseRev != null && body.baseRev === curRev, stamped: body.stamped === true, now: now(), report }) }
      catch (e) { if (e instanceof RangeError) throw refusal(400, { error: 'invalid state' }); throw e }
      next._rev = curRev + (report.changed ? 2 : 1)
      next._wids = [...(Array.isArray(cur?._wids) ? cur._wids : []), ...(cur?._wid ? [cur._wid] : [])]
        .filter(x => typeof x === 'string').slice(-WID_KEEP)
      next._wid = newWid()
      try {
        await rpc('og_put_state', { p_token: token(), p_doc: next, p_expect_rev: curRev, p_expect_wid: curWid }, signal)
      } catch (e) {
        if (e.status !== 409) throw e
        // Another device wrote between the read and the write. For a push over a revision this
        // device saw, that is the server's 409 with the newer document; an overwrite goes again.
        if (body.baseRev != null) throw refusal(409, { error: 'conflict', rev: e.data.rev || 0, state: forClient(e.data.state ?? null) })
        continue
      }
      return { ok: true, ts: next._ts || null, rev: curRev + 1, wid: next._wid }
    }
    throw refusal(503, { error: 'the profile kept changing while saving, try again', code: 'busy' })
  }

  const routes = {
    'GET /api/config': async (b, s) => rpc('og_config', {}, s),
    'GET /api/me': async (b, s) => {
      if (!token()) throw refusal(401, { error: 'not signed in' })
      const r = await rpc('og_me', { p_token: token() }, s)
      lastName = r.user?.name || lastName
      return r
    },
    'POST /api/logout': async (b, s) => {
      if (token()) await rpc('og_logout', { p_token: token() }, s)
      setToken('')
      return { ok: true }
    },
    'POST /api/logout/all': async (b, s) => {
      const r = await rpc('og_logout_all', { p_token: token() }, s)
      setToken('')
      return r
    },
    'GET /api/data': async (b, s) => {
      const r = await rpc('og_get_state', { p_token: token() }, s)
      return { state: forClient(r.state ?? null), rev: r.rev || 0 }
    },
    'GET /api/data/rev': async (b, s) => {
      const r = await rpc('og_get_rev', { p_token: token() }, s)
      return { rev: r.rev || 0, ...(r.wid ? { wid: r.wid } : {}) }
    },
    'PUT /api/data': (b, s) => putData(b, s),
    'POST /api/login/password': async (b, s) => {
      const ident = text(b.identifier ?? b.name ?? b.email).slice(0, 300)
      const pw = typeof b.password === 'string' ? b.password : ''
      if (!ident.trim() || !pw) throw refusal(400, { error: 'name and password required', code: 'missing' })
      // Longer than any password that can be set: wrong, without sending a megabyte to find out.
      // Supabase still counts it, so a pause for wrong ones stays where it is.
      return signedIn(await rpc('og_login', { p_ident: ident, p_password: passwordLength(pw) <= MAX_LENGTH ? pw : 'x'.repeat(1025) }, s))
    },
    'POST /api/register/password': async (b, s) => {
      const name = text(b.name).trim().slice(0, 40)
      if (!name) throw refusal(400, { error: 'name required', code: 'missing' })
      const problem = passwordProblem(b.password, name)
      if (problem) throw policyRefusal(problem)
      const hasEmail = typeof b.email === 'string' && b.email.trim() !== ''
      const email = hasEmail ? normalizeEmail(b.email) : null
      if (hasEmail && !email) throw refusal(400, EMAIL_INVALID)
      return signedIn(await rpc('og_register', { p_name: name, p_password: b.password, p_code: text(b.code), p_email: email }, s))
    },
    'POST /api/login/password-reset': async (b, s) => {
      const ident = text(b.identifier ?? b.name ?? b.email).slice(0, 300)
      if (!ident.trim() || !text(b.code)) throw refusal(400, { error: 'name and code required', code: 'missing' })
      const problem = passwordProblem(b.next, ident)
      if (problem) throw policyRefusal(problem)
      return signedIn(await rpc('og_reset_redeem', { p_ident: ident, p_code: text(b.code).slice(0, 64), p_next: b.next }, s))
    },
    'GET /api/account/password': async (b, s) => {
      const r = await rpc('og_password_status', { p_token: token() }, s)
      lastName = r.name || lastName
      return r
    },
    'POST /api/account/password': async (b, s) => {
      const problem = passwordProblem(b.next, lastName)
      if (problem) throw policyRefusal(problem)
      const r = await rpc('og_password_change', { p_token: token(), p_current: typeof b.current === 'string' ? b.current : '', p_next: b.next }, s)
      // Every other session ended with the change; this device carries on with the new one.
      if (r.token) setToken(r.token)
      return { ok: true }
    },
    // A profile here has no passkey, so its password is always its only way in (api/server.js).
    'DELETE /api/account/password': async () => { throw refusal(409, { error: 'the password is the only way into this profile', code: 'last-way-in' }) },
    'POST /api/account/email': async (b, s) => {
      const blank = b.email == null || (typeof b.email === 'string' && b.email.trim() === '')
      const email = blank ? null : normalizeEmail(b.email)
      if (!blank && !email) throw refusal(400, EMAIL_INVALID)
      return rpc('og_email', { p_token: token(), p_email: email, p_current: typeof b.current === 'string' ? b.current : '' }, s)
    },
    'DELETE /api/account/email': async (b, s) => rpc('og_email', { p_token: token(), p_email: null, p_current: typeof b.current === 'string' ? b.current : '' }, s),
    // The live "training now" list is part of the admin dashboard, which this setup does not have.
    'POST /api/activity': async () => ({ ok: true }),
  }

  return async function sbApi(path, init, signal) {
    const method = String(init?.method || 'GET').toUpperCase()
    const route = routes[method + ' ' + String(path).split('?')[0]]
    if (!route) throw refusal(404, { error: 'not found' })
    const body = bodyOf(init)
    if (body === null) throw refusal(400, { error: 'invalid json' })
    return route(body, signal)
  }
}
