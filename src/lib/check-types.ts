/**
 * Check definitions and the pure logic behind them.
 *
 * Deliberately free of node:net / node:tls / node:dns / database imports so the
 * parts that decide "is this up?", "does the body say what it should?", "is
 * this alert worth sending?" and "are we inside our error budget?" can be
 * tested without opening a socket — and so the settings UI (a client component)
 * can import the labels without dragging the runner into the browser bundle.
 */

export type CheckType = "tcp" | "http" | "tls" | "dns" | "ping";

export const CHECK_TYPES: readonly CheckType[] = ["tcp", "http", "tls", "dns", "ping"];

export const CHECK_LABELS: Record<CheckType, string> = {
  tcp: "TCP port",
  http: "HTTP(S)",
  tls: "TLS certificate",
  dns: "DNS record",
  ping: "ICMP ping",
};

export const CHECK_TARGET_HINTS: Record<CheckType, string> = {
  tcp: "db.internal:5432",
  http: "https://example.com/health",
  tls: "example.com:443",
  dns: "A:example.com",
  ping: "192.0.2.10",
};

export const CHECK_DESCRIPTIONS: Record<CheckType, string> = {
  tcp: "Opens a TCP connection. Proves the port is accepting connections.",
  http: "Sends a GET and checks the status, body and response time.",
  tls: "Reads the certificate and warns before it expires.",
  dns: "Resolves a record and can assert what it resolves to.",
  ping: "Sends ICMP echoes and reports packet loss and round-trip time.",
};

/** Certificates inside this many days raise a warning. */
export const CERT_WARN_DAYS = 21;

/** Certificates inside this many days are critical. */
export const CERT_CRITICAL_DAYS = 7;

/**
 * Consecutive failures before a check is declared down.
 *
 * One failed probe is not an outage — a dropped packet or a momentary restart
 * would page someone every time. Two in a row is a signal.
 */
export const FAILURES_BEFORE_ALERT = 2;

export function isCheckType(value: string): value is CheckType {
  return (CHECK_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Three states, not two.
 *
 * A binary up/down hides the most actionable case in monitoring: the endpoint
 * that still answers but has quietly gone from 80ms to 4s. "degraded" is a
 * first-class result so that slide is visible before it becomes an outage.
 */
export type CheckStatus = "ok" | "degraded" | "down";

export const STATUS_LABELS: Record<CheckStatus, string> = {
  ok: "passing",
  degraded: "degraded",
  down: "failing",
};

/** A status counts as a pass for availability arithmetic if it is not down. */
export function statusIsUp(status: CheckStatus): boolean {
  return status !== "down";
}

/** Worst of the two, for combining independent verdicts within one probe. */
export function worstStatus(a: CheckStatus, b: CheckStatus): CheckStatus {
  const rank: Record<CheckStatus, number> = { ok: 0, degraded: 1, down: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Applies the response-time threshold.
 *
 * Only ever downgrades ok -> degraded: a check that already failed is not made
 * better by being fast about it.
 */
export function applyLatencyThreshold(
  status: CheckStatus,
  latencyMs: number | null,
  degradedAboveMs: number | null,
): CheckStatus {
  if (status !== "ok") return status;
  if (latencyMs === null || degradedAboveMs === null || degradedAboveMs <= 0) return status;
  return latencyMs > degradedAboveMs ? "degraded" : "ok";
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export interface ParsedTarget {
  host: string;
  port: number;
}

/**
 * Splits `host:port` for tcp/tls checks.
 *
 * Returns null rather than guessing: a malformed target should be rejected at
 * creation time, not silently probed against port NaN.
 */
export function parseHostPort(target: string, defaultPort?: number): ParsedTarget | null {
  const trimmed = target.trim();
  if (!trimmed) return null;

  // Bracketed IPv6, e.g. [2001:db8::1]:443
  const v6 = /^\[([^\]]+)\]:(\d+)$/.exec(trimmed);
  if (v6) {
    const port = Number(v6[2]);
    return isValidPort(port) ? { host: v6[1], port } : null;
  }

  const idx = trimmed.lastIndexOf(":");
  if (idx === -1) {
    if (defaultPort === undefined) return null;
    return isValidHostname(trimmed) ? { host: trimmed, port: defaultPort } : null;
  }

  const host = trimmed.slice(0, idx);
  const port = Number(trimmed.slice(idx + 1));
  if (!isValidHostname(host) || !isValidPort(port)) return null;
  return { host, port };
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function isValidHostname(host: string): boolean {
  if (!host || host.length > 253) return false;
  // Hostnames, IPv4, or bare IPv6 (already unwrapped from brackets above).
  return /^[A-Za-z0-9._:-]+$/.test(host);
}

/** Record types a DNS check can ask for. */
export const DNS_RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

export interface ParsedDnsTarget {
  record: DnsRecordType;
  hostname: string;
}

/**
 * Parses `A:example.com`, or a bare `example.com` (defaults to A).
 *
 * The record type rides in the target rather than getting its own column: it
 * is part of *what* is being asked, and keeping it here means a DNS check is
 * still one string an operator can read at a glance.
 */
export function parseDnsTarget(target: string): ParsedDnsTarget | null {
  const trimmed = target.trim();
  if (!trimmed) return null;

  const idx = trimmed.indexOf(":");
  if (idx === -1) {
    return isValidHostname(trimmed) ? { record: "A", hostname: trimmed } : null;
  }

  const record = trimmed.slice(0, idx).toUpperCase();
  const hostname = trimmed.slice(idx + 1).trim();
  if (!(DNS_RECORD_TYPES as readonly string[]).includes(record)) return null;
  if (!isValidHostname(hostname)) return null;
  return { record: record as DnsRecordType, hostname };
}

/** Validates a target for the chosen type. Returns an error message or null. */
export function validateCheckTarget(type: CheckType, target: string): string | null {
  const trimmed = target.trim();
  if (!trimmed) return "A target is required.";

  if (type === "http") {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return "Enter a full URL, including http:// or https://.";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Only http and https URLs can be checked.";
    }
    return null;
  }

  if (type === "dns") {
    return parseDnsTarget(trimmed)
      ? null
      : `Enter hostname or RECORD:hostname (${DNS_RECORD_TYPES.join(", ")}).`;
  }

  if (type === "ping") {
    return isValidHostname(trimmed) ? null : "Enter a hostname or IP address.";
  }

  // tls defaults to 443; tcp requires an explicit port because there is no
  // sensible default for "some service".
  const parsed = parseHostPort(trimmed, type === "tls" ? 443 : undefined);
  if (!parsed) {
    return type === "tls"
      ? "Enter host or host:port (port defaults to 443)."
      : "Enter host:port, for example db.internal:5432.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Error messages
// ---------------------------------------------------------------------------

/**
 * TLS failures worth naming, with the fix rather than the symptom.
 *
 * These are the errors where the raw code sends people hunting for a network
 * problem that does not exist: the service is answering perfectly well, it is
 * the certificate that cannot be verified.
 */
const TLS_ERROR_HINTS: Record<string, string> = {
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:
    "TLS certificate could not be verified (incomplete chain, or a private CA)",
  SELF_SIGNED_CERT_IN_CHAIN: "TLS certificate is signed by an untrusted CA",
  DEPTH_ZERO_SELF_SIGNED_CERT: "TLS certificate is self-signed",
  ERR_TLS_CERT_ALTNAME_INVALID:
    "TLS certificate does not cover this hostname or IP",
  CERT_HAS_EXPIRED: "TLS certificate has expired",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY:
    "TLS certificate issuer is not trusted by this server",
};

/** Connection failures whose bare code means little to a reader. */
const NETWORK_ERROR_HINTS: Record<string, string> = {
  ECONNREFUSED: "connection refused",
  ENOTFOUND: "hostname does not resolve",
  EHOSTUNREACH: "host unreachable",
  ENETUNREACH: "network unreachable",
  ECONNRESET: "connection reset by peer",
  EPROTO: "TLS handshake failed (is the port really HTTPS?)",
  ERR_SSL_WRONG_VERSION_NUMBER:
    "not a TLS port (try http:// instead of https://)",
};

/**
 * Turns a thrown fetch error into something an operator can act on.
 *
 * `fetch` rejects with a bare `TypeError: fetch failed` and buries the real
 * reason in `err.cause`, sometimes nested. Reporting the outer message is how
 * a monitoring tool ends up saying nothing at all about an outage, so this
 * walks the chain for the most specific code it can find.
 */
export function describeFetchError(err: unknown): string {
  const chain: { code?: string; message?: string }[] = [];
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: string; message?: string; cause?: unknown };
    chain.push({ code: e.code, message: e.message });
    current = e.cause;
  }

  for (const link of chain) {
    if (!link.code) continue;
    const tls = TLS_ERROR_HINTS[link.code];
    if (tls) return `${tls} — enable "ignore certificate errors" to probe anyway`;
    const net = NETWORK_ERROR_HINTS[link.code];
    if (net) return net;
    // An unrecognised code is still far better than "fetch failed".
    return `${link.code}: ${link.message ?? "request failed"}`;
  }

  // No code anywhere: fall back to the innermost message that says something.
  const useful = chain
    .map((l) => l.message)
    .filter((m): m is string => !!m && m !== "fetch failed");
  return useful[useful.length - 1] ?? "request failed";
}

// ---------------------------------------------------------------------------
// Ping output
// ---------------------------------------------------------------------------

export interface PingSummary {
  transmitted: number;
  received: number;
  lossPct: number;
  avgRttMs: number | null;
}

/**
 * Parses the summary block printed by `ping`.
 *
 * Handles both the Linux ("rtt min/avg/max/mdev") and BSD/macOS ("round-trip
 * min/avg/max/stddev") wordings, because the same binary name prints different
 * text depending on where this is deployed — and a parser that silently
 * returns null on one of them would report every host as unreachable.
 */
export function parsePingOutput(stdout: string): PingSummary | null {
  const counts = /(\d+)\s+packets transmitted,\s*(\d+)\s*(?:packets\s+)?received/i.exec(
    stdout,
  );
  if (!counts) return null;

  const transmitted = Number(counts[1]);
  const received = Number(counts[2]);
  if (!Number.isFinite(transmitted) || transmitted === 0) return null;

  const rtt =
    /(?:rtt|round-trip)\s+min\/avg\/max(?:\/(?:mdev|stddev))?\s*=\s*[\d.]+\/([\d.]+)\//i.exec(
      stdout,
    );

  return {
    transmitted,
    received,
    lossPct: ((transmitted - received) / transmitted) * 100,
    avgRttMs: rtt ? Number(rtt[1]) : null,
  };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * Body assertions.
 *
 * A status code is a weak claim. `200 {"status":"degraded","db":false}` passes
 * every status-only check ever written, which is exactly the outage you most
 * want to catch. These assert on what the endpoint actually said.
 */
export type AssertionKind = "none" | "contains" | "not_contains" | "regex" | "json_path";

export const ASSERTION_KINDS: readonly AssertionKind[] = [
  "none",
  "contains",
  "not_contains",
  "regex",
  "json_path",
];

export const ASSERTION_LABELS: Record<AssertionKind, string> = {
  none: "No body assertion",
  contains: "Body contains",
  not_contains: "Body does not contain",
  regex: "Body matches regex",
  json_path: "JSON field equals",
};

export function isAssertionKind(value: string): value is AssertionKind {
  return (ASSERTION_KINDS as readonly string[]).includes(value);
}

export interface AssertionSpec {
  kind: AssertionKind;
  /** The expected value: substring, regex source, or JSON field value. */
  value: string | null;
  /** Dotted path into the JSON body. Only used by json_path. */
  path: string | null;
}

export interface AssertionResult {
  passed: boolean;
  detail: string;
}

/**
 * Walks a dotted path such as `data.db.healthy` or `services.0.up`.
 *
 * Numeric segments index arrays, so a path can reach into a list without
 * needing a separate syntax for it.
 */
export function readJsonPath(body: unknown, path: string): unknown {
  const segments = path
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
  let current: unknown = body;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(segment);
      if (!Number.isInteger(idx)) return undefined;
      current = current[idx];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Renders a JSON value the way the operator typed it, for comparison. */
function stringifyJsonValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value) ?? "";
}

/** Truncates a body for an alert line without dumping a whole page into Slack. */
export function summariseBody(body: string, max = 120): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max)}…`;
}

/**
 * Evaluates a body assertion. Never throws — a bad regex is a failed
 * assertion with an explanation, not a crashed probe.
 */
export function evaluateAssertion(spec: AssertionSpec, body: string): AssertionResult {
  if (spec.kind === "none") return { passed: true, detail: "" };

  const expected = spec.value ?? "";
  if (!expected && spec.kind !== "json_path") {
    return { passed: true, detail: "" };
  }

  switch (spec.kind) {
    case "contains":
      return body.includes(expected)
        ? { passed: true, detail: `body contains "${expected}"` }
        : { passed: false, detail: `body does not contain "${expected}"` };

    case "not_contains":
      return body.includes(expected)
        ? { passed: false, detail: `body contains forbidden "${expected}"` }
        : { passed: true, detail: `body free of "${expected}"` };

    case "regex": {
      let re: RegExp;
      try {
        re = new RegExp(expected);
      } catch (err) {
        return { passed: false, detail: `invalid regex: ${(err as Error).message}` };
      }
      return re.test(body)
        ? { passed: true, detail: `body matches /${expected}/` }
        : { passed: false, detail: `body does not match /${expected}/` };
    }

    case "json_path": {
      const path = spec.path?.trim();
      if (!path) return { passed: false, detail: "no JSON path configured" };

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return { passed: false, detail: `body is not JSON (${summariseBody(body, 60)})` };
      }

      const actual = readJsonPath(parsed, path);
      if (actual === undefined) {
        return { passed: false, detail: `${path} missing from response` };
      }
      const rendered = stringifyJsonValue(actual);
      return rendered === expected
        ? { passed: true, detail: `${path} = ${rendered}` }
        : { passed: false, detail: `${path} = ${rendered}, expected ${expected}` };
    }
  }
}

/** Validates an assertion at creation time. Returns an error message or null. */
export function validateAssertion(spec: AssertionSpec): string | null {
  if (spec.kind === "none") return null;

  const value = spec.value?.trim() ?? "";
  if (!value) return "Enter the value to assert on.";

  if (spec.kind === "regex") {
    try {
      new RegExp(value);
    } catch (err) {
      return `Invalid regex: ${(err as Error).message}`;
    }
  }
  if (spec.kind === "json_path" && !spec.path?.trim()) {
    return "Enter the JSON path, for example status or data.db.healthy.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Retries
// ---------------------------------------------------------------------------

/** Attempts within a single run, including the first. */
export const MAX_ATTEMPTS = 4;

/**
 * Backoff before attempt `n` (1-indexed; attempt 1 never waits).
 *
 * Retrying inside one run matters because the alternative is waiting a whole
 * interval to disambiguate a dropped packet from an outage — at a 5-minute
 * interval that is a 10-minute detection floor. Three quick retries settle it
 * in seconds while still refusing to alert on a single blip.
 */
export function retryDelayMs(attempt: number): number {
  if (attempt <= 1) return 0;
  return Math.min(250 * 2 ** (attempt - 2), 2_000);
}

export function clampAttempts(attempts: number): number {
  if (!Number.isFinite(attempts)) return 1;
  return Math.min(Math.max(Math.trunc(attempts), 1), MAX_ATTEMPTS);
}

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

/** Whole days from `now` until `expiresAt`; negative once expired. */
export function certDaysRemaining(expiresAt: Date, now: Date = new Date()): number {
  return Math.floor((expiresAt.getTime() - now.getTime()) / 86_400_000);
}

export type CertUrgency = "ok" | "warning" | "critical" | "expired";

export function certUrgency(daysRemaining: number): CertUrgency {
  if (daysRemaining < 0) return "expired";
  if (daysRemaining <= CERT_CRITICAL_DAYS) return "critical";
  if (daysRemaining <= CERT_WARN_DAYS) return "warning";
  return "ok";
}

/**
 * Decides whether an HTTP response counts as healthy.
 *
 * With no expected status, any 2xx or 3xx passes — a redirect to a login page
 * still proves the server is serving. An explicit status must match exactly,
 * which is how you assert "this endpoint returns 200, not a redirect".
 */
export function httpStatusOk(status: number, expected?: number | null): boolean {
  if (expected !== null && expected !== undefined) return status === expected;
  return status >= 200 && status < 400;
}

// ---------------------------------------------------------------------------
// Maintenance windows
// ---------------------------------------------------------------------------

/**
 * A planned silence.
 *
 * Scope is deliberately explicit rather than inferred from which ids are set:
 * "this window covers everything" and "this window covers the one check whose
 * id I forgot to fill in" must not be the same row.
 */
export type MaintenanceScope = "fleet" | "host" | "check";

export const MAINTENANCE_SCOPES: readonly MaintenanceScope[] = ["fleet", "host", "check"];

export const MAINTENANCE_SCOPE_LABELS: Record<MaintenanceScope, string> = {
  fleet: "Whole fleet",
  host: "One host",
  check: "One check",
};

export interface MaintenanceWindow {
  id: number;
  name: string;
  scope: MaintenanceScope;
  hostId: number | null;
  checkId: number | null;
  startsAt: Date;
  endsAt: Date;
}

export function isMaintenanceScope(value: string): value is MaintenanceScope {
  return (MAINTENANCE_SCOPES as readonly string[]).includes(value);
}

export function windowIsActive(w: MaintenanceWindow, now: Date): boolean {
  return w.startsAt.getTime() <= now.getTime() && now.getTime() < w.endsAt.getTime();
}

/**
 * Finds the active window covering a check, if any.
 *
 * Returns the window rather than a boolean so the suppression reason can name
 * it — "suppressed by maintenance" is far less useful than the name of the
 * window doing the suppressing.
 */
export function findMaintenanceWindow(
  windows: readonly MaintenanceWindow[],
  target: { checkId: number; hostId: number | null },
  now: Date,
): MaintenanceWindow | null {
  for (const w of windows) {
    if (!windowIsActive(w, now)) continue;
    if (w.scope === "fleet") return w;
    if (w.scope === "check" && w.checkId === target.checkId) return w;
    if (w.scope === "host" && target.hostId !== null && w.hostId === target.hostId) {
      return w;
    }
  }
  return null;
}

export function validateMaintenanceWindow(input: {
  name: string;
  scope: string;
  startsAt: Date;
  endsAt: Date;
}): string | null {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 64) return "Name must be 1–64 characters.";
  if (!isMaintenanceScope(input.scope)) return "Unknown scope.";
  if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.endsAt.getTime())) {
    return "Enter valid start and end times.";
  }
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    return "The window must end after it starts.";
  }
  // A month-long "maintenance window" is an outage nobody is looking at.
  if (input.endsAt.getTime() - input.startsAt.getTime() > 30 * 86_400_000) {
    return "A window cannot be longer than 30 days.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Flap detection
// ---------------------------------------------------------------------------

/** Transitions within the sample window above which a check is "flapping". */
export const FLAP_TRANSITION_THRESHOLD = 5;

/** How many recent results the flap detector looks at. */
export const FLAP_SAMPLE_SIZE = 10;

/**
 * Counts up/down transitions in a run of results.
 *
 * A check that alternates pass/fail every interval is not reporting an outage,
 * it is reporting an unstable target or an unstable probe. Either way, sending
 * one alert per transition is noise — the useful signal is "this is flapping",
 * once.
 */
export function countTransitions(statuses: readonly CheckStatus[]): number {
  let transitions = 0;
  for (let i = 1; i < statuses.length; i++) {
    if (statusIsUp(statuses[i]) !== statusIsUp(statuses[i - 1])) transitions++;
  }
  return transitions;
}

export function isFlapping(
  statuses: readonly CheckStatus[],
  threshold = FLAP_TRANSITION_THRESHOLD,
): boolean {
  const sample = statuses.slice(-FLAP_SAMPLE_SIZE);
  return countTransitions(sample) >= threshold;
}

// ---------------------------------------------------------------------------
// Alert decision
// ---------------------------------------------------------------------------

/** Why an alert was not sent. Surfaced in the UI so silence is explainable. */
export type SuppressionReason = "maintenance" | "dependency" | "flapping" | null;

export const SUPPRESSION_LABELS: Record<
  Exclude<SuppressionReason, null>,
  string
> = {
  maintenance: "in maintenance",
  dependency: "upstream down",
  flapping: "flapping",
};

export interface AlertContext {
  status: CheckStatus;
  consecutiveFailures: number;
  alertedDown: boolean;
  alertedDegraded: boolean;
  suppressedBy: SuppressionReason;
}

export type AlertAction = "none" | "down" | "degraded" | "recovery";

/**
 * The single place that decides whether a run produces an alert.
 *
 * Pulling this out of the runner is what makes alert behaviour testable: every
 * combination of state, latch and suppression is a table row rather than a
 * live outage someone has to reproduce.
 *
 * Recovery is exempt from suppression on purpose. Telling someone an alert
 * they already received is over is never noise, and swallowing it would leave
 * a latch set and a permanent red pill in the UI.
 */
export function decideAlert(ctx: AlertContext): AlertAction {
  const wasAlerting = ctx.alertedDown || ctx.alertedDegraded;

  if (ctx.status === "ok") return wasAlerting ? "recovery" : "none";
  if (ctx.suppressedBy !== null) return "none";

  if (ctx.status === "down") {
    return !ctx.alertedDown && ctx.consecutiveFailures >= FAILURES_BEFORE_ALERT
      ? "down"
      : "none";
  }

  // Degraded. Never fires while a down alert is outstanding: recovering from
  // "down" to merely "slow" is an improvement, and paging about it reads as a
  // second, unrelated incident.
  return !ctx.alertedDegraded && !ctx.alertedDown ? "degraded" : "none";
}

/**
 * Whether this run should raise a "down" alert.
 *
 * Only on the transition into failure, and only once the failure has repeated,
 * so a flapping endpoint does not send a message every interval.
 */
export function shouldAlertDown(
  consecutiveFailures: number,
  alreadyAlerted: boolean,
): boolean {
  return !alreadyAlerted && consecutiveFailures >= FAILURES_BEFORE_ALERT;
}

/** Whether this run should raise a recovery alert. */
export function shouldAlertRecovery(ok: boolean, alreadyAlerted: boolean): boolean {
  return ok && alreadyAlerted;
}

/** True when a check is due to run again. */
export function isDue(
  lastRunAt: Date | null,
  intervalSeconds: number,
  now: Date = new Date(),
): boolean {
  if (!lastRunAt) return true;
  return now.getTime() - lastRunAt.getTime() >= intervalSeconds * 1000;
}

// ---------------------------------------------------------------------------
// Analytics and SLOs
// ---------------------------------------------------------------------------

/**
 * Nearest-rank percentile over an unsorted sample.
 *
 * Nearest-rank rather than interpolation: every value returned is a latency
 * that actually happened, which is the right property for a number an operator
 * will quote back at a vendor.
 */
export function percentile(values: readonly number[], p: number): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  if (p <= 0) return clean[0];
  if (p >= 100) return clean[clean.length - 1];

  const rank = Math.ceil((p / 100) * clean.length);
  return clean[Math.min(rank, clean.length) - 1];
}

export interface LatencyStats {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  min: number | null;
  max: number | null;
  samples: number;
}

export const EMPTY_LATENCY_STATS: LatencyStats = {
  p50: null,
  p95: null,
  p99: null,
  min: null,
  max: null,
  samples: 0,
};

export function latencyStats(values: readonly number[]): LatencyStats {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return EMPTY_LATENCY_STATS;
  return {
    p50: percentile(clean, 50),
    p95: percentile(clean, 95),
    p99: percentile(clean, 99),
    min: Math.min(...clean),
    max: Math.max(...clean),
    samples: clean.length,
  };
}

export interface ErrorBudget {
  /** Target availability, e.g. 99.9. */
  target: number;
  /** Achieved availability over the window. */
  actual: number;
  /** Fraction of the budget spent, 0–1+. Above 1 means the target is missed. */
  consumed: number;
  /** Downtime still affordable in this window, in minutes. Negative if over. */
  remainingMinutes: number;
  breached: boolean;
}

/**
 * Error budget against an availability target over a window.
 *
 * Expressed in minutes because that is the unit an on-call engineer reasons
 * in: "we have 4 minutes left this month" lands in a way "0.0093% remaining"
 * does not.
 */
export function errorBudget(
  actualPct: number,
  targetPct: number,
  windowMinutes: number,
): ErrorBudget {
  const allowedFailureFraction = Math.max(0, (100 - targetPct) / 100);
  const actualFailureFraction = Math.max(0, (100 - actualPct) / 100);

  const budgetMinutes = allowedFailureFraction * windowMinutes;
  const spentMinutes = actualFailureFraction * windowMinutes;

  // A 100% target has no budget to consume; any failure at all breaches it.
  const consumed =
    budgetMinutes === 0
      ? actualFailureFraction > 0
        ? Number.POSITIVE_INFINITY
        : 0
      : spentMinutes / budgetMinutes;

  return {
    target: targetPct,
    actual: actualPct,
    consumed,
    remainingMinutes: budgetMinutes - spentMinutes,
    breached: actualPct < targetPct,
  };
}

export function validateSloTarget(target: number | null): string | null {
  if (target === null) return null;
  if (!Number.isFinite(target)) return "Enter a number, for example 99.9.";
  // Below 50 the target says nothing; 100 leaves no budget and always breaches.
  if (target < 50 || target >= 100) return "Target must be between 50 and 99.999.";
  return null;
}

/** A stretch of consecutive failing results, derived from history. */
export interface Incident {
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  worst: CheckStatus;
  detail: string | null;
}

/**
 * Collapses a result series into incidents.
 *
 * Derived from `check_results` rather than stored in its own table: the
 * results are already the source of truth, and a second table would drift the
 * first time a probe wrote one row and failed before writing the other.
 * Expects results oldest-first; returns newest-first.
 */
export function deriveIncidents(
  results: readonly { ranAt: string; status: CheckStatus; detail: string | null }[],
): Incident[] {
  const incidents: Incident[] = [];
  let open: { startedAt: string; worst: CheckStatus; detail: string | null } | null = null;

  for (const r of results) {
    if (!statusIsUp(r.status)) {
      if (!open) {
        open = { startedAt: r.ranAt, worst: r.status, detail: r.detail };
      } else {
        open.worst = worstStatus(open.worst, r.status);
      }
      continue;
    }
    if (open) {
      incidents.push(closeIncident(open, r.ranAt));
      open = null;
    }
  }

  // Still failing at the end of the series: an open incident, not a closed one.
  if (open) {
    incidents.push({
      startedAt: open.startedAt,
      endedAt: null,
      durationMinutes: null,
      worst: open.worst,
      detail: open.detail,
    });
  }

  return incidents.reverse();
}

function closeIncident(
  open: { startedAt: string; worst: CheckStatus; detail: string | null },
  endedAt: string,
): Incident {
  const ms = new Date(endedAt).getTime() - new Date(open.startedAt).getTime();
  return {
    startedAt: open.startedAt,
    endedAt,
    durationMinutes: Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60_000)) : null,
    worst: open.worst,
    detail: open.detail,
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Availability over a named window. */
export interface UptimeWindow {
  uptimePct: number | null;
  samples: number;
}

export const EMPTY_UPTIME_WINDOW: UptimeWindow = { uptimePct: null, samples: 0 };

/** One row of the checks UI. */
export interface CheckRow {
  id: number;
  hostId: number | null;
  hostname: string | null;
  name: string;
  type: CheckType;
  target: string;
  expectedStatus: number | null;
  assertionKind: AssertionKind;
  assertionValue: string | null;
  assertionPath: string | null;
  degradedAboveMs: number | null;
  attempts: number;
  insecureTls: boolean;
  dependsOnCheckId: number | null;
  dependsOnName: string | null;
  sloTarget: number | null;
  alertChannelId: number | null;
  alertChannelName: string | null;
  intervalSeconds: number;
  timeoutMs: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: CheckStatus | null;
  lastOk: boolean | null;
  lastLatencyMs: number | null;
  lastDetail: string | null;
  suppressedBy: SuppressionReason;
  certExpiresAt: string | null;
  certDaysRemaining: number | null;
  consecutiveFailures: number;
  /** Availability over the retained history, 0–100, or null with no history. */
  uptimePct: number | null;
  uptime24h: UptimeWindow;
  uptime7d: UptimeWindow;
  uptime30d: UptimeWindow;
  latency24h: LatencyStats;
  budget: ErrorBudget | null;
}
