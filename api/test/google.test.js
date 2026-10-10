/* google.js on its own: the settings it reads, the address it sends a browser to, and the checks
   an ID token has to pass before its `sub` is believed. No network; exchangeCode gets a fake fetch. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { googleConfig, pkcePair, authUrl, decodeIdToken, checkIdToken, exchangeCode, profileName } from '../google.js';

const CLIENT = 'client-123.apps.googleusercontent.com';
const NOW = Date.UTC(2026, 9, 10, 12);
// An unsigned JWT is all these checks look at: the signature is TLS's job (see google.js).
const jwt = claims => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
const good = (over = {}) => ({
  iss: 'https://accounts.google.com', aud: CLIENT, sub: '1234567890', exp: NOW / 1000 + 3600,
  nonce: 'n1', email: 'Ana@Example.com', email_verified: true, name: 'Ana Lu', ...over
});
const check = (claims, nonce = 'n1') => checkIdToken(jwt(claims), { clientId: CLIENT, nonce, now: NOW });

test('googleConfig: off until both the client id and the secret are set', () => {
  assert.equal(googleConfig({}, 'https://gym.example.com'), null);
  assert.equal(googleConfig({ GOOGLE_CLIENT_ID: CLIENT }, 'https://gym.example.com'), null);
  assert.equal(googleConfig({ GOOGLE_CLIENT_SECRET: 's' }, 'https://gym.example.com'), null);
  const cfg = googleConfig({ GOOGLE_CLIENT_ID: ` ${CLIENT} `, GOOGLE_CLIENT_SECRET: 's' }, 'https://gym.example.com/');
  assert.equal(cfg.clientId, CLIENT);
  assert.equal(cfg.redirectUri, 'https://gym.example.com/api/auth/google/callback');
  assert.equal(cfg.appUrl, 'https://gym.example.com/');
  assert.equal(cfg.tokenUrl, 'https://oauth2.googleapis.com/token');
});

test('googleConfig: a redirect address under a subpath lands the browser back under that subpath', () => {
  const cfg = googleConfig({ GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 's', GOOGLE_REDIRECT_URI: 'https://example.com/gym/api/auth/google/callback' }, 'https://example.com');
  assert.equal(cfg.appUrl, 'https://example.com/gym/');
  assert.equal(googleConfig({ GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 's', GOOGLE_REDIRECT_URI: 'not a url' }, 'x'), null);
});

test('authUrl asks Google for an OpenID sign-in with PKCE, the state and the nonce', () => {
  const cfg = googleConfig({ GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 's' }, 'https://gym.example.com');
  const { verifier, challenge } = pkcePair();
  assert.equal(crypto.createHash('sha256').update(verifier).digest('base64url'), challenge);
  const u = new URL(authUrl(cfg, { state: 'st', nonce: 'nn', challenge }));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = Object.fromEntries(u.searchParams);
  assert.equal(q.client_id, CLIENT);
  assert.equal(q.redirect_uri, 'https://gym.example.com/api/auth/google/callback');
  assert.equal(q.response_type, 'code');
  assert.deepEqual(q.scope.split(' ').sort(), ['email', 'openid', 'profile']);
  assert.equal(q.state, 'st');
  assert.equal(q.nonce, 'nn');
  assert.equal(q.code_challenge, challenge);
  assert.equal(q.code_challenge_method, 'S256');
});

test('checkIdToken: a good token names the Google account, with the address only when verified', () => {
  assert.deepEqual(check(good()), { sub: '1234567890', email: 'ana@example.com', name: 'Ana Lu' });
  assert.deepEqual(check(good({ iss: 'accounts.google.com' })).sub, '1234567890');
  assert.equal(check(good({ email_verified: false })).email, '');
  assert.equal(check(good({ email_verified: 'true' })).email, 'ana@example.com');
});

test('checkIdToken: refuses a token for another app, from another issuer, expired, or for another sign-in', () => {
  const refused = (claims, reason, nonce) => assert.throws(() => check(claims, nonce), { message: reason });
  refused(good({ iss: 'https://evil.example.com' }), 'id-token-issuer');
  refused(good({ aud: 'someone-else' }), 'id-token-audience');
  refused(good({ aud: [CLIENT, 'other'] }), 'id-token-audience');           // several audiences, azp not us
  assert.equal(check(good({ aud: [CLIENT, 'other'], azp: CLIENT })).sub, '1234567890');
  refused(good({ exp: NOW / 1000 - 3600 }), 'id-token-expired');
  refused(good({ exp: undefined }), 'id-token-expired');
  refused(good({ nonce: 'someone-elses' }), 'id-token-nonce');
  refused(good(), 'id-token-nonce', '');                                     // no nonce kept: nothing matches
  refused(good({ sub: '' }), 'id-token-subject');
  refused(good({ sub: 42 }), 'id-token-subject');
  assert.throws(() => checkIdToken('not-a-jwt', { clientId: CLIENT, nonce: 'n1', now: NOW }), { message: 'id-token-malformed' });
  assert.equal(decodeIdToken('a.' + Buffer.from('[1]').toString('base64url') + '.c'), null);
});

test('exchangeCode sends the code, the verifier and the secret, and checks what comes back', async () => {
  const cfg = googleConfig({ GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 'shh' }, 'https://gym.example.com');
  let sent;
  const fakeFetch = async (url, init) => {
    sent = { url, form: Object.fromEntries(new URLSearchParams(init.body)) };
    return { ok: true, status: 200, json: async () => ({ id_token: jwt(good()) }) };
  };
  const who = await exchangeCode(cfg, { code: 'c0de', verifier: 'v', nonce: 'n1' }, { fetch: fakeFetch, now: NOW });
  assert.equal(who.sub, '1234567890');
  assert.equal(sent.url, 'https://oauth2.googleapis.com/token');
  assert.deepEqual(sent.form, {
    code: 'c0de', code_verifier: 'v', client_id: CLIENT, client_secret: 'shh',
    redirect_uri: 'https://gym.example.com/api/auth/google/callback', grant_type: 'authorization_code'
  });
  // Google saying no comes out as its own error code — never with the secret in it.
  const no = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_client' }) });
  await assert.rejects(exchangeCode(cfg, { code: 'c', verifier: 'v', nonce: 'n1' }, { fetch: no, now: NOW }), { message: 'token-invalid_client' });
  const html = async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('html'); } });
  await assert.rejects(exchangeCode(cfg, { code: 'c', verifier: 'v', nonce: 'n1' }, { fetch: html, now: NOW }), { message: 'token-http-502' });
});

test('profileName: the Google name, else the address before the @, never empty, at most 40 characters', () => {
  assert.equal(profileName({ name: 'Ana Lu', email: 'a@x.com' }), 'Ana Lu');
  assert.equal(profileName({ name: '', email: 'ana.lu@x.com' }), 'ana.lu');
  assert.equal(profileName({}), 'Google user');
  assert.equal(profileName({ name: 'x'.repeat(60) }).length, 40);
});
