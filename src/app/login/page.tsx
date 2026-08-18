import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/dashboard/logo";
import { authConfigured } from "@/lib/dashboard-auth";
import { login } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  // With no password configured there is no gate, so there is nothing to show.
  if (!authConfigured()) redirect("/");

  const { error, next } = await searchParams;

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-sm flex-col justify-center">
      <div className="mb-6 flex items-center gap-2.5">
        <Logo className="h-8 w-8 text-primary" />
        <span className="text-base font-semibold tracking-tight">
          Digi Fleet Watch
        </span>
      </div>

      <form action={login} className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-xs font-medium text-foreground">
            Dashboard password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
          />
        </div>

        <input type="hidden" name="next" value={next ?? "/"} />

        {error ? (
          <p className="text-xs text-down">Incorrect password.</p>
        ) : null}

        <Button type="submit" className="w-full">
          Sign in
        </Button>
      </form>

      <p className="mt-3 text-[11px] text-muted-foreground">
        This password is set with <code>FLEETWATCH_DASHBOARD_PASSWORD</code> on
        the server.
      </p>
    </div>
  );
}
