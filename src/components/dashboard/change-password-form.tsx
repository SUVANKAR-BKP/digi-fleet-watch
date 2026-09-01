"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { changeOwnPassword } from "@/app/actions/users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (next !== confirm) {
      setError("The two new passwords do not match.");
      return;
    }

    setPending(true);
    const res = await changeOwnPassword(current, next);
    setPending(false);

    if (!res.ok) {
      setError(res.error ?? "Could not change the password.");
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setDone(true);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <h2 className="text-sm font-semibold">Change password</h2>

      <div className="space-y-1.5">
        <label htmlFor="current" className="text-xs text-muted-foreground">
          Current password
        </label>
        <Input
          id="current"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="next" className="text-xs text-muted-foreground">
          New password
        </label>
        <Input
          id="next"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          required
        />
        <p className="text-[11px] text-muted-foreground">
          At least 10 characters.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="confirm" className="text-xs text-muted-foreground">
          Confirm new password
        </label>
        <Input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>

      {error && <p className="text-xs text-down">{error}</p>}
      {done && (
        <p className="inline-flex items-center gap-1.5 text-xs text-ok">
          <Check className="h-3.5 w-3.5" />
          Password updated.
        </p>
      )}

      <Button type="submit" disabled={pending} className="gap-1.5">
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Update password
      </Button>
    </form>
  );
}
