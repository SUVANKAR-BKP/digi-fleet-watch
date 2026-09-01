import Link from "next/link";
import {
  Activity,
  Container,
  Cpu,
  HardDrive,
  MemoryStick,
  PackageSearch,
  ShieldAlert,
} from "lucide-react";
import { fmtAgo, fmtPct } from "@/lib/format";
import { DISK_CRITICAL_PCT, DISK_WARN_PCT } from "@/lib/thresholds";
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

function usageTone(pct: number | null): string {
  if (pct === null) return "text-muted-foreground";
  if (pct >= DISK_CRITICAL_PCT) return "text-down";
  if (pct >= DISK_WARN_PCT) return "text-warn";
  return "text-foreground";
}

function Meter({
  icon,
  label,
  pct,
}: {
  icon: React.ReactNode;
  label: string;
  pct: number | null;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          {icon}
          {label}
        </span>
        <span className={cn("font-mono tabular-nums", usageTone(pct))}>
          {pct === null ? "—" : `${pct.toFixed(0)}%`}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pct === null
              ? "bg-transparent"
              : pct >= DISK_CRITICAL_PCT
                ? "bg-down"
                : pct >= DISK_WARN_PCT
                  ? "bg-warn"
                  : "bg-primary/70",
          )}
          style={{ width: pct === null ? "0%" : `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

export function HostCard({ host }: { host: HostSummary }) {
  const noUpdates = host.outdatedPackages === 0;
  const hasMetrics =
    host.cpuPct !== null || host.memUsedPct !== null || host.maxDiskUsePct !== null;
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
          <div className="flex shrink-0 items-center gap-1.5">
            {host.diskAlert && (
              <span
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  host.maxDiskUsePct !== null && host.maxDiskUsePct >= DISK_CRITICAL_PCT
                    ? "border-down/60 bg-down/10 text-down"
                    : "border-warn/60 bg-warn/10 text-warn",
                )}
              >
                disk {host.maxDiskUsePct?.toFixed(0)}%
              </span>
            )}
            <StatusBadge status={host.status} />
          </div>
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

        {hasMetrics && (
          <div className="grid grid-cols-3 gap-3 border-t border-border pt-3">
            <Meter
              icon={<Cpu className="h-3 w-3" strokeWidth={1.8} />}
              label="cpu"
              pct={host.cpuPct}
            />
            <Meter
              icon={<MemoryStick className="h-3 w-3" strokeWidth={1.8} />}
              label="mem"
              pct={host.memUsedPct}
            />
            <Meter
              icon={<HardDrive className="h-3 w-3" strokeWidth={1.8} />}
              label="disk"
              pct={host.maxDiskUsePct}
            />
          </div>
        )}

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{host.osLabel ?? "unknown OS"}</span>
          <span className="tabular-nums">seen {fmtAgo(host.lastSeenAt)}</span>
        </div>
      </div>
    </Link>
  );
}