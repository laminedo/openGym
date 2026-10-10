/* "Continue with Google" through the real server.js in a child, with Google's token endpoint played
   by a small local server (GOOGLE_TOKEN_URL). The fake checks what the real one would — the client
   secret, and that the PKCE verifier matches the challenge the browser was sent with — and answers
   with an ID token for whichever Google account the test has queued for that sign-in code. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const ORIGIN = 'http://localhost:8080';
const CLIENT = 'test-client.apps.googleusercontent.com';
const CLIENT_SECRET = 'test-secret';
const jwt = claims => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');

// code -> { challenge, claims } — what Google would remember between the sign-in and the exchange.
const codes = new Map();
let tokenUrl, google;
before(async () => {
  google = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d => raw += d);
    req.on('end', () => {
      const f = Object.fromEntries(new URLSearchParams(raw));
      const c = codes.get(f.code);
      codes.delete(f.code);
      const pkceOk = c && crypto.createHash('sha256').update(f.code_verifier || '').digest('base64url') === c.challenge;
      res.setHeader('Content-Type', 'application/json');
      if (f.client_id !== CLIENT || f.client_secret !== CLIENT_SECRET) { res.statusCode = 401; return res.end('{"error":"invalid_client"}'); }
      if (!pkceOk || f.grant_type !== 'authorization_code') { res.statusCode = 400; return res.end('{"error":"invalid_grant"}'); }
      res.end(JSON.stringify({ id_token: jwt(c.claims), access_token: 'unused' }));
    });
  });
  await new Promise(r => google.listen(0, '127.0.0.1', r));
  tokenUrl = `http://127.0.0.1:${google.address().port}/token`;
});
after(() => google?.close());

async function startServer(t, { env = {}, users = [], invites = [] } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-google-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites }));
  // Date.now() is the test's to move (fake-clock.mjs), for a sign-in left at Google too long.
  const child = spawn(process.execPath, ['--import', './test/fake-clock.mjs', 'server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost', INVITE_ONLY: '', ADMIN_UIDS: '',
      FIRST_USER_ADMIN: '', AUDIT_LOG: '1', GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      GOOGLE_TOKEN_URL: tokenUrl, GOOGLE_REDIRECT_URI: '', ...env
    }
  });
  const h = { log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.setNow = now => new Promise(resolve => {
    const done = m => { if (m && m.now === now) { child.off('message', done); resolve(); } };
    child.on('message', done);
    child.send({ now });
  });
  h.get = (p, cookie) => fetch(h.api + p, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
  h.db = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  h.audit = () => { try { return fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l)); } catch { return []; } };
  return h;
}

const cookieOf = (r, name) => {
  const c = r.headers.getSetCookie().find(x => x.startsWith(name + '=') && !x.startsWith(name + '=;'));
  return c ? c.split(';')[0] : null;
};
const backTo = r => new URL(r.headers.get('location'));

// The browser's side of one sign-in: the button, Google (queued claims for the code it "issues"),
// and the trip back. `claims` are merged over a good token for that sign-in's own nonce.
async function signIn(h, { sub = 'g-1', claims = {}, invite, cookie = 'own', query } = {}) {
  const start = await h.get('/api/auth/google' + (invite ? '?invite=' + encodeURIComponent(invite) : ''));
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get('location'));
  const state = to.searchParams.get('state');
  const code = crypto.randomBytes(8).toString('hex');
  codes.set(code, {
    challenge: to.searchParams.get('code_challenge'),
    claims: {
      iss: 'https://accounts.google.com', aud: CLIENT, sub, exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: to.searchParams.get('nonce'), email: 'ana@example.com', email_verified: true, name: 'Ana Lu', ...claims
    }
  });
  const stateCookie = cookie === 'own' ? cookieOf(start, 'gymgoogle') : cookie;
  const back = await h.get(`/api/auth/google/callback?${query ?? `code=${code}&state=${encodeURIComponent(state)}`}`, stateCookie);
  assert.equal(back.status, 302);
  return { start, back, result: backTo(back).searchParams.get('google'), session: cookieOf(back, 'gymsid') };
}
const me = async (h, session) => { const r = await h.get('/api/me', session); return { status: r.status, body: await r.json() }; };

test('off unless both the client id and the secret are set: no routes, nothing in /api/config', async t => {
  const h = await startServer(t, { env: { GOOGLE_CLIENT_SECRET: '' } });
  assert.equal((await h.get('/api/auth/google')).status, 404);
  assert.equal((await h.get('/api/auth/google/callback?code=x&state=y')).status, 404);
  assert.equal('google' in await (await h.get('/api/config')).json(), false);
});

test('the button sends the browser to Google with PKCE, and keeps the state in a cookie of its own', async t => {
  const h = await startServer(t);
  const cfg = await (await h.get('/api/config')).json();
  assert.equal(cfg.google, true);
  // Where Google sends people back to, so the app offers the button only at that address.
  assert.equal(cfg.google_url, ORIGIN + '/');
  const r = await h.get('/api/auth/google');
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get('location'));
  assert.equal(to.host, 'accounts.google.com');
  assert.equal(to.searchParams.get('client_id'), CLIENT);
  assert.equal(to.searchParams.get('redirect_uri'), ORIGIN + '/api/auth/google/callback');
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  const raw = r.headers.getSetCookie().find(c => c.startsWith('gymgoogle='));
  assert.equal(raw.split(';')[0], 'gymgoogle=' + to.searchParams.get('state'));
  assert.match(raw, /HttpOnly/); assert.match(raw, /SameSite=Lax/); assert.match(raw, /Max-Age=600;/);
  assert.match(h.log, /Google sign-in on \(redirect address http:\/\/localhost:8080\/api\/auth\/google\/callback\)/);
});

test('a first Google sign-in makes a profile; every later one, from any device, opens that same profile', async t => {
  const h = await startServer(t);
  const first = await signIn(h);
  assert.equal(first.result, 'new');
  assert.equal(backTo(first.back).origin + backTo(first.back).pathname, ORIGIN + '/');
  assert.ok(first.session, 'signed in');
  // The state cookie is spent on the way back, whatever the outcome.
  assert.ok(first.back.headers.getSetCookie().some(c => c.startsWith('gymgoogle=;') && /Max-Age=0/.test(c)));
  const one = await me(h, first.session);
  assert.equal(one.status, 200);
  assert.equal(one.body.user.name, 'Ana Lu');
  assert.equal(one.body.user.google, 'ana@example.com');
  const [u] = h.db().users;
  assert.deepEqual(u.google, { sub: 'g-1', email: 'ana@example.com' });

  // "Another device": a fresh browser, the same Google account.
  const again = await signIn(h);
  assert.equal(again.result, 'ok');
  assert.equal((await me(h, again.session)).body.user.id, u.id);
  assert.equal(h.db().users.length, 1);
  assert.ok(h.audit().some(e => e.ev === 'auth.register.ok' && e.uid === u.id && e.msg === 'google'));
  assert.ok(h.audit().some(e => e.ev === 'auth.google.ok' && e.uid === u.id));

  // Matched by Google's id, never by address: another Google account with the same address is someone else.
  const other = await signIn(h, { sub: 'g-2' });
  assert.equal(other.result, 'new');
  assert.notEqual((await me(h, other.session)).body.user.id, u.id);
});

test('an address Google does not vouch for is neither kept nor made into the profile name', async t => {
  const h = await startServer(t);
  const r = await signIn(h, { claims: { email_verified: false, name: '' } });
  assert.equal(r.result, 'new');
  const [u] = h.db().users;
  assert.deepEqual(u.google, { sub: 'g-1' });
  assert.equal(u.name, 'Google user');
  assert.equal((await me(h, r.session)).body.user.google, '');
});

test('the state has to come back to the browser that started: another browser\'s sign-in link opens nothing', async t => {
  const h = await startServer(t);
  for (const cookie of [null, 'gymgoogle=somebody-elses', undefined]) {
    const r = cookie === undefined
      // The right cookie with a state that is not its own.
      ? await signIn(h, { query: 'code=x&state=forged' })
      : await signIn(h, { cookie });
    assert.equal(r.result, 'failed');
    assert.equal(r.session, null);
  }
  assert.equal(h.db().users.length, 0);
  assert.ok(h.audit().some(e => e.ev === 'auth.google.fail' && e.msg === 'state-mismatch'));
});

test('a token for another sign-in, another app or that Google refuses opens nothing', async t => {
  const h = await startServer(t);
  for (const claims of [{ nonce: 'replayed' }, { aud: 'another-app' }, { iss: 'https://evil.example.com' }, { exp: 1 }]) {
    const r = await signIn(h, { claims });
    assert.equal(r.result, 'failed', JSON.stringify(claims));
    assert.equal(r.session, null);
  }
  // A code Google never issued (or already traded): invalid_grant.
  const start = await h.get('/api/auth/google');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const back = await h.get(`/api/auth/google/callback?code=never-issued&state=${state}`, cookieOf(start, 'gymgoogle'));
  assert.equal(backTo(back).searchParams.get('google'), 'failed');
  assert.ok(h.audit().some(e => e.ev === 'auth.google.fail' && e.msg === 'token-invalid_grant'));
  assert.equal(h.db().users.length, 0);
});

test('a wrong client secret is a failed sign-in, and the log says which setting is wrong', async t => {
  const h = await startServer(t, { env: { GOOGLE_CLIENT_SECRET: 'not-the-secret' } });
  const r = await signIn(h);
  assert.equal(r.result, 'failed');
  assert.match(h.log, /google sign-in failed: token-invalid_client/);
  assert.doesNotMatch(h.log, /not-the-secret/);
});

test('saying no at Google comes back as cancelled, and the state cannot be used again', async t => {
  const h = await startServer(t);
  const start = await h.get('/api/auth/google');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cookie = cookieOf(start, 'gymgoogle');
  const no = await h.get(`/api/auth/google/callback?error=access_denied&state=${state}`, cookie);
  assert.equal(backTo(no).searchParams.get('google'), 'cancelled');
  const replay = await h.get(`/api/auth/google/callback?code=x&state=${state}`, cookie);
  assert.equal(backTo(replay).searchParams.get('google'), 'failed');
});

test('invite-only: a new Google account needs a valid code, which it then uses up; a known one does not', async t => {
  const h = await startServer(t, {
    env: { INVITE_ONLY: '1' },
    invites: [{ code: 'WELCOME1', created: new Date().toISOString() }],
    users: [{ id: 'old', name: 'Bea', created: new Date().toISOString(), google: { sub: 'g-bea' } }]
  });
  assert.equal((await signIn(h)).result, 'invite');
  assert.equal((await signIn(h, { invite: 'nope' })).result, 'invite');
  assert.equal(h.db().users.length, 1);
  const ok = await signIn(h, { invite: 'welcome1' });
  assert.equal(ok.result, 'new');
  const db = h.db();
  const made = db.users.find(u => u.google?.sub === 'g-1');
  assert.equal(made.invitedBy, 'WELCOME1');
  assert.equal(db.invites[0].usedBy, made.id);
  // Used up: the next new Google account cannot ride on it.
  assert.equal((await signIn(h, { sub: 'g-3', invite: 'WELCOME1' })).result, 'invite');
  // Someone already here signs in without any code.
  const bea = await signIn(h, { sub: 'g-bea' });
  assert.equal(bea.result, 'ok');
  assert.equal((await me(h, bea.session)).body.user.id, 'old');
});

test('a disabled profile stays locked out through Google too', async t => {
  const h = await startServer(t, { users: [{ id: 'u1', name: 'Ana', created: new Date().toISOString(), disabled: true, google: { sub: 'g-1' } }] });
  const r = await signIn(h);
  assert.equal(r.result, 'disabled');
  assert.equal(r.session, null);
});

test('FIRST_USER_ADMIN: the first profile on a fresh instance is admin when it comes through Google too', async t => {
  const h = await startServer(t, { env: { FIRST_USER_ADMIN: '1' } });
  const r = await signIn(h);
  assert.equal((await me(h, r.session)).body.user.admin, true);
  const second = await signIn(h, { sub: 'g-2' });
  assert.equal((await me(h, second.session)).body.user.admin, false);
});

test('a sign-in may take up to ten minutes at Google; past that it reports itself as expired, not as forged', async t => {
  const h = await startServer(t);
  const t0 = Date.now();
  // Nine minutes (a new Google account, a 2-step code): still good.
  const slow = await h.get('/api/auth/google');
  const slowState = new URL(slow.headers.get('location')).searchParams.get('state');
  await h.setNow(t0 + 9 * 60000);
  const late = await h.get(`/api/auth/google/callback?error=access_denied&state=${slowState}`, cookieOf(slow, 'gymgoogle'));
  assert.equal(backTo(late).searchParams.get('google'), 'cancelled');
  // Eleven minutes: gone, and said so in the log and the activity log.
  await h.setNow(t0);
  const start = await h.get('/api/auth/google');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  await h.setNow(t0 + 11 * 60000);
  const back = await h.get(`/api/auth/google/callback?code=x&state=${state}`, cookieOf(start, 'gymgoogle'));
  assert.equal(backTo(back).searchParams.get('google'), 'failed');
  assert.ok(h.audit().some(e => e.ev === 'auth.google.fail' && e.msg === 'state-expired'));
  assert.match(h.log, /google sign-in failed: state-expired/);
  // A browser without the cookie is the other failure, and the log says that one too.
  await h.get(`/api/auth/google/callback?code=x&state=${state}`);
  assert.match(h.log, /google sign-in failed: state-mismatch/);
});

test('under a subpath (BASE_PATH, prefix passed through) Google sends people back under it', async t => {
  const h = await startServer(t, { env: { BASE_PATH: '/gym' } });
  const r = await h.get('/api/auth/google');
  assert.equal(new URL(r.headers.get('location')).searchParams.get('redirect_uri'), ORIGIN + '/gym/api/auth/google/callback');
  assert.equal((await (await h.get('/api/config')).json()).google_url, ORIGIN + '/gym/');
  const done = await signIn(h);
  assert.equal(done.result, 'new');
  assert.equal(backTo(done.back).pathname, '/gym/');
});
