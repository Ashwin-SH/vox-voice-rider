import { jsonError } from "@/lib/http";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { ORDER_STATUSES, type Order, type OrderStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public columns — customer_phone is intentionally omitted here. The phone is
// exposed only on /api/orders/current, where the call feature needs it.
const PUBLIC_COLS =
  "id, rider_id, status, pickup_name, pickup_lat, pickup_lng, drop_name, drop_lat, drop_lng, distance_km, earnings, customer_name, created_at";

// GET /api/orders            -> all orders (newest first), without phone
// GET /api/orders?status=... -> filter by a valid lifecycle status
export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status");
  if (status && !ORDER_STATUSES.includes(status as OrderStatus)) {
    return jsonError(`Invalid status '${status}'`, 400);
  }
  try {
    const result = status
      ? await query<Order>(`SELECT ${PUBLIC_COLS} FROM orders WHERE status = $1 ORDER BY created_at DESC`, [status])
      : await query<Order>(`SELECT ${PUBLIC_COLS} FROM orders ORDER BY created_at DESC`);
    return NextResponse.json({ orders: result.rows });
  } catch (e) {
    return jsonError("Database unavailable", 503, e);
  }
}
