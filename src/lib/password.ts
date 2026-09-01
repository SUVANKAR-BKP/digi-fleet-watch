import crypto from "node:crypto";

/**
 * Password hashing with scrypt from node:crypto.
 *
 * scrypt is memory-hard (unlike a bare SHA) and needs no native dependency,
 * which keeps the Alpine Docker build free of bcrypt/argon2 toolchains.
 *
 * Node-only: this module must never be imported from middleware, which runs on
 * the edge runtime where node:crypto is unavailable.
 */

/** ~64 MB of memory per hash — deliberately slow to brute-force. */
const SCRYPT_N = 16_384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

/** scrypt's default maxmem is 32 MB, which N=16384,r=8 exceeds. */
const MAX_MEM = 128 * 1024 * 1024;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LEN,
      { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p, maxmem: MAX_MEM },
      (err, derived) => (err ? reject(err) : resolve(derived)),
    );
  });
}

/**
 * Hashes a password into a self-describing digest:
 *   scrypt$N$r$p$saltHex$hashHex
 * Storing the parameters means the cost can be raised later without
 * invalidating existing hashes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LEN);
  const derived = await scryptAsync(password, salt);
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_r,
    SCRYPT_p,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

/**
 * Verifies a password against a stored digest. Returns false rather than
 * throwing on a malformed digest, so a corrupted row cannot crash a login.
 */
export async function verifyPassword(
  password: string,
  digest: string,
): Promise<boolean> {
  const parts = digest.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await new Promise<Buffer | null>((resolve) => {
    crypto.scrypt(
      password.normalize("NFKC"),
      salt,
      expected.length,
      { N, r, p, maxmem: MAX_MEM },
      (err, out) => resolve(err ? null : out),
    );
  });
  if (!derived || derived.length !== expected.length) return false;

  return crypto.timingSafeEqual(derived, expected);
}

/**
 * Minimum viable password policy. Deliberately length-first rather than a
 * character-class checklist, which pushes people toward "P@ssw0rd!".
 */
export function validatePassword(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (password.length > 200) return "Password must be at most 200 characters.";
  if (password.trim().length === 0) return "Password cannot be only whitespace.";
  return null;
}

/** Usernames are the login identifier, so keep them simple and unambiguous. */
export function validateUsername(username: string): string | null {
  if (username.length < 3) return "Username must be at least 3 characters.";
  if (username.length > 32) return "Username must be at most 32 characters.";
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    return "Username may only contain letters, numbers, dot, underscore and hyphen.";
  }
  return null;
}
