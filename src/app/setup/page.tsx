import { ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/dashboard/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { countUsers } from "@/lib/users";
import { completeSetup } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "First-run setup" };

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  let dbError: string | null = null;
  try {
    // Setup is only reachable while the instance has no accounts.
    if ((await countUsers()) > 0) redirect("/login");
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const { error } = await searchParams;

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center">
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
            Setup needs Postgres. Check <code>docker compose ps</code>.
          </p>
          <pre className="mt-2 overflow-x-auto font-mono text-[11px]">{dbError}</pre>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <h1 className="text-lg font-semibold tracking-tight">
              Create the first admin
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This instance has no accounts yet. The account you create here is
              an <strong>admin</strong> and can add everyone else.
            </p>
          </div>

          <div className="mb-4 flex gap-2 rounded-lg border border-security/40 bg-security/10 p-2.5 text-[11px] leading-4 text-security">
            <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              Until this is done, anyone who can reach this page can claim the
              admin account. Complete setup now, or keep the port firewalled
              until you have.
            </span>
          </div>

          <form
            action={completeSetup}
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
                placeholder="admin"
                autoFocus
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Letters, numbers, dot, underscore or hyphen. 3–32 characters.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-foreground">
                Password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                At least 10 characters. Length beats punctuation.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="confirm" className="text-xs font-medium text-foreground">
                Confirm password
              </label>
              <Input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
              />
            </div>

            {error ? <p className="text-xs text-down">{error}</p> : null}

            <Button type="submit" className="w-full">
              Create admin and sign in
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
