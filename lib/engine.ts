import { query, withTransaction, ORDER_COLS_FULL } from "./db";
import { decide } from "./stateMachine";
import type { Decision, IntentInput } from "./intents";
import type { Order } from "./types";
import { randomUUID } from "node:crypto";

const RIDER_ID = "rider_ravi";
const MAX_TRANSCRIPT = 500;

// The rider's single point of focus: their active order, else the next available.
async function loadFocusOrder(): Promise<Order | null> {
  const active = await query<Order>(
    `SELECT ${ORDER_COLS_FULL} FROM orders WHERE status NOT IN ('AVAILABLE','PAID') ORDER BY created_at ASC LIMIT 1`
  );
  if (active.rows[0]) return active.rows[0];
  const next = await query<Order>(
    `SELECT ${ORDER_COLS_FULL} FROM orders WHERE status = 'AVAILABLE' ORDER BY created_at ASC LIMIT 1`
  );
  return next.rows[0] ?? null;
}

// Audit payload without leaking the phone (from a CALL side effect) or storing an
// unbounded transcript blob.
function auditPayload(decision: Decision, input: IntentInput): string {
  const safeDecision: Decision = decision.sideEffect?.value
    ? { ...decision, sideEffect: { ...decision.sideEffect, value: "[redacted]" } }
    : decision;
  const safeInput: IntentInput =
    typeof input.transcript === "string" && input.transcript.length > MAX_TRANSCRIPT
      ? { ...input, transcript: input.transcript.slice(0, MAX_TRANSCRIPT) }
      : input;
  return JSON.stringify({ decision: safeDecision, input: safeInput });
}

async function audit(orderId: string | null, decision: Decision, input: IntentInput): Promise<void> {
  await query(`INSERT INTO task_events (order_id, event_type, payload) VALUES ($1, $2, $3::jsonb)`, [
    orderId,
    decision.action,
    auditPayload(decision, input),
  ]);
}

export interface IntentResult {
  decision: Decision;
  order: Order | null; // focus order after the action (customer_phone stripped by the route)
}

// Load context → decide (pure) → apply the allowed transition. The pure decision
// never mutates anything itself; only PASSED decisions write, and every write is a
// compare-and-swap so concurrent duplicates cannot both succeed.
export async function runIntent(input: IntentInput): Promise<IntentResult> {
  const order = await loadFocusOrder();
  let decision = decide(order, input);
  let focus = order;

  // A state-changing, allowed action: do the UPDATE, any cash row, and the audit
  // in ONE transaction, guarded on the status decide() actually saw.
  if (decision.validation === "PASSED" && order && decision.statusAfter && decision.statusAfter !== order.status) {
    const isCash = decision.action === "RECORD_CASH";
    const amount = decision.amount;
    const updated = await withTransaction(async (c) => {
      const upd = await c.query<Order>(
        `UPDATE orders SET status = $1, rider_id = $2 WHERE id = $3 AND status = $4 RETURNING ${ORDER_COLS_FULL}`,
        [decision.statusAfter, RIDER_ID, order.id, order.status]
      );
      if (upd.rowCount === 0) return null; // lost a race: another request already advanced this order
      if (isCash && typeof amount === "number") {
        await c.query(`INSERT INTO transactions (id, order_id, amount, method) VALUES ($1, $2, $3, 'CASH')`, [
          randomUUID(),
          order.id,
          amount,
        ]);
      }
      await c.query(`INSERT INTO task_events (order_id, event_type, payload) VALUES ($1, $2, $3::jsonb)`, [
        order.id,
        decision.action,
        auditPayload(decision, input),
      ]);
      return upd.rows[0];
    });

    if (updated === null) {
      decision = {
        ...decision,
        validation: "BLOCKED",
        action: "BLOCKED",
        statusAfter: null,
        reason: "Order already advanced by a concurrent action.",
        feedback: "That was already done.",
      };
      focus = await loadFocusOrder();
      await audit(order.id, decision, input);
      return { decision, order: focus };
    }
    return { decision, order: updated };
  }

  // "Next order" moves focus to a DIFFERENT available order (never the current one).
  if (decision.validation === "PASSED" && decision.action === "NEXT_ORDER") {
    const next = await query<Order>(
      `SELECT ${ORDER_COLS_FULL} FROM orders WHERE status = 'AVAILABLE' AND id <> $1 ORDER BY created_at ASC LIMIT 1`,
      [order?.id ?? ""]
    );
    focus = next.rows[0] ?? null;
    decision = { ...decision, orderId: focus?.id ?? null };
  }

  // Non-state-change paths (BLOCKED / CALL / NOOP / NEXT_ORDER / hazard / emergency): audit only.
  await audit(order?.id ?? focus?.id ?? null, decision, input);
  return { decision, order: focus };
}
