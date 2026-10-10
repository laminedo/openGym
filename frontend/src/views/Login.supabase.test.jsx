// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Login from './Login.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The sign-in screen on a backend with no passkeys at all (the Supabase setup, lib/backend.js):
   /api/config says `passkeys: false`. Name and password are simply the way in — no "this browser
   doesn't support passkeys", no passkey footer — and with guests off, a profile is the only door. */
const mocks = vi.hoisted(() => ({ config: { password_login: true, passkeys: false, allow_guest: false, invite_only: false } }))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ config: mocks.config, S: {}, setUser: vi.fn(), adoptProfile: vi.fn(), setGuest: vi.fn(), loadConfig: vi.fn(async () => mocks.config), pushState: vi.fn(), pullState: vi.fn() })
  const useStore = selector => selector ? selector(snap()) : snap()
  useStore.getState = snap
  return { useStore, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/api.js', () => ({
  webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), BIO: 'Face ID / Touch ID', bio: () => 'Face ID / Touch ID',
  api: vi.fn(), passkeyAssertion: vi.fn(), passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
}))
vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: 'https://example.invalid' }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn(), confirmSheet: vi.fn() }))

let host, root
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Login on a backend without passkeys', () => {
  it('offers the password and a new profile, and says nothing about passkeys', () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root.render(<Login />))
    const buttons = [...host.querySelectorAll('button')].map(b => b.textContent)
    expect(buttons).toEqual(['Sign in with password', 'Create new profile'])
    expect(host.textContent).not.toMatch(/passkey/i)
    expect(host.textContent).toContain('Each profile keeps its own plan, workouts & body weight.')
  })
})
