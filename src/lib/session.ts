import { isUserRole, type UserRole } from "./rbac";

/**
 * Stateless signed session cookie.
 *
 * The cookie carries the user id, username and role so middleware can make
 * authorisation decisions without a database round-trip — middleware runs on
 * the edge runtime, which cannot reach Postgres at all. Everything is signed
 * with HMAC-SHA256 via Web Crypto (available in both the edge and node
 * runtimes; node:crypto is not).
 *
 * Because the role is baked into the cookie, a role change or deactivation
 * only takes full effect on the next sign-in or within SESSION_TTL. Actions
 * that matter re-check the live user record server-side — see requireUser().
 */

export const SESSION_COOKIE = "fw_session";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SessionPayload {
  /** User id. */
  uid: number;
  /** Username, for display in the header. */
  un: string;
  /** Role at sign-in time. */
  role: UserRole;
  /** Expiry, epoch ms. */
  exp: number;
}

/**
 * Key used to sign sessions. FLEETWATCH_SESSION_SECRET is preferred; falling
 * back to AGENT_API_TOKEN keeps existing deployments working, at the cost of
 * signing everyone out when that token is rotated.
 */
function signingKey(): string | null {
  const explicit = process.env.FLEETWATCH_SESSION_SECRET;
  if (explicit && explicit.length > 0) return explicit;
  const fallback = process.env.AGENT_API_TOKEN;
  if (fallback && fallback.length > 0) return fallback;
  return null;
}

/** True when sessions can be signed at all. */
export function sessionSecretConfigured(): boolean {
  return signingKey() !== null;
}

const enc = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmac(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return toBase64Url(new Uint8Array(sig));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Builds a signed `<payload>.<signature>` cookie value. */
export async function createSession(user: {
  id: number;
  username: string;
  role: UserRole;
}): Promise<{ value: string; maxAge: number }> {
  const key = signingKey();
  if (!key) {
    throw new Error(
      "Cannot sign a session: set FLEETWATCH_SESSION_SECRET (or AGENT_API_TOKEN).",
    );
  }

  const payload: SessionPayload = {
    uid: user.id,
    un: user.username,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const body = toBase64Url(enc.encode(JSON.stringify(payload)));
  const sig = await hmac(key, body);
  return { value: `${body}.${sig}`, maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

/** Verifies and decodes a session cookie. Returns null when invalid/expired. */
export async function readSession(
  value: string | undefined,
): Promise<SessionPayload | null> {
  if (!value) return null;
  const key = signingKey();
  if (!key) return null;

  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);

  if (!constantTimeEqual(sig, await hmac(key, body))) return null;

  const raw = fromBase64Url(body);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (
      typeof p.uid !== "number" ||
      typeof p.un !== "string" ||
      typeof p.exp !== "number" ||
      !isUserRole(p.role)
    ) {
      return null;
    }
    if (p.exp < Date.now()) return null;
    return { uid: p.uid, un: p.un, role: p.role, exp: p.exp };
  } catch {
    return null;
  }
}
