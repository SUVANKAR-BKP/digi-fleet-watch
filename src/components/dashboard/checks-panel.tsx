"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check as CheckIcon,
  ChevronDown,
  ChevronRight,
  Globe,
  Link2,
  Loader2,
  Network,
  Plug,
  Play,
  Plus,
  Radio,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  addCheck,
  fetchIncidents,
  probeNow,
  removeCheck,
  toggleCheck,
} from "@/app/actions/checks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ASSERTION_KINDS,
  ASSERTION_LABELS,
  CERT_CRITICAL_DAYS,
  CERT_WARN_DAYS,
  CHECK_DESCRIPTIONS,
  CHECK_LABELS,
  CHECK_TARGET_HINTS,
  CHECK_TYPES,
  STATUS_LABELS,
  SUPPRESSION_LABELS,
  type AssertionKind,
  type CheckRow,
  type CheckType,
  type Incident,
  type UptimeWindow,
} from "@/lib/check-types";
import { fmtAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const INTERVALS = [
  { seconds: 60, label: "1 minute" },
  { seconds: 300, label: "5 minutes" },
  { seconds: 900, label: "15 minutes" },
  { seconds: 3600, label: "1 hour" },
  { seconds: 86400, label: "1 day" },
];

const TYPE_ICONS: Record<CheckType, React.ReactNode> = {
  tcp: <Plug className="h-3.5 w-3.5" />,
  http: <Globe className="h-3.5 w-3.5" />,
  tls: <ShieldCheck className="h-3.5 w-3.5" />,
  dns: <Network className="h-3.5 w-3.5" />,
  ping: <Radio className="h-3.5 w-3.5" />,
};

/** Only these produce a body worth asserting on. */
const ASSERTABLE: readonly CheckType[] = ["http", "dns"];

/** Coloured pill for the last result, including the degraded middle state. */
function StatusPill({ check }: { check: CheckRow }) {
  const status = check.lastStatus ?? (check.lastOk === null ? null : check.lastOk ? "ok" : "down");

  if (status === null) {
    return (
      <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
        not yet run
      </span>
    );
  }

  const tone =
    status === "ok"
      ? "border-ok/40 bg-ok/10 text-ok"
      : status === "degraded"
        ? "border-warn/40 bg-warn/10 text-warn"
        : "border-down/40 bg-down/10 text-down";

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", tone)}>
        {status === "down"
          ? `${STATUS_LABELS.down} ×${check.consecutiveFailures}`
          : STATUS_LABELS[status]}
      </span>
      {check.suppressedBy && (
        <span
          className="rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
          title="Failing, but alerts are held back for this reason"
        >
          {SUPPRESSION_LABELS[check.suppressedBy]}
        </span>
      )}
    </div>
  );
}

/** Certificate expiry, coloured by urgency. */
function CertBadge({ days }: { days: number | null }) {
  if (days === null) return null;
  const tone =
    days < 0
      ? "border-down/50 bg-down/10 text-down"
      : days <= CERT_CRITICAL_DAYS
        ? "border-down/50 bg-down/10 text-down"
        : days <= CERT_WARN_DAYS
          ? "border-warn/50 bg-warn/10 text-warn"
          : "border-border bg-secondary text-muted-foreground";
  return (
    <span className={cn("ml-2 rounded-full border px-1.5 py-0.5 text-[10px]", tone)}>
      {days < 0 ? `expired ${Math.abs(days)}d ago` : `cert ${days}d`}
    </span>
  );
}

function pct(w: UptimeWindow): string {
  return w.uptimePct === null ? "—" : `${w.uptimePct.toFixed(1)}%`;
}

function uptimeTone(w: UptimeWindow): string {
  if (w.uptimePct === null) return "text-muted-foreground";
  if (w.uptimePct >= 99.9) return "text-ok";
  if (w.uptimePct >= 99) return "text-warn";
  return "text-down";
}

/** Error budget bar. Full and green is good; over 100% is red. */
function BudgetBar({ check }: { check: CheckRow }) {
  if (!check.budget) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const { consumed, remainingMinutes, target, breached } = check.budget;
  const filled = Math.min(100, Math.max(0, consumed * 100));

  return (
    <div className="min-w-[7rem] space-y-1">
      <div className="flex items-baseline justify-between gap-2 font-mono text-[11px] tabular-nums">
        <span className={breached ? "text-down" : "text-muted-foreground"}>
          {target}%
        </span>
        <span className={breached ? "text-down" : "text-muted-foreground"}>
          {Number.isFinite(remainingMinutes)
            ? `${remainingMinutes >= 0 ? "" : "−"}${Math.abs(Math.round(remainingMinutes))}m`
            : "—"}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn("h-full rounded-full", breached ? "bg-down" : "bg-ok")}
          style={{ width: `${filled}%` }}
        />
      </div>
    </div>
  );
}

function IncidentList({ incidents }: { incidents: Incident[] }) {
  if (incidents.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        No incidents in the last 30 days.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {incidents.map((inc) => (
        <li key={inc.startedAt} className="flex flex-wrap items-baseline gap-2 text-[11px]">
          <span className="font-mono tabular-nums text-muted-foreground">
            {new Date(inc.startedAt).toLocaleString()}
          </span>
          <span
            className={cn(
              "rounded-full border px-1.5 py-0.5 text-[10px]",
              inc.endedAt === null
                ? "border-down/50 bg-down/10 text-down"
                : "border-border bg-secondary text-muted-foreground",
            )}
          >
            {inc.endedAt === null ? "ongoing" : `${inc.durationMinutes}m`}
          </span>
          {inc.detail && <span className="text-muted-foreground">{inc.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

export function ChecksPanel({
  checks,
  hosts,
  channels = [],
  defaultHostId = null,
  compact = false,
}: {
  checks: CheckRow[];
  hosts: { id: number; hostname: string }[];
  /** Notification channels a check can be routed to. Empty hides the picker. */
  channels?: { id: number; name: string }[];
  /** Pre-selects a host when embedded on that host's page. */
  defaultHostId?: number | null;
  /** Hides the host column and picker. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [name, setName] = useState("");
  const [type, setType] = useState<CheckType>("http");
  const [target, setTarget] = useState("");
  const [expectedStatus, setExpectedStatus] = useState("");
  const [assertionKind, setAssertionKind] = useState<AssertionKind>("none");
  const [assertionValue, setAssertionValue] = useState("");
  const [assertionPath, setAssertionPath] = useState("");
  const [degradedAboveMs, setDegradedAboveMs] = useState("");
  const [attempts, setAttempts] = useState("2");
  const [dependsOn, setDependsOn] = useState("none");
  const [sloTarget, setSloTarget] = useState("");
  const [alertChannel, setAlertChannel] = useState("none");
  const [insecureTls, setInsecureTls] = useState(false);
  const [interval, setInterval] = useState("300");
  const [hostId, setHostId] = useState<string>(
    defaultHostId === null ? "none" : String(defaultHostId),
  );

  // Incident history is fetched only when a row is opened: the query scans a
  // month of results, and most rows are never expanded.
  const [expanded, setExpanded] = useState<number | null>(null);
  const [incidents, setIncidents] = useState<Record<number, Incident[]>>({});

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else {
        setMessage(res.message ?? "Done.");
        router.refresh();
      }
    });
  }

  function toggleExpanded(id: number) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (incidents[id]) return;
    startTransition(async () => {
      const res = await fetchIncidents(id);
      if (res.ok && res.incidents) {
        setIncidents((prev) => ({ ...prev, [id]: res.incidents! }));
      }
    });
  }

  const canAssert = ASSERTABLE.includes(type);
  const columnCount = compact ? 8 : 9;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] leading-4 text-muted-foreground">
          Probes run from this server, so they also cover what the agent cannot
          report: the host being unreachable from outside.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          onClick={() => setShowForm((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add check
        </Button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="public site"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Type</label>
              <Select
                value={type}
                onValueChange={(v) => {
                  setType(v as CheckType);
                  // A body assertion on a TCP check could never fail, so it is
                  // cleared rather than silently carried over and ignored.
                  if (!ASSERTABLE.includes(v as CheckType)) setAssertionKind("none");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHECK_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {CHECK_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 lg:col-span-2">
              <label className="text-xs text-muted-foreground">Target</label>
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={CHECK_TARGET_HINTS[type]}
              />
            </div>

            {type === "http" && (
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  Expected status <span className="opacity-60">(optional)</span>
                </label>
                <Input
                  value={expectedStatus}
                  onChange={(e) => setExpectedStatus(e.target.value)}
                  inputMode="numeric"
                  placeholder="any 2xx/3xx"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Every</label>
              <Select value={interval} onValueChange={setInterval}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVALS.map((i) => (
                    <SelectItem key={i.seconds} value={String(i.seconds)}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!compact && (
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Host</label>
                <Select value={hostId} onValueChange={setHostId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not tied to a host</SelectItem>
                    {hosts.map((h) => (
                      <SelectItem key={h.id} value={String(h.id)}>
                        {h.hostname}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground">
            {CHECK_DESCRIPTIONS[type]}
          </p>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showAdvanced ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Assertions, thresholds and alerting
          </button>

          {showAdvanced && (
            <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
              {canAssert && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">
                      Body assertion
                    </label>
                    <Select
                      value={assertionKind}
                      onValueChange={(v) => setAssertionKind(v as AssertionKind)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSERTION_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {ASSERTION_LABELS[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {assertionKind === "json_path" && (
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">JSON path</label>
                      <Input
                        value={assertionPath}
                        onChange={(e) => setAssertionPath(e.target.value)}
                        placeholder="data.db.healthy"
                      />
                    </div>
                  )}

                  {assertionKind !== "none" && (
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">
                        Expected value
                      </label>
                      <Input
                        value={assertionValue}
                        onChange={(e) => setAssertionValue(e.target.value)}
                        placeholder={assertionKind === "regex" ? "v\\d+\\.\\d+" : "ok"}
                      />
                    </div>
                  )}
                </>
              )}

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  Degraded above <span className="opacity-60">(ms)</span>
                </label>
                <Input
                  value={degradedAboveMs}
                  onChange={(e) => setDegradedAboveMs(e.target.value)}
                  inputMode="numeric"
                  placeholder="no threshold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Attempts per run</label>
                <Select value={attempts} onValueChange={setAttempts}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n === 1 ? "1 (no retry)" : `${n}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  Depends on <span className="opacity-60">(optional)</span>
                </label>
                <Select value={dependsOn} onValueChange={setDependsOn}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nothing upstream</SelectItem>
                    {checks.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  SLO target <span className="opacity-60">(%)</span>
                </label>
                <Input
                  value={sloTarget}
                  onChange={(e) => setSloTarget(e.target.value)}
                  inputMode="decimal"
                  placeholder="99.9"
                />
              </div>

              {type === "http" && (
                <label className="flex items-start gap-2 sm:col-span-2 lg:col-span-4">
                  <Checkbox
                    checked={insecureTls}
                    onCheckedChange={(v) => setInsecureTls(v === true)}
                    className="mt-0.5"
                  />
                  <span className="text-xs leading-4">
                    Ignore certificate errors
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      Needed for a self-signed certificate, a private CA, or
                      HTTPS on a bare IP — where no certificate can match the
                      address. The check then reports availability only, and
                      cannot warn you about the certificate itself.
                    </span>
                  </span>
                </label>
              )}

              {channels.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">
                    Alert channel <span className="opacity-60">(optional)</span>
                  </label>
                  <Select value={alertChannel} onValueChange={setAlertChannel}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">All eligible channels</SelectItem>
                      {channels.map((ch) => (
                        <SelectItem key={ch.id} value={String(ch.id)}>
                          {ch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <p className="text-[11px] leading-4 text-muted-foreground sm:col-span-2 lg:col-span-4">
                While the upstream check is down this one records results but
                raises no alerts, so one dead router does not page for every
                service behind it.
              </p>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              disabled={pending}
              className="gap-1.5"
              onClick={() =>
                run(async () => {
                  const res = await addCheck({
                    hostId: hostId === "none" ? null : Number(hostId),
                    name,
                    type,
                    target,
                    expectedStatus,
                    assertionKind,
                    assertionValue,
                    assertionPath,
                    degradedAboveMs,
                    attempts,
                    insecureTls,
                    dependsOnCheckId: dependsOn === "none" ? "" : dependsOn,
                    sloTarget,
                    alertChannelId: alertChannel === "none" ? "" : alertChannel,
                    intervalSeconds: interval,
                  });
                  if (res.ok) {
                    setName("");
                    setTarget("");
                    setExpectedStatus("");
                    setAssertionKind("none");
                    setAssertionValue("");
                    setAssertionPath("");
                    setDegradedAboveMs("");
                    setSloTarget("");
                    setDependsOn("none");
                    setAlertChannel("none");
                    setInsecureTls(false);
                    setShowForm(false);
                  }
                  return res;
                })
              }
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {checks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No checks yet. Add one to watch a port, an HTTP endpoint, a DNS record,
          a TLS certificate or a route.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="w-6 px-2 py-2" />
                <th className="px-3 py-2 text-left font-medium">Check</th>
                {!compact && <th className="px-3 py-2 text-left font-medium">Host</th>}
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">
                  Latency
                  <span className="ml-1 opacity-60">last / p95</span>
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  Uptime
                  <span className="ml-1 opacity-60">24h / 7d / 30d</span>
                </th>
                <th className="px-3 py-2 text-left font-medium">Error budget</th>
                <th className="px-3 py-2 text-left font-medium">Last run</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <Fragment key={c.id}>
                  <tr className="border-t border-border align-top">
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(c.id)}
                        className="text-muted-foreground hover:text-foreground"
                        title="Incident history"
                      >
                        {expanded === c.id ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>

                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5 font-medium">
                        <span className="text-muted-foreground">{TYPE_ICONS[c.type]}</span>
                        {c.name}
                        {!c.enabled && (
                          <span className="rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            paused
                          </span>
                        )}
                        <CertBadge days={c.certDaysRemaining} />
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {c.target}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                        {c.dependsOnName && (
                          <span className="inline-flex items-center gap-1">
                            <Link2 className="h-3 w-3" />
                            after {c.dependsOnName}
                          </span>
                        )}
                        {c.alertChannelName && (
                          <span className="inline-flex items-center gap-1">
                            <Send className="h-3 w-3" />
                            {c.alertChannelName}
                          </span>
                        )}
                      </div>
                      {c.lastDetail && c.lastStatus !== "ok" && (
                        <div
                          className={cn(
                            "mt-0.5 text-[11px]",
                            c.lastStatus === "degraded" ? "text-warn" : "text-down",
                          )}
                        >
                          {c.lastDetail}
                        </div>
                      )}
                    </td>

                    {!compact && (
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {c.hostname ?? "—"}
                      </td>
                    )}

                    <td className="px-3 py-2">
                      <StatusPill check={c} />
                    </td>

                    <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
                      {c.lastLatencyMs === null ? "—" : `${c.lastLatencyMs} ms`}
                      <div className="opacity-70">
                        {c.latency24h.p95 === null ? "—" : `p95 ${c.latency24h.p95} ms`}
                      </div>
                    </td>

                    <td className="px-3 py-2 font-mono text-xs tabular-nums">
                      <div className="flex gap-2">
                        <span className={uptimeTone(c.uptime24h)}>{pct(c.uptime24h)}</span>
                        <span className={uptimeTone(c.uptime7d)}>{pct(c.uptime7d)}</span>
                        <span className={uptimeTone(c.uptime30d)}>{pct(c.uptime30d)}</span>
                      </div>
                    </td>

                    <td className="px-3 py-2">
                      <BudgetBar check={c} />
                    </td>

                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {c.lastRunAt ? fmtAgo(c.lastRunAt) : "never"}
                    </td>

                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          className="h-7 gap-1.5 px-2 text-xs"
                          onClick={() => run(() => probeNow(c.id))}
                          title="Run this check now"
                        >
                          <Play className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          className="h-7 px-2 text-xs"
                          onClick={() => run(() => toggleCheck(c.id, !c.enabled))}
                        >
                          {c.enabled ? "Pause" : "Resume"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          className="h-7 px-2 text-xs text-down hover:text-down"
                          onClick={() => run(() => removeCheck(c.id))}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>

                  {expanded === c.id && (
                    <tr className="border-t border-border/50 bg-secondary/20">
                      <td />
                      <td colSpan={columnCount - 1} className="px-3 py-3">
                        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
                          <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                          Incidents, last 30 days
                        </div>
                        {incidents[c.id] ? (
                          <IncidentList incidents={incidents[c.id]} />
                        ) : (
                          <p className="text-[11px] text-muted-foreground">Loading…</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">
          {error}
        </p>
      )}
      {message && (
        <p className="inline-flex items-center gap-1.5 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-xs text-ok">
          <CheckIcon className="h-3.5 w-3.5" />
          {message}
        </p>
      )}
    </div>
  );
}
