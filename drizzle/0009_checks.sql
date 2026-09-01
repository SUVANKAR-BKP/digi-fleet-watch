-- Digi Fleet Watch: external service checks (TCP, HTTP, TLS expiry).
--
-- Everything until now was agent-push: the dashboard knows a host is alive
-- because it phoned home. That says nothing about whether the service on it
-- still works. A box can sit at 2% CPU with a healthy agent while nginx
-- returns 502 to every visitor.
--
-- These checks run from the server, so they also cover the case the agent
-- cannot report on at all: the host being unreachable from outside.

CREATE TABLE IF NOT EXISTS "checks" (
	"id" serial PRIMARY KEY NOT NULL,
	-- Optional association, so a check can appear on a host's page. A check
	-- with no host is still valid (an external dependency, a customer URL).
	"host_id" integer,
	"name" text NOT NULL,
	-- tcp | http | tls
	"type" text NOT NULL,
	-- "host:port" for tcp/tls, a full URL for http
	"target" text NOT NULL,
	-- HTTP only. NULL accepts any 2xx/3xx.
	"expected_status" integer,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"interval_seconds" integer DEFAULT 300 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,

	-- Current state. Denormalised onto the row so the dashboard and the
	-- transition detection do not need to scan check_results.
	"last_run_at" timestamp with time zone,
	"last_ok" boolean,
	"last_latency_ms" integer,
	"last_detail" text,
	"cert_expires_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"alerted_down" boolean DEFAULT false NOT NULL,
	"cert_alerted_at" timestamp with time zone,

	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "checks"
		ADD CONSTRAINT "checks_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "checks_host_id_idx" ON "checks" ("host_id");
CREATE INDEX IF NOT EXISTS "checks_due_idx" ON "checks" ("enabled", "last_run_at");

-- History, for the latency sparkline and an availability figure. Pruned by the
-- retention job alongside snapshots and metrics.
CREATE TABLE IF NOT EXISTS "check_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"check_id" integer NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"latency_ms" integer,
	"detail" text
);

DO $$ BEGIN
	ALTER TABLE "check_results"
		ADD CONSTRAINT "check_results_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "checks"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "check_results_check_time_idx"
	ON "check_results" ("check_id", "ran_at" DESC);
CREATE INDEX IF NOT EXISTS "check_results_ran_at_idx" ON "check_results" ("ran_at");
