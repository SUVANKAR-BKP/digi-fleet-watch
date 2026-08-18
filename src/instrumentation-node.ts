import { ensureSchema } from "./lib/migrate";

/**
 * Brings the database schema up to date before the first request, so a
 * deployment whose Postgres volume predates a migration (the
 * `/docker-entrypoint-initdb.d` scripts only run on an empty volume) heals
 * itself instead of 500ing on tables that were never created.
 *
 * Best-effort by design: if Postgres is still booting we log and move on —
 * `ensureSchema()` is retried lazily on the first request that touches the DB.
 */
export async function registerNode(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[startup] DATABASE_URL is not set — skipping migrations");
    return;
  }

  // Postgres may still be starting up alongside the app; give it a few tries.
  const delaysMs = [0, 1_000, 2_000, 4_000, 8_000];
  for (const [attempt, delay] of delaysMs.entries()) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      const applied = await ensureSchema();
      if (applied.length > 0) {
        console.log(`[startup] applied ${applied.length} migration(s)`);
      }
      return;
    } catch (err) {
      const message = (err as Error).message;
      if (attempt === delaysMs.length - 1) {
        console.error(
          `[startup] migrations failed after ${delaysMs.length} attempts: ${message} — ` +
            "will retry on the first database request",
        );
      } else {
        console.warn(`[startup] migration attempt ${attempt + 1} failed: ${message}`);
      }
    }
  }
}
