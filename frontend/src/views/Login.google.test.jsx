// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* "Continue with Google" on the sign-in screen. Only an instance whose /api/config says `google`
   shows it; there it is the first way in, works in a browser that cannot make a passkey, and on
   an invite-only instance the sign-up sheet sends the invite code along. */
const mocks = vi.hoisted(() => {
  const state = { webauthn: true, config: null, sheets: [], toasts: [], went: [], logoutSettled: true }
  state.snapshot = () => ({
    config: state.config, S: {},
    setUser: vi.fn(), adoptProfile: vi.fn(), setGuest: vi.fn(), loadConfig: vi.fn(async () => state.config),
    pushState: vi.fn(), pullState: vi.fn(), finishOwedLogout: async () => state.logoutSettled,
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: m => mocks.toasts.push(m), openSheet: render => { mocks.sheets.push(render); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/api.js', () => ({
  webauthnOK: () => mocks.webauthn, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), BIO: 'your fingerprint', bio: () => 'your fingerprint',
  api: vi.fn(), passkeyAssertion: vi.fn(), passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
}))
vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: 'https://example.invalid' }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn(), confirmSheet: vi.fn() }))

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const buttons = host => [...host.querySelectorAll('button')].map(b => b.textContent)
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const realLocation = window.location

beforeEach(() => {
  mocks.webauthn = true; mocks.config = null; mocks.sheets.length = 0; mocks.toasts.length = 0; mocks.went.length = 0; mocks.logoutSettled = true
  // The button is a page load; the test only needs to know where it would have gone.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { pathname: '/', search: '', hash: '', href: 'http://localhost/', origin: 'http://localhost', assign: u => mocks.went.push(u) }
  })
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) })
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('Login with Google sign-in', () => {
  it('an instance without it shows no Google button', () => {
    const page = mount(<Login />)
    expect(buttons(page)).not.toContain('Continue with Google')
  })

  it('where it is set up, it is the first way in, and it goes to the server, not to Google directly', async () => {
    mocks.config = { google: true, allow_guest: true }
    const page = mount(<Login />)
    expect(buttons(page)[0]).toBe('Continue with Google')
    expect(buttons(page)).toContain('Sign in with passkey')
    await act(async () => button(page, 'Continue with Google').click())
    expect(mocks.went).toEqual(['/api/auth/google'])
  })

  it('in a browser without passkeys it is a way in instead of the "stay local" note', () => {
    mocks.webauthn = false
    mocks.config = { google: true, allow_guest: true }
    const page = mount(<Login />)
    expect(buttons(page)[0]).toBe('Continue with Google')
    expect(page.textContent).not.toContain("This browser doesn't do passkeys")
    expect(buttons(page)).toContain('Continue without account')
  })

  it('invite-only: the sign-up sheet takes the code along, and will not leave without one', async () => {
    mocks.config = { google: true, invite_only: true, allow_guest: false }
    const page = mount(<Login />)
    act(() => button(page, 'Create new profile').click())
    const Sheet = () => mocks.sheets[0](() => {})
    const sheet = mount(<Sheet />)
    await act(async () => {})
    await act(async () => button(sheet, 'Continue with Google').click())
    expect(mocks.went).toEqual([])
    expect(mocks.toasts).toContain('An invite code is required')
    const code = [...sheet.querySelectorAll('input')].find(i => i.placeholder === 'Invite code')
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    act(() => { setValue.call(code, 'welcome1'); code.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => button(sheet, 'Continue with Google').click())
    expect(mocks.went).toEqual(['/api/auth/google?invite=WELCOME1'])
  })

  it('opened at another address than Google sends people back to, it says where instead of offering a dead button', () => {
    mocks.webauthn = false
    mocks.config = { google: true, google_url: 'https://gym.example.com/', allow_guest: true }
    // The page is on a LAN address (the location stub is http://localhost).
    const page = mount(<Login />)
    expect(buttons(page)).not.toContain('Continue with Google')
    expect(page.textContent).toContain('Google sign-in only works at this address:')
    expect(page.querySelector('a[href="https://gym.example.com/"]').textContent).toBe('gym.example.com')
    // …and the old note about this browser is back.
    expect(page.textContent).toContain("This browser doesn't do passkeys")
  })

  it('at its own address there is no such note', () => {
    mocks.config = { google: true, google_url: 'http://localhost/', allow_guest: true }
    const page = mount(<Login />)
    expect(buttons(page)[0]).toBe('Continue with Google')
    expect(page.textContent).not.toContain('only works at this address')
  })

  it('a sign-out the server never answered is finished before leaving for Google; unreachable, it stays', async () => {
    mocks.config = { google: true, allow_guest: true }
    mocks.logoutSettled = false
    const page = mount(<Login />)
    await act(async () => button(page, 'Continue with Google').click())
    expect(mocks.went).toEqual([])
    expect(mocks.toasts).toContain('Offline. The server can’t be reached')
  })
})
