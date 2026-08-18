import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  dockerInfo as dockerInfoTable,
  heartbeats,
  hosts,
  packages as packagesTable,
  snapshots,
} from "@/db/schema";
import { getDb } from "./db";
import { closeOpenDowntime } from "./downtime";
import type { AgentPayload } from "./types";

const ingestSchema = z.object({
  hostname: z.string().min(1).max(255),
  label: z.string().max(255).optional(),
  os: z
    .object({
      name: z.string().optional(),
      version: z.string().optional(),
      kernel: z.string().optional(),
    })
    .optional(),
  collected_at: z.string().datetime().optional(),
  packages: z
    .array(
      z.object({
        name: z.string().min(1),
        installed: z.string(),
        available: z.string().optional().nullable(),
        security: z.boolean().optional(),
        cve_ids: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  docker: z
    .object({
      engine_version: z.string().optional(),
      api_version: z.string().optional(),
      deprecated: z.boolean().optional(),
      containers_running: z.number().int().min(0).optional(),
      containers_total: z.number().int().min(0).optional(),
    })
    .nullable()
    .optional(),
});

export function parseAgentPayload(raw: unknown): AgentPayload {
  return ingestSchema.parse(raw);
}

/** Validates, stores, and returns the normalized payload. */
export async function processIngest(
  payload: AgentPayload,
): Promise<{ hostId: number; snapshotId: number }> {
  const db = getDb();
  const now = new Date();

  const [host] = await db
    .insert(hosts)
    .values({ hostname: payload.hostname, label: payload.label ?? null, lastSeenAt: now })
    .onConflictDoUpdate({
      target: hosts.hostname,
      set: { label: sql`excluded.label`, lastSeenAt: now },
    })
    .returning({ id: hosts.id });
  const hostId = host.id;

  const collectedAt = payload.collected_at ? new Date(payload.collected_at) : now;

  const [snapshot] = await db
    .insert(snapshots)
    .values({
      hostId,
      collectedAt,
      osInfo: payload.os ?? {},
      rawPayload: payload as unknown as Record<string, unknown>,
    })
    .returning({ id: snapshots.id });
  const snapshotId = snapshot.id;

  if (payload.packages && payload.packages.length > 0) {
    await db.insert(packagesTable).values(
      payload.packages.map((p) => ({
        snapshotId,
        name: p.name,
        installedVersion: p.installed,
        availableVersion: p.available ?? null,
        isSecurityUpdate: p.security ?? false,
        cveIds: p.cve_ids ?? [],
      })),
    );
  }

  if (payload.docker) {
    await db.insert(dockerInfoTable).values({
      snapshotId,
      engineVersion: payload.docker.engine_version ?? "unknown",
      isDeprecated: payload.docker.deprecated ?? false,
      apiVersion: payload.docker.api_version ?? null,
      containersRunning: payload.docker.containers_running ?? 0,
      containersTotal: payload.docker.containers_total ?? 0,
    });
  }

  await db.insert(heartbeats).values({ hostId, receivedAt: now });

  // Recovery: any open downtime event is closed now that we heard from the host.
  await closeOpenDowntime(hostId, now);

  return { hostId, snapshotId };
}