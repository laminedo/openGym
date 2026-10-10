# Start here: your openGym link

**Your app: <https://laminedo.github.io/openGym/>**

It opens on your iPhone, iPad and computer. You sign in on each with the same **name and
password**, and they all show the same plan, workouts and body weight.

It costs nothing and there's no server to look after:

- **GitHub Pages** hosts the app for free.
- **Supabase** (your free account, project `opengym`) keeps your profile and workouts.

> **First time?** The link works once this repository's `main` branch has the app and GitHub
> Pages is switched on. See [Switching it on](#switching-it-on-once) at the end.

## 1. On your iPhone: create your profile

1. Open **Safari** and go to **https://laminedo.github.io/openGym/**
2. Tap **Create new profile**.
3. Pick a **name** (e.g. `Lamine`) and a **password** of at least 10 characters, type it twice,
   and tap **Create profile**. When Safari offers to save the password, say yes: your iPad and
   Mac can then fill it in for you.
4. **Put it on your home screen:** tap **Share** (the square with the arrow) → **Add to Home
   Screen** → **Add**. From now on, open openGym from that icon. It opens full screen, like an
   app.

If the home-screen icon opens on the sign-in screen, sign in once more there: tap **Sign in with
password** and use the same name and password. A home-screen app can keep its own storage, apart
from Safari's.

## 2. On your iPad and computer: sign in

1. Open the same address: **https://laminedo.github.io/openGym/**
2. Tap **Sign in with password**, and type the **same name and password**.
3. iPad: **Share → Add to Home Screen**, like on the iPhone. Computer: Chrome and Edge show an
   install icon in the address bar, or just bookmark the page.

Everything you log on one device shows up on the others: within half a minute on a device that's
open, or the next time you open the app there. Without internet, the app keeps working and catches up once
you're back online.

## Good to know

- **Your password** can be changed in **Settings → Account → Password**. That signs you out on
  your other devices; sign in there again with the new one.
- **"Sign out everywhere"** (Settings → Account) signs out every device at once.
- **Too many wrong passwords** pause sign-in for that profile: one minute after the 6th wrong
  try, then longer. Wait, then try again.
- **Back up** your training any time: **Settings → Data & backup → Export backup**.
- **Supabase pauses free projects** that nobody uses for about a week. Training at least weekly
  keeps it awake. If the app ever says it can't reach the server after a long break, open
  [supabase.com/dashboard](https://supabase.com/dashboard), pick the `opengym` project and click
  **Restore**. Your data is kept while it's paused.

### What this free version doesn't have

The free version leaves out the parts that need the full openGym server:

- Face ID / Touch ID sign-in (passkeys)
- Notifications when the phone is locked (the rest timer still sounds while the app is open)
- Uploading your own photos and videos for exercises (you can still add a link)
- The AI Coach and the admin dashboard

If you ever want those, see [Run your own openGym server](SELF_HOST_EASY.md).

## Owner jobs (rarely needed)

These run in Supabase: [supabase.com/dashboard](https://supabase.com/dashboard) → project
**opengym** → **SQL Editor** → paste one line → **Run**. (Or ask Claude to do it for you.)

| You want to… | Run this |
|---|---|
| Stop strangers from creating profiles | `select og.set_invite_only(true);` |
| …and let one more person in after that | `select og.new_invite();` (give them the code; they type it when creating their profile) |
| Open sign-ups again | `select og.set_invite_only(false);` |
| Help someone who forgot their password | `select og.make_reset_code('Their name');` (they tap **Sign in with password → Have a reset code from your admin?**, enter the code and a new password; it works for 24 hours) |

Anyone who knows the address can create a profile until you close sign-ups. Their profile is
separate from yours and can't see your data. Once everyone you want is in, closing sign-ups is a
good idea.

## Switching it on (once)

The app needs two things on GitHub. Your profile, your Supabase project and the database are
already set up.

1. **The app in `main`.** Merge [pull request #1](https://github.com/laminedo/openGym/pull/1)
   into `main`.
2. **Actions and Pages switched on**, in your repository on github.com:
   - **Actions** tab → click **I understand my workflows, go ahead and enable them**.
   - **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions**.
3. **Publish:** **Actions** tab → **Deploy demo to GitHub Pages** (the workflow keeps its old
   name) → **Run workflow** → **Run workflow**. A few minutes later the link above works. After
   that, every change merged into `main` is published by itself.

## If something doesn't work

| What you see | What to do |
|---|---|
| The link shows **404** | Pages isn't switched on yet, or the first publish is still running: see [Switching it on](#switching-it-on-once). The **Actions** tab shows the publish's progress. |
| **Can't reach the server** / nothing loads after a long break | Supabase paused the project: restore it as described under [Good to know](#good-to-know). |
| **Another profile already signs in with this name** | Pick another name, or sign in with that one. |
| **Wrong name or password** | Names don't care about capitals or spaces; passwords do. |
| **Too many attempts** | Wait the time it shows, then try again. |
| Forgot the password | See [Owner jobs](#owner-jobs-rarely-needed): make a reset code. |
| Something on one device doesn't show on another | Reopen the app on that device, or tap **Settings → Account → Sync now**. |
