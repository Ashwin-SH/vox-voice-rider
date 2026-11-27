import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { isDbConfigured } from "@/lib/db";
import { runIntent } from "@/lib/engine";
import type { IntentInput } from "@/lib/intents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/intent — run one voice command through the full pipeline and return
// the structured Decision (+ measured latency) that the UI and judge panel show.
export async function POST(request: Request) {
  if (!isDbConfigured()) return jsonError("Database not configured", 503);
  let body: IntentInput;
  try {
    body = (await request.json()) as IntentInput;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  if (!body || typeof body.intent !== "string") {
    return jsonError("Missing 'intent'", 400);
  }
  const t0 = Date.now();
  try {
    const result = await runIntent(body);
    return NextResponse.json({ ...result, latencyMs: Date.now() - t0 });
  } catch (e) {
    return jsonError("Engine error", 503, e);
  }
}
