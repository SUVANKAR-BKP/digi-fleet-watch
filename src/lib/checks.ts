import { execFile } from "node:child_process";
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";
import { promisify } from "node:util";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { checkResults, checks, maintenanceWindows } from "@/db/schema";
import { dispatchAlert } from "./alerts";
import { getDb } from "./db";
import { ensureSchema } from "./migrate";
import {
  applyLatencyThreshold,
  certDaysRemaining,
  certUrgency,
  clampAttempts,
  decideAlert,
  deriveIncidents,
  errorBudget,
  evaluateAssertion,
  findMaintenanceWindow,
  httpStatusOk,
  isAssertionKind,
  isCheckType,
  isDue,
  isFlapping,
  isMaintenanceScope,
  parseDnsTarget,
  parseHostPort,
  parsePingOutput,
  retryDelayMs,
  statusIsUp,
  summariseBody,
  validateAssertion,
  validateCheckTarget,
  validateMaintenanceWindow,
  validateSloTarget,
  EMPTY_LATENCY_STATS,
  EMPTY_UPTIME_WINDOW,
  FLAP_SAMPLE_SIZE,
  type AssertionSpec,
  type CheckRow,
  type CheckStatus,
  type CheckType,
  type Incident,
  type LatencyStats,
  type MaintenanceWindow,
  type SuppressionReason,
  type UptimeWindow,
} from "./check-types";

/**
 * Runs external checks and records their results.
 *
 * Node-only: opens raw sockets and shells out to ping. The pure decision logic
 * lives in check-types.ts so it can be tested without a network.
 */

const execFileAsync = promisify(execFile);

/**
 * Cap on the response body pulled into memory for an assertion.
 *
 * Without it, one check pointed at a large download would decide how much RAM
 * the monitoring box needs. 256 KB is far more than any health endpoint, and
 * assertions are documented as operating on the start of the body.
 */
const MAX_BODY_BYTES = 256 * 1024;

export interface ProbeOutcome {
  status: CheckStatus;
  /** Convenience mirror of `status !== "down"`, kept for the boolean columns. */
  ok: boolean;
  latencyMs: number | null;
  detail: string;
  certExpiresAt?: Date | null;
  /** Attempts actually made, so a flaky-but-passing target is visible. */
  attempts: number;
}

function outcome(
  status: CheckStatus,
  latencyMs: number | null,
  detail: string,
  extra?: { certExpiresAt?: Date | null },
): ProbeOutcome {
  return {
    status,
    ok: statusIsUp(status),
    latencyMs,
    detail,
    certExpiresAt: extra?.certExpiresAt ?? null,
    attempts: 1,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

/** Opens a TCP connection and reports whether it was accepted. */
function probeTcp(host: string, port: number, timeoutMs: number): Promise<ProbeOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: ProbeOutcome) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () =>
      finish(outcome("ok", Date.now() - started, "connected")),
    );
    socket.once("timeout", () =>
      finish(outcome("down", null, `timed out after ${timeoutMs}ms`)),
    );
    socket.once("error", (err) => finish(outcome("down", null, err.message)));

    socket.connect(port, host);
  });
}

/**
 * Reads the peer certificate without trusting it.
 *
 * `rejectUnauthorized: false` is deliberate: the job here is to *report* on the
 * certificate, including one that is already expired or self-signed. Refusing
 * the handshake would turn the most important case — "your cert expired" —
 * into an unhelpful connection error.
 */
function probeTls(host: string, port: number, timeoutMs: number): Promise<ProbeOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;

    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs },
      () => {
        if (settled) return;
        settled = true;
        const cert = socket.getPeerCertificate();
        const latencyMs = Date.now() - started;
        socket.destroy();

        if (!cert || !cert.valid_to) {
          resolve(outcome("down", latencyMs, "no certificate presented"));
          return;
        }

        const expiresAt = new Date(cert.valid_to);
        if (Number.isNaN(expiresAt.getTime())) {
          resolve(outcome("down", latencyMs, `unparsable expiry "${cert.valid_to}"`));
          return;
        }

        const days = certDaysRemaining(expiresAt);
        const urgency = certUrgency(days);
        // An expiring certificate is degraded, not down: it still works today,
        // and calling it an outage would make the pill red for three weeks.
        const status: CheckStatus =
          urgency === "expired" ? "down" : urgency === "ok" ? "ok" : "degraded";

        resolve(
          outcome(
            status,
            latencyMs,
            urgency === "expired"
              ? `certificate expired ${Math.abs(days)} day(s) ago`
              : `valid for ${days} more day(s)` +
                  (cert.subject?.CN ? ` (CN=${cert.subject.CN})` : ""),
            { certExpiresAt: expiresAt },
          ),
        );
      },
    );

    const fail = (detail: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(outcome("down", null, detail));
    };

    socket.once("timeout", () => fail(`timed out after ${timeoutMs}ms`));
    socket.once("error", (err) => fail(err.message));
  });
}

/**
 * Reads at most `MAX_BODY_BYTES` of the response.
 *
 * Streamed rather than `res.text()` so an unexpectedly large body is abandoned
 * mid-flight instead of being fully buffered and then truncated.
 */
async function readBodyCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.byteLength;
      if (total >= MAX_BODY_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    joined.set(c.subarray(0, Math.min(c.byteLength, total - offset)), offset);
    offset += c.byteLength;
    if (offset >= total) break;
  }
  return new TextDecoder().decode(joined.subarray(0, MAX_BODY_BYTES));
}

/** Issues a GET, checks the status code and any body assertion. */
async function probeHttp(
  url: string,
  expectedStatus: number | null,
  assertion: AssertionSpec,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "DigiFleetWatch/1.0 (+health-check)" },
    });

    // With an assertion the body is part of the response, so latency covers
    // reading it. Without one, time-to-headers is the honest figure.
    const body = assertion.kind === "none" ? "" : await readBodyCapped(res);
    const latencyMs = Date.now() - started;

    const statusOk = httpStatusOk(res.status, expectedStatus);
    if (!statusOk) {
      return outcome(
        "down",
        latencyMs,
        `HTTP ${res.status}` +
          (expectedStatus ? ` (expected ${expectedStatus})` : " (expected 2xx/3xx)"),
      );
    }

    const asserted = evaluateAssertion(assertion, body);
    if (!asserted.passed) {
      // The status code lied. That is a real failure, and the detail has to say
      // what the body actually contained or the alert is unactionable.
      return outcome("down", latencyMs, `HTTP ${res.status} but ${asserted.detail}`);
    }

    return outcome(
      "ok",
      latencyMs,
      `HTTP ${res.status} in ${latencyMs}ms` +
        (asserted.detail ? `, ${asserted.detail}` : ""),
    );
  } catch (err) {
    const message =
      (err as Error).name === "AbortError"
        ? `timed out after ${timeoutMs}ms`
        : (err as Error).message;
    return outcome("down", null, message);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolves a DNS record and optionally asserts on what came back.
 *
 * Records are joined into one string so the existing assertion machinery
 * applies unchanged — "does A:example.com still point at the old load
 * balancer" is a `contains` assertion, not a new concept.
 */
async function probeDns(
  target: string,
  assertion: AssertionSpec,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const parsed = parseDnsTarget(target);
  if (!parsed) return outcome("down", null, `invalid DNS target "${target}"`);

  const resolver = new dns.promises.Resolver({ timeout: timeoutMs, tries: 1 });
  const started = Date.now();

  try {
    const records = await resolveRecords(resolver, parsed.record, parsed.hostname);
    const latencyMs = Date.now() - started;

    if (records.length === 0) {
      return outcome("down", latencyMs, `${parsed.record} ${parsed.hostname}: no records`);
    }

    const joined = records.join(", ");
    const asserted = evaluateAssertion(assertion, joined);
    if (!asserted.passed) {
      return outcome("down", latencyMs, `resolved to ${joined} but ${asserted.detail}`);
    }

    return outcome("ok", latencyMs, `${parsed.record} → ${summariseBody(joined, 100)}`);
  } catch (err) {
    // NXDOMAIN and SERVFAIL both surface as errors with a `code`; the code is
    // the single most useful thing in the alert, so it leads.
    const e = err as NodeJS.ErrnoException;
    return outcome("down", null, `${e.code ?? "resolve failed"}: ${e.message}`);
  }
}

async function resolveRecords(
  resolver: dns.promises.Resolver,
  record: string,
  hostname: string,
): Promise<string[]> {
  switch (record) {
    case "A":
      return resolver.resolve4(hostname);
    case "AAAA":
      return resolver.resolve6(hostname);
    case "CNAME":
      return resolver.resolveCname(hostname);
    case "NS":
      return resolver.resolveNs(hostname);
    case "MX":
      return (await resolver.resolveMx(hostname)).map(
        (m) => `${m.priority} ${m.exchange}`,
      );
    case "TXT":
      return (await resolver.resolveTxt(hostname)).map((parts) => parts.join(""));
    default:
      return [];
  }
}

/** Echo requests to send per ping check. */
const PING_COUNT = 4;

/**
 * Sends ICMP echoes via the system `ping`.
 *
 * Node cannot open raw ICMP sockets without elevated privileges, so shelling
 * out is the practical route. `execFile` with an argument array means the
 * hostname is never parsed by a shell, and the target has already been
 * validated as a hostname or IP.
 *
 * Partial packet loss maps to "degraded" — losing 1 of 4 packets is a real
 * signal about the path, but it is not an outage, and treating it as one would
 * page on ordinary internet weather.
 */
async function probePing(host: string, timeoutMs: number): Promise<ProbeOutcome> {
  const deadlineSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const started = Date.now();

  try {
    const { stdout } = await execFileAsync(
      "ping",
      ["-n", "-c", String(PING_COUNT), "-w", String(deadlineSeconds), host],
      { timeout: timeoutMs + 1_000, encoding: "utf8" },
    );
    return summarisePing(stdout, Date.now() - started);
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string };
    // ping exits non-zero on total loss, but still prints a usable summary.
    if (e.stdout) {
      const parsed = parsePingOutput(e.stdout);
      if (parsed) return summarisePing(e.stdout, Date.now() - started);
    }
    if (e.code === "ENOENT") {
      return outcome("down", null, "ping binary not available on this host");
    }
    return outcome("down", null, e.message || "ping failed");
  }
}

function summarisePing(stdout: string, elapsedMs: number): ProbeOutcome {
  const parsed = parsePingOutput(stdout);
  if (!parsed) return outcome("down", null, "could not parse ping output");

  const latency = parsed.avgRttMs === null ? null : Math.round(parsed.avgRttMs);
  const loss = Math.round(parsed.lossPct);

  if (parsed.received === 0) {
    return outcome("down", null, `100% packet loss (${parsed.transmitted} sent)`);
  }
  if (loss > 0) {
    return outcome(
      "degraded",
      latency ?? elapsedMs,
      `${loss}% packet loss, avg ${latency ?? "?"}ms`,
    );
  }
  return outcome("ok", latency ?? elapsedMs, `${parsed.received}/${parsed.transmitted} replies, avg ${latency ?? "?"}ms`);
}

// ---------------------------------------------------------------------------
// Probe dispatch
// ---------------------------------------------------------------------------

export interface ProbeInput {
  type: string;
  target: string;
  expectedStatus: number | null;
  assertionKind?: string | null;
  assertionValue?: string | null;
  assertionPath?: string | null;
  degradedAboveMs?: number | null;
  attempts?: number | null;
  timeoutMs: number;
}

function assertionOf(check: ProbeInput): AssertionSpec {
  const kind = check.assertionKind ?? "none";
  return {
    kind: isAssertionKind(kind) ? kind : "none",
    value: check.assertionValue ?? null,
    path: check.assertionPath ?? null,
  };
}

/** One probe attempt. Never throws — a probe failure is a result, not an error. */
async function runOnce(check: ProbeInput): Promise<ProbeOutcome> {
  const type: CheckType = isCheckType(check.type) ? check.type : "tcp";
  try {
    if (type === "http") {
      return await probeHttp(
        check.target,
        check.expectedStatus,
        assertionOf(check),
        check.timeoutMs,
      );
    }
    if (type === "dns") {
      return await probeDns(check.target, assertionOf(check), check.timeoutMs);
    }
    if (type === "ping") {
      return await probePing(check.target.trim(), check.timeoutMs);
    }

    const parsed = parseHostPort(check.target, type === "tls" ? 443 : undefined);
    if (!parsed) return outcome("down", null, `invalid target "${check.target}"`);

    return type === "tls"
      ? await probeTls(parsed.host, parsed.port, check.timeoutMs)
      : await probeTcp(parsed.host, parsed.port, check.timeoutMs);
  } catch (err) {
    return outcome("down", null, (err as Error).message);
  }
}

/**
 * Runs a probe, retrying on failure, then applies the latency threshold.
 *
 * Only `down` is retried. A degraded result already succeeded — retrying until
 * one attempt comes back fast would hide exactly the slow slide the degraded
 * state exists to surface.
 */
export async function runProbe(check: ProbeInput): Promise<ProbeOutcome> {
  const maxAttempts = clampAttempts(check.attempts ?? 1);
  let last = await runOnce(check);
  let attempt = 1;

  while (last.status === "down" && attempt < maxAttempts) {
    attempt++;
    await sleep(retryDelayMs(attempt));
    last = await runOnce(check);
  }

  const status = applyLatencyThreshold(
    last.status,
    last.latencyMs,
    check.degradedAboveMs ?? null,
  );

  const detail =
    status === "degraded" && last.status === "ok"
      ? `${last.detail} — slower than ${check.degradedAboveMs}ms`
      : attempt > 1 && statusIsUp(status)
        ? `${last.detail} (recovered on attempt ${attempt})`
        : attempt > 1
          ? `${last.detail} (${attempt} attempts)`
          : last.detail;

  return { ...last, status, ok: statusIsUp(status), detail, attempts: attempt };
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

function toWindow(row: typeof maintenanceWindows.$inferSelect): MaintenanceWindow | null {
  if (!isMaintenanceScope(row.scope)) return null;
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    hostId: row.hostId,
    checkId: row.checkId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  };
}

/** Maintenance windows overlapping now, loaded once per scheduler tick. */
async function activeWindows(now: Date): Promise<MaintenanceWindow[]> {
  const rows = await getDb()
    .select()
    .from(maintenanceWindows)
    .where(
      and(lte(maintenanceWindows.startsAt, now), gte(maintenanceWindows.endsAt, now)),
    );
  return rows.map(toWindow).filter((w): w is MaintenanceWindow => w !== null);
}

/** The last few statuses for a check, oldest first, for flap detection. */
async function recentStatuses(checkId: number): Promise<CheckStatus[]> {
  const rows = await getDb()
    .select({ status: checkResults.status, ok: checkResults.ok })
    .from(checkResults)
    .where(eq(checkResults.checkId, checkId))
    .orderBy(desc(checkResults.ranAt))
    .limit(FLAP_SAMPLE_SIZE);

  return rows.reverse().map((r) => normaliseStatus(r.status, r.ok));
}

/** History predates the status column; fall back to the boolean. */
function normaliseStatus(status: string | null, ok: boolean | null): CheckStatus {
  if (status === "ok" || status === "degraded" || status === "down") return status;
  return ok ? "ok" : "down";
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Runs every check that is due, records results and raises alerts on
 * transitions. Called by the scheduler.
 */
export async function runDueChecks(): Promise<{
  ran: number;
  failed: number;
  suppressed: number;
}> {
  await ensureSchema();
  const db = getDb();
  const now = new Date();

  const rows = await db.select().from(checks).where(eq(checks.enabled, true));
  const due = rows.filter((c) => isDue(c.lastRunAt, c.intervalSeconds, now));
  if (due.length === 0) return { ran: 0, failed: 0, suppressed: 0 };

  const windows = await activeWindows(now);
  // Parent status comes from the stored row, not a fresh probe: re-probing the
  // upstream for every dependent would multiply load by the fan-out.
  const statusById = new Map(
    rows.map((c) => [c.id, normaliseStatus(c.lastStatus, c.lastOk)]),
  );

  let failed = 0;
  let suppressed = 0;

  // Sequential on purpose: a fleet of checks hammering out in parallel from one
  // small VPS is a good way to make the box itself look unhealthy.
  for (const check of due) {
    const result = await runProbe(check);
    if (result.status === "down") failed++;

    const consecutiveFailures = statusIsUp(result.status)
      ? 0
      : check.consecutiveFailures + 1;

    const reason = await suppressionFor(check, result, statusById, windows, now);
    if (reason !== null) suppressed++;

    const action = decideAlert({
      status: result.status,
      consecutiveFailures,
      alertedDown: check.alertedDown,
      alertedDegraded: check.alertedDegraded,
      suppressedBy: reason,
    });

    await writeResult(check, result, consecutiveFailures, reason, action, now);
    statusById.set(check.id, result.status);

    await sendAlert(check, result, consecutiveFailures, action);
    await maybeAlertCertExpiry(check, result, reason, now);
  }

  return { ran: due.length, failed, suppressed };
}

/**
 * Decides whether an alert for this run should be held back.
 *
 * Ordered by how much the operator already knows: a window they scheduled
 * beats an upstream they can infer, which beats instability the system has to
 * tell them about.
 */
async function suppressionFor(
  check: typeof checks.$inferSelect,
  result: ProbeOutcome,
  statusById: Map<number, CheckStatus>,
  windows: readonly MaintenanceWindow[],
  now: Date,
): Promise<SuppressionReason> {
  if (statusIsUp(result.status)) return null;

  if (findMaintenanceWindow(windows, { checkId: check.id, hostId: check.hostId }, now)) {
    return "maintenance";
  }

  if (check.dependsOnCheckId !== null) {
    const parent = statusById.get(check.dependsOnCheckId);
    if (parent !== undefined && !statusIsUp(parent)) return "dependency";
  }

  // Queried last, and only for a failing check, because it costs a round trip.
  const history = await recentStatuses(check.id);
  return isFlapping([...history, result.status]) ? "flapping" : null;
}

/** Persists the run: current state on the check, plus a history row. */
async function writeResult(
  check: typeof checks.$inferSelect,
  result: ProbeOutcome,
  consecutiveFailures: number,
  reason: SuppressionReason,
  action: ReturnType<typeof decideAlert>,
  now: Date,
): Promise<void> {
  const db = getDb();

  await db
    .update(checks)
    .set({
      lastRunAt: now,
      lastStatus: result.status,
      lastOk: result.ok,
      lastLatencyMs: result.latencyMs,
      lastDetail: result.detail.slice(0, 500),
      suppressedBy: reason,
      consecutiveFailures,
      certExpiresAt: result.certExpiresAt ?? check.certExpiresAt,
      alertedDown:
        action === "down" ? true : action === "recovery" ? false : check.alertedDown,
      alertedDegraded:
        action === "degraded"
          ? true
          : action === "recovery"
            ? false
            : check.alertedDegraded,
    })
    .where(eq(checks.id, check.id));

  await db.insert(checkResults).values({
    checkId: check.id,
    ranAt: now,
    ok: result.ok,
    status: result.status,
    latencyMs: result.latencyMs,
    detail: result.detail.slice(0, 500),
  });
}

async function sendAlert(
  check: typeof checks.$inferSelect,
  result: ProbeOutcome,
  consecutiveFailures: number,
  action: ReturnType<typeof decideAlert>,
): Promise<void> {
  if (action === "none") return;

  const label = check.type.toUpperCase();
  const routing = {
    hostId: check.hostId ?? undefined,
    channelId: check.alertChannelId ?? undefined,
  };

  if (action === "down") {
    await dispatchAlert({
      severity: "critical",
      title: `Check failing: ${check.name}`,
      body:
        `${label} check on ${check.target} has failed ` +
        `${consecutiveFailures} times in a row.\n\n${result.detail}`,
      ...routing,
    });
    return;
  }

  if (action === "degraded") {
    await dispatchAlert({
      severity: "warning",
      title: `Check degraded: ${check.name}`,
      body:
        `${label} check on ${check.target} is still responding but not ` +
        `healthily.\n\n${result.detail}`,
      ...routing,
    });
    return;
  }

  await dispatchAlert({
    severity: "info",
    title: `Check recovered: ${check.name}`,
    body: `${check.target} is responding again. ${result.detail}`,
    ...routing,
  });
}

/**
 * Warns about a certificate approaching expiry, at most once a day per check.
 *
 * Expiry is not a failure until the day it happens, so it needs its own alert
 * rather than riding on the up/down transition — the whole point is to hear
 * about it while there is still time to renew.
 */
async function maybeAlertCertExpiry(
  check: typeof checks.$inferSelect,
  result: ProbeOutcome,
  reason: SuppressionReason,
  now: Date,
): Promise<void> {
  const expiresAt = result.certExpiresAt;
  if (!expiresAt) return;
  if (reason === "maintenance") return;

  const days = certDaysRemaining(expiresAt, now);
  const urgency = certUrgency(days);
  if (urgency === "ok") return;

  const lastAlert = check.certAlertedAt;
  if (lastAlert && now.getTime() - lastAlert.getTime() < 24 * 3_600_000) return;

  await getDb()
    .update(checks)
    .set({ certAlertedAt: now })
    .where(eq(checks.id, check.id));

  await dispatchAlert({
    severity: urgency === "warning" ? "warning" : "critical",
    title:
      urgency === "expired"
        ? `TLS certificate EXPIRED: ${check.name}`
        : `TLS certificate expires in ${days} day(s): ${check.name}`,
    body:
      `${check.target} presents a certificate that ` +
      (urgency === "expired"
        ? `expired on ${expiresAt.toISOString().slice(0, 10)}.`
        : `expires on ${expiresAt.toISOString().slice(0, 10)} (${days} days).`) +
      `\n\nRenew it before browsers start refusing the connection.`,
    hostId: check.hostId ?? undefined,
    channelId: check.alertChannelId ?? undefined,
  });
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

// A type alias, not an interface: drizzle's execute<T> requires T to satisfy
// Record<string, unknown>, and only type aliases get an implicit index
// signature.
type StatsRow = {
  id: number;
  hostname: string | null;
  depends_on_name: string | null;
  alert_channel_name: string | null;
  uptime_pct: number | null;
  n24: number | string;
  up24: number | string;
  n7d: number | string;
  up7d: number | string;
  n30d: number | string;
  up30d: number | string;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  min_ms: number | null;
  max_ms: number | null;
  lat_samples: number | string;
};

/**
 * Windowed availability and latency percentiles for every check, in one query.
 *
 * Computed in Postgres rather than by pulling results into Node: a 30-day
 * window at a one-minute interval is 43,000 rows per check, and the dashboard
 * needs six numbers from it.
 */
const STATS_SQL = sql`
  select c.id,
         h.hostname,
         dep.name as depends_on_name,
         ch.name as alert_channel_name,
         case when s.total > 0
              then round((s.up::numeric / s.total) * 1000) / 10
              end as uptime_pct,
         coalesce(s.n24, 0)  as n24,  coalesce(s.up24, 0)  as up24,
         coalesce(s.n7d, 0)  as n7d,  coalesce(s.up7d, 0)  as up7d,
         coalesce(s.n30d, 0) as n30d, coalesce(s.up30d, 0) as up30d,
         s.p50, s.p95, s.p99, s.min_ms, s.max_ms,
         coalesce(s.lat_samples, 0) as lat_samples
  from checks c
  left join hosts h on h.id = c.host_id
  left join checks dep on dep.id = c.depends_on_check_id
  left join notification_channels ch on ch.id = c.alert_channel_id
  left join lateral (
    select
      count(*) as total,
      count(*) filter (where coalesce(r.status, case when r.ok then 'ok' else 'down' end) <> 'down') as up,

      count(*) filter (where r.ran_at >= now() - interval '24 hours') as n24,
      count(*) filter (where r.ran_at >= now() - interval '24 hours'
                         and coalesce(r.status, case when r.ok then 'ok' else 'down' end) <> 'down') as up24,

      count(*) filter (where r.ran_at >= now() - interval '7 days') as n7d,
      count(*) filter (where r.ran_at >= now() - interval '7 days'
                         and coalesce(r.status, case when r.ok then 'ok' else 'down' end) <> 'down') as up7d,

      count(*) filter (where r.ran_at >= now() - interval '30 days') as n30d,
      count(*) filter (where r.ran_at >= now() - interval '30 days'
                         and coalesce(r.status, case when r.ok then 'ok' else 'down' end) <> 'down') as up30d,

      percentile_disc(0.50) within group (order by r.latency_ms)
        filter (where r.latency_ms is not null and r.ran_at >= now() - interval '24 hours') as p50,
      percentile_disc(0.95) within group (order by r.latency_ms)
        filter (where r.latency_ms is not null and r.ran_at >= now() - interval '24 hours') as p95,
      percentile_disc(0.99) within group (order by r.latency_ms)
        filter (where r.latency_ms is not null and r.ran_at >= now() - interval '24 hours') as p99,
      min(r.latency_ms) filter (where r.ran_at >= now() - interval '24 hours') as min_ms,
      max(r.latency_ms) filter (where r.ran_at >= now() - interval '24 hours') as max_ms,
      count(r.latency_ms) filter (where r.ran_at >= now() - interval '24 hours') as lat_samples
    from check_results r
    where r.check_id = c.id
  ) s on true
`;

function uptimeWindow(total: number | string, up: number | string): UptimeWindow {
  const n = Number(total);
  if (n === 0) return EMPTY_UPTIME_WINDOW;
  return { uptimePct: Math.round((Number(up) / n) * 1000) / 10, samples: n };
}

function statsFrom(r: StatsRow): LatencyStats {
  const samples = Number(r.lat_samples);
  if (samples === 0) return EMPTY_LATENCY_STATS;
  return {
    p50: r.p50,
    p95: r.p95,
    p99: r.p99,
    min: r.min_ms,
    max: r.max_ms,
    samples,
  };
}

function toRow(
  c: typeof checks.$inferSelect,
  stats: StatsRow | undefined,
): CheckRow {
  const uptime30d = stats ? uptimeWindow(stats.n30d, stats.up30d) : EMPTY_UPTIME_WINDOW;
  const kind = c.assertionKind ?? "none";

  return {
    id: c.id,
    hostId: c.hostId,
    hostname: stats?.hostname ?? null,
    name: c.name,
    type: isCheckType(c.type) ? c.type : "tcp",
    target: c.target,
    expectedStatus: c.expectedStatus,
    assertionKind: isAssertionKind(kind) ? kind : "none",
    assertionValue: c.assertionValue,
    assertionPath: c.assertionPath,
    degradedAboveMs: c.degradedAboveMs,
    attempts: c.attempts,
    dependsOnCheckId: c.dependsOnCheckId,
    dependsOnName: stats?.depends_on_name ?? null,
    sloTarget: c.sloTarget,
    alertChannelId: c.alertChannelId,
    alertChannelName: stats?.alert_channel_name ?? null,
    intervalSeconds: c.intervalSeconds,
    timeoutMs: c.timeoutMs,
    enabled: c.enabled,
    lastRunAt: c.lastRunAt ? c.lastRunAt.toISOString() : null,
    lastStatus: c.lastStatus ? normaliseStatus(c.lastStatus, c.lastOk) : null,
    lastOk: c.lastOk,
    lastLatencyMs: c.lastLatencyMs,
    lastDetail: c.lastDetail,
    suppressedBy: (c.suppressedBy as SuppressionReason) ?? null,
    certExpiresAt: c.certExpiresAt ? c.certExpiresAt.toISOString() : null,
    certDaysRemaining: c.certExpiresAt ? certDaysRemaining(c.certExpiresAt) : null,
    consecutiveFailures: c.consecutiveFailures,
    uptimePct: stats?.uptime_pct ?? null,
    uptime24h: stats ? uptimeWindow(stats.n24, stats.up24) : EMPTY_UPTIME_WINDOW,
    uptime7d: stats ? uptimeWindow(stats.n7d, stats.up7d) : EMPTY_UPTIME_WINDOW,
    uptime30d,
    latency24h: stats ? statsFrom(stats) : EMPTY_LATENCY_STATS,
    // The budget is measured over 30 days: short enough to act on, long enough
    // that a single blip does not consume it.
    budget:
      c.sloTarget !== null && uptime30d.uptimePct !== null
        ? errorBudget(uptime30d.uptimePct, c.sloTarget, 30 * 24 * 60)
        : null,
  };
}

/** All checks, with hostname, availability windows and latency, in one query. */
export async function listChecks(hostId?: number): Promise<CheckRow[]> {
  await ensureSchema();
  const db = getDb();

  const { rows } = await db.execute<StatsRow>(
    hostId === undefined
      ? STATS_SQL
      : sql`${STATS_SQL} where c.host_id = ${hostId}`,
  );
  const stats = new Map(rows.map((r) => [r.id, r]));

  const all = await db
    .select()
    .from(checks)
    .where(hostId === undefined ? sql`true` : eq(checks.hostId, hostId))
    .orderBy(asc(checks.name));

  return all.map((c) => toRow(c, stats.get(c.id)));
}

/** Recent results for a sparkline, oldest first. */
export async function recentResults(
  checkId: number,
  limit = 60,
): Promise<
  { ranAt: string; ok: boolean; status: CheckStatus; latencyMs: number | null }[]
> {
  const rows = await getDb()
    .select({
      ranAt: checkResults.ranAt,
      ok: checkResults.ok,
      status: checkResults.status,
      latencyMs: checkResults.latencyMs,
    })
    .from(checkResults)
    .where(eq(checkResults.checkId, checkId))
    .orderBy(desc(checkResults.ranAt))
    .limit(limit);

  return rows.reverse().map((r) => ({
    ranAt: r.ranAt.toISOString(),
    ok: r.ok,
    status: normaliseStatus(r.status, r.ok),
    latencyMs: r.latencyMs,
  }));
}

/**
 * Incidents for one check over the last `days`, newest first.
 *
 * Derived from results on read rather than maintained as its own table — see
 * `deriveIncidents`. Capped so a check with a one-minute interval cannot
 * return 43,000 rows to the browser.
 */
export async function checkIncidents(
  checkId: number,
  days = 30,
  limit = 20,
): Promise<Incident[]> {
  await ensureSchema();
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await getDb()
    .select({
      ranAt: checkResults.ranAt,
      ok: checkResults.ok,
      status: checkResults.status,
      detail: checkResults.detail,
    })
    .from(checkResults)
    .where(and(eq(checkResults.checkId, checkId), gte(checkResults.ranAt, since)))
    .orderBy(asc(checkResults.ranAt));

  const series = rows.map((r) => ({
    ranAt: r.ranAt.toISOString(),
    status: normaliseStatus(r.status, r.ok),
    detail: r.detail,
  }));

  return deriveIncidents(series).slice(0, limit);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateCheckInput {
  hostId: number | null;
  name: string;
  type: string;
  target: string;
  expectedStatus: number | null;
  assertionKind: string;
  assertionValue: string | null;
  assertionPath: string | null;
  degradedAboveMs: number | null;
  attempts: number;
  dependsOnCheckId: number | null;
  sloTarget: number | null;
  alertChannelId: number | null;
  intervalSeconds: number;
  createdBy: string;
}

export async function createCheck(
  input: CreateCheckInput,
): Promise<{ ok: boolean; error?: string }> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 64) {
    return { ok: false, error: "Name must be 1–64 characters." };
  }
  if (!isCheckType(input.type)) return { ok: false, error: "Unknown check type." };

  const targetError = validateCheckTarget(input.type, input.target);
  if (targetError) return { ok: false, error: targetError };

  if (input.expectedStatus !== null) {
    if (
      !Number.isInteger(input.expectedStatus) ||
      input.expectedStatus < 100 ||
      input.expectedStatus > 599
    ) {
      return { ok: false, error: "Expected status must be between 100 and 599." };
    }
  }

  if (!isAssertionKind(input.assertionKind)) {
    return { ok: false, error: "Unknown assertion type." };
  }
  // Only HTTP and DNS produce a body to assert on; silently accepting one on a
  // TCP check would create a rule that can never fail.
  const assertsBody = input.assertionKind !== "none";
  if (assertsBody && input.type !== "http" && input.type !== "dns") {
    return { ok: false, error: "Body assertions apply to HTTP and DNS checks only." };
  }
  const spec: AssertionSpec = {
    kind: input.assertionKind,
    value: input.assertionValue,
    path: input.assertionPath,
  };
  const assertionError = validateAssertion(spec);
  if (assertionError) return { ok: false, error: assertionError };

  if (input.degradedAboveMs !== null) {
    if (!Number.isInteger(input.degradedAboveMs) || input.degradedAboveMs < 1) {
      return { ok: false, error: "Degraded threshold must be a positive number of ms." };
    }
    if (input.degradedAboveMs >= 10_000) {
      return { ok: false, error: "Degraded threshold must be below the 10s timeout." };
    }
  }

  const sloError = validateSloTarget(input.sloTarget);
  if (sloError) return { ok: false, error: sloError };

  // Below 30s a check costs more than it tells you, and hammers the target.
  if (input.intervalSeconds < 30 || input.intervalSeconds > 86_400) {
    return { ok: false, error: "Interval must be between 30 seconds and 24 hours." };
  }

  await ensureSchema();

  if (input.dependsOnCheckId !== null) {
    const [parent] = await getDb()
      .select({ id: checks.id })
      .from(checks)
      .where(eq(checks.id, input.dependsOnCheckId))
      .limit(1);
    if (!parent) return { ok: false, error: "The upstream check no longer exists." };
  }

  await getDb()
    .insert(checks)
    .values({
      hostId: input.hostId,
      name,
      type: input.type,
      target: input.target.trim(),
      expectedStatus: input.expectedStatus,
      assertionKind: input.assertionKind,
      assertionValue: assertsBody ? (input.assertionValue?.trim() ?? null) : null,
      assertionPath: assertsBody ? (input.assertionPath?.trim() ?? null) : null,
      degradedAboveMs: input.degradedAboveMs,
      attempts: clampAttempts(input.attempts),
      dependsOnCheckId: input.dependsOnCheckId,
      sloTarget: input.sloTarget,
      alertChannelId: input.alertChannelId,
      intervalSeconds: input.intervalSeconds,
      createdBy: input.createdBy,
    });
  return { ok: true };
}

export async function setCheckEnabled(
  id: number,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await ensureSchema();
  const rows = await getDb()
    .update(checks)
    // Clear the alert latches too, so re-enabling does not immediately fire a
    // recovery for an outage nobody was watching.
    .set({
      enabled,
      alertedDown: false,
      alertedDegraded: false,
      consecutiveFailures: 0,
      suppressedBy: null,
    })
    .where(eq(checks.id, id))
    .returning({ id: checks.id });
  return rows.length > 0 ? { ok: true } : { ok: false, error: "No such check." };
}

export async function deleteCheck(id: number): Promise<{ ok: boolean; error?: string }> {
  await ensureSchema();
  const rows = await getDb()
    .delete(checks)
    .where(eq(checks.id, id))
    .returning({ id: checks.id });
  return rows.length > 0 ? { ok: true } : { ok: false, error: "No such check." };
}

/** Runs one check immediately, ignoring its schedule. */
export async function runCheckNow(
  id: number,
): Promise<{ ok: boolean; error?: string; detail?: string; status?: CheckStatus }> {
  await ensureSchema();
  const db = getDb();
  const [check] = await db.select().from(checks).where(eq(checks.id, id)).limit(1);
  if (!check) return { ok: false, error: "No such check." };

  const now = new Date();
  const result = await runProbe(check);
  const consecutiveFailures = statusIsUp(result.status)
    ? 0
    : check.consecutiveFailures + 1;

  // A manual probe records state and history but never alerts: the operator is
  // already looking at the result, and a "run now" that pages the whole team
  // is a button nobody presses twice.
  await writeResult(check, result, consecutiveFailures, check.suppressedBy as SuppressionReason, "none", now);

  return { ok: result.ok, detail: result.detail, status: result.status };
}

// ---------------------------------------------------------------------------
// Maintenance windows
// ---------------------------------------------------------------------------

export interface MaintenanceRow {
  id: number;
  name: string;
  scope: string;
  hostId: number | null;
  hostname: string | null;
  checkId: number | null;
  checkName: string | null;
  startsAt: string;
  endsAt: string;
  active: boolean;
  createdBy: string | null;
}

export async function listMaintenanceWindows(): Promise<MaintenanceRow[]> {
  await ensureSchema();
  const now = Date.now();

  const { rows } = await getDb().execute<{
    id: number;
    name: string;
    scope: string;
    host_id: number | null;
    hostname: string | null;
    check_id: number | null;
    check_name: string | null;
    starts_at: Date;
    ends_at: Date;
    created_by: string | null;
  }>(sql`
    select m.id, m.name, m.scope, m.host_id, h.hostname,
           m.check_id, c.name as check_name,
           m.starts_at, m.ends_at, m.created_by
    from maintenance_windows m
    left join hosts h on h.id = m.host_id
    left join checks c on c.id = m.check_id
    -- Expired windows are history nobody acts on; one week is enough to answer
    -- "was that outage during the deploy?"
    where m.ends_at > now() - interval '7 days'
    order by m.starts_at desc
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    scope: r.scope,
    hostId: r.host_id,
    hostname: r.hostname,
    checkId: r.check_id,
    checkName: r.check_name,
    startsAt: new Date(r.starts_at).toISOString(),
    endsAt: new Date(r.ends_at).toISOString(),
    active:
      new Date(r.starts_at).getTime() <= now && now < new Date(r.ends_at).getTime(),
    createdBy: r.created_by,
  }));
}

export async function createMaintenanceWindow(input: {
  name: string;
  scope: string;
  hostId: number | null;
  checkId: number | null;
  startsAt: Date;
  endsAt: Date;
  createdBy: string;
}): Promise<{ ok: boolean; error?: string }> {
  const error = validateMaintenanceWindow(input);
  if (error) return { ok: false, error };

  if (input.scope === "host" && input.hostId === null) {
    return { ok: false, error: "Choose the host this window covers." };
  }
  if (input.scope === "check" && input.checkId === null) {
    return { ok: false, error: "Choose the check this window covers." };
  }

  await ensureSchema();
  await getDb()
    .insert(maintenanceWindows)
    .values({
      name: input.name.trim(),
      scope: input.scope,
      // Null out the id the scope does not use, so a later scope change cannot
      // resurrect a stale target.
      hostId: input.scope === "host" ? input.hostId : null,
      checkId: input.scope === "check" ? input.checkId : null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdBy: input.createdBy,
    });
  return { ok: true };
}

export async function deleteMaintenanceWindow(
  id: number,
): Promise<{ ok: boolean; error?: string }> {
  await ensureSchema();
  const rows = await getDb()
    .delete(maintenanceWindows)
    .where(eq(maintenanceWindows.id, id))
    .returning({ id: maintenanceWindows.id });
  return rows.length > 0 ? { ok: true } : { ok: false, error: "No such window." };
}

/** Fleet-wide tally for the overview header. */
export async function checkSummary(): Promise<{
  total: number;
  failing: number;
  degraded: number;
  suppressed: number;
  breachingSlo: number;
}> {
  await ensureSchema();
  // One pass, including the SLO tally: this runs on the fleet overview, and
  // reusing listChecks here would make the home page pay for every check's
  // percentiles to render a single number. The 30-day expression is rounded
  // exactly as listChecks rounds it, so a check cannot read as breaching in
  // one place and healthy in the other.
  const { rows } = await getDb().execute<{
    total: string | number;
    failing: string | number;
    degraded: string | number;
    suppressed: string | number;
    breaching_slo: string | number;
  }>(sql`
    select count(*) as total,
           count(*) filter (
             where c.enabled and coalesce(c.last_status, case when c.last_ok then 'ok' else 'down' end) = 'down'
           ) as failing,
           count(*) filter (where c.enabled and c.last_status = 'degraded') as degraded,
           count(*) filter (where c.enabled and c.suppressed_by is not null) as suppressed,
           count(*) filter (
             where c.slo_target is not null
               and s.total > 0
               and round((s.up::numeric / s.total) * 1000) / 10 < c.slo_target
           ) as breaching_slo
    from checks c
    left join lateral (
      select count(*) as total,
             count(*) filter (
               where coalesce(r.status, case when r.ok then 'ok' else 'down' end) <> 'down'
             ) as up
      from check_results r
      where r.check_id = c.id and r.ran_at >= now() - interval '30 days'
    ) s on true
  `);
  const r = rows[0];

  return {
    total: Number(r?.total ?? 0),
    failing: Number(r?.failing ?? 0),
    degraded: Number(r?.degraded ?? 0),
    suppressed: Number(r?.suppressed ?? 0),
    breachingSlo: Number(r?.breaching_slo ?? 0),
  };
}
