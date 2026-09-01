"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Cpu, HardDrive, MemoryStick } from "lucide-react";
import { fmtBytes } from "@/lib/format";
import { DISK_CRITICAL_PCT, DISK_WARN_PCT } from "@/lib/thresholds";
import type { MetricPoint, MetricsSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Colour a usage percentage by how alarming it is. */
function usageTone(pct: number | null): string {
  if (pct === null) return "text-muted-foreground";
  if (pct >= DISK_CRITICAL_PCT) return "text-down";
  if (pct >= DISK_WARN_PCT) return "text-warn";
  return "text-ok";
}

function barTone(pct: number): string {
  if (pct >= DISK_CRITICAL_PCT) return "bg-down";
  if (pct >= DISK_WARN_PCT) return "bg-warn";
  return "bg-primary";
}

function fmtUptime(seconds: number | null): string {
  if (seconds === null) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((seconds % 3_600) / 60);
  return `${hours}h ${mins}m`;
}

export function ResourcePanel({
  metrics,
  history,
}: {
  metrics: MetricsSnapshot | null;
  history: MetricPoint[];
}) {
  if (!metrics) {
    return (
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Cpu className="h-4 w-4 text-primary" />
          Resources
        </h2>
        <p className="text-sm text-muted-foreground">
          No resource samples yet. Hosts running an agent older than v2 report
          packages and Docker only — re-run the Add Host command to upgrade it.
        </p>
      </section>
    );
  }

  const chartData = history.map((p) => ({
    t: new Date(p.t).getTime(),
    cpu: p.cpuPct,
    mem: p.memUsedPct,
  }));

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Cpu className="h-4 w-4 text-primary" />
          Resources
        </h2>
        <span className="text-xs text-muted-foreground">
          up {fmtUptime(metrics.uptimeSeconds)}
          {metrics.processCount !== null && ` · ${metrics.processCount} procs`}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          icon={<Cpu className="h-3.5 w-3.5" />}
          label="CPU"
          value={metrics.cpuPct === null ? "—" : `${metrics.cpuPct.toFixed(0)}%`}
          tone={usageTone(metrics.cpuPct)}
          sub={
            metrics.load1 !== null
              ? `load ${metrics.load1.toFixed(2)} / ${metrics.load5?.toFixed(2) ?? "—"} / ${metrics.load15?.toFixed(2) ?? "—"}` +
                (metrics.cpuCores ? ` · ${metrics.cpuCores} cores` : "")
              : undefined
          }
        />
        <Stat
          icon={<MemoryStick className="h-3.5 w-3.5" />}
          label="Memory"
          value={
            metrics.memUsedPct === null ? "—" : `${metrics.memUsedPct.toFixed(0)}%`
          }
          tone={usageTone(metrics.memUsedPct)}
          sub={
            metrics.memTotalBytes
              ? `${fmtBytes(metrics.memUsedBytes ?? 0)} of ${fmtBytes(metrics.memTotalBytes)}`
              : undefined
          }
        />
        <Stat
          icon={<HardDrive className="h-3.5 w-3.5" />}
          label="Swap"
          value={
            metrics.swapTotalBytes && metrics.swapTotalBytes > 0
              ? `${(((metrics.swapUsedBytes ?? 0) / metrics.swapTotalBytes) * 100).toFixed(0)}%`
              : "off"
          }
          tone="text-muted-foreground"
          sub={
            metrics.swapTotalBytes
              ? `${fmtBytes(metrics.swapUsedBytes ?? 0)} of ${fmtBytes(metrics.swapTotalBytes)}`
              : undefined
          }
        />
      </div>

      {chartData.length > 1 && (
        <div className="mt-4 h-32">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <defs>
                <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) =>
                  new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                }
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                minTickGap={40}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                width={40}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                formatter={(value, name) => [
                  `${Number(value).toFixed(1)}%`,
                  name === "cpu" ? "CPU" : "Memory",
                ]}
              />
              <Area
                type="monotone"
                dataKey="cpu"
                stroke="hsl(var(--primary))"
                fill="url(#cpuFill)"
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
              <Area
                type="monotone"
                dataKey="mem"
                stroke="hsl(var(--muted-foreground))"
                fill="none"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                dot={false}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
          <p className="mt-1 text-center text-[10px] text-muted-foreground">
            CPU (solid) and memory (dashed), last 24 hours
          </p>
        </div>
      )}

      {metrics.disks.length > 0 && (
        <div className="mt-4 space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground">Filesystems</h3>
          {metrics.disks.map((d) => (
            <div key={d.mount} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-mono">{d.mount}</span>
                <span className={cn("tabular-nums", usageTone(d.usePct))}>
                  {d.usePct.toFixed(0)}% · {fmtBytes(d.availableBytes)} free
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn("h-full rounded-full transition-all", barTone(d.usePct))}
                  style={{ width: `${Math.min(100, d.usePct)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className={cn("mt-1 font-mono text-xl font-semibold tabular-nums", tone)}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
