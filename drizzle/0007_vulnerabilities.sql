-- Digi Fleet Watch: real vulnerability records for installed packages.
--
-- The agent already collects exact package names and versions on every host —
-- the expensive half of the problem. Until now that was only rendered as a
-- count. Matching it against OSV.dev turns "3 security updates" into named,
-- severity-scored CVEs, and makes the fleet-wide question answerable:
-- "which hosts are affected by CVE-XXXX, and what fixes it?"

CREATE TABLE IF NOT EXISTS "vulnerabilities" (
	-- OSV id: CVE-2024-1234, DSA-5678-1, GHSA-xxxx, ...
	"id" text PRIMARY KEY NOT NULL,
	"summary" text,
	"details" text,
	-- CRITICAL / HIGH / MEDIUM / LOW / UNKNOWN
	"severity" text DEFAULT 'UNKNOWN' NOT NULL,
	"cvss_score" double precision,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"published_at" timestamp with time zone,
	"modified_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "vulnerabilities_severity_idx" ON "vulnerabilities" ("severity");

-- Deliberately keyed on the host rather than a package row: package rows belong
-- to a snapshot and are pruned by the retention job, but "this host is exposed
-- to this CVE" must outlive the snapshot that revealed it.
CREATE TABLE IF NOT EXISTS "host_vulnerabilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" integer NOT NULL,
	"vuln_id" text NOT NULL,
	"package_name" text NOT NULL,
	"installed_version" text NOT NULL,
	"fixed_version" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "host_vulnerabilities_unique" UNIQUE ("host_id", "vuln_id", "package_name")
);

DO $$ BEGIN
	ALTER TABLE "host_vulnerabilities"
		ADD CONSTRAINT "host_vulnerabilities_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "host_vulnerabilities"
		ADD CONSTRAINT "host_vulnerabilities_vuln_id_fk" FOREIGN KEY ("vuln_id") REFERENCES "vulnerabilities"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "host_vulnerabilities_host_idx" ON "host_vulnerabilities" ("host_id");
CREATE INDEX IF NOT EXISTS "host_vulnerabilities_vuln_idx" ON "host_vulnerabilities" ("vuln_id");
-- The dashboard almost always asks for unresolved rows only.
CREATE INDEX IF NOT EXISTS "host_vulnerabilities_open_idx"
	ON "host_vulnerabilities" ("host_id") WHERE "resolved_at" IS NULL;
