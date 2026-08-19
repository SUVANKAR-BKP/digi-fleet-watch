"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  authConfigured,
  verifySession,
} from "@/lib/dashboard-auth";
import { deleteHost } from "@/lib/data";

/**
 * Removes a host and all of its recorded history.
 *
 * Re-checks the session here rather than relying on middleware alone: this is
 * a destructive action, and defence in depth is cheap.
 */
export async function removeHost(
  id: number,
): Promise<{ ok: boolean; error?: string }> {
  if (authConfigured()) {
    const ok = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
    if (!ok) {
      return { ok: false, error: "Your session expired — reload and sign in again." };
    }
  }

  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "Invalid host id." };
  }

  try {
    const removed = await deleteHost(id);
    if (!removed) return { ok: false, error: "That host no longer exists." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  revalidatePath("/");
  return { ok: true };
}
