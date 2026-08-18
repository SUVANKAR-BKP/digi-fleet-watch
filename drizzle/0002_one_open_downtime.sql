-- Digi Fleet Watch: at most one open downtime event per host.
--
-- runDowntimeCheck() reads "is there an open event?" and then inserts one.
-- That is a read-then-write with no lock, and it runs on every dashboard load,
-- so two concurrent requests could both observe "no open event" and both insert
-- one — producing duplicate outage rows and duplicate Slack/email alerts.
-- A partial unique index makes the database the arbiter instead.

-- Any duplicates that already exist would block the index, so close all but the
-- most recent open event per host first.
WITH ranked AS (
	SELECT id,
	       row_number() OVER (
	           PARTITION BY host_id ORDER BY started_at DESC, id DESC
	       ) AS rn
	FROM "downtime_events"
	WHERE "ended_at" IS NULL
)
UPDATE "downtime_events" AS d
SET "ended_at" = now()
FROM ranked AS r
WHERE d.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "downtime_events_one_open_per_host"
	ON "downtime_events" ("host_id")
	WHERE "ended_at" IS NULL;
