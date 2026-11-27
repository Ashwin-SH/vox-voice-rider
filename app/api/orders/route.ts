import { jsonError } from "@/lib/http";
import { NextResponse } from "next/server";
import { query, ORDER_COLS_PUBLIC } from "@/lib/db";
import { ORDER_STATUSES, type Order, type OrderStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/orders            -> all orders (newest first), without phone
// GET /api/orders?status=... -> filter by a valid lifecycle status
export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status");
  if (status && !ORDER_STATUSES.includes(status as OrderStatus)) {
    return jsonError(`Invalid status '${status}'`, 400);
  }
  try {
    const result = status
      ? await query<Order>(`SELECT ${ORDER_COLS_PUBLIC} FROM orders WHERE status = $1 ORDER BY created_at DESC`, [status])
      : await query<Order>(`SELECT ${ORDER_COLS_PUBLIC} FROM orders ORDER BY created_at DESC`);
    return NextResponse.json({ orders: result.rows });
  } catch (e) {
    return jsonError("Database unavailable", 503, e);
  }
}
