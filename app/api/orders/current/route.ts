import { jsonError } from "@/lib/http";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { Order } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Includes customer_phone: the dashboard's "call customer" action needs it on
// the active order. TODO(multi-rider): scope to the signed-in rider; today
// there is a single seeded rider (rider_ravi), so the oldest unsettled order
// is unambiguous.
const FULL_COLS =
  "id, rider_id, status, pickup_name, pickup_lat, pickup_lng, drop_name, drop_lat, drop_lng, distance_km, earnings, customer_name, customer_phone, created_at";

export async function GET() {
  try {
    const active = await query<Order>(
      `SELECT ${FULL_COLS} FROM orders WHERE status NOT IN ('AVAILABLE','PAID') ORDER BY created_at ASC LIMIT 1`
    );
    if (active.rows[0]) return NextResponse.json({ order: active.rows[0] });
    const next = await query<Order>(
      `SELECT ${FULL_COLS} FROM orders WHERE status = 'AVAILABLE' ORDER BY created_at ASC LIMIT 1`
    );
    return NextResponse.json({ order: next.rows[0] ?? null });
  } catch (e) {
    return jsonError("Database unavailable", 503, e);
  }
}
