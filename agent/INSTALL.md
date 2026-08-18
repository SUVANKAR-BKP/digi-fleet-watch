# Installing the FleetWatch agent on a monitored host

The agent is a single Bash script with **no dependencies beyond `curl` and `jq`**.
It runs on the host itself (not in a container) so it can read the real
`apt`/`dpkg` state and talk to the host Docker daemon.

## Quick install (recommended)

As root on each monitored host:

```bash
apt-get update && apt-get install -y curl jq          # Debian/Ubuntu
FLEETWATCH_URL=https://fleet.example.com \
AGENT_API_TOKEN=<the shared secret from your server .env> \
bash /opt/fleetwatch/install.sh
```

The installer:

1. creates a `fleetwatch` system user,
2. copies `agent.sh` to `/opt/fleetwatch/`,
3. writes `/etc/fleetwatch/agent.env` (mode 600) with the URL + token,
4. installs `fleetwatch-agent.service` + `fleetwatch-agent.timer`,
5. enables the timer — it fires every 5 minutes,
6. adds the user to the `docker` group if Docker is present.

Verify:

```bash
systemctl list-timers fleetwatch-agent.timer
sudo -u fleetwatch /opt/fleetwatch/agent.sh
tail -f /var/log/fleetwatch-agent.log
```

## Manual install

```bash
sudo install -m 0755 agent.sh /opt/fleetwatch/agent.sh
sudo mkdir -p /etc/fleetwatch
sudo tee /etc/fleetwatch/agent.env >/dev/null <<'EOF'
FLEETWATCH_URL=https://fleet.example.com
AGENT_API_TOKEN=change-me
FLEETWATCH_LABEL=
EOF
sudo chmod 600 /etc/fleetwatch/agent.env
sudo install -m 0644 fleetwatch-agent.service /etc/systemd/system/
sudo install -m 0644 fleetwatch-agent.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fleetwatch-agent.timer
```

Cron alternative (5-minute cadence, same thing):

```cron
*/5 * * * * fleetwatch /bin/bash /opt/fleetwatch/agent.sh
```

## Privileges — why root is not required

| Operation            | Needed access                                                    |
| -------------------- | ---------------------------------------------------------------- |
| Hostname / OS facts  | world-readable                                                    |
| `apt list`           | world-readable **if apt lists are fresh** — schedule a nightly `apt-get update` (e.g. `unattended-upgrades`) or let the agent run as root occasionally |
| `debsecan` (optional)| installed package only; agent skips it gracefully                |
| `docker version/info`| `docker` group membership, **or** a narrow sudo rule              |

Narrow sudo rule (only docker read commands) if you don't want group membership:

```text
# /etc/sudoers.d/fleetwatch
fleetwatch ALL=(root) NOPASSWD: /usr/bin/docker version, /usr/bin/docker info
```

## Config reference (`/etc/fleetwatch/agent.env`)

| Variable            | Meaning                                            |
| ------------------- | -------------------------------------------------- |
| `FLEETWATCH_URL`    | Base URL of the central server, e.g. `https://fleet.example.com` |
| `AGENT_API_TOKEN`   | Shared secret — must match the server's `AGENT_API_TOKEN` |
| `FLEETWATCH_LABEL`  | Optional label shown in the dashboard              |

## What it reports

Every run, the agent POSTs a JSON document to `/api/ingest`:

- hostname + OS name/version + kernel,
- all packages with an available upgrade (`apt list --upgradable`),
  flagged as **security updates** when `debsecan` is installed,
- Docker engine version, API version, running/total containers, and whether
  the engine version is **end-of-life** (checked against a hardcoded list),
- a timestamp for the heartbeat.

Failures are logged to `/var/log/fleetwatch-agent.log`; a failed POST is
retried once after 10 seconds.
