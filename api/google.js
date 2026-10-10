/* "Continue with Google" — OpenID Connect sign-in, with no dependency.

   The authorization-code flow with PKCE, done entirely by the server:

     1. GET /api/auth/google            the browser is sent to Google with a fresh `state`, `nonce`
                                        and PKCE challenge; `state` is also put in a short cookie.
     2. Google sends it back to GET /api/auth/google/callback?code&state.
     3. The server trades `code` (plus the PKCE verifier and the client secret) for an ID token at
        Google's token endpoint, and the token's `sub` names the Google account.

   The ID token's signature is not checked against Google's keys, and does not need to be: it
   arrives in the server's own TLS request to Google's token endpoint, in exchange for a one-time
   code that only works together with the client secret and the PKCE verifier. OpenID Connect
   Core 3.1.3.7 allows exactly this ("the TLS server validation MAY be used to validate the issuer
   in place of checking the token signature"). Its claims are still checked: issuer, audience,
   expiry and the nonce this server handed out for this sign-in.

   An account is matched by `sub`, Google's stable id for a person, never by e-mail address: an
   address can change hands, `sub` never does.

   Pure helpers only; the routes live in server.js next to the session and invite machinery they
   share with the passkey routes. */
import crypto from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
// Clock difference allowed between this server and Google on the token's expiry.
const SKEW_MS = 5 * 60000;

/** The instance's Google settings from the environment, or null while it is not set up. Both the
 *  client id and the secret are needed: without either, Google cannot finish a sign-in. The
 *  redirect address defaults to ORIGIN's /api/auth/google/callback; a subpath deployment whose
 *  proxy strips the prefix names its own in GOOGLE_REDIRECT_URI. `tokenUrl` exists for the tests. */
export function googleConfig(env, origin) {
  const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;
  const redirectUri = String(env.GOOGLE_REDIRECT_URI || '').trim()
    || String(origin).replace(/\/+$/, '') + '/api/auth/google/callback';
  let appUrl;
  // Where the browser lands once Google is done: the app's own address, three levels above the
  // callback (…/api/auth/google/callback → …/), so a subpath deployment lands under its subpath.
  try { appUrl = new URL('../../../', redirectUri).href; }
  catch { console.warn(`GOOGLE_REDIRECT_URI "${redirectUri.slice(0, 80)}" is not an address — Google sign-in stays off`); return null; }
  return { clientId, clientSecret, redirectUri, appUrl, tokenUrl: String(env.GOOGLE_TOKEN_URL || '').trim() || TOKEN_URL };
}

/** A fresh PKCE pair (RFC 7636, S256). */
export function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** The address the browser is sent to at Google. */
export function authUrl(cfg, { state, nonce, challenge }) {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state, nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Lets someone with several Google accounts pick which one, every time — signing in on a
    // shared computer should never silently reuse whoever was signed in to Google last.
    prompt: 'select_account'
  });
  return AUTH_URL + '?' + q;
}

/** The claims of an ID token's payload, without checking anything yet; null if it is not a JWT. */
export function decodeIdToken(idToken) {
  const parts = typeof idToken === 'string' ? idToken.split('.') : [];
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
  } catch { return null; }
}

/** Checks an ID token received from the token endpoint and returns who it names —
 *  { sub, email, name } — or throws with a short reason (never the token itself). */
export function checkIdToken(idToken, { clientId, nonce, now = Date.now() }) {
  const c = decodeIdToken(idToken);
  if (!c) throw new Error('id-token-malformed');
  if (!ISSUERS.has(c.iss)) throw new Error('id-token-issuer');
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(clientId)) throw new Error('id-token-audience');
  // With more than one audience, the party it was issued to has to be this client too.
  if (aud.length > 1 && c.azp !== clientId) throw new Error('id-token-audience');
  if (typeof c.exp !== 'number' || c.exp * 1000 + SKEW_MS < now) throw new Error('id-token-expired');
  if (!nonce || c.nonce !== nonce) throw new Error('id-token-nonce');
  if (typeof c.sub !== 'string' || !c.sub || c.sub.length > 255) throw new Error('id-token-subject');
  // The address is only kept when Google vouches for it; it is shown, never used to find anyone.
  const email = c.email_verified === true || c.email_verified === 'true'
    ? String(c.email || '').trim().toLowerCase().slice(0, 254) : '';
  const name = String(c.name || c.given_name || '').trim().slice(0, 40);
  return { sub: c.sub, email, name };
}

/** Trades the one-time `code` for an ID token and returns its checked claims (checkIdToken). */
export async function exchangeCode(cfg, { code, verifier, nonce }, { fetch: f = fetch, now } = {}) {
  const res = await f(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      code, code_verifier: verifier,
      client_id: cfg.clientId, client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri, grant_type: 'authorization_code'
    }).toString(),
    signal: AbortSignal.timeout(15000)
  });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON: refused below */ }
  if (!res.ok || !body || typeof body.id_token !== 'string') {
    // Google's own error code (`invalid_grant`, `invalid_client` …) says what is wrong with the
    // set-up, which is what an operator reading the container log needs; nothing else is kept.
    const why = body && typeof body.error === 'string' ? body.error.slice(0, 40) : 'http-' + res.status;
    throw new Error('token-' + why);
  }
  return checkIdToken(body.id_token, { clientId: cfg.clientId, nonce, now });
}

/** A profile name for a new account made by Google sign-in: the Google name, or the part of the
 *  address before the @, or a plain fallback. Profile names are never unique, so nothing more. */
export function profileName({ name, email }) {
  const n = String(name || '').trim() || String(email || '').split('@')[0].trim();
  return n.slice(0, 40) || 'Google user';
}
