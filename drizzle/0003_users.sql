-- Digi Fleet Watch: dashboard user accounts with roles.
--
-- Replaces the single shared FLEETWATCH_DASHBOARD_PASSWORD with named accounts,
-- so access can be granted and revoked per person and privileged actions
-- (deleting hosts, reading the agent token, managing users) can be restricted.

DO $$ BEGIN
	CREATE TYPE "user_role" AS ENUM('admin', 'operator', 'viewer');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	-- scrypt digest, self-describing: scrypt$N$r$p$saltHex$hashHex
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);

-- Usernames are compared case-insensitively so "Admin" and "admin" cannot both
-- exist and confuse whoever is signing in.
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_lower_idx"
	ON "users" (lower("username"));
