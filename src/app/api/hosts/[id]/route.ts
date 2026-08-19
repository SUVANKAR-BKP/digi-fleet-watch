import { NextRequest, NextResponse } from "next/server";
import { deleteHost, getHostDetail } from "@/lib/data";

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

  try {
    const detail = await getHostDetail(num);
    if (!detail) {
      return NextResponse.json({ error: "host not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (err) {
    // A 404 here used to hide real failures (e.g. a table the deployment's
    // Postgres volume never got). Report them as 500s with the reason, so
    // `curl /api/hosts/1` diagnoses the problem instead of misdirecting.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[host:${num}] failed`, err);
    return NextResponse.json(
      { error: "internal error", detail: message },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/hosts/[id] — stop monitoring a host and forget its history.
 *
 * Protected by the same dashboard session as the read APIs (see middleware.ts),
 * which means it is only actually protected when
 * FLEETWATCH_DASHBOARD_PASSWORD is set.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const num = Number(id);
  if (!Number.isInteger(num) || num <= 0) {
    return NextResponse.json({ error: "invalid host id" }, { status: 400 });
  }

  try {
    const removed = await deleteHost(num);
    if (!removed) {
      return NextResponse.json({ error: "host not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted: num });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[host:${num}] delete failed`, err);
    return NextResponse.json(
      { error: "internal error", detail: message },
      { status: 500 },
    );
  }
}