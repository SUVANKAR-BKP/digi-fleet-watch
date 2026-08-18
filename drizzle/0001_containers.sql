-- Digi Fleet Watch: per-container snapshot detail (0101)
-- Apply with:
--   docker compose exec db psql -U fleetwatch -d fleetwatch -f /docker-entrypoint-initdb.d/0001_containers.sql
-- or, for an existing volume:
--   docker compose exec -T db psql -U fleetwatch -d fleetwatch < drizzle/0001_containers.sql

CREATE TABLE IF NOT EXISTS "containers" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"container_id" text NOT NULL,
	"name" text NOT NULL,
	"image" text NOT NULL,
	"image_tag" text,
	"image_digest" text,
	"status" text NOT NULL,
	"health_status" text,
	"restart_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone,
	"age_days" double precision,
	"is_unpinned_latest" boolean DEFAULT false NOT NULL
);

CREATE INDEX IF NOT EXISTS "containers_snapshot_id_idx" ON "containers" ("snapshot_id");

ALTER TABLE "containers"
	ADD CONSTRAINT "containers_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE cascade;