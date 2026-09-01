import { ShieldAlert } from "lucide-react";
import type { OverviewData } from "@/lib/types";
import { EmptyState } from "./empty-state";
import { HostCard } from "./host-card";

export function Overview({ data }: { data: OverviewData }) {
  const { hosts } = data;
  const online = hosts.filter((h) => h.status === "online").length;
  const stale = hosts.filter((h) => h.status === "stale").length;
  const down = hosts.filter((h) => h.status === "down").length;
  const outdated = hosts.reduce((a, h) => a + h.outdatedPackages, 0);
  const security = hosts.reduce((a, h) => a + h.securityPackages, 0);
  const deprecatedDocker = hosts.filter((h) => h.dockerDeprecated).length;
  const diskPressure = hosts.filter((h) => h.diskAlert).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Fleet overview</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {hosts.length} {hosts.length === 1 ? "host" : "hosts"} ·{" "}
            {outdated} update{outdated === 1 ? "" : "s"} pending
            {security > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 font-medium text-security">
                <ShieldAlert className="h-3.5 w-3.5" />
                {security} security
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <Chip dotClass="bg-ok" label={`${online} online`} />
          <Chip dotClass="bg-warn" label={`${stale} stale`} />
          <Chip dotClass="bg-down" label={`${down} down`} />
          {diskPressure > 0 && (
            <span className="ml-1 rounded-full border border-warn/50 bg-warn/10 px-2 py-1 font-medium text-warn">
              {diskPressure} disk {diskPressure === 1 ? "warning" : "warnings"}
            </span>
          )}
          {deprecatedDocker > 0 && (
            <span className="ml-1 rounded-full border border-security/50 bg-security/10 px-2 py-1 font-medium text-security">
              {deprecatedDocker} Docker EOL
            </span>
          )}
        </div>
      </div>

      {data.error ? (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          <span className="font-semibold">Demo data.</span> {data.error} The UI
          below shows sample fleet data.
        </div>
      ) : null}

      {hosts.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {hosts.map((h) => (
            <HostCard key={h.id} host={h} />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ dotClass, label }: { dotClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}