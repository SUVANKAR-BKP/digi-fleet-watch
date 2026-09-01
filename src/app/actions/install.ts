"use server";

import { requirePermission } from "@/lib/auth-server";

/**
 * Hands the agent enrolment token to the Add Host dialog on demand.
 *
 * The token used to be a prop on a client component rendered by the root
 * layout, which meant every page — including one fetched by an anonymous
 * crawler — carried the secret in its RSC payload. Fetching it from an action
 * keeps it out of the served HTML entirely, and lets permission be checked at
 * the moment it is actually requested.
 *
 * Gated on `hosts:enroll`: the token lets its holder post data as any host, so
 * a viewer must not be able to read it.
 */
export async function getInstallToken(): Promise<{
  token: string;
  error?: string;
}> {
  const auth = await requirePermission("hosts:enroll");
  if (!auth.ok) return { token: "", error: auth.error };

  const token = process.env.AGENT_API_TOKEN ?? "";
  if (!token) {
    return {
      token: "",
      error:
        "AGENT_API_TOKEN is not set on the server, so no agent can authenticate. " +
        "Set it in .env and restart.",
    };
  }
  return { token };
}
