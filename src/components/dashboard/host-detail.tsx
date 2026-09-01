import Link from "next/link";
import {
  Activity,
  ChevronLeft,
  Container,
  Cpu,
  Monitor,
  ShieldAlert,
  Timer,
} from "lucide-react";
import { fmtAgo, fmtPct } from "@/lib/format";
import type { HostDetailData } from "@/lib/types";
import type { CheckRow } from "@/lib/check-types";
import { ChecksPanel } from "./checks-panel";
import { ContainerTable } from "./container-table";
import { DeleteHostButton } from "./delete-host-button";
import { ResourcePanel } from "./resource-panel";
import { VulnerabilityTable } from "./vulnerability-table";
import { DowntimeLog } from "./downtime-log";
import { PackageTable } from "./package-table";
import { StatusBadge } from "./status-dot";
import { UptimeChart } from "./uptime-chart";

export function HostDetail({
  data,
  baseUrl,
  canDelete,
  checks,
  canManageChecks,
}: {
  data: HostDetailData;
  /** Used to build the agent uninstall command shown when removing the host. */
  baseUrl: string;
  /** Viewers may read this page but not retire the host. */
  canDelete: boolean;
  /** External probes associated with this host. */
  checks: CheckRow[];
  canManageChecks: boolean;
}) {
  const failingChecks = checks.filter((c) => c.enabled && c.lastOk === false).length;
  const { summary: h, os, docker, packages, containers, uptimeSeries, uptimePct30d } = data;
  const updates = packages.filter((p) => p.available).length;
  const secUpdates = packages.filter((p) => p.security).length;
  const unpinned = containers.filter((c) => c.isUnpinnedLatest).length;

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to overview
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-mono text-xl font-semibold tracking-tight">
              {h.hostname}
            </h1>
            <StatusBadge status={h.status} />
            {docker.deprecated && (
              <span className="rounded-full border border-security/50 bg-security/10 px-2 py-0.5 text-[11px] font-semibold text-security">
                Docker engine EOL
              </span>
            )}
          </div>
          {h.label && (
            <p className="mt-1 text-sm text-muted-foreground">{h.label}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {os?.name ? (
              <span className="inline-flex items-center gap-1.5">
                <Monitor className="h-3.5 w-3.5" /> {os.name} {os.version}
              </span>
            ) : null}
            {os?.kernel ? (
              <span className="inline-flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5" /> {os.kernel}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5" /> seen {fmtAgo(h.lastSeenAt)}
            </span>
          </div>
        </div>

        {!data.demo && canDelete && (
          <DeleteHostButton
            hostId={h.id}
            hostname={h.hostname}
            baseUrl={baseUrl}
          />
        )}
      </div>

      {data.demo && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          <span className="font-semibold">Demo data.</span> Showing a sample
          host until Postgres is reachable.
        </div>
      )}

      <ResourcePanel metrics={data.metrics} history={data.metricHistory} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Uptime */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4 text-primary" />
              Uptime · last 30 days
            </h2>
            <span
              className={
                uptimePct30d >= 99.9
                  ? "font-mono text-lg font-semibold text-ok tabular-nums"
                  : "font-mono text-lg font-semibold text-warn tabular-nums"
              }
            >
              {fmtPct(uptimePct30d)}
            </span>
          </div>
          <UptimeChart data={uptimeSeries} />
        </section>

        {/* Docker */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Container className="h-4 w-4 text-primary" />
            Docker engine
          </h2>
          {docker.installed ? (
            <div className="space-y-3">
              {docker.deprecated && (
                <div className="rounded-lg border border-security/50 bg-security/10 px-3 py-2 text-xs text-security">
                  <span className="font-semibold">Deprecated engine.</span>{" "}
                  Docker {docker.engineVersion} has reached end of life — plan
                  an upgrade to a supported release.
                </div>
              )}
              <dl className="grid grid-cols-2 gap-3">
                <KV k="Version" v={docker.engineVersion ?? "—"} mono />
                <KV k="API" v={docker.apiVersion ?? "—"} mono />
                <KV
                  k="Containers"
                  v={`${docker.containersRunning} running / ${docker.containersTotal} total`}
                />
                <KV
                  k="Status"
                  v={docker.deprecated ? "DEPRECATED" : "supported"}
                  emphasize={docker.deprecated}
                />
              </dl>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Docker is not installed on this host — nothing to monitor.
            </p>
          )}
        </section>
      </div>

      {/* External checks */}
      {!data.demo && canManageChecks && (
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4 text-primary" />
              Service checks
              <span className="ml-1 font-mono text-xs font-normal text-muted-foreground tabular-nums">
                {checks.length}
              </span>
            </h2>
            {failingChecks > 0 && (
              <span className="text-xs font-medium text-down">
                {failingChecks} failing
              </span>
            )}
          </div>
          <ChecksPanel
            checks={checks}
            hosts={[{ id: h.id, hostname: h.hostname }]}
            defaultHostId={h.id}
            compact
          />
        </section>
      )}

      {/* Vulnerabilities */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldAlert className="h-4 w-4 text-primary" />
            Vulnerabilities
            <span className="ml-1 font-mono text-xs font-normal text-muted-foreground tabular-nums">
              {data.vulnerabilities.length}
            </span>
          </h2>
          {(h.vulnCritical > 0 || h.vulnHigh > 0) && (
            <span className="text-xs font-medium text-security">
              {h.vulnCritical > 0 && `${h.vulnCritical} critical`}
              {h.vulnCritical > 0 && h.vulnHigh > 0 && " · "}
              {h.vulnHigh > 0 && `${h.vulnHigh} high`}
            </span>
          )}
        </div>
        <VulnerabilityTable vulns={data.vulnerabilities} />
      </section>

      {/* Packages */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Packages{" "}
            <span className="ml-1 font-mono text-xs font-normal text-muted-foreground tabular-nums">
              {updates} update{updates === 1 ? "" : "s"}
            </span>
          </h2>
          {secUpdates > 0 && (
            <span className="text-xs font-medium text-security">
              {secUpdates} security update{secUpdates === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <PackageTable packages={packages} />
      </section>

      {/* Containers */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Container className="h-4 w-4 text-primary" />
            Containers
            <span className="ml-1 font-mono text-xs font-normal text-muted-foreground tabular-nums">
              {containers.length}
            </span>
          </h2>
          {unpinned > 0 && (
            <span className="text-xs font-medium text-warn">
              {unpinned} unpinned (:latest) image{unpinned === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <ContainerTable containers={containers} />
      </section>

      {/* Downtime log */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Downtime events</h2>
        <DowntimeLog events={data.downtimeEvents} />
      </section>
    </div>
  );
}

function KV({
  k,
  v,
  mono,
  emphasize,
}: {
  k: string;
  v: string;
  mono?: boolean;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {k}
      </dt>
      <dd
        className={
          mono
            ? "mt-0.5 font-mono text-sm font-medium text-foreground"
            : emphasize
              ? "mt-0.5 text-sm font-semibold text-security"
              : "mt-0.5 text-sm font-medium text-foreground"
        }
      >
        {v}
      </dd>
    </div>
  );
}