import { redirect } from "next/navigation";
import { Activity } from "lucide-react";
import { ChecksPanel } from "@/components/dashboard/checks-panel";
import { MaintenancePanel } from "@/components/dashboard/maintenance-panel";
import { listChannels } from "@/lib/alerts";
import { getCurrentUser } from "@/lib/auth-server";
import { checkSummary, listChecks, listMaintenanceWindows } from "@/lib/checks";
import { dbAvailable, listHostsForPicker } from "@/lib/data";

export const dynamic = "force-dynamic";

export const metadata = { title: "Checks" };

/** One tally in the header strip. Rendered only when it has something to say. */
function Tally({
  count,
  label,
  tone,
}: {
  count: number;
  label: string;
  tone: string;
}) {
  if (count === 0) return null;
  return (
    <span className={`ml-2 font-medium ${tone}`}>
      · {count} {label}
    </span>
  );
}

export default async function ChecksPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!(await dbAvailable())) {
    return (
      <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
        External checks need a live database. Deploy with docker-compose to use
        them.
      </div>
    );
  }

  const [checks, hosts, summary, windows, channels] = await Promise.all([
    listChecks(),
    listHostsForPicker(),
    checkSummary(),
    listMaintenanceWindows(),
    listChannels(),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Checks</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {summary.total} check{summary.total === 1 ? "" : "s"}
            <Tally count={summary.failing} label="failing" tone="text-down" />
            <Tally count={summary.degraded} label="degraded" tone="text-warn" />
            <Tally
              count={summary.breachingSlo}
              label="over budget"
              tone="text-down"
            />
            <Tally
              count={summary.suppressed}
              label="suppressed"
              tone="text-muted-foreground"
            />
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          scheduler ticks every 30s
        </span>
      </div>

      <ChecksPanel
        checks={checks}
        hosts={hosts}
        // Only enabled channels can receive a routed alert, so a disabled one
        // must not be offered as a destination.
        channels={channels
          .filter((c) => c.enabled)
          .map((c) => ({ id: c.id, name: c.name }))}
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Maintenance windows</h2>
        <MaintenancePanel
          windows={windows}
          hosts={hosts}
          checks={checks.map((c) => ({ id: c.id, name: c.name }))}
        />
      </section>
    </div>
  );
}
