"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Trash2, UserPlus } from "lucide-react";
import {
  addUser,
  changeActive,
  changeRole,
  removeUser,
  resetPassword,
} from "@/app/actions/users";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtAgo } from "@/lib/format";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, USER_ROLES, type UserRole } from "@/lib/rbac";
import type { SafeUser } from "@/lib/users";

export function UserTable({
  users,
  currentUserId,
}: {
  users: SafeUser[];
  currentUserId: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("viewer");
  const [creating, setCreating] = useState(false);

  // Dialogs
  const [resetting, setResetting] = useState<SafeUser | null>(null);
  const [resetValue, setResetValue] = useState("");
  const [deleting, setDeleting] = useState<SafeUser | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else router.refresh();
    });
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    const fd = new FormData();
    fd.set("username", newUsername);
    fd.set("password", newPassword);
    fd.set("role", newRole);
    const res = await addUser(fd);
    setCreating(false);
    if (!res.ok) {
      setError(res.error ?? "Could not create the account.");
      return;
    }
    setNewUsername("");
    setNewPassword("");
    setNewRole("viewer");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={onCreate}
        className="rounded-lg border border-border bg-card p-4"
      >
        <h2 className="text-sm font-semibold">Add a user</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
          <div className="space-y-1.5">
            <label htmlFor="new-username" className="text-xs text-muted-foreground">
              Username
            </label>
            <Input
              id="new-username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              autoComplete="off"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new-password" className="text-xs text-muted-foreground">
              Temporary password
            </label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Role</label>
            <Select value={newRole} onValueChange={(v) => setNewRole(v as UserRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={creating} className="gap-1.5">
            {creating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <UserPlus className="h-3.5 w-3.5" />
            )}
            Add user
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {ROLE_DESCRIPTIONS[newRole]} Passwords must be at least 10 characters.
        </p>
      </form>

      {error && (
        <p className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">User</th>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Last sign-in</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <span className="font-mono">{u.username}</span>
                    {isSelf && (
                      <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        you
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      value={u.role}
                      disabled={isSelf || pending}
                      onValueChange={(v) => run(() => changeRole(u.id, v))}
                    >
                      <SelectTrigger className="h-7 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {USER_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={isSelf || pending}
                      onClick={() => run(() => changeActive(u.id, !u.isActive))}
                      className={
                        u.isActive
                          ? "rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] text-ok disabled:opacity-60"
                          : "rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground disabled:opacity-60"
                      }
                    >
                      {u.isActive ? "Active" : "Disabled"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {u.lastLoginAt ? fmtAgo(u.lastLoginAt) : "never"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1.5 px-2 text-xs"
                        onClick={() => {
                          setResetValue("");
                          setResetting(u);
                        }}
                      >
                        <KeyRound className="h-3 w-3" />
                        Reset
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isSelf}
                        className="h-7 gap-1.5 px-2 text-xs text-down hover:text-down"
                        onClick={() => setDeleting(u)}
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Password reset */}
      <AlertDialog open={resetting !== null} onOpenChange={(o) => !o && setResetting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset password for {resetting?.username}</AlertDialogTitle>
            <AlertDialogDescription>
              They will need this new password to sign in. Existing sessions stay
              valid until they expire.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="password"
            value={resetValue}
            onChange={(e) => setResetValue(e.target.value)}
            placeholder="New password (min 10 characters)"
            autoComplete="new-password"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              disabled={pending || resetValue.length < 10}
              onClick={() => {
                const target = resetting;
                if (!target) return;
                setResetting(null);
                run(() => resetPassword(target.id, resetValue));
              }}
            >
              Set password
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete */}
      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.username}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the account. To keep the record but block
              access, disable it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                const target = deleting;
                if (!target) return;
                setDeleting(null);
                run(() => removeUser(target.id));
              }}
            >
              Delete account
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
