/**
 * Posts a message to the Slack incoming webhook configured via
 * SLACK_WEBHOOK_URL. No-ops and logs when the webhook is not configured.
 */
export async function postSlackMessage(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.warn(`[slack] SLACK_WEBHOOK_URL not configured, skipping: ${text}`);
    return;
  }
  try {
    const res = await fetch(url, {
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