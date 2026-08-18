import { and, asc, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import {
  containers as containersTable,
  dockerInfo as dockerInfoTable,
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
import type {
  ContainerRow,
  DockerStatus,
  HostDetailData,
  HostSummary,
  OverviewData,
  PackageRow,
} from "./types";

let availability: boolean | null = null;

/** Cheap, cached probe of whether Postgres is reachable. */
export async function dbAvailable(): Promise<boolean> {
  if (availability !== null) return availability;
  if (!process.env.DATABASE_URL) {
    availability = false;
    return availability;
  }
  try {
    await getDb().execute(sql`select 1`);
    availability = true;
  } catch (err) {
    console.warn("[db] unreachable — falling back to demo data", (err as Error).message);
    availability = false;
  }
  return availability;
}

const NO_DB_MSG =
  "No live database is configured, so real fleet data can't be shown — " +
  "deploy with docker-compose (Postgres) to collect host data.";

export async function getOverview(): Promise<OverviewData> {
  if (!(await dbAvailable())) {
    return { ...getDemoOverview(), error: NO_DB_MSG };
  }
  try {
    await runDowntimeCheck();
    const db = getDb();
    const rows = await db.select().from(hostsTable).orderBy(asc(hostsTable.hostname));
    const summaries: HostSummary[] = [];
    for (const h of rows) {
      summaries.push(await buildHostSummary(h.id));
    }
    return { hosts: summaries, demo: false };
  } catch (err) {
    console.error("[overview] failed", err);
    return {
      hosts: [],
      demo: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getHostDetail(id: number): Promise<HostDetailData | null> {
  if (!(await dbAvailable())) {
    return getDemoHostDetail(id);
  }
  try {
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

    const [uptimePct30d, series, downtimeEvents] = await Promise.all([
      calculateUptimePct(id, 30),
      uptimeSeries(id, 30),
      listDowntimeEvents(id),
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
    };
  } catch (err) {
    console.error(`[host:${id}] failed`, err);
    return null;
  }
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
  };
}