import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bearerFromHeader,
  isValidAgentToken,
  matchAgentToken,
  rotationInProgress,
} from "./auth";

const CURRENT = "a".repeat(64);
const PREVIOUS = "b".repeat(64);

let saved: { current?: string; previous?: string };

beforeEach(() => {
  saved = {
    current: process.env.AGENT_API_TOKEN,
    previous: process.env.AGENT_API_TOKEN_PREVIOUS,
  };
  delete process.env.AGENT_API_TOKEN;
  delete process.env.AGENT_API_TOKEN_PREVIOUS;
});

afterEach(() => {
  if (saved.current === undefined) delete process.env.AGENT_API_TOKEN;
  else process.env.AGENT_API_TOKEN = saved.current;
  if (saved.previous === undefined) delete process.env.AGENT_API_TOKEN_PREVIOUS;
  else process.env.AGENT_API_TOKEN_PREVIOUS = saved.previous;
});

describe("matchAgentToken", () => {
  it("accepts the current token", () => {
    process.env.AGENT_API_TOKEN = CURRENT;
    expect(matchAgentToken(CURRENT)).toBe("current");
  });

  it("rejects everything when no token is configured", () => {
    // An unset AGENT_API_TOKEN must never mean "allow all".
    expect(matchAgentToken(CURRENT)).toBeNull();
    expect(matchAgentToken("")).toBeNull();
    expect(matchAgentToken(null)).toBeNull();
  });

  it("rejects an empty configured token", () => {
    process.env.AGENT_API_TOKEN = "";
    expect(matchAgentToken("")).toBeNull();
  });

  it("rejects a wrong token of the same length", () => {
    process.env.AGENT_API_TOKEN = CURRENT;
    expect(matchAgentToken("c".repeat(64))).toBeNull();
  });

  it("rejects a prefix of the real token", () => {
    process.env.AGENT_API_TOKEN = CURRENT;
    expect(matchAgentToken(CURRENT.slice(0, 32))).toBeNull();
  });

  describe("during a rotation", () => {
    beforeEach(() => {
      process.env.AGENT_API_TOKEN = CURRENT;
      process.env.AGENT_API_TOKEN_PREVIOUS = PREVIOUS;
    });

    it("still accepts the previous token, flagged as such", () => {
      // This is the whole point: agents keep working until re-enrolled.
      expect(matchAgentToken(PREVIOUS)).toBe("previous");
    });

    it("prefers the current token", () => {
      expect(matchAgentToken(CURRENT)).toBe("current");
    });

    it("still rejects an unrelated token", () => {
      expect(matchAgentToken("d".repeat(64))).toBeNull();
    });

    it("reports that a rotation is in progress", () => {
      expect(rotationInProgress()).toBe(true);
    });
  });

  it("rejects the previous token once the rotation is finished", () => {
    process.env.AGENT_API_TOKEN = CURRENT;
    expect(matchAgentToken(PREVIOUS)).toBeNull();
    expect(rotationInProgress()).toBe(false);
  });
});

describe("isValidAgentToken", () => {
  it("is true for both current and previous during a rotation", () => {
    process.env.AGENT_API_TOKEN = CURRENT;
    process.env.AGENT_API_TOKEN_PREVIOUS = PREVIOUS;
    expect(isValidAgentToken(CURRENT)).toBe(true);
    expect(isValidAgentToken(PREVIOUS)).toBe(true);
    expect(isValidAgentToken("nope")).toBe(false);
  });
});

describe("bearerFromHeader", () => {
  it("extracts the token", () => {
    expect(bearerFromHeader(`Bearer ${CURRENT}`)).toBe(CURRENT);
  });

  it("is case-insensitive on the scheme and tolerates padding", () => {
    expect(bearerFromHeader(`  bEaReR   ${CURRENT}`)).toBe(CURRENT);
  });

  it("returns null for a missing or non-bearer header", () => {
    expect(bearerFromHeader(null)).toBeNull();
    expect(bearerFromHeader("Basic abc123")).toBeNull();
    expect(bearerFromHeader("Bearer")).toBeNull();
  });
});
