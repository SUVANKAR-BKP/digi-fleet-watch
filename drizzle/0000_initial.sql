-- FleetWatch initial schema (PostgreSQL 16)
-- Apply with: npx drizzle-kit push  (dev) or docker compose exec db psql -U fleetwatch -d fleetwatch -f /migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS "hosts" (
	"id" serial PRIMARY KEY NOT NULL,
	"hostname" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "hosts_hostname_unique" UNIQUE("hostname")
);

CREATE TABLE IF NOT EXISTS "snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" integer NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"os_info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"name" text NOT NULL,
	"installed_version" text NOT NULL,
	"available_version" text,
	"is_security_update" boolean DEFAULT false NOT NULL,
	"cve_ids" text[] DEFAULT '{}' NOT NULL
);

CREATE TABLE IF NOT EXISTS "docker_info" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"engine_version" text NOT NULL,
	"is_deprecated" boolean DEFAULT false NOT NULL,
	"api_version" text,
	"containers_running" integer DEFAULT 0 NOT NULL,
	"containers_total" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "heartbeats" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
    CREATE TYPE "detected_by" AS ENUM('heartbeat_miss', 'external_probe');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "downtime_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"detected_by" "detected_by" NOT NULL
);

CREATE INDEX IF NOT EXISTS "hosts_hostname_idx" ON "hosts" ("hostname");
CREATE INDEX IF NOT EXISTS "snapshots_host_id_idx" ON "snapshots" ("host_id");
CREATE INDEX IF NOT EXISTS "packages_snapshot_id_idx" ON "packages" ("snapshot_id");
CREATE INDEX IF NOT EXISTS "docker_info_snapshot_id_idx" ON "docker_info" ("snapshot_id");
CREATE INDEX IF NOT EXISTS "heartbeats_host_id_idx" ON "heartbeats" ("host_id");
CREATE INDEX IF NOT EXISTS "downtime_events_host_id_idx" ON "downtime_events" ("host_id");
CREATE INDEX IF NOT EXISTS "downtime_events_open_idx" ON "downtime_events" ("host_id", "ended_at");

ALTER TABLE "snapshots"
	ADD CONSTRAINT "snapshots_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE cascade;
ALTER TABLE "packages"
	ADD CONSTRAINT "packages_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE cascade;
ALTER TABLE "docker_info"
	ADD CONSTRAINT "docker_info_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE cascade;
ALTER TABLE "heartbeats"
	ADD CONSTRAINT "heartbeats_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE cascade;
ALTER TABLE "downtime_events"
	ADD CONSTRAINT "downtime_events_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE cascade;