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
- **Per-container detail** — for every container (running or not): image/tag/
  digest, status, health check, restart count, and age, with an "unpinned
  (:latest)" flag for images that aren't pinned to a reproducible tag.
- **Uptime & downtime** — 30-day uptime chart and a host's full downtime
  history.
- **Alerting** — Slack webhooks and/or SMTP emails for downtime, new package
  updates, and deprecated engines.
- **Self-hosted** — Next.js + PostgreSQL 16 run side by side in Docker
  Compose; no external services.
- **One-liner onboarding** — add any host by pasting a single
  `curl ... | bash` command from the dashboard's **+ Add Host** button. The
  installer reports once immediately and tells you on the spot whether it
  connected.
- **Self-explaining failures** — a rejected agent payload is logged in full
  (field / expected / received) on both the server and the agent, so you never
  need to manually replay a failing request to debug it.
- **Self-migrating schema** — SQL migrations are applied on start-up and
  tracked in a ledger table, so upgrading an existing deployment never needs a
  manual `psql` step.
- **Optional password gate** — one env var puts the dashboard, its read APIs
  and the agent token behind a login.

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
#   FLEETWATCH_DASHBOARD_PASSWORD → strongly recommended; gates the dashboard
#                            and the Add Host token behind a login
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
- **Migrations are applied automatically on every app start.** `drizzle/*.sql`
  is also mounted into `/docker-entrypoint-initdb.d`, but Postgres only runs
  that directory when it initialises an *empty* data volume — so any migration
  added after your volume was created would never run there. The app therefore
  re-applies them itself at boot, tracking what it has already done in a
  `_fleetwatch_migrations` table. Upgrading an existing install needs no manual
  `psql` step; just `docker compose up -d --build`.
- Confirm it worked:
  ```bash
  docker compose logs app | grep migrate
  # [migrate] applied 0001_containers.sql     (first run after an upgrade)
  # [migrate] schema already up to date       (subsequent starts)
  ```
- Put a reverse proxy (Caddy / nginx / Traefik) or Cloudflare Tunnel in front
  and terminate TLS.
- Stop everything: `docker compose down` · wipe all data:
  `docker compose down -v`

> **Security — read this before exposing the dashboard.** The **+ Add Host**
> dialog hands out `AGENT_API_TOKEN`, the secret agents use to post data. Set
> `FLEETWATCH_DASHBOARD_PASSWORD` in `.env` to require a login for the
> dashboard, the read APIs and that token. Leave it empty and **anyone who can
> reach the instance can read the token and post fake data for any host** —
> only acceptable on a network you fully trust. Agent routes (`/api/ingest`,
> `/install.sh`, `/agent.sh`) are never password-gated; they authenticate with
> the bearer token instead.

### Option B — local development (no Docker)

Requirements: Node.js 20+, a Postgres 16 database (or run the dashboard on
demo data).

```bash
pnpm install
pnpm dev
# open http://localhost:3000
```

> The dashboard falls back to **demo data** when Postgres is unreachable, so
> you can explore the UI without a database.

## Install the agent on each host

> **Fastest path:** click **+ Add Host** in the dashboard header (top right),
> optionally type a label, then click **Copy**. Paste and run it as root on the
> target host. The installer downloads the agent, **sends a first report
> immediately**, and prints `✓ Connected` (or the exact reason it failed)
> before it exits — you do not have to wait 5 minutes to find out whether it
> worked.

See [`agent/INSTALL.md`](agent/INSTALL.md) for details. The equivalent
one-liner (as root on each monitored Debian/Ubuntu host) is:

```bash
curl -fsSL http://<YOUR_SERVER_HOST>:3000/install.sh | \
  AGENT_API_TOKEN=<shared secret from .env> \
  FLEETWATCH_URL=http://<YOUR_SERVER_HOST>:3000 \
  bash
```

`install.sh` bootstraps curl + jq if absent, then downloads the agent from the
server — nothing needs to be transferred manually. It creates the `fleetwatch`
service user, schedules the agent (see
[Scheduling & host requirements](#scheduling--host-requirements)), and then
runs one report straight away so a failure surfaces immediately:

```
Sending a first report to http://<YOUR_SERVER_HOST>:3000 ...
✓ Connected. This host should now be visible on the dashboard.
  It will keep reporting every 5 minutes.
```

If that first report fails, the installer exits non-zero and prints the HTTP
status, the server's response body and a hint — the schedule is still installed
and keeps retrying every 5 minutes.

Afterwards the agent needs **no root** for normal operation.

### Environment file & manual testing

The agent config lives in `/etc/digi-fleet-watch/agent.env`:

- Owned by `root:fleetwatch` with mode `640` (readable by the `fleetwatch`
  user the agent runs as, **not world-readable**).
- Both paths read this same file, which is what makes the printed test command
  work: systemd loads it via `EnvironmentFile=` *as root* before dropping to
  `User=fleetwatch`, while a manual run reads it *as* `fleetwatch` — so the
  group-read bit matters. With `root:root 0600` the timer works but the manual
  run fails with `AGENT_API_TOKEN is not set`.
  ```bash
  sudo -u fleetwatch FLEETWATCH_VERBOSE=1 /opt/digi-fleet-watch/agent.sh
  ```
  `FLEETWATCH_VERBOSE=1` mirrors the log to your terminal; without it the run
  is silent and only writes to `/var/log/digi-fleet-watch.log`.

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
downloaded agent always target the exact same server.

The `AGENT_API_TOKEN` in the command is **not** embedded in the page. It is
fetched from a server action when you open the dialog, so it never appears in
the HTML of every page load. In the command block the real token is rendered
but **blurred** — copying it (via the button *or* by selecting the text) always
yields a working command, and **Reveal token** un-blurs it for reading.

The server also exposes the agent artifacts directly at `/install.sh`,
`/agent.sh`, `/digi-fleet-watch.service` and `/digi-fleet-watch.timer` (public,
no secrets) so a host can bootstrap itself with no manual file transfer.

### Scheduling & host requirements

`install.sh` detects the init system before choosing how to run the agent every
5 minutes:

- **systemd** (preferred) — installs `digi-fleet-watch.service` +
  `digi-fleet-watch.timer` and enables the timer.
- **cron** (no systemd) — writes `/etc/cron.d/digi-fleet-watch` for the
  `fleetwatch` user.
- **neither** (bare minimal container) — prints an error and points to the
  [containerized agent](#containerized-agent-container-only-hosts) instead.

### Known limitations

Detecting whether a container's image is genuinely **out of date** (its tag is
older than what's currently published in the registry) requires querying the
remote registry per image. This pass does **not** implement that. Instead the
agent reports two practical proxies for drift risk:

- `is_unpinned_latest` — the image uses `:latest` or has no tag, so it isn't
  pinned to a reproducible version;
- `age_days` — how long the container has been running.

Registry-diff detection (`docker manifest inspect` / registry API) is a noted
possible future enhancement — we deliberately don't fake registry data.

## Containerized agent (container-only hosts)

For hosts that run only containers and have **no init system** (no systemd and
no cron) — or when you prefer to monitor via Docker — run the agent as a
container instead of installing it on the host.

Build it from the repo root, then run it on the Docker host you want to watch:

```bash
docker build -f agent/Dockerfile.agent -t digi-fleet-watch-agent:latest .

docker run -d --name fleetwatch-agent \
  -e FLEETWATCH_URL=http://135.125.236.47:3000 \
  -e AGENT_API_TOKEN=<token> \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  --restart unless-stopped \
  digi-fleet-watch-agent:latest
```

The container mounts the host's Docker socket **read-only** and loops
`agent.sh` every 5 minutes (no systemd/cron needed inside).

**What this mode can and can't see:**

- **Can see** sibling containers on the same Docker host (via the socket) —
  per-container status/health/restart count/age, plus the engine summary.
- **Cannot see** host-level **apt/dpkg package data** — that needs real
  filesystem access, which isn't available from inside a container without
  additional, riskier host mounts.

So this mode is for **container-focused monitoring only**. Package/OS
monitoring still requires the bare-metal/VM install path above. `AGENT_API_TOKEN`
and `FLEETWATCH_URL` come from the same `.env` the dashboard uses; package
snapshots are simply absent for containerized hosts.

---

## API

| Endpoint                    | Method | Auth         | Description |
| --------------------------- | ------ | ------------ | ----------- |
| `/api/ingest`               | POST   | Bearer token | Agent intake: upserts host, stores snapshot + packages + Docker info, records heartbeat, closes open downtime events — all in one transaction |
| `/api/hosts`                | GET    | session¹     | All hosts with status (`online` / `stale` / `down`) + summary metrics |
| `/api/hosts/[id]`           | GET    | session¹     | Host detail: packages, containers, Docker, 30-day uptime, downtime log |
| `/api/jobs/check-downtime`  | POST   | Bearer token | Runs the heartbeat-miss scan on demand (external cron) |
| `/api/health`               | GET    | —            | Container liveness probe |
| `/install.sh`               | GET    | public       | Bootstrapping installer fetched by `curl` |
| `/agent.sh`                 | GET    | public       | Agent collector script, downloaded by the installer |
| `/digi-fleet-watch.service` | GET    | public       | Systemd unit, downloaded by the installer |
| `/digi-fleet-watch.timer`   | GET    | public       | Systemd timer, downloaded by the installer |

¹ Requires a dashboard session **only when** `FLEETWATCH_DASHBOARD_PASSWORD` is
set; open otherwise. Agent- and probe-facing routes are never session-gated.

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

## Debugging

The goal is: **when something breaks, the logs tell you the reason directly.**

### Server side (`docker compose logs app`)

- **Rejected payload (422)** — the full `ZodError` issues are logged with
  `[ingest] validation failed` and returned verbatim in the JSON body,
  e.g. which field failed, what was expected, and what was received. No more
  `{"error":"invalid payload"}` dead-ends.
- **Other failures** — `[ingest] failed`, `[overview] failed`, `[host:N] failed`
  etc. include the actual error message.

### Agent side (`/var/log/digi-fleet-watch.log`)

On any non-2xx response the agent logs the HTTP status, the **full response
body**, and a hint naming the likely cause:

```
2026-08-18T16:27:10+00:00 WARN: ingest returned HTTP 422 — retrying once
2026-08-18T16:27:10+00:00 WARN: server said: {"error":"invalid payload","issues":[{"code":"invalid_type","expected":"boolean","received":"number","path":["docker","deprecated"],...}]}
2026-08-18T16:27:20+00:00 HINT: the server rejected the payload shape — check for an agent/server version mismatch.
2026-08-18T16:27:20+00:00 ERROR: ingest failed with HTTP 422
```

Run it by hand at any time, with the log mirrored to your terminal:

```bash
sudo -u fleetwatch FLEETWATCH_VERBOSE=1 /opt/digi-fleet-watch/agent.sh
```

The agent also type-checks its own payload before sending, so a malformed field
fails locally with a clear message instead of as an opaque remote 422.

### Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `HTTP 401` / `{"error":"unauthorized"}` | The token in `agent.env` doesn't match the server's `AGENT_API_TOKEN`. Most often the **displayed** (blurred) command was retyped rather than copied. | Re-run **+ Add Host** and use the **Copy** button, or correct the token in `/etc/digi-fleet-watch/agent.env`. |
| `HTTP 422` naming a field | Agent/server version mismatch — the agent is older than the server's schema. | Re-run the Add Host command; it re-downloads `agent.sh` from the server. |
| `AGENT_API_TOKEN is not set` on a manual run | `/etc/digi-fleet-watch/agent.env` isn't readable by the `fleetwatch` user. | `ls -l /etc/digi-fleet-watch/agent.env` — it should be `root:fleetwatch` mode `640`. Re-run the installer to repair it. |
| Host page shows an error panel instead of data | The database schema is behind the app. | `docker compose logs app \| grep migrate`, then restart the app to re-run migrations. |
| Dashboard shows demo data | Postgres unreachable. | `docker compose ps`; the app re-probes every 10s and recovers on its own once the database is up. |
| Host stuck `stale` / `down` | The timer isn't firing, or the agent errors before POSTing. | `systemctl list-timers \| grep fleet` and `cat /var/log/digi-fleet-watch.log`. |

---

## Project layout

```
├── agent/                  # host-side agent (Bash + systemd/cron)
│   ├── agent.sh            # collector script (curl + jq only)
│   ├── digi-fleet-watch.service / .timer
│   ├── install.sh          # root installer (systemd/cron, with error path)
│   ├── Dockerfile.agent    # standalone containerized agent (loop entrypoint)
│   └── INSTALL.md          # agent docs + privilege model
├── drizzle/                # SQL migrations, applied automatically at app start
│   ├── 0000_initial.sql    # base schema
│   ├── 0001_containers.sql # per-container tables
│   └── 0002_one_open_downtime.sql  # partial unique index: one open outage per host
├── src/
│   ├── app/                # Next.js App Router: pages, /api and script routes (/install.sh…)
│   ├── components/         # dashboard UI (incl. Add Host dialog)
│   ├── db/schema.ts        # Drizzle schema
│   ├── instrumentation.ts  # start-up hook → runs migrations
│   ├── middleware.ts       # optional dashboard password gate
│   └── lib/                # db client, migrations, downtime logic, alerts, auth
├── docker-compose.yml      # app + Postgres 16
├── Dockerfile              # multi-stage production image
└── .env.example            # copy to .env (never commit .env!)
```

## Development

```bash
cp .env.example .env        # local Postgres URL if you have one
pnpm install
pnpm dev                    # http://localhost:3000
```

Schema changes:

```bash
pnpm exec drizzle-kit generate    # diff schema.ts → drizzle/*.sql
pnpm exec drizzle-kit push        # apply against a local Postgres
```

Checks:

```bash
pnpm test                   # ingest schema + uptime/status regression tests
pnpm typecheck              # tsc --noEmit
pnpm lint
```

New migrations are picked up automatically: drop a `NNNN_name.sql` file into
`drizzle/` and restart the app. Write them to be **idempotent** (`CREATE TABLE
IF NOT EXISTS`, constraints wrapped in `DO $$ … EXCEPTION WHEN duplicate_object
$$`) so they stay safe to replay against a database that predates the migration
ledger.

## License

MIT — see [LICENSE](LICENSE).