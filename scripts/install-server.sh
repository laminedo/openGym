#!/usr/bin/env bash
# openGym on a fresh internet server (a VPS) in one go: Docker, HTTPS with a free certificate,
# and "Continue with Google". Written for people who have never run a server; docs/START_HERE.md
# is the walkthrough around it. Run it as root from inside this checkout:
#
#   bash scripts/install-server.sh
#
# It asks for three things: the server's address (e.g. lamine-gym.duckdns.org) and the Google
# client id and secret (Enter skips Google). Then it builds this checkout and starts it behind
# Caddy (docker-compose.https.yml), which gets the certificate by itself. Run it again to change
# the answers or after `git pull` to update; nothing in ./data is touched.
#
# Without questions, for scripts: OPENGYM_DOMAIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and
# OPENGYM_YES=1 to go on past warnings. OPENGYM_NO_START=1 writes .env and stops before starting.
set -euo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ask()  { # ask VAR "question" [hidden]: keeps a value already in the environment
  local var=$1 q=$2 hidden=${3:-}
  if [ -n "${!var:-}" ]; then return; fi
  [ -t 0 ] || die "$var is not set and there is no terminal to ask in."
  if [ -n "$hidden" ]; then read -rsp "$q " "$var"; echo; else read -rp "$q " "$var"; fi
}
go_on() { # go_on "question": yes to continue
  [ "${OPENGYM_YES:-}" = 1 ] && return 0
  [ -t 0 ] || return 1
  local a; read -rp "$1 [y/N] " a; [[ $a =~ ^[Yy] ]]
}
# set_env KEY VALUE: one line KEY=VALUE in .env, replacing any earlier one.
set_env() {
  local tmp; tmp=$(mktemp)
  grep -v "^$1=" .env > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > .env && rm -f "$tmp"
}

cd "$(dirname "$0")/.."
[ -f docker-compose.https.yml ] && [ -f Caddyfile ] || die "Run this from inside the openGym folder (git clone first)."
[ "$(id -u)" = 0 ] || die "Run it as root: sudo bash scripts/install-server.sh"

# ---------------------------------------------------------------- 1. Docker --
if ! docker compose version >/dev/null 2>&1; then
  say "Installing Docker (a few minutes)…"
  command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl; }
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Docker did not install. See https://docs.docker.com/engine/install/"

# ---------------------------------------------------------- 2. memory (swap) --
# Building the app needs about 800 MB of memory; a 1 GB server gets a 2 GB swap file for it.
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
swap_mb=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 1900 ] && [ "$swap_mb" -lt 1000 ] && [ ! -e /swapfile ]; then
  say "Adding 2 GB of swap (this server has ${mem_mb} MB of memory)…"
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ------------------------------------------------------------- 3. the address --
say "Your app's address"
echo "The name that points at this server, without https:// — e.g. lamine-gym.duckdns.org"
echo "(free at https://www.duckdns.org: create a name and set its IP to this server's)."
ask OPENGYM_DOMAIN "Address:"
DOMAIN=$(printf '%s' "$OPENGYM_DOMAIN" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s/[[:space:]]//g')
[[ $DOMAIN =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] \
  || die "\"$OPENGYM_DOMAIN\" is not a name like gym.example.com."
[[ $DOMAIN =~ ^[0-9.]+$ ]] && die "Use a name, not an IP address: Google and HTTPS certificates need a name."

# Does the name point here? Let's Encrypt can only issue the certificate if it does.
my_ip=$(curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)
dns_ip=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}' || true)
if [ -z "$dns_ip" ]; then
  here_ip=${my_ip:-"this server's IP"}
  warn "$DOMAIN does not point anywhere yet. Set it to $here_ip (DuckDNS: 'current ip'), then run this again."
  go_on "Continue anyway?" || exit 1
elif [ -n "$my_ip" ] && [ "$dns_ip" != "$my_ip" ]; then
  warn "$DOMAIN points at $dns_ip, but this server is $my_ip. HTTPS will not work until they match."
  go_on "Continue anyway?" || exit 1
fi

# ------------------------------------------------------------------ 4. Google --
say "Continue with Google"
echo "In Google Cloud, the OAuth client's Authorized redirect URI must be exactly:"
echo "    https://$DOMAIN/api/auth/google/callback"
echo "Paste its Client ID and Client secret below (docs/GOOGLE_SIGN_IN.md shows where they are)."
echo "Press Enter on both to skip Google for now; passkeys work without it."
ask GOOGLE_CLIENT_ID "Client ID:"
ask GOOGLE_CLIENT_SECRET "Client secret (hidden while you type or paste):" hidden
GOOGLE_CLIENT_ID=$(printf '%s' "$GOOGLE_CLIENT_ID" | tr -d '[:space:]')
GOOGLE_CLIENT_SECRET=$(printf '%s' "$GOOGLE_CLIENT_SECRET" | tr -d '[:space:]')
if [ -n "$GOOGLE_CLIENT_ID" ] && [[ $GOOGLE_CLIENT_ID != *.apps.googleusercontent.com ]]; then
  warn "A Google client id ends in .apps.googleusercontent.com — check you copied the Client ID."
  go_on "Use it anyway?" || exit 1
fi
if { [ -n "$GOOGLE_CLIENT_ID" ] && [ -z "$GOOGLE_CLIENT_SECRET" ]; } || { [ -z "$GOOGLE_CLIENT_ID" ] && [ -n "$GOOGLE_CLIENT_SECRET" ]; }; then
  die "Google needs both the Client ID and the Client secret (or neither)."
fi

# --------------------------------------------------------------------- 5. .env --
if [ -f .env ]; then cp .env ".env.bak-$(date +%Y%m%d-%H%M%S)"; else cp .env.example .env; fi
chmod 600 .env
set_env RP_ID "$DOMAIN"
set_env ORIGIN "https://$DOMAIN"
set_env COMPOSE_FILE "docker-compose.yml:docker-compose.https.yml"
set_env GOOGLE_CLIENT_ID "$GOOGLE_CLIENT_ID"
set_env GOOGLE_CLIENT_SECRET "$GOOGLE_CLIENT_SECRET"
# The first profile made on a brand-new instance becomes its admin: that is you, if you sign in first.
[ -f data/db.json ] || set_env FIRST_USER_ADMIN 1

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw allow 443/udp >/dev/null
fi

if [ "${OPENGYM_NO_START:-}" = 1 ]; then say ".env written; not starting (OPENGYM_NO_START=1)."; exit 0; fi

# ------------------------------------------------------------------- 6. start --
say "Building and starting openGym (the first time takes 5–10 minutes)…"
docker compose up -d --build

say "Waiting for https://$DOMAIN …"
ok=
for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 5
done

if [ -n "$ok" ]; then
  say "✓ openGym is running at https://$DOMAIN"
else
  warn "https://$DOMAIN does not answer yet. The certificate needs $DOMAIN to point at this server"
  warn "and ports 80 and 443 to be open. Look at:  docker compose logs caddy | tail -30"
fi
if [ -n "$GOOGLE_CLIENT_ID" ]; then
  if docker compose logs api 2>/dev/null | grep -q "Google sign-in on (redirect address https://$DOMAIN/api/auth/google/callback)"; then
    echo "✓ Continue with Google is on. Google's redirect URI must be: https://$DOMAIN/api/auth/google/callback"
  else
    warn "Continue with Google did not switch on. Look at:  docker compose logs api | grep -i google"
  fi
fi
cat <<EOF

Next:
  1. On your phone, open https://$DOMAIN and sign in (first, so your profile is the admin).
  2. Add it to the home screen: iPhone Safari → Share → Add to Home Screen;
     Android Chrome → ⋮ → Add to home screen.
  3. On your tablet and computer, open the same address and sign in with the same account.

Back up your data:   tar czf ~/opengym-backup-\$(date +%F).tar.gz -C "$PWD" data
Update later:        cd "$PWD" && git pull && docker compose up -d --build
EOF
