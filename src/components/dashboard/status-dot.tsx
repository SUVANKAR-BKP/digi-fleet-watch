import { cn } from "@/lib/utils";
import type { HostStatus } from "@/lib/types";

const STYLES: Record<
  HostStatus,
  { dot: string; text: string }
> = {
  online: { dot: "bg-ok", text: "text-ok" },
  stale: { dot: "bg-warn", text: "text-warn" },
  down: { dot: "bg-down", text: "text-down" },
};

const LABELS: Record<HostStatus, string> = {
  online: "Online",
  stale: "Stale",
  down: "Down",
};

export function StatusBadge({
  status,
  className,
}: {
  status: HostStatus;
  className?: string;
}) {
  const s = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-semibold",
        s.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {LABELS[status]}
    </span>
  );
}