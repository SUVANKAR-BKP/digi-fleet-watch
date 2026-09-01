"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth-server";
import { sendTestEmail } from "@/lib/mail";
import { encryptionAvailable } from "@/lib/secrets";
import { saveSettings } from "@/lib/settings";
import { sendTestSlack } from "@/lib/slack";

type Result = { ok: boolean; error?: string; message?: string };

export interface AlertSettingsInput {
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUser: string;
  /** Blank means "keep the stored password". */
  smtpPass: string;
  mailFrom: string;
  alertEmailTo: string;
  /** Blank means "keep the stored webhook". */
  slackWebhookUrl: string;
  /** Explicit clears, since blank means "unchanged" for the two secrets. */
  clearSmtpPass?: boolean;
  clearSlackWebhook?: boolean;
  retentionRawDays: string;
  retentionRollupDays: string;
}

function invalidPort(value: string): boolean {
  if (value === "") return false;
  const n = Number(value);
  return !Number.isInteger(n) || n < 1 || n > 65535;
}

export async function saveAlertSettings(
  input: AlertSettingsInput,
): Promise<Result> {
  const auth = await requirePermission("settings:manage");
  if (!auth.ok) return auth;

  if (invalidPort(input.smtpPort)) {
    return { ok: false, error: "SMTP port must be a number between 1 and 65535." };
  }

  const webhook = input.slackWebhookUrl.trim();
  if (webhook && !/^https:\/\/hooks\.slack\.com\//.test(webhook)) {
    return {
      ok: false,
      error: "That does not look like a Slack incoming webhook URL (https://hooks.slack.com/…).",
    };
  }

  const wantsToStoreSecret = Boolean(input.smtpPass || webhook);
  if (wantsToStoreSecret && !encryptionAvailable()) {
    return {
      ok: false,
      error:
        "Secrets cannot be stored: set FLEETWATCH_SESSION_SECRET (or AGENT_API_TOKEN) on the server.",
    };
  }

  const rawDays = Number(input.retentionRawDays);
  const rollupDays = Number(input.retentionRollupDays);
  if (!Number.isInteger(rawDays) || rawDays < 1 || rawDays > 365) {
    return { ok: false, error: "Raw retention must be between 1 and 365 days." };
  }
  if (!Number.isInteger(rollupDays) || rollupDays < 7 || rollupDays > 3650) {
    return { ok: false, error: "Rollup retention must be between 7 and 3650 days." };
  }
  if (rollupDays < rawDays) {
    return {
      ok: false,
      error: "Rollups must be kept at least as long as raw data.",
    };
  }

  try {
    await saveSettings(
      {
        retentionRawDays: String(rawDays),
        retentionRollupDays: String(rollupDays),
        smtpHost: input.smtpHost.trim(),
        smtpPort: input.smtpPort.trim(),
        smtpSecure: input.smtpSecure ? "true" : "false",
        smtpUser: input.smtpUser.trim(),
        mailFrom: input.mailFrom.trim(),
        alertEmailTo: input.alertEmailTo.trim(),
        // undefined = leave untouched; "" = clear and fall back to env.
        smtpPass: input.clearSmtpPass ? "" : input.smtpPass || undefined,
        slackWebhookUrl: input.clearSlackWebhook ? "" : webhook || undefined,
      },
      auth.user.username,
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  console.log(`[settings] ${auth.user.username} updated alerting settings`);
  revalidatePath("/settings");
  return { ok: true, message: "Settings saved." };
}

/** Runs a retention pass now, so an admin can reclaim space without waiting. */
export async function runRetentionNow(): Promise<Result> {
  const auth = await requirePermission("settings:manage");
  if (!auth.ok) return auth;

  try {
    const { runRetention } = await import("@/lib/retention");
    const r = await runRetention();
    console.log(`[settings] ${auth.user.username} ran retention manually`);
    return {
      ok: true,
      message:
        `Rolled up ${r.rolledUpDays} host-day(s); pruned ${r.deletedSnapshots} ` +
        `snapshots, ${r.deletedMetrics} metric samples, ${r.deletedHeartbeats} heartbeats.`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Triggers a vulnerability scan now rather than waiting for the 6h job. */
export async function runVulnScanNow(): Promise<Result> {
  const auth = await requirePermission("settings:manage");
  if (!auth.ok) return auth;

  try {
    const { scanFleetForVulnerabilities } = await import("@/lib/vulnerabilities");
    const r = await scanFleetForVulnerabilities();
    console.log(`[settings] ${auth.user.username} ran a vulnerability scan manually`);
    return {
      ok: true,
      message:
        `Scanned ${r.scannedHosts} host(s): ${r.findings} finding(s), ` +
        `${r.newVulns} new advisor${r.newVulns === 1 ? "y" : "ies"}.`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sends a real email using the saved configuration and reports the result. */
export async function testEmail(): Promise<Result> {
  const auth = await requirePermission("settings:manage");
  if (!auth.ok) return auth;

  const result = await sendTestEmail(auth.user.username);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, message: `Test email sent to ${result.sentTo}.` };
}

/** Posts a real message to the saved webhook and reports the result. */
export async function testSlack(): Promise<Result> {
  const auth = await requirePermission("settings:manage");
  if (!auth.ok) return auth;

  const result = await sendTestSlack(auth.user.username);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, message: "Test message posted to Slack." };
}
