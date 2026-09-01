import { relations, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
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

export type Setting = typeof settings.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserRole = User["role"];
export type Host = typeof hosts.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;
export type Package = typeof packages.$inferSelect;
export type DockerInfo = typeof dockerInfo.$inferSelect;
export type Container = typeof containers.$inferSelect;
export type DowntimeEvent = typeof downtimeEvents.$inferSelect;