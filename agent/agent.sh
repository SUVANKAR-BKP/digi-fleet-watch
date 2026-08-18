#!/usr/bin/env bash
#
# Digi Fleet Watch agent
# ----------------------
# Collects host package/Docker state and posts it to the central Digi Fleet
# Watch server. Designed to run via a systemd timer (or cron) every 5 minutes.
#
# Requirements: curl + jq only. Runs fine as an unprivileged user.
#   * `apt list` needs fresh apt lists; a nightly `apt update` (or the agent
#     running as root once) keeps them current.
#   * `docker info`/`docker version` need docker access — either put the
#     service user in the `docker` group, or grant a narrow sudo rule.
#   * `debsecan` is optional: if installed it marks security-relevant updates;
#     otherwise the agent degrades gracefully.
#
# Environment (from /etc/digi-fleet-watch/agent.env or the shell):
#   FLEETWATCH_URL    base URL of the central server (no trailing slash)
#   AGENT_API_TOKEN   shared secret matching the server's AGENT_API_TOKEN
#   FLEETWATCH_LABEL  optional human-readable label for this host
#   FLEETWATCH_LOG    log path (default /var/log/digi-fleet-watch.log)

set -uo pipefail

FLEETWATCH_URL="${FLEETWATCH_URL:-}"
AGENT_API_TOKEN="${AGENT_API_TOKEN:-}"
FLEETWATCH_LABEL="${FLEETWATCH_LABEL:-}"
LOG_FILE="${FLEETWATCH_LOG:-/var/log/digi-fleet-watch.log}"
HTTP_TIMEOUT="${FLEETWATCH_TIMEOUT:-30}"

log() { printf '%s %s\n' "$(date -Is 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG_FILE" 2>/dev/null || true; }
die() { log "ERROR: $*"; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v jq >/dev/null 2>&1 || die "jq is required"
[ -n "$AGENT_API_TOKEN" ] || die "AGENT_API_TOKEN is not set"
[ -n "$FLEETWATCH_URL" ] || die "FLEETWATCH_URL is not set"

# ---------------------------------------------------------------------------
# OS facts
# ---------------------------------------------------------------------------
. /etc/os-release 2>/dev/null || true
hostname="$(hostname -s 2>/dev/null || hostname)"
os_name="${NAME:-unknown}"
os_version="${VERSION_ID:-unknown}"
kernel="$(uname -r 2>/dev/null || echo unknown)"

# ---------------------------------------------------------------------------
# Packages: apt list --upgradable
# Line format:  nginx/bionic-updates 1.18.0-6ubuntu14.4 amd64 [upgradable from: 1.18.0-6ubuntu14.3]
# ---------------------------------------------------------------------------
tmp="$(mktemp)"; sec_tmp="$(mktemp)"
trap 'rm -f "$tmp" "$sec_tmp"' EXIT
: >"$tmp"

packages_json='[]'
if command -v apt >/dev/null 2>&1; then
  # Refresh package lists when we are root; otherwise rely on existing lists.
  if [ "$(id -u)" = "0" ]; then
    apt-get -qq update >/dev/null 2>&1 || true
  fi

  apt list --upgradable 2>/dev/null | tail -n +2 | while IFS= read -r line; do
    name="${line%%/*}"                 # strip "/archive"
    [ -n "$name" ] || continue
    rest="${line#* }"                  # remaining: version arch [upgradable ...]
    available="${rest%% *}"
    installed=""
    if [[ "$rest" =~ \[upgradable[[:space:]]*(from|to):[[:space:]]*([^]]+)\] ]]; then
      installed="${BASH_REMATCH[2]}"
    fi
    printf '%s\t%s\t%s\n' "$name" "$available" "$installed" >>"$tmp"
  done

  # Security-relevant updates via debsecan (optional).
  if command -v debsecan >/dev/null 2>&1; then
    debsecan --format lines 2>/dev/null | awk '{print $1}' | sort -u >"$sec_tmp" || true
  fi

  packs_json="$(awk -F'\t' -v secfile="$sec_tmp" '
    BEGIN { while ((getline s < secfile) > 0) sec[s] = 1 }
    {
      secflag = ($1 in sec) ? "true" : "false";
      printf "%s", (NR > 1 ? "," : "");
      printf "{\"name\":%s,\"installed\":%s,\"available\":%s,\"security\":%s,\"cve_ids\":[]}",
             q($1), q($3), q($2), secflag
    }
    function q(s) {
      gsub(/\\/, "\\\\", s);
      gsub(/"/, "\\\"", s);
      return "\"" s "\""
    }
  ' "$tmp")"
  packages_json="[$packs_json]"
fi

# ---------------------------------------------------------------------------
# Docker (optional): engine version, API version, container counts
# ---------------------------------------------------------------------------
docker_json='null'
docker_cmd=""
for c in docker podman; do
  if command -v "$c" >/dev/null 2>&1; then docker_cmd="$c"; break; fi
done

run_docker() {
  if [ "$(id -u)" = "0" ]; then
    "$docker_cmd" "$@"; return $?
  fi
  if "$docker_cmd" "$@" >/dev/null 2>&1; then return 0; fi
  # Fall back to passwordless sudo for hosts without docker-group access.
  if command -v sudo >/dev/null 2>&1; then
    sudo -n "$docker_cmd" "$@" 2>/dev/null
  fi
}

# Hardcoded list of Docker engine versions that have reached end of life.
DOCKER_EOL_PREFIXES="17.03 17.06 17.09 18.03 18.06 18.09 19.03 20.10 21.10 22.06 23.0 24.0"
is_docker_deprecated() {
  local v="$1"
  [ -n "$v" ] || return 1
  for p in $DOCKER_EOL_PREFIXES; do
    case "$v" in
      "$p"*) return 0 ;;
    esac
  done
  return 1
}

if [ -n "$docker_cmd" ]; then
  vjson="$(run_docker version --format '{{json .}}')"
  ijson="$(run_docker info --format '{{json .}}')"
  if [ -n "$vjson" ]; then
    engine="$(printf '%s' "$vjson" | jq -r '.Server.Version // .Client.Version // ""' 2>/dev/null)"
    api="$(printf '%s' "$vjson" | jq -r '.Server.APIVersion // ""' 2>/dev/null)"
    running="$(printf '%s' "$ijson" | jq -r '.ContainersRunning // 0' 2>/dev/null)"
    total="$(printf '%s' "$ijson" | jq -r '.Containers // 0' 2>/dev/null)"
    deprecated="$(is_docker_deprecated "$engine"; echo $?)"
    docker_json="$(jq -n \
      --arg v "$engine" \
      --arg a "$api" \
      --argjson dep "${deprecated}" \
      --argjson r "${running:-0}" \
      --argjson t "${total:-0}" \
      '{engine_version:$v, api_version:$a, deprecated:$dep, containers_running:$r, containers_total:$t}')"
  fi
fi

# ---------------------------------------------------------------------------
# Assemble and POST the payload
# ---------------------------------------------------------------------------
payload="$(jq -n \
  --arg hostname "$hostname" \
  --arg label "$FLEETWATCH_LABEL" \
  --arg os_name "$os_name" \
  --arg os_version "$os_version" \
  --arg kernel "$kernel" \
  --argjson packages "$packages_json" \
  --argjson docker "$docker_json" \
  --arg collected "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{hostname:$hostname, label:$label,
    os:{name:$os_name, version:$os_version, kernel:$kernel},
    packages:$packages, docker:$docker, collected_at:$collected}')"

printf '%s' "$payload" | jq -e . >/dev/null 2>&1 || die "failed to build valid JSON payload"

post_once() {
  curl -sS --max-time "$HTTP_TIMEOUT" -o /dev/null -w '%{http_code}' \
    -X POST "$FLEETWATCH_URL/api/ingest" \
    -H "Authorization: Bearer $AGENT_API_TOKEN" \
    -H 'Content-Type: application/json' \
    --data-binary "$payload"
}

code="$(post_once)"
if [ "$code" != "201" ] && [ "$code" != "200" ]; then
  log "WARN: ingest returned HTTP $code — retrying once"
  sleep 10
  code="$(post_once)"
fi

if [ "$code" = "201" ] || [ "$code" = "200" ]; then
  log "OK: reported host '$hostname' (HTTP $code)"
else
  die "ingest failed with HTTP $code"
fi