import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/stats — the rider's real accumulated earnings + completed rides, read
// from PAID orders. Backs the header totals so "earnings update" after a ride is
// genuine DB state, not a client counter.
export async function GET() {
  try {
    const r = await query<{ earnings: string; rides: string }>(
      `SELECT COALESCE(SUM(earnings), 0)::text AS earnings, COUNT(*)::text AS rides FROM orders WHERE status = 'PAID'`
    );
    return NextResponse.json({
      earnings: Number(r.rows[0]?.earnings ?? 0),
      rides: Number(r.rows[0]?.rides ?? 0),
    });
  } catch (e) {
    return jsonError("Database unavailable", 503, e);
  }
}
