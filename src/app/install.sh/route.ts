import { getAgentSource } from "@/lib/agent-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /install.sh — the bootstrapping installer, served so a target host can
 * `curl ... | bash` it directly. Public (no secrets inside).
 */
export async function GET() {
  const { content, type } = getAgentSource("install.sh");
  return new Response(content, {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=60" },
  });
}