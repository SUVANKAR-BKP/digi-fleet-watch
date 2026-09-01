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
- **Resource metrics** — CPU, load, memory, swap and per-mount disk usage,
  with 24h charts and alerts when a filesystem crosses 85% / 95%.
- **Vulnerability scanning** — installed package versions matched against
  OSV.dev into real, CVSS-scored CVEs, with a fleet-wide "who is affected"
  view.
- **Service checks** — TCP, HTTP(S), TLS-expiry, DNS and ICMP probes run *from
  the server*, so they cover the one thing an agent can never report: the host
  being unreachable from outside. HTTP checks assert on the response body, not
  just the status code.
- **Three-state health** — `passing` / `degraded` / `failing`, so an endpoint
  that still answers but has slid from 80ms to 4s is visible before it becomes
  an outage.
- **Alert-fatigue controls** — per-check maintenance windows, upstream
  dependencies (one dead router does not page forty times), flap detection, and
  per-check routing to a single notification channel.
- **SLOs and error budgets** — an availability target per check, with the
  remaining budget expressed in minutes and a 30-day incident timeline derived
  from result history.
- **Uptime & downtime** — 30-day uptime chart and a host's full downtime
  history.
- **Alerting** — Slack webhooks and/or SMTP emails for downtime, new package
  updates, and deprecated engines, configurable from the dashboard with test
  buttons; secrets encrypted at rest.
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
- **Bounded storage** — daily rollups plus retention pruning, so history stays
  useful without the database growing without limit.
- **Background jobs** — downtime detection, retention and vulnerability scans
  run on a scheduler, not only when someone has the dashboard open.
- **Maintenance windows** — silence alerts for a host or the whole fleet
  while you patch, without losing any monitoring history.
- **Pluggable notifications** — Slack, Discord, Teams, ntfy, email or a
  generic webhook, each with its own minimum severity.
- **Accounts and roles** — named sign-ins with three roles (admin / operator /
  viewer), scrypt-hashed passwords, and a first-run setup flow.
- **Clean decommissioning** — remove a host and its whole history from the
  dashboard, with a one-liner that uninstalls the agent so it stays gone.

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
#   FLEETWATCH_SESSION_SECRET → openssl rand -hex 32 (signs session cookies)
#   FLEETWATCH_ADMIN_USER / _PASSWORD → optional; creates the first admin
#                            non-interactively instead of using /setup
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

> **Security — read this before exposing the dashboard.** The dashboard
> requires a signed-in account. On a fresh instance it redirects to `/setup` so
> you can create the first **admin**; until you do, anyone who can reach the
> page can claim that account, so complete setup immediately (or keep the port
> firewalled until you have). Agent routes (`/api/ingest`, `/install.sh`,
> `/agent.sh`) are never session-gated — they authenticate with
> `AGENT_API_TOKEN` instead.

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

### Removing a host

Open the host's page and click **Stop monitoring**. You'll be asked to type the
hostname to confirm; deleting removes the host and every snapshot, package
list, container record, heartbeat and downtime event belonging to it (all via
`ON DELETE CASCADE`). This cannot be undone.

**Deleting from the dashboard does not stop the agent.** It is still installed
on the machine and re-registers on its next heartbeat, so the host reappears
within 5 minutes. To actually stop monitoring, uninstall the agent on that host
first — the confirmation dialog shows this command, and it is also served
directly:

```bash
curl -fsSL http://<YOUR_SERVER_HOST>:3000/uninstall.sh | sudo bash
```

`uninstall.sh` stops and removes the systemd timer/service (or the cron entry),
deletes `/opt/digi-fleet-watch`, removes `/etc/digi-fleet-watch` — **including
the stored agent token** — clears the log, and removes the `fleetwatch` service
user. Pass `FLEETWATCH_KEEP_USER=1` to keep the user if something else on the
host owns files as `fleetwatch`. It is idempotent and safe to run on a machine
where the agent was never installed.

Scriptable equivalent of the dashboard button:

```bash
curl -X DELETE http://<YOUR_SERVER_HOST>:3000/api/hosts/<id>
```

> Deleting a host requires the **admin** or **operator** role; viewers cannot
> see the button and the server action refuses them.

### Rotating the agent token

`AGENT_API_TOKEN` is a single secret shared by every agent, so replacing it
naively makes the whole fleet start failing with `401` the moment the server
restarts — and each host stays broken until someone re-enrols it. To avoid
that, the server also accepts `AGENT_API_TOKEN_PREVIOUS` while a rotation is in
flight, and `scripts/rotate-agent-token.sh` drives the sequence:

```bash
./scripts/rotate-agent-token.sh start    # new token issued; old one still accepted
# → re-run "+ Add Host" on each monitored host (any order, no rush)
./scripts/rotate-agent-token.sh status   # lists hosts still on the old token
./scripts/rotate-agent-token.sh finish   # stop accepting the old token
```

`start` backs up `.env`, moves the current secret to `AGENT_API_TOKEN_PREVIOUS`,
generates a fresh `AGENT_API_TOKEN`, and recreates the app container. Both
secrets work until `finish`.

Agents on the old secret are visible from both ends, so the rotation has a
definite finish line:

- **server** — `[ingest] host "web-01" is still using AGENT_API_TOKEN_PREVIOUS`
- **host** — the same warning in `/var/log/digi-fleet-watch.log`, because the
  ingest response carries a `tokenRotationPending` flag

Rotate whenever the token may have been exposed — a shared screenshot, a
screen-share, a public dashboard, or an operator leaving.

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

## Resource metrics

Every heartbeat now carries a resource sample alongside the inventory: CPU busy
percentage, load averages, memory and swap, uptime, process count, and per-mount
disk usage. It is all read from `/proc` and `df`, so the agent still needs
nothing beyond `curl` and `jq`.

Disk exhaustion is the most common way a Linux box dies, so filesystems get
their own treatment: a usage bar per mount on the host page, a `disk NN%` badge
on the overview card, and alerts at **85%** (warning, email) and **95%**
(critical, email + Slack).

Alerts fire on a **threshold crossing**, not on every report — a host parked at
90% would otherwise page you every five minutes forever. The previous sample is
compared against the current one, the same way new package updates and Docker
deprecation are detected.

Values the agent cannot read degrade to `null` rather than being omitted, so a
host without `/proc/meminfo` still reports everything else instead of failing
validation. Hosts still running the pre-metrics agent keep working; re-run the
Add Host command to upgrade one.

---

## Data retention

At a 5-minute cadence each host writes **288 snapshots a day**, each carrying a
full `raw_payload` plus a row per package, per container and per filesystem.
Nothing ever deleted them, so a modest fleet would quietly consume gigabytes a
year.

Two knobs at **/settings**:

| Setting | Default | Range |
| ------- | ------- | ----- |
| Keep raw data for | 14 days | 1-365 |
| Keep daily rollups for | 730 days | 7-3650 |

The order matters: a day is **summarised into `host_daily_rollup` before** its
raw rows are pruned, so long-range trends (uptime, package counts, CPU/memory
averages and peaks, worst disk usage) survive at roughly 1/288th of the size.
Rollup writes are idempotent, so a re-run after a partial failure recomputes the
same numbers rather than double-counting.

Deletes are batched, so an instance that has been neglected for months catches
up over successive runs instead of issuing one enormous statement. Retention
runs every 6 hours, and **Run now** on the settings page reclaims space
immediately and reports exactly what it removed.

**Keep raw data for** also prunes `check_results`, the per-probe history behind
service checks. Note that the checks table reports availability and error
budgets over a **30-day** window: at the 14-day default those figures are
computed over 14 days of history, not 30. Raise the setting if you want them to
mean what they say — a check at a 5-minute interval writes 288 rows a day, so
30 days of history is roughly 8,600 rows per check.

---

## Vulnerability scanning

The agent already reported exact package names and versions — the expensive half
of vulnerability scanning. That inventory is now matched against
[OSV.dev](https://osv.dev), a free, key-less database that indexes Debian and
Ubuntu security advisories.

- **Per host** — an open-vulnerability table, worst first, with the **fixed
  version** in its own column. A CVE list you cannot act on is just anxiety.
- **Fleet-wide** — `/vulnerabilities` answers the question a per-host view
  cannot: *which hosts are affected by CVE-XXXX, and what fixes it?* Search by
  CVE, package or hostname.

**Severity is computed, not guessed.** OSV publishes the CVSS vector string
(`CVSS:3.1/AV:N/AC:L/...`) rather than a number, so `src/lib/cvss.ts` implements
the v3.1 base-score formula — including the specification's round-*up*-to-one-decimal
rule, which `Math.round` gets wrong and which decides whether an 8.95 shows as
High or Critical. Where a distro advisory carries only a word ("important",
"moderate") that is mapped onto the standard bands instead.

Exposure is **tracked over time**, not replaced on each scan: `first_seen_at`
shows how long a host has been vulnerable, and findings that disappear are
marked resolved rather than deleted. The `host_vulnerabilities` table is keyed on
the host rather than a package row, precisely so it outlives the snapshot that
revealed it when retention prunes.

Scans run every 6 hours (**Scan now** on the settings page for an immediate
run). Only Debian and Ubuntu hosts are scanned — the ecosystem mapping returns
nothing for other distributions rather than querying the wrong one, because a
confidently incorrect answer is worse than none. Nothing leaves your server
beyond package names and versions.

---

## Service checks

Everything else in this dashboard is **agent-push**: the host is alive because
it phoned home. That says nothing about whether the *service* on it works. A
box can sit at 2% CPU with a perfectly healthy agent while nginx returns 502 to
every visitor.

Checks run **from the server**, so they also cover the case the agent cannot
report on at all — the host being unreachable from outside.

Manage them at **/checks**, or on a host's own page for checks tied to it.
Creating and editing checks needs the **operator** role: deciding what to probe
is fleet work, not administrative configuration.

The scheduler ticks every 30 seconds and each check decides for itself whether
its own interval has elapsed. Probes run **sequentially** — a fleet of checks
firing in parallel from one small VPS is a good way to make the box itself look
unhealthy.

### Check types

| Type | Target format | What it proves |
| ---- | ------------- | -------------- |
| **TCP port** | `db.internal:5432` | the port accepts connections |
| **HTTP(S)** | `https://example.com/health` | status code, body content and response time |
| **TLS certificate** | `example.com:443` (port defaults to 443) | certificate validity and expiry |
| **DNS record** | `A:example.com`, or bare `example.com` | the record resolves, and to what |
| **ICMP ping** | `192.0.2.10` | reachability, packet loss and round-trip time |

Notes on the less obvious ones:

- **TLS** connects with `rejectUnauthorized: false` deliberately. The job is to
  *report* on the certificate, including one already expired or self-signed —
  refusing the handshake would turn the most important case ("your cert
  expired") into an unhelpful connection error. Expiry warnings fire at 21 and
  7 days, at most once a day, because expiry is not a failure until the day it
  happens and you want to hear about it while there is still time to renew.
- **DNS** supports `A`, `AAAA`, `CNAME`, `MX`, `TXT` and `NS`. Records are
  joined into one string and run through the same assertion machinery, so "does
  this still point at the old load balancer" is a `contains` assertion rather
  than a new concept.
- **ICMP ping** shells out to the system `ping` (Node cannot open raw ICMP
  sockets unprivileged), parsing both the Linux and BSD/macOS output wordings.
  Partial packet loss maps to **degraded** — losing 1 of 4 packets is real
  signal about the path, but it is not an outage. The container needs a `ping`
  binary; a missing one reports "ping binary not available" rather than a
  confusing timeout.

There is no separate "keyword in page" type — that is an HTTP check with a
`contains` assertion.

### Body assertions

A status code is a weak claim. `200 {"status":"degraded","db":false}` passes
every status-only check ever written, which is exactly the outage you most want
to catch.

| Assertion | Behaviour |
| --------- | --------- |
| `contains` / `not contains` | substring match on the body |
| `regex` | an invalid pattern is a *failed assertion with an explanation*, never a crashed probe |
| `JSON field equals` | dotted path — `status`, `data.db.healthy`, `services.0.up` (numeric segments index arrays) |

Bodies are read through a **256 KB cap**, streamed rather than buffered, so one
check pointed at a large download cannot decide how much RAM the monitoring box
needs.

### Three states, not two

| State | Meaning |
| ----- | ------- |
| `passing` | probe succeeded and every assertion held |
| `degraded` | still serving, but slower than the threshold, or partial packet loss, or a certificate nearing expiry |
| `failing` | the probe failed, or an assertion did |

**Degraded counts as up** for availability arithmetic and is not treated as an
incident. Counting it as downtime would make every SLO unmeetable the first
time a response took an extra 50ms.

The **Degraded above (ms)** threshold only ever downgrades a pass — a check that
already failed is not made healthier by being fast about it.

### Retries

**Attempts per run** (1–4, default 2) retries *inside a single run* with
exponential backoff (250ms → 500ms → 1s, capped at 2s). Without it, telling a
dropped packet from an outage means waiting a whole interval — a 10-minute
detection floor at a 5-minute interval.

Only failures are retried. A *degraded* result already succeeded; retrying
until one attempt came back fast would hide exactly the slow slide the state
exists to surface.

### Keeping the alert channel worth reading

A channel that cries wolf gets muted, and a muted channel is worse than no
channel at all. Four mechanisms, in the order they are applied:

1. **Two consecutive failures** before anything alerts. One dropped packet is
   not an outage.
2. **Maintenance windows** — scoped to the whole fleet, one host, or one check.
   Failures are still recorded, they just do not alert.
3. **Dependencies** — a check can name an upstream. While that upstream is
   down, this check records results but raises no alerts, so one dead router
   does not page for every service behind it.
4. **Flap detection** — a check alternating pass/fail is reporting instability,
   not an outage. Five transitions within ten runs suppresses it.

Suppressed checks show a grey badge (`in maintenance`, `upstream down`,
`flapping`) next to a red status, so silence is always explainable rather than
mysterious.

**Recovery alerts are exempt from all suppression.** Telling someone an alert
they already received is over is never noise, and swallowing it would leave the
latch set and the row permanently red.

> These per-check maintenance windows are **separate** from the fleet-wide
> alert silences under *Settings → Maintenance windows*. Silences mute every
> alert for a host (downtime, disk, packages); check windows mute check alerts
> and can be narrowed to a single check. Both apply — a silence covering the
> host suppresses its check alerts too.

**Per-check routing** sends one check's alerts to a single notification channel
instead of the usual fan-out, so a noisy staging probe reports to a staging
room. A routed alert whose channel was later deleted or disabled logs loudly
rather than vanishing silently.

### SLOs, error budgets and incidents

Set an **SLO target** (50–99.999; `100` leaves no budget and would breach on
the first blip forever) and the table shows the **error budget** — the downtime
still affordable this month, in minutes, because "we have 4 minutes left" lands
in a way "0.0093% remaining" does not.

Alongside it: p50/p95/p99 latency over 24h, and availability over 24h / 7d /
30d. Percentiles are **nearest-rank**, so every number shown is a latency that
actually happened. All of it is computed in Postgres in a single query — a
30-day window at a one-minute interval is ~43,000 rows per check, and the
dashboard needs six numbers from it.

Expanding a row shows a **30-day incident timeline**: start, duration, and the
first failure detail (what broke, not what it looked like after an hour of
being broken). Incidents are *derived from results on read*, not stored in
their own table — the results are already the source of truth, and a second
table would drift the first time a probe wrote one row and failed before
writing the other.

> **Retention caveat.** Error budgets and 30-day uptime read
> `check_results`, which the retention job prunes at the **Keep raw data for**
> setting — **14 days by default**. At that default a "30-day" budget is really
> computed over the last 14 days of history. Raise the setting to 30+ days at
> /settings if you want the figure to mean what it says.

### Certificate errors on HTTP checks

Node's `fetch` refuses any certificate it cannot verify, which makes two common
internal cases unmonitorable: a service behind a private CA, and HTTPS served
on a bare IP, where no certificate can ever match the address.

**Ignore certificate errors** (HTTP checks only) probes without verification.
The trade-off is real and worth stating: such a check reports availability only
and can no longer warn you about the certificate. To keep expiry warnings, add
a separate TLS check against the same host.

It is an explicit per-check opt-in rather than a default, and it is implemented
with `node:https` rather than a global switch — `NODE_TLS_REJECT_UNAUTHORIZED`
would disable verification for the entire process, including outbound alert
webhooks.

Failures decode the real reason rather than reporting `fetch failed`, which is
all `fetch` puts in the outer error:

```
TLS certificate could not be verified (incomplete chain, or a private CA)
  — enable "ignore certificate errors" to probe anyway
```

### Every field on the form

| Field | What it does |
| ----- | ------------ |
| **Name** | Label, and the alert subject (`Check failing: <name>`). 1–64 chars. |
| **Type** | Which probe runs; changes what Target means. |
| **Target** | What to probe — format per type, see the table above. |
| **Expected status** | HTTP only. Blank accepts any 2xx/3xx (a redirect to a login page still proves the server is serving); set `200` to assert "200, not a redirect". |
| **Every** | Interval, 30s–24h. Below 30s a check costs more than it tells you and hammers the target. |
| **Host** | Optional link to a fleet host. Ties the check to that host's page and its silences. Checks with no host are still valid — an external dependency, a customer URL. |
| **Body assertion** | See *Body assertions* above. HTTP and DNS only. |
| **JSON path** | Only for *JSON field equals*. Dotted path into the body. |
| **Expected value** | The substring, regex source, or JSON value to compare. Booleans and numbers compare as written (`true`, `3`). |
| **Degraded above (ms)** | Response time past which the check is degraded rather than passing. Blank disables. |
| **Attempts per run** | Retries within one run, 1–4. |
| **Ignore certificate errors** | HTTP only. See above. |
| **Depends on** | Upstream check; suppresses this one's alerts while the upstream is down. |
| **SLO target (%)** | Availability target driving the error budget. |
| **Alert channel** | Route to one channel instead of all eligible ones. |

### Table columns

| Column | Meaning |
| ------ | ------- |
| **Status** | `passing` / `degraded` / `failing ×N`, N being consecutive failures, plus any suppression badge. |
| **Latency last / p95** | Most recent response time, and the 95th percentile over 24h. |
| **Uptime 24h / 7d / 30d** | Share of runs not `down`. |
| **Error budget** | Target and minutes of downtime still affordable; the bar turns red past 100%. |
| **Last run** | When it last *executed*, not when it last succeeded. |

**Run now** (▷) probes immediately and records the result, but deliberately
**never alerts** — you are already looking at the outcome, and a "run now" that
pages the whole team is a button nobody presses twice.

---

## Accounts and roles

The dashboard requires a signed-in account. Passwords are hashed with **scrypt**
(memory-hard, and built into Node, so the Alpine image needs no bcrypt/argon2
toolchain); the session is a signed, HttpOnly cookie carrying the user id and
role.

### First run

Open the app. With no accounts it redirects to **`/setup`**, which creates the
first **admin** and signs you in. That page stops working the moment one account
exists, so it cannot be used to mint a second admin.

For automated deploys, set `FLEETWATCH_ADMIN_USER` and
`FLEETWATCH_ADMIN_PASSWORD` instead — the admin is created on start-up and
`/setup` never opens. Both are ignored once any account exists.

Upgrading from the old shared password? Leave `FLEETWATCH_DASHBOARD_PASSWORD`
in place for one boot: it is converted into an `admin` account with that
password so you are not locked out. Remove it once you have signed in.

### Roles

| Role | View hosts | Add hosts / read agent token | Delete hosts | Manage users | Alert settings |
| ---- | :--------: | :--------------------------: | :----------: | :----------: | :------------: |
| **Admin** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Operator** | ✓ | ✓ | ✓ | — | — |
| **Viewer** | ✓ | — | — | — | — |

The **+ Add Host** button is hidden from viewers on purpose: the token it hands
out authenticates `POST /api/ingest`, so anyone holding it can post arbitrary
data as any host. A read-only account must not be able to read it.

Admins manage accounts at **/users** — create users, change roles, disable an
account without deleting its history, reset a password, or remove it entirely —
and alerting at **/settings**. Everyone can change their own password at
**/account**.

The last active admin cannot be demoted, disabled or deleted, so an instance can
never end up with nobody able to manage it.

### How enforcement works

Three layers, because each alone has a gap:

1. **Middleware** (edge runtime) checks the signed cookie and redirects
   anonymous requests to `/login`. It cannot query Postgres, so this is coarse
   routing only.
2. **Pages and server actions** re-read the *live* user row via
   `getCurrentUser()`. The role is baked into the cookie at sign-in, so without
   this a demoted or disabled user would keep their old access until the cookie
   expired.
3. **Server actions** additionally assert the specific permission
   (`requirePermission("hosts:delete")` and friends) — actions are reachable
   independently of the page that renders them, so they must not trust
   middleware.

Sessions last 7 days and are signed with `FLEETWATCH_SESSION_SECRET`. If that is
unset, `AGENT_API_TOKEN` is used instead — which means rotating the agent token
also signs everyone out. Set it explicitly to avoid that coupling.

---

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
| `/api/hosts/[id]`           | DELETE | session¹     | Stop monitoring a host and delete all of its history (cascades) |
| `/api/jobs/check-downtime`  | POST   | Bearer token | Runs the heartbeat-miss scan on demand (external cron) |
| `/api/health`               | GET    | —            | Container liveness probe |
| `/install.sh`               | GET    | public       | Bootstrapping installer fetched by `curl` |
| `/uninstall.sh`             | GET    | public       | Removes the agent from a host (schedule, files, stored token) |
| `/login` · `/setup`         | GET    | public       | Sign-in, and first-run admin creation while no account exists |
| `/users`                    | GET    | admin        | Account management |
| `/settings`                 | GET    | admin        | Alerting, retention and scan configuration |
| `/vulnerabilities`          | GET    | session¹     | Fleet-wide CVE view, searchable |
| `/account`                  | GET    | session¹     | Change your own password |
| `/agent.sh`                 | GET    | public       | Agent collector script, downloaded by the installer |
| `/digi-fleet-watch.service` | GET    | public       | Systemd unit, downloaded by the installer |
| `/digi-fleet-watch.timer`   | GET    | public       | Systemd timer, downloaded by the installer |

¹ Requires a signed-in session. `/users` additionally requires the **admin**
role. Agent- and probe-facing routes are never session-gated — they use
`AGENT_API_TOKEN`.

### Status thresholds

- **online** ≤ 15 min since last heartbeat · **stale** up to 1 h · **down** > 1 h.
- A downtime event is recorded after a host has been silent for 15 minutes and
  closes automatically when the agent reports again.

---

## Alerting & notifications

Downtime detection runs on a **background scheduler** (every 2 minutes), so an
outage over a quiet weekend is noticed without anyone having the dashboard
open. Service checks tick every 30 seconds; retention and vulnerability scans
run on the same scheduler every 6 hours. Each job takes a Postgres advisory
lock first, so running multiple app replicas against one database does not
double-alert or double-prune.

The watchdog endpoint below still exists for belt-and-braces external cron.

### Configure from the dashboard (recommended)

Admins configure alerting at **/settings** (user menu → *Alert settings*) — SMTP
host, credentials, recipient, and the Slack webhook — with **Send test email**
and **Send test message** buttons that report the real outcome rather than
failing silently at 3am.

Values saved there are stored in the database and **override the matching
environment variables**; clear a field to fall back to `.env`. Each field shows
where its current value comes from (*set here* / *from .env*).

The SMTP password and Slack webhook are **encrypted at rest** (AES-256-GCM,
under a key derived from `FLEETWATCH_SESSION_SECRET`) and are never sent back
to the browser — the form only reports whether one is stored. Set that variable
before saving secrets, or the settings page will say so and refuse.

> Rotating `FLEETWATCH_SESSION_SECRET` makes previously stored secrets
> undecryptable. That degrades to "alerting unconfigured" with a log line
> rather than an error — just re-enter them at /settings.

### Maintenance windows

Patching a host used to page whoever was on call. **Settings → Maintenance
windows** suppresses alerts for one host or the whole fleet, for a chosen
duration.

Monitoring keeps recording throughout — only notifications stop, so uptime,
downtime history and metrics stay accurate. A window can be ended early rather
than waiting it out.

Creating a silence needs the **operator** role, not admin: muting alerts before
you patch a box is day-to-day work, not a configuration change.

> Not to be confused with the **per-check maintenance windows** on /checks
> (see *Service checks*). A silence here mutes every alert for a host —
> downtime, disk, packages, and its checks. A check window mutes only check
> alerts and can be narrowed to a single check.

### Notification channels

Beyond the SMTP recipient and Slack webhook, any number of channels can be
added at **/settings**:

| Type | Target |
| ---- | ------ |
| Email | an address (uses the configured SMTP transport) |
| Slack | `https://hooks.slack.com/services/…` |
| Discord | `https://discord.com/api/webhooks/…` |
| Microsoft Teams | Office connector URL |
| ntfy | `https://ntfy.sh/your-topic` |
| Generic webhook | any URL — receives a stable JSON body |

Each channel declares the **minimum severity** it wants (everything / warning
and above / critical only), so a disk at 85% and a host that vanished can go to
different places. Every channel has a **Test** button that delivers a real
message and records the outcome; a failing webhook shows its last error inline
instead of failing silently.

Targets are encrypted at rest — a webhook URL is a credential — and are never
returned to the browser; the table shows only the origin.

The generic webhook body is a contract, and is covered by tests:

```json
{
  "severity": "critical",
  "title": "HOST DOWN: web-01",
  "body": "No heartbeat since 2026-08-18T14:02:16Z.",
  "hostname": "web-01",
  "url": "http://fleet.example.com/hosts/1",
  "timestamp": "2026-08-18T14:20:00.000Z"
}
```

Delivery failures are recorded against the channel and never thrown: one dead
webhook must not stop the others, nor fail the ingest that raised the alert.

### Slack (optional)

Set the webhook at **/settings**, or `SLACK_WEBHOOK_URL` in `.env`. A message is
posted whenever a host goes **down**.

### Email (optional, SMTP)

Set these at **/settings**, or in `.env` as the fallback:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false            # true for implicit TLS (port 465)
SMTP_USER=alerts@example.com
SMTP_PASS=change-me
MAIL_FROM="Digi Fleet Watch <alerts@example.com>"
ALERT_EMAIL_TO=ops@example.com
```

Leave the SMTP host empty (in both places) to disable email. Emails are sent for:

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
| HTTP check says `TLS certificate could not be verified` | The service is answering, but its certificate is self-signed, has an incomplete chain, or is served on a bare IP that no certificate can match. | Recreate the check with **Ignore certificate errors** ticked. Add a separate TLS check if you still want expiry warnings. |
| HTTP check says `not a TLS port (try http://)` | `https://` against a plaintext port. | Fix the scheme in the target. |
| Ping check says `ping binary not available` | The app image has no `ping`. | Install `iputils-ping` in the image, or use a TCP check instead. |
| A check is red but never alerted | It is suppressed — look for the grey badge next to the status (`in maintenance`, `upstream down`, `flapping`), or a fleet-wide silence. | Expected behaviour; see *Service checks*. |
| 30-day uptime looks wrong | `check_results` is pruned at **Keep raw data for** (14 days by default), which is shorter than the 30-day window. | Raise the retention setting at /settings. |

---

## Project layout

```
├── agent/                  # host-side agent (Bash + systemd/cron)
│   ├── agent.sh            # collector script (curl + jq only)
│   ├── digi-fleet-watch.service / .timer
│   ├── install.sh          # root installer (systemd/cron, with error path)
│   ├── uninstall.sh        # removes the agent, schedule and stored token
│   ├── Dockerfile.agent    # standalone containerized agent (loop entrypoint)
│   └── INSTALL.md          # agent docs + privilege model
├── drizzle/                # SQL migrations, applied automatically at app start
│   ├── 0000_initial.sql    # base schema
│   ├── 0001_containers.sql # per-container tables
│   ├── 0002_one_open_downtime.sql  # one open outage per host
│   ├── 0003_users.sql      # accounts and roles
│   ├── 0004_settings.sql   # dashboard-editable configuration
│   ├── 0005_metrics.sql    # host_metrics + disk_usage
│   ├── 0006_retention.sql  # host_daily_rollup
│   ├── 0007_vulnerabilities.sql  # OSV advisories + per-host exposure
│   ├── 0008_alerting.sql   # alert silences + notification channels
│   ├── 0009_checks.sql     # external service checks + result history
│   ├── 0010_checks_advanced.sql  # assertions, degraded state, dependencies,
│   │                             # check maintenance windows, SLO targets
│   └── 0011_check_insecure_tls.sql  # opt out of cert verification per check
├── src/
│   ├── app/                # Next.js App Router: pages, /api and script routes (/install.sh…)
│   ├── components/         # dashboard UI (incl. Add Host dialog)
│   ├── db/schema.ts        # Drizzle schema
│   ├── instrumentation.ts  # start-up hook → migrations + first-admin seed
│   ├── middleware.ts       # session + role gate
│   └── lib/                # db client, migrations, downtime logic, alerts,
│                           # rbac.ts, session.ts, password.ts, users.ts,
│                           # settings.ts, secrets.ts, scheduler.ts,
│                           # retention.ts, osv.ts, cvss.ts, vulnerabilities.ts,
│                           # alerts.ts (server), alert-channels.ts (shared),
│                           # checks.ts (probe runner + queries, Node-only),
│                           # check-types.ts (pure check logic, unit-tested)
├── scripts/
│   └── rotate-agent-token.sh  # zero-downtime AGENT_API_TOKEN rotation
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