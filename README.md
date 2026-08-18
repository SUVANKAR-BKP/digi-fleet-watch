# FleetWatch

Self-hosted fleet monitoring that tracks **package updates**, **Docker engine
health**, and **uptime** across your Linux servers — with a single central
dashboard.

- **Server**: Next.js 15 (App Router) + TypeScript + Tailwind, running in Docker
- **Database**: PostgreSQL 16 in a sibling container (Drizzle ORM)
- **Agents**: a dependency-free Bash script (`curl` + `jq`) on each monitored
  host, run by a systemd timer every 5 minutes

```
[Host 1] ─┐
[Host 2] ─┼── agent.sh (systemd timer, every 5 min) ── HTTPS ──> Next.js API ──> PostgreSQL
[Host N] ─┘       (Bearer token)                                │
                                                            [Dashboard UI]
```

---

## 1. Deploy the central stack

Requirements: Docker Engine 24+ with the Compose plugin.

```bash
git clone <this repo> && cd fleetwatch

# 1. Configure secrets
cp .env.example .env
nano .env
#   POSTGRES_PASSWORD  → pick a strong password
#   AGENT_API_TOKEN    → openssl rand -hex 32
#   SLACK_WEBHOOK_URL  → optional, for downtime alerts
#   FLEETWATCH_PUBLIC_URL → https://fleet.example.com

# 2. Start app + Postgres
docker compose up -d --build

# 3. Verify
docker compose ps                      # both healthy
curl http://localhost:3000/api/health  # {"ok":true}
```

- The app is exposed on **port 3000**. Put a reverse proxy (Caddy, nginx,
  Traefik) or Cloudflare Tunnel in front and terminate TLS.
- The schema is applied automatically on the **first** Postgres boot
  (`./drizzle/*.sql` is mounted into `/docker-entrypoint-initdb.d`). For schema
  changes later, regenerate + apply migrations with `drizzle-kit` from your
  dev machine against the database.

### Environment variables

| Variable               | Purpose                                                  |
| ---------------------- | -------------------------------------------------------- |
| `DATABASE_URL`         | Postgres connection string (compose overrides to `db:5432`) |
| `AGENT_API_TOKEN`      | Shared secret agents must send as `Authorization: Bearer`  |
| `SLACK_WEBHOOK_URL`    | Slack incoming webhook for downtime alerts (optional)      |
| `POSTGRES_PASSWORD`    | Password for the `fleetwatch` DB user                      |
| `FLEETWATCH_PUBLIC_URL`| Public base URL shown in agent instructions                |

---

## 2. Install the agent on each host

See [`agent/INSTALL.md`](agent/INSTALL.md) for full details. Quick version,
as root on each monitored Debian/Ubuntu host:

```bash
apt-get update && apt-get install -y curl jq
FLEETWATCH_URL=https://fleet.example.com \
AGENT_API_TOKEN=<shared secret> \
bash /opt/fleetwatch/install.sh
```

The installer sets up the systemd timer (every 5 minutes), a dedicated
`fleetwatch` user, and (if present) Docker access. The agent needs **no root**
for normal operation — see the INSTALL doc for the exact privilege model.

Manual/cron setups and the payload format are documented in
[`agent/INSTALL.md`](agent/INSTALL.md).

---

## 3. API

| Endpoint                    | Method | Auth        | Description |
| --------------------------- | ------ | ----------- | ----------- |
| `/api/ingest`               | POST   | Bearer token | Agent intake: upserts the host, stores snapshot + packages + Docker info, records a heartbeat, closes open downtime events |
| `/api/hosts`                | GET    | —           | All hosts with status (`online` / `stale` / `down`) + summary metrics |
| `/api/hosts/[id]`           | GET    | —           | Host detail: latest snapshot, packages, Docker, 30-day uptime, downtime log |
| `/api/jobs/check-downtime`  | POST   | Bearer token | Runs the heartbeat-miss scan on demand (for an external cron) |
| `/api/health`               | GET    | —           | Container liveness probe |

### Status thresholds

| Status   | Gap since last heartbeat |
| -------- | ------------------------ |
| online   | ≤ 15 minutes             |
| stale    | 15 min – 1 hour          |
| down     | > 1 hour                 |

A downtime event is recorded (and Slack-alerted) after a host has been silent
for 15 minutes (3 missed heartbeats). Events close automatically when the
agent reports again.

### Alerting

- **Slack** — a webhook message is sent for every *new* downtime event.
- The scan runs automatically on each dashboard/API load, so you don't need a
  worker. If you prefer a separate cron (e.g. every minute), point it at the
  bearer-authenticated endpoint:

  ```bash
  curl -sS -X POST https://fleet.example.com/api/jobs/check-downtime \
       -H "Authorization: Bearer $AGENT_API_TOKEN"
  ```

- A daily digest of critical/security package updates is intentionally left as
  a follow-up (see roadmap).

---

## 4. Dashboard

- `/` — overview grid: one card per host with a status dot, outdated/security
  package counts, Docker engine + EOL flag, 30-day uptime, and last-seen.
- `/hosts/[id]` — sortable, filterable package table (security-only filter),
  Docker version + deprecation banner, 30-day uptime chart, downtime log.

No auth is built in (single shared dashboard). Protect it at the reverse proxy
(e.g. Cloudflare Zero Trust / basic auth) — see non-goals.

---

## 5. Development

```bash
npm install
npm run dev        # http://localhost:3000
```

The dashboard falls back to **demo data** when Postgres is unreachable, so the
UI is navigable without the database.

Schema changes:

```bash
npx drizzle-kit generate   # diff schema.ts → drizzle/*.sql
npx drizzle-kit push       # apply to a local Postgres
```

## 6. Non-goals / roadmap

- No user auth / multi-tenancy yet — add at the reverse proxy.
- No agent auto-update mechanism yet.
- Roadmap: daily security-update digest email, Docker image advisories,
  `external_probe` detection (uptime-kuma / UptimeRobot), package history
  diffing across snapshots.
