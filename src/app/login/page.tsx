import { redirect } from "next/navigation";
import { Logo } from "@/components/dashboard/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { countUsers } from "@/lib/users";
import { login } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  // Middleware cannot query the database from the edge runtime, so the
  // "no accounts yet" redirect happens here instead.
  let hasUsers = true;
  let dbError: string | null = null;
  try {
    hasUsers = (await countUsers()) > 0;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }
  if (!dbError && !hasUsers) redirect("/setup");

  const { error, next } = await searchParams;

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-sm flex-col justify-center">
      <div className="mb-6 flex items-center gap-2.5">
        <Logo className="h-8 w-8 text-primary" />
        <span className="text-base font-semibold tracking-tight">
          Digi Fleet Watch
        </span>
      </div>

      {dbError ? (
        <div className="rounded-lg border border-down/40 bg-down/10 p-3 text-xs text-down">
          <p className="font-semibold">Cannot reach the database.</p>
          <p className="mt-1 text-muted-foreground">
            Sign-in is unavailable until Postgres is back.
          </p>
          <pre className="mt-2 overflow-x-auto font-mono text-[11px]">{dbError}</pre>
        </div>
      ) : (
        <form
          action={login}
          className="space-y-3 rounded-lg border border-border bg-card p-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="username" className="text-xs font-medium text-foreground">
              Username
            </label>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-medium text-foreground">
              Password
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          <input type="hidden" name="next" value={next ?? "/"} />

          {error ? (
            <p className="text-xs text-down">Incorrect username or password.</p>
          ) : null}

          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
      )}
    </div>
  );
}
