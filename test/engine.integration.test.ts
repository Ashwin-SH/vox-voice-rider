import { test } from "node:test";
import assert from "node:assert/strict";
import { runIntent } from "../lib/engine";
import { query } from "../lib/db";

// DB-backed coverage of what decide() can't reach: the transaction, the audit,
// and the concurrent double-submit guard. Skipped when there's no DATABASE_URL
// (plain `npm test`); runs in CI / docker. One sequential test (two phases, each
// after a reset) so it's deterministic and re-runnable against the same DB.
// ord_1001: drop = Domlur, cod_amount 320.
const HAS_DB = Boolean(process.env.DATABASE_URL);
const DROP = { riderLat: 12.9609, riderLng: 77.6387 };

async function reset() {
  await query("UPDATE orders SET status = 'AVAILABLE', rider_id = NULL");
  await query("DELETE FROM transactions");
  await query("DELETE FROM task_events");
}

test("engine: golden path records one transaction; concurrent duplicate records none extra", { skip: !HAS_DB }, async () => {
  // Phase 1 — golden path reaches PAID with exactly one transaction.
  await reset();
  await runIntent({ intent: "ACCEPT_ORDER" });
  await runIntent({ intent: "MARK_PICKED_UP" });
  const del = await runIntent({ intent: "MARK_DELIVERED", ...DROP });
  assert.equal(del.decision.statusAfter, "DELIVERED");
  const cash = await runIntent({ intent: "RECORD_CASH", amount: 320, confirmed: true });
  assert.equal(cash.decision.validation, "PASSED");
  assert.equal(cash.decision.statusAfter, "PAID");
  let txns = await query<{ n: number }>("SELECT count(*)::int AS n FROM transactions WHERE order_id = 'ord_1001'");
  assert.equal(txns.rows[0].n, 1);

  // Phase 2 — two simultaneous RECORD_CASH on the same delivered order → one succeeds.
  await reset();
  await runIntent({ intent: "ACCEPT_ORDER" });
  await runIntent({ intent: "MARK_PICKED_UP" });
  await runIntent({ intent: "MARK_DELIVERED", ...DROP });
  const [a, b] = await Promise.all([
    runIntent({ intent: "RECORD_CASH", amount: 320, confirmed: true }),
    runIntent({ intent: "RECORD_CASH", amount: 320, confirmed: true }),
  ]);
  const passed = [a, b].filter((r) => r.decision.validation === "PASSED").length;
  assert.equal(passed, 1, "exactly one cash command should succeed");
  txns = await query<{ n: number }>("SELECT count(*)::int AS n FROM transactions WHERE order_id = 'ord_1001'");
  assert.equal(txns.rows[0].n, 1, "exactly one transaction row despite the double-submit");
});
