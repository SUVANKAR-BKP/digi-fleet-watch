-- Digi Fleet Watch: assertions, degraded state, dependencies, maintenance
-- windows and SLO targets for external checks.
--
-- The first cut of checks was binary: a status code passed or it did not. That
-- misses the two failures operators actually lose sleep over -- the endpoint
-- returning 200 with {"status":"degraded"} in the body, and the endpoint that
-- still answers but has slid from 80ms to 4s. It also alerted on every
-- transition, which is how a flapping target trains a team to mute the channel.
--
-- Written to be idempotent: the app applies migrations on start-up against
-- volumes that may already be at any earlier version.

-- Body assertions. NULL/none keeps the existing status-code-only behaviour.
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "assertion_kind" text NOT NULL DEFAULT 'none';
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "assertion_value" text;
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "assertion_path" text;

-- Response-time threshold. Above it the check is degraded, not down.
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "degraded_above_ms" integer;

-- Retries inside a single run. Two by default: enough to shrug off a dropped
-- packet, not so many that a genuinely dead target holds the runner hostage.
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 2;

-- Upstream dependency. Self-referencing: ON DELETE SET NULL rather than
-- CASCADE, because deleting a router check must not silently delete every
-- service check behind it.
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "depends_on_check_id" integer;

DO $$ BEGIN
	ALTER TABLE "checks"
		ADD CONSTRAINT "checks_depends_on_check_id_checks_id_fk"
		FOREIGN KEY ("depends_on_check_id") REFERENCES "checks"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "checks_depends_on_idx" ON "checks" ("depends_on_check_id");

-- Availability target, e.g. 99.9. NULL means no SLO is tracked for this check.
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "slo_target" double precision;

-- Per-check alert routing. NULL keeps the default fan-out to every eligible
-- channel; setting it sends this check somewhere specific, so a noisy staging
-- probe does not reach the on-call room. SET NULL on delete, so removing a
-- channel degrades to the default rather than deleting the check.
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "alert_channel_id" integer;

DO $$ BEGIN
	ALTER TABLE "checks"
		ADD CONSTRAINT "checks_alert_channel_id_notification_channels_id_fk"
		FOREIGN KEY ("alert_channel_id") REFERENCES "notification_channels"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Three-state status alongside the existing boolean. `last_ok` is kept so
-- history and availability aggregates written before this migration still read
-- correctly.
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "last_status" text;
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "suppressed_by" text;
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "alerted_degraded" boolean NOT NULL DEFAULT false;

ALTER TABLE "check_results" ADD COLUMN IF NOT EXISTS "status" text;

-- Backfill status from the boolean so percentile and incident queries do not
-- have to special-case rows written before the column existed.
UPDATE "checks"
	SET "last_status" = CASE WHEN "last_ok" THEN 'ok' ELSE 'down' END
	WHERE "last_status" IS NULL AND "last_ok" IS NOT NULL;

UPDATE "check_results"
	SET "status" = CASE WHEN "ok" THEN 'ok' ELSE 'down' END
	WHERE "status" IS NULL;

-- Planned silences. Alerting during a deploy you are running yourself trains
-- people to ignore alerts, which costs more than the one real incident it
-- might have caught.
CREATE TABLE IF NOT EXISTS "maintenance_windows" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	-- fleet | host | check. Explicit rather than inferred from which id is
	-- set, so "covers everything" and "covers the check whose id I forgot to
	-- fill in" cannot be the same row.
	"scope" text NOT NULL,
	"host_id" integer,
	"check_id" integer,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "maintenance_windows"
		ADD CONSTRAINT "maintenance_windows_host_id_hosts_id_fk"
		FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "maintenance_windows"
		ADD CONSTRAINT "maintenance_windows_check_id_checks_id_fk"
		FOREIGN KEY ("check_id") REFERENCES "checks"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- The hot query is "windows active right now", which reads end first.
CREATE INDEX IF NOT EXISTS "maintenance_windows_active_idx"
	ON "maintenance_windows" ("ends_at", "starts_at");

-- Percentiles and incident derivation both scan a check over a time range with
-- the status column; this keeps that off a sequential scan as history grows.
CREATE INDEX IF NOT EXISTS "check_results_status_idx"
	ON "check_results" ("check_id", "ran_at" DESC, "status");
