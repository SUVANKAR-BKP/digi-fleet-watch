/**
 * Optional shared-password gate for the dashboard.
 *
 * Digi Fleet Watch ships the agent enrolment token to the browser so the
 * "Add Host" dialog can render a copy-paste command. With no authentication
 * that makes the token readable by anyone who can reach the instance — which
 * for a box published on a public IP means the whole internet.
 *
 * Set FLEETWATCH_DASHBOARD_PASSWORD to require a login for the dashboard, the
 * read APIs and the token. Leaving it unset preserves the previous open
 * behaviour (so an existing deployment keeps working), but `authConfigured()`
 * is surfaced in the UI so the risk is visible rather than silent.
 *
 * Agent-facing routes are never gated by this — they authenticate with
 * AGENT_API_TOKEN instead.
 */

const COOKIE_NAME = "fw_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const SESSION_COOKIE = COOKIE_NAME;

/** The configured dashboard password, or null when the gate is disabled. */
export function dashboardPassword(): string | null {
  const pw = process.env.FLEETWATCH_DASHBOARD_PASSWORD;
  return pw && pw.length > 0 ? pw : null;
}

/** True when a dashboard password is configured. */
export function authConfigured(): boolean {
  return dashboardPassword() !== null;
}

function b64url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Web Crypto rather than node:crypto — this module is imported from
 * middleware, which runs on the edge runtime where node:crypto is unavailable.
 */
async function hmac(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message)));
}

/** Builds a signed `<expiry>.<signature>` session value. */
export async function createSession(): Promise<{ value: string; maxAge: number }> {
  const password = dashboardPassword();
  if (!password) throw new Error("dashboard password is not configured");
  const expiry = String(Date.now() + SESSION_TTL_MS);
  const sig = await hmac(password, expiry);
  return { value: `${expiry}.${sig}`, maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

/** Length-safe comparison so signature checking does not leak byte positions. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verifies a session cookie. Always true when the gate is disabled. */
export async function verifySession(value: string | undefined): Promise<boolean> {
  const password = dashboardPassword();
  if (!password) return true;
  if (!value) return false;

  const dot = value.lastIndexOf(".");
  if (dot <= 0) return false;
  const expiry = value.slice(0, dot);
  const sig = value.slice(dot + 1);

  const expiryMs = Number(expiry);
  if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) return false;

  return constantTimeEqual(sig, await hmac(password, expiry));
}

/** Checks a submitted password against the configured one. */
export function passwordMatches(submitted: string): boolean {
  const password = dashboardPassword();
  if (!password) return false;
  return constantTimeEqual(submitted, password);
}
