"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth-server";
import { deleteHost } from "@/lib/data";

/**
 * Removes a host and all of its recorded history.
 *
 * Re-checks the permission here rather than relying on middleware alone: server
 * actions are separately reachable, and this is destructive.
 */
export async function removeHost(
  id: number,
): Promise<{ ok: boolean; error?: string }> {
  const auth = await requirePermission("hosts:delete");
  if (!auth.ok) return { ok: false, error: auth.error };

  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "Invalid host id." };
  }

  try {
    const removed = await deleteHost(id);
    if (!removed) return { ok: false, error: "That host no longer exists." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  console.log(`[hosts] ${auth.user.username} deleted host ${id}`);
  revalidatePath("/");
  return { ok: true };
}
