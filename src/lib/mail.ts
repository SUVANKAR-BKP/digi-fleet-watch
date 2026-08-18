import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

let transporter: Transporter | null = null;

/** True when SMTP + a recipient are configured. */
export function emailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.ALERT_EMAIL_TO);
}

function getTransporter(): Transporter | null {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return transporter;
}

/**
 * Sends an alert email. No-ops (with a log line) when SMTP or a recipient
 * is not configured, so the rest of the app is unaffected.
 */
export async function sendAlertEmail(opts: {
  subject: string;
  text: string;
}): Promise<void> {
  const to = process.env.ALERT_EMAIL_TO;
  const t = getTransporter();
  if (!to || !t) {
    console.warn(`[mail] SMTP not configured — skipping "${opts.subject}"`);
    return;
  }

  const from =
    process.env.MAIL_FROM ||
    `"Digi Fleet Watch" <alerts@${process.env.SMTP_HOST ?? "localhost"}>`;

  try {
    await t.sendMail({
      from,
      to,
      subject: `[Digi Fleet Watch] ${opts.subject}`,
      text: opts.text,
    });
    console.log(`[mail] sent "${opts.subject}" to ${to}`);
  } catch (err) {
    console.error("[mail] failed to send alert email", err);
  }
}