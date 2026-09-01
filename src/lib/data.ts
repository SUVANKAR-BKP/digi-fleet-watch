import { and, asc, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import {
  containers as containersTable,
  diskUsage as diskUsageTable,
  dockerInfo as dockerInfoTable,
  hostMetrics as hostMetricsTable,
  hosts as hostsTable,
  packages as packagesTable,
  snapshots as snapshotsTable,
} from "@/db/schema";
import { getDb } from "./db";
import {
  calculateUptimePct,
  listDowntimeEvents,
  runDowntimeCheck,
  statusFor,
  uptimeSeries,
} from "./downtime";
import { getDemoHostDetail, getDemoOverview } from "./demo";
import { ensureSchema } from "./migrate";
import { DISK_WARN_PCT } from "./thresholds";
import { getHostVulnCounts, getHostVulnerabilities } from "./vulnerabilities";
import type {
  ContainerRow,
  DiskRow,
  DockerStatus,
  HostDetailData,
  HostSummary,
  MetricPoint,
  MetricsSnapshot,
  OverviewData,
  PackageRow,
} from "./types";

let availability: boolean | null = null;
let lastProbeAt = 0;

/** How long a failed probe is trusted before Postgres is tried again. */
const UNAVAILABLE_RETRY_MS = 10_000;

/**
 * Cheap, cached probe of whether Postgres is reachable.
 *
 * A negative result is only cached briefly: the previous version memoised it
 * for the lifetime of the process, so an app that started a few seconds before
 * its database served demo data until someone restarted it.
 */
export async function dbAvailable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  if (availability === true) return true;
  if (availability === false && Date.now() - lastProbeAt < UNAVAILABLE_RETRY_MS) {
    return false;
  }

  lastProbeAt = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    availability = true;
  } catch (err) {
    console.warn("[db] unreachable — falling back to demo data", (err as Error).message);
    availability = false;
    return false;
  }

  // The database answered; make sure its schema matches this build. Failure
  // here is loud but non-fatal — the queries below will surface it precisely.
  try {
    await ensureSchema();
  } catch (err) {
    console.error("[db] schema migration failed", (err as Error).message);
  }
  return true;
}

const NO_DB_MSG =
  "No live database is configured, so real fleet data can't be shown — " +
  "deploy with docker-compose (Postgres) to collect host data.";

/**
 * Overview for every host in one round-trip.
 *
 * This used to loop hosts and call buildHostSummary(), which costs eight
 * queries each — latest snapshot, two package counts, docker_info, uptime,
 * metrics, disk, vulnerability counts — so a 50-host fleet issued 400+
 * sequential statements per page load. Postgres does the same work here as a
 * single statement with one lateral join per fact.
 *
 * DISTINCT ON is deliberate: "the newest snapshot per host" is exactly what a
 * lateral LIMIT 1 expresses, and it lets the planner use the existing
 * (host_id, collected_at) indexes instead of sorting whole tables.
 */
export async function getOverview(): Promise<OverviewData> {
  if (!(await dbAvailable())) {
    return { ...getDemoOverview(), error: NO_DB_MSG };
  }
  try {
    await runDowntimeCheck();

    const { rows } = await getDb().execute<OverviewSqlRow>(sql`
      select
        h.id,
        h.hostname,
        h.label,
        h.last_seen_at,
        snap.os_info,
        coalesce(pkg.outdated, 0)          as outdated_packages,
        coalesce(pkg.security, 0)          as security_packages,
        dk.engine_version,
        dk.is_deprecated,
        m.cpu_pct,
        m.mem_used_bytes,
        m.mem_total_bytes,
        disk.max_use_pct,
        coalesce(vuln.critical, 0)         as vuln_critical,
        coalesce(vuln.high, 0)             as vuln_high,
        coalesce(vuln.total, 0)            as vuln_total,
        coalesce(down.downtime_ms, 0)      as downtime_ms
      from hosts h

      -- Newest snapshot, and the package/docker facts hanging off it.
      left join lateral (
        select s.id, s.os_info
        from snapshots s
        where s.host_id = h.id
        order by s.collected_at desc
        limit 1
      ) snap on true

      left join lateral (
        select
          count(*) filter (where p.available_version is not null) as outdated,
          count(*) filter (where p.is_security_update)            as security
        from packages p
        where p.snapshot_id = snap.id
      ) pkg on true

      left join lateral (
        select di.engine_version, di.is_deprecated
        from docker_info di
        where di.snapshot_id = snap.id
        limit 1
      ) dk on true

      -- Newest resource sample, and the worst filesystem on it.
      left join lateral (
        select hm.id, hm.cpu_pct, hm.mem_used_bytes, hm.mem_total_bytes
        from host_metrics hm
        where hm.host_id = h.id
        order by hm.collected_at desc
        limit 1
      ) m on true

      left join lateral (
        select max(d.use_pct) as max_use_pct
        from disk_usage d
        where d.metric_id = m.id
      ) disk on true

      left join lateral (
        select
          count(*) filter (where v.severity = 'CRITICAL') as critical,
          count(*) filter (where v.severity = 'HIGH')     as high,
          count(*)                                        as total
        from host_vulnerabilities hv
        join vulnerabilities v on v.id = hv.vuln_id
        where hv.host_id = h.id and hv.resolved_at is null
      ) vuln on true

      -- Downtime inside the 30-day window, clipped to it. Mirrors
      -- downtimeMsInWindow(): an outage that began before the window still
      -- counts for the part that overlaps.
      left join lateral (
        select sum(
          extract(epoch from (
            least(coalesce(e.ended_at, now()), now())
            - greatest(e.started_at, now() - interval '30 days')
          )) * 1000
        )::bigint as downtime_ms
        from downtime_events e
        where e.host_id = h.id
          and e.started_at < now()
          and (e.ended_at is null or e.ended_at > now() - interval '30 days')
      ) down on true

      order by h.hostname asc
    `);

    return { hosts: rows.map(toHostSummary), demo: false };
  } catch (err) {
    console.error("[overview] failed", err);
    return {
      hosts: [],
      demo: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Raw shape of one row from the overview query. */
interface OverviewSqlRow extends Record<string, unknown> {
  id: number;
  hostname: string;
  label: string | null;
  last_seen_at: Date | null;
  os_info: { name?: string; version?: string; kernel?: string } | null;
  outdated_packages: string | number;
  security_packages: string | number;
  engine_version: string | null;
  is_deprecated: boolean | null;
  cpu_pct: number | null;
  mem_used_bytes: string | number | null;
  mem_total_bytes: string | number | null;
  max_use_pct: number | null;
  vuln_critical: string | number;
  vuln_high: string | number;
  vuln_total: string | number;
  downtime_ms: string | number | null;
}

/** pg returns bigint and count() as strings to avoid precision loss. */
function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const THIRTY_DAYS_MS = 30 * 86_400_000;

function toHostSummary(row: OverviewSqlRow): HostSummary {
  const memUsed = num(row.mem_used_bytes);
  const memTotal = num(row.mem_total_bytes);
  const downMs = Math.max(0, num(row.downtime_ms) ?? 0);
  const os = row.os_info ?? {};
  const maxDisk = row.max_use_pct;

  return {
    id: row.id,
    hostname: row.hostname,
    label: row.label,
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
    status: statusFor(row.last_seen_at ? new Date(row.last_seen_at) : null),
    outdatedPackages: num(row.outdated_packages) ?? 0,
    securityPackages: num(row.security_packages) ?? 0,
    dockerInstalled: row.engine_version !== null,
    dockerDeprecated: row.is_deprecated ?? false,
    dockerEngineVersion: row.engine_version,
    uptimePct30d:
      Math.round(
        (Math.max(0, THIRTY_DAYS_MS - downMs) / THIRTY_DAYS_MS) * 1000,
      ) / 10,
    osLabel: [os.name, os.version].filter(Boolean).join(" ") || null,
    cpuPct: row.cpu_pct,
    memUsedPct: memUsedPct(memUsed, memTotal),
    maxDiskUsePct: maxDisk,
    diskAlert: maxDisk !== null && maxDisk >= DISK_WARN_PCT,
    vulnCritical: num(row.vuln_critical) ?? 0,
    vulnHigh: num(row.vuln_high) ?? 0,
    vulnTotal: num(row.vuln_total) ?? 0,
  };
}

/**
 * Full detail for one host. Returns null only when the host genuinely does not
 * exist — any other failure throws.
 *
 * This used to catch everything and return null, which the route and the page
 * both reported as "host not found". A missing `containers` table therefore
 * showed up as a 404 on a host the overview was happily listing, and the real
 * error only existed in the server log.
 */
export async function getHostDetail(id: number): Promise<HostDetailData | null> {
  if (!(await dbAvailable())) {
    return getDemoHostDetail(id);
  }
  {
    await runDowntimeCheck();
    const db = getDb();
    const [host] = await db.select().from(hostsTable).where(eq(hostsTable.id, id));
    if (!host) return null;

    const summary = await buildHostSummary(id);

    const [snap] = await db
      .select()
      .from(snapshotsTable)
      .where(eq(snapshotsTable.hostId, id))
      .orderBy(desc(snapshotsTable.collectedAt))
      .limit(1);

    let packages: PackageRow[] = [];
    let containers: ContainerRow[] = [];
    const docker: DockerStatus = {
      installed: false,
      engineVersion: null,
      apiVersion: null,
      deprecated: false,
      containersRunning: 0,
      containersTotal: 0,
    };

    if (snap) {
      const rows = await db
        .select()
        .from(packagesTable)
        .where(eq(packagesTable.snapshotId, snap.id))
        .orderBy(asc(packagesTable.name));
      packages = rows.map((r) => ({
        id: r.id,
        name: r.name,
        installed: r.installedVersion,
        available: r.availableVersion,
        security: r.isSecurityUpdate,
        cveIds: r.cveIds,
      }));

      const crows = await db
        .select()
        .from(containersTable)
        .where(eq(containersTable.snapshotId, snap.id));
      containers = crows.map((c) => ({
        id: c.id,
        containerId: c.containerId,
        name: c.name,
        image: c.image,
        imageTag: c.imageTag,
        imageDigest: c.imageDigest,
        status: c.status,
        healthStatus: c.healthStatus,
        restartCount: c.restartCount,
        createdAt: c.createdAt ? c.createdAt.toISOString() : null,
        ageDays: c.ageDays,
        isUnpinnedLatest: c.isUnpinnedLatest,
      }));

      const [dk] = await db
        .select()
        .from(dockerInfoTable)
        .where(eq(dockerInfoTable.snapshotId, snap.id))
        .limit(1);
      if (dk) {
        docker.installed = true;
        docker.engineVersion = dk.engineVersion;
        docker.apiVersion = dk.apiVersion;
        docker.deprecated = dk.isDeprecated;
        docker.containersRunning = dk.containersRunning;
        docker.containersTotal = dk.containersTotal;
      }
    }

    const [
      uptimePct30d,
      series,
      downtimeEvents,
      metrics,
      metricHistory,
      vulns,
    ] = await Promise.all([
      calculateUptimePct(id, 30),
      uptimeSeries(id, 30),
      listDowntimeEvents(id),
      getLatestMetrics(id),
      getMetricHistory(id, 24),
      getHostVulnerabilities(id),
    ]);

    return {
      demo: false,
      summary,
      os: snap?.osInfo ?? null,
      packages,
      containers,
      docker,
      uptimeSeries: series,
      uptimePct30d,
      downtimeEvents,
      metrics,
      metricHistory,
      vulnerabilities: vulns,
    };
  }
}

/** Percentage of memory in use, or null when the sample lacks the fields. */
function memUsedPct(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0) return null;
  return Math.round((used / total) * 1000) / 10;
}

/** Latest resource sample for a host, with its per-mount disk usage. */
export async function getLatestMetrics(
  hostId: number,
): Promise<MetricsSnapshot | null> {
  const db = getDb();
  const [m] = await db
    .select()
    .from(hostMetricsTable)
    .where(eq(hostMetricsTable.hostId, hostId))
    .orderBy(desc(hostMetricsTable.collectedAt))
    .limit(1);
  if (!m) return null;

  const disks = await db
    .select()
    .from(diskUsageTable)
    .where(eq(diskUsageTable.metricId, m.id))
    .orderBy(asc(diskUsageTable.mount));

  return {
    collectedAt: m.collectedAt.toISOString(),
    cpuPct: m.cpuPct,
    cpuCores: m.cpuCores,
    load1: m.load1,
    load5: m.load5,
    load15: m.load15,
    memTotalBytes: m.memTotalBytes,
    memUsedBytes: m.memUsedBytes,
    memAvailableBytes: m.memAvailableBytes,
    memUsedPct: memUsedPct(m.memUsedBytes, m.memTotalBytes),
    swapTotalBytes: m.swapTotalBytes,
    swapUsedBytes: m.swapUsedBytes,
    uptimeSeconds: m.uptimeSeconds,
    processCount: m.processCount,
    disks: disks.map(
      (d): DiskRow => ({
        mount: d.mount,
        fsType: d.fsType,
        totalBytes: d.totalBytes,
        usedBytes: d.usedBytes,
        availableBytes: d.availableBytes,
        usePct: d.usePct,
        inodeUsePct: d.inodeUsePct,
      }),
    ),
  };
}

/**
 * Resource history for the charts. Oldest first, capped so a long window on a
 * chatty host cannot return tens of thousands of points to the browser.
 */
export async function getMetricHistory(
  hostId: number,
  hours = 24,
  limit = 500,
): Promise<MetricPoint[]> {
  const since = new Date(Date.now() - hours * 3_600_000);
  const rows = await getDb()
    .select({
      collectedAt: hostMetricsTable.collectedAt,
      cpuPct: hostMetricsTable.cpuPct,
      memUsedBytes: hostMetricsTable.memUsedBytes,
      memTotalBytes: hostMetricsTable.memTotalBytes,
      load1: hostMetricsTable.load1,
    })
    .from(hostMetricsTable)
    .where(
      and(
        eq(hostMetricsTable.hostId, hostId),
        gte(hostMetricsTable.collectedAt, since),
      ),
    )
    .orderBy(desc(hostMetricsTable.collectedAt))
    .limit(limit);

  return rows
    .reverse()
    .map((r) => ({
      t: r.collectedAt.toISOString(),
      cpuPct: r.cpuPct,
      memUsedPct: memUsedPct(r.memUsedBytes, r.memTotalBytes),
      load1: r.load1,
    }));
}

/**
 * Compact metrics for a host card: one row, with the worst disk folded in by a
 * correlated subquery rather than a second round-trip per host.
 */
async function getSummaryMetrics(hostId: number): Promise<{
  cpuPct: number | null;
  memUsedPct: number | null;
  maxDiskUsePct: number | null;
}> {
  const rows = await getDb().execute<{
    cpu_pct: number | null;
    mem_used_bytes: string | number | null;
    mem_total_bytes: string | number | null;
    max_disk: number | null;
  }>(sql`
    select m.cpu_pct,
           m.mem_used_bytes,
           m.mem_total_bytes,
           (select max(d.use_pct) from disk_usage d where d.metric_id = m.id) as max_disk
    from host_metrics m
    where m.host_id = ${hostId}
    order by m.collected_at desc
    limit 1
  `);

  const row = rows.rows[0];
  if (!row) return { cpuPct: null, memUsedPct: null, maxDiskUsePct: null };

  const used = row.mem_used_bytes === null ? null : Number(row.mem_used_bytes);
  const total = row.mem_total_bytes === null ? null : Number(row.mem_total_bytes);

  return {
    cpuPct: row.cpu_pct,
    memUsedPct: memUsedPct(used, total),
    maxDiskUsePct: row.max_disk,
  };
}

/** Minimal host list for pickers (silences, filters). */
export async function listHostsForPicker(): Promise<
  { id: number; hostname: string }[]
> {
  if (!(await dbAvailable())) return [];
  return getDb()
    .select({ id: hostsTable.id, hostname: hostsTable.hostname })
    .from(hostsTable)
    .orderBy(asc(hostsTable.hostname));
}

/**
 * Removes a host and everything recorded for it. Returns false when no such
 * host exists.
 *
 * Snapshots, packages, containers, heartbeats and downtime events all declare
 * `ON DELETE CASCADE` against their parent, so one delete clears the lot.
 *
 * Note this only forgets the data: an agent still installed on the machine
 * re-registers on its next heartbeat. Run /uninstall.sh on the host to stop it
 * reporting.
 */
export async function deleteHost(id: number): Promise<boolean> {
  if (!(await dbAvailable())) {
    throw new Error("No database is configured, so hosts cannot be deleted.");
  }
  const db = getDb();
  const rows = await db
    .delete(hostsTable)
    .where(eq(hostsTable.id, id))
    .returning({ id: hostsTable.id });
  return rows.length > 0;
}

async function buildHostSummary(hostId: number): Promise<HostSummary> {
  const db = getDb();
  const [host] = await db.select().from(hostsTable).where(eq(hostsTable.id, hostId));
  if (!host) throw new Error(`host ${hostId} not found`);

  let outdated = 0;
  let security = 0;
  let docker: (typeof dockerInfoTable.$inferSelect) | null = null;
  let osLabel: string | null = null;

  const [snap] = await db
    .select()
    .from(snapshotsTable)
    .where(eq(snapshotsTable.hostId, hostId))
    .orderBy(desc(snapshotsTable.collectedAt))
    .limit(1);

  if (snap) {
    const [cntRow] = await db
      .select({ value: count() })
      .from(packagesTable)
      .where(and(eq(packagesTable.snapshotId, snap.id), isNotNull(packagesTable.availableVersion)));
    outdated = cntRow.value;

    const [secRow] = await db
      .select({ value: count() })
      .from(packagesTable)
      .where(and(eq(packagesTable.snapshotId, snap.id), eq(packagesTable.isSecurityUpdate, true)));
    security = secRow.value;

    const [dk] = await db
      .select()
      .from(dockerInfoTable)
      .where(eq(dockerInfoTable.snapshotId, snap.id))
      .limit(1);
    docker = dk ?? null;

    const os = snap.osInfo;
    osLabel = [os.name, os.version].filter(Boolean).join(" ") || null;
  }

  const uptimePct30d = await calculateUptimePct(hostId, 30);
  const metrics = await getSummaryMetrics(hostId);
  const vulnCounts = await getHostVulnCounts(hostId);

  return {
    id: host.id,
    hostname: host.hostname,
    label: host.label,
    lastSeenAt: host.lastSeenAt ? host.lastSeenAt.toISOString() : null,
    status: statusFor(host.lastSeenAt),
    outdatedPackages: outdated,
    securityPackages: security,
    dockerInstalled: docker !== null,
    dockerDeprecated: docker?.isDeprecated ?? false,
    dockerEngineVersion: docker?.engineVersion ?? null,
    uptimePct30d,
    osLabel,
    cpuPct: metrics.cpuPct,
    memUsedPct: metrics.memUsedPct,
    maxDiskUsePct: metrics.maxDiskUsePct,
    diskAlert:
      metrics.maxDiskUsePct !== null && metrics.maxDiskUsePct >= DISK_WARN_PCT,
    vulnCritical: vulnCounts.critical,
    vulnHigh: vulnCounts.high,
    vulnTotal: vulnCounts.total,
  };
}