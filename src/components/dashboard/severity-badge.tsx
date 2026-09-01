import type { Severity } from "@/lib/cvss";
import { cn } from "@/lib/utils";

const TONES: Record<Severity, string> = {
  CRITICAL: "border-down/60 bg-down/15 text-down",
  HIGH: "border-security/60 bg-security/15 text-security",
  MEDIUM: "border-warn/60 bg-warn/15 text-warn",
  LOW: "border-border bg-secondary text-muted-foreground",
  NONE: "border-border bg-secondary text-muted-foreground",
  UNKNOWN: "border-border bg-secondary text-muted-foreground",
};

/** Severity chip, optionally with the CVSS base score alongside. */
export function SeverityBadge({
  severity,
  score,
  className,
}: {
  severity: Severity;
  score?: number | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        TONES[severity] ?? TONES.UNKNOWN,
        className,
      )}
    >
      {severity}
      {score !== null && score !== undefined && (
        <span className="font-mono tabular-nums opacity-80">{score.toFixed(1)}</span>
      )}
    </span>
  );
}
