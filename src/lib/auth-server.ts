import { cookies } from "next/headers";
import { SESSION_COOKIE, readSession } from "./session";
import { can, type Permission } from "./rbac";
import { getUser, type SafeUser } from "./users";

/**
 * Node-runtime session helpers.
 *
 * Middleware validates the signed cookie cheaply at the edge; these functions
 * additionally load the live user row. That matters because the role is baked
 * into the cookie at sign-in: without re-reading the record, deactivating an
 * account or demoting someone would not take effect until their cookie expired.
 */

/** The signed-in user, or null. Re-reads the database, so it is always current. */
export async function getCurrentUser(): Promise<SafeUser | null> {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;

  try {
    const user = await getUser(session.uid);
    if (!user || !user.isActive) return null;
    return user;
  } catch (err) {
    // A database outage must fail closed, not hand out access.
    console.error("[auth] could not load the session user", err);
    return null;
  }
}

/**
 * Returns the current user if they hold `permission`, otherwise an error
 * message suitable for showing in the UI. Used by server actions, which are
 * separately reachable and must not rely on middleware alone.
 */
export async function requirePermission(
  permission: Permission,
): Promise<{ ok: true; user: SafeUser } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Your session expired — reload and sign in again." };
  }
  if (!can(user.role, permission)) {
    return {
      ok: false,
      error: `Your role (${user.role}) is not allowed to do this.`,
    };
  }
  return { ok: true, user };
}
