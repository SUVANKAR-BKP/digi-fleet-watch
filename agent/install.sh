#!/usr/bin/env bash
#
# Digi Fleet Watch agent installer — run as root on each monitored host:
#
#   curl -fsSL <YOUR_SERVER_URL>/install.sh | \
#     AGENT_API_TOKEN=<shared secret> \
#     FLEETWATCH_URL=<YOUR_SERVER_URL> \
#     bash
#
# This is a self-contained bootstrap: it ensures curl + jq are present, then
# downloads agent.sh directly from the FleetWatch server and schedules it via
# a systemd timer when available, falling back to cron. On hosts with neither
# init system (minimal containers) it fails with a pointer to the standalone
# containerized agent instead.
set -euo pipefail

: "${FLEETWATCH_URL:?set FLEETWATCH_URL to your Digi Fleet Watch server}"
: "${AGENT_API_TOKEN:?set AGENT_API_TOKEN to the same secret as the server}"
FLEETWATCH_LABEL="${FLEETWATCH_LABEL:-}"

if [ "$(id -u)" != "0" ]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

# 0. Ensure curl + jq are present BEFORE downloading anything.
if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl jq
fi
command -v curl >/dev/null 2>&1 || { echo "curl unavailable after install" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq unavailable after install" >&2; exit 1; }

FLEETWATCH_DIR=/opt/digi-fleet-watch
ENV_DIR=/etc/digi-fleet-watch
LOG_FILE=/var/log/digi-fleet-watch.log

# 1. Dedicated service user
if ! id fleetwatch >/dev/null 2>&1; then
  useradd --system --home-dir "$FLEETWATCH_DIR" --shell /usr/sbin/nologin fleetwatch
fi

# 2. Directories
install -d -o fleetwatch -g fleetwatch "$FLEETWATCH_DIR"
install -d "$ENV_DIR"

# 3. Download the agent from the server (nothing transferred manually)
curl -fsSL "$FLEETWATCH_URL/agent.sh" -o "$FLEETWATCH_DIR/agent.sh"
chmod 0755 "$FLEETWATCH_DIR/agent.sh"

# 4. Configuration (mode 600, secret material)
cat >"$ENV_DIR/agent.env" <<EOF
FLEETWATCH_URL=$FLEETWATCH_URL
AGENT_API_TOKEN=$AGENT_API_TOKEN
FLEETWATCH_LABEL=$FLEETWATCH_LABEL
EOF
chmod 600 "$ENV_DIR/agent.env"

# 5. Log file owned by the agent user
touch "$LOG_FILE"
chown fleetwatch:fleetwatch "$LOG_FILE"

# 6. Docker access: prefer the docker group (no root needed)
if command -v docker >/dev/null 2>&1; then
  if getent group docker >/dev/null 2>&1; then
    usermod -aG docker fleetwatch
    echo "Added fleetwatch to the 'docker' group. Re-login on the host may be needed."
  else
    cat <<'EOF'
NOTE: no 'docker' group found. The agent falls back to `sudo -n docker ...`;
add this sudoers rule if you want unprivileged docker collection:

  fleetwatch ALL=(root) NOPASSWD: /usr/bin/docker version, /usr/bin/docker info, /usr/bin/docker ps, /usr/bin/docker inspect
EOF
  fi
fi

# 7. Schedule the agent: systemd timer when available, else cron, else error.
HAS_SYSTEMD=0
if command -v systemctl >/dev/null 2>&1 &&
   { command -v ps >/dev/null 2>&1 && [ "$(ps -p 1 -o comm=)" = "systemd" ]; }; then
  HAS_SYSTEMD=1
fi

if [ "$HAS_SYSTEMD" = "1" ]; then
  # Download + install the systemd units
  curl -fsSL "$FLEETWATCH_URL/digi-fleet-watch.service" -o /etc/systemd/system/digi-fleet-watch.service
  curl -fsSL "$FLEETWATCH_URL/digi-fleet-watch.timer" -o /etc/systemd/system/digi-fleet-watch.timer
  systemctl daemon-reload
  systemctl enable --now digi-fleet-watch.timer
  echo "Installed via systemd timer (every 5 minutes)."
elif command -v crond >/dev/null 2>&1 || command -v cron >/dev/null 2>&1; then
  # No systemd: schedule the agent for the 'fleetwatch' user via a system crontab.
  printf '*/5 * * * * fleetwatch /bin/bash %s/agent.sh >> %s 2>&1\n' \
    "$FLEETWATCH_DIR" "$LOG_FILE" > /etc/cron.d/digi-fleet-watch
  chmod 0644 /etc/cron.d/digi-fleet-watch
  echo "Installed via cron (every 5 minutes)."
else
  cat >&2 <<'EOF'
ERROR: this host has neither systemd nor cron/crond, so it is not a supported
target for the bare-metal install path.

For container-only / minimal hosts, run the standalone containerized agent
instead (see the README "Containerized agent" section). It needs only the
Docker socket, and no init system:

  docker run -d --name fleetwatch-agent \
    -e FLEETWATCH_URL=http://<YOUR_SERVER_HOST>:3000 \
    -e AGENT_API_TOKEN=<token> \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    --restart unless-stopped \
    digi-fleet-watch-agent:latest
EOF
  exit 1
fi

echo "Digi Fleet Watch agent installed."
echo "Logs: $LOG_FILE   Config: $ENV_DIR/agent.env"
echo "Test manually: sudo -u fleetwatch $FLEETWATCH_DIR/agent.sh"