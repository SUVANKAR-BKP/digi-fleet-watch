import { and, desc, eq, gte, isNull, lt, or } from "drizzle-orm";
import { downtimeEvents, hosts } from "@/db/schema";
import { getDb } from "./db";
import { postSlackMessage } from "./slack";
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
        await db.insert(downtimeEvents).values({
          hostId: row.id,
          startedAt: row.lastSeenAt,
          detectedBy: "heartbeat_miss",
        });
        opened++;
        await postSlackMessage(
          `:red_circle: *FleetWatch* — host \`${row.hostname}\` is DOWN\n` +
            `No heartbeat since ${row.lastSeenAt.toISOString()}.`,
        );
      }
    } else if (openEvent) {
      await db
        .update(downtimeEvents)
        .set({ endedAt: now })
        .where(and(eq(downtimeEvents.hostId, row.id), isNull(downtimeEvents.endedAt)));
      closed++;
    }
  }

  return { opened, closed };
}

/** Closes any open downtime event for a host (called on ingest / recovery). */
export async function closeOpenDowntime(hostId: number, endedAt: Date = new Date()) {
  const db = getDb();
  await db
    .update(downtimeEvents)
    .set({ endedAt })
    .where(and(eq(downtimeEvents.hostId, hostId), isNull(downtimeEvents.endedAt)));
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
        or(gte(downtimeEvents.startedAt, windowStart), isNull(downtimeEvents.endedAt)),
      ),
    );

  let downMs = 0;
  for (const e of events) {
    const s = Math.max(e.startedAt.getTime(), windowStart.getTime());
    const end = e.endedAt ? e.endedAt.getTime() : now.getTime();
    if (end > s) downMs += end - s;
  }

  const upMs = Math.max(0, windowMs - downMs);
  return Math.round((upMs / windowMs) * 1000) / 10;
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
    const key = day.toISOString().slice(0, 10);
    indexByDay.set(key, series.length);
    series.push({ day: key, uptimePct: 100, downtimeSec: 0 });
  }

  const events = await db
    .select()
    .from(downtimeEvents)
    .where(
      and(
        eq(downtimeEvents.hostId, hostId),
        or(gte(downtimeEvents.startedAt, windowStart), isNull(downtimeEvents.endedAt)),
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
      const idx = indexByDay.get(dayStart.toISOString().slice(0, 10));
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