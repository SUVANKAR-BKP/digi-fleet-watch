import crypto from "crypto";

/**
 * Constant-time comparison of the incoming bearer token against
 * AGENT_API_TOKEN. Never falls back to plain string equality.
 */
export function isValidAgentToken(token: string | null): boolean {
  const expected = process.env.AGENT_API_TOKEN;
  if (!expected || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Extracts the bearer token from an Authorization header value. */
export function bearerFromHeader(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}