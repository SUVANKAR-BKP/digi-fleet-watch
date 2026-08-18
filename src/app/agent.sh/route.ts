import { getAgentSource } from "@/lib/agent-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /agent.sh — the collector script, downloaded by install.sh. Public. */
export async function GET() {
  const { content, type } = getAgentSource("agent.sh");
  return new Response(content, {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=60" },
  });
}