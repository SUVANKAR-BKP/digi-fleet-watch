"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { removeHost } from "@/app/actions/hosts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Removes a host from monitoring.
 *
 * Deleting the record does not stop the agent — it re-registers on its next
 * heartbeat — so the dialog leads with the uninstall command rather than
 * burying that as a footnote.
 */
export function DeleteHostButton({
  hostId,
  hostname,
  baseUrl,
}: {
  hostId: number;
  hostname: string;
  baseUrl: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const uninstallCommand = `curl -fsSL ${baseUrl}/uninstall.sh | sudo bash`;
  const confirmed = confirmText.trim() === hostname;

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(uninstallCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function onDelete() {
    if (!confirmed || pending) return;
    setPending(true);
    setError(null);
    const res = await removeHost(hostId);
    if (!res.ok) {
      setError(res.error ?? "Could not delete this host.");
      setPending(false);
      return;
    }
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setConfirmText("");
          setError(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-down/40 text-down hover:bg-down/10 hover:text-down"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Stop monitoring
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Stop monitoring {hostname}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes every snapshot, package list, container
            record, heartbeat and downtime event for this host. It cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2 rounded-lg border border-warn/40 bg-warn/10 p-2.5 text-[11px] leading-4 text-warn">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              <strong>Remove the agent first.</strong> If it is still installed
              on {hostname}, the host reappears here within 5 minutes. Run this
              on that machine:
            </span>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/40 px-3 py-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                Run on {hostname}
              </span>
              <Button size="sm" variant="ghost" onClick={copyCommand} className="h-6 gap-1.5 px-2">
                {copied ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <pre className="overflow-x-auto p-3 font-mono text-xs leading-5 text-foreground">
              {uninstallCommand}
            </pre>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirm-hostname" className="text-xs text-muted-foreground">
              Type <span className="font-mono font-semibold text-foreground">{hostname}</span> to
              confirm
            </label>
            <Input
              id="confirm-hostname"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              placeholder={hostname}
            />
          </div>

          {error && <p className="text-xs text-down">{error}</p>}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={!confirmed || pending}
            onClick={onDelete}
            className="gap-1.5"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {pending ? "Deleting…" : "Delete host"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
