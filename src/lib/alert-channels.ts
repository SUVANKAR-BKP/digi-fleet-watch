/**
 * Channel types, payload formatting and shared alert shapes.
 *
 * Deliberately free of server-only imports. `alerts.ts` reaches for nodemailer
 * and the database; the settings UI is a client component that needs the
 * labels, types and severity list, and importing those from `alerts.ts` pulled
 * nodemailer into the browser bundle and failed the build with
 * "Can't resolve 'net'". Anything both sides need lives here.
 */

export type AlertSeverity = "info" | "warning" | "critical";

export type ChannelType = "email" | "slack" | "discord" | "teams" | "ntfy" | "webhook";

export const CHANNEL_TYPES: readonly ChannelType[] = [
  "email",
  "slack",
  "discord",
  "teams",
  "ntfy",
  "webhook",
];

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  email: "Email",
  slack: "Slack",
  discord: "Discord",
  teams: "Microsoft Teams",
  ntfy: "ntfy",
  webhook: "Generic webhook",
};

/** What each channel type expects in `target`. */
export const CHANNEL_TARGET_HINTS: Record<ChannelType, string> = {
  email: "ops@example.com",
  slack: "https://hooks.slack.com/services/…",
  discord: "https://discord.com/api/webhooks/…",
  teams: "https://outlook.office.com/webhook/…",
  ntfy: "https://ntfy.sh/your-topic",
  webhook: "https://example.com/hooks/fleet",
};

export const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  info: ":information_source:",
  warning: ":warning:",
  critical: ":rotating_light:",
};

export interface Alert {
  severity: AlertSeverity;
  /** Short subject line. */
  title: string;
  /** Plain-text body. */
  body: string;
  /** When set, the alert is suppressed by a silence covering this host. */
  hostId?: number;
  hostname?: string;
  /** Deep link back into the dashboard. */
  url?: string;
  /**
   * Route to exactly one channel instead of every eligible one.
   *
   * Set by checks that name a channel, so a noisy staging probe can report to
   * a staging room without the on-call channel hearing about it.
   */
  channelId?: number;
}

export interface SafeChannel {
  id: number;
  name: string;
  type: ChannelType;
  /** Never the decrypted value — a webhook URL is a credential. */
  targetPreview: string;
  minSeverity: AlertSeverity;
  enabled: boolean;
  lastError: string | null;
  lastSentAt: string | null;
}

export interface SilenceRow {
  id: number;
  hostId: number | null;
  hostname: string | null;
  reason: string | null;
  startsAt: string;
  endsAt: string;
  createdBy: string | null;
  active: boolean;
}

export function isChannelType(value: string): value is ChannelType {
  return (CHANNEL_TYPES as readonly string[]).includes(value);
}

export function asSeverity(value: string): AlertSeverity {
  return value === "critical" || value === "warning" ? value : "info";
}

/**
 * Shows enough of a target to recognise it without revealing the secret part.
 * Emails keep their domain; webhook URLs keep only scheme and host.
 */
export function previewTarget(type: ChannelType, target: string): string {
  if (type === "email") return target;
  try {
    const url = new URL(target);
    return `${url.origin}/…`;
  } catch {
    return "…";
  }
}

/** Plain-text rendering shared by email and text-only sinks. */
export function renderAlertText(alert: Alert): string {
  const lines = [alert.body];
  if (alert.hostname) lines.push("", `Host: ${alert.hostname}`);
  if (alert.url) lines.push(`Dashboard: ${alert.url}`);
  return lines.join("\n");
}

/** Rejects targets that obviously do not match the chosen type. */
export function validateTarget(type: ChannelType, target: string): string | null {
  if (!target) return "A target is required.";

  if (type === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)
      ? null
      : "That does not look like an email address.";
  }

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return "That is not a valid URL.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "Webhook URLs must be http or https.";
  }

  const hostChecks: Partial<Record<ChannelType, [RegExp, string]>> = {
    slack: [/(^|\.)slack\.com$/, "a Slack webhook URL (hooks.slack.com)"],
    discord: [/(^|\.)discord(app)?\.com$/, "a Discord webhook URL"],
  };
  const check = hostChecks[type];
  if (check && !check[0].test(url.hostname)) {
    return `That does not look like ${check[1]}.`;
  }
  return null;
}

/** Message body for one channel type. */
export function buildChannelPayload(
  type: ChannelType,
  alert: Alert,
): { body: string; contentType: string } {
  const text = `${alert.title}\n\n${renderAlertText(alert)}`;

  switch (type) {
    case "slack":
      return {
        body: JSON.stringify({
          text: `${SEVERITY_EMOJI[alert.severity]} *${alert.title}*\n${renderAlertText(alert)}`,
        }),
        contentType: "application/json",
      };

    case "discord":
      // Discord caps content at 2000 characters and rejects longer payloads.
      return {
        body: JSON.stringify({
          content: `**${alert.title}**\n${renderAlertText(alert)}`.slice(0, 1900),
        }),
        contentType: "application/json",
      };

    case "teams":
      // Teams still expects the legacy MessageCard schema on Office connectors,
      // and collapses single newlines — hence the doubling.
      return {
        body: JSON.stringify({
          "@type": "MessageCard",
          "@context": "https://schema.org/extensions",
          themeColor:
            alert.severity === "critical"
              ? "D93025"
              : alert.severity === "warning"
                ? "F9AB00"
                : "1A73E8",
          summary: alert.title,
          title: alert.title,
          text: renderAlertText(alert).replace(/\n/g, "\n\n"),
        }),
        contentType: "application/json",
      };

    case "ntfy":
      // ntfy takes the body as plain text, with metadata in headers.
      return { body: text, contentType: "text/plain" };

    case "webhook":
      return {
        body: JSON.stringify({
          severity: alert.severity,
          title: alert.title,
          body: alert.body,
          hostname: alert.hostname ?? null,
          url: alert.url ?? null,
          timestamp: new Date().toISOString(),
        }),
        contentType: "application/json",
      };

    case "email":
      return { body: text, contentType: "text/plain" };
  }
}
