import { DISK_WARN_PCT, DOWN_MS, STALE_MS } from "./thresholds";
import type { VulnRow } from "./vulnerabilities";
import type {
  ContainerRow,
  MetricPoint,
  MetricsSnapshot,
  DowntimeEventRow,
  HostDetailData,
  HostSummary,
  OverviewData,
  PackageRow,
  UptimeDay,
} from "./types";

const DAY = 86_400_000;

interface Blip {
  /** Days before now the event started. */
  offsetDays: number;
  /** Duration in hours (ignored when ongoing). */
  hours: number;
  /** True for the currently-open outage. */
  ongoing?: boolean;
}

interface DemoSpec {
  id: number;
  hostname: string;
  label: string | null;
  lastSeenMinutesAgo: number;
  osInfo: { name: string; version: string; kernel: string };
  blips: Blip[];
  packages: PackageRow[];
  containers: ContainerRow[];
  docker: HostDetailData["docker"];
}

const web01Pkgs: PackageRow[] = [
  { id: 101, name: "openssl", installed: "3.0.13-0ubuntu3.4", available: "3.0.13-0ubuntu3.5", security: true, cveIds: ["CVE-2024-5535"] },
  { id: 102, name: "curl", installed: "8.5.0-2ubuntu10.2", available: "8.5.0-2ubuntu10.3", security: false, cveIds: [] },
  { id: 103, name: "nginx", installed: "1.24.0-2ubuntu7.1", available: "1.24.0-2ubuntu7.2", security: false, cveIds: [] },
];

const db01Pkgs: PackageRow[] = [
  { id: 201, name: "postgresql-15", installed: "15.7-0+deb12u1", available: "15.8-0+deb12u1", security: true, cveIds: ["CVE-2024-7348"] },
  { id: 202, name: "libssl3", installed: "3.0.11-1~deb12u2", available: "3.0.11-1~deb12u4", security: true, cveIds: ["CVE-2024-5535"] },
  { id: 203, name: "systemd", installed: "252.26-1~deb12u1", available: "252.26-1~deb12u2", security: false, cveIds: [] },
  { id: 204, name: "openssh-server", installed: "1:9.2p1-2+deb12u2", available: "1:9.2p1-2+deb12u3", security: false, cveIds: [] },
  { id: 205, name: "python3", installed: "3.11.2-1+deb12u1", available: "3.11.2-1+deb12u2", security: false, cveIds: [] },
];

const cache01Pkgs: PackageRow[] = [
  { id: 301, name: "redis-server", installed: "7.0.15-1ubuntu0.1", available: "7.0.15-1ubuntu0.2", security: true, cveIds: ["CVE-2024-31227"] },
  { id: 302, name: "libc6", installed: "2.35-0ubuntu3.6", available: "2.35-0ubuntu3.8", security: true, cveIds: ["CVE-2024-2961"] },
  { id: 303, name: "vim", installed: "8.2.3995-1ubuntu2.17", available: "8.2.3995-1ubuntu2.18", security: true, cveIds: ["CVE-2024-43374"] },
  { id: 304, name: "bash", installed: "5.1-6ubuntu1.1", available: "5.1-6ubuntu1.2", security: true, cveIds: ["CVE-2024-6104"] },
  { id: 305, name: "tar", installed: "1.34+dfsg-1ubuntu0.1.22.04.2", available: "1.34+dfsg-1ubuntu0.1.22.04.3", security: false, cveIds: [] },
  { id: 306, name: "dnsmasq-base", installed: "2.86-1.1ubuntu0.1", available: "2.86-1.1ubuntu0.2", security: false, cveIds: [] },
  { id: 307, name: "samba-libs", installed: "4.15.13+dfsg-0ubuntu1.6", available: "4.15.13+dfsg-0ubuntu1.7", security: true, cveIds: ["CVE-2024-37371"] },
  { id: 308, name: "socat", installed: "1.7.4.1-3ubuntu4.0.1", available: "1.7.4.1-3ubuntu4.2", security: false, cveIds: [] },
];

const worker01Pkgs: PackageRow[] = [];

function container(
  id: number,
  name: string,
  image: string,
  status: string,
  healthStatus: string | null,
  restartCount: number,
  ageDays: number,
  isUnpinnedLatest = false,
): ContainerRow {
  const tag = image.includes(":") ? image.split(":").pop()! : "latest";
  return {
    id,
    containerId: `ctr-${id}-${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
    name,
    image,
    imageTag: tag,
    imageDigest: "sha256:9f2c3d1e4b5a6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c",
    status,
    healthStatus,
    restartCount,
    createdAt: new Date(Date.now() - ageDays * 86_400_000).toISOString(),
    ageDays,
    isUnpinnedLatest,
  };
}

const web01Containers: ContainerRow[] = [
  container(1, "web", "nginx:1.27.3", "running", "healthy", 0, 92.4),
  container(2, "api", "myrepo/app:2.4.1", "running", "healthy", 2, 45.1),
  container(3, "cache", "redis:7.2-alpine", "running", "healthy", 0, 120.7),
  container(4, "db", "postgres:16.3", "running", "healthy", 1, 201.9),
  container(5, "metrics", "prom/prometheus:latest", "running", null, 0, 310.2, true),
  container(6, "grafana", "grafana/grafana:latest", "restarting", "starting", 14, 60.0, true),
];

const cache01Containers: ContainerRow[] = [
  container(7, "redis-0", "redis:7.0.15", "running", "healthy", 0, 400.5),
  container(8, "redis-1", "redis:7.0.15", "running", "healthy", 0, 400.5),
  container(9, "sentinel", "redis:7.0.15", "exited", null, 3, 4.2),
];

const worker01Containers: ContainerRow[] = [
  container(10, "worker", "myrepo/worker:1.8.0", "running", "healthy", 2, 12.6),
  container(11, "beat", "myrepo/beat:latest", "running", null, 1, 1.3, true),
];

const DEMO_SPECS: DemoSpec[] = [
  {
    id: 1,
    hostname: "web-01",
    label: "Frontend fleet (prod)",
    lastSeenMinutesAgo: 2,
    osInfo: { name: "Ubuntu", version: "24.04 LTS", kernel: "6.8.0-45-generic" },
    blips: [{ offsetDays: 9, hours: 1.5 }],
    packages: web01Pkgs,
    containers: web01Containers,
    docker: {
      installed: true, engineVersion: "27.4.1", apiVersion: "1.47",
      deprecated: false, containersRunning: 8, containersTotal: 8,
    },
  },
  {
    id: 2,
    hostname: "db-01",
    label: "Primary PostgreSQL",
    lastSeenMinutesAgo: 35,
    osInfo: { name: "Debian", version: "12 (bookworm)", kernel: "6.1.0-22-amd64" },
    blips: [{ offsetDays: 21, hours: 3 }, { offsetDays: 3, hours: 2 }],
    packages: db01Pkgs,
    containers: [],
    docker: { installed: false, engineVersion: null, apiVersion: null, deprecated: false, containersRunning: 0, containersTotal: 0 },
  },
  {
    id: 3,
    hostname: "cache-01",
    label: "Redis cluster (staging)",
    lastSeenMinutesAgo: 300,
    osInfo: { name: "Ubuntu", version: "22.04 LTS", kernel: "5.15.0-119-generic" },
    blips: [
      { offsetDays: 12, hours: 6 },
      { offsetDays: 3, hours: 4 },
      { offsetDays: 0.05, hours: 5, ongoing: true },
    ],
    packages: cache01Pkgs,
    containers: cache01Containers,
    docker: {
      installed: true, engineVersion: "20.10.24", apiVersion: "1.41",
      deprecated: true, containersRunning: 2, containersTotal: 4,
    },
  },
  {
    id: 4,
    hostname: "worker-01",
    label: "Job queue runner",
    lastSeenMinutesAgo: 1,
    osInfo: { name: "Ubuntu", version: "24.04 LTS", kernel: "6.8.0-45-generic" },
    blips: [],
    packages: worker01Pkgs,
    containers: worker01Containers,
    docker: {
      installed: true, engineVersion: "26.1.4", apiVersion: "1.45",
      deprecated: false, containersRunning: 2, containersTotal: 3,
    },
  },
];

function eventStartMs(blip: Blip): number {
  return Date.now() - blip.offsetDays * DAY - (blip.ongoing ? 0 : blip.hours) * 3_600_000;
}

function eventEndMs(blip: Blip): number {
  if (blip.ongoing) return Date.now();
  return eventStartMs(blip) + blip.hours * 3_600_000;
}

function computeUptime(blips: Blip[]): number {
  const windowMs = 30 * DAY;
  const now = Date.now();
  const windowStart = now - windowMs;
  let downMs = 0;
  for (const b of blips) {
    const s = Math.max(eventStartMs(b), windowStart);
    const end = eventEndMs(b);
    if (end > s) downMs += end - s;
  }
  return Math.round(((windowMs - Math.max(0, downMs)) / windowMs) * 1000) / 10;
}

function buildSeries(blips: Blip[]): UptimeDay[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const series: UptimeDay[] = [];
  const indexByDay = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const day = new Date(todayStart.getTime() - i * DAY);
    const key = day.toISOString().slice(0, 10);
    indexByDay.set(key, series.length);
    series.push({ day: key, uptimePct: 100, downtimeSec: 0 });
  }
  for (const b of blips) {
    let s = Math.max(eventStartMs(b), todayStart.getTime() - 29 * DAY);
    const en = Math.min(eventEndMs(b), Date.now());
    let cur = new Date(s);
    while (cur.getTime() < en) {
      const dayStart = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
      const nextDay = new Date(dayStart.getTime() + DAY);
      const overlap = Math.max(0, Math.min(en, nextDay.getTime()) - Math.max(s, dayStart.getTime()));
      const idx = indexByDay.get(dayStart.toISOString().slice(0, 10));
      if (idx !== undefined) series[idx].downtimeSec += Math.round(overlap / 1000);
      cur = nextDay;
    }
  }
  for (const d of series) {
    const down = Math.min(d.downtimeSec, 86_400);
    d.uptimePct = Math.round(((86_400 - down) / 86_400) * 1000) / 10;
  }
  return series;
}

function buildEvents(blips: Blip[]): DowntimeEventRow[] {
  return blips.map((b, i) => ({
    id: i + 1,
    startedAt: new Date(eventStartMs(b)).toISOString(),
    endedAt: b.ongoing ? null : new Date(eventEndMs(b)).toISOString(),
    detectedBy: "heartbeat_miss" as const,
    durationSec: b.ongoing
      ? null
      : Math.round((eventEndMs(b) - eventStartMs(b)) / 1000),
  }));
}

/**
 * Deterministic pseudo-metrics for the demo fleet. Derived from the host id so
 * the numbers are stable across renders rather than jittering on every reload.
 */
function demoMetrics(spec: DemoSpec): MetricsSnapshot {
  const seed = spec.id;
  const cpu = 8 + ((seed * 17) % 40);
  const memTotal = (seed % 2 === 0 ? 8 : 4) * 1024 ** 3;
  const memUsed = Math.round(memTotal * (0.35 + ((seed * 7) % 30) / 100));
  // One host is deliberately near-full so the disk warning path is visible.
  const rootPct = seed === 2 ? 91.4 : 42 + ((seed * 11) % 25);
  const rootTotal = 80 * 1024 ** 3;
  const rootUsed = Math.round(rootTotal * (rootPct / 100));

  return {
    collectedAt: new Date(Date.now() - 60_000).toISOString(),
    cpuPct: cpu,
    cpuCores: seed % 2 === 0 ? 4 : 2,
    load1: Math.round((cpu / 25) * 100) / 100,
    load5: Math.round((cpu / 28) * 100) / 100,
    load15: Math.round((cpu / 32) * 100) / 100,
    memTotalBytes: memTotal,
    memUsedBytes: memUsed,
    memAvailableBytes: memTotal - memUsed,
    memUsedPct: Math.round((memUsed / memTotal) * 1000) / 10,
    swapTotalBytes: 2 * 1024 ** 3,
    swapUsedBytes: Math.round(0.05 * 2 * 1024 ** 3),
    uptimeSeconds: 60 * 60 * 24 * (3 + seed),
    processCount: 120 + seed * 9,
    disks: [
      {
        mount: "/",
        fsType: "ext4",
        totalBytes: rootTotal,
        usedBytes: rootUsed,
        availableBytes: rootTotal - rootUsed,
        usePct: Math.round(rootPct * 10) / 10,
        inodeUsePct: 12,
      },
      {
        mount: "/var/lib/docker",
        fsType: "ext4",
        totalBytes: 40 * 1024 ** 3,
        usedBytes: Math.round(40 * 1024 ** 3 * 0.55),
        availableBytes: Math.round(40 * 1024 ** 3 * 0.45),
        usePct: 55,
        inodeUsePct: 8,
      },
    ],
  };
}

/** 24h of pseudo-history, one point every 15 minutes. */
function demoHistory(spec: DemoSpec): MetricPoint[] {
  const now = Date.now();
  const points: MetricPoint[] = [];
  for (let i = 96; i >= 0; i--) {
    const t = now - i * 15 * 60_000;
    const wave = Math.sin((i / 96) * Math.PI * 4 + spec.id);
    const cpu = Math.max(2, Math.min(95, 25 + wave * 18 + (spec.id * 3) % 10));
    const mem = Math.max(10, Math.min(95, 48 + wave * 9 + (spec.id * 5) % 8));
    points.push({
      t: new Date(t).toISOString(),
      cpuPct: Math.round(cpu * 10) / 10,
      memUsedPct: Math.round(mem * 10) / 10,
      load1: Math.round((cpu / 25) * 100) / 100,
    });
  }
  return points;
}

/**
 * Demo vulnerabilities derived from the demo packages already marked as
 * security updates, so the sample fleet demonstrates the feature without
 * inventing CVEs for packages that have none.
 */
function demoVulns(spec: DemoSpec): VulnRow[] {
  const seedCves: Record<string, { id: string; severity: VulnRow["severity"]; score: number; summary: string }> = {
    openssl: {
      id: "CVE-2024-5535",
      severity: "HIGH",
      score: 7.5,
      summary: "SSL_select_next_proto buffer overread with an empty client list.",
    },
    "libssl3": {
      id: "CVE-2024-4741",
      severity: "CRITICAL",
      score: 9.1,
      summary: "Use-after-free in SSL_free_buffers.",
    },
    curl: {
      id: "CVE-2024-2004",
      severity: "MEDIUM",
      score: 5.3,
      summary: "Usage of disabled protocol when a proxy is configured.",
    },
  };

  return spec.packages
    .filter((p) => p.security)
    .flatMap((p) => {
      const cve = seedCves[p.name];
      if (!cve) return [];
      return [
        {
          id: cve.id,
          severity: cve.severity,
          cvssScore: cve.score,
          summary: cve.summary,
          aliases: [],
          packageName: p.name,
          installedVersion: p.installed,
          fixedVersion: p.available,
          firstSeenAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          publishedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
        },
      ];
    });
}

function summaryFor(spec: DemoSpec): HostSummary {
  const lastSeen = new Date(Date.now() - spec.lastSeenMinutesAgo * 60_000);
  const age = Date.now() - lastSeen.getTime();
  const status = age <= STALE_MS ? "online" : age <= DOWN_MS ? "stale" : "down";
  const outdated = spec.packages.length;
  const security = spec.packages.filter((p) => p.security).length;
  const metrics = demoMetrics(spec);
  const maxDisk = metrics.disks.reduce<number | null>(
    (max, d) => (max === null || d.usePct > max ? d.usePct : max),
    null,
  );
  return {
    id: spec.id,
    hostname: spec.hostname,
    label: spec.label,
    lastSeenAt: lastSeen.toISOString(),
    status,
    outdatedPackages: outdated,
    securityPackages: security,
    dockerInstalled: spec.docker.installed,
    dockerDeprecated: spec.docker.deprecated,
    dockerEngineVersion: spec.docker.installed ? spec.docker.engineVersion : null,
    uptimePct30d: computeUptime(spec.blips),
    osLabel: `${spec.osInfo.name} ${spec.osInfo.version}`,
    cpuPct: metrics.cpuPct,
    memUsedPct: metrics.memUsedPct,
    maxDiskUsePct: maxDisk,
    diskAlert: maxDisk !== null && maxDisk >= DISK_WARN_PCT,
    vulnCritical: demoVulns(spec).filter((v) => v.severity === "CRITICAL").length,
    vulnHigh: demoVulns(spec).filter((v) => v.severity === "HIGH").length,
    vulnTotal: demoVulns(spec).length,
  };
}

export function getDemoOverview(): OverviewData {
  return {
    demo: true,
    hosts: DEMO_SPECS.map(summaryFor),
  };
}

export function getDemoHostDetail(id: number): HostDetailData | null {
  const spec = DEMO_SPECS.find((s) => s.id === id);
  if (!spec) return null;
  return {
    demo: true,
    summary: summaryFor(spec),
    os: spec.osInfo,
    packages: spec.packages,
    containers: spec.containers,
    docker: spec.docker,
    uptimeSeries: buildSeries(spec.blips),
    uptimePct30d: computeUptime(spec.blips),
    downtimeEvents: buildEvents(spec.blips),
    metrics: demoMetrics(spec),
    metricHistory: demoHistory(spec),
    vulnerabilities: demoVulns(spec),
  };
}