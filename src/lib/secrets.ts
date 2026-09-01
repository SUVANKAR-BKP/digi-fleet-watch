import crypto from "node:crypto";

/**
 * Encryption for secret settings stored in the database (SMTP password, Slack
 * webhook URL).
 *
 * These have to be reversible — unlike user passwords, the app must present
 * the original value to an SMTP server. Storing them in plaintext would mean a
 * database dump or a stray `pg_dump` in a backup hands over the mail account
 * and the webhook. AES-256-GCM with a key derived from the server secret keeps
 * them useless without the app's environment.
 *
 * Node-only: never import this from middleware.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12; // GCM standard
// No dot in the marker: the encoded form is dot-separated, so "enc.v1" would
// split into two fields and every decrypt would fail the length check.
const PREFIX = "encv1";

/** Fixed salt: the input is already a high-entropy server secret. */
const KEY_SALT = "digi-fleet-watch/settings-encryption/v1";

function serverSecret(): string | null {
  const explicit = process.env.FLEETWATCH_SESSION_SECRET;
  if (explicit && explicit.length > 0) return explicit;
  const fallback = process.env.AGENT_API_TOKEN;
  if (fallback && fallback.length > 0) return fallback;
  return null;
}

/** True when secret settings can be stored at all. */
export function encryptionAvailable(): boolean {
  return serverSecret() !== null;
}

let cachedKey: { from: string; key: Buffer } | null = null;

function deriveKey(): Buffer {
  const secret = serverSecret();
  if (!secret) {
    throw new Error(
      "Cannot store secret settings: set FLEETWATCH_SESSION_SECRET (or AGENT_API_TOKEN).",
    );
  }
  // scryptSync is ~100ms; cache it rather than paying that per read.
  if (cachedKey && cachedKey.from === secret) return cachedKey.key;
  const key = crypto.scryptSync(secret, KEY_SALT, 32);
  cachedKey = { from: secret, key };
  return key;
}

/** Encrypts a value to `encv1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Decrypts a stored value. Returns null when the value is malformed or was
 * encrypted under a different server secret — rotating the secret must degrade
 * to "alerting unconfigured", not crash every page that reads settings.
 */
export function decryptSecret(stored: string): string | null {
  if (!stored.startsWith(`${PREFIX}.`)) return null;

  const parts = stored.split(".");
  if (parts.length !== 4) return null;
  const [, ivB64, tagB64, dataB64] = parts;

  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      deriveKey(),
      Buffer.from(ivB64, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key or tampered ciphertext — GCM authentication failed.
    return null;
  }
}
