import { NextResponse } from "next/server";
import { isDbConfigured, query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/health          -> always 200 (liveness); db flag carries real state.
// GET /api/health?strict=1 -> 503 when the DB is unavailable (usable as a probe).
export async function GET(request: Request) {
  const strict = new URL(request.url).searchParams.get("strict") === "1";
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: !strict, db: "not-configured" }, { status: strict ? 503 : 200 });
  }
  try {
    await query("SELECT 1");
    return NextResponse.json({ ok: true, db: "connected" });
  } catch {
    return NextResponse.json({ ok: !strict, db: "unavailable" }, { status: strict ? 503 : 200 });
  }
}
