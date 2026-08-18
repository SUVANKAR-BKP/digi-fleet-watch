import Link from "next/link";
import {
  Activity,
  Container,
  PackageSearch,
  ShieldAlert,
} from "lucide-react";
import { fmtAgo, fmtPct } from "@/lib/format";
import type { HostSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-dot";

function Stat({ icon, label, value, className }: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <div className={cn("truncate font-mono text-sm font-semibold", className)}>
          {value}
        </div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

export function HostCard({ host }: { host: HostSummary }) {
  const noUpdates = host.outdatedPackages === 0;
  return (
    <Link
      href={`/hosts/${host.id}`}
      className="group block rounded-xl border border-border bg-card transition-colors hover:border-primary/50"
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-sm font-semibold">
              {host.hostname}
            </span>
            {host.label ? (
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                {host.label}
              </span>
            ) : null}
          </div>
          <StatusBadge status={host.status} />
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-3">
          <Stat
            icon={<PackageSearch className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label="outdated packages"
            value={
              noUpdates ? (
                "none"
              ) : (
                <>
                  {host.outdatedPackages}
                  {host.securityPackages > 0 ? (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-security">
                      <ShieldAlert className="h-3 w-3" />
                      {host.securityPackages}
                    </span>
                  ) : null}
                </>
              )
            }
            className={noUpdates ? "text-muted-foreground" : "text-warn"}
          />

          <Stat
            icon={<Container className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label="docker engine"
            value={
              host.dockerInstalled ? (
                <>
                  {host.dockerEngineVersion}
                  {host.dockerDeprecated ? (
                    <span className="ml-1.5 rounded border border-security/60 bg-security/10 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-security">
                      EOL
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            className={host.dockerDeprecated ? "text-security" : undefined}
          />

          <Stat
            icon={<Activity className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label="uptime · 30d"
            value={fmtPct(host.uptimePct30d)}
            className={host.uptimePct30d >= 99.9 ? "text-ok" : "text-warn"}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{host.osLabel ?? "unknown OS"}</span>
          <span className="tabular-nums">seen {fmtAgo(host.lastSeenAt)}</span>
        </div>
      </div>
    </Link>
  );
}