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

  try {
    await saveSettings(
      {
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
