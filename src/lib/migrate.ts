import fs from "node:fs";
import path from "node:path";
import { getPool } from "./db";

/**
 * Minimal forward-only migration runner.
 *
 * Why this exists: docker-compose mounts `drizzle/` at
 * /docker-entrypoint-initdb.d, but Postgres only executes that directory when
 * it initialises an *empty* data directory. Any migration added after the
 * volume was first created therefore never runs, which is how a deployment
 * ends up with `hosts` but no `containers` table — the overview keeps working
 * while the host detail page 500s. Applying migrations from the app on start-up
 * makes an existing volume converge on the current schema.
 *
 * Every file is applied at most once (tracked in `_fleetwatch_migrations`) and
 * the files themselves are written to be idempotent, so replaying them against
 * a database that predates the ledger is safe.
 */

/** Arbitrary constant so concurrent app replicas serialise on the same lock. */
const LOCK_KEY = 47110817;

const LEDGER = "_fleetwatch_migrations";

function migrationsDir(): string {
  return path.join(process.cwd(), "drizzle");
}

/** Reads the .sql files to apply, in lexical (== chronological) order. */
export function listMigrations(): { name: string; sql: string }[] {
  const dir = migrationsDir();
  if (!fs.existsSync(dir)) {
    console.warn(`[migrate] no migrations directory at ${dir} — skipping`);
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: fs.readFileSync(path.join(dir, name), "utf8"),
    }));
}

/** Applies any migrations not yet recorded in the ledger. Returns their names. */
export async function runMigrations(): Promise<string[]> {
  const pending = listMigrations();
  if (pending.length === 0) return [];

  const applied: string[] = [];
  // One dedicated connection: pg advisory locks are session-scoped, so the
  // lock and the migrations must share a client.
  const client = await getPool().connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS "${LEDGER}" (
         "name" text PRIMARY KEY,
         "applied_at" timestamp with time zone DEFAULT now() NOT NULL
       )`,
    );
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      const { rows } = await client.query<{ name: string }>(
        `SELECT name FROM "${LEDGER}"`,
      );
      const done = new Set(rows.map((r) => r.name));

      for (const m of pending) {
        if (done.has(m.name)) continue;
        try {
          await client.query("BEGIN");
          await client.query(m.sql);
          await client.query(`INSERT INTO "${LEDGER}" (name) VALUES ($1)`, [
            m.name,
          ]);
          await client.query("COMMIT");
          applied.push(m.name);
          console.log(`[migrate] applied ${m.name}`);
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw new Error(
            `migration ${m.name} failed: ${(err as Error).message}`,
            { cause: err },
          );
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
  }

  if (applied.length === 0) console.log("[migrate] schema already up to date");
  return applied;
}

let inflight: Promise<string[]> | null = null;

/**
 * Runs the migrations at most once per process. A failure clears the memo so
 * the next request retries — otherwise a database that was still booting when
 * the app started would leave the schema permanently unmigrated.
 */
export function ensureSchema(): Promise<string[]> {
  if (!inflight) {
    inflight = runMigrations().catch((err) => {
      inflight = null;
      throw err;
    });
  }
  return inflight;
}
