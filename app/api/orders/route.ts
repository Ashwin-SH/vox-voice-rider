import { jsonError } from "@/lib/http";
import { NextResponse } from "next/server";
import { query, isDbConfigured } from "@/lib/db";
import type { Order } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/orders            -> all orders (newest first)
// GET /api/orders?status=... -> filter by lifecycle status
export async function GET(request: Request) {
  if (!isDbConfigured()) return jsonError("Database not configured", 503);
  const status = new URL(request.url).searchParams.get("status");
  try {
    const result = status
      ? await query<Order>(
          "SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC",
          [status]
        )
      : await query<Order>("SELECT * FROM orders ORDER BY created_at DESC");
    return NextResponse.json({ orders: result.rows });
  } catch (e) {
    return jsonError("Database unavailable", 503, e);
  }
}
