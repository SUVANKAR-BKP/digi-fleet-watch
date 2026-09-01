import { inArray } from "drizzle-orm";
import { settings } from "@/db/schema";
import { getDb } from "./db";
import { ensureSchema } from "./migrate";
import { decryptSecret, encryptSecret, encryptionAvailable } from "./secrets";

/**
 * Runtime configuration, editable from the dashboard.
 *
 * Precedence is database first, environment second. The env vars stay useful
 * as a bootstrap (a deployment can ship working alerting on day one) while the
 * UI becomes the place to change a recipient or webhook without editing a file
 * on the server and restarting.
 *
 * Secret values are encrypted at rest and never leave the server.
 */

export const SETTING_KEYS = {
  smtpHost: "smtp.host",
  smtpPort: "smtp.port",
  smtpSecure: "smtp.secure",
  smtpUser: "smtp.user",
  smtpPass: "smtp.pass",
  mailFrom: "smtp.from",
  alertEmailTo: "smtp.to",
  slackWebhookUrl: "slack.webhook_url",
  retentionRawDays: "retention.raw_days",
  retentionRollupDays: "retention.rollup_days",
} as const;

/** Raw rows are kept this long unless an admin changes it. */
export const DEFAULT_RAW_RETENTION_DAYS = 14;
/** Daily rollups are kept this long — cheap, so the default is generous. */
export const DEFAULT_ROLLUP_RETENTION_DAYS = 730;

/** Keys whose values are encrypted and never returned to the browser. */
const SECRET_KEYS = new Set<string>([
  SETTING_KEYS.smtpPass,
  SETTING_KEYS.slackWebhookUrl,
]);

const ALL_KEYS = Object.values(SETTING_KEYS);

/** Where a resolved value came from, for showing in the UI. */
export type SettingSource = "database" | "environment" | "unset";

export interface MailSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string;
}

export interface SlackSettings {
  webhookUrl: string;
}

/** Reads every stored setting, decrypting secrets. Missing keys are omitted. */
async function readStored(): Promise<Map<string, string>> {
  await ensureSchema();
  const rows = await getDb()
    .select()
    .from(settings)
    .where(inArray(settings.key, ALL_KEYS));

  const out = new Map<string, string>();
  for (const row of rows) {
    if (row.value === null || row.value === "") continue;
    if (row.isSecret) {
      const plain = decryptSecret(row.value);
      if (plain === null) {
        console.warn(
          `[settings] could not decrypt "${row.key}" — it was probably saved ` +
            "under a different FLEETWATCH_SESSION_SECRET. Re-enter it.",
        );
        continue;
      }
      out.set(row.key, plain);
    } else {
      out.set(row.key, row.value);
    }
  }
  return out;
}

/** Database value if present, otherwise the environment, otherwise "". */
function pick(
  stored: Map<string, string>,
  key: string,
  envValue: string | undefined,
): { value: string; source: SettingSource } {
  const dbValue = stored.get(key);
  if (dbValue !== undefined && dbValue !== "") {
    return { value: dbValue, source: "database" };
  }
  if (envValue !== undefined && envValue !== "") {
    return { value: envValue, source: "environment" };
  }
  return { value: "", source: "unset" };
}

/** Effective mail configuration. */
export async function getMailSettings(): Promise<MailSettings> {
  let stored = new Map<string, string>();
  try {
    stored = await readStored();
  } catch (err) {
    // Alerting must not take the app down when the database is unhappy.
    console.warn("[settings] falling back to environment", (err as Error).message);
  }

  const K = SETTING_KEYS;
  return {
    host: pick(stored, K.smtpHost, process.env.SMTP_HOST).value,
    port: Number(pick(stored, K.smtpPort, process.env.SMTP_PORT).value || 587),
    secure: pick(stored, K.smtpSecure, process.env.SMTP_SECURE).value === "true",
    user: pick(stored, K.smtpUser, process.env.SMTP_USER).value,
    pass: pick(stored, K.smtpPass, process.env.SMTP_PASS).value,
    from: pick(stored, K.mailFrom, process.env.MAIL_FROM).value,
    to: pick(stored, K.alertEmailTo, process.env.ALERT_EMAIL_TO).value,
  };
}

export interface RetentionSettings {
  rawDays: number;
  rollupDays: number;
}

/**
 * How long raw rows and rollups are kept. Clamped so a typo cannot delete
 * everything (or disable pruning entirely and refill the disk).
 */
export async function getRetentionSettings(): Promise<RetentionSettings> {
  let stored = new Map<string, string>();
  try {
    stored = await readStored();
  } catch {
    // Fall through to defaults; retention must not break on a settings read.
  }

  const clamp = (value: string | undefined, fallback: number, min: number, max: number) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  return {
    rawDays: clamp(
      stored.get(SETTING_KEYS.retentionRawDays),
      DEFAULT_RAW_RETENTION_DAYS,
      1,
      365,
    ),
    rollupDays: clamp(
      stored.get(SETTING_KEYS.retentionRollupDays),
      DEFAULT_ROLLUP_RETENTION_DAYS,
      7,
      3650,
    ),
  };
}

/** Effective Slack configuration. */
export async function getSlackSettings(): Promise<SlackSettings> {
  let stored = new Map<string, string>();
  try {
    stored = await readStored();
  } catch (err) {
    console.warn("[settings] falling back to environment", (err as Error).message);
  }
  return {
    webhookUrl: pick(
      stored,
      SETTING_KEYS.slackWebhookUrl,
      process.env.SLACK_WEBHOOK_URL,
    ).value,
  };
}

/** What the settings form renders. Secrets are reported as set/unset only. */
export interface SettingsView {
  smtpHost: { value: string; source: SettingSource };
  smtpPort: { value: string; source: SettingSource };
  smtpSecure: { value: boolean; source: SettingSource };
  smtpUser: { value: string; source: SettingSource };
  smtpPassSet: { isSet: boolean; source: SettingSource };
  mailFrom: { value: string; source: SettingSource };
  alertEmailTo: { value: string; source: SettingSource };
  slackWebhookSet: { isSet: boolean; source: SettingSource };
  retentionRawDays: number;
  retentionRollupDays: number;
  /** False when no server secret is configured, so secrets cannot be saved. */
  canStoreSecrets: boolean;
}

export async function getSettingsView(): Promise<SettingsView> {
  const stored = await readStored();
  const K = SETTING_KEYS;

  const pass = pick(stored, K.smtpPass, process.env.SMTP_PASS);
  const slack = pick(stored, K.slackWebhookUrl, process.env.SLACK_WEBHOOK_URL);

  return {
    smtpHost: pick(stored, K.smtpHost, process.env.SMTP_HOST),
    smtpPort: pick(stored, K.smtpPort, process.env.SMTP_PORT),
    smtpSecure: {
      value: pick(stored, K.smtpSecure, process.env.SMTP_SECURE).value === "true",
      source: pick(stored, K.smtpSecure, process.env.SMTP_SECURE).source,
    },
    smtpUser: pick(stored, K.smtpUser, process.env.SMTP_USER),
    // Never the value itself.
    smtpPassSet: { isSet: pass.value !== "", source: pass.source },
    mailFrom: pick(stored, K.mailFrom, process.env.MAIL_FROM),
    alertEmailTo: pick(stored, K.alertEmailTo, process.env.ALERT_EMAIL_TO),
    slackWebhookSet: { isSet: slack.value !== "", source: slack.source },
    retentionRawDays: Number(
      stored.get(K.retentionRawDays) ?? DEFAULT_RAW_RETENTION_DAYS,
    ),
    retentionRollupDays: Number(
      stored.get(K.retentionRollupDays) ?? DEFAULT_ROLLUP_RETENTION_DAYS,
    ),
    canStoreSecrets: encryptionAvailable(),
  };
}

/**
 * Writes settings. A value of `undefined` leaves the key untouched (used so a
 * blank secret field means "keep the current one"); `""` clears it, falling
 * back to the environment.
 */
export async function saveSettings(
  values: Partial<Record<keyof typeof SETTING_KEYS, string>>,
  updatedBy: string,
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = new Date();

  for (const [name, raw] of Object.entries(values)) {
    if (raw === undefined) continue;
    const key = SETTING_KEYS[name as keyof typeof SETTING_KEYS];
    if (!key) continue;

    const isSecret = SECRET_KEYS.has(key);
    const value =
      raw === "" ? null : isSecret ? encryptSecret(raw) : raw;

    await db
      .insert(settings)
      .values({ key, value, isSecret, updatedAt: now, updatedBy })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, isSecret, updatedAt: now, updatedBy },
      });
  }
}
