import { headers } from "next/headers";

/**
 * Resolves the external base URL used in the generated install command.
 *
 * Priority:
 *   1. PUBLIC_FLEETWATCH_URL env var (explicit, e.g. a domain / Cloudflare URL)
 *   2. FLEETWATCH_PUBLIC_URL env var (legacy alias)
 *   3. The request's Host + X-Forwarded-Proto headers (works with IPs, domains
 *      and behind a reverse proxy / tunnel)
 */
export async function resolveBaseUrl(): Promise<string> {
  const envUrl = process.env.PUBLIC_FLEETWATCH_URL || process.env.FLEETWATCH_PUBLIC_URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");

  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "http";
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

/** Server-side context needed by the Add Host dialog. */
export async function getInstallContext(): Promise<{
  baseUrl: string;
  token: string;
}> {
  const baseUrl = await resolveBaseUrl();
  return { baseUrl, token: process.env.AGENT_API_TOKEN ?? "" };
}