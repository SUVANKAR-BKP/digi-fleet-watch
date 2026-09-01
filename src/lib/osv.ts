import { labelForScore, normaliseLabel, scoreFromVector, type Severity } from "./cvss";

/**
 * Minimal OSV.dev client.
 *
 * OSV is a free, key-less vulnerability database that indexes Debian and Ubuntu
 * security advisories alongside upstream ecosystems. The agent already reports
 * each host's exact package names and versions — the expensive half of
 * vulnerability scanning — so this turns that inventory into named, ranked CVEs.
 *
 * https://google.github.io/osv.dev/api/
 */

const OSV_API = "https://api.osv.dev/v1";

/** OSV accepts up to 1000 queries per batch; stay well under it. */
const BATCH_SIZE = 250;
const REQUEST_TIMEOUT_MS = 20_000;

export interface OsvQuery {
  packageName: string;
  version: string;
  /** OSV ecosystem string, e.g. "Debian:12" or "Ubuntu:24.04". */
  ecosystem: string;
}

export interface OsvVulnDetail {
  id: string;
  summary: string | null;
  details: string | null;
  severity: Severity;
  cvssScore: number | null;
  aliases: string[];
  publishedAt: Date | null;
  modifiedAt: Date | null;
  /** First fixed version OSV names for the queried package, if any. */
  fixedVersion: string | null;
}

/**
 * Maps an agent-reported OS to an OSV ecosystem.
 *
 * Returns null for anything unmappable: querying the wrong ecosystem returns
 * confidently incorrect results, which is worse than returning none.
 */
export function ecosystemFor(
  osName: string | undefined,
  osVersion: string | undefined,
): string | null {
  if (!osName || !osVersion) return null;
  const name = osName.toLowerCase();
  const version = osVersion.trim().split(" ")[0];

  if (name.includes("ubuntu")) {
    // VERSION_ID is already "24.04"; OSV wants "Ubuntu:24.04".
    return /^\d+\.\d+$/.test(version) ? `Ubuntu:${version}` : null;
  }
  if (name.includes("debian")) {
    // VERSION_ID is the major release ("12"); OSV wants "Debian:12".
    const major = version.split(".")[0];
    return /^\d+$/.test(major) ? `Debian:${major}` : null;
  }
  // Alpine/RHEL exist in OSV, but the agent does not collect their package
  // inventory yet, so there would be nothing to query.
  return null;
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

interface BatchResponse {
  results?: { vulns?: { id: string }[] }[];
}

/**
 * For each input query (by index), the OSV ids affecting it.
 *
 * `querybatch` returns ids only; details are fetched separately and cached,
 * because a single CVE typically affects many packages across many hosts.
 */
export async function queryVulnerableIds(
  queries: OsvQuery[],
): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();

  for (let offset = 0; offset < queries.length; offset += BATCH_SIZE) {
    const chunk = queries.slice(offset, offset + BATCH_SIZE);
    const { signal, done } = withTimeout(REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${OSV_API}/querybatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: chunk.map((q) => ({
            package: { name: q.packageName, ecosystem: q.ecosystem },
            version: q.version,
          })),
        }),
        signal,
      });
      if (!res.ok) {
        console.warn(`[osv] querybatch returned ${res.status}; skipping chunk`);
        continue;
      }
      const json = (await res.json()) as BatchResponse;
      json.results?.forEach((result, i) => {
        const ids = (result.vulns ?? []).map((v) => v.id);
        if (ids.length > 0) out.set(offset + i, ids);
      });
    } catch (err) {
      // A network hiccup must not fail the whole scan; the next run retries.
      console.warn(`[osv] querybatch failed: ${(err as Error).message}`);
    } finally {
      done();
    }
  }

  return out;
}

interface OsvVulnResponse {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  published?: string;
  modified?: string;
  severity?: { type?: string; score?: string }[];
  database_specific?: { severity?: string };
  affected?: {
    package?: { name?: string; ecosystem?: string };
    ranges?: { events?: { introduced?: string; fixed?: string }[] }[];
    database_specific?: { severity?: string };
  }[];
}

/**
 * Derives a score and rating.
 *
 * Preference order: a real CVSS vector (computed exactly), then a bare numeric
 * score, then the distro's qualitative rating. Debian and Ubuntu advisories
 * often carry only the last of those.
 */
function deriveSeverity(v: OsvVulnResponse): { score: number | null; label: Severity } {
  for (const entry of v.severity ?? []) {
    if (!entry.score) continue;

    const fromVector = scoreFromVector(entry.score);
    if (fromVector !== null) {
      return { score: fromVector, label: labelForScore(fromVector) };
    }

    const numeric = Number(entry.score);
    if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 10) {
      return { score: numeric, label: labelForScore(numeric) };
    }
  }

  const textual =
    v.database_specific?.severity ??
    v.affected?.find((a) => a.database_specific?.severity)?.database_specific?.severity;
  return { score: null, label: normaliseLabel(textual) };
}

/** Full details for one vulnerability id. */
export async function fetchVulnDetail(
  id: string,
  packageName?: string,
): Promise<OsvVulnDetail | null> {
  const { signal, done } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${OSV_API}/vulns/${encodeURIComponent(id)}`, { signal });
    if (!res.ok) return null;
    const v = (await res.json()) as OsvVulnResponse;

    const { score, label } = deriveSeverity(v);

    // First "fixed" event for the package we asked about.
    let fixedVersion: string | null = null;
    for (const affected of v.affected ?? []) {
      if (packageName && affected.package?.name !== packageName) continue;
      for (const range of affected.ranges ?? []) {
        const fixed = range.events?.find((e) => e.fixed)?.fixed;
        if (fixed) {
          fixedVersion = fixed;
          break;
        }
      }
      if (fixedVersion) break;
    }

    return {
      id: v.id,
      summary: v.summary ?? null,
      // Advisory bodies can be very long; the UI only shows an excerpt.
      details: v.details ? v.details.slice(0, 4000) : null,
      severity: label,
      cvssScore: score,
      aliases: v.aliases ?? [],
      publishedAt: v.published ? new Date(v.published) : null,
      modifiedAt: v.modified ? new Date(v.modified) : null,
      fixedVersion,
    };
  } catch (err) {
    console.warn(`[osv] failed to fetch ${id}: ${(err as Error).message}`);
    return null;
  } finally {
    done();
  }
}
