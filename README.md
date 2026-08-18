# Digi Fleet Watch

> Self-hosted fleet monitoring for **package updates**, **Docker engine
> health**, and **uptime** across your Linux servers — one central dashboard.

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

## Features

- **Agent-based** — a dependency-free Bash script (`curl` + `jq`) on each host
  reports every 5 minutes via systemd timer or cron.
- **Package tracking** — see outdated packages at a glance, with security
  updates flagged and listed CVEs.
- **Docker health** — engine version, API version, container counts, and
  end-of-life deprecation badges.
- **Uptime & downtime** — 30-day uptime chart and a host's full downtime
  history.
- **Alerting** — Slack webhooks and/or SMTP emails for downtime, new package
  updates, and deprecated engines.
- **Self-hosted** — Next.js + PostgreSQL 16 run side by side in Docker
  Compose; no external services.

---

## How to run

### Option A — Docker Compose (recommended for production)

Requirements: Docker Engine 24+ with the Compose plugin.

```bash
# 1. Clone the repo
git clone <your-repo-url> digi-fleet-watch && cd digi-fleet-watch

# 2. Configure secrets
cp .env.example .env
nano .env
#   POSTGRES_PASSWORD      → pick a strong password
#   AGENT_API_TOKEN        → openssl rand -hex 32
#   SLACK_WEBHOOK_URL      → optional, for Slack downtime alerts
#   SMTP_HOST, SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO  → optional, for email alerts
#   FLEETWATCH_PUBLIC_URL  → https://fleet.example.com

# 3. Build + start (app on port 3000 + Postgres 16)
docker compose up -d --build

# 4. Verify
docker compose ps                       # both should be "healthy"
curl http://localhost:3000/api/health   # {"ok":true}
```

- The dashboard is at `http://localhost:3000`.
- The schema is applied automatically on the **first** Postgres boot
  (`drizzle/*.sql` is mounted into `/docker-entrypoint-initdb.d`).
- Put a reverse proxy (Caddy / nginx / Traefik) or Cloudflare Tunnel in front
  and terminate TLS.
- Stop everything: `docker compose down` · wipe all data:
  `docker compose down -v`

### Option B — local development (no Docker)

Requirements: Node.js 20+, a Postgres 16 database (or run the dashboard on
demo data).

```bash
npm install
npm run dev
# open http://localhost:3000
```

> The dashboard falls back to **demo data** when Postgres is unreachable, so
> you can explore the UI without a database.

## Install the agent on each host

See [`agent/INSTALL.md`](agent/INSTALL.md) for the full guide. Quick version,
as root on each monitored Debian/Ubuntu host:

```bash
apt-get update && apt-get install -y curl jq
FLEETWATCH_URL=https://fleet.example.com \
AGENT_API_TOKEN=<shared secret from .env> \
bash /opt/digi-fleet-watch/install.sh
```

The agent needs **no root** for normal operation and reports every 5 minutes.

---

## API

| Endpoint                    | Method | Auth         | Description |
| --------------------------- | ------ | ------------ | ----------- |
| `/api/ingest`               | POST   | Bearer token | Agent intake: upserts host, stores snapshot + packages + Docker info, records heartbeat, closes open downtime events |
| `/api/hosts`                | GET    | —            | All hosts with status (`online` / `stale` / `down`) + summary metrics |
| `/api/hosts/[id]`           | GET    | —            | Host detail: packages, Docker, 30-day uptime, downtime log |
| `/api/jobs/check-downtime`  | POST   | Bearer token | Runs the heartbeat-miss scan on demand (external cron) |
| `/api/health`               | GET    | —            | Container liveness probe |

### Status thresholds

- **online** ≤ 15 min since last heartbeat · **stale** up to 1 h · **down** > 1 h.
- A downtime event is recorded after a host has been silent for 15 minutes and
  closes automatically when the agent reports again.

---

## Alerting & notifications

The downtime scan runs on every dashboard/API load, so **no separate worker is
required**. For extra resilience, point a cron at the watchdog endpoint (below).

### Slack (optional)

Set `SLACK_WEBHOOK_URL` in `.env`. A message is posted whenever a host goes
**down**.

### Email (optional, SMTP)

Set the following in `.env` to receive email alerts:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false            # true for implicit TLS (port 465)
SMTP_USER=alerts@example.com
SMTP_PASS=change-me
MAIL_FROM="Digi Fleet Watch <alerts@example.com>"
ALERT_EMAIL_TO=ops@example.com
```

Leave `SMTP_HOST` empty to disable email. Emails are sent for:

- a host going **down** and coming back **up**,
- **new package updates** on a host (security updates flagged `[SECURITY]`),
  sent only once per change to avoid noise,
- a host first reporting a **deprecated Docker engine**.

### Optional watchdog cron

The downtime scan already runs on each dashboard load. For resilience, add a
cron that runs the scan even when nobody is looking:

```bash
*/1 * * * * curl -sS -X POST https://fleet.example.com/api/jobs/check-downtime \
  -H "Authorization: Bearer $AGENT_API_TOKEN"
```

---

## Project layout

```
├── agent/                  # host-side agent (Bash + systemd)
│   ├── agent.sh            # collector script (curl + jq only)
│   ├── digi-fleet-watch.service / .timer
│   ├── install.sh          # root installer for a monitored host
│   └── INSTALL.md          # agent docs + privilege model
├── drizzle/
│   └── 0000_initial.sql    # Postgres schema (auto-applied on first boot)
├── src/
│   ├── app/                # Next.js App Router: pages + /api routes
│   ├── components/         # dashboard UI
│   ├── db/schema.ts        # Drizzle schema
│   └── lib/                # db client, downtime logic, Slack, ingest
├── docker-compose.yml      # app + Postgres 16
├── Dockerfile              # multi-stage production image
└── .env.example            # copy to .env (never commit .env!)
```

## Development

```bash
cp .env.example .env        # local Postgres URL if you have one
npm install
npm run dev                 # http://localhost:3000
```

Schema changes:

```bash
npx drizzle-kit generate    # diff schema.ts → drizzle/*.sql
npx drizzle-kit push        # apply against a local Postgres
```

## License

MIT — see [LICENSE](LICENSE).
