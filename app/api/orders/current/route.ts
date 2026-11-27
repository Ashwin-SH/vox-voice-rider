import { jsonError } from "@/lib/http";
import { NextResponse } from "next/server";
import { query, isDbConfigured } from "@/lib/db";
import type { Order } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The rider's single active order (anything not yet settled), else the next
// available one. This is what the dashboard shows as "current task".
export async function GET() {
  if (!isDbConfigured()) return jsonError("Database not configured", 503);
  try {
    const active = await query<Order>(
      `SELECT * FROM orders
       WHERE status NOT IN ('AVAILABLE','PAID')
       ORDER BY created_at ASC LIMIT 1`
    );
    if (active.rows[0]) return NextResponse.json({ order: active.rows[0] });

    const next = await query<Order>(
      `SELECT * FROM orders WHERE status = 'AVAILABLE' ORDER BY created_at ASC LIMIT 1`
    );
    return NextResponse.json({ order: next.rows[0] ?? null });
  } catch (e) {
    return jsonError("Database unavailable", 503, e);
  }
}
