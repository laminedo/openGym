import { describe, expect, it } from 'vitest'
import { googleOn, googleElsewhere, googleStartUrl, googleResultFromSearch, googleSignedIn, googleNotice } from './google.js'

describe('googleOn', () => {
  it('is on only where the server says so, and never in the mobile app', () => {
    expect(googleOn({ google: true })).toBe(true)
    expect(googleOn({ google: true }, { mobile: true })).toBe(false)
    expect(googleOn({})).toBe(false)
    expect(googleOn(null)).toBe(false)
  })
})

describe('googleOn at the right address only', () => {
  const cfg = { google: true, google_url: 'https://gym.example.com/' }
  it('offers the button where Google sends people back to, a subpath included', () => {
    expect(googleOn(cfg, { loc: { origin: 'https://gym.example.com' } })).toBe(true)
    expect(googleOn({ google: true, google_url: 'https://example.com/gym/' }, { loc: { origin: 'https://example.com' } })).toBe(true)
    expect(googleElsewhere(cfg, { loc: { origin: 'https://gym.example.com' } })).toBe('')
  })
  it('anywhere else points there instead: a LAN address, 127.0.0.1, the www. twin', () => {
    for (const origin of ['http://192.168.1.20:8080', 'http://127.0.0.1:8080', 'https://www.gym.example.com']) {
      expect(googleOn(cfg, { loc: { origin } }), origin).toBe(false)
      expect(googleElsewhere(cfg, { loc: { origin } }), origin).toBe('https://gym.example.com/')
    }
  })
  it('an older server that does not say where stays as before', () => {
    expect(googleOn({ google: true }, { loc: { origin: 'http://192.168.1.20:8080' } })).toBe(true)
    expect(googleElsewhere({ google: true }, { loc: { origin: 'http://192.168.1.20:8080' } })).toBe('')
  })
  it('nothing at all where it is not set up, or in the mobile app', () => {
    expect(googleElsewhere({}, { loc: { origin: 'http://x' } })).toBe('')
    expect(googleElsewhere(cfg, { mobile: true, loc: { origin: 'http://x' } })).toBe('')
  })
})

describe('googleStartUrl', () => {
  it('points at the API next to the app, under a subpath too', () => {
    expect(googleStartUrl('', { pathname: '/' })).toBe('/api/auth/google')
    expect(googleStartUrl('', { pathname: '/gym/index.html' })).toBe('/gym/api/auth/google')
  })
  it('carries an invite code, encoded', () => {
    expect(googleStartUrl(' AB CD ', { pathname: '/' })).toBe('/api/auth/google?invite=AB%20CD')
  })
})

describe('googleResultFromSearch', () => {
  it('reads the word the server put on the address', () => {
    expect(googleResultFromSearch('?google=ok')).toBe('ok')
    expect(googleResultFromSearch('google=new&x=1')).toBe('new')
    expect(googleResultFromSearch('?x=1&google=cancelled')).toBe('cancelled')
  })
  it('ignores anything that is not one of those words', () => {
    expect(googleResultFromSearch('?google=<script>')).toBe('')
    expect(googleResultFromSearch('?link=abc')).toBe('')
    expect(googleResultFromSearch('')).toBe('')
  })
})

describe('googleNotice', () => {
  const ana = { id: 'u1', name: 'Ana' }
  it('welcomes whoever boot found signed in', () => {
    expect(googleSignedIn('ok')).toBe(true)
    expect(googleSignedIn('new')).toBe(true)
    expect(googleSignedIn('failed')).toBe(false)
    expect(googleNotice('ok', ana)).toBe('Welcome back, Ana')
    expect(googleNotice('new', ana)).toBe('Welcome, Ana')
  })
  it('says it did not work when the server said yes but nobody is signed in', () => {
    expect(googleNotice('ok', null)).toBe('Google sign-in did not work. Try again.')
  })
  it('says nothing when a used-up sign-in comes back to someone already signed in (Back to Google)', () => {
    expect(googleNotice('failed', ana)).toBe('')
    expect(googleNotice('cancelled', ana)).toBe('')
  })
  it('explains each way it can go wrong', () => {
    expect(googleNotice('cancelled', null)).toBe('Google sign-in was cancelled.')
    expect(googleNotice('failed', null)).toBe('Google sign-in did not work. Try again.')
    expect(googleNotice('invite', null)).toBe('This app is invite-only. Enter the code you were given.')
    expect(googleNotice('disabled', null)).toBe('This account has been disabled.')
    expect(googleNotice('', null)).toBe('')
  })
})
