"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check as CheckIcon, Loader2, Plus, Trash2 } from "lucide-react";
import {
  addMaintenanceWindow,
  removeMaintenanceWindow,
} from "@/app/actions/checks";
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
  MAINTENANCE_SCOPES,
  MAINTENANCE_SCOPE_LABELS,
  type MaintenanceScope,
} from "@/lib/check-types";
import type { MaintenanceRow } from "@/lib/checks";
import { cn } from "@/lib/utils";

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in the viewer local time. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function defaultStart(): string {
  return toLocalInput(new Date());
}

function defaultEnd(): string {
  return toLocalInput(new Date(Date.now() + 60 * 60_000));
}

export function MaintenancePanel({
  windows,
  hosts,
  checks,
}: {
  windows: MaintenanceRow[];
  hosts: { id: number; hostname: string }[];
  checks: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [scope, setScope] = useState<MaintenanceScope>("fleet");
  const [hostId, setHostId] = useState("none");
  const [checkId, setCheckId] = useState("none");
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [endsAt, setEndsAt] = useState(defaultEnd);

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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] leading-4 text-muted-foreground">
          Failures inside a window are still recorded, they just do not alert.
          Alerting during a deploy you are running yourself teaches people to
          ignore the channel.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          onClick={() => setShowForm((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5" />
          Schedule
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
                placeholder="api deploy"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Covers</label>
              <Select
                value={scope}
                onValueChange={(v) => setScope(v as MaintenanceScope)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAINTENANCE_SCOPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {MAINTENANCE_SCOPE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {scope === "host" && (
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Host</label>
                <Select value={hostId} onValueChange={setHostId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a host" />
                  </SelectTrigger>
                  <SelectContent>
                    {hosts.map((h) => (
                      <SelectItem key={h.id} value={String(h.id)}>
                        {h.hostname}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {scope === "check" && (
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Check</label>
                <Select value={checkId} onValueChange={setCheckId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a check" />
                  </SelectTrigger>
                  <SelectContent>
                    {checks.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Starts</label>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Ends</label>
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              disabled={pending}
              className="gap-1.5"
              onClick={() =>
                run(async () => {
                  const res = await addMaintenanceWindow({
                    name,
                    scope,
                    hostId: scope === "host" && hostId !== "none" ? hostId : "",
                    checkId: scope === "check" && checkId !== "none" ? checkId : "",
                    startsAt,
                    endsAt,
                  });
                  if (res.ok) {
                    setName("");
                    setScope("fleet");
                    setHostId("none");
                    setCheckId("none");
                    setStartsAt(defaultStart());
                    setEndsAt(defaultEnd());
                    setShowForm(false);
                  }
                  return res;
                })
              }
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Schedule
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {windows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No maintenance windows. Schedule one before a deploy to keep the alert
          channel quiet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Window</th>
                <th className="px-3 py-2 text-left font-medium">Covers</th>
                <th className="px-3 py-2 text-left font-medium">From</th>
                <th className="px-3 py-2 text-left font-medium">Until</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {windows.map((w) => (
                <tr key={w.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 font-medium">
                      <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                      {w.name}
                      <span
                        className={cn(
                          "rounded-full border px-1.5 py-0.5 text-[10px]",
                          w.active
                            ? "border-warn/50 bg-warn/10 text-warn"
                            : "border-border bg-secondary text-muted-foreground",
                        )}
                      >
                        {w.active
                          ? "active"
                          : new Date(w.startsAt).getTime() > Date.now()
                            ? "scheduled"
                            : "ended"}
                      </span>
                    </div>
                    {w.createdBy && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        by {w.createdBy}
                      </div>
                    )}
                  </td>

                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {w.scope === "fleet"
                      ? "Whole fleet"
                      : w.scope === "host"
                        ? (w.hostname ?? "unknown host")
                        : (w.checkName ?? "unknown check")}
                  </td>

                  <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
                    {new Date(w.startsAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
                    {new Date(w.endsAt).toLocaleString()}
                  </td>

                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      className="h-7 px-2 text-xs text-down hover:text-down"
                      onClick={() => run(() => removeMaintenanceWindow(w.id))}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
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
