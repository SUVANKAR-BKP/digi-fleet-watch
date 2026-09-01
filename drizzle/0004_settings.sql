-- Digi Fleet Watch: runtime settings editable from the dashboard.
--
-- Alerting (SMTP + Slack) previously lived only in .env, so changing a
-- recipient or webhook meant editing a file on the server and restarting the
-- container. This table lets an admin configure it from the UI instead; env
-- vars remain as the fallback/bootstrap.
--
-- Secret values (SMTP password, Slack webhook URL) are stored encrypted —
-- see src/lib/secrets.ts. `is_secret` marks those rows so the API never
-- returns them to the browser.

CREATE TABLE IF NOT EXISTS "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"is_secret" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
