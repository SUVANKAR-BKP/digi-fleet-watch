import { NextRequest, NextResponse } from "next/server";
import { bearerFromHeader, isValidAgentToken } from "@/lib/auth";
import { runDowntimeCheck } from "@/lib/downtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/check-downtime
 * Runs the heartbeat-miss scan on demand (for an external cron) and returns
 * what changed. Bearer-authenticated with the same AGENT_API_TOKEN.
 */
export async function POST(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get("authorization"));
  if (!isValidAgentToken(token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDowntimeCheck();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[check-downtime] failed", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}