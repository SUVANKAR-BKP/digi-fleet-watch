import { format, formatDistanceToNow } from "date-fns";

export function fmtAgo(iso: string | null): string {
  if (!iso) return "never";
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

export function fmtDateTime(iso: string): string {
  return format(new Date(iso), "MMM d, HH:mm");
}

export function fmtDuration(sec: number | null): string {
  if (sec === null) return "ongoing";
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3_600);
  const m = Math.floor((sec % 3_600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.length > 0 ? parts.join(" ") : `${Math.max(1, Math.round(sec))}s`;
}

export function fmtPct(n: number): string {
  return `${n.toFixed(1).replace(/\.0$/, "")}%`;
}
/**
 * Human-readable byte size. Binary units (KiB steps) shown with familiar
 * labels, which is what `df -h` and `free -h` print.
 */
export function fmtBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
