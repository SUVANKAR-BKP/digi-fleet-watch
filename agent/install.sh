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
# downloads agent.sh and the systemd units directly from the FleetWatch server.
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

# 3. Download the agent + units from the server (nothing transferred manually)
curl -fsSL "$FLEETWATCH_URL/agent.sh" -o "$FLEETWATCH_DIR/agent.sh"
curl -fsSL "$FLEETWATCH_URL/digi-fleet-watch.service" -o /etc/systemd/system/digi-fleet-watch.service
curl -fsSL "$FLEETWATCH_URL/digi-fleet-watch.timer" -o /etc/systemd/system/digi-fleet-watch.timer
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

  fleetwatch ALL=(root) NOPASSWD: /usr/bin/docker version, /usr/bin/docker info
EOF
  fi
fi

# 7. Start the 5-minute timer
systemctl daemon-reload
systemctl enable --now digi-fleet-watch.timer

echo "Digi Fleet Watch agent installed and timer enabled."
echo "Logs: $LOG_FILE   Config: $ENV_DIR/agent.env"
echo "Test manually: sudo -u fleetwatch $FLEETWATCH_DIR/agent.sh"