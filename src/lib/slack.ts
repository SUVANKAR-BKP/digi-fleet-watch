import { getSlackSettings } from "./settings";

/**
 * Posts to a Slack incoming webhook.
 *
 * The URL comes from the database first (editable at /settings) and
 * SLACK_WEBHOOK_URL second. No-ops and logs when neither is set.
 */
export async function postSlackMessage(text: string): Promise<void> {
  const { webhookUrl } = await getSlackSettings();
  if (!webhookUrl) {
    console.warn(`[slack] no webhook configured, skipping: ${text}`);
    return;
  }
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(
        `[slack] webhook returned ${res.status}: ${await res.text().catch(() => "")}`,
      );
    }
  } catch (err) {
    console.error("[slack] failed to post webhook", err);
  }
}

/**
 * Posts a test message and reports the outcome instead of swallowing it, so a
 * bad webhook is visible while the admin is still on the settings page.
 */
export async function sendTestSlack(
  triggeredBy: string,
): Promise<{ ok: boolean; error?: string }> {
  const { webhookUrl } = await getSlackSettings();
  if (!webhookUrl) return { ok: false, error: "No Slack webhook is configured." };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text:
          ":white_check_mark: *Digi Fleet Watch* — test message " +
          `(sent by ${triggeredBy}). Downtime alerts will arrive in this channel.`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Slack returned ${res.status}${body ? `: ${body}` : ""}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
