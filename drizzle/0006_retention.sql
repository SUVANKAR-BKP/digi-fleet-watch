-- Digi Fleet Watch: daily rollups so history survives raw-data pruning.
--
-- At a 5-minute cadence each host writes 288 snapshots a day, each carrying a
-- full raw_payload plus a row per package and per container. Nothing ever
-- deleted them, so storage grew without bound — on the order of 50-200 MB per
-- host per month. Raw rows are now pruned after a retention window, but only
-- once the day they belong to has been summarised here, so long-range trends
-- survive at roughly 1/288th of the size.

CREATE TABLE IF NOT EXISTS "host_daily_rollup" (
	"host_id" integer NOT NULL,
	"day" date NOT NULL,
	"uptime_pct" double precision,
	"downtime_sec" integer DEFAULT 0 NOT NULL,
	"outdated_packages" integer,
	"security_packages" integer,
	"containers_running" integer,
	"containers_total" integer,
	"cpu_pct_avg" double precision,
	"cpu_pct_max" double precision,
	"mem_used_pct_avg" double precision,
	"mem_used_pct_max" double precision,
	"disk_use_pct_max" double precision,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_daily_rollup_pk" PRIMARY KEY ("host_id", "day")
);

DO $$ BEGIN
	ALTER TABLE "host_daily_rollup"
		ADD CONSTRAINT "host_daily_rollup_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "host_daily_rollup_day_idx" ON "host_daily_rollup" ("day");

-- Pruning deletes by age; without these the retention job would seq-scan the
-- largest tables in the database every run.
CREATE INDEX IF NOT EXISTS "snapshots_collected_at_idx" ON "snapshots" ("collected_at");
CREATE INDEX IF NOT EXISTS "heartbeats_received_at_idx" ON "heartbeats" ("received_at");
