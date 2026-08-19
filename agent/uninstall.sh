#!/usr/bin/env bash
#
# Digi Fleet Watch agent uninstaller — run as root on a monitored host:
#
#   curl -fsSL <YOUR_SERVER_URL>/uninstall.sh | bash
#
# Removes the schedule, the agent, and the stored credentials. Deleting a host
# from the dashboard alone is not enough: the agent keeps reporting on its
# timer and the host simply re-registers on the next heartbeat. Run this first
# (or immediately after) to actually stop monitoring.
#
# Safe to run more than once, and safe to run on a host where the agent was
# never installed.
set -uo pipefail

if [ "$(id -u)" != "0" ]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

FLEETWATCH_DIR=/opt/digi-fleet-watch
ENV_DIR=/etc/digi-fleet-watch
LOG_FILE=/var/log/digi-fleet-watch.log
KEEP_USER="${FLEETWATCH_KEEP_USER:-}"

removed_any=0
note() { echo "  - $*"; removed_any=1; }

echo "Removing the Digi Fleet Watch agent ..."

# 1. Stop the schedule first so nothing fires mid-uninstall.
if command -v systemctl >/dev/null 2>&1; then
  if systemctl list-unit-files 2>/dev/null | grep -q '^digi-fleet-watch\.timer'; then
    systemctl disable --now digi-fleet-watch.timer >/dev/null 2>&1 || true
    note "stopped and disabled digi-fleet-watch.timer"
  fi
  # The oneshot service may still be mid-run.
  systemctl stop digi-fleet-watch.service >/dev/null 2>&1 || true

  for unit in digi-fleet-watch.timer digi-fleet-watch.service; do
    if [ -f "/etc/systemd/system/$unit" ]; then
      rm -f "/etc/systemd/system/$unit"
      note "removed /etc/systemd/system/$unit"
    fi
  done
  systemctl daemon-reload >/dev/null 2>&1 || true
fi

# 2. cron fallback used on hosts without systemd.
if [ -f /etc/cron.d/digi-fleet-watch ]; then
  rm -f /etc/cron.d/digi-fleet-watch
  note "removed /etc/cron.d/digi-fleet-watch"
fi

# 3. The agent itself.
if [ -d "$FLEETWATCH_DIR" ]; then
  rm -rf "$FLEETWATCH_DIR"
  note "removed $FLEETWATCH_DIR"
fi

# 4. Credentials. This holds AGENT_API_TOKEN, so it matters most.
if [ -d "$ENV_DIR" ]; then
  rm -rf "$ENV_DIR"
  note "removed $ENV_DIR (including the stored agent token)"
fi

# 5. Log file.
if [ -f "$LOG_FILE" ]; then
  rm -f "$LOG_FILE"
  note "removed $LOG_FILE"
fi

# 6. Service account. Skip with FLEETWATCH_KEEP_USER=1 if something else on
#    this host owns files as `fleetwatch`.
if [ -z "$KEEP_USER" ] && id fleetwatch >/dev/null 2>&1; then
  if command -v userdel >/dev/null 2>&1; then
    userdel fleetwatch >/dev/null 2>&1 && note "removed the 'fleetwatch' user" \
      || echo "  ! could not remove the 'fleetwatch' user (it may own other files)"
  fi
fi

echo
if [ "$removed_any" = "1" ]; then
  echo "Done. This host will stop reporting immediately."
else
  echo "Nothing to remove — the agent was not installed here."
fi
echo "Delete the host from the dashboard to clear its stored history."
