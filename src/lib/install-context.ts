import { headers } from "next/headers";
import { authConfigured } from "./dashboard-auth";

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

/**
 * Server-side context needed by the Add Host dialog.
 *
 * Deliberately does **not** include AGENT_API_TOKEN: this is consumed by the
 * root layout, so anything returned here is serialised into the HTML of every
 * page. The dialog asks for the token through the `getInstallToken` server
 * action once the operator opens it.
 */
export async function getInstallContext(): Promise<{
  baseUrl: string;
  authConfigured: boolean;
  tokenConfigured: boolean;
}> {
  return {
    baseUrl: await resolveBaseUrl(),
    authConfigured: authConfigured(),
    tokenConfigured: Boolean(process.env.AGENT_API_TOKEN),
  };
}