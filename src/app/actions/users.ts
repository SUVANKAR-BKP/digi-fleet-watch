"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, getCurrentUser } from "@/lib/auth-server";
import { isUserRole, type UserRole } from "@/lib/rbac";
import {
  createUser,
  deleteUser,
  setActive,
  setPassword,
  setRole,
} from "@/lib/users";
import { validatePassword } from "@/lib/password";
import { verifyLogin } from "@/lib/users";

type Result = { ok: boolean; error?: string };

/** Creates an account. Admin only. */
export async function addUser(formData: FormData): Promise<Result> {
  const auth = await requirePermission("users:manage");
  if (!auth.ok) return auth;

  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "viewer");

  if (!isUserRole(role)) return { ok: false, error: "Unknown role." };

  const result = await createUser({ username, password, role });
  if (!result.ok) return { ok: false, error: result.error };

  console.log(`[users] ${auth.user.username} created "${result.user.username}" (${role})`);
  revalidatePath("/users");
  return { ok: true };
}

/** Changes someone's role. Admin only; cannot demote the last admin. */
export async function changeRole(id: number, role: string): Promise<Result> {
  const auth = await requirePermission("users:manage");
  if (!auth.ok) return auth;
  if (!isUserRole(role)) return { ok: false, error: "Unknown role." };

  // Guard against an admin removing their own last privilege by accident.
  if (auth.user.id === id && role !== "admin") {
    return { ok: false, error: "You cannot change your own role." };
  }

  const result = await setRole(id, role as UserRole);
  if (result.ok) {
    console.log(`[users] ${auth.user.username} set user ${id} to ${role}`);
    revalidatePath("/users");
  }
  return result;
}

/** Enables or disables an account without deleting its history. */
export async function changeActive(id: number, isActive: boolean): Promise<Result> {
  const auth = await requirePermission("users:manage");
  if (!auth.ok) return auth;
  if (auth.user.id === id) {
    return { ok: false, error: "You cannot deactivate your own account." };
  }

  const result = await setActive(id, isActive);
  if (result.ok) {
    console.log(
      `[users] ${auth.user.username} ${isActive ? "enabled" : "disabled"} user ${id}`,
    );
    revalidatePath("/users");
  }
  return result;
}

/** Admin-initiated password reset for another account. */
export async function resetPassword(id: number, password: string): Promise<Result> {
  const auth = await requirePermission("users:manage");
  if (!auth.ok) return auth;

  const result = await setPassword(id, password);
  if (result.ok) {
    console.log(`[users] ${auth.user.username} reset the password for user ${id}`);
    revalidatePath("/users");
  }
  return result;
}

/** Permanently removes an account. */
export async function removeUser(id: number): Promise<Result> {
  const auth = await requirePermission("users:manage");
  if (!auth.ok) return auth;
  if (auth.user.id === id) {
    return { ok: false, error: "You cannot delete your own account." };
  }

  const result = await deleteUser(id);
  if (result.ok) {
    console.log(`[users] ${auth.user.username} deleted user ${id}`);
    revalidatePath("/users");
  }
  return result;
}

/**
 * Self-service password change. Requires the current password, so a borrowed
 * unlocked browser cannot silently lock the real owner out.
 */
export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired — sign in again." };

  const policyError = validatePassword(newPassword);
  if (policyError) return { ok: false, error: policyError };

  const verified = await verifyLogin(user.username, currentPassword);
  if (!verified) return { ok: false, error: "Your current password is incorrect." };

  const result = await setPassword(user.id, newPassword);
  if (result.ok) console.log(`[users] ${user.username} changed their own password`);
  return result;
}
