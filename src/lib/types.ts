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

/** One filesystem, as reported by `df` on the host. */
export interface AgentDiskPayload {
  mount: string;
  fs_type?: string | null;
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  use_pct: number;
  inode_use_pct?: number | null;
}

/** Resource sample posted alongside the inventory each heartbeat. */
export interface AgentMetricsPayload {
  cpu_pct?: number | null;
  cpu_cores?: number | null;
  load1?: number | null;
  load5?: number | null;
  load15?: number | null;
  mem_total_bytes?: number | null;
  mem_used_bytes?: number | null;
  mem_available_bytes?: number | null;
  swap_total_bytes?: number | null;
  swap_used_bytes?: number | null;
  uptime_seconds?: number | null;
  process_count?: number | null;
  disks?: AgentDiskPayload[];
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
  metrics?: AgentMetricsPayload | null;
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
  /** Latest sample, for the sparklines and the "disk almost full" badge. */
  cpuPct: number | null;
  memUsedPct: number | null;
  maxDiskUsePct: number | null;
  diskAlert: boolean;
  /** Open vulnerability counts, worst-first triage on the overview. */
  vulnCritical: number;
  vulnHigh: number;
  vulnTotal: number;
}

import type { VulnRow } from "./vulnerabilities";

export interface DiskRow {
  mount: string;
  fsType: string | null;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usePct: number;
  inodeUsePct: number | null;
}

/** Latest resource sample for a host, plus its per-mount disk usage. */
export interface MetricsSnapshot {
  collectedAt: string;
  cpuPct: number | null;
  cpuCores: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  memTotalBytes: number | null;
  memUsedBytes: number | null;
  memAvailableBytes: number | null;
  memUsedPct: number | null;
  swapTotalBytes: number | null;
  swapUsedBytes: number | null;
  uptimeSeconds: number | null;
  processCount: number | null;
  disks: DiskRow[];
}

/** One point on the resource history charts. */
export interface MetricPoint {
  t: string;
  cpuPct: number | null;
  memUsedPct: number | null;
  load1: number | null;
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
  metrics: MetricsSnapshot | null;
  metricHistory: MetricPoint[];
  vulnerabilities: VulnRow[];
  demo: boolean;
}