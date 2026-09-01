import { redirect } from "next/navigation";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { SeverityBadge } from "@/components/dashboard/severity-badge";
import { getCurrentUser } from "@/lib/auth-server";
import { dbAvailable } from "@/lib/data";
import { getFleetVulnCounts, getFleetVulnerabilities } from "@/lib/vulnerabilities";

export const dynamic = "force-dynamic";

export const metadata = { title: "Vulnerabilities" };

/**
 * Fleet-wide vulnerability view: one row per advisory, with the hosts it
 * affects. This is the question a per-host list cannot answer — "who is
 * exposed to CVE-XXXX, and what fixes it?"
 */
export default async function VulnerabilitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { q } = await searchParams;
  const search = q?.trim() ?? "";

  if (!(await dbAvailable())) {
    return (
      <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
        Vulnerability scanning needs a live database. Deploy with docker-compose
        to collect real fleet data.
      </div>
    );
  }

  const [rows, counts] = await Promise.all([
    getFleetVulnerabilities({ search }),
    getFleetVulnCounts(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Vulnerabilities</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {counts.total} open finding{counts.total === 1 ? "" : "s"} across the
            fleet, matched against OSV.dev.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <Tally label="critical" n={counts.critical} tone="border-down/50 bg-down/10 text-down" />
          <Tally label="high" n={counts.high} tone="border-security/50 bg-security/10 text-security" />
          <Tally label="medium" n={counts.medium} tone="border-warn/50 bg-warn/10 text-warn" />
          <Tally label="low" n={counts.low} tone="border-border bg-secondary text-muted-foreground" />
        </div>
      </div>

      <form className="max-w-md" action="/vulnerabilities">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Search CVE, package or hostname…"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
        />
      </form>

      {rows.length === 0 ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-ok" />
          {search
            ? `Nothing matches "${search}".`
            : "No known vulnerabilities across the fleet. Scans run every 6 hours."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Severity</th>
                <th className="px-3 py-2 text-left font-medium">Advisory</th>
                <th className="px-3 py-2 text-left font-medium">Packages</th>
                <th className="px-3 py-2 text-left font-medium">Affected hosts</th>
                <th className="px-3 py-2 text-left font-medium">Fixed in</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <SeverityBadge severity={v.severity} score={v.cvssScore} />
                  </td>
                  <td className="max-w-md px-3 py-2">
                    <a
                      href={`https://osv.dev/vulnerability/${encodeURIComponent(v.id)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {v.id}
                    </a>
                    {v.summary && (
                      <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                        {v.summary}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {v.packageNames.slice(0, 3).join(", ")}
                    {v.packageNames.length > 3 && ` +${v.packageNames.length - 3}`}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className="font-semibold tabular-nums">{v.hostCount}</span>
                    <span className="ml-1.5 text-muted-foreground">
                      {v.hostnames.slice(0, 3).join(", ")}
                      {v.hostnames.length > 3 && ` +${v.hostnames.length - 3}`}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {v.fixedVersion ? (
                      <span className="text-ok">{v.fixedVersion}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        <ShieldAlert className="mr-1 inline h-3 w-3" />
        Findings come from matching each host&rsquo;s exact installed package
        versions against <Link href="https://osv.dev" className="text-primary hover:underline">OSV.dev</Link>.
        Only Debian and Ubuntu hosts are scanned; other distributions report no
        package inventory yet.
      </p>
    </div>
  );
}

function Tally({ label, n, tone }: { label: string; n: number; tone: string }) {
  if (n === 0) return null;
  return (
    <span className={`rounded-full border px-2 py-1 font-medium ${tone}`}>
      {n} {label}
    </span>
  );
}
