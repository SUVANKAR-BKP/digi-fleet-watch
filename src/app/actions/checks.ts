"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, requirePermission } from "@/lib/auth-server";
import {
  checkIncidents,
  createCheck,
  createMaintenanceWindow,
  deleteCheck,
  deleteMaintenanceWindow,
  runCheckNow,
  setCheckEnabled,
} from "@/lib/checks";
import type { Incident } from "@/lib/check-types";

type Result = { ok: boolean; error?: string; message?: string };

/**
 * Incident history for one check, loaded when a row is expanded.
 *
 * Read-only, so it needs a session but not the operator permission the
 * mutating actions require.
 */
export async function fetchIncidents(
  checkId: number,
): Promise<{ ok: boolean; incidents?: Incident[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };
  return { ok: true, incidents: await checkIncidents(checkId) };
}

/** Empty string means "not set", which is not the same as zero. */
function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : Number(trimmed);
}

/**
 * Checks are operator-level, matching silences: deciding what to probe is
 * fleet work, not administrative configuration.
 */
export async function addCheck(input: {
  hostId: number | null;
  name: string;
  type: string;
  target: string;
  expectedStatus: string;
  assertionKind: string;
  assertionValue: string;
  assertionPath: string;
  degradedAboveMs: string;
  attempts: string;
  insecureTls: boolean;
  dependsOnCheckId: string;
  sloTarget: string;
  alertChannelId: string;
  intervalSeconds: string;
}): Promise<Result> {
  const auth = await requirePermission("hosts:delete");
  if (!auth.ok) return auth;

  const result = await createCheck({
    hostId: input.hostId,
    name: input.name,
    type: input.type,
    target: input.target,
    expectedStatus: optionalNumber(input.expectedStatus),
    assertionKind: input.assertionKind,
    assertionValue: input.assertionValue.trim() || null,
    assertionPath: input.assertionPath.trim() || null,
    degradedAboveMs: optionalNumber(input.degradedAboveMs),
    attempts: Number(input.attempts) || 2,
    insecureTls: input.insecureTls,
    dependsOnCheckId: optionalNumber(input.dependsOnCheckId),
    sloTarget: optionalNumber(input.sloTarget),
    alertChannelId: optionalNumber(input.alertChannelId),
    intervalSeconds: Number(input.intervalSeconds),
    createdBy: auth.user.username,
  });
  if (!result.ok) return result;

  console.log(`[checks] ${auth.user.username} added ${input.type} check "${input.name}"`);
  revalidatePath("/checks");
  revalidatePath("/");
  return { ok: true, message: "Check created. First run within 30 seconds." };
}

export async function toggleCheck(id: number, enabled: boolean): Promise<Result> {
  const auth = await requirePermission("hosts:delete");
  if (!auth.ok) return auth;
  const result = await setCheckEnabled(id, enabled);
  if (result.ok) revalidatePath("/checks");
  return result;
}

export async function removeCheck(id: number): Promise<Result> {
  const auth = await requirePermission("hosts:delete");
  if (!auth.ok) return auth;
  const result = await deleteCheck(id);
  if (result.ok) revalidatePath("/checks");
  return result;
}

/** Probes immediately so a new check can be confirmed while you watch. */
export async function probeNow(id: number): Promise<Result> {
  const auth = await requirePermission("hosts:delete");
  if (!auth.ok) return auth;

  const result = await runCheckNow(id);
  revalidatePath("/checks");
  if (result.error) return { ok: false, error: result.error };

  const verdict =
    result.status === "ok" ? "Passed" : result.status === "degraded" ? "Degraded" : "Failed";
  return { ok: true, message: `${verdict} — ${result.detail ?? "no detail"}` };
}

// ---------------------------------------------------------------------------
// Maintenance windows
// ---------------------------------------------------------------------------

export async function addMaintenanceWindow(input: {
  name: string;
  scope: string;
  hostId: string;
  checkId: string;
  startsAt: string;
  endsAt: string;
}): Promise<Result> {
  const auth = await requirePermission("hosts:delete");
  if (!auth.ok) return auth;

  const result = await createMaintenanceWindow({
    name: input.name,
    scope: input.scope,
    hostId: optionalNumber(input.hostId),
    checkId: optionalNumber(input.checkId),
    // datetime-local gives wall-clock time with no zone; the browser and the
    // server agree because the Date constructor reads it as local time on
    // whichever machine parses it — here, the server.
    startsAt: new Date(input.startsAt),
    endsAt: new Date(input.endsAt),
    createdBy: auth.user.username,
  });
  if (!result.ok) return result;

  console.log(
    `[checks] ${auth.user.username} scheduled maintenance "${input.name}" (${input.scope})`,
  );
  revalidatePath("/checks");
  return { ok: true, message: "Maintenance window scheduled." };
}

export async function removeMaintenanceWindow(id: number): Promise<Result> {
  const auth = await requirePermission("hosts:delete");
  if (!auth.ok) return auth;
  const result = await deleteMaintenanceWindow(id);
  if (result.ok) revalidatePath("/checks");
  return result;
}
