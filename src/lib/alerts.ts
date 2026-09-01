import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import {
  SEVERITY_EMOJI,
  SEVERITY_ORDER,
  asSeverity,
  buildChannelPayload as buildPayload,
  isChannelType,
  previewTarget,
  renderAlertText as renderText,
  validateTarget,
  type Alert,
  type AlertSeverity,
  type ChannelType,
  type SafeChannel,
  type SilenceRow,
} from "./alert-channels";
import { alertSilences, notificationChannels } from "@/db/schema";
import { getDb } from "./db";
import { sendAlertEmail } from "./mail";
import { ensureSchema } from "./migrate";
import { decryptSecret, encryptSecret } from "./secrets";
import { postSlackMessage } from "./slack";

/**
 * Single dispatch point for every alert.
 *
 * Everything that used to call sendAlertEmail/postSlackMessage directly now
 * goes through `dispatchAlert`, which gives one place to apply the two things
 * that make alerting survivable in practice:
 *
 *  1. **Maintenance windows.** Patching a host used to page whoever was on
 *     call. A channel that cries wolf gets muted, and a muted channel is worse
 *     than no channel at all.
 *  2. **Severity routing.** A disk at 85% and a host that vanished are not the
 *     same event; each channel declares the minimum it wants.
 */

export type {
  Alert,
  AlertSeverity,
  ChannelType,
  SafeChannel,
  SilenceRow,
} from "./alert-channels";
export {
  CHANNEL_LABELS,
  CHANNEL_TARGET_HINTS,
  CHANNEL_TYPES,
  buildChannelPayload,
  renderAlertText,
} from "./alert-channels";

// ---------------------------------------------------------------------------
// Silences
// ---------------------------------------------------------------------------

/** True when an active silence covers this host (or the whole fleet). */
export async function isSilenced(hostId?: number): Promise<boolean> {
  try {
    await ensureSchema();
    const now = new Date();
    const rows = await getDb()
      .select({ id: alertSilences.id })
      .from(alertSilences)
      .where(
        and(
          lte(alertSilences.startsAt, now),
          gt(alertSilences.endsAt, now),
          hostId === undefined
            ? isNull(alertSilences.hostId)
            : or(isNull(alertSilences.hostId), eq(alertSilences.hostId, hostId)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    // Fail *open*: a database problem must not silently swallow alerts.
    console.warn("[alerts] could not check silences", (err as Error).message);
    return false;
  }
}

/** Silences that have not yet expired, soonest-ending first. */
export async function listActiveSilences(): Promise<SilenceRow[]> {
  await ensureSchema();
  const { rows } = await getDb().execute<{
    id: number;
    host_id: number | null;
    hostname: string | null;
    reason: string | null;
    starts_at: Date;
    ends_at: Date;
    created_by: string | null;
  }>(sql`
    select s.id, s.host_id, h.hostname, s.reason, s.starts_at, s.ends_at, s.created_by
    from alert_silences s
    left join hosts h on h.id = s.host_id
    where s.ends_at > now()
    order by s.ends_at asc
  `);

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    hostId: r.host_id,
    hostname: r.hostname,
    reason: r.reason,
    startsAt: new Date(r.starts_at).toISOString(),
    endsAt: new Date(r.ends_at).toISOString(),
    createdBy: r.created_by,
    active: new Date(r.starts_at).getTime() <= now,
  }));
}

export async function createSilence(input: {
  hostId: number | null;
  reason: string;
  minutes: number;
  createdBy: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(input.minutes) || input.minutes < 1 || input.minutes > 60 * 24 * 30) {
    return { ok: false, error: "Duration must be between 1 minute and 30 days." };
  }
  await ensureSchema();
  const now = new Date();
  await getDb().insert(alertSilences).values({
    hostId: input.hostId,
    reason: input.reason.trim() || null,
    startsAt: now,
    endsAt: new Date(now.getTime() + input.minutes * 60_000),
    createdBy: input.createdBy,
  });
  return { ok: true };
}

/** Ends a silence immediately rather than deleting the record. */
export async function endSilence(id: number): Promise<{ ok: boolean; error?: string }> {
  await ensureSchema();
  const rows = await getDb()
    .update(alertSilences)
    .set({ endsAt: new Date() })
    .where(eq(alertSilences.id, id))
    .returning({ id: alertSilences.id });
  return rows.length > 0 ? { ok: true } : { ok: false, error: "No such silence." };
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export async function listChannels(): Promise<SafeChannel[]> {
  await ensureSchema();
  const rows = await getDb()
    .select()
    .from(notificationChannels)
    .orderBy(asc(notificationChannels.name));

  return rows.map((r) => {
    const type = isChannelType(r.type) ? r.type : "webhook";
    const target = decryptSecret(r.target) ?? "";
    return {
      id: r.id,
      name: r.name,
      type,
      targetPreview: target ? previewTarget(type, target) : "(unreadable)",
      minSeverity: asSeverity(r.minSeverity),
      enabled: r.enabled,
      lastError: r.lastError,
      lastSentAt: r.lastSentAt ? r.lastSentAt.toISOString() : null,
    };
  });
}

export async function createChannel(input: {
  name: string;
  type: string;
  target: string;
  minSeverity: string;
  createdBy: string;
}): Promise<{ ok: boolean; error?: string }> {
  const name = input.name.trim();
  const target = input.target.trim();

  if (name.length < 1 || name.length > 64) {
    return { ok: false, error: "Name must be 1–64 characters." };
  }
  if (!isChannelType(input.type)) return { ok: false, error: "Unknown channel type." };

  const validation = validateTarget(input.type, target);
  if (validation) return { ok: false, error: validation };

  await ensureSchema();
  await getDb().insert(notificationChannels).values({
    name,
    type: input.type,
    target: encryptSecret(target),
    minSeverity: asSeverity(input.minSeverity),
    createdBy: input.createdBy,
  });
  return { ok: true };
}

export async function setChannelEnabled(
  id: number,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await ensureSchema();
  const rows = await getDb()
    .update(notificationChannels)
    .set({ enabled })
    .where(eq(notificationChannels.id, id))
    .returning({ id: notificationChannels.id });
  return rows.length > 0 ? { ok: true } : { ok: false, error: "No such channel." };
}

export async function deleteChannel(id: number): Promise<{ ok: boolean; error?: string }> {
  await ensureSchema();
  const rows = await getDb()
    .delete(notificationChannels)
    .where(eq(notificationChannels.id, id))
    .returning({ id: notificationChannels.id });
  return rows.length > 0 ? { ok: true } : { ok: false, error: "No such channel." };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

async function deliver(
  channel: { id: number; type: ChannelType; target: string },
  alert: Alert,
): Promise<{ ok: boolean; error?: string }> {
  if (channel.type === "email") {
    // Reuses the configured SMTP transport; the channel supplies the recipient.
    await sendAlertEmail({
      subject: alert.title,
      text: renderText(alert),
      to: channel.target,
    });
    return { ok: true };
  }

  const { body, contentType } = buildPayload(channel.type, alert);
  const headers: Record<string, string> = { "Content-Type": contentType };

  if (channel.type === "ntfy") {
    headers.Title = alert.title;
    headers.Priority = alert.severity === "critical" ? "urgent" : alert.severity === "warning" ? "high" : "default";
  }

  try {
    const res = await fetch(channel.target, { method: "POST", headers, body });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Sends an alert to every eligible channel.
 *
 * Suppressed entirely when a maintenance window covers the host. Delivery
 * failures are recorded against the channel and never thrown: one dead webhook
 * must not stop the others, nor fail the ingest that raised the alert.
 */
export async function dispatchAlert(alert: Alert): Promise<void> {
  if (await isSilenced(alert.hostId)) {
    console.log(`[alerts] suppressed by silence: ${alert.title}`);
    return;
  }

  // Legacy paths: the SMTP recipient and Slack webhook from settings/.env still
  // receive everything, so an existing deployment keeps working with no
  // channels configured. Skipped when the alert names a channel — routing that
  // still broadcast to the global recipient would not be routing.
  if (alert.channelId === undefined) {
    await sendAlertEmail({ subject: alert.title, text: renderText(alert) });
    if (alert.severity !== "info") {
      await postSlackMessage(
        `${SEVERITY_EMOJI[alert.severity]} *${alert.title}*\n${renderText(alert)}`,
      );
    }
  }

  let channels: (typeof notificationChannels.$inferSelect)[];
  try {
    await ensureSchema();
    channels = await getDb()
      .select()
      .from(notificationChannels)
      .where(
        alert.channelId === undefined
          ? eq(notificationChannels.enabled, true)
          : and(
              eq(notificationChannels.enabled, true),
              eq(notificationChannels.id, alert.channelId),
            ),
      );
  } catch (err) {
    console.warn("[alerts] could not load channels", (err as Error).message);
    return;
  }

  // A routed alert whose channel was deleted or disabled would otherwise
  // vanish silently, which is the worst possible failure mode for alerting.
  if (alert.channelId !== undefined && channels.length === 0) {
    console.warn(
      `[alerts] channel ${alert.channelId} is missing or disabled — ` +
        `"${alert.title}" was not delivered`,
    );
    return;
  }

  const wanted = SEVERITY_ORDER[alert.severity];
  for (const row of channels) {
    if (SEVERITY_ORDER[asSeverity(row.minSeverity)] > wanted) continue;

    const type = isChannelType(row.type) ? row.type : "webhook";
    const target = decryptSecret(row.target);
    if (!target) {
      console.warn(
        `[alerts] channel "${row.name}" has an unreadable target — it was ` +
          "probably saved under a different FLEETWATCH_SESSION_SECRET",
      );
      continue;
    }

    const result = await deliver({ id: row.id, type, target }, alert);
    await getDb()
      .update(notificationChannels)
      .set(
        result.ok
          ? { lastSentAt: new Date(), lastError: null }
          : { lastError: result.error ?? "unknown error" },
      )
      .where(eq(notificationChannels.id, row.id))
      .catch(() => {});

    if (!result.ok) {
      console.error(`[alerts] channel "${row.name}" failed: ${result.error}`);
    }
  }
}

/** Sends a test alert to one channel and reports the outcome. */
export async function testChannel(
  id: number,
  triggeredBy: string,
): Promise<{ ok: boolean; error?: string }> {
  await ensureSchema();
  const [row] = await getDb()
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.id, id))
    .limit(1);
  if (!row) return { ok: false, error: "No such channel." };

  const type = isChannelType(row.type) ? row.type : "webhook";
  const target = decryptSecret(row.target);
  if (!target) {
    return {
      ok: false,
      error:
        "The stored target could not be decrypted — re-create this channel " +
        "(FLEETWATCH_SESSION_SECRET has changed).",
    };
  }

  const result = await deliver(
    { id: row.id, type, target },
    {
      severity: "info",
      title: "Digi Fleet Watch test alert",
      body: `This is a test, sent by ${triggeredBy}. Alerts will arrive here.`,
    },
  );

  await getDb()
    .update(notificationChannels)
    .set(
      result.ok
        ? { lastSentAt: new Date(), lastError: null }
        : { lastError: result.error ?? "unknown error" },
    )
    .where(eq(notificationChannels.id, id))
    .catch(() => {});

  return result;
}
