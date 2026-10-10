# Start here: openGym on your phone, tablet and computer

This guide is for you if you have never run a server. At the end, openGym opens on your phone,
tablet and computer at your own `https://` address. You sign in on each with the same Google
account, and they all show the same workouts.

**Why a server?** openGym isn't a website someone else runs for you. Your workouts are saved on a
small computer on the internet that you rent: your "server". Every device signs in to it, which is
how they stay in sync. Google sign-in and phones also need a proper `https://` address, which
your server gets for free.

**What you need:** about 45 minutes, a card for a server (about €4–6 a month), and a Google
account.

> These won't work, so you can skip them: GitHub Pages, Vercel, Netlify and other "static" hosts
> (they can't save data, so there's no sign-in and no sync), and opening the app on your phone as
> `http://192.168.x.x:8080` from your own computer (Google doesn't allow sign-in on those
> addresses).

## 1. Rent a server (10 minutes)

Pick any provider that gives you a Linux server ("VPS"). Two common ones:

- **Hetzner Cloud**: the CX22/CX23 plan, about €4 a month.
- **DigitalOcean**: a "Droplet", Basic, 1 GB, about $6 a month.

When you create it, choose:
- **Image:** Ubuntu 24.04
- **Size:** the smallest with **at least 1 GB** of memory
- **Login:** a root password (easiest) or an SSH key if you know how

When it's ready, write down its **IPv4 address**, for example `203.0.113.10`.

## 2. Get a free web address (5 minutes)

1. Go to **[duckdns.org](https://www.duckdns.org)** and sign in (with Google is fine).
2. Type a name, for example `lamine-gym`, and click **add domain**.
3. In that row's **current ip** box, type your server's IP address and click **update ip**.

Your address is now `lamine-gym.duckdns.org` (with your own name). Choose it carefully: your
Google sign-in gets tied to it.

## 3. Create your Google keys (10 minutes)

Follow **[Sign in with Google → step 1](GOOGLE_SIGN_IN.md#1-get-a-client-id-and-secret-from-google)**.
Where it asks for the **Authorized redirect URI**, enter your address in this form:

```
https://lamine-gym.duckdns.org/api/auth/google/callback
```

At the end, Google shows a **Client ID** and a **Client secret**. Keep that page open; you'll paste
both in step 5.

## 4. Open a terminal on your server

- **Hetzner:** open your server, then click the **>_** (console) icon at the top right.
- **DigitalOcean:** open your Droplet, then **Access → Launch Droplet Console**.

A black window opens where you can type commands. To paste: right-click, or Ctrl+Shift+V. If it
asks for a login, use `root` and your password.

## 5. Install openGym (one command, about 10 minutes)

Paste this whole block and press Enter:

```bash
apt-get update && apt-get install -y git
git clone -b claude/modest-babbage-xrlj24 https://github.com/laminedo/openGym /opt/opengym
cd /opt/opengym && bash scripts/install-server.sh
```

*(Once this branch is merged into `main`, you can leave out `-b claude/modest-babbage-xrlj24`.)*

It asks three questions:
1. **Address:** `lamine-gym.duckdns.org` (yours)
2. **Client ID:** paste it from Google
3. **Client secret:** paste it from Google. Nothing shows while you paste; that's normal.

Then it installs everything, gets the `https://` certificate and starts the app. It finishes with
**✓ openGym is running at https://…**

## 6. Put it on your devices

1. **Phone:** open `https://lamine-gym.duckdns.org` and tap **Continue with Google**. Do this
   first: the first profile on a new server becomes its admin.
2. **Add it to the home screen** so it opens like an app:
   - iPhone/iPad (Safari): **Share → Add to Home Screen**
   - Android (Chrome): **⋮ → Add to home screen**
3. **Tablet and computer:** open the same address and **Continue with Google** with the same
   Google account. Everything from your phone is there.

If the home-screen icon opens on the sign-in screen, tap **Continue with Google** once more.

## If something doesn't work

| What you see | What to do |
|---|---|
| The installer says the address **does not point** at the server | Check step 2: DuckDNS's *current ip* must be your server's IP. Wait a minute, then run `bash scripts/install-server.sh` again. |
| **openGym does not answer yet** at the end | Usually the same DNS problem. Also make sure your provider's firewall allows ports **80** and **443**. Look at `docker compose logs caddy \| tail -30`. |
| Google says **Error 400: redirect_uri_mismatch** | The redirect URI in Google must be exactly `https://YOUR-ADDRESS/api/auth/google/callback`. If it is, wait: Google can take a few minutes to a few hours to start using a new one. |
| Google says **Access blocked** | Add your Google account under *Test users* (Google Auth Platform → Audience), or publish the app. |
| There's no **Continue with Google** button | Run `cd /opt/opengym && bash scripts/install-server.sh` again and paste the two keys. |
| The installer stopped with **Killed** or **out of memory** | Choose a server with 2 GB of memory, or run it again: it adds swap space on small servers. |

For anything else, read [Sign in with Google → Troubleshooting](GOOGLE_SIGN_IN.md#troubleshooting).

## Later

- **Back up** your data (everything is in one folder):
  `tar czf ~/opengym-backup-$(date +%F).tar.gz -C /opt/opengym data`
- **Update** openGym: `cd /opt/opengym && git pull && docker compose up -d --build`
- **Change** the address or the Google keys: run `bash scripts/install-server.sh` again.

<details>
<summary>No server, only a computer at home?</summary>

It works if that computer stays on all the time, and it needs a fixed `https://` name for it,
for example from [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) (free, `*.ts.net`) or a
[Cloudflare Tunnel](SELF_HOSTING.md#option-a--cloudflare-tunnel-no-open-ports) with your own
domain. Then follow [Self-hosting](SELF_HOSTING.md) with `docker compose up -d --build`, and
[Sign in with Google](GOOGLE_SIGN_IN.md). It takes more steps than the server route above, and
your devices can't sync while that computer is off.
</details>
