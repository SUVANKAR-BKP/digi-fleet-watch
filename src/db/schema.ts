import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/** How a downtime event was first detected. */
export const detectedByEnum = pgEnum("detected_by", [
  "heartbeat_miss",
  "external_probe",
]);

/** Dashboard access levels. See src/lib/rbac.ts for what each one may do. */
export const userRoleEnum = pgEnum("user_role", ["admin", "operator", "viewer"]);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull().unique(),
    /** scrypt digest: scrypt$N$r$p$saltHex$hashHex — never a raw password. */
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("viewer"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("users_username_lower_idx").on(sql`lower(${t.username})`),
  ],
);

/**
 * Runtime configuration an admin can edit from the dashboard (alerting, for
 * now). Values marked `isSecret` are encrypted at rest and never returned to
 * the browser — see src/lib/secrets.ts and src/lib/settings.ts.
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  isSecret: boolean("is_secret").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: text("updated_by"),
});

export const hosts = pgTable(
  "hosts",
  {
    id: serial("id").primaryKey(),
    hostname: text("hostname").notNull().unique(),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [index("hosts_hostname_idx").on(t.hostname)],
);

export const snapshots = pgTable(
  "snapshots",
  {
    id: serial("id").primaryKey(),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    collectedAt: timestamp("collected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    osInfo: jsonb("os_info")
      .$type<{ name?: string; version?: string; kernel?: string }>()
      .notNull()
      .default({}),
    rawPayload: jsonb("raw_payload").notNull().default({}),
  },
  (t) => [index("snapshots_host_id_idx").on(t.hostId)],
);

export const packages = pgTable(
  "packages",
  {
    id: serial("id").primaryKey(),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    installedVersion: text("installed_version").notNull(),
    availableVersion: text("available_version"),
    isSecurityUpdate: boolean("is_security_update").notNull().default(false),
    cveIds: text("cve_ids").array().notNull().default([]),
  },
  (t) => [index("packages_snapshot_id_idx").on(t.snapshotId)],
);

export const dockerInfo = pgTable(
  "docker_info",
  {
    id: serial("id").primaryKey(),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    engineVersion: text("engine_version").notNull(),
    isDeprecated: boolean("is_deprecated").notNull().default(false),
    apiVersion: text("api_version"),
    containersRunning: integer("containers_running").notNull().default(0),
    containersTotal: integer("containers_total").notNull().default(0),
  },
  (t) => [index("docker_info_snapshot_id_idx").on(t.snapshotId)],
);

/**
 * Per-container detail for one snapshot. is_unpinned_latest is a *proxy* for
 * image drift risk (a :latest/untagged image is not pinned to a reproducible
 * tag) — it is NOT a registry comparison. Detecting a genuinely out-of-date
 * image requires a per-image registry query (`docker manifest inspect`), which
 * is deliberately not implemented; see README "Known limitations".
 */
export const containers = pgTable(
  "containers",
  {
    id: serial("id").primaryKey(),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    containerId: text("container_id").notNull(),
    name: text("name").notNull(),
    image: text("image").notNull(),
    imageTag: text("image_tag"),
    imageDigest: text("image_digest"),
    status: text("status").notNull(),
    healthStatus: text("health_status"),
    restartCount: integer("restart_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }),
    ageDays: doublePrecision("age_days"),
    isUnpinnedLatest: boolean("is_unpinned_latest").notNull().default(false),
  },
  (t) => [index("containers_snapshot_id_idx").on(t.snapshotId)],
);

/**
 * Point-in-time resource sample for a host. One row per agent report, pruned
 * by the retention job and summarised into host_daily_rollup before deletion.
 */
export const hostMetrics = pgTable(
  "host_metrics",
  {
    id: serial("id").primaryKey(),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    snapshotId: integer("snapshot_id").references(() => snapshots.id, {
      onDelete: "cascade",
    }),
    collectedAt: timestamp("collected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    cpuPct: doublePrecision("cpu_pct"),
    cpuCores: integer("cpu_cores"),
    load1: doublePrecision("load1"),
    load5: doublePrecision("load5"),
    load15: doublePrecision("load15"),
    // bigint: byte counts exceed a 32-bit int on any modern machine.
    memTotalBytes: bigint("mem_total_bytes", { mode: "number" }),
    memUsedBytes: bigint("mem_used_bytes", { mode: "number" }),
    memAvailableBytes: bigint("mem_available_bytes", { mode: "number" }),
    swapTotalBytes: bigint("swap_total_bytes", { mode: "number" }),
    swapUsedBytes: bigint("swap_used_bytes", { mode: "number" }),
    uptimeSeconds: bigint("uptime_seconds", { mode: "number" }),
    processCount: integer("process_count"),
  },
  (t) => [
    index("host_metrics_host_time_idx").on(t.hostId, t.collectedAt),
    index("host_metrics_collected_at_idx").on(t.collectedAt),
  ],
);

/** Per-mount disk usage belonging to one metrics sample. */
export const diskUsage = pgTable(
  "disk_usage",
  {
    id: serial("id").primaryKey(),
    metricId: integer("metric_id")
      .notNull()
      .references(() => hostMetrics.id, { onDelete: "cascade" }),
    mount: text("mount").notNull(),
    fsType: text("fs_type"),
    totalBytes: bigint("total_bytes", { mode: "number" }).notNull(),
    usedBytes: bigint("used_bytes", { mode: "number" }).notNull(),
    availableBytes: bigint("available_bytes", { mode: "number" }).notNull(),
    usePct: doublePrecision("use_pct").notNull(),
    inodeUsePct: doublePrecision("inode_use_pct"),
  },
  (t) => [index("disk_usage_metric_id_idx").on(t.metricId)],
);

/**
 * One row per host per day, written before the raw rows for that day are
 * pruned. This is what makes long-range history affordable.
 */
export const hostDailyRollup = pgTable(
  "host_daily_rollup",
  {
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    uptimePct: doublePrecision("uptime_pct"),
    downtimeSec: integer("downtime_sec").notNull().default(0),
    outdatedPackages: integer("outdated_packages"),
    securityPackages: integer("security_packages"),
    containersRunning: integer("containers_running"),
    containersTotal: integer("containers_total"),
    cpuPctAvg: doublePrecision("cpu_pct_avg"),
    cpuPctMax: doublePrecision("cpu_pct_max"),
    memUsedPctAvg: doublePrecision("mem_used_pct_avg"),
    memUsedPctMax: doublePrecision("mem_used_pct_max"),
    diskUsePctMax: doublePrecision("disk_use_pct_max"),
    sampleCount: integer("sample_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.hostId, t.day] }),
    index("host_daily_rollup_day_idx").on(t.day),
  ],
);

/** A vulnerability record fetched from OSV.dev, cached locally. */
export const vulnerabilities = pgTable(
  "vulnerabilities",
  {
    id: text("id").primaryKey(),
    summary: text("summary"),
    details: text("details"),
    severity: text("severity").notNull().default("UNKNOWN"),
    cvssScore: doublePrecision("cvss_score"),
    aliases: text("aliases").array().notNull().default([]),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    modifiedAt: timestamp("modified_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("vulnerabilities_severity_idx").on(t.severity)],
);

/**
 * Which hosts are exposed to which vulnerability.
 *
 * Keyed on the host, not on a package row: package rows belong to a snapshot
 * and get pruned by retention, but this exposure record must outlive them.
 */
export const hostVulnerabilities = pgTable(
  "host_vulnerabilities",
  {
    id: serial("id").primaryKey(),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    vulnId: text("vuln_id")
      .notNull()
      .references(() => vulnerabilities.id, { onDelete: "cascade" }),
    packageName: text("package_name").notNull(),
    installedVersion: text("installed_version").notNull(),
    fixedVersion: text("fixed_version"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    unique("host_vulnerabilities_unique").on(t.hostId, t.vulnId, t.packageName),
    index("host_vulnerabilities_host_idx").on(t.hostId),
    index("host_vulnerabilities_vuln_idx").on(t.vulnId),
  ],
);

/**
 * A maintenance window during which alerts are suppressed.
 * A null hostId silences the whole fleet.
 */
export const alertSilences = pgTable(
  "alert_silences",
  {
    id: serial("id").primaryKey(),
    hostId: integer("host_id").references(() => hosts.id, { onDelete: "cascade" }),
    reason: text("reason"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("alert_silences_window_idx").on(t.endsAt, t.hostId)],
);

/** Where alerts are delivered. `target` is encrypted at rest. */
export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    target: text("target").notNull(),
    minSeverity: text("min_severity").notNull().default("info"),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  },
  (t) => [index("notification_channels_enabled_idx").on(t.enabled)],
);

/**
 * An external probe run from the server: TCP connect, HTTP request, or TLS
 * certificate expiry. Current state is denormalised onto the row so the
 * dashboard and transition detection never have to scan check_results.
 */
export const checks = pgTable(
  "checks",
  {
    id: serial("id").primaryKey(),
    hostId: integer("host_id").references(() => hosts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    target: text("target").notNull(),
    expectedStatus: integer("expected_status"),
    /** none | contains | not_contains | regex | json_path */
    assertionKind: text("assertion_kind").notNull().default("none"),
    assertionValue: text("assertion_value"),
    assertionPath: text("assertion_path"),
    /** Above this response time the check is degraded, not down. NULL disables. */
    degradedAboveMs: integer("degraded_above_ms"),
    /** Probe attempts within a single run, including the first. */
    attempts: integer("attempts").notNull().default(2),
    /**
     * Upstream check. While the upstream is down this check still records
     * results but raises no alerts, so one dead router does not page forty
     * times for the services behind it.
     */
    dependsOnCheckId: integer("depends_on_check_id").references(
      (): AnyPgColumn => checks.id,
      { onDelete: "set null" },
    ),
    /** Availability target, e.g. 99.9. NULL means no SLO is tracked. */
    sloTarget: doublePrecision("slo_target"),
    /**
     * Route this check's alerts to one channel instead of all of them. NULL
     * keeps the default fan-out.
     */
    alertChannelId: integer("alert_channel_id").references(
      () => notificationChannels.id,
      { onDelete: "set null" },
    ),
    timeoutMs: integer("timeout_ms").notNull().default(10_000),
    intervalSeconds: integer("interval_seconds").notNull().default(300),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    /** ok | degraded | down */
    lastStatus: text("last_status"),
    lastOk: boolean("last_ok"),
    lastLatencyMs: integer("last_latency_ms"),
    lastDetail: text("last_detail"),
    /** maintenance | dependency | flapping, when the last run was silenced. */
    suppressedBy: text("suppressed_by"),
    certExpiresAt: timestamp("cert_expires_at", { withTimezone: true }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    alertedDown: boolean("alerted_down").notNull().default(false),
    alertedDegraded: boolean("alerted_degraded").notNull().default(false),
    certAlertedAt: timestamp("cert_alerted_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("checks_host_id_idx").on(t.hostId),
    index("checks_due_idx").on(t.enabled, t.lastRunAt),
    index("checks_depends_on_idx").on(t.dependsOnCheckId),
  ],
);

/**
 * A planned silence.
 *
 * Alerting during a deploy you are running yourself trains people to ignore
 * alerts, which costs far more than the one real incident it might catch.
 */
export const maintenanceWindows = pgTable(
  "maintenance_windows",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    /** fleet | host | check */
    scope: text("scope").notNull(),
    hostId: integer("host_id").references(() => hosts.id, { onDelete: "cascade" }),
    checkId: integer("check_id").references(() => checks.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("maintenance_windows_active_idx").on(t.endsAt, t.startsAt)],
);

export const checkResults = pgTable(
  "check_results",
  {
    id: serial("id").primaryKey(),
    checkId: integer("check_id")
      .notNull()
      .references(() => checks.id, { onDelete: "cascade" }),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
    ok: boolean("ok").notNull(),
    /**
     * ok | degraded | down. Kept alongside `ok` rather than replacing it so
     * history written before three-state status still reads correctly, and so
     * availability arithmetic can stay a cheap boolean aggregate.
     */
    status: text("status"),
    latencyMs: integer("latency_ms"),
    detail: text("detail"),
  },
  (t) => [
    index("check_results_check_time_idx").on(t.checkId, t.ranAt),
    index("check_results_ran_at_idx").on(t.ranAt),
  ],
);

export const heartbeats = pgTable(
  "heartbeats",
  {
    id: serial("id").primaryKey(),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("heartbeats_host_id_idx").on(t.hostId)],
);

export const downtimeEvents = pgTable(
  "downtime_events",
  {
    id: serial("id").primaryKey(),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    detectedBy: detectedByEnum("detected_by").notNull(),
  },
  (t) => [
    index("downtime_events_host_id_idx").on(t.hostId),
    index("downtime_events_open_idx").on(t.hostId, t.endedAt),
    // At most one open outage per host — this is what makes the concurrent
    // insert in runDowntimeCheck() safe. See drizzle/0002.
    uniqueIndex("downtime_events_one_open_per_host")
      .on(t.hostId)
      .where(sql`${t.endedAt} is null`),
  ],
);

export const hostsRelations = relations(hosts, ({ many }) => ({
  snapshots: many(snapshots),
  heartbeats: many(heartbeats),
  downtimeEvents: many(downtimeEvents),
}));

export const snapshotsRelations = relations(snapshots, ({ one, many }) => ({
  host: one(hosts, { fields: [snapshots.hostId], references: [hosts.id] }),
  packages: many(packages),
  dockerInfo: many(dockerInfo),
  containers: many(containers),
}));

export const packagesRelations = relations(packages, ({ one }) => ({
  snapshot: one(snapshots, { fields: [packages.snapshotId], references: [snapshots.id] }),
}));

export const dockerInfoRelations = relations(dockerInfo, ({ one }) => ({
  snapshot: one(snapshots, { fields: [dockerInfo.snapshotId], references: [snapshots.id] }),
}));

export const containersRelations = relations(containers, ({ one }) => ({
  snapshot: one(snapshots, { fields: [containers.snapshotId], references: [snapshots.id] }),
}));

export const heartbeatsRelations = relations(heartbeats, ({ one }) => ({
  host: one(hosts, { fields: [heartbeats.hostId], references: [hosts.id] }),
}));

export const downtimeEventsRelations = relations(downtimeEvents, ({ one }) => ({
  host: one(hosts, { fields: [downtimeEvents.hostId], references: [hosts.id] }),
}));

export type Check = typeof checks.$inferSelect;
export type CheckResult = typeof checkResults.$inferSelect;
export type MaintenanceWindowRow = typeof maintenanceWindows.$inferSelect;
export type AlertSilence = typeof alertSilences.$inferSelect;
export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type Vulnerability = typeof vulnerabilities.$inferSelect;
export type HostVulnerability = typeof hostVulnerabilities.$inferSelect;
export type HostDailyRollup = typeof hostDailyRollup.$inferSelect;
export type HostMetric = typeof hostMetrics.$inferSelect;
export type DiskUsage = typeof diskUsage.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserRole = User["role"];
export type Host = typeof hosts.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;
export type Package = typeof packages.$inferSelect;
export type DockerInfo = typeof dockerInfo.$inferSelect;
export type Container = typeof containers.$inferSelect;
export type DowntimeEvent = typeof downtimeEvents.$inferSelect;