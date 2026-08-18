import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  containers as containersTable,
  dockerInfo as dockerInfoTable,
  heartbeats,
  hosts,
  packages as packagesTable,
  snapshots,
} from "@/db/schema";
import { getDb } from "./db";
import { closeOpenDowntime } from "./downtime";
import { sendAlertEmail } from "./mail";
import type { AgentPackagePayload, AgentPayload } from "./types";

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
    containers: z
      .array(
        z.object({
          container_id: z.string().min(1),
          name: z.string().min(1),
          image: z.string().min(1),
          image_tag: z.string().nullable().optional(),
          // Locally-built images may have no RepoDigest, so `""` / null are valid.
          image_digest: z.union([z.string(), z.null()]).optional(),
          status: z.string(),
          // Containers without a healthcheck send `""` / null here.
          health_status: z.union([z.string(), z.null()]).optional(),
          restart_count: z.number().int().min(0).optional(),
          created_at: z
            .union([z.string().datetime(), z.string().length(0), z.null()])
            .optional(),
          age_days: z.number().min(0).optional(),
          is_unpinned_latest: z.boolean().optional(),
        }),
      )
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

  // Work out what's *new* since the last snapshot so we alert once per
  // update instead of on every 5-minute heartbeat.
  const newUpdates: AgentPackagePayload[] = [];
  let dockerDeprecatedNew = false;

  const [prevSnap] = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.hostId, hostId))
    .orderBy(desc(snapshots.collectedAt))
    .limit(1);

  if (prevSnap) {
    const prevPkgs = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.snapshotId, prevSnap.id));
    const prevAvail = new Map<string, string>();
    for (const r of prevPkgs) if (r.availableVersion) prevAvail.set(r.name, r.availableVersion);

    for (const p of payload.packages ?? []) {
      if (!p.available) continue;
      const was = prevAvail.get(p.name);
      if (was === undefined || was !== p.available) newUpdates.push(p);
    }

    const [prevDk] = await db
      .select()
      .from(dockerInfoTable)
      .where(eq(dockerInfoTable.snapshotId, prevSnap.id))
      .limit(1);
    if (payload.docker?.deprecated && !prevDk?.isDeprecated) dockerDeprecatedNew = true;
  }

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
  
    if (payload.containers && payload.containers.length > 0) {
      await db.insert(containersTable).values(
        payload.containers.map((c) => ({
          snapshotId,
          containerId: c.container_id,
          name: c.name,
          image: c.image,
          imageTag: c.image_tag ?? null,
          imageDigest: c.image_digest ?? null,
          status: c.status,
          healthStatus: c.health_status ?? null,
          restartCount: c.restart_count ?? 0,
          createdAt: c.created_at ? new Date(c.created_at) : null,
          ageDays: c.age_days ?? null,
          isUnpinnedLatest: c.is_unpinned_latest ?? false,
        })),
      );
    }
  
    await db.insert(heartbeats).values({ hostId, receivedAt: now });
  
    // Recovery: close any open downtime event now that the host reported again.
    const closed = await closeOpenDowntime(hostId, now);
    if (closed > 0) {
      await sendAlertEmail({
        subject: `Host recovered: ${payload.hostname}`,
        text:
          `Good news — host \`${payload.hostname}\` is reporting again.\n\n` +
          `Last heartbeat: ${now.toISOString()}`,
      });
    }
  
    // Alert once when new package updates appear (security ones stand out).
    if (newUpdates.length > 0) {
      const securityCount = newUpdates.filter((p) => p.security).length;
      await sendAlertEmail({
        subject: `${newUpdates.length} new package update${newUpdates.length === 1 ? "" : "s"} on ${payload.hostname}`,
        text: formatUpdateEmail(payload.hostname, newUpdates, securityCount),
      });
    }
  
    // Alert when a host first reports a deprecated Docker engine.
    if (dockerDeprecatedNew && payload.docker) {
      await sendAlertEmail({
        subject: `Docker engine deprecated on ${payload.hostname}`,
        text:
          `Host \`${payload.hostname}\` is running Docker ` +
          `${payload.docker.engine_version ?? "unknown"}, which has reached end of life.\n\n` +
          `Plan an upgrade to a supported engine version.`,
      });
    }
  
    return { hostId, snapshotId };
  }
  
  function formatUpdateEmail(
    hostname: string,
    updates: AgentPackagePayload[],
    securityCount: number,
  ): string {
    const lines = updates
      .map((u) => {
        const sec = u.security ? "  [SECURITY]" : "";
        return `- ${u.name}: ${u.installed} -> ${u.available}${sec}`;
      })
      .join("\n");
    return (
      `Host \`${hostname}\` has ${updates.length} newly available package update${updates.length === 1 ? "" : "s"}` +
      `${securityCount > 0 ? ` (${securityCount} security)` : ""}:\n\n${lines}\n\n` +
      `Review at the Digi Fleet Watch dashboard.`
    );
  }