# Start here: openGym on your iPhone, iPad and computer

This guide is for you if you have never run a server. At the end, openGym opens on your iPhone,
iPad and computer. You sign in on each with the same **profile name and password**, and they all
show the same workouts.

Sign-in is built into openGym and free: no Google, Apple or other account to set up, nothing to
pay for.

**Why a server?** openGym isn't a website someone else runs for you. Your workouts are saved on a
computer that you control, and every device signs in to it. That's how they stay in sync.

**Pick one:**

| | A. A small rented server (recommended) | B. Your own computer at home (free) |
|---|---|---|
| Works at the gym | ✅ anywhere with internet | ❌ only on your home Wi‑Fi |
| Cost | about €4–6 a month | free |
| Your computer must stay on | no | yes |
| Face ID / Touch ID sign-in (passkeys) | ✅ as well as the password | ❌ password only |
| Time to set up | about 30 minutes | about 20 minutes |

> These don't work, so you can skip them: GitHub Pages, Vercel, Netlify and other "static" hosts.
> They can't save data, so there's no sign-in and no sync.

---

## A. A small rented server

### A1. Rent a server (10 minutes)

Pick any provider that gives you a Linux server ("VPS"). Two common ones:

- **Hetzner Cloud**: the smallest shared plan, about €4 a month.
- **DigitalOcean**: a "Droplet", Basic, 1 GB, about $6 a month.

When you create it, choose:
- **Image:** Ubuntu 24.04
- **Size:** the smallest one is enough
- **Login:** a root password (easiest)

When it's ready, write down its **IPv4 address**, for example `203.0.113.10`.

### A2. Get a free web address (5 minutes)

1. Go to **[duckdns.org](https://www.duckdns.org)** and sign in.
2. Type a name, for example `lamine-gym`, and click **add domain**.
3. In that row's **current ip** box, type your server's IP address and click **update ip**.

Your address is now `lamine-gym.duckdns.org` (with your own name).

### A3. Open a terminal on your server

- **Hetzner:** open your server, then click the **>_** (console) icon at the top right.
- **DigitalOcean:** open your Droplet, then **Access → Launch Droplet Console**.

A black window opens where you can type commands. To paste: right-click, or Ctrl+Shift+V. If it
asks for a login, use `root` and your password.

### A4. Install openGym (one command, about 5 minutes)

Paste this whole block and press Enter:

```bash
apt-get update && apt-get install -y git
git clone -b claude/modest-babbage-xrlj24 https://github.com/laminedo/openGym /opt/opengym
cd /opt/opengym && bash scripts/install-server.sh
```

*(Once this branch is merged into `main`, you can leave out `-b claude/modest-babbage-xrlj24`.)*

It asks for one thing, your **address**: type `lamine-gym.duckdns.org` (yours) and press Enter.
Then it installs everything, gets the `https://` certificate and starts the app. It finishes with
**✓ openGym is running at https://…**

### A5. Your iPhone: create your profile

1. Open **Safari** and go to `https://lamine-gym.duckdns.org`.
2. Tap **Create new profile**. If you see **Passkey | Password** at the top, tap **Password**.
3. Pick a **name** (e.g. `Lamine`) and a **password** of at least 10 characters. Tap
   **Create profile**. When Safari offers to save the password, say yes: then your iPad and Mac
   fill it in for you.
4. **Add it to the home screen:** tap **Share** (the square with the arrow) → **Add to Home
   Screen** → **Add**. From now on, open openGym from that icon, like an app.

Do this first: the first profile on a new server becomes its admin.

### A6. Your iPad and computer: sign in

1. Open the same address: `https://lamine-gym.duckdns.org`.
2. Tap **Sign in with password**, and type the **same name and password**.
3. iPad: **Share → Add to Home Screen**, as on the iPhone. Computer: Chrome and Edge show an
   install icon in the address bar, or just bookmark it.

Everything you log on one device shows up on the others the next time you open the app there.

**Want Face ID / Touch ID instead of typing the password?** In the app: **Settings → Account →
Passkeys → Add a passkey**. With iCloud Keychain on, a passkey made on your iPhone also works on
your iPad and Mac. The password keeps working too.

### A7. Only you? Close sign-ups

Anyone who knows your address could create their own profile. Once you (and anyone you want) have
a profile, close sign-ups:

```bash
cd /opt/opengym && bash scripts/install-server.sh --private
```

Your profiles keep working. To let someone new in later, make an **invite code** in
**Settings → Admin dashboard**, or reopen with `--open`.

---

## B. Your own computer at home (free)

Your iPhone and iPad reach openGym on your computer over your home Wi‑Fi. It only works at home,
while that computer is on, and it uses the password only (Face ID passkeys need option A).

1. **Install Docker Desktop** from [docker.com](https://www.docker.com/products/docker-desktop/)
   and start it. (Windows: allow it through the firewall when asked.)
2. **Download openGym:** open
   [the code page](https://github.com/laminedo/openGym/tree/claude/modest-babbage-xrlj24), click
   **Code → Download ZIP**, and unzip it, for example into `Documents/openGym`.
3. **Find your computer's address on the Wi‑Fi:**
   - Windows: open **PowerShell**, type `ipconfig`, and look for *IPv4 Address*, e.g. `192.168.1.20`.
   - Mac: **System Settings → Wi‑Fi → Details** next to your network → *IP address*.
4. **Make the settings file:** in the unzipped folder, copy `.env.example` and name the copy
   `.env`. Open `.env` in Notepad/TextEdit, and at the very bottom add these lines, with your
   address from step 3:
   ```
   ORIGIN=http://192.168.1.20:8080
   PASSWORD_LOGIN=1
   ALLOW_GUEST=0
   FIRST_USER_ADMIN=1
   ```
   (On a Mac, files starting with a dot are hidden in Finder: press **Cmd+Shift+.** to see them.)
5. **Start it:** open a terminal in that folder (Windows: right-click the folder → *Open in
   Terminal*; Mac: right-click → *New Terminal at Folder*) and run:
   ```bash
   docker compose up -d
   ```
6. **On every device** (computer, iPhone, iPad), open `http://192.168.1.20:8080` (your address).
   Create your profile with a password on the first one (as in A5), then **Sign in with
   password** on the others (as in A6).

If your router gives the computer a new address one day, change `ORIGIN` in `.env`, run
`docker compose up -d` again, and use the new address on your devices.

---

## If something doesn't work

| What you see | What to do |
|---|---|
| The installer says the address **does not point** at the server | Check A2: DuckDNS's *current ip* must be your server's IP. Wait a minute, then run `bash scripts/install-server.sh` again. |
| **openGym does not answer yet** at the end | Usually the same DNS problem. Also make sure your provider's firewall allows ports **80** and **443**. Look at `docker compose logs caddy \| tail -30`. |
| There's no **Sign in with password** button | Run the installer again (A4). For B, check that `PASSWORD_LOGIN=1` is in `.env`, then `docker compose up -d`. |
| **Another profile already signs in with this name** | Pick another name, or sign in with that one. |
| **Too many attempts** | Wrong password too often: wait the time it shows, then try again. |
| Forgot the password | Ask the admin (the first profile) for a reset code: **Settings → Admin dashboard** → the profile → reset. Or sign in with a passkey, if you added one. |
| Option B: the iPhone can't open the address | Both must be on the same Wi‑Fi, Docker Desktop must be running, and Windows may need Docker allowed through the firewall. |

## Later

- **Back up** your data (everything is in one folder):
  `tar czf ~/opengym-backup-$(date +%F).tar.gz -C /opt/opengym data`
- **Update** openGym: `cd /opt/opengym && git pull && docker compose pull && docker compose up -d`
- **Change** the address: run `bash scripts/install-server.sh` again.
