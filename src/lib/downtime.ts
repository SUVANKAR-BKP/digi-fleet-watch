import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import { downtimeEvents, hosts } from "@/db/schema";
import { getDb, type DbExecutor } from "./db";
import { dispatchAlert } from "./alerts";
import { DOWN_MS, OPEN_DOWNTIME_AFTER_MS, STALE_MS } from "./thresholds";
import type { DowntimeEventRow, HostStatus, UptimeDay } from "./types";

export function statusFor(lastSeen: Date | null): HostStatus {
  if (!lastSeen) return "down";
  const age = Date.now() - lastSeen.getTime();
  if (age <= STALE_MS) return "online";
  if (age <= DOWN_MS) return "stale";
  return "down";
}

/**
 * Scans for hosts that have stopped heartbeating and opens downtime events
 * for them, firing a Slack alert on each new event. Also closes events for
 * hosts that have recovered. Safe to run on every dashboard load because a
 * new event (and its alert) is only created once per outage.
 */
export async function runDowntimeCheck(): Promise<{ opened: number; closed: number }> {
  const db = getDb();
  const rows = await db.select().from(hosts);
  const now = new Date();
  let opened = 0;
  let closed = 0;

  for (const row of rows) {
    if (!row.lastSeenAt) continue;
    const age = now.getTime() - row.lastSeenAt.getTime();

    const [openEvent] = await db
      .select({ id: downtimeEvents.id })
      .from(downtimeEvents)
      .where(and(eq(downtimeEvents.hostId, row.id), isNull(downtimeEvents.endedAt)))
      .limit(1);

    if (age > OPEN_DOWNTIME_AFTER_MS) {
      if (!openEvent) {
        // The select above is advisory only: this runs on every dashboard
        // load, so two concurrent requests can both reach here. The partial
        // unique index (0002) makes the database reject the second insert,
        // and an empty `returning` tells us we lost the race — so the alerts
        // below fire exactly once per outage.
        const inserted = await db
          .insert(downtimeEvents)
          .values({
            hostId: row.id,
            startedAt: row.lastSeenAt,
            detectedBy: "heartbeat_miss",
          })
          .onConflictDoNothing()
          .returning({ id: downtimeEvents.id });

        if (inserted.length > 0) {
          opened++;
          await dispatchAlert({
            severity: "critical",
            title: `HOST DOWN: ${row.hostname}`,
            body: `No heartbeat since ${row.lastSeenAt.toISOString()}.`,
            hostId: row.id,
            hostname: row.hostname,
            url: `${getBaseUrl()}/hosts/${row.id}`,
          });
        }
      }
    } else if (openEvent) {
      // Same reasoning: only the request whose UPDATE actually closed a row
      // sends the recovery notice.
      const recovered = await closeOpenDowntime(row.id, now, db);
      if (recovered > 0) {
        closed++;
        await dispatchAlert({
          severity: "info",
          title: `Host recovered: ${row.hostname}`,
          body: `${row.hostname} is reporting again as of ${now.toISOString()}.`,
          hostId: row.id,
          hostname: row.hostname,
          url: `${getBaseUrl()}/hosts/${row.id}`,
        });
      }
    }
  }

  return { opened, closed };
}

/** Closes any open downtime event for a host (called on ingest / recovery).
 * Returns the number of events closed. Accepts an open transaction so the
 * close can be committed atomically with the snapshot that proves recovery. */
export async function closeOpenDowntime(
  hostId: number,
  endedAt: Date = new Date(),
  exec: DbExecutor = getDb(),
): Promise<number> {
  const rows = await exec
    .update(downtimeEvents)
    .set({ endedAt })
    .where(and(eq(downtimeEvents.hostId, hostId), isNull(downtimeEvents.endedAt)))
    .returning({ id: downtimeEvents.id });
  return rows.length;
}

/**
 * Base URL used in alert links. `.env.example` documents PUBLIC_FLEETWATCH_URL
 * as the canonical name with FLEETWATCH_PUBLIC_URL as the legacy alias, so both
 * are read here — checking only the alias silently produced localhost links in
 * every downtime email. Matches the precedence in install-context.ts.
 */
function getBaseUrl(): string {
  const configured =
    process.env.PUBLIC_FLEETWATCH_URL || process.env.FLEETWATCH_PUBLIC_URL;
  return configured?.replace(/\/+$/, "") || "http://localhost:3000";
}

/** Uptime percentage over the last `days`. */
export async function calculateUptimePct(
  hostId: number,
  days: number,
): Promise<number> {
  const db = getDb();
  const windowMs = days * 86_400_000;
  const windowStart = new Date(Date.now() - windowMs);
  const now = new Date();

  const events = await db
    .select()
    .from(downtimeEvents)
    .where(
      and(
        eq(downtimeEvents.hostId, hostId),
        lt(downtimeEvents.startedAt, now),
        // An event overlaps the window when it is still open, or ended after
        // the window began. Selecting on startedAt instead silently dropped
        // outages that began before the window and ended inside it, which
        // over-reported uptime (a 40-day-old outage that ended 5 days ago
        // matched neither branch and counted as zero downtime).
        or(isNull(downtimeEvents.endedAt), gt(downtimeEvents.endedAt, windowStart)),
      ),
    );

  const downMs = downtimeMsInWindow(events, windowStart, now);
  const upMs = Math.max(0, windowMs - downMs);
  return Math.round((upMs / windowMs) * 1000) / 10;
}

/** An outage as far as the uptime maths is concerned. */
export interface DowntimeInterval {
  startedAt: Date;
  endedAt: Date | null;
}

/**
 * Milliseconds of downtime that fall inside [windowStart, windowEnd].
 *
 * Extracted so the overlap rule can be tested without a database: each event is
 * clipped to the window, which is what makes an outage that straddles the
 * window boundary contribute only its overlapping part rather than nothing (or
 * its whole duration).
 */
export function downtimeMsInWindow(
  events: DowntimeInterval[],
  windowStart: Date,
  windowEnd: Date,
): number {
  const from = windowStart.getTime();
  const to = windowEnd.getTime();

  let downMs = 0;
  for (const e of events) {
    const start = Math.max(e.startedAt.getTime(), from);
    const end = Math.min(e.endedAt ? e.endedAt.getTime() : to, to);
    if (end > start) downMs += end - start;
  }
  return downMs;
}

/**
 * yyyy-mm-dd in *local* time. The buckets below are local-midnight boundaries,
 * so keying them with toISOString() (which is UTC) shifted every label by a day
 * for anyone east of Greenwich — in IST, local midnight is 18:30 UTC the day
 * before.
 */
function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Per-day uptime buckets for the last `days` (for the recharts chart). */
export async function uptimeSeries(hostId: number, days: number): Promise<UptimeDay[]> {
  const db = getDb();
  const dayMs = 86_400_000;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const windowStart = new Date(todayStart.getTime() - (days - 1) * dayMs);

  const series: UptimeDay[] = [];
  const indexByDay = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(todayStart.getTime() - i * dayMs);
    const key = dayKey(day);
    indexByDay.set(key, series.length);
    series.push({ day: key, uptimePct: 100, downtimeSec: 0 });
  }

  const events = await db
    .select()
    .from(downtimeEvents)
    .where(
      and(
        eq(downtimeEvents.hostId, hostId),
        // Same overlap rule as calculateUptimePct — see the note there.
        or(isNull(downtimeEvents.endedAt), gt(downtimeEvents.endedAt, windowStart)),
      ),
    );

  for (const e of events) {
    const end = e.endedAt ? e.endedAt.getTime() : now.getTime();
    const start = e.startedAt.getTime();
    let s = Math.max(start, windowStart.getTime());
    const en = Math.min(end, now.getTime());
    if (en <= s) continue;

    let cur = new Date(s);
    while (cur.getTime() < en) {
      const dayStart = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
      const nextDay = new Date(dayStart.getTime() + dayMs);
      const overlap = Math.max(0, Math.min(en, nextDay.getTime()) - Math.max(s, dayStart.getTime()));
      const idx = indexByDay.get(dayKey(dayStart));
      if (idx !== undefined) {
        series[idx].downtimeSec += Math.round(overlap / 1000);
      }
      cur = nextDay;
    }
  }

  for (const d of series) {
    const down = Math.min(d.downtimeSec, 86_400);
    d.uptimePct = Math.round(((86_400 - down) / 86_400) * 1000) / 10;
  }

  return series;
}

/** Recent downtime events with computed durations. */
export async function listDowntimeEvents(hostId: number, limit = 50): Promise<DowntimeEventRow[]> {
  const db = getDb();
  const rows = await db
      .select()
      .from(downtimeEvents)
      .where(eq(downtimeEvents.hostId, hostId))
      .orderBy(desc(downtimeEvents.startedAt))
      .limit(limit);
  
    return rows.map((e) => ({
      id: e.id,
      startedAt: e.startedAt.toISOString(),
      endedAt: e.endedAt ? e.endedAt.toISOString() : null,
      detectedBy: e.detectedBy,
      durationSec: e.endedAt
        ? Math.round((e.endedAt.getTime() - e.startedAt.getTime()) / 1000)
        : null,
    }));
}