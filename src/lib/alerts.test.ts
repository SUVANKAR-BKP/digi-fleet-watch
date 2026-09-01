import { describe, expect, it } from "vitest";
import {
  CHANNEL_TYPES,
  buildChannelPayload,
  renderAlertText,
  type Alert,
} from "./alert-channels";

const ALERT: Alert = {
  severity: "critical",
  title: "HOST DOWN: web-01",
  body: "No heartbeat since 2026-08-18T14:02:16Z.",
  hostId: 1,
  hostname: "web-01",
  url: "http://fleet.example.com/hosts/1",
};

describe("renderAlertText", () => {
  it("includes the host and dashboard link", () => {
    const text = renderAlertText(ALERT);
    expect(text).toContain("No heartbeat since");
    expect(text).toContain("Host: web-01");
    expect(text).toContain("http://fleet.example.com/hosts/1");
  });

  it("omits optional lines when absent", () => {
    const text = renderAlertText({
      severity: "info",
      title: "t",
      body: "just the body",
    });
    expect(text).toBe("just the body");
  });
});

describe("buildChannelPayload", () => {
  it("produces valid JSON for every JSON-based channel", () => {
    for (const type of CHANNEL_TYPES) {
      const { body, contentType } = buildChannelPayload(type, ALERT);
      if (contentType === "application/json") {
        expect(() => JSON.parse(body)).not.toThrow();
      } else {
        expect(body.length).toBeGreaterThan(0);
      }
    }
  });

  it("uses Slack's text field", () => {
    const { body } = buildChannelPayload("slack", ALERT);
    const parsed = JSON.parse(body);
    expect(parsed.text).toContain("HOST DOWN: web-01");
  });

  it("uses Discord's content field and respects its length cap", () => {
    // Discord rejects payloads over 2000 characters outright, so a long
    // package-update body must be truncated rather than silently dropped.
    const long: Alert = { ...ALERT, body: "x".repeat(5000) };
    const { body } = buildChannelPayload("discord", long);
    const parsed = JSON.parse(body);
    expect(typeof parsed.content).toBe("string");
    expect(parsed.content.length).toBeLessThanOrEqual(1900);
  });

  it("emits the MessageCard schema Teams connectors require", () => {
    const { body } = buildChannelPayload("teams", ALERT);
    const parsed = JSON.parse(body);
    expect(parsed["@type"]).toBe("MessageCard");
    expect(parsed["@context"]).toContain("schema.org");
    expect(parsed.summary).toBe(ALERT.title);
  });

  it("colours the Teams card by severity", () => {
    const critical = JSON.parse(buildChannelPayload("teams", ALERT).body);
    const info = JSON.parse(
      buildChannelPayload("teams", { ...ALERT, severity: "info" }).body,
    );
    expect(critical.themeColor).not.toBe(info.themeColor);
  });

  it("sends ntfy as plain text, not JSON", () => {
    const { body, contentType } = buildChannelPayload("ntfy", ALERT);
    expect(contentType).toBe("text/plain");
    expect(body).toContain("HOST DOWN: web-01");
  });

  it("gives generic webhooks a stable machine-readable shape", () => {
    // Consumers parse this, so the field names are part of the contract.
    const { body } = buildChannelPayload("webhook", ALERT);
    const parsed = JSON.parse(body);
    expect(parsed).toMatchObject({
      severity: "critical",
      title: "HOST DOWN: web-01",
      hostname: "web-01",
      url: "http://fleet.example.com/hosts/1",
    });
    expect(typeof parsed.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(parsed.timestamp))).toBe(false);
  });

  it("nulls optional webhook fields rather than omitting them", () => {
    const { body } = buildChannelPayload("webhook", {
      severity: "info",
      title: "t",
      body: "b",
    });
    const parsed = JSON.parse(body);
    expect(parsed.hostname).toBeNull();
    expect(parsed.url).toBeNull();
  });

  it("does not leak raw newlines into Teams markdown", () => {
    // Teams collapses single newlines; doubling them keeps line breaks.
    const { body } = buildChannelPayload("teams", ALERT);
    const parsed = JSON.parse(body);
    expect(parsed.text).toContain("\n\n");
  });
});
