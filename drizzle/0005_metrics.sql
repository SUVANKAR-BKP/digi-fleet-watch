-- Digi Fleet Watch: host resource metrics (CPU, memory, load, disk).
--
-- The agent previously reported only inventory (packages, Docker, containers),
-- so a host could be minutes from a full disk with nothing on the dashboard
-- hinting at it. Disk exhaustion is the most common way a Linux box dies.

CREATE TABLE IF NOT EXISTS "host_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" integer NOT NULL,
	-- Nullable so a metrics row survives snapshot pruning if we ever decouple
	-- the two; today ingest always writes them together.
	"snapshot_id" integer,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cpu_pct" double precision,
	"cpu_cores" integer,
	"load1" double precision,
	"load5" double precision,
	"load15" double precision,
	"mem_total_bytes" bigint,
	"mem_used_bytes" bigint,
	"mem_available_bytes" bigint,
	"swap_total_bytes" bigint,
	"swap_used_bytes" bigint,
	"uptime_seconds" bigint,
	"process_count" integer
);

DO $$ BEGIN
	ALTER TABLE "host_metrics"
		ADD CONSTRAINT "host_metrics_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "host_metrics"
		ADD CONSTRAINT "host_metrics_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- The access pattern is always "latest N for this host", and the retention job
-- deletes by age.
CREATE INDEX IF NOT EXISTS "host_metrics_host_time_idx"
	ON "host_metrics" ("host_id", "collected_at" DESC);
CREATE INDEX IF NOT EXISTS "host_metrics_collected_at_idx"
	ON "host_metrics" ("collected_at");

CREATE TABLE IF NOT EXISTS "disk_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"metric_id" integer NOT NULL,
	"mount" text NOT NULL,
	"fs_type" text,
	"total_bytes" bigint NOT NULL,
	"used_bytes" bigint NOT NULL,
	"available_bytes" bigint NOT NULL,
	"use_pct" double precision NOT NULL,
	"inode_use_pct" double precision
);

DO $$ BEGIN
	ALTER TABLE "disk_usage"
		ADD CONSTRAINT "disk_usage_metric_id_host_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "host_metrics"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "disk_usage_metric_id_idx" ON "disk_usage" ("metric_id");
