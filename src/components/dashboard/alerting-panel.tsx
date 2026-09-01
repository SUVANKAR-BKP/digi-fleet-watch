"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BellOff,
  Check,
  Loader2,
  Plus,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  addChannel,
  addSilence,
  removeChannel,
  sendChannelTest,
  stopSilence,
  toggleChannel,
} from "@/app/actions/alerting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CHANNEL_LABELS,
  CHANNEL_TARGET_HINTS,
  CHANNEL_TYPES,
  type AlertSeverity,
  type ChannelType,
  type SafeChannel,
  type SilenceRow,
} from "@/lib/alert-channels";
import { fmtAgo, fmtDateTime } from "@/lib/format";

const SEVERITY_OPTIONS: { value: AlertSeverity; label: string }[] = [
  { value: "info", label: "Everything" },
  { value: "warning", label: "Warning and above" },
  { value: "critical", label: "Critical only" },
];

const DURATIONS = [
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 1440, label: "24 hours" },
];

export function AlertingPanel({
  channels,
  silences,
  hosts,
}: {
  channels: SafeChannel[];
  silences: SilenceRow[];
  hosts: { id: number; hostname: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // New channel
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("slack");
  const [target, setTarget] = useState("");
  const [minSeverity, setMinSeverity] = useState<AlertSeverity>("info");

  // New silence
  const [silenceHost, setSilenceHost] = useState<string>("all");
  const [silenceReason, setSilenceReason] = useState("");
  const [silenceMinutes, setSilenceMinutes] = useState("60");

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

  return (
    <div className="space-y-6">
      {/* Maintenance windows */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <BellOff className="h-4 w-4 text-primary" />
          Maintenance windows
        </h2>
        <p className="mb-3 text-[11px] leading-4 text-muted-foreground">
          Suppress alerts while you work. Monitoring keeps recording — only the
          notifications stop, so uptime and history stay accurate.
        </p>

        <div className="grid gap-3 sm:grid-cols-[12rem_1fr_9rem_auto] sm:items-end">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Host</label>
            <Select value={silenceHost} onValueChange={setSilenceHost}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Whole fleet</SelectItem>
                {hosts.map((h) => (
                  <SelectItem key={h.id} value={String(h.id)}>
                    {h.hostname}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Reason</label>
            <Input
              value={silenceReason}
              onChange={(e) => setSilenceReason(e.target.value)}
              placeholder="Kernel upgrade"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Duration</label>
            <Select value={silenceMinutes} onValueChange={setSilenceMinutes}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATIONS.map((d) => (
                  <SelectItem key={d.minutes} value={String(d.minutes)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            disabled={pending}
            className="gap-1.5"
            onClick={() =>
              run(() =>
                addSilence({
                  hostId: silenceHost === "all" ? null : Number(silenceHost),
                  reason: silenceReason,
                  minutes: Number(silenceMinutes),
                }),
              )
            }
          >
            <BellOff className="h-3.5 w-3.5" />
            Silence
          </Button>
        </div>

        {silences.length > 0 && (
          <ul className="mt-4 space-y-2">
            {silences.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-medium">
                    {s.hostname ?? "Whole fleet"}
                  </span>
                  {s.reason && (
                    <span className="ml-2 text-muted-foreground">{s.reason}</span>
                  )}
                  <span className="ml-2 text-muted-foreground">
                    · {s.active ? "ends" : "starts"}{" "}
                    {s.active ? fmtDateTime(s.endsAt) : fmtDateTime(s.startsAt)}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  className="h-6 px-2 text-xs"
                  onClick={() => run(() => stopSilence(s.id))}
                >
                  End now
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Notification channels */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Send className="h-4 w-4 text-primary" />
          Notification channels
        </h2>
        <p className="mb-3 text-[11px] leading-4 text-muted-foreground">
          Extra destinations beyond the SMTP recipient and Slack webhook above.
          Each channel picks the minimum severity it wants. Targets are
          encrypted at rest and never shown again.
        </p>

        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_1fr_11rem_auto] sm:items-end">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="on-call"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Type</label>
            <Select value={type} onValueChange={(v) => setType(v as ChannelType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNEL_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {CHANNEL_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Target</label>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={CHANNEL_TARGET_HINTS[type]}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Receives</label>
            <Select
              value={minSeverity}
              onValueChange={(v) => setMinSeverity(v as AlertSeverity)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            disabled={pending}
            className="gap-1.5"
            onClick={() =>
              run(async () => {
                const res = await addChannel({ name, type, target, minSeverity });
                if (res.ok) {
                  setName("");
                  setTarget("");
                }
                return res;
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>

        {channels.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-left font-medium">Target</th>
                  <th className="px-3 py-2 text-left font-medium">Receives</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2 text-xs">{CHANNEL_LABELS[c.type]}</td>
                    <td className="max-w-[16rem] truncate px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {c.targetPreview}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {SEVERITY_OPTIONS.find((o) => o.value === c.minSeverity)?.label}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => toggleChannel(c.id, !c.enabled))}
                        className={
                          c.enabled
                            ? "rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] text-ok disabled:opacity-60"
                            : "rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground disabled:opacity-60"
                        }
                      >
                        {c.enabled ? "Enabled" : "Disabled"}
                      </button>
                      {c.lastError && (
                        <p
                          className="mt-1 flex items-start gap-1 text-[10px] leading-3 text-down"
                          title={c.lastError}
                        >
                          <TriangleAlert className="mt-px h-2.5 w-2.5 shrink-0" />
                          <span className="line-clamp-2">{c.lastError}</span>
                        </p>
                      )}
                      {!c.lastError && c.lastSentAt && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          sent {fmtAgo(c.lastSentAt)}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          className="h-7 gap-1.5 px-2 text-xs"
                          onClick={() => run(() => sendChannelTest(c.id))}
                        >
                          <Send className="h-3 w-3" />
                          Test
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          className="h-7 gap-1.5 px-2 text-xs text-down hover:text-down"
                          onClick={() => run(() => removeChannel(c.id))}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {error && (
        <p className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">
          {error}
        </p>
      )}
      {message && (
        <p className="inline-flex items-center gap-1.5 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-xs text-ok">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {message}
        </p>
      )}
    </div>
  );
}
