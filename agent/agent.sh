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
#   * `docker info`/`docker inspect` need docker access — either put the
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

# systemd supplies the config via EnvironmentFile, but a manual run
# (`sudo -u fleetwatch /opt/digi-fleet-watch/agent.sh`) has an empty
# environment and used to die with "AGENT_API_TOKEN is not set". Load the
# file here so both paths work; anything already exported still wins.
_env_url="${FLEETWATCH_URL:-}"
_env_token="${AGENT_API_TOKEN:-}"
_env_label="${FLEETWATCH_LABEL:-}"
AGENT_ENV_FILE="${FLEETWATCH_ENV_FILE:-/etc/digi-fleet-watch/agent.env}"
if [ -r "$AGENT_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$AGENT_ENV_FILE"
  set +a
fi

FLEETWATCH_URL="${_env_url:-${FLEETWATCH_URL:-}}"
AGENT_API_TOKEN="${_env_token:-${AGENT_API_TOKEN:-}}"
FLEETWATCH_LABEL="${_env_label:-${FLEETWATCH_LABEL:-}}"
LOG_FILE="${FLEETWATCH_LOG:-/var/log/digi-fleet-watch.log}"
HTTP_TIMEOUT="${FLEETWATCH_TIMEOUT:-30}"

# Set FLEETWATCH_VERBOSE=1 to mirror the log to stderr — the installer uses it
# so its first test run reports success or failure on the terminal.
log() {
  local line
  line="$(date -Is 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ) $*"
  printf '%s\n' "$line" >>"$LOG_FILE" 2>/dev/null || true
  if [ -n "${FLEETWATCH_VERBOSE:-}" ]; then printf '%s\n' "$line" >&2; fi
  return 0
}
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
# Resource metrics: CPU, load, memory, uptime, per-mount disk usage.
#
# Everything comes from /proc and coreutils, so the agent still needs nothing
# beyond curl + jq. Values are emitted as JSON numbers or null — never strings.
# The server's schema rejects the wrong type with HTTP 422.
# ---------------------------------------------------------------------------
metrics_json='null'
disks_json='[]'

# Echoes the argument if it is a non-negative integer, otherwise "null", so a
# missing /proc file degrades to a null column instead of a 422.
num_or_null() {
  case "${1:-}" in
    '' | *[!0-9]*) printf 'null' ;;
    *) printf '%s' "$1" ;;
  esac
}

# CPU busy % needs two samples of /proc/stat. The cpu line is
# user nice system idle iowait irq softirq steal...; idle time is idle+iowait.
read_cpu() {
  awk '/^cpu /{ total = 0; for (i = 2; i <= NF; i++) total += $i; print total, $5 + $6; exit }' \
    /proc/stat 2>/dev/null
}

cpu_pct='null'
if [ -r /proc/stat ]; then
  cpu_first="$(read_cpu)"
  sleep 1
  cpu_second="$(read_cpu)"
  if [ -n "$cpu_first" ] && [ -n "$cpu_second" ]; then
    cpu_pct="$(awk -v a="$cpu_first" -v b="$cpu_second" 'BEGIN {
      split(a, x, " "); split(b, y, " ")
      dt = y[1] - x[1]; di = y[2] - x[2]
      if (dt <= 0) { print "null" } else { printf "%.1f", (1 - di / dt) * 100 }
    }')"
  fi
fi

cpu_cores="$(num_or_null "$(nproc 2>/dev/null || true)")"

load1='null'; load5='null'; load15='null'; proc_count='null'
if [ -r /proc/loadavg ]; then
  read -r la1 la5 la15 procs _rest </proc/loadavg 2>/dev/null || true
  load1="${la1:-null}"; load5="${la5:-null}"; load15="${la15:-null}"
  # "running/total" -> total
  proc_count="$(num_or_null "${procs##*/}")"
fi

meminfo_kb() {
  awk -v key="$1" '$1 == key ":" { printf "%d", $2 * 1024; exit }' /proc/meminfo 2>/dev/null
}

mem_total='null'; mem_avail='null'; mem_used='null'
swap_total='null'; swap_used='null'
if [ -r /proc/meminfo ]; then
  mem_total="$(num_or_null "$(meminfo_kb MemTotal)")"
  mem_avail="$(num_or_null "$(meminfo_kb MemAvailable)")"
  swap_total="$(num_or_null "$(meminfo_kb SwapTotal)")"
  swap_free="$(num_or_null "$(meminfo_kb SwapFree)")"
  if [ "$mem_total" != "null" ] && [ "$mem_avail" != "null" ]; then
    mem_used="$((mem_total - mem_avail))"
  fi
  if [ "$swap_total" != "null" ] && [ "$swap_free" != "null" ]; then
    swap_used="$((swap_total - swap_free))"
  fi
fi

uptime_s='null'
if [ -r /proc/uptime ]; then
  uptime_s="$(num_or_null "$(awk '{printf "%d", $1; exit}' /proc/uptime 2>/dev/null || true)")"
fi

# Real filesystems only. tmpfs/devtmpfs/overlay/squashfs are volatile or are
# container layers; reporting them as "95% full" is pure noise.
dtmp="$(mktemp)"
if df -PT -B1 >/dev/null 2>&1; then
  df -PT -B1 2>/dev/null | tail -n +2 |
    while read -r _fs fstype total used avail _pct mount; do
      case "$fstype" in
        tmpfs | devtmpfs | squashfs | overlay | aufs | ramfs | autofs | proc | sysfs | cgroup* | fuse.* | nsfs | tracefs | debugfs | mqueue | hugetlbfs | binfmt_misc | configfs | pstore | securityfs | efivarfs)
          continue
          ;;
      esac
      case "$total" in '' | *[!0-9]*) continue ;; esac
      [ "$total" -gt 0 ] || continue
      inode_pct="$(df -PTi "$mount" 2>/dev/null | tail -n1 | awk '{gsub(/%/, "", $6); print $6}')"
      inode_pct="$(num_or_null "$inode_pct")"
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$mount" "$fstype" "$total" "$used" "$avail" "$inode_pct" >>"$dtmp"
    done
fi

if [ -s "$dtmp" ]; then
  # jq does the JSON quoting, so a mount point with a quote or backslash in it
  # cannot corrupt the payload.
  disks_json="$(jq -R -s -c '
    split("\n") | map(select(length > 0)) | map(split("\t")) |
    map({
      mount: .[0],
      fs_type: .[1],
      total_bytes: (.[2] | tonumber),
      used_bytes: (.[3] | tonumber),
      available_bytes: (.[4] | tonumber),
      use_pct: (if (.[2] | tonumber) > 0
                then (((.[3] | tonumber) / (.[2] | tonumber) * 1000) | round / 10)
                else 0 end),
      inode_use_pct: (if .[5] == "null" then null else (.[5] | tonumber) end)
    })
  ' "$dtmp" 2>/dev/null || echo '[]')"
fi

metrics_json="$(jq -n \
  --argjson cpu_pct "$cpu_pct" \
  --argjson cpu_cores "$cpu_cores" \
  --argjson load1 "$load1" \
  --argjson load5 "$load5" \
  --argjson load15 "$load15" \
  --argjson mem_total "$mem_total" \
  --argjson mem_used "$mem_used" \
  --argjson mem_available "$mem_avail" \
  --argjson swap_total "$swap_total" \
  --argjson swap_used "$swap_used" \
  --argjson uptime_seconds "$uptime_s" \
  --argjson process_count "$proc_count" \
  --argjson disks "$disks_json" \
  '{cpu_pct: $cpu_pct, cpu_cores: $cpu_cores,
    load1: $load1, load5: $load5, load15: $load15,
    mem_total_bytes: $mem_total, mem_used_bytes: $mem_used,
    mem_available_bytes: $mem_available,
    swap_total_bytes: $swap_total, swap_used_bytes: $swap_used,
    uptime_seconds: $uptime_seconds, process_count: $process_count,
    disks: $disks}' 2>/dev/null || echo null)"

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
  # Run directly first (docker group), keeping stdout; quietly fall back to
  # passwordless sudo for hosts without docker-group access.
  if "$docker_cmd" "$@" 2>/dev/null; then return 0; fi
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
    # The server's schema requires a JSON boolean here and returns HTTP 422 for
    # anything else. `echo $?` captured the exit status instead, which was both
    # the wrong type *and* inverted: is_docker_deprecated succeeds (exit 0) when
    # the engine is EOL, so it emitted 0 for deprecated and 1 for supported.
    if is_docker_deprecated "$engine"; then deprecated=true; else deprecated=false; fi
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
# Docker containers (optional): per-container detail
#
# For every container (running or not) we emit one object with name, image,
# tag, digest, state, health, restart count, age, and an is_unpinned_latest
# flag.
#
# NOTE on drift detection: is_unpinned_latest + age_days are *practical
# proxies* for image drift risk — a `:latest` or untagged image is not pinned
# to a reproducible tag. They do NOT say whether the tag currently on the host
# is stale versus the registry; that would require a per-image remote query
# (`docker manifest inspect` / registry API) and is deliberately out of scope
# for this pass (see README "Known limitations").
# ---------------------------------------------------------------------------
containers_json='[]'
if [ -n "$docker_cmd" ]; then
  ps_json="$(run_docker ps -a --format '{{json .}}' 2>/dev/null)"
  if [ -n "$ps_json" ]; then
    ctmp="$(mktemp)"
    trap 'rm -f "$tmp" "$sec_tmp" "$ctmp"' EXIT
    : >"$ctmp"
    while IFS= read -r cid; do
      [ -n "$cid" ] || continue
      insp="$(run_docker inspect "$cid" 2>/dev/null)"
      [ -n "$insp" ] || continue
      cjson="$(printf '%s' "$insp" | jq -c '.[0] | {
        container_id: .Id,
        name: (.Name | ltrimstr("/")),
        image: .Config.Image,
        image_tag: (.Config.Image | split("/")[-1] | (if contains(":") then split(":")[-1] else "latest" end)),
        image_digest: ((.RepoDigests[0] // null) | (if . != null and contains("@") then split("@")[-1] else null end)),
        status: (.State.Status // null),
        health_status: (.State.Health.Status // null),
        restart_count: (.RestartCount // 0),
        created_at: (.Created // null)
      }' 2>/dev/null || true)"
      [ -n "$cjson" ] || continue

      # Age in whole + fractional days since the container was created.
      age_days="0"
      created="$(printf '%s' "$cjson" | jq -r '.created_at' 2>/dev/null || true)"
      if [ -n "$created" ]; then
        created_epoch="$(date -d "$created" +%s 2>/dev/null || true)"
        if [ -n "$created_epoch" ]; then
          now_epoch="$(date +%s 2>/dev/null || echo 0)"
          age_days="$(awk -v c="$created_epoch" -v n="$now_epoch" 'BEGIN { printf "%.1f", (n - c) / 86400 }')"
        fi
      fi

      row="$(printf '%s' "$cjson" | jq -c \
        --arg age "$age_days" \
        '. + {age_days: ($age | tonumber), is_unpinned_latest: (.image_tag == "latest")}' 2>/dev/null || true)"
      [ -n "$row" ] && printf '%s\n' "$row" >>"$ctmp"
    done <<<"$(printf '%s' "$ps_json" | jq -r 'select(.ID != null) | .ID' 2>/dev/null)"

    if [ -s "$ctmp" ]; then
      containers_json="$(jq -s '.' "$ctmp" 2>/dev/null || echo '[]')"
    fi
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
  --argjson containers "$containers_json" \
  --argjson metrics "$metrics_json" \
  --arg collected "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{hostname:$hostname, label:$label,
    os:{name:$os_name, version:$os_version, kernel:$kernel},
    packages:$packages, docker:$docker, containers:$containers,
    metrics:$metrics, collected_at:$collected}')"

printf '%s' "$payload" | jq -e . >/dev/null 2>&1 || die "failed to build valid JSON payload"

# Catch type mistakes here rather than as an opaque HTTP 422 from the server.
# `docker.deprecated` in particular has to be a real boolean, not 0/1.
printf '%s' "$payload" | jq -e '
  (.docker == null or (.docker.deprecated | type) == "boolean")
  and (.containers | type) == "array"
  and (.packages | type) == "array"
' >/dev/null 2>&1 || die "internal: payload failed its own type check (docker.deprecated must be a boolean)"

# Keep the response body: a 401 (wrong token), 422 (payload mismatch) and 500
# (server-side schema problem) are indistinguishable from the status code
# alone, and discarding it meant every failure looked the same in the log.
resp_body="$(mktemp)"
# ${ctmp:+...} keeps the container temp file in the cleanup list when the
# Docker section ran, without tripping `set -u` when it did not.
trap 'rm -f "$tmp" "$sec_tmp" "$resp_body" ${ctmp:+"$ctmp"} ${dtmp:+"$dtmp"}' EXIT

post_once() {
  curl -sS --max-time "$HTTP_TIMEOUT" -o "$resp_body" -w '%{http_code}' \
    -X POST "$FLEETWATCH_URL/api/ingest" \
    -H "Authorization: Bearer $AGENT_API_TOKEN" \
    -H 'Content-Type: application/json' \
    --data-binary "$payload"
}

code="$(post_once)"
if [ "$code" != "201" ] && [ "$code" != "200" ]; then
  log "WARN: ingest returned HTTP $code — retrying once"
  log "WARN: server said: $(head -c 500 "$resp_body" 2>/dev/null)"
  sleep 10
  code="$(post_once)"
fi

if [ "$code" = "201" ] || [ "$code" = "200" ]; then
  log "OK: reported host '$hostname' (HTTP $code)"
  # The server flags agents still authenticating with the pre-rotation secret.
  # Surfacing it here means the host itself tells you it needs re-enrolling,
  # instead of the warning living only in the server log.
  if jq -e '.tokenRotationPending == true' "$resp_body" >/dev/null 2>&1; then
    log "WARN: this host is still using the OLD agent token. The server is honouring"
    log "WARN: it during a rotation grace period. Re-run the Add Host command here."
  fi
else
  case "$code" in
    401) log "HINT: AGENT_API_TOKEN does not match the server's. Re-run the Add Host command." ;;
    422) log "HINT: the server rejected the payload shape — check for an agent/server version mismatch." ;;
    5*)  log "HINT: the server errored. Check its logs; the database schema may be behind the app." ;;
    000) log "HINT: could not reach $FLEETWATCH_URL — check firewall/DNS from this host." ;;
  esac
  log "server said: $(head -c 500 "$resp_body" 2>/dev/null)"
  die "ingest failed with HTTP $code"
fi