import { NextResponse } from "next/server";
import { isDbConfigured, query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness + DB readiness. Always returns 200 so the app is never considered
// "down" just because Postgres is still starting; db flag tells the real story.
export async function GET() {
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: true, db: "not-configured" });
  }
  try {
    await query("SELECT 1");
    return NextResponse.json({ ok: true, db: "connected" });
  } catch {
    return NextResponse.json({ ok: true, db: "unavailable" });
  }
}
