import { test } from "node:test";
import assert from "node:assert/strict";
import { runIntent } from "../lib/engine";
import { query } from "../lib/db";

// DB-backed coverage of the parts decide() can't reach: the transaction, the
// audit, NEXT_ORDER, and the concurrent double-submit guard. Skipped when there
// is no DATABASE_URL (plain `npm test`); runs in CI / docker. Assumes a FRESH DB
// (seed = ord_1001 AVAILABLE, earnings 62; ord_1002, earnings 48).
const HAS_DB = Boolean(process.env.DATABASE_URL);

test("golden path records exactly one transaction and reaches PAID", { skip: !HAS_DB }, async () => {
  await runIntent({ intent: "ACCEPT_ORDER" });
  await runIntent({ intent: "MARK_PICKED_UP" });
  const del = await runIntent({ intent: "MARK_DELIVERED", riderLat: 12.9609, riderLng: 77.6387 });
  assert.equal(del.decision.statusAfter, "DELIVERED");
  const cash = await runIntent({ intent: "RECORD_CASH", amount: 62, confirmed: true });
  assert.equal(cash.decision.validation, "PASSED");
  assert.equal(cash.decision.statusAfter, "PAID");
  assert.equal(cash.order?.status, "PAID");
  const txns = await query<{ n: number }>("SELECT count(*)::int AS n FROM transactions WHERE order_id = 'ord_1001'");
  assert.equal(txns.rows[0].n, 1);
});

test("concurrent duplicate RECORD_CASH records only one transaction", { skip: !HAS_DB }, async () => {
  // ord_1001 is PAID now, so focus advances to ord_1002.
  await runIntent({ intent: "ACCEPT_ORDER" });
  await runIntent({ intent: "MARK_PICKED_UP" });
  await runIntent({ intent: "MARK_DELIVERED", riderLat: 12.9116, riderLng: 77.6389 });
  const [a, b] = await Promise.all([
    runIntent({ intent: "RECORD_CASH", amount: 48, confirmed: true }),
    runIntent({ intent: "RECORD_CASH", amount: 48, confirmed: true }),
  ]);
  const passed = [a, b].filter((r) => r.decision.validation === "PASSED").length;
  assert.equal(passed, 1, "exactly one cash command should succeed");
  const txns = await query<{ n: number }>("SELECT count(*)::int AS n FROM transactions WHERE order_id = 'ord_1002'");
  assert.equal(txns.rows[0].n, 1, "exactly one transaction row despite the double-submit");
});
