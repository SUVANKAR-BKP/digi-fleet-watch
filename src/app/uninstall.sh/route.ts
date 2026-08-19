import { getAgentSource } from "@/lib/agent-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /uninstall.sh — removes the agent from a host, so deleting it from the
 * dashboard actually stops monitoring instead of the host re-registering on
 * its next heartbeat. Public (no secrets inside).
 */
export async function GET() {
  const { content, type } = getAgentSource("uninstall.sh");
  return new Response(content, {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=60" },
  });
}
