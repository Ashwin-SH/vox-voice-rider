import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { isDbConfigured } from "@/lib/db";
import { runIntent } from "@/lib/engine";
import type { IntentInput } from "@/lib/intents";
import type { Order } from "@/lib/types";

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
    // Never return customer_phone in the order; the dial number reaches the client
    // only via the CALL decision's sideEffect when the rider calls.
    const order = result.order ? stripPhone(result.order) : null;
    return NextResponse.json({ decision: result.decision, order, latencyMs: Date.now() - t0 });
  } catch (e) {
    return jsonError("Engine error", 503, e);
  }
}

function stripPhone(o: Order): Omit<Order, "customer_phone"> {
  const { customer_phone: _omit, ...rest } = o;
  void _omit;
  return rest;
}
