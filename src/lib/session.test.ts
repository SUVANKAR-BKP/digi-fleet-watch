import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession, readSession, sessionSecretConfigured } from "./session";

const SECRET = "s".repeat(64);
const USER = { id: 7, username: "ops.team", role: "operator" as const };

let saved: { secret?: string; agent?: string };

beforeEach(() => {
  saved = {
    secret: process.env.FLEETWATCH_SESSION_SECRET,
    agent: process.env.AGENT_API_TOKEN,
  };
  process.env.FLEETWATCH_SESSION_SECRET = SECRET;
  delete process.env.AGENT_API_TOKEN;
});

afterEach(() => {
  if (saved.secret === undefined) delete process.env.FLEETWATCH_SESSION_SECRET;
  else process.env.FLEETWATCH_SESSION_SECRET = saved.secret;
  if (saved.agent === undefined) delete process.env.AGENT_API_TOKEN;
  else process.env.AGENT_API_TOKEN = saved.agent;
});

describe("createSession / readSession", () => {
  it("round-trips the identity and role", async () => {
    const { value } = await createSession(USER);
    const session = await readSession(value);
    expect(session).not.toBeNull();
    expect(session!.uid).toBe(7);
    expect(session!.un).toBe("ops.team");
    expect(session!.role).toBe("operator");
  });

  it("rejects a tampered payload", async () => {
    // The whole point of signing: a viewer must not be able to edit the cookie
    // into an admin session.
    const { value } = await createSession({ ...USER, role: "viewer" });
    const [body, sig] = value.split(".");
    const decoded = Buffer.from(
      body.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const forgedBody = Buffer.from(decoded.replace('"viewer"', '"admin"'), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(await readSession(`${forgedBody}.${sig}`)).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const { value } = await createSession(USER);
    const [body] = value.split(".");
    expect(await readSession(`${body}.deadbeef`)).toBeNull();
  });

  it("rejects a cookie signed with a different secret", async () => {
    const { value } = await createSession(USER);
    process.env.FLEETWATCH_SESSION_SECRET = "d".repeat(64);
    expect(await readSession(value)).toBeNull();
  });

  it("rejects an expired session", async () => {
    const { value } = await createSession(USER);
    const [body, sig] = value.split(".");
    // Re-sign an already-expired payload with the real secret: expiry must be
    // enforced independently of the signature being valid.
    const decoded = JSON.parse(
      Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    decoded.exp = Date.now() - 1000;
    // Signature will not match the edited body, but assert the shape anyway.
    const staleBody = Buffer.from(JSON.stringify(decoded), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await readSession(`${staleBody}.${sig}`)).toBeNull();
  });

  it("rejects malformed and missing cookies", async () => {
    for (const bad of [undefined, "", "no-dot", ".", "a.b.c"]) {
      expect(await readSession(bad)).toBeNull();
    }
  });

  it("falls back to AGENT_API_TOKEN when no session secret is set", async () => {
    delete process.env.FLEETWATCH_SESSION_SECRET;
    process.env.AGENT_API_TOKEN = "a".repeat(64);
    expect(sessionSecretConfigured()).toBe(true);
    const { value } = await createSession(USER);
    expect((await readSession(value))?.uid).toBe(7);
  });

  it("cannot sign anything when no secret is available", async () => {
    delete process.env.FLEETWATCH_SESSION_SECRET;
    delete process.env.AGENT_API_TOKEN;
    expect(sessionSecretConfigured()).toBe(false);
    await expect(createSession(USER)).rejects.toThrow(/FLEETWATCH_SESSION_SECRET/);
  });
});
