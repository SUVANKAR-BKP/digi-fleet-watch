import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  hostVulnerabilities,
  hosts,
  packages as packagesTable,
  snapshots,
  vulnerabilities,
} from "@/db/schema";
import { SEVERITY_RANK, type Severity } from "./cvss";
import { getDb } from "./db";
import { ensureSchema } from "./migrate";
import { ecosystemFor, fetchVulnDetail, queryVulnerableIds } from "./osv";

/**
 * Turns each host's package inventory into tracked vulnerability exposure.
 *
 * Run on a schedule rather than on ingest: OSV is a network call, and the
 * answer for a given package version only changes when OSV publishes something
 * new — not every five minutes when an agent checks in.
 */

/** Re-fetch a cached vulnerability's details after this long. */
const DETAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface VulnRow {
  id: string;
  severity: Severity;
  cvssScore: number | null;
  summary: string | null;
  aliases: string[];
  packageName: string;
  installedVersion: string;
  fixedVersion: string | null;
  firstSeenAt: string;
  publishedAt: string | null;
}

/** One row of the fleet-wide vulnerability view. */
export interface FleetVulnRow {
  id: string;
  severity: Severity;
  cvssScore: number | null;
  summary: string | null;
  hostCount: number;
  hostnames: string[];
  packageNames: string[];
  fixedVersion: string | null;
}

export interface VulnCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  total: number;
}

function emptyCounts(): VulnCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, unknown: 0, total: 0 };
}

/**
 * Scans every host's latest snapshot against OSV and records what it finds.
 *
 * Exposure is tracked over time rather than replaced: a row's `first_seen_at`
 * shows how long a host has been vulnerable, and disappearing findings are
 * marked resolved instead of deleted.
 */
export async function scanFleetForVulnerabilities(): Promise<{
  scannedHosts: number;
  findings: number;
  newVulns: number;
}> {
  await ensureSchema();
  const db = getDb();

  const hostRows = await db.select().from(hosts);
  let scannedHosts = 0;
  let findings = 0;
  let newVulns = 0;

  for (const host of hostRows) {
    const [snap] = await db
      .select()
      .from(snapshots)
      .where(eq(snapshots.hostId, host.id))
      .orderBy(desc(snapshots.collectedAt))
      .limit(1);
    if (!snap) continue;

    const ecosystem = ecosystemFor(snap.osInfo?.name, snap.osInfo?.version);
    if (!ecosystem) continue;

    const pkgs = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.snapshotId, snap.id));
    if (pkgs.length === 0) continue;

    // `apt list --upgradable` only reports packages with an update available,
    // so the installed version is what the host is currently exposed on.
    const queries = pkgs
      .filter((p) => p.installedVersion && p.installedVersion.length > 0)
      .map((p) => ({
        packageName: p.name,
        version: p.installedVersion,
        ecosystem,
      }));
    if (queries.length === 0) continue;

    scannedHosts++;
    const hits = await queryVulnerableIds(queries);
    if (hits.size === 0) {
      await markResolvedExcept(host.id, new Set());
      continue;
    }

    const seen = new Set<string>();
    for (const [index, ids] of hits) {
      const query = queries[index];
      for (const vulnId of ids) {
        const created = await ensureVulnCached(vulnId, query.packageName);
        if (created) newVulns++;

        const fixedVersion = created?.fixedVersion ?? null;
        await db
          .insert(hostVulnerabilities)
          .values({
            hostId: host.id,
            vulnId,
            packageName: query.packageName,
            installedVersion: query.version,
            fixedVersion,
          })
          .onConflictDoUpdate({
            target: [
              hostVulnerabilities.hostId,
              hostVulnerabilities.vulnId,
              hostVulnerabilities.packageName,
            ],
            set: {
              installedVersion: query.version,
              fixedVersion,
              lastSeenAt: new Date(),
              // A finding that reappears is open again.
              resolvedAt: null,
            },
          });

        seen.add(`${vulnId}::${query.packageName}`);
        findings++;
      }
    }

    await markResolvedExcept(host.id, seen);
  }

  if (scannedHosts > 0) {
    console.log(
      `[vulns] scanned ${scannedHosts} host(s), ${findings} finding(s), ` +
        `${newVulns} new advisor${newVulns === 1 ? "y" : "ies"} cached`,
    );
  }
  return { scannedHosts, findings, newVulns };
}

/** Closes findings that no longer appear for a host. */
async function markResolvedExcept(
  hostId: number,
  stillPresent: Set<string>,
): Promise<void> {
  const db = getDb();
  const open = await db
    .select()
    .from(hostVulnerabilities)
    .where(
      and(eq(hostVulnerabilities.hostId, hostId), isNull(hostVulnerabilities.resolvedAt)),
    );

  const now = new Date();
  for (const row of open) {
    if (stillPresent.has(`${row.vulnId}::${row.packageName}`)) continue;
    await db
      .update(hostVulnerabilities)
      .set({ resolvedAt: now })
      .where(eq(hostVulnerabilities.id, row.id));
  }
}

/**
 * Ensures a vulnerability's details are cached, fetching them if absent or
 * stale. Returns the detail when it was fetched this call, else null — the
 * caller uses that only to count genuinely new advisories.
 */
async function ensureVulnCached(
  vulnId: string,
  packageName: string,
): Promise<{ fixedVersion: string | null } | null> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(vulnerabilities)
    .where(eq(vulnerabilities.id, vulnId))
    .limit(1);

  const fresh =
    existing && Date.now() - existing.fetchedAt.getTime() < DETAIL_TTL_MS;
  if (fresh) return null;

  const detail = await fetchVulnDetail(vulnId, packageName);
  if (!detail) {
    // Record the id anyway so the finding can reference it; details can be
    // filled in on a later run.
    if (!existing) {
      await db
        .insert(vulnerabilities)
        .values({ id: vulnId, severity: "UNKNOWN" })
        .onConflictDoNothing();
    }
    return null;
  }

  await db
    .insert(vulnerabilities)
    .values({
      id: detail.id,
      summary: detail.summary,
      details: detail.details,
      severity: detail.severity,
      cvssScore: detail.cvssScore,
      aliases: detail.aliases,
      publishedAt: detail.publishedAt,
      modifiedAt: detail.modifiedAt,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: vulnerabilities.id,
      set: {
        summary: detail.summary,
        details: detail.details,
        severity: detail.severity,
        cvssScore: detail.cvssScore,
        aliases: detail.aliases,
        publishedAt: detail.publishedAt,
        modifiedAt: detail.modifiedAt,
        fetchedAt: new Date(),
      },
    });

  return { fixedVersion: detail.fixedVersion };
}

/** Open vulnerabilities for one host, worst first. */
export async function getHostVulnerabilities(hostId: number): Promise<VulnRow[]> {
  const rows = await getDb()
    .select({
      id: vulnerabilities.id,
      severity: vulnerabilities.severity,
      cvssScore: vulnerabilities.cvssScore,
      summary: vulnerabilities.summary,
      aliases: vulnerabilities.aliases,
      packageName: hostVulnerabilities.packageName,
      installedVersion: hostVulnerabilities.installedVersion,
      fixedVersion: hostVulnerabilities.fixedVersion,
      firstSeenAt: hostVulnerabilities.firstSeenAt,
      publishedAt: vulnerabilities.publishedAt,
    })
    .from(hostVulnerabilities)
    .innerJoin(vulnerabilities, eq(vulnerabilities.id, hostVulnerabilities.vulnId))
    .where(
      and(eq(hostVulnerabilities.hostId, hostId), isNull(hostVulnerabilities.resolvedAt)),
    );

  return rows
    .map((r) => ({
      ...r,
      severity: r.severity as Severity,
      firstSeenAt: r.firstSeenAt.toISOString(),
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        (b.cvssScore ?? 0) - (a.cvssScore ?? 0) ||
        a.id.localeCompare(b.id),
    );
}

/** Severity tally for a host, for the summary card. */
export async function getHostVulnCounts(hostId: number): Promise<VulnCounts> {
  const { rows } = await getDb().execute<{ severity: string; n: string | number }>(sql`
    select v.severity, count(*) as n
    from host_vulnerabilities hv
    join vulnerabilities v on v.id = hv.vuln_id
    where hv.host_id = ${hostId} and hv.resolved_at is null
    group by v.severity
  `);

  const counts = emptyCounts();
  for (const row of rows) {
    const n = Number(row.n);
    counts.total += n;
    switch (row.severity) {
      case "CRITICAL":
        counts.critical += n;
        break;
      case "HIGH":
        counts.high += n;
        break;
      case "MEDIUM":
        counts.medium += n;
        break;
      case "LOW":
        counts.low += n;
        break;
      default:
        counts.unknown += n;
    }
  }
  return counts;
}

/**
 * Fleet-wide view: one row per vulnerability with the hosts it affects.
 *
 * This is the question a per-host list cannot answer — "who is exposed to
 * CVE-XXXX, and what fixes it?"
 */
export async function getFleetVulnerabilities(options?: {
  search?: string;
  minSeverity?: Severity;
  limit?: number;
}): Promise<FleetVulnRow[]> {
  const search = options?.search?.trim().toLowerCase() ?? "";
  const limit = options?.limit ?? 200;

  const { rows } = await getDb().execute<{
    id: string;
    severity: string;
    cvss_score: number | null;
    summary: string | null;
    host_count: string | number;
    hostnames: string[];
    package_names: string[];
    fixed_version: string | null;
  }>(sql`
    select v.id,
           v.severity,
           v.cvss_score,
           v.summary,
           count(distinct hv.host_id)                        as host_count,
           array_agg(distinct h.hostname)                    as hostnames,
           array_agg(distinct hv.package_name)               as package_names,
           (array_agg(hv.fixed_version) filter (where hv.fixed_version is not null))[1]
                                                             as fixed_version
    from host_vulnerabilities hv
    join vulnerabilities v on v.id = hv.vuln_id
    join hosts h on h.id = hv.host_id
    where hv.resolved_at is null
      and (
        ${search} = ''
        or lower(v.id) like ${"%" + search + "%"}
        or lower(coalesce(v.summary, '')) like ${"%" + search + "%"}
        or lower(hv.package_name) like ${"%" + search + "%"}
        or lower(h.hostname) like ${"%" + search + "%"}
      )
    group by v.id, v.severity, v.cvss_score, v.summary
    limit ${limit}
  `);

  const minRank = options?.minSeverity ? SEVERITY_RANK[options.minSeverity] : 0;

  return rows
    .map((r) => ({
      id: r.id,
      severity: r.severity as Severity,
      cvssScore: r.cvss_score,
      summary: r.summary,
      hostCount: Number(r.host_count),
      hostnames: r.hostnames ?? [],
      packageNames: r.package_names ?? [],
      fixedVersion: r.fixed_version,
    }))
    .filter((r) => SEVERITY_RANK[r.severity] >= minRank)
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        (b.cvssScore ?? 0) - (a.cvssScore ?? 0) ||
        b.hostCount - a.hostCount,
    );
}

/** Fleet-wide severity tally for the overview header. */
export async function getFleetVulnCounts(): Promise<VulnCounts> {
  const { rows } = await getDb().execute<{ severity: string; n: string | number }>(sql`
    select v.severity, count(distinct (hv.host_id, hv.vuln_id)) as n
    from host_vulnerabilities hv
    join vulnerabilities v on v.id = hv.vuln_id
    where hv.resolved_at is null
    group by v.severity
  `);

  const counts = emptyCounts();
  for (const row of rows) {
    const n = Number(row.n);
    counts.total += n;
    switch (row.severity) {
      case "CRITICAL":
        counts.critical += n;
        break;
      case "HIGH":
        counts.high += n;
        break;
      case "MEDIUM":
        counts.medium += n;
        break;
      case "LOW":
        counts.low += n;
        break;
      default:
        counts.unknown += n;
    }
  }
  return counts;
}
