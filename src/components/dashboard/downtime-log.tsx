import { TriangleAlert } from "lucide-react";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import type { DowntimeEventRow } from "@/lib/types";

export function DowntimeLog({ events }: { events: DowntimeEventRow[] }) {
  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No recorded downtime in the last 30 days.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {events.map((e) => {
        const ongoing = e.endedAt === null;
        return (
          <li key={e.id} className="flex items-center gap-3 py-2.5 text-xs">
            <span
              className={
                ongoing
                  ? "h-2 w-2 shrink-0 rounded-full bg-down"
                  : "h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50"
              }
            />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-foreground">
                {fmtDateTime(e.startedAt)}
                <span className="mx-1.5 text-muted-foreground">→</span>
                {e.endedAt ? (
                  <span className="font-mono">{fmtDateTime(e.endedAt)}</span>
                ) : (
                  <span className="font-semibold text-down">now (ongoing)</span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-muted-foreground">
                <span>
                  duration{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {fmtDuration(e.durationSec)}
                  </span>
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <TriangleAlert className="h-3 w-3" />
                  {e.detectedBy === "heartbeat_miss"
                    ? "heartbeat miss"
                    : "external probe"}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}