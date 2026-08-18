import { getAgentSource } from "@/lib/agent-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /digi-fleet-watch.timer — systemd timer, downloaded by install.sh. */
export async function GET() {
  const { content, type } = getAgentSource("digi-fleet-watch.timer");
  return new Response(content, {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=60" },
  });
}