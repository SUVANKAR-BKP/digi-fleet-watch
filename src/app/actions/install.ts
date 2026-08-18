"use server";

import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  authConfigured,
  verifySession,
} from "@/lib/dashboard-auth";

/**
 * Hands the agent enrolment token to the Add Host dialog on demand.
 *
 * The token used to be a prop on a client component rendered by the root
 * layout, which meant every page — including one fetched by an anonymous
 * crawler — carried the secret in its RSC payload. Fetching it from an action
 * keeps it out of the served HTML entirely, and lets the session be re-checked
 * at the moment it is actually requested.
 */
export async function getInstallToken(): Promise<{
  token: string;
  error?: string;
}> {
  if (authConfigured()) {
    const ok = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
    if (!ok) {
      return { token: "", error: "Your session expired — reload and sign in again." };
    }
  }

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
