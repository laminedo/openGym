#!/usr/bin/env bash
# openGym on a fresh internet server (a VPS) in one go: Docker, HTTPS with a free certificate, and
# sign-in with a profile name and password (plus passkeys). Written for people who have never run a
# server; docs/SELF_HOST_EASY.md is the walkthrough around it. Run it as root from this checkout:
#
#   bash scripts/install-server.sh             set up, or change the address, or update
#   bash scripts/install-server.sh --private   then nobody new can sign up without an invite code
#   bash scripts/install-server.sh --open      anyone with the address can sign up again
#
# It asks one thing, the server's address (e.g. lamine-gym.duckdns.org), then starts openGym behind
# Caddy (docker-compose.https.yml), which gets the certificate by itself. Run it again whenever you
# like: nothing in ./data is touched.
#
# Without questions, for scripts: OPENGYM_DOMAIN, and OPENGYM_YES=1 to go on past warnings.
# OPENGYM_NO_START=1 writes .env and stops before starting anything.
set -euo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
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
get_env() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1; }

cd "$(dirname "$0")/.."
[ -f docker-compose.https.yml ] && [ -f Caddyfile ] || die "Run this from inside the openGym folder (git clone first)."
[ "$(id -u)" = 0 ] || die "Run it as root: sudo bash scripts/install-server.sh"

# ------------------------------------------------- --private / --open: sign-ups --
case "${1:-}" in
  --private|--open)
    [ -f .env ] && [ -n "$(get_env RP_ID)" ] || die "Set openGym up first: bash scripts/install-server.sh"
    if [ "$1" = --private ]; then
      set_env INVITE_ONLY 1
      msg="Sign-ups are closed. Profiles that exist keep working; for someone new, make an invite code in Settings → Admin dashboard."
    else
      set_env INVITE_ONLY 0
      msg="Sign-ups are open: anyone with the address can create a profile."
    fi
    docker compose up -d >/dev/null
    say "✓ $msg"
    exit 0 ;;
  "") ;;
  *) die "Unknown option $1 (use --private or --open, or nothing)." ;;
esac

# ---------------------------------------------------------------- 1. Docker --
if ! docker compose version >/dev/null 2>&1; then
  say "Installing Docker (a few minutes)…"
  command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl; }
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Docker did not install. See https://docs.docker.com/engine/install/"

# ------------------------------------------------------------- 2. the address --
say "Your app's address"
echo "The name that points at this server, without https:// — e.g. lamine-gym.duckdns.org"
echo "(free at https://www.duckdns.org: create a name and set its IP to this server's)."
if [ -z "${OPENGYM_DOMAIN:-}" ]; then
  [ -t 0 ] || die "OPENGYM_DOMAIN is not set and there is no terminal to ask in."
  read -rp "Address: " OPENGYM_DOMAIN
fi
DOMAIN=$(printf '%s' "$OPENGYM_DOMAIN" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s/[[:space:]]//g')
[[ $DOMAIN =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] \
  || die "\"$OPENGYM_DOMAIN\" is not a name like gym.example.com."
[[ $DOMAIN =~ ^[0-9.]+$ ]] && die "Use a name, not an IP address: HTTPS certificates need a name."

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

# --------------------------------------------------------------------- 3. .env --
if [ -f .env ]; then cp .env ".env.bak-$(date +%Y%m%d-%H%M%S)"; else cp .env.example .env; fi
chmod 600 .env
set_env RP_ID "$DOMAIN"
set_env ORIGIN "https://$DOMAIN"
set_env COMPOSE_FILE "docker-compose.yml:docker-compose.https.yml"
# Sign in with a profile name and password, next to passkeys: free, nothing to set up anywhere else,
# and it works in every browser, on iPhone, iPad and computer alike.
set_env PASSWORD_LOGIN 1
# No "Continue without account": everything you log goes into your profile, so it is on all
# your devices. (A guest's workouts stay in that one browser and never sync.)
set_env ALLOW_GUEST 0
# The first profile made on a brand-new instance becomes its admin: that is you, if you sign up first.
[ -f data/db.json ] || set_env FIRST_USER_ADMIN 1

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw allow 443/udp >/dev/null
fi

if [ "${OPENGYM_NO_START:-}" = 1 ]; then say ".env written; not starting (OPENGYM_NO_START=1)."; exit 0; fi

# ------------------------------------------------------------------- 4. start --
say "Downloading and starting openGym (a few minutes the first time)…"
docker compose pull
docker compose up -d

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
cat <<EOF

Next:
  1. On your iPhone, open https://$DOMAIN in Safari, tap "Create new profile" and pick
     a name and a password (do this first: the first profile becomes the admin).
  2. Add it to the home screen: Share → Add to Home Screen.
  3. On your iPad and computer, open the same address, tap "Sign in with password" and
     use the same name and password. Everything you log shows up on all of them.
  4. Only you (and people you invite)?   bash scripts/install-server.sh --private

Back up your data:   tar czf ~/opengym-backup-\$(date +%F).tar.gz -C "$PWD" data
Update later:        cd "$PWD" && git pull && docker compose pull && docker compose up -d
EOF
