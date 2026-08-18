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
- **One-liner onboarding** — add any host by pasting a single
  `curl ... | bash` command from the dashboard's **+ Add Host** button.

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
#   PUBLIC_FLEETWATCH_URL  → optional; override the URL shown in "Add Host"
#                            (see "How the URL is derived" below)

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

> **Security:** This dashboard has no built-in authentication. Put it behind
> Cloudflare Zero Trust or HTTP basic auth at the reverse proxy before
> exposing it beyond your local network — especially once the Add Host token
> is visible on the page.

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

> **Fastest path:** click **+ Add Host** in the dashboard header (top right).
> It gives you a ready-made one-liner — `curl -fsSL <this-server>/install.sh | bash`
> with the correct token and server URL pre-filled, masked until you reveal
> it. Paste and run it as root on the target host; the agent downloads itself
> and starts reporting within 5 minutes.

See [`agent/INSTALL.md`](agent/INSTALL.md) for details. The equivalent
one-liner (as root on each monitored Debian/Ubuntu host) is:

```bash
curl -fsSL http://<YOUR_SERVER_HOST>:3000/install.sh | \
  AGENT_API_TOKEN=<shared secret from .env> \
  FLEETWATCH_URL=http://<YOUR_SERVER_HOST>:3000 \
  bash
```

`install.sh` bootstraps curl + jq if absent, then downloads the agent and
systemd units from the server — nothing needs to be transferred manually.
Afterwards the agent needs **no root** for normal operation and reports every
5 minutes.

### How the URL is derived

The command you get from **+ Add Host** (and the matching `/install.sh` request)
uses a server URL that is **never hardcoded**:

1. If `PUBLIC_FLEETWATCH_URL` is set in `.env`, it is used verbatim — set this
   once the server sits behind a reverse proxy / domain, e.g.
   `PUBLIC_FLEETWATCH_URL=https://fleet.example.com`.
2. Otherwise the URL is derived from the **incoming request**: its protocol
   (`x-forwarded-proto` or `http`) plus its `Host` header, so it works by IP
   (`http://135.125.236.47:3000`), hostname, or behind a TLS-terminating proxy.

The Add Host one-liner passes this same URL as both the `curl -fsSL <URL>/install.sh`
source **and** the `FLEETWATCH_URL=<URL>` variable, so the installer and the
downloaded agent always target the exact same server. The `AGENT_API_TOKEN` in
the command is read server-side from `process.env.AGENT_API_TOKEN` (the same
value `/api/ingest` validates), shown **masked** by default with a reveal
toggle; **Copy** always copies the full, working command.

The server also exposes the agent artifacts directly at `/install.sh`,
`/agent.sh`, `/digi-fleet-watch.service` and `/digi-fleet-watch.timer` (public,
no secrets) so a host can bootstrap itself with no manual file transfer.

---

## API

| Endpoint                    | Method | Auth         | Description |
| --------------------------- | ------ | ------------ | ----------- |
| `/api/ingest`               | POST   | Bearer token | Agent intake: upserts host, stores snapshot + packages + Docker info, records heartbeat, closes open downtime events |
| `/api/hosts`                | GET    | —            | All hosts with status (`online` / `stale` / `down`) + summary metrics |
| `/api/hosts/[id]`           | GET    | —            | Host detail: packages, Docker, 30-day uptime, downtime log |
| `/api/jobs/check-downtime`  | POST   | Bearer token | Runs the heartbeat-miss scan on demand (external cron) |
| `/api/health`               | GET    | —            | Container liveness probe |
| `/install.sh`               | GET    | public       | Bootstrapping installer fetched by `curl` |
| `/agent.sh`                 | GET    | public       | Agent collector script, downloaded by the installer |
| `/digi-fleet-watch.service` | GET    | public       | Systemd unit, downloaded by the installer |
| `/digi-fleet-watch.timer`   | GET    | public       | Systemd timer, downloaded by the installer |

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
*/1 * * * * curl -sS -X POST http://<YOUR_SERVER_HOST>:3000/api/jobs/check-downtime \
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
│   ├── app/                # Next.js App Router: pages, /api and script routes (/install.sh…)
│   ├── components/         # dashboard UI (incl. Add Host dialog)
│   ├── db/schema.ts        # Drizzle schema
│   └── lib/                # db client, downtime logic, alerts, install-command helpers
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
