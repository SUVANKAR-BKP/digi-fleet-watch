import { describe, expect, it } from "vitest";
import {
  CERT_CRITICAL_DAYS,
  CERT_WARN_DAYS,
  FAILURES_BEFORE_ALERT,
  FLAP_TRANSITION_THRESHOLD,
  MAX_ATTEMPTS,
  applyLatencyThreshold,
  certDaysRemaining,
  certUrgency,
  clampAttempts,
  countTransitions,
  decideAlert,
  deriveIncidents,
  errorBudget,
  evaluateAssertion,
  findMaintenanceWindow,
  httpStatusOk,
  isCheckType,
  isDue,
  isFlapping,
  latencyStats,
  parseDnsTarget,
  parseHostPort,
  parsePingOutput,
  percentile,
  readJsonPath,
  retryDelayMs,
  shouldAlertDown,
  shouldAlertRecovery,
  validateAssertion,
  validateCheckTarget,
  validateMaintenanceWindow,
  validateSloTarget,
  worstStatus,
  type AlertContext,
  type CheckStatus,
  type MaintenanceWindow,
} from "./check-types";

describe("parseHostPort", () => {
  it("splits host and port", () => {
    expect(parseHostPort("db.internal:5432")).toEqual({
      host: "db.internal",
      port: 5432,
    });
  });

  it("applies a default port when one is allowed", () => {
    expect(parseHostPort("example.com", 443)).toEqual({ host: "example.com", port: 443 });
  });

  it("refuses a bare host when no default is given", () => {
    // A TCP check has no sensible default — guessing would probe the wrong
    // service and report it healthy.
    expect(parseHostPort("example.com")).toBeNull();
  });

  it("handles bracketed IPv6", () => {
    expect(parseHostPort("[2001:db8::1]:443")).toEqual({
      host: "2001:db8::1",
      port: 443,
    });
  });

  it("rejects out-of-range and non-numeric ports", () => {
    for (const bad of ["h:0", "h:65536", "h:-1", "h:abc", "h:", "h:1.5"]) {
      expect(parseHostPort(bad)).toBeNull();
    }
  });

  it("rejects empty and malformed targets", () => {
    for (const bad of ["", "   ", ":443", "a b:80"]) {
      expect(parseHostPort(bad, 443)).toBeNull();
    }
  });
});

describe("validateCheckTarget", () => {
  it("accepts good targets per type", () => {
    expect(validateCheckTarget("http", "https://example.com/health")).toBeNull();
    expect(validateCheckTarget("tcp", "db.internal:5432")).toBeNull();
    expect(validateCheckTarget("tls", "example.com")).toBeNull();
    expect(validateCheckTarget("tls", "example.com:8443")).toBeNull();
  });

  it("requires a scheme for HTTP checks", () => {
    expect(validateCheckTarget("http", "example.com")).toMatch(/full URL/);
  });

  it("rejects non-http schemes", () => {
    expect(validateCheckTarget("http", "ftp://example.com")).toMatch(/http and https/);
    expect(validateCheckTarget("http", "file:///etc/passwd")).toMatch(/http and https/);
  });

  it("requires an explicit port for TCP", () => {
    expect(validateCheckTarget("tcp", "db.internal")).toMatch(/host:port/);
  });

  it("rejects an empty target", () => {
    expect(validateCheckTarget("tcp", "  ")).toMatch(/required/);
  });
});

describe("httpStatusOk", () => {
  it("accepts 2xx and 3xx when nothing specific is expected", () => {
    // A redirect to a login page still proves the server is serving.
    for (const s of [200, 201, 204, 301, 302, 399]) {
      expect(httpStatusOk(s, null)).toBe(true);
    }
  });

  it("rejects 4xx and 5xx by default", () => {
    for (const s of [400, 401, 404, 500, 502, 503]) {
      expect(httpStatusOk(s, null)).toBe(false);
    }
  });

  it("matches exactly when a status is specified", () => {
    // This is how you assert "200, not a redirect".
    expect(httpStatusOk(200, 200)).toBe(true);
    expect(httpStatusOk(301, 200)).toBe(false);
    expect(httpStatusOk(404, 404)).toBe(true);
  });

  it("treats undefined like null", () => {
    expect(httpStatusOk(200, undefined)).toBe(true);
  });
});

describe("certDaysRemaining / certUrgency", () => {
  const NOW = new Date("2026-09-01T12:00:00Z");
  const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

  it("counts whole days remaining", () => {
    expect(certDaysRemaining(inDays(30), NOW)).toBe(30);
    expect(certDaysRemaining(inDays(0.5), NOW)).toBe(0);
  });

  it("goes negative once expired", () => {
    expect(certDaysRemaining(inDays(-3), NOW)).toBe(-3);
  });

  it("bands by urgency", () => {
    expect(certUrgency(90)).toBe("ok");
    expect(certUrgency(CERT_WARN_DAYS + 1)).toBe("ok");
    expect(certUrgency(CERT_WARN_DAYS)).toBe("warning");
    expect(certUrgency(CERT_CRITICAL_DAYS + 1)).toBe("warning");
    expect(certUrgency(CERT_CRITICAL_DAYS)).toBe("critical");
    expect(certUrgency(0)).toBe("critical");
    expect(certUrgency(-1)).toBe("expired");
  });
});

describe("alert transitions", () => {
  it("does not alert on a single failure", () => {
    // One dropped packet is not an outage.
    expect(shouldAlertDown(1, false)).toBe(false);
  });

  it("alerts once the failure repeats", () => {
    expect(shouldAlertDown(FAILURES_BEFORE_ALERT, false)).toBe(true);
  });

  it("does not alert again while already down", () => {
    // Otherwise a check failing every 5 minutes pages every 5 minutes.
    expect(shouldAlertDown(10, true)).toBe(false);
  });

  it("alerts on recovery only if it had alerted going down", () => {
    expect(shouldAlertRecovery(true, true)).toBe(true);
    expect(shouldAlertRecovery(true, false)).toBe(false);
    expect(shouldAlertRecovery(false, true)).toBe(false);
  });
});

describe("isDue", () => {
  const NOW = new Date("2026-09-01T12:00:00Z");

  it("runs a check that has never run", () => {
    expect(isDue(null, 300, NOW)).toBe(true);
  });

  it("waits for the interval to elapse", () => {
    expect(isDue(new Date(NOW.getTime() - 299_000), 300, NOW)).toBe(false);
    expect(isDue(new Date(NOW.getTime() - 300_000), 300, NOW)).toBe(true);
  });
});

describe("isCheckType", () => {
  it("accepts known types and rejects anything else", () => {
    for (const good of ["tcp", "http", "tls", "dns", "ping"]) {
      expect(isCheckType(good)).toBe(true);
    }
    for (const bad of ["", "TCP", "icmp", "udp", "smtp"]) {
      expect(isCheckType(bad)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// DNS and ping targets
// ---------------------------------------------------------------------------

describe("parseDnsTarget", () => {
  it("defaults a bare hostname to an A record", () => {
    expect(parseDnsTarget("example.com")).toEqual({ record: "A", hostname: "example.com" });
  });

  it("reads an explicit record type, case-insensitively", () => {
    expect(parseDnsTarget("cname:www.example.com")).toEqual({
      record: "CNAME",
      hostname: "www.example.com",
    });
    expect(parseDnsTarget("MX:example.com")).toEqual({
      record: "MX",
      hostname: "example.com",
    });
  });

  it("rejects unknown record types rather than guessing A", () => {
    // Silently treating SRV:host as an A lookup would report a healthy record
    // that was never actually asked for.
    expect(parseDnsTarget("SRV:example.com")).toBeNull();
    expect(parseDnsTarget("A:")).toBeNull();
    expect(parseDnsTarget("")).toBeNull();
  });
});

describe("validateCheckTarget for the new types", () => {
  it("accepts DNS and ping targets", () => {
    expect(validateCheckTarget("dns", "TXT:example.com")).toBeNull();
    expect(validateCheckTarget("dns", "example.com")).toBeNull();
    expect(validateCheckTarget("ping", "192.0.2.10")).toBeNull();
    expect(validateCheckTarget("ping", "gateway.internal")).toBeNull();
  });

  it("rejects malformed ones with a usable message", () => {
    expect(validateCheckTarget("dns", "SRV:example.com")).toMatch(/RECORD:hostname/);
    expect(validateCheckTarget("ping", "not a host")).toMatch(/hostname or IP/);
  });
});

// ---------------------------------------------------------------------------
// Ping output
// ---------------------------------------------------------------------------

describe("parsePingOutput", () => {
  const LINUX = `PING example.com (93.184.216.34) 56(84) bytes of data.

--- example.com ping statistics ---
4 packets transmitted, 4 received, 0% packet loss, time 3004ms
rtt min/avg/max/mdev = 11.322/12.048/13.101/0.671 ms`;

  const BSD = `PING example.com (93.184.216.34): 56 data bytes

--- example.com ping statistics ---
4 packets transmitted, 3 packets received, 25.0% packet loss
round-trip min/avg/max/stddev = 11.322/12.048/13.101/0.671 ms`;

  it("reads the Linux summary", () => {
    const p = parsePingOutput(LINUX);
    expect(p).not.toBeNull();
    expect(p!.transmitted).toBe(4);
    expect(p!.received).toBe(4);
    expect(p!.lossPct).toBe(0);
    expect(p!.avgRttMs).toBeCloseTo(12.048, 3);
  });

  it("reads the BSD/macOS wording, which differs in both lines", () => {
    // "packets received" and "round-trip" instead of "received" and "rtt".
    const p = parsePingOutput(BSD);
    expect(p).not.toBeNull();
    expect(p!.received).toBe(3);
    expect(p!.lossPct).toBe(25);
    expect(p!.avgRttMs).toBeCloseTo(12.048, 3);
  });

  it("handles total loss, where no rtt line is printed at all", () => {
    const p = parsePingOutput(
      "4 packets transmitted, 0 received, 100% packet loss, time 3070ms",
    );
    expect(p).not.toBeNull();
    expect(p!.received).toBe(0);
    expect(p!.lossPct).toBe(100);
    expect(p!.avgRttMs).toBeNull();
  });

  it("returns null on output it does not recognise", () => {
    // Better to say "could not parse" than to invent a packet count.
    expect(parsePingOutput("ping: unknown host example.invalid")).toBeNull();
    expect(parsePingOutput("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

describe("readJsonPath", () => {
  const body = {
    status: "ok",
    data: { db: { healthy: true }, replicas: 3 },
    services: [{ up: false }, { up: true }],
  };

  it("walks nested objects", () => {
    expect(readJsonPath(body, "data.db.healthy")).toBe(true);
    expect(readJsonPath(body, "data.replicas")).toBe(3);
  });

  it("indexes arrays with numeric segments", () => {
    expect(readJsonPath(body, "services.1.up")).toBe(true);
  });

  it("returns undefined for a path that does not exist", () => {
    expect(readJsonPath(body, "data.cache.healthy")).toBeUndefined();
    expect(readJsonPath(body, "services.9.up")).toBeUndefined();
    // Walking into a scalar is a missing path, not a crash.
    expect(readJsonPath(body, "status.nope")).toBeUndefined();
  });
});

describe("evaluateAssertion", () => {
  const spec = (kind: string, value: string | null, path: string | null = null) =>
    ({ kind, value, path }) as Parameters<typeof evaluateAssertion>[0];

  it("passes everything when no assertion is configured", () => {
    expect(evaluateAssertion(spec("none", null), "anything").passed).toBe(true);
  });

  it("checks substrings both ways", () => {
    expect(evaluateAssertion(spec("contains", "healthy"), "all healthy").passed).toBe(true);
    expect(evaluateAssertion(spec("contains", "healthy"), "all broken").passed).toBe(false);
    expect(evaluateAssertion(spec("not_contains", "ERROR"), "all fine").passed).toBe(true);
    expect(evaluateAssertion(spec("not_contains", "ERROR"), "ERROR: db").passed).toBe(false);
  });

  it("catches the 200-with-a-bad-body case", () => {
    // The whole reason assertions exist: the status code says nothing.
    const result = evaluateAssertion(
      spec("json_path", "ok", "status"),
      JSON.stringify({ status: "degraded" }),
    );
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/status = degraded, expected ok/);
  });

  it("compares JSON booleans and numbers as written", () => {
    const body = JSON.stringify({ data: { db: { healthy: true }, replicas: 3 } });
    expect(evaluateAssertion(spec("json_path", "true", "data.db.healthy"), body).passed).toBe(
      true,
    );
    expect(evaluateAssertion(spec("json_path", "3", "data.replicas"), body).passed).toBe(true);
    expect(evaluateAssertion(spec("json_path", "4", "data.replicas"), body).passed).toBe(false);
  });

  it("fails cleanly when the body is not JSON", () => {
    const result = evaluateAssertion(spec("json_path", "ok", "status"), "<html>502</html>");
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/not JSON/);
  });

  it("reports a missing field rather than treating it as a mismatch", () => {
    const result = evaluateAssertion(
      spec("json_path", "ok", "status"),
      JSON.stringify({ other: 1 }),
    );
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/missing/);
  });

  it("matches regexes and survives an invalid one", () => {
    expect(evaluateAssertion(spec("regex", "v\\d+\\.\\d+"), "build v2.7").passed).toBe(true);
    expect(evaluateAssertion(spec("regex", "v\\d+"), "no version").passed).toBe(false);

    // A bad regex is a failed assertion with an explanation, never a thrown
    // error that would take the whole probe down.
    const bad = evaluateAssertion(spec("regex", "([unclosed"), "anything");
    expect(bad.passed).toBe(false);
    expect(bad.detail).toMatch(/invalid regex/);
  });
});

describe("validateAssertion", () => {
  const spec = (kind: string, value: string | null, path: string | null = null) =>
    ({ kind, value, path }) as Parameters<typeof validateAssertion>[0];

  it("accepts a well-formed assertion", () => {
    expect(validateAssertion(spec("none", null))).toBeNull();
    expect(validateAssertion(spec("contains", "healthy"))).toBeNull();
    expect(validateAssertion(spec("json_path", "ok", "status"))).toBeNull();
  });

  it("requires a value, a path, and a compilable regex", () => {
    expect(validateAssertion(spec("contains", "  "))).toMatch(/value/);
    expect(validateAssertion(spec("json_path", "ok", null))).toMatch(/JSON path/);
    expect(validateAssertion(spec("regex", "([unclosed"))).toMatch(/Invalid regex/);
  });
});

// ---------------------------------------------------------------------------
// Degraded state
// ---------------------------------------------------------------------------

describe("applyLatencyThreshold", () => {
  it("downgrades a slow pass to degraded", () => {
    expect(applyLatencyThreshold("ok", 1200, 1000)).toBe("degraded");
  });

  it("leaves a fast pass alone, including exactly at the threshold", () => {
    expect(applyLatencyThreshold("ok", 999, 1000)).toBe("ok");
    expect(applyLatencyThreshold("ok", 1000, 1000)).toBe("ok");
  });

  it("never upgrades a failure", () => {
    // Being fast about failing does not make a check healthier.
    expect(applyLatencyThreshold("down", 5, 1000)).toBe("down");
  });

  it("is inert with no threshold or no measurement", () => {
    expect(applyLatencyThreshold("ok", 9999, null)).toBe("ok");
    expect(applyLatencyThreshold("ok", null, 100)).toBe("ok");
    expect(applyLatencyThreshold("ok", 9999, 0)).toBe("ok");
  });
});

describe("worstStatus", () => {
  it("takes the worse of two verdicts, in either order", () => {
    expect(worstStatus("ok", "degraded")).toBe("degraded");
    expect(worstStatus("degraded", "ok")).toBe("degraded");
    expect(worstStatus("degraded", "down")).toBe("down");
    expect(worstStatus("ok", "ok")).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// Retries
// ---------------------------------------------------------------------------

describe("retryDelayMs", () => {
  it("does not wait before the first attempt", () => {
    expect(retryDelayMs(1)).toBe(0);
    expect(retryDelayMs(0)).toBe(0);
  });

  it("backs off exponentially and then caps", () => {
    expect(retryDelayMs(2)).toBe(250);
    expect(retryDelayMs(3)).toBe(500);
    expect(retryDelayMs(4)).toBe(1000);
    // Capped, so a retry budget cannot silently become a multi-second stall.
    expect(retryDelayMs(20)).toBe(2000);
  });
});

describe("clampAttempts", () => {
  it("keeps attempts inside a sane range", () => {
    expect(clampAttempts(1)).toBe(1);
    expect(clampAttempts(3)).toBe(3);
    expect(clampAttempts(0)).toBe(1);
    expect(clampAttempts(-5)).toBe(1);
    expect(clampAttempts(99)).toBe(MAX_ATTEMPTS);
    expect(clampAttempts(Number.NaN)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Flap detection
// ---------------------------------------------------------------------------

describe("countTransitions / isFlapping", () => {
  const s = (spec: string): CheckStatus[] =>
    [...spec].map((c) => (c === "u" ? "ok" : c === "d" ? "down" : "degraded"));

  it("counts up/down crossings", () => {
    expect(countTransitions(s("uuuu"))).toBe(0);
    expect(countTransitions(s("uudd"))).toBe(1);
    expect(countTransitions(s("udud"))).toBe(3);
  });

  it("treats degraded as up, because it is still serving", () => {
    expect(countTransitions(s("uxxu"))).toBe(0);
  });

  it("flags an alternating check and leaves a steady outage alone", () => {
    expect(isFlapping(s("ududududud"))).toBe(true);
    // A sustained outage is one incident, not instability — it must still alert.
    expect(isFlapping(s("uudddddddd"))).toBe(false);
  });

  it("only looks at the recent tail", () => {
    // Ancient instability should not keep a now-stable check suppressed.
    expect(isFlapping(s("ududududud" + "uuuuuuuuuu"))).toBe(false);
  });

  it("respects the documented threshold", () => {
    const alternating = s("ud".repeat(10));
    expect(isFlapping(alternating, FLAP_TRANSITION_THRESHOLD)).toBe(true);
    expect(isFlapping(alternating, 99)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Maintenance windows
// ---------------------------------------------------------------------------

describe("findMaintenanceWindow", () => {
  const NOW = new Date("2026-09-01T12:00:00Z");
  const w = (over: Partial<MaintenanceWindow>): MaintenanceWindow => ({
    id: 1,
    name: "deploy",
    scope: "fleet",
    hostId: null,
    checkId: null,
    startsAt: new Date("2026-09-01T11:00:00Z"),
    endsAt: new Date("2026-09-01T13:00:00Z"),
    ...over,
  });

  it("matches a fleet window against anything", () => {
    expect(findMaintenanceWindow([w({})], { checkId: 7, hostId: 3 }, NOW)?.name).toBe(
      "deploy",
    );
  });

  it("matches host and check windows only against their target", () => {
    const host = w({ scope: "host", hostId: 3 });
    expect(findMaintenanceWindow([host], { checkId: 7, hostId: 3 }, NOW)).not.toBeNull();
    expect(findMaintenanceWindow([host], { checkId: 7, hostId: 4 }, NOW)).toBeNull();

    const check = w({ scope: "check", checkId: 7 });
    expect(findMaintenanceWindow([check], { checkId: 7, hostId: 3 }, NOW)).not.toBeNull();
    expect(findMaintenanceWindow([check], { checkId: 8, hostId: 3 }, NOW)).toBeNull();
  });

  it("never matches a host window against a check with no host", () => {
    // An external dependency has no host; a host window must not swallow it.
    const host = w({ scope: "host", hostId: 3 });
    expect(findMaintenanceWindow([host], { checkId: 7, hostId: null }, NOW)).toBeNull();
  });

  it("ignores windows that have not started or have ended", () => {
    const past = w({ endsAt: new Date("2026-09-01T11:30:00Z") });
    const future = w({ startsAt: new Date("2026-09-01T13:30:00Z") });
    expect(findMaintenanceWindow([past, future], { checkId: 7, hostId: 3 }, NOW)).toBeNull();
  });

  it("is inclusive at the start and exclusive at the end", () => {
    const win = w({});
    expect(
      findMaintenanceWindow([win], { checkId: 1, hostId: null }, win.startsAt),
    ).not.toBeNull();
    expect(
      findMaintenanceWindow([win], { checkId: 1, hostId: null }, win.endsAt),
    ).toBeNull();
  });
});

describe("validateMaintenanceWindow", () => {
  const base = {
    name: "deploy",
    scope: "fleet",
    startsAt: new Date("2026-09-01T11:00:00Z"),
    endsAt: new Date("2026-09-01T13:00:00Z"),
  };

  it("accepts a sane window", () => {
    expect(validateMaintenanceWindow(base)).toBeNull();
  });

  it("rejects a window that ends before it starts", () => {
    expect(
      validateMaintenanceWindow({ ...base, endsAt: new Date("2026-09-01T10:00:00Z") }),
    ).toMatch(/end after it starts/);
  });

  it("rejects an unbounded silence", () => {
    // A month-long window is an outage nobody is looking at.
    expect(
      validateMaintenanceWindow({ ...base, endsAt: new Date("2026-12-01T00:00:00Z") }),
    ).toMatch(/30 days/);
  });

  it("rejects a bad name, scope or date", () => {
    expect(validateMaintenanceWindow({ ...base, name: " " })).toMatch(/1–64/);
    expect(validateMaintenanceWindow({ ...base, scope: "cluster" })).toMatch(/scope/);
    expect(validateMaintenanceWindow({ ...base, endsAt: new Date("nope") })).toMatch(
      /valid start and end/,
    );
  });
});

// ---------------------------------------------------------------------------
// Alert decision
// ---------------------------------------------------------------------------

describe("decideAlert", () => {
  const ctx = (over: Partial<AlertContext>): AlertContext => ({
    status: "down",
    consecutiveFailures: FAILURES_BEFORE_ALERT,
    alertedDown: false,
    alertedDegraded: false,
    suppressedBy: null,
    ...over,
  });

  it("alerts once a failure repeats, and not before", () => {
    expect(decideAlert(ctx({ consecutiveFailures: 1 }))).toBe("none");
    expect(decideAlert(ctx({}))).toBe("down");
  });

  it("does not re-alert while already down", () => {
    expect(decideAlert(ctx({ alertedDown: true, consecutiveFailures: 20 }))).toBe("none");
  });

  it("alerts on degradation, once", () => {
    expect(decideAlert(ctx({ status: "degraded" }))).toBe("degraded");
    expect(decideAlert(ctx({ status: "degraded", alertedDegraded: true }))).toBe("none");
  });

  it("stays quiet when a down check improves to merely degraded", () => {
    // That is an improvement; paging about it reads as a second incident.
    expect(decideAlert(ctx({ status: "degraded", alertedDown: true }))).toBe("none");
  });

  it("recovers from either latch", () => {
    expect(decideAlert(ctx({ status: "ok", alertedDown: true }))).toBe("recovery");
    expect(decideAlert(ctx({ status: "ok", alertedDegraded: true }))).toBe("recovery");
  });

  it("says nothing when a healthy check stays healthy", () => {
    expect(decideAlert(ctx({ status: "ok" }))).toBe("none");
  });

  it("suppresses failures during maintenance, dependency outages and flapping", () => {
    for (const reason of ["maintenance", "dependency", "flapping"] as const) {
      expect(decideAlert(ctx({ suppressedBy: reason }))).toBe("none");
      expect(decideAlert(ctx({ status: "degraded", suppressedBy: reason }))).toBe("none");
    }
  });

  it("still sends recovery even while suppressed", () => {
    // Otherwise the latch stays set and the UI shows red forever.
    expect(
      decideAlert(ctx({ status: "ok", alertedDown: true, suppressedBy: "maintenance" })),
    ).toBe("recovery");
  });
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

describe("percentile", () => {
  const sample = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  it("returns a value that actually occurred", () => {
    expect(sample).toContain(percentile(sample, 50));
    expect(sample).toContain(percentile(sample, 95));
  });

  it("computes nearest-rank percentiles", () => {
    expect(percentile(sample, 50)).toBe(50);
    expect(percentile(sample, 95)).toBe(100);
    expect(percentile(sample, 10)).toBe(10);
  });

  it("does not care about input order", () => {
    expect(percentile([50, 10, 30, 20, 40], 50)).toBe(30);
  });

  it("clamps out-of-range percentiles and handles an empty sample", () => {
    expect(percentile(sample, 0)).toBe(10);
    expect(percentile(sample, 200)).toBe(100);
    expect(percentile([], 50)).toBeNull();
  });

  it("handles a single sample", () => {
    expect(percentile([42], 99)).toBe(42);
  });
});

describe("latencyStats", () => {
  it("summarises a sample", () => {
    const stats = latencyStats([100, 200, 300, 400]);
    expect(stats.samples).toBe(4);
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(400);
    expect(stats.p50).toBe(200);
  });

  it("reports nulls rather than NaN with no samples", () => {
    // Math.min() of nothing is Infinity, which would render as a real number.
    const stats = latencyStats([]);
    expect(stats).toEqual({ p50: null, p95: null, p99: null, min: null, max: null, samples: 0 });
  });
});

describe("errorBudget", () => {
  const MONTH = 30 * 24 * 60;

  it("computes what is left of a three-nines budget", () => {
    // 99.9% of 30 days is ~43.2 minutes of allowed downtime.
    const budget = errorBudget(99.95, 99.9, MONTH);
    expect(budget.breached).toBe(false);
    expect(budget.consumed).toBeCloseTo(0.5, 5);
    expect(budget.remainingMinutes).toBeCloseTo(21.6, 5);
  });

  it("goes negative once the target is missed", () => {
    const budget = errorBudget(99.0, 99.9, MONTH);
    expect(budget.breached).toBe(true);
    expect(budget.consumed).toBeGreaterThan(1);
    expect(budget.remainingMinutes).toBeLessThan(0);
  });

  it("treats a perfect month as untouched budget", () => {
    const budget = errorBudget(100, 99.9, MONTH);
    expect(budget.consumed).toBe(0);
    expect(budget.breached).toBe(false);
  });

  it("handles a 100% target, which has no budget at all", () => {
    expect(errorBudget(100, 100, MONTH).consumed).toBe(0);
    expect(errorBudget(99.99, 100, MONTH).consumed).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("validateSloTarget", () => {
  it("accepts a realistic target and no target", () => {
    expect(validateSloTarget(null)).toBeNull();
    expect(validateSloTarget(99.9)).toBeNull();
    expect(validateSloTarget(99.999)).toBeNull();
  });

  it("rejects targets that cannot mean anything", () => {
    // 100 leaves no budget and would breach on the first blip forever.
    expect(validateSloTarget(100)).toMatch(/between 50/);
    expect(validateSloTarget(10)).toMatch(/between 50/);
    expect(validateSloTarget(Number.NaN)).toMatch(/number/);
  });
});

describe("deriveIncidents", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 8, 1, 12, min)).toISOString();
  const r = (min: number, status: CheckStatus, detail: string | null = null) => ({
    ranAt: at(min),
    status,
    detail,
  });

  it("finds nothing in a healthy series", () => {
    expect(deriveIncidents([r(0, "ok"), r(5, "ok")])).toEqual([]);
  });

  it("collapses a run of failures into one incident", () => {
    const incidents = deriveIncidents([
      r(0, "ok"),
      r(5, "down", "connection refused"),
      r(10, "down"),
      r(15, "ok"),
    ]);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].startedAt).toBe(at(5));
    expect(incidents[0].endedAt).toBe(at(15));
    expect(incidents[0].durationMinutes).toBe(10);
    // The first detail is the useful one: what broke, not what it looked like
    // once it had been broken for a while.
    expect(incidents[0].detail).toBe("connection refused");
  });

  it("separates incidents divided by a recovery", () => {
    const incidents = deriveIncidents([
      r(0, "down"),
      r(5, "ok"),
      r(10, "down"),
      r(15, "ok"),
    ]);
    expect(incidents).toHaveLength(2);
  });

  it("leaves an ongoing incident open", () => {
    const incidents = deriveIncidents([r(0, "ok"), r(5, "down")]);
    expect(incidents[0].endedAt).toBeNull();
    expect(incidents[0].durationMinutes).toBeNull();
  });

  it("does not treat degraded as an incident", () => {
    // Degraded is still serving. Counting it as downtime would make every SLO
    // unmeetable the first time a response took an extra 50ms.
    expect(deriveIncidents([r(0, "ok"), r(5, "degraded"), r(10, "ok")])).toEqual([]);
  });

  it("records the worst status reached during an incident", () => {
    const incidents = deriveIncidents([r(0, "down"), r(5, "down"), r(10, "ok")]);
    expect(incidents[0].worst).toBe("down");
  });

  it("returns newest first", () => {
    const incidents = deriveIncidents([
      r(0, "down"),
      r(5, "ok"),
      r(10, "down"),
      r(15, "ok"),
    ]);
    expect(incidents[0].startedAt).toBe(at(10));
    expect(incidents[1].startedAt).toBe(at(0));
  });
});
