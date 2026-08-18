"use client";

import { useMemo } from "react";
import type { ContainerRow } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "danger" | "muted";

const STATUS_TONE: Record<string, Tone> = {
  running: "ok",
  exited: "danger",
  dead: "danger",
  restarting: "warn",
  paused: "warn",
  created: "muted",
  removing: "muted",
};

const HEALTH_TONE: Record<string, Tone> = {
  healthy: "ok",
  unhealthy: "danger",
  starting: "warn",
  none: "muted",
};

/**
 * Containers in the latest snapshot, sorted with problems on top
 * (exited / restarting / paused before running), then by name. The
 * is_unpinned_latest badge flags drift risk; see README for the caveat that
 * this is a proxy and NOT a registry comparison.
 */
export function ContainerTable({ containers }: { containers: ContainerRow[] }) {
  const rows = useMemo(() => {
    const rank = (r: ContainerRow): number => {
      switch (r.status) {
        case "exited":
        case "dead":
          return 0;
        case "restarting":
        case "paused":
          return 1;
        case "running":
          return 3;
        default:
          return 2;
      }
    };
    return [...containers].sort(
      (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
    );
  }, [containers]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No containers reported in this snapshot.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-secondary/50 text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Name</th>
            <th className="px-3 py-2 font-semibold">Image</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold">Health</th>
            <th className="px-3 py-2 font-semibold">Restarts</th>
            <th className="px-3 py-2 font-semibold">Age</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr
              key={c.id}
              className="border-b border-border/60 last:border-0 hover:bg-secondary/40"
            >
              <td className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono font-medium text-foreground">
                    {c.name}
                  </span>
                  {c.isUnpinnedLatest && (
                    <span
                      title="Image is tagged :latest or has no tag — not pinned to a reproducible version."
                      className="rounded border border-warn/50 bg-warn/10 px-1.5 py-0.5 text-[10px] font-semibold text-warn"
                    >
                      unpinned (:latest)
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2">
                <span className="font-mono text-muted-foreground">
                  {c.image}
                </span>
                {c.imageDigest ? (
                  <span
                    title={c.imageDigest}
                    className="ml-1.5 font-mono text-[10px] text-muted-foreground/60"
                  >
                    {shortDigest(c.imageDigest)}
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2">
                <Pill tone={STATUS_TONE[c.status] ?? "muted"}>
                  {c.status}
                </Pill>
              </td>
              <td className="px-3 py-2">
                {c.healthStatus ? (
                  <Pill tone={HEALTH_TONE[c.healthStatus] ?? "muted"}>
                    {c.healthStatus}
                  </Pill>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">
                {c.restartCount}
              </td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">
                {formatAge(c.ageDays)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const cls: Record<Tone, string> = {
    ok: "border-ok/50 bg-ok/10 text-ok",
    warn: "border-warn/50 bg-warn/10 text-warn",
    danger: "border-security/50 bg-security/10 text-security",
    muted: "border-border bg-secondary text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium",
        cls[tone],
      )}
    >
      {children}
    </span>
  );
}

function shortDigest(d: string): string {
  const piece = d.replace(/^sha256:/, "");
  return `sha256:${piece.slice(0, 12)}`;
}

function formatAge(ageDays: number | null): string {
  if (ageDays === null || Number.isNaN(ageDays)) return "—";
  if (ageDays < 1) return `${(ageDays * 24).toFixed(0)}h`;
  return `${ageDays.toFixed(1)}d`;
}
