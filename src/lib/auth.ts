import crypto from "crypto";

/**
 * Which configured secret an incoming bearer token matched.
 * `previous` means the caller is still using the pre-rotation token.
 */
export type AgentTokenMatch = "current" | "previous" | null;

/** Constant-time string comparison. Length is compared first (and leaks). */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Matches a bearer token against AGENT_API_TOKEN and, if set, the grace-period
 * secret AGENT_API_TOKEN_PREVIOUS.
 *
 * Rotating a single shared secret otherwise means every enrolled agent starts
 * failing with 401 the moment the server restarts, and stays broken until each
 * host is re-enrolled by hand. Honouring the previous token for a window makes
 * rotation a safe, ordered operation: rotate, re-enrol hosts one at a time
 * while both secrets work, then drop the old one.
 *
 * Never falls back to plain string equality.
 */
export function matchAgentToken(token: string | null): AgentTokenMatch {
  if (!token) return null;

  const current = process.env.AGENT_API_TOKEN;
  if (current && constantTimeEquals(token, current)) return "current";

  const previous = process.env.AGENT_API_TOKEN_PREVIOUS;
  if (previous && constantTimeEquals(token, previous)) return "previous";

  return null;
}

/** True when the token matches either the current or the previous secret. */
export function isValidAgentToken(token: string | null): boolean {
  return matchAgentToken(token) !== null;
}

/** True while a previous token is still being honoured. */
export function rotationInProgress(): boolean {
  return Boolean(process.env.AGENT_API_TOKEN_PREVIOUS);
}

/** Extracts the bearer token from an Authorization header value. */
export function bearerFromHeader(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
