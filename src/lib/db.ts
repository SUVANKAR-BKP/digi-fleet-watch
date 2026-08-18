import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";

let _pool: Pool | null = null;
let _db: ReturnType<typeof makeDb> | null = null;

function makeDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_500,
  });
  // Fail fast (2.5s) instead of hanging the dashboard when Postgres is down.
  return drizzle(_pool, { schema });
}

/** Lazily creates and returns the shared Drizzle client. */
export function getDb() {
  if (!_db) _db = makeDb();
  return _db;
}

/**
 * The underlying pg Pool. The migration runner needs a raw client so it can
 * send multi-statement SQL (and dollar-quoted DO blocks) over the simple query
 * protocol, which the Drizzle query builder does not expose.
 */
export function getPool(): Pool {
  if (!_db) _db = makeDb();
  return _pool!;
}

export type Db = ReturnType<typeof getDb>;
/** The transaction handle Drizzle hands to `db.transaction(cb)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything queries can run against — the pool client or an open transaction. */
export type DbExecutor = Db | Tx;

/** Closes the underlying pool (used by tests / graceful shutdown). */
export async function closeDb() {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}