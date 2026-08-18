import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health — liveness probe for the container healthcheck. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "digi-fleet-watch" });
}