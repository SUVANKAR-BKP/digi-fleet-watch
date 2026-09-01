import { asc, count, eq, sql } from "drizzle-orm";
import { users } from "@/db/schema";
import { getDb } from "./db";
import { ensureSchema } from "./migrate";
import {
  hashPassword,
  validatePassword,
  validateUsername,
  verifyPassword,
} from "./password";
import type { UserRole } from "./rbac";

/** A user as exposed to the UI — never includes the password hash. */
export interface SafeUser {
  id: number;
  username: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

function toSafe(row: typeof users.$inferSelect): SafeUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
  };
}

/** How many accounts exist. 0 means the instance still needs first-run setup. */
export async function countUsers(): Promise<number> {
  await ensureSchema();
  const [row] = await getDb().select({ value: count() }).from(users);
  return row?.value ?? 0;
}

export async function listUsers(): Promise<SafeUser[]> {
  await ensureSchema();
  const rows = await getDb().select().from(users).orderBy(asc(users.username));
  return rows.map(toSafe);
}

export async function getUser(id: number): Promise<SafeUser | null> {
  await ensureSchema();
  const [row] = await getDb().select().from(users).where(eq(users.id, id));
  return row ? toSafe(row) : null;
}

/**
 * Creates an account. Usernames are matched case-insensitively so `Admin` and
 * `admin` cannot both exist.
 */
export async function createUser(input: {
  username: string;
  password: string;
  role: UserRole;
}): Promise<{ ok: true; user: SafeUser } | { ok: false; error: string }> {
  const username = input.username.trim();

  const usernameError = validateUsername(username);
  if (usernameError) return { ok: false, error: usernameError };
  const passwordError = validatePassword(input.password);
  if (passwordError) return { ok: false, error: passwordError };

  await ensureSchema();
  const db = getDb();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);
  if (existing.length > 0) {
    return { ok: false, error: `The username "${username}" is already taken.` };
  }

  try {
    const [row] = await db
      .insert(users)
      .values({
        username,
        passwordHash: await hashPassword(input.password),
        role: input.role,
      })
      .returning();
    return { ok: true, user: toSafe(row) };
  } catch (err) {
    // The unique index is the real arbiter — two concurrent creates can both
    // pass the check above.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("users_username")) {
      return { ok: false, error: `The username "${username}" is already taken.` };
    }
    throw err;
  }
}

/** A syntactically valid digest that matches nothing, for timing equalisation. */
const DUMMY_DIGEST = `scrypt$16384$8$1$${"00".repeat(16)}$${"00".repeat(64)}`;

/**
 * Checks a username/password pair. Returns null for unknown users, wrong
 * passwords and deactivated accounts alike — the caller must not distinguish
 * them, or the form becomes a username oracle.
 */
export async function verifyLogin(
  username: string,
  password: string,
): Promise<SafeUser | null> {
  await ensureSchema();
  const db = getDb();

  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username.trim()})`)
    .limit(1);

  if (!row) {
    // Spend comparable time on unknown usernames so response time does not
    // reveal which accounts exist.
    await verifyPassword(password, DUMMY_DIGEST);
    return null;
  }

  if (!(await verifyPassword(password, row.passwordHash))) return null;
  if (!row.isActive) return null;

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.id));

  return toSafe(row);
}

export async function setPassword(
  id: number,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const passwordError = validatePassword(password);
  if (passwordError) return { ok: false, error: passwordError };

  await ensureSchema();
  const rows = await getDb()
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  return rows.length > 0 ? { ok: true } : { ok: false, error: "No such user." };
}

/**
 * Number of enabled admins, optionally ignoring one id. Used to refuse changes
 * that would leave nobody able to manage users.
 */
async function activeAdminCount(excludeId?: number): Promise<number> {
  const db = getDb();
  const base = sql`${users.role} = 'admin' and ${users.isActive}`;
  const [row] = await db
    .select({ value: count() })
    .from(users)
    .where(
      excludeId === undefined ? base : sql`${base} and ${users.id} <> ${excludeId}`,
    );
  return row?.value ?? 0;
}

const LAST_ADMIN_ERROR =
  "This is the last active admin — promote another account first.";

export async function setRole(
  id: number,
  role: UserRole,
): Promise<{ ok: boolean; error?: string }> {
  await ensureSchema();
  if (role !== "admin" && (await activeAdminCount(id)) === 0) {
    return { ok: false, error: LAST_ADMIN_ERROR };
  }
  const rows = await getDb()
    .update(users)
    .set({ role })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  return rows.length > 0 ? { ok: true } : { ok: false, error: "No such user." };
}

export async function setActive(
  id: number,
  isActive: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await ensureSchema();
  if (!isActive && (await activeAdminCount(id)) === 0) {
    return { ok: false, error: LAST_ADMIN_ERROR };
  }
  const rows = await getDb()
    .update(users)
    .set({ isActive })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  return rows.length > 0 ? { ok: true } : { ok: false, error: "No such user." };
}

export async function deleteUser(
  id: number,
): Promise<{ ok: boolean; error?: string }> {
  await ensureSchema();
  if ((await activeAdminCount(id)) === 0) {
    return { ok: false, error: LAST_ADMIN_ERROR };
  }
  const rows = await getDb()
    .delete(users)
    .where(eq(users.id, id))
    .returning({ id: users.id });
  return rows.length > 0 ? { ok: true } : { ok: false, error: "No such user." };
}

/**
 * Seeds the first admin from the environment when the instance has no accounts.
 *
 * Two sources, in order:
 *   1. FLEETWATCH_ADMIN_USER + FLEETWATCH_ADMIN_PASSWORD — for automated deploys
 *   2. FLEETWATCH_DASHBOARD_PASSWORD — the previous shared password, so an
 *      existing deployment upgrades into an `admin` account rather than locking
 *      its operator out
 *
 * Does nothing once any account exists, so it cannot resurrect a deleted admin
 * or overwrite a changed password.
 */
export async function seedInitialAdmin(): Promise<string | null> {
  if ((await countUsers()) > 0) return null;

  const envUser = process.env.FLEETWATCH_ADMIN_USER?.trim();
  const envPass = process.env.FLEETWATCH_ADMIN_PASSWORD;
  const legacyPass = process.env.FLEETWATCH_DASHBOARD_PASSWORD;

  let username: string;
  let password: string;
  let source: string;

  if (envUser && envPass) {
    username = envUser;
    password = envPass;
    source = "FLEETWATCH_ADMIN_USER/FLEETWATCH_ADMIN_PASSWORD";
  } else if (legacyPass) {
    username = "admin";
    password = legacyPass;
    source = "FLEETWATCH_DASHBOARD_PASSWORD (legacy shared password)";
  } else {
    return null;
  }

  const result = await createUser({ username, password, role: "admin" });
  if (!result.ok) {
    console.error(`[users] could not seed the initial admin: ${result.error}`);
    return null;
  }
  console.log(`[users] created initial admin "${username}" from ${source}`);
  return username;
}
