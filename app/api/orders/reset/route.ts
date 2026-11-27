import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { isDbConfigured, resetScenario } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/orders/reset — restore the deterministic demo scenario (clears rides,
// transactions and events, re-seeds the orders). Lets a judge re-run the whole
// journey from a clean, predictable state.
export async function POST() {
  if (!isDbConfigured()) return jsonError("Database not configured", 503);
  try {
    await resetScenario();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError("Reset failed", 503, e);
  }
}
