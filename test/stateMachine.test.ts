import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../lib/stateMachine";
import type { Order, OrderStatus } from "../lib/types";
import type { IntentInput } from "../lib/intents";

// Golden-path order: Indiranagar → Domlur. Drop at (12.9609, 77.6387).
function order(status: OrderStatus): Order {
  return {
    id: "ord_1001", rider_id: null, status,
    pickup_name: "Indiranagar", pickup_lat: 12.9719, pickup_lng: 77.6412,
    drop_name: "Domlur", drop_lat: 12.9609, drop_lng: 77.6387,
    distance_km: 1.3, earnings: 62, cod_amount: 320, customer_name: "Priya",
    customer_phone: "+91 90000 11111", created_at: new Date().toISOString(),
  };
}
const AT_DROP = { riderLat: 12.9609, riderLng: 77.6387 };   // ~0 m
const FAR = { riderLat: 12.9719, riderLng: 77.6412 };       // ~1.5 km away
const i = (p: Partial<IntentInput> & { intent: IntentInput["intent"] }): IntentInput => p;

test("ACCEPT on AVAILABLE is allowed → ACCEPTED", () => {
  const d = decide(order("AVAILABLE"), i({ intent: "ACCEPT_ORDER" }));
  assert.equal(d.validation, "PASSED");
  assert.equal(d.statusAfter, "ACCEPTED");
});

test("ACCEPT when already accepted is blocked (no duplicate)", () => {
  const d = decide(order("ACCEPTED"), i({ intent: "ACCEPT_ORDER" }));
  assert.equal(d.validation, "BLOCKED");
});

test("DELIVERED before pickup is blocked — same word, different state", () => {
  const d = decide(order("ACCEPTED"), i({ intent: "MARK_DELIVERED", ...AT_DROP }));
  assert.equal(d.validation, "BLOCKED");
  assert.match(d.feedback, /picked up/i);
});

test("DELIVERED outside geofence is blocked with distance", () => {
  const d = decide(order("PICKED_UP"), i({ intent: "MARK_DELIVERED", ...FAR }));
  assert.equal(d.validation, "BLOCKED");
  assert.equal(d.geo?.within, false);
  assert.ok((d.geo?.distanceM ?? 0) > 100);
});

test("DELIVERED inside geofence is allowed → DELIVERED", () => {
  const d = decide(order("PICKED_UP"), i({ intent: "MARK_DELIVERED", ...AT_DROP }));
  assert.equal(d.validation, "PASSED");
  assert.equal(d.statusAfter, "DELIVERED");
  assert.equal(d.geo?.within, true);
});

test("DELIVERED when already delivered is blocked (duplicate prevention)", () => {
  const d = decide(order("DELIVERED"), i({ intent: "MARK_DELIVERED", ...AT_DROP }));
  assert.equal(d.validation, "BLOCKED");
  assert.match(d.feedback, /already delivered/i);
});

test("DELIVERED without rider location is blocked", () => {
  const d = decide(order("PICKED_UP"), i({ intent: "MARK_DELIVERED" }));
  assert.equal(d.validation, "BLOCKED");
});

test("RECORD_CASH with matching amount but no confirmation asks to confirm (read-back)", () => {
  const d = decide(order("DELIVERED"), i({ intent: "RECORD_CASH", amount: 320 }));
  assert.equal(d.validation, "CONFIRM_REQUIRED");
  assert.equal(d.action, "CONFIRM_AMOUNT");
  assert.match(d.feedback, /say yes/i); // the read-back branch, not the mismatch branch
});

test("RECORD_CASH confirmed, amount matches COD total → PAID", () => {
  const d = decide(order("DELIVERED"), i({ intent: "RECORD_CASH", amount: 320, confirmed: true }));
  assert.equal(d.validation, "PASSED");
  assert.equal(d.statusAfter, "PAID");
  assert.equal(d.amount, 320);
});

test("RECORD_CASH rejects an amount that doesn't match the COD total", () => {
  const d = decide(order("DELIVERED"), i({ intent: "RECORD_CASH", amount: 2000, confirmed: true }));
  assert.notEqual(d.validation, "PASSED");
  assert.match(d.feedback, /320/);
});

test("RECORD_CASH before delivery is blocked", () => {
  const d = decide(order("PICKED_UP"), i({ intent: "RECORD_CASH", amount: 320, confirmed: true }));
  assert.equal(d.validation, "BLOCKED");
});

test("low-confidence command never executes — asks again", () => {
  const d = decide(order("PICKED_UP"), i({ intent: "MARK_DELIVERED", confidence: 0.3, ...AT_DROP }));
  assert.equal(d.action, "CLARIFY");
  assert.notEqual(d.validation, "PASSED");
});

test("EMERGENCY fires even at low confidence (safety-first)", () => {
  const d = decide(order("PICKED_UP"), i({ intent: "EMERGENCY", confidence: 0.2 }));
  assert.equal(d.validation, "PASSED");
  assert.equal(d.action, "EMERGENCY");
});

test("CALL_CUSTOMER on active order returns the phone as a side effect", () => {
  const d = decide(order("NAVIGATING_DROP"), i({ intent: "CALL_CUSTOMER" }));
  assert.equal(d.validation, "PASSED");
  assert.equal(d.sideEffect?.type, "CALL");
  assert.ok(d.sideEffect?.value);
});

test("MARK_PICKED_UP on accepted order → PICKED_UP", () => {
  const d = decide(order("ACCEPTED"), i({ intent: "MARK_PICKED_UP" }));
  assert.equal(d.validation, "PASSED");
  assert.equal(d.statusAfter, "PICKED_UP");
});

test("START_NAVIGATION is contextual: pickup before, drop after", () => {
  assert.equal(decide(order("ACCEPTED"), i({ intent: "START_NAVIGATION" })).statusAfter, "NAVIGATING_PICKUP");
  assert.equal(decide(order("PICKED_UP"), i({ intent: "START_NAVIGATION" })).statusAfter, "NAVIGATING_DROP");
});

// --- Part 2 hardening (post-review): money + coordinate validation ---
test("RECORD_CASH rejects a huge/overflow amount (no PAID, no lost cash)", () => {
  const d = decide(order("DELIVERED"), i({ intent: "RECORD_CASH", amount: 999999999999, confirmed: true }));
  assert.notEqual(d.validation, "PASSED");
  assert.notEqual(d.statusAfter, "PAID");
});

test("RECORD_CASH rejects a non-integer (float) amount", () => {
  const d = decide(order("DELIVERED"), i({ intent: "RECORD_CASH", amount: 320.5, confirmed: true }));
  assert.notEqual(d.validation, "PASSED");
});

test("RECORD_CASH rejects NaN amount", () => {
  const d = decide(order("DELIVERED"), i({ intent: "RECORD_CASH", amount: NaN, confirmed: true }));
  assert.notEqual(d.validation, "PASSED");
});

test("DELIVERED with NaN coordinates blocks cleanly (no 'NaN metres')", () => {
  const d = decide(order("PICKED_UP"), i({ intent: "MARK_DELIVERED", riderLat: NaN, riderLng: NaN }));
  assert.equal(d.validation, "BLOCKED");
  assert.doesNotMatch(d.feedback, /NaN/);
});

test("REJECT on AVAILABLE is allowed, no state change (client advances)", () => {
  const d = decide(order("AVAILABLE"), i({ intent: "REJECT_ORDER" }));
  assert.equal(d.validation, "PASSED");
  assert.equal(d.action, "REJECT_ORDER");
  assert.equal(d.statusAfter, null); // order stays AVAILABLE
});

test("REJECT when no request is on offer is blocked", () => {
  const d = decide(order("ACCEPTED"), i({ intent: "REJECT_ORDER" }));
  assert.equal(d.validation, "BLOCKED");
});
