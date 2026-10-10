// "Continue with Google" (api/google.js, docs/GOOGLE_SIGN_IN.md). The whole sign-in happens in
// page loads, not fetches: the button sends the browser to the server, the server to Google, and
// Google back to the server, which lands the browser on the app again with `?google=<result>` on
// the address. Boot reads that word and takes it off the address (like the device-link code in
// device-link.js), and the app says how it went once it is up.
import { appBase } from './app-base.js'
import { t } from './i18n.js'

// Only where the server has it set up (/api/config `google`). Not in the mobile app, whose
// WebView Google refuses to sign in from; a paired phone signs in through pairing instead.
export const googleOn = (config, { mobile = false } = {}) => !mobile && !!config?.google

// The button's destination: this app's own address, a subpath deployment included, plus the
// invite code of an invite-only instance, which the server keeps until Google is done.
export function googleStartUrl(invite = '', loc = typeof location !== 'undefined' ? location : null) {
  const code = String(invite || '').trim()
  return appBase(loc) + 'api/auth/google' + (code ? '?invite=' + encodeURIComponent(code) : '')
}

const RESULTS = new Set(['ok', 'new', 'cancelled', 'failed', 'invite', 'disabled'])

// What the server said about the sign-in that just finished, or '' — anything else on the
// address is ignored, so a hand-made link cannot put arbitrary text on screen.
export function googleResultFromSearch(search = '') {
  const v = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('google')
  return RESULTS.has(v) ? v : ''
}

export function stripGoogleFromUrl() {
  if (typeof window === 'undefined') return
  const u = new URL(window.location.href)
  if (!u.searchParams.has('google')) return
  u.searchParams.delete('google')
  const q = u.searchParams.toString()
  history.replaceState({}, '', u.pathname + (q ? '?' + q : '') + u.hash)
}

// The server set a session cookie: boot treats the account it finds as one just signed in to
// (setUser's `adopt`), so this device's own entries are offered to it the way a passkey
// sign-in offers them.
export const googleSignedIn = result => result === 'ok' || result === 'new'

// The line to show once the app is up, or '' for nothing. `user` is whoever boot found signed
// in: a sign-in the server reported but boot could not see (a browser that dropped the cookie)
// did not work, whatever the address said.
export function googleNotice(result, user) {
  if (googleSignedIn(result)) {
    if (!user) return t('Google sign-in did not work. Try again.')
    return result === 'new' ? t('Welcome, {0}', user.name) : t('Welcome back, {0}', user.name)
  }
  if (result === 'cancelled') return t('Google sign-in was cancelled.')
  if (result === 'failed') return t('Google sign-in did not work. Try again.')
  if (result === 'invite') return t('This app is invite-only. Enter the code you were given.')
  if (result === 'disabled') return t('This account has been disabled.')
  return ''
}
