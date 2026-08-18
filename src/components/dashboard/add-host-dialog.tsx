"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { buildInstallCommand, maskToken } from "@/lib/install-command";
import { cn } from "@/lib/utils";

export function AddHostDialog({
  baseUrl,
  token,
}: {
  baseUrl: string;
  token: string;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const fullCommand = buildInstallCommand(baseUrl, token, label);
  const visibleToken = revealed ? token : maskToken(token);
  const visibleCommand = buildInstallCommand(baseUrl, visibleToken, label);

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Host
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a host</DialogTitle>
          <DialogDescription>
            Copy the command below and run it <strong>as root</strong> on the
            server you want to monitor. It installs curl/jq if missing,
            downloads the agent, and starts reporting within 5 minutes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label
              htmlFor="host-label"
              className="text-xs font-medium text-foreground"
            >
              Label <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="host-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. prod-gitlab, proxmox-node-2"
            />
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/40 px-3 py-1.5">
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {revealed ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                {revealed ? "Hide token" : "Reveal token"}
              </button>
              <Button size="sm" onClick={copy} className="gap-1.5">
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <pre
              className={cn(
                "overflow-x-auto p-3 font-mono text-xs leading-5",
                revealed ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {visibleCommand}
            </pre>
          </div>

          <p className="text-[11px] text-muted-foreground">
            The API token is hidden by default and only shown in full when you
            reveal it — it&apos;s the same secret agents use to authenticate.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}