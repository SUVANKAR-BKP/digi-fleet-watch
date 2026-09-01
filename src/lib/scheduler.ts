import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { runDowntimeCheck } from "./downtime";
import { runRetention } from "./retention";

/**
 * In-process background scheduler.
 *
 * Downtime detection used to run only when someone loaded the dashboard, which
 * meant an outage over a quiet weekend was noticed on Monday morning. Retention
 * and vulnerability scanning have no UI trigger at all. This runs them on a
 * timer instead.
 *
 * Every job takes a Postgres advisory lock first, so running multiple app
 * replicas against one database does not double-alert or double-prune. The
 * lock is `try`-only: if another replica holds it, this tick is simply skipped.
 */

const JOB_LOCKS = {
  downtime: 8_100_001,
  retention: 8_100_002,
  vulnScan: 8_100_003,
  checks: 8_100_004,
} as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

interface Job {
  name: string;
  lockKey: number;
  everyMs: number;
  /** Delay before the first run, so start-up is not a thundering herd. */
  initialDelayMs: number;
  run: () => Promise<unknown>;
}

/**
 * Runs `fn` while holding an advisory lock, or does nothing if another process
 * holds it. Uses a dedicated connection because advisory locks are
 * session-scoped.
 */
async function withJobLock<T>(
  key: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const db = getDb();
  const acquired = await db.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_lock(${key}) as locked`,
  );
  if (!acquired.rows[0]?.locked) return null;

  try {
    return await fn();
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${key})`).catch(() => {});
  }
}

const timers: NodeJS.Timeout[] = [];
let started = false;

function schedule(job: Job): void {
  const tick = async () => {
    try {
      await withJobLock(job.lockKey, job.run);
    } catch (err) {
      // A failing job must never take the server down or stop its own timer.
      console.error(`[scheduler] ${job.name} failed:`, (err as Error).message);
    }
  };

  const timer = setTimeout(() => {
    void tick();
    const interval = setInterval(() => void tick(), job.everyMs);
    // Do not hold the event loop open on shutdown.
    interval.unref?.();
    timers.push(interval);
  }, job.initialDelayMs);
  timer.unref?.();
  timers.push(timer);
}

/** Starts the background jobs. Idempotent — a second call is ignored. */
export function startScheduler(): void {
  if (started) return;
  started = true;

  const jobs: Job[] = [
    {
      name: "downtime",
      lockKey: JOB_LOCKS.downtime,
      // Tighter than the 15-minute "host is stale" threshold, so an outage is
      // noticed promptly rather than up to a full interval late.
      everyMs: 2 * MINUTE,
      initialDelayMs: 20_000,
      run: runDowntimeCheck,
    },
    {
      name: "retention",
      lockKey: JOB_LOCKS.retention,
      everyMs: 6 * HOUR,
      initialDelayMs: 2 * MINUTE,
      run: runRetention,
    },
    {
      name: "external-checks",
      lockKey: JOB_LOCKS.checks,
      // Ticks often; each check decides for itself whether its own interval
      // has elapsed, so this is a scheduling heartbeat rather than a probe.
      everyMs: 30_000,
      initialDelayMs: 45_000,
      run: async () => {
        const { runDueChecks } = await import("./checks");
        return runDueChecks();
      },
    },
    {
      name: "vulnerability-scan",
      lockKey: JOB_LOCKS.vulnScan,
      everyMs: 6 * HOUR,
      initialDelayMs: 3 * MINUTE,
      run: async () => {
        // Imported lazily: it reaches out to the network, and nothing else in
        // the scheduler should pay for loading it.
        const { scanFleetForVulnerabilities } = await import("./vulnerabilities");
        return scanFleetForVulnerabilities();
      },
    },
  ];

  for (const job of jobs) schedule(job);

  console.log(
    `[scheduler] started ${jobs.length} background jobs ` +
      "(downtime 2m, checks 30s, retention 6h, vulnerability scan 6h)",
  );
}

/** Stops every timer. Used by tests and graceful shutdown. */
export function stopScheduler(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  started = false;
}
