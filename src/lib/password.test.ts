import { describe, expect, it } from "vitest";
import {
  hashPassword,
  validatePassword,
  validateUsername,
  verifyPassword,
} from "./password";

describe("hashPassword / verifyPassword", () => {
  it("round-trips a correct password", async () => {
    const digest = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", digest)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const digest = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("Correct horse battery staple", digest)).toBe(false);
    expect(await verifyPassword("", digest)).toBe(false);
  });

  it("never stores the password in the digest", async () => {
    const secret = "supersecretvalue123";
    const digest = await hashPassword(secret);
    expect(digest).not.toContain(secret);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("same password here");
    const b = await hashPassword("same password here");
    expect(a).not.toBe(b);
    // Both must still verify.
    expect(await verifyPassword("same password here", a)).toBe(true);
    expect(await verifyPassword("same password here", b)).toBe(true);
  });

  it("records its parameters so the cost can be raised later", async () => {
    const digest = await hashPassword("another password");
    const [scheme, N, r, p] = digest.split("$");
    expect(scheme).toBe("scrypt");
    expect(Number(N)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  it("returns false rather than throwing on a malformed digest", async () => {
    // A corrupted row must not be able to crash a login.
    for (const bad of [
      "",
      "not-a-digest",
      "scrypt$16384$8$1$onlyfourparts",
      "bcrypt$16384$8$1$aa$bb",
      "scrypt$x$y$z$aa$bb",
      "scrypt$16384$8$1$$",
    ]) {
      expect(await verifyPassword("whatever", bad)).toBe(false);
    }
  });

  it("normalises unicode so an equivalent password still verifies", async () => {
    // "é" composed vs decomposed — the same password to a human.
    const digest = await hashPassword("cafépasswordlong");
    expect(await verifyPassword("cafépasswordlong", digest)).toBe(true);
  });
});

describe("validatePassword", () => {
  it("requires at least 10 characters", () => {
    expect(validatePassword("short")).toMatch(/at least 10/);
    expect(validatePassword("a".repeat(10))).toBeNull();
  });

  it("rejects whitespace-only and over-long passwords", () => {
    expect(validatePassword(" ".repeat(12))).toMatch(/whitespace/);
    expect(validatePassword("a".repeat(201))).toMatch(/at most 200/);
  });
});

describe("validateUsername", () => {
  it("accepts ordinary usernames", () => {
    for (const ok of ["admin", "ops.team", "suvankar_b", "node-01"]) {
      expect(validateUsername(ok)).toBeNull();
    }
  });

  it("rejects lengths outside 3–32", () => {
    expect(validateUsername("ab")).toMatch(/at least 3/);
    expect(validateUsername("a".repeat(33))).toMatch(/at most 32/);
  });

  it("rejects characters that invite confusion or injection", () => {
    for (const bad of ["has space", "quote'name", "semi;colon", "sla/sh", "über"]) {
      expect(validateUsername(bad)).toMatch(/may only contain/);
    }
  });
});
