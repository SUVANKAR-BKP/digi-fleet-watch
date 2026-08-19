import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { bearerFromHeader, matchAgentToken } from "@/lib/auth";
import { parseAgentPayload, processIngest } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Agent ingest endpoint.
 * POST /api/ingest  (Authorization: Bearer $AGENT_API_TOKEN)
 */
export async function POST(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get("authorization"));
  const tokenMatch = matchAgentToken(token);
  if (!tokenMatch) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const payload = parseAgentPayload(raw);
    const { hostId, snapshotId } = await processIngest(payload);

    // Name the stragglers so a rotation has an observable finish line: when
    // this stops appearing in the logs, every agent is on the new secret and
    // AGENT_API_TOKEN_PREVIOUS can be removed.
    if (tokenMatch === "previous") {
      console.warn(
        `[ingest] host "${payload.hostname}" is still using AGENT_API_TOKEN_PREVIOUS — ` +
          "re-run the Add Host command on it, then unset the previous token",
      );
    }

    return NextResponse.json(
      {
        ok: true,
        hostId,
        snapshotId,
        // Lets the agent warn on the host itself, not just in server logs.
        ...(tokenMatch === "previous" ? { tokenRotationPending: true } : {}),
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ZodError) {
      // This is a trusted internal agent (not a public API), so we log the
      // full field-by-field failure and return it verbatim — no more
      // "manual curl reproduction" needed to debug a payload mismatch.
      console.error("[ingest] validation failed", JSON.stringify(err.issues, null, 2));
      return NextResponse.json(
        { error: "invalid payload", issues: err.issues },
        { status: 422 },
      );
    }
    console.error("[ingest] failed", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}