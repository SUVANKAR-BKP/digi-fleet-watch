import { redirect } from "next/navigation";
import { AlertingPanel } from "@/components/dashboard/alerting-panel";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { getCurrentUser } from "@/lib/auth-server";
import { can } from "@/lib/rbac";
import { listActiveSilences, listChannels } from "@/lib/alerts";
import { listHostsForPicker } from "@/lib/data";
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
  let channels;
  let silences;
  let hosts;
  try {
    [initial, channels, silences, hosts] = await Promise.all([
      getSettingsView(),
      listChannels(),
      listActiveSilences(),
      listHostsForPicker(),
    ]);
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

      <AlertingPanel channels={channels} silences={silences} hosts={hosts} />
    </div>
  );
}
