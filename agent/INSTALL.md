# Installing the Digi Fleet Watch agent on a monitored host

The agent is a single Bash script with **no dependencies beyond `curl` and `jq`**.
It runs on the host itself (not in a container) so it can read the real
`apt`/`dpkg` state and talk to the host Docker daemon.

## Quick install (recommended)

As root on each monitored host:

```bash
curl -fsSL http://<YOUR_SERVER_HOST>:3000/install.sh | \
  AGENT_API_TOKEN=<the shared secret from your server .env> \
  FLEETWATCH_URL=http://<YOUR_SERVER_HOST>:3000 \
  bash
```

Run it as root on each monitored Debian/Ubuntu host. `install.sh`:

1. bootstraps `curl` + `jq` if they are missing,
2. downloads `agent.sh` to `/opt/digi-fleet-watch/`,
3. writes `/etc/digi-fleet-watch/agent.env` (mode 600) with the URL + token,
4. detects the init system — **systemd** (installs `digi-fleet-watch.service` +
   `digi-fleet-watch.timer`) or, when systemd is absent, **cron** (writes
   `/etc/cron.d/digi-fleet-watch` for user `fleetwatch`),
5. enables the schedule — it fires every 5 minutes,
6. adds the user to the `docker` group if Docker is present.

Verify (systemd hosts):

```bash
systemctl list-timers digi-fleet-watch.timer
sudo -u fleetwatch /opt/digi-fleet-watch/agent.sh
tail -f /var/log/digi-fleet-watch.log
```

Verify (cron hosts) — the entry is `/etc/cron.d/digi-fleet-watch`; run the
agent manually with `sudo -u fleetwatch /opt/digi-fleet-watch/agent.sh`.

**No systemd and no cron?** (bare minimal containers) the installer fails with
a pointer to the **containerized agent** — see the README "Containerized agent"
section. It monitors Docker through a mounted socket and needs no init system.

## Manual install

```bash
sudo install -m 0755 agent.sh /opt/digi-fleet-watch/agent.sh
sudo mkdir -p /etc/digi-fleet-watch
sudo tee /etc/digi-fleet-watch/agent.env >/dev/null <<'EOF'
FLEETWATCH_URL=http://<YOUR_SERVER_HOST>:3000
AGENT_API_TOKEN=change-me
FLEETWATCH_LABEL=
EOF
sudo chmod 600 /etc/digi-fleet-watch/agent.env
sudo install -m 0644 digi-fleet-watch.service /etc/systemd/system/
sudo install -m 0644 digi-fleet-watch.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now digi-fleet-watch.timer
```

Cron alternative (5-minute cadence, same thing):

```cron
*/5 * * * * fleetwatch /bin/bash /opt/digi-fleet-watch/agent.sh
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
# /etc/sudoers.d/digi-fleet-watch
fleetwatch ALL=(root) NOPASSWD: /usr/bin/docker version, /usr/bin/docker info
```

## Config reference (`/etc/digi-fleet-watch/agent.env`)

| Variable            | Meaning                                            |
| ------------------- | -------------------------------------------------- |
| `FLEETWATCH_URL`    | Base URL of the central server, e.g. `http://<YOUR_SERVER_HOST>:3000` |
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

Failures are logged to `/var/log/digi-fleet-watch.log`; a failed POST is
retried once after 10 seconds.