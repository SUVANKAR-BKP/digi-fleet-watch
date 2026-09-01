import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, encryptionAvailable } from "./secrets";

const SECRET = "s".repeat(64);
const WEBHOOK = "https://hooks.slack.com/services/T000/B000/abcdef123456";

let saved: { session?: string; agent?: string };

beforeEach(() => {
  saved = {
    session: process.env.FLEETWATCH_SESSION_SECRET,
    agent: process.env.AGENT_API_TOKEN,
  };
  process.env.FLEETWATCH_SESSION_SECRET = SECRET;
  delete process.env.AGENT_API_TOKEN;
});

afterEach(() => {
  if (saved.session === undefined) delete process.env.FLEETWATCH_SESSION_SECRET;
  else process.env.FLEETWATCH_SESSION_SECRET = saved.session;
  if (saved.agent === undefined) delete process.env.AGENT_API_TOKEN;
  else process.env.AGENT_API_TOKEN = saved.agent;
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a value", () => {
    expect(decryptSecret(encryptSecret(WEBHOOK))).toBe(WEBHOOK);
  });

  it("does not leak the plaintext into the stored form", () => {
    const stored = encryptSecret(WEBHOOK);
    expect(stored).not.toContain("hooks.slack.com");
    expect(stored).not.toContain("abcdef123456");
    expect(stored.startsWith("encv1.")).toBe(true);
  });

  it("uses a fresh IV, so the same input encrypts differently each time", () => {
    expect(encryptSecret(WEBHOOK)).not.toBe(encryptSecret(WEBHOOK));
  });

  it("returns null when the ciphertext was tampered with", () => {
    // GCM authenticates: flipping a character must fail, not silently decrypt
    // to garbage that then gets used as an SMTP password.
    const stored = encryptSecret("hunter2hunter2");
    const parts = stored.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
    expect(decryptSecret(parts.join("."))).toBeNull();
  });

  it("returns null when the server secret changed", () => {
    // Rotating FLEETWATCH_SESSION_SECRET must degrade to "unconfigured"
    // rather than throwing on every page that reads settings.
    const stored = encryptSecret(WEBHOOK);
    process.env.FLEETWATCH_SESSION_SECRET = "d".repeat(64);
    expect(decryptSecret(stored)).toBeNull();
  });

  it("returns null for malformed input", () => {
    for (const bad of ["", "plaintext", "encv1.only.three", "encv2.a.b.c"]) {
      expect(decryptSecret(bad)).toBeNull();
    }
  });

  it("handles unicode and long values", () => {
    const value = "pässwörd–with–dashes " + "x".repeat(500);
    expect(decryptSecret(encryptSecret(value))).toBe(value);
  });

  it("falls back to AGENT_API_TOKEN as the key source", () => {
    delete process.env.FLEETWATCH_SESSION_SECRET;
    process.env.AGENT_API_TOKEN = "a".repeat(64);
    expect(encryptionAvailable()).toBe(true);
    expect(decryptSecret(encryptSecret("value123"))).toBe("value123");
  });

  it("cannot encrypt when no server secret is configured", () => {
    delete process.env.FLEETWATCH_SESSION_SECRET;
    delete process.env.AGENT_API_TOKEN;
    expect(encryptionAvailable()).toBe(false);
    expect(() => encryptSecret("value")).toThrow(/FLEETWATCH_SESSION_SECRET/);
  });
});
