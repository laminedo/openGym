import { beforeEach, describe, expect, it } from 'vitest'
import { createSupabaseApi, TOKEN_KEY } from './supabase-api.js'

/* lib/supabase-api.js against a stand-in for the Postgres functions of supabase/migrations: the
   same answers ({ status, … }), in memory. The functions themselves are tested against a real
   Postgres in the end-to-end run; this holds the app-side half — the routes, the token, the error
   shapes the store reads, and PUT /api/data worked out the way api/server.js does it. */
function fakeSupabase() {
  const db = { users: new Map(), tokens: new Map(), states: new Map(), calls: [], failNext: null, beforePut: null }
  let n = 0
  const who = t => db.users.get(db.tokens.get(t)) || null
  const err = (status, code, error) => ({ status, code, error })
  const fns = {
    og_config: () => ({ status: 200, invite_only: false, allow_guest: false, password_login: true, passkeys: false }),
    og_register: a => {
      const k = a.p_name.trim().toLowerCase()
      if ([...db.users.values()].some(u => u.key === k)) return err(409, 'name-taken', 'another profile already signs in with this name')
      const u = { id: 'u' + ++n, name: a.p_name, key: k, pw: a.p_password }
      db.users.set(u.id, u)
      const tok = 't' + ++n; db.tokens.set(tok, u.id)
      return { status: 200, user: { id: u.id, name: u.name, admin: false }, token: tok }
    },
    og_login: a => {
      const u = [...db.users.values()].find(x => x.key === a.p_ident.trim().toLowerCase())
      if (!u || u.pw !== a.p_password) return err(401, 'bad-credentials', 'wrong name or password')
      const tok = 't' + ++n; db.tokens.set(tok, u.id)
      return { status: 200, user: { id: u.id, name: u.name, admin: false }, token: tok }
    },
    og_me: a => (who(a.p_token) ? { status: 200, user: { id: who(a.p_token).id, name: who(a.p_token).name, admin: false } } : err(401, null, 'not signed in')),
    og_logout: a => { db.tokens.delete(a.p_token); return { status: 200, ok: true } },
    og_get_state: a => {
      const u = who(a.p_token); if (!u) return err(401, null, 'not signed in')
      const s = db.states.get(u.id)
      return { status: 200, state: s ? structuredClone(s.doc) : null, rev: s ? s.rev : 0, wid: s ? s.wid : null }
    },
    og_get_rev: a => { const u = who(a.p_token); if (!u) return err(401, null, 'not signed in'); const s = db.states.get(u.id); return { status: 200, rev: s?.rev || 0, wid: s?.wid ?? null } },
    og_put_state: a => {
      const u = who(a.p_token); if (!u) return err(401, null, 'not signed in')
      db.beforePut?.(u); db.beforePut = null
      const s = db.states.get(u.id)
      if ((s?.rev || 0) !== a.p_expect_rev || (s?.wid ?? null) !== a.p_expect_wid) return { ...err(409, 'conflict', 'conflict'), rev: s?.rev || 0, wid: s?.wid ?? null, state: s ? s.doc : null }
      db.states.set(u.id, { doc: structuredClone(a.p_doc), rev: a.p_doc._rev, wid: a.p_doc._wid })
      return { status: 200, ok: true, rev: a.p_doc._rev, wid: a.p_doc._wid }
    },
    og_password_change: a => (who(a.p_token) ? { status: 200, ok: true, token: 'fresh' } : err(401, null, 'not signed in')),
  }
  const fetchImpl = async (url, init) => {
    const fn = url.split('/rpc/')[1]
    const args = JSON.parse(init.body)
    db.calls.push({ fn, args, headers: init.headers, method: init.method })
    if (db.failNext) { const f = db.failNext; db.failNext = null; return f }
    const body = fns[fn] ? fns[fn](args) : null
    if (!body) return { ok: false, status: 404, json: async () => ({ message: 'Could not find the function' }) }
    return { ok: true, status: 200, json: async () => body }
  }
  return { db, fetchImpl }
}
function memStore() { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), m } }

let sb, store, api, wids
beforeEach(() => {
  sb = fakeSupabase(); store = memStore(); wids = 0
  api = createSupabaseApi({ url: 'https://proj.supabase.co/', key: 'sb_publishable_x', fetchImpl: sb.fetchImpl, storage: store, now: () => 1000, newWid: () => 'w' + ++wids })
})
const put = (body) => api('/api/data', { method: 'PUT', body: JSON.stringify(body) })
const caught = p => p.then(() => { throw new Error('expected a refusal') }, e => e)

describe('the routes', () => {
  it('config says what this setup has: passwords, no passkeys', async () => {
    expect(await api('/api/config')).toEqual({ invite_only: false, allow_guest: false, password_login: true, passkeys: false })
    expect(sb.db.calls[0].headers.apikey).toBe('sb_publishable_x')
    expect(sb.db.calls[0].headers.Authorization).toBeUndefined()   // a publishable key is not a JWT
    expect(sb.db.calls[0].method).toBe('POST')
  })
  it('a legacy anon key goes in Authorization as well', async () => {
    const legacy = createSupabaseApi({ url: 'https://p.supabase.co', key: 'eyJhbGciOi.x.y', fetchImpl: sb.fetchImpl, storage: store })
    await legacy('/api/config')
    expect(sb.db.calls[0].headers.Authorization).toBe('Bearer eyJhbGciOi.x.y')
  })
  it('signing up and in keeps the session token, /api/me uses it, signing out drops it', async () => {
    const r = await api('/api/register/password', { method: 'POST', body: JSON.stringify({ name: 'Ana', password: 'correct horse battery', code: '' }) })
    expect(r).toEqual({ user: { id: expect.any(String), name: 'Ana', admin: false } })
    expect(store.getItem(TOKEN_KEY)).toBeTruthy()
    expect((await api('/api/me')).user.name).toBe('Ana')
    await api('/api/logout', { method: 'POST', body: '{}' })
    expect(store.getItem(TOKEN_KEY)).toBeNull()
    expect((await caught(api('/api/me'))).status).toBe(401)
    const back = await api('/api/login/password', { method: 'POST', body: JSON.stringify({ name: 'ana', password: 'correct horse battery' }) })
    expect(back.user.name).toBe('Ana')
  })
  it('refusals carry the status and the code the screens read, like the server', async () => {
    const weak = await caught(api('/api/register/password', { method: 'POST', body: JSON.stringify({ name: 'Ana', password: 'Password123!' }) }))
    expect(weak.status).toBe(400); expect(weak.data.code).toBe('too-common')
    expect(sb.db.calls).toHaveLength(0)   // checked before anything is sent
    const badMail = await caught(api('/api/register/password', { method: 'POST', body: JSON.stringify({ name: 'Ana', password: 'correct horse battery', email: 'nope' }) }))
    expect(badMail.data.code).toBe('email-invalid')
    await api('/api/register/password', { method: 'POST', body: JSON.stringify({ name: 'Ana', password: 'correct horse battery' }) })
    const taken = await caught(api('/api/register/password', { method: 'POST', body: JSON.stringify({ name: 'ANA', password: 'another fine password' }) }))
    expect(taken.status).toBe(409); expect(taken.data.code).toBe('name-taken'); expect(taken.message).toBe('another profile already signs in with this name')
    const wrong = await caught(api('/api/login/password', { method: 'POST', body: JSON.stringify({ name: 'Ana', password: 'nope nope nope' }) }))
    expect(wrong.status).toBe(401); expect(wrong.data.code).toBe('bad-credentials')
  })
  it('Supabase itself failing is the service being unavailable — never "not signed in"', async () => {
    sb.db.failNext = { ok: false, status: 401, json: async () => ({ message: 'Invalid API key' }) }
    const e = await caught(api('/api/config'))
    expect(e.status).toBe(503)
    sb.db.failNext = { ok: true, status: 200, json: async () => { throw new SyntaxError('html') } }
    expect((await caught(api('/api/config'))).data).toEqual({})
  })
  it('what this setup does not have answers 404, without a request', async () => {
    for (const [m, p] of [['GET', '/api/push/public-key'], ['POST', '/api/pair/create'], ['GET', '/api/account/passkeys'], ['GET', '/api/admin/users'], ['POST', '/api/coach/forget']]) {
      expect((await caught(api(p, { method: m, body: '{}' }))).status, p).toBe(404)
    }
    expect(sb.db.calls).toHaveLength(0)
    expect(await api('/api/activity', { method: 'POST', body: '{}' })).toEqual({ ok: true })
  })
  it('a new password keeps this device signed in with the fresh session', async () => {
    await api('/api/register/password', { method: 'POST', body: JSON.stringify({ name: 'Ana', password: 'correct horse battery' }) })
    const weak = await caught(api('/api/account/password', { method: 'POST', body: JSON.stringify({ next: 'ana', current: 'correct horse battery' }) }))
    expect(weak.data.code).toBe('too-short')
    expect(await api('/api/account/password', { method: 'POST', body: JSON.stringify({ next: 'a whole new password', current: 'correct horse battery' }) })).toEqual({ ok: true })
    expect(store.getItem(TOKEN_KEY)).toBe('fresh')
    expect((await caught(api('/api/account/password', { method: 'DELETE', body: '{}' }))).data.code).toBe('last-way-in')
  })
})

describe('PUT /api/data, as api/server.js does it', () => {
  beforeEach(async () => { await api('/api/register/password', { method: 'POST', body: JSON.stringify({ name: 'Ana', password: 'correct horse battery' }) }) })
  const doc = over => ({ _ts: 5, unit: 'kg', workouts: [{ id: 'a', d: '2026-10-01' }], routines: [], ...over })

  it('the first push makes revision 1; the answer is the server\'s', async () => {
    const r = await put({ state: doc(), baseRev: 0, stamped: true })
    expect(r).toEqual({ ok: true, ts: 5, rev: 1, wid: 'w1' })
    const got = await api('/api/data')
    expect(got.rev).toBe(1)
    expect(got.state._rev).toBe(1)
    expect(got.state._wid).toBe('w1')
    expect(await api('/api/data/rev')).toEqual({ rev: 1, wid: 'w1' })
  })
  it('a push over a revision another device has passed is the 409, with that device\'s document', async () => {
    await put({ state: doc(), baseRev: 0, stamped: true })
    await put({ state: doc({ workouts: [{ id: 'a' }, { id: 'b' }] }), baseRev: 1, baseWid: 'w1', stamped: true })
    const e = await caught(put({ state: doc({ workouts: [{ id: 'c' }] }), baseRev: 1, baseWid: 'w1', stamped: true }))
    expect(e.status).toBe(409)
    expect(e.data.rev).toBe(2)
    expect(e.data.state.workouts.map(w => w.id)).toEqual(['a', 'b'])
  })
  it('two devices saving at the same moment: the slower one gets the 409, never a silent overwrite', async () => {
    await put({ state: doc(), baseRev: 0, stamped: true })
    // Another device's write lands between this push's read and its write.
    sb.db.beforePut = u => sb.db.states.set(u.id, { doc: { ...doc({ workouts: [{ id: 'other' }] }), _rev: 2, _wid: 'x' }, rev: 2, wid: 'x' })
    const e = await caught(put({ state: doc({ workouts: [{ id: 'mine' }] }), baseRev: 1, baseWid: 'w1', stamped: true }))
    expect(e.status).toBe(409)
    expect(e.data.state.workouts.map(w => w.id)).toEqual(['other'])
  })
  it('a replace (no baseRev) is written over whatever is there', async () => {
    await put({ state: doc(), baseRev: 0, stamped: true })
    sb.db.beforePut = u => sb.db.states.set(u.id, { doc: { ...doc(), _rev: 2, _wid: 'x' }, rev: 2, wid: 'x' })
    const r = await put({ state: doc({ workouts: [{ id: 'restored' }] }) })
    expect(r.rev).toBe(3)
    expect((await api('/api/data')).state.workouts.map(w => w.id)).toEqual(['restored'])
  })
  it('the running workout stays on the device, and a reset stamp only moves forward', async () => {
    await put({ state: doc({ resetAt: 50, resetIds: { workouts: ['old'] } }), baseRev: 0, stamped: true })
    await put({ state: doc({ active: { id: 'running' }, resetAt: 10 }), baseRev: 1, baseWid: 'w1', stamped: true })
    const { state } = await api('/api/data')
    expect(state.active).toBeUndefined()
    expect(state.resetAt).toBe(50)
    expect(state.resetIds).toEqual({ workouts: ['old'] })
    expect(state._wids).toEqual(['w1'])
  })
  it('refuses what the server refuses', async () => {
    expect((await caught(put({ state: {} }))).status).toBe(400)
    expect((await caught(put({ state: { _rev: 3 } }))).status).toBe(400)
    expect((await caught(put({ state: { workouts: 'no' } }))).data.error).toBe('invalid state')
    expect((await caught(put({ state: [1] }))).status).toBe(400)
  })
  it('entries that are not objects are dropped, not stored', async () => {
    await put({ state: doc({ workouts: [null, 3, { id: 'a' }], routines: ['x', { id: 'r' }] }), baseRev: 0, stamped: true })
    const { state } = await api('/api/data')
    expect(state.workouts).toEqual([{ id: 'a' }])
    expect(state.routines).toEqual([{ id: 'r' }])
  })
})
