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

/** Closes the underlying pool (used by tests / graceful shutdown). */
export async function closeDb() {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}