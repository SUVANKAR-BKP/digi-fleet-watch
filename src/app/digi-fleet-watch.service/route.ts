import { getAgentSource } from "@/lib/agent-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /digi-fleet-watch.service — systemd unit, downloaded by install.sh. */
export async function GET() {
  const { content, type } = getAgentSource("digi-fleet-watch.service");
  return new Response(content, {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=60" },
  });
}