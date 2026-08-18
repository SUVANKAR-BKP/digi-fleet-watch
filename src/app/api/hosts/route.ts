import { NextResponse } from "next/server";
import { getOverview } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/hosts — overview of all hosts with computed status. */
export async function GET() {
  const data = await getOverview();
  return NextResponse.json(data);
}