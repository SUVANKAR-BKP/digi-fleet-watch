"use server";

import { revalidatePath } from "next/cache";
import {
  createChannel,
  createSilence,
  deleteChannel,
  endSilence,
  setChannelEnabled,
  testChannel,
} from "@/lib/alerts";
import { requirePermission } from "@/lib/auth-server";

type Result = { ok: boolean; error?: string; message?: string };

/**
 * Silences are gated on `hosts:delete` rather than `settings:manage`: muting
 * alerts for a host is day-to-day operator work (you are about to patch it),
 * not an administrative configuration change.
 */
export async function addSilence(input: {
  hostId: number | null;
  reason: string;
  minutes: number;
}): Promise<Result> {
  const auth = await requirePermission("hosts:delete");
  if (!auth.ok) return auth;

  const result = await createSilence({ ...input, createdBy: auth.user.username });
  if (!result.ok) return result;

  console.log(
    `[alerts] ${auth.user.username} silenced ` +
      `${input.hostId === null ? "the whole fleet" : `host ${input.hostId}`} ` +
      `for ${input.minutes}m`,
  );
  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true, message: "Alerts silenced." };
}

export async function stopSilence(id: number): Promise<Result> {
  const auth = await requirePermission("hosts:delete");
  if (!auth.ok) return auth;

  const result = await endSilence(id);
  if (!result.ok) return result;
  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true, message: "Silence ended." };
}

export async function addChannel(input: {
  name: string;
  type: string;
  target: string;
  minSeverity: string;
}): Promise<Result> {
  const auth = await requirePermission("settings:manage");
  if (!auth.ok) return auth;

  const result = await createChannel({ ...input, createdBy: auth.user.username });
  if (!result.ok) return result;
  console.log(`[alerts] ${auth.user.username} added a ${input.type} channel`);
  revalidatePath("/settings");
  return { ok: true, message: "Channel added." };
}

export async function toggleChannel(id: number, enabled: boolean): Promise<Result> {
  const auth = await requirePermission("settings:manage");
  if (!auth.ok) return auth;
  const result = await setChannelEnabled(id, enabled);
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function removeChannel(id: number): Promise<Result> {
  const auth = await requirePermission("settings:manage");
  if (!auth.ok) return auth;
  const result = await deleteChannel(id);
  if (result.ok) revalidatePath("/settings");
  return result;
}

/** Delivers a real message so a bad webhook surfaces while the admin watches. */
export async function sendChannelTest(id: number): Promise<Result> {
  const auth = await requirePermission("settings:manage");
  if (!auth.ok) return auth;

  const result = await testChannel(id, auth.user.username);
  revalidatePath("/settings");
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, message: "Test message delivered." };
}
