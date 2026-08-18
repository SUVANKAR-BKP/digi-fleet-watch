export type HostStatus = "online" | "stale" | "down";

export type DowntimeDetectedBy = "heartbeat_miss" | "external_probe";

/** Payload shape posted by agent.sh to POST /api/ingest. */
export interface AgentPackagePayload {
  name: string;
  installed: string;
  available?: string | null;
  security?: boolean;
  cve_ids?: string[];
}

/** One container row posted by agent.sh from `docker inspect`. */
export interface AgentContainerPayload {
  container_id: string;
  name: string;
  image: string;
  image_tag?: string | null;
  image_digest?: string | null;
  status: string;
  health_status?: string | null;
  restart_count?: number;
  created_at?: string | null;
  age_days?: number;
  is_unpinned_latest?: boolean;
}

export interface AgentPayload {
  hostname: string;
  label?: string;
  os?: {
    name?: string;
    version?: string;
    kernel?: string;
  };
  collected_at?: string;
  packages?: AgentPackagePayload[];
  docker?: {
    engine_version?: string;
    api_version?: string;
    deprecated?: boolean;
    containers_running?: number;
    containers_total?: number;
  } | null;
  containers?: AgentContainerPayload[];
}

/** One card on the overview grid. */
export interface HostSummary {
  id: number;
  hostname: string;
  label: string | null;
  lastSeenAt: string | null;
  status: HostStatus;
  outdatedPackages: number;
  securityPackages: number;
  dockerInstalled: boolean;
  dockerDeprecated: boolean;
  dockerEngineVersion: string | null;
  uptimePct30d: number;
  osLabel: string | null;
}

export interface OverviewData {
  hosts: HostSummary[];
  demo: boolean;
  error?: string;
}

export interface PackageRow {
  id: number;
  name: string;
  installed: string;
  available: string | null;
  security: boolean;
  cveIds: string[];
}

export interface DockerStatus {
  installed: boolean;
  engineVersion: string | null;
  apiVersion: string | null;
  deprecated: boolean;
  containersRunning: number;
  containersTotal: number;
}

export interface ContainerRow {
  id: number;
  containerId: string;
  name: string;
  image: string;
  imageTag: string | null;
  imageDigest: string | null;
  status: string;
  healthStatus: string | null;
  restartCount: number;
  createdAt: string | null;
  ageDays: number | null;
  isUnpinnedLatest: boolean;
}

export interface DowntimeEventRow {
  id: number;
  startedAt: string;
  endedAt: string | null;
  detectedBy: DowntimeDetectedBy;
  durationSec: number | null;
}

export interface UptimeDay {
  day: string; // ISO date (yyyy-mm-dd)
  uptimePct: number; // 0–100
  downtimeSec: number;
}

export interface HostDetailData {
  summary: HostSummary;
  os: { name?: string; version?: string; kernel?: string } | null;
  packages: PackageRow[];
  containers: ContainerRow[];
  docker: DockerStatus;
  uptimeSeries: UptimeDay[];
  uptimePct30d: number;
  downtimeEvents: DowntimeEventRow[];
  demo: boolean;
}