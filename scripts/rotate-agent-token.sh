#!/usr/bin/env bash
#
# Rotate AGENT_API_TOKEN without breaking the fleet.
#
#   ./scripts/rotate-agent-token.sh start    # new token; old one still accepted
#   ./scripts/rotate-agent-token.sh status   # who is still on the old token
#   ./scripts/rotate-agent-token.sh finish   # stop accepting the old token
#
# Rotating a single shared secret in place 401s every enrolled agent the moment
# the server restarts. `start` instead moves the current token to
# AGENT_API_TOKEN_PREVIOUS, which the server keeps honouring, so hosts can be
# re-enrolled one at a time. `finish` drops it once they all report on the new
# secret.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env"
[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE here. Run this from the repo root on the server." >&2; exit 1; }

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
read_env() {                       # read_env KEY -> value on stdout
  sed -n "s/^$1=//p" "$ENV_FILE" | head -n1
}

write_env() {                      # write_env KEY VALUE (adds the key if absent)
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    # Tokens are hex, but use a delimiter that cannot appear in one anyway.
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

gen_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

restart_app() {
  echo "Restarting the app so it picks up the new environment ..."
  # --force-recreate because compose does not reliably notice env_file edits.
  docker compose up -d --force-recreate app
}

mask() { printf '%s…%s' "${1:0:6}" "${1: -4}"; }

# ---------------------------------------------------------------------------
case "${1:-start}" in

start)
  current="$(read_env AGENT_API_TOKEN)"
  [ -n "$current" ] || { echo "AGENT_API_TOKEN is empty in $ENV_FILE — nothing to rotate." >&2; exit 1; }

  existing_prev="$(read_env AGENT_API_TOKEN_PREVIOUS)"
  if [ -n "$existing_prev" ]; then
    echo "A rotation is already in progress (AGENT_API_TOKEN_PREVIOUS is set)." >&2
    echo "Finish it with '$0 finish' before starting another." >&2
    exit 1
  fi

  backup="${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$ENV_FILE" "$backup"
  chmod 600 "$backup"

  new="$(gen_token)"
  write_env AGENT_API_TOKEN_PREVIOUS "$current"
  write_env AGENT_API_TOKEN "$new"

  echo "Backed up $ENV_FILE -> $backup"
  echo "  old token (still accepted): $(mask "$current")"
  echo "  new token (now current):    $(mask "$new")"
  echo
  restart_app
  cat <<'EOF'

Rotation started. Both tokens are accepted right now.

Next:
  1. Open the dashboard -> "+ Add Host" -> Copy, and run that command on each
     monitored host. It rewrites /etc/digi-fleet-watch/agent.env with the new
     token. Hosts still on the old one keep reporting meanwhile.
  2. Check who is left:   ./scripts/rotate-agent-token.sh status
  3. When none are left:  ./scripts/rotate-agent-token.sh finish
EOF
  ;;

status)
  if [ -z "$(read_env AGENT_API_TOKEN_PREVIOUS)" ]; then
    echo "No rotation in progress — AGENT_API_TOKEN_PREVIOUS is not set."
    exit 0
  fi
  echo "Rotation in progress. Hosts seen using the OLD token recently:"
  echo
  if docker compose logs --since 24h app 2>/dev/null \
      | grep -o 'host "[^"]*" is still using AGENT_API_TOKEN_PREVIOUS' \
      | sed 's/host "\([^"]*\)".*/  - \1/' | sort -u | grep .; then
    echo
    echo "Re-run the Add Host command on each, then: $0 finish"
  else
    echo "  (none in the last 24h)"
    echo
    echo "Every agent that reported recently is on the new token. Safe to run:"
    echo "  $0 finish"
  fi
  ;;

finish)
  if [ -z "$(read_env AGENT_API_TOKEN_PREVIOUS)" ]; then
    echo "Nothing to do — AGENT_API_TOKEN_PREVIOUS is not set."
    exit 0
  fi
  # Drop the key entirely; an empty value would also disable it, but removing
  # it keeps .env honest about what is configured.
  sed -i '/^AGENT_API_TOKEN_PREVIOUS=/d' "$ENV_FILE"
  echo "Removed AGENT_API_TOKEN_PREVIOUS. The old token is now rejected."
  echo
  restart_app
  echo
  echo "Rotation complete. Any host still using the old token will now 401 —"
  echo "re-run the Add Host command there if one turns up as down."
  ;;

*)
  echo "usage: $0 [start|status|finish]" >&2
  exit 2
  ;;
esac
