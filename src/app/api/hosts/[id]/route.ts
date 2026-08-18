import { NextRequest, NextResponse } from "next/server";
import { getHostDetail } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/hosts/[id] — full detail for one host. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const num = Number(id);
  if (!Number.isInteger(num) || num <= 0) {
    return NextResponse.json({ error: "invalid host id" }, { status: 400 });
  }

  const detail = await getHostDetail(num);
  if (!detail) {
    return NextResponse.json({ error: "host not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}