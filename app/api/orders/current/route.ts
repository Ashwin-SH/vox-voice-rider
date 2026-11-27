import { jsonError } from "@/lib/http";
import { NextResponse } from "next/server";
import { query, ORDER_COLS_PUBLIC } from "@/lib/db";
import type { Order } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phone is NOT returned — the dashboard dials via the CALL intent's sideEffect. TODO(multi-rider): scope to the signed-in rider; today
// there is a single seeded rider (rider_ravi), so the oldest unsettled order
// is unambiguous.
export async function GET() {
  try {
    const active = await query<Order>(
      `SELECT ${ORDER_COLS_PUBLIC} FROM orders WHERE status NOT IN ('AVAILABLE','PAID') ORDER BY created_at ASC, id ASC LIMIT 1`
    );
    if (active.rows[0]) return NextResponse.json({ order: active.rows[0] });
    const next = await query<Order>(
      `SELECT ${ORDER_COLS_PUBLIC} FROM orders WHERE status = 'AVAILABLE' ORDER BY created_at ASC, id ASC LIMIT 1`
    );
    return NextResponse.json({ order: next.rows[0] ?? null });
  } catch (e) {
    return jsonError("Database unavailable", 503, e);
  }
}
