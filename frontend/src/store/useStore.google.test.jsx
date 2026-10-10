// @vitest-environment happy-dom

/* Back from "Continue with Google" (lib/google.js): the server lands the browser on the app with
   ?google=<result> and, on ok/new, a session cookie. Boot takes the word off the address and
   treats the account it then finds as one just signed in to — the same adoption a passkey
   sign-in starts — so what this device logged as a guest is offered to the profile instead of
   being pushed over it or dropped. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ asked: [], answer: true, server: null, puts: [] }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: async extras => { h.asked.push(extras); return h.answer } }))

// A fresh store per test: an adoption is module state, and one still settling from the test
// before would answer for the next one's.
let api, DEF, useStore

const USER = { id: 'g1', name: 'Ana', admin: false, google: 'ana@example.com' }
const workout = (id, d) => ({ id, d, start: 1, end: 2, entries: [] })
// The adoption runs on after boot returns (it asks, reads the server again, writes): wait for
// what the test expects, or two seconds, whichever comes first, then let the last write land.
const until = async cond => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 10))
  await new Promise(r => setTimeout(r, 20))
}
const ids = () => useStore.getState().S.workouts.map(w => w.id).sort()

function serve() {
  api.mockImplementation(async (path, init = {}) => {
    if (path === '/api/config') return { allow_guest: true, google: true }
    if (path === '/api/me') return { user: USER }
    if (path === '/api/data' && (init.method || 'GET') === 'GET') return { state: structuredClone(h.server), rev: 3 }
    if (path === '/api/data/rev') return { rev: 3 }
    if (path === '/api/data' && init.method === 'PUT') { h.puts.push(JSON.parse(init.body)); return { ok: true, rev: 4 } }
    throw new Error('unexpected ' + path)
  })
}
// A guest's copy on this device: one workout of its own, never signed in here.
function guestDevice() {
  const S = { ...structuredClone(DEF), _ts: Date.now(), workouts: [workout('w-device', '2026-10-09')] }
  localStorage.setItem('gym_state_v1', JSON.stringify(S))
  localStorage.setItem('gym_guest', '1')
  useStore.setState({ S })
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  ;({ api } = await import('../lib/api.js'))
  ;({ DEF, useStore } = await import('./useStore.js'))
  h.asked.length = 0; h.puts.length = 0; h.answer = true
  h.server = { ...structuredClone(DEF), workouts: [workout('w-phone', '2026-10-01')], _rev: 3 }
  useStore.setState({ S: structuredClone(DEF), user: null, ready: false, config: null, linkCode: null, googleResult: '' })
})
afterEach(() => { history.replaceState({}, '', '/'); useStore.setState({ user: null, ready: false, config: null, googleResult: '' }) })

describe('boot back from Google', () => {
  it('takes ?google= off the address and keeps the result for App to announce', async () => {
    history.replaceState({}, '', '/gym/?google=ok&utm=x#/home')
    serve()
    await useStore.getState().boot()
    expect(useStore.getState().googleResult).toBe('ok')
    expect(window.location.search).toBe('?utm=x')
    expect(window.location.pathname).toBe('/gym/')
    expect(window.location.hash).toBe('#/home')
    expect(useStore.getState().user.google).toBe('ana@example.com')
  })

  it('offers this device\'s own workouts to the Google profile, as a passkey sign-in does', async () => {
    guestDevice()
    history.replaceState({}, '', '/?google=ok')
    serve()
    await useStore.getState().boot()
    await until(() => h.puts.length > 0)
    expect(h.asked).toHaveLength(1)
    expect(h.asked[0].workouts).toBe(1)
    // Added: the profile keeps what the other devices logged, and gains this one's.
    expect(ids()).toEqual(['w-device', 'w-phone'])
    expect(h.puts.at(-1).state.workouts.map(w => w.id).sort()).toEqual(['w-device', 'w-phone'])
  })

  it('declined, the device takes the profile as it is', async () => {
    guestDevice()
    h.answer = false
    history.replaceState({}, '', '/?google=new')
    serve()
    await useStore.getState().boot()
    await until(() => h.asked.length > 0 && ids().join() === 'w-phone')
    expect(h.asked).toHaveLength(1)
    expect(ids()).toEqual(['w-phone'])
    // Nothing of this device's went to the profile.
    expect(h.puts.flatMap(p => p.state.workouts.map(w => w.id))).not.toContain('w-device')
  })

  it('a result that is not a sign-in starts no adoption', async () => {
    guestDevice()
    history.replaceState({}, '', '/?google=cancelled')
    api.mockImplementation(async path => {
      if (path === '/api/config') return { allow_guest: true, google: true }
      if (path === '/api/me') throw Object.assign(new Error('not signed in'), { status: 401 })
      throw new Error('unexpected ' + path)
    })
    await useStore.getState().boot()
    expect(useStore.getState().googleResult).toBe('cancelled')
    expect(useStore.getState().user).toBeNull()
    expect(h.asked).toHaveLength(0)
    expect(window.location.search).toBe('')
  })

  it('finishOwedLogout: a sign-out the server never answered is finished, or stays owed while unreachable', async () => {
    localStorage.setItem('gym_logout_owed', '1')
    api.mockImplementation(async () => { throw Object.assign(new TypeError('Failed to fetch'), { status: 0 }) })
    expect(await useStore.getState().finishOwedLogout()).toBe(false)
    expect(localStorage.getItem('gym_logout_owed')).toBe('1')
    api.mockImplementation(async path => { if (path === '/api/logout') return { ok: true }; throw new Error('unexpected ' + path) })
    expect(await useStore.getState().finishOwedLogout()).toBe(true)
    expect(localStorage.getItem('gym_logout_owed')).toBeNull()
    // Nothing owed: no request at all.
    api.mockClear()
    expect(await useStore.getState().finishOwedLogout()).toBe(true)
    expect(api).not.toHaveBeenCalled()
  })
})
