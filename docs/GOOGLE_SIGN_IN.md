# Sign in with Google

"Continue with Google" lets everyone on your instance sign in with their Google account. Sign in
once on your phone, then with the same Google account on your tablet and your computer, and all
of them open the same profile: the same plan, workouts and body weight, kept in sync by your
openGym server.

It is **optional and off by default**. Passkeys keep working next to it. Turning it on takes two
settings, and getting those two values from Google takes about ten minutes.

> **Never run a server before?** Follow **[Start here](START_HERE.md)** instead: it covers
> renting a server, a free address and this whole page, with one install command.

> **What Google sees:** that you signed in to your openGym, and nothing else. Your workouts never
> go to Google; they stay on your server. openGym stores only Google's id for your account and
> your e-mail address (shown in Settings → Account).

## Before you start

openGym has to be reachable at its final **HTTPS** address, such as `https://gym.example.com`
([Self-hosting, section 3](SELF_HOSTING.md#3-expose-it-over-https-on-your-own-domain)). Google
only sends people back to an `https://` address. The one exception is `http://localhost`, which
is fine for trying it out on the machine running Docker.

So Google sign-in **cannot** work on:
- a phone opening your computer as `http://192.168.x.x:8080`: Google refuses raw IP addresses and
  plain `http` on anything but `localhost`. The app then shows where Google sign-in works instead
  of the button.
- GitHub Pages, Vercel, Netlify or any other host that serves only files: openGym's server
  (`api/`) has to run somewhere for sign-in and sync.

**Build this fork, don't pull.** Continue with Google is only in images built from this
repository. `docker compose up -d` builds them here (`pull_policy: build` in
`docker-compose.yml`); the prebuilt `ghcr.io/duartesantos8/opengym-*` images don't have it.

Below, replace `https://gym.example.com` with your own address, the one in `ORIGIN` in your
`.env`.

## 1. Get a client id and secret from Google

1. Open the [Google Cloud console](https://console.cloud.google.com/) and sign in with any
   Google account. It doesn't have to be the one you'll train with.
2. Create a project: the project picker at the top → **New project** → name it `openGym` →
   **Create**, then make sure it is selected.
3. Open **Google Auth Platform** (search for it at the top; older consoles call this part
   **APIs & Services → OAuth consent screen**) and click **Get started**:
   - App name: `openGym`. User support e-mail: yours.
   - Audience: **External**.
   - Contact e-mail: yours. Accept the policy, then **Create**.
4. Still in Google Auth Platform, go to **Audience**. The app starts in *Testing*: only the
   Google accounts you list under **Test users** can sign in. Add your own account and those of
   the people you share the instance with. You can also click **Publish app** so anyone with a
   Google account can sign in (openGym asks only for the basic scopes, name and e-mail, so
   Google doesn't review the app for that).
5. Go to **Clients** (older consoles: **Credentials → Create credentials → OAuth client ID**) and
   create a client:
   - Application type: **Web application**. Name: `openGym`.
   - Under **Authorized redirect URIs**, add exactly:
     ```
     https://gym.example.com/api/auth/google/callback
     ```
     That is your address followed by `/api/auth/google/callback`. Nothing goes under
     *Authorized JavaScript origins*.
     If the console refuses it because the domain isn't authorized, add your domain (for
     `gym.example.com` that's `example.com`; for DuckDNS, `yourname.duckdns.org`) under
     Google Auth Platform → **Branding → Authorized domains**, save, and add the URI again.
   - **Create**. Google shows a **Client ID** (ends in `.apps.googleusercontent.com`) and a
     **Client secret**. Copy both now.
   - Google can take **a few minutes to a few hours** to start using a new or changed redirect
     URI. Until then its page says *Error 400: redirect_uri_mismatch* even though it's right.

## 2. Give them to openGym

Add both to your `.env`, next to `ORIGIN`:

```bash
GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret-here
```

The secret is a password for your instance's Google sign-in: keep it out of screenshots, chats
and git. Then build and restart, so the API reads them:

```bash
docker compose up -d --build
```

Check that it took them:

```bash
docker compose logs api | grep -i google
# Google sign-in on (redirect address https://gym.example.com/api/auth/google/callback)
curl -s https://gym.example.com/api/config
# {…,"google":true,"google_url":"https://gym.example.com/",…}
```

The address in that log line has to match the one you gave Google, character for character. No
log line and no `"google"` in the answer means the API isn't this fork's: run the `--build`
command above from your clone of this repository.

## 3. Use it on all your devices

1. **On your phone**, open `https://gym.example.com` and tap **Continue with Google**. Pick your
   Google account. The first time, openGym makes your profile; if you had already been using the
   app on this phone without an account, it asks whether to add those workouts to it.
2. **Put it on your home screen**, so it opens full-screen like an app:
   - iPhone or iPad: in Safari, tap **Share → Add to Home Screen**.
   - Android: in Chrome, tap **⋮ → Add to home screen** (or **Install app**).
   - Computer: Chrome and Edge show an install button in the address bar; any browser works
     without installing.

   If the home-screen app opens on the sign-in screen (it can keep its own storage, apart from
   the browser's), tap **Continue with Google** once more there. It's the same profile.
   *Not yet tested on a real iPhone:* if, there, Google's page ends in Safari and the
   home-screen app stays signed out, use openGym in Safari itself (a bookmark works) and tell us
   on the issue tracker.
3. **On your tablet and computer**, open the same address and **Continue with Google** with the
   **same Google account**. You land in the same profile, with everything from your phone.

From then on every change is saved to your server, and your other devices show it the next time
they open the app or come back to it. Settings → Account shows which Google account you're
signed in with.

## Good to know

- **A Google account is one profile.** openGym recognises the account by Google's own id for it,
  not by the e-mail address. Someone else's Google account gets their own profile.
- **Invite-only instances** (`INVITE_ONLY=1`): someone new taps **Create new profile**, types the
  invite code, then **Continue with Google**. People who already have a profile just tap
  **Continue with Google** on the sign-in screen.
- **The first profile as admin** (`FIRST_USER_ADMIN=1`) works the same with Google: the first
  profile created on a fresh instance becomes its admin.
- **Profiles made with a passkey stay separate.** Signing in with Google from one creates a new
  profile; there is no linking of the two yet. If you already have a passkey profile with
  history, keep using the passkey, or export a backup in Settings → Data & backup and import it
  into the Google profile.
- **A Google-only profile has no passkeys.** Settings hides the passkey and device-code rows for
  it; another device simply signs in with Google.
- **The Android app (APK)** can't show Google's sign-in page: Google blocks sign-in inside
  embedded app views. Sign in with Google on the website, then use Settings → Account → **Pair the
  mobile app**, or just use the website installed to the home screen as above.
- **Only at one address.** Google sends people back to exactly one address (`ORIGIN`), so the
  button shows only there. Opened at another address (the `www.` twin, `127.0.0.1`, a LAN IP), the
  sign-in screen says where Google sign-in works instead.
- **Serving openGym under a subpath** (`https://example.com/gym/`): with `BASE_PATH=/gym` (a proxy
  that passes the prefix through) the redirect address includes it on its own, and the log line
  shows it. Behind a proxy that strips the prefix, openGym can't see it: name the address, and
  register that one with Google:
  ```bash
  GOOGLE_REDIRECT_URI=https://example.com/gym/api/auth/google/callback
  ```
- **Switching it off** (remove the two lines, restart) hides the button. Profiles that only ever
  signed in with Google can't sign in until it's back on; their data stays where it is.
- **Signing out** works as before. **Sign out everywhere** ends the sessions on all devices;
  signing in with Google again works straight away.

## Troubleshooting

| What you see | What it means |
|---|---|
| Google shows **Error 400: redirect_uri_mismatch** | The redirect URI you gave Google isn't the one openGym uses. Copy the address from the `Google sign-in on (…)` log line into the client's *Authorized redirect URIs*. `http` vs `https`, `www.` and a trailing `/` all count. If it already matches exactly, you probably just saved it: Google can take a few minutes to a few hours to apply it. |
| Google shows **Access blocked** or "has not completed the Google verification process" | The app is in *Testing* and this Google account isn't a test user. Add it under Google Auth Platform → Audience → Test users, or publish the app. |
| openGym says **Google sign-in did not work** | Look at `docker compose logs api \| grep -i google`. `token-invalid_client`: the client id or secret in `.env` is wrong. `token-redirect_uri_mismatch`: see the first row. `token-invalid_grant`: that sign-in was already used; try again. `state-expired`: it took over ten minutes, or the API restarted meanwhile; try again. `state-mismatch`: the browser came back without the cookie it left with, usually because the app was opened at another address than `ORIGIN`. The admin dashboard's activity log has the same reasons. |
| No **Continue with Google** button | Check with `curl -s <your address>/api/config`. No `"google"` in it: the two settings are missing, or the API isn't built from this fork (`docker compose up -d --build`). It's there, but the screen says *Google sign-in only works at this address*: you opened the app at another address; use that one. |
| Works on the computer, not on the phone | The phone opened `http://<computer's IP>:8080` or `localhost`. Google needs the public `https://` address: see [Start here](START_HERE.md). |
| Back on the sign-in screen right after choosing the account | Your browser didn't keep openGym's cookie. `ORIGIN` must be the exact `https://` address you opened, and the site has to be served over HTTPS (or `http://localhost`). |
| **This app is invite-only** | The instance runs with `INVITE_ONLY=1` and this Google account is new here: use **Create new profile**, type the invite code, then **Continue with Google**. |
