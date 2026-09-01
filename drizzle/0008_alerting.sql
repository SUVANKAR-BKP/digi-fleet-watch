-- Digi Fleet Watch: maintenance windows and pluggable notification channels.
--
-- Two gaps this closes:
--   1. There was no way to suppress alerts during planned work, so patching a
--      host paged whoever was on call. Alert channels that cry wolf get muted,
--      and a muted channel is worse than no channel.
--   2. Alerting was hard-wired to one SMTP recipient and one Slack webhook.

CREATE TABLE IF NOT EXISTS "alert_silences" (
	"id" serial PRIMARY KEY NOT NULL,
	-- NULL means "every host" — a fleet-wide maintenance window.
	"host_id" integer,
	"reason" text,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "alert_silences"
		ADD CONSTRAINT "alert_silences_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Every alert checks this table, so the active-window lookup must be indexed.
CREATE INDEX IF NOT EXISTS "alert_silences_window_idx"
	ON "alert_silences" ("ends_at", "host_id");

CREATE TABLE IF NOT EXISTS "notification_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	-- email | slack | discord | teams | ntfy | webhook
	"type" text NOT NULL,
	-- Encrypted at rest: webhook URLs are credentials. See src/lib/secrets.ts.
	"target" text NOT NULL,
	-- info | warning | critical — the channel receives this and above.
	"min_severity" text DEFAULT 'info' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"last_sent_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "notification_channels_enabled_idx"
	ON "notification_channels" ("enabled");
