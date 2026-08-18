"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtDuration, fmtPct } from "@/lib/format";
import type { UptimeDay } from "@/lib/types";

function tickHours(sec: number): string {
  if (sec < 120) return `${sec}m`;
  return `${Math.round(sec / 60)}h`;
}

export function UptimeChart({ data }: { data: UptimeDay[] }) {
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="2 4"
            stroke="hsl(var(--border))"
            vertical={false}
          />
          <XAxis
            dataKey="day"
            interval={4}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickFormatter={(d: string) => d.slice(5).replace("-", "/")}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            width={34}
            tickFormatter={(v: number) => tickHours(v)}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as UptimeDay;
              return (
                <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg">
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {d.day}
                  </div>
                  <div className="mt-0.5 font-semibold text-foreground">
                    uptime {fmtPct(d.uptimePct)}
                  </div>
                  <div
                    className={
                      d.downtimeSec > 0
                        ? "font-medium text-security"
                        : "text-muted-foreground"
                    }
                  >
                    down {fmtDuration(d.downtimeSec)}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="downtimeSec" maxBarSize={10} radius={[2, 2, 0, 0]}>
            {data.map((d) => (
              <Cell
                key={d.day}
                fill={
                  d.downtimeSec > 0
                    ? "hsl(var(--warn))"
                    : "hsl(var(--muted))"
                }
                opacity={d.downtimeSec > 0 ? 1 : 0.5}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}