"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { getInstallToken } from "@/app/actions/install";
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
import { buildInstallCommand } from "@/lib/install-command";
import { cn } from "@/lib/utils";

export function AddHostDialog({
  baseUrl,
  authConfigured,
  tokenConfigured,
}: {
  baseUrl: string;
  authConfigured: boolean;
  tokenConfigured: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  // The token is not part of the page — it is requested when the dialog opens.
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getInstallToken();
      if (res.error) setError(res.error);
      setToken(res.token);
    } catch {
      setError("Could not reach the server to fetch the token.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !token && !loading && !error) void load();
  }, [open, token, loading, error, load]);

  const ready = token.length > 0;
  const fullCommand = ready ? buildInstallCommand(baseUrl, token, label) : "";

  // The command is rendered with the *real* token, blurred by CSS while
  // hidden, rather than with bullet characters substituted in. Rendering a
  // masked string produced a command that looked pasteable but wasn't:
  // selecting it by hand copied "AGENT_API_TOKEN=404e••••••••8cfe", which the
  // server then rejected with 401. Blurring keeps it unreadable over someone's
  // shoulder while leaving select-and-copy correct.
  const TOKEN_SLOT = "\u0000";
  const [beforeToken, afterToken] = ready
    ? buildInstallCommand(baseUrl, TOKEN_SLOT, label).split(TOKEN_SLOT)
    : ["", ""];

  async function copy() {
    if (!ready) return;
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
            downloads the agent, sends a first report immediately, and then
            reports every 5 minutes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {!authConfigured && (
            <div className="flex gap-2 rounded-lg border border-security/40 bg-security/10 p-2.5 text-[11px] leading-4 text-security">
              <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>This instance has no password.</strong> Anyone who can
                reach {baseUrl} can open this dialog and read the agent token.
                Set <code>FLEETWATCH_DASHBOARD_PASSWORD</code> on the server, or
                keep the port firewalled.
              </span>
            </div>
          )}

          {!tokenConfigured && (
            <div className="flex gap-2 rounded-lg border border-down/40 bg-down/10 p-2.5 text-[11px] leading-4 text-down">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                <code>AGENT_API_TOKEN</code> is not set on the server — agents
                cannot authenticate until it is.
              </span>
            </div>
          )}

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
                disabled={!ready}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                {revealed ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                {revealed ? "Hide token" : "Reveal token"}
              </button>
              <Button size="sm" onClick={copy} disabled={!ready} className="gap-1.5">
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Fetching token…
              </div>
            ) : error ? (
              <p className="p-3 text-xs text-down">{error}</p>
            ) : (
              <pre className="overflow-x-auto p-3 font-mono text-xs leading-5 text-foreground">
                {beforeToken}
                <span
                  className={cn(
                    "rounded-[2px] transition-[filter]",
                    !revealed && "select-all bg-muted/50 blur-[4.5px]",
                  )}
                >
                  {token}
                </span>
                {afterToken}
              </pre>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            The token is blurred, not replaced — copying the command (button or
            manual selection) always yields the real one. Use{" "}
            <strong>Reveal token</strong> only if you need to read it.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
