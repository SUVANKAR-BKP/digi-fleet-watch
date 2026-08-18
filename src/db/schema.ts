import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** How a downtime event was first detected. */
export const detectedByEnum = pgEnum("detected_by", [
  "heartbeat_miss",
  "external_probe",
]);

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
}));

export const packagesRelations = relations(packages, ({ one }) => ({
  snapshot: one(snapshots, { fields: [packages.snapshotId], references: [snapshots.id] }),
}));

export const dockerInfoRelations = relations(dockerInfo, ({ one }) => ({
  snapshot: one(snapshots, { fields: [dockerInfo.snapshotId], references: [snapshots.id] }),
}));

export const heartbeatsRelations = relations(heartbeats, ({ one }) => ({
  host: one(hosts, { fields: [heartbeats.hostId], references: [hosts.id] }),
}));

export const downtimeEventsRelations = relations(downtimeEvents, ({ one }) => ({
  host: one(hosts, { fields: [downtimeEvents.hostId], references: [hosts.id] }),
}));

export type Host = typeof hosts.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;
export type Package = typeof packages.$inferSelect;
export type DockerInfo = typeof dockerInfo.$inferSelect;
export type DowntimeEvent = typeof downtimeEvents.$inferSelect;