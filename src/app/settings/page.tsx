import { redirect } from "next/navigation";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { getCurrentUser } from "@/lib/auth-server";
import { can } from "@/lib/rbac";
import { getSettingsView } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  // Middleware gates this on the cookie's role; re-check against the live
  // record so a just-demoted admin cannot linger here.
  if (!user) redirect("/login");
  if (!can(user.role, "settings:manage")) redirect("/");

  let initial;
  try {
    initial = await getSettingsView();
  } catch (err) {
    return (
      <div className="rounded-lg border border-down/40 bg-down/10 p-4 text-xs text-down">
        <p className="font-semibold">Could not load settings.</p>
        <pre className="mt-2 overflow-x-auto font-mono text-[11px]">
          {err instanceof Error ? err.message : String(err)}
        </pre>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Where Digi Fleet Watch sends downtime, package-update and Docker
          end-of-life alerts.
        </p>
      </div>

      <SettingsForm initial={initial} />
    </div>
  );
}
