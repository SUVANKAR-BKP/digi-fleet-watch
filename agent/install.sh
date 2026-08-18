#!/usr/bin/env bash
#
# Digi Fleet Watch agent installer — run as root on each monitored host:
#
#   FLEETWATCH_URL=https://fleet.example.com \
#   AGENT_API_TOKEN=<shared secret> \
#   bash /opt/digi-fleet-watch/install.sh
#
set -euo pipefail

FLEETWATCH_DIR=/opt/digi-fleet-watch
ENV_DIR=/etc/digi-fleet-watch
LOG_FILE=/var/log/digi-fleet-watch.log
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

: "${FLEETWATCH_URL:?set FLEETWATCH_URL=https://your-fleetwatch-server}"
: "${AGENT_API_TOKEN:?set AGENT_API_TOKEN to the same secret as the server}"
FLEETWATCH_LABEL="${FLEETWATCH_LABEL:-}"

if [ "$(id -u)" != "0" ]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

# 1. Dedicated service user
if ! id fleetwatch >/dev/null 2>&1; then
  useradd --system --home-dir "$FLEETWATCH_DIR" --shell /usr/sbin/nologin fleetwatch
fi

# 2. Files
install -d -o fleetwatch -g fleetwatch "$FLEETWATCH_DIR"
install -d "$ENV_DIR"
install -m 0755 "$SRC_DIR/agent.sh" "$FLEETWATCH_DIR/agent.sh"
install -m 0644 "$SRC_DIR/digi-fleet-watch.service" /etc/systemd/system/
install -m 0644 "$SRC_DIR/digi-fleet-watch.timer" /etc/systemd/system/

# 3. Configuration (mode 600, secret material)
cat >"$ENV_DIR/agent.env" <<EOF
FLEETWATCH_URL=$FLEETWATCH_URL
AGENT_API_TOKEN=$AGENT_API_TOKEN
FLEETWATCH_LABEL=$FLEETWATCH_LABEL
EOF
chmod 600 "$ENV_DIR/agent.env"

# 4. Log file owned by the agent user
touch "$LOG_FILE"
chown fleetwatch:fleetwatch "$LOG_FILE"

# 5. Docker access: prefer the docker group (no root needed)
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

# 6. Start the 5-minute timer
systemctl daemon-reload
systemctl enable --now digi-fleet-watch.timer

echo "Digi Fleet Watch agent installed and timer enabled."
echo "Logs: $LOG_FILE   Config: $ENV_DIR/agent.env"
echo "Test manually: sudo -u fleetwatch $FLEETWATCH_DIR/agent.sh"