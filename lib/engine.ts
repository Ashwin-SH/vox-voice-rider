import { query, withTransaction } from "./db";
import { decide } from "./stateMachine";
import type { Decision, IntentInput } from "./intents";
import type { Order } from "./types";
import { randomUUID } from "node:crypto";

const RIDER_ID = "rider_ravi";

// The rider's single point of focus: their active order, else the next available.
async function loadFocusOrder(): Promise<Order | null> {
  const active = await query<Order>(
    `SELECT * FROM orders WHERE status NOT IN ('AVAILABLE','PAID') ORDER BY created_at ASC LIMIT 1`
  );
  if (active.rows[0]) return active.rows[0];
  const next = await query<Order>(
    `SELECT * FROM orders WHERE status = 'AVAILABLE' ORDER BY created_at ASC LIMIT 1`
  );
  return next.rows[0] ?? null;
}

export interface IntentResult {
  decision: Decision;
  order: Order | null; // the focus order after the action (for UI refresh)
}

// Load context → decide (pure) → apply the allowed transition → audit. The pure
// decision is never trusted to mutate anything; only PASSED decisions write.
export async function runIntent(input: IntentInput): Promise<IntentResult> {
  const order = await loadFocusOrder();
  const decision = decide(order, input);
  let focus = order;

  if (decision.validation === "PASSED" && order) {
    if (decision.action === "RECORD_CASH" && typeof decision.amount === "number") {
      // Mark PAID and record the cash in ONE transaction: never a PAID order
      // without its matching transaction row (or vice-versa).
      const amount = decision.amount;
      focus = await withTransaction(async (c) => {
        const upd = await c.query<Order>(
          `UPDATE orders SET status = $1, rider_id = $2 WHERE id = $3 RETURNING *`,
          [decision.statusAfter ?? "PAID", RIDER_ID, order.id]
        );
        await c.query(
          `INSERT INTO transactions (id, order_id, amount, method) VALUES ($1, $2, $3, 'CASH')`,
          [randomUUID(), order.id, amount]
        );
        return upd.rows[0] ?? order;
      });
    } else if (decision.statusAfter && decision.statusAfter !== order.status) {
      const upd = await query<Order>(
        `UPDATE orders SET status = $1, rider_id = $2 WHERE id = $3 RETURNING *`,
        [decision.statusAfter, RIDER_ID, order.id]
      );
      focus = upd.rows[0] ?? order;
    }
  }

  // "Next order" advances focus to the next available order.
  if (decision.validation === "PASSED" && decision.action === "NEXT_ORDER") {
    const next = await query<Order>(
      `SELECT * FROM orders WHERE status = 'AVAILABLE' ORDER BY created_at ASC LIMIT 1`
    );
    focus = next.rows[0] ?? null;
    decision.orderId = focus?.id ?? null;
  }

  // Append-only audit trail — powers the judge decision panel + metrics (Part 4).
  await query(
    `INSERT INTO task_events (order_id, event_type, payload) VALUES ($1, $2, $3::jsonb)`,
    [order?.id ?? focus?.id ?? null, decision.action, JSON.stringify({ decision, input })]
  );

  return { decision, order: focus };
}
