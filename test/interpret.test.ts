import { test } from "node:test";
import assert from "node:assert/strict";
import { interpret, extractAmount } from "../lib/interpret";

test("maps multilingual accept phrases → ACCEPT_ORDER", () => {
  assert.equal(interpret("accept").intent, "ACCEPT_ORDER");
  assert.equal(interpret("haan le lo").intent, "ACCEPT_ORDER");
  assert.equal(interpret("howdu swikarishu").intent, "ACCEPT_ORDER");
});

test("maps delivered phrases → MARK_DELIVERED", () => {
  assert.equal(interpret("delivered").intent, "MARK_DELIVERED");
  assert.equal(interpret("pahuncha diya").intent, "MARK_DELIVERED");
  assert.equal(interpret("parcel de diya").intent, "MARK_DELIVERED");
});

test("maps pickup / call / next / emergency", () => {
  assert.equal(interpret("parcel uthaya").intent, "MARK_PICKED_UP");
  assert.equal(interpret("customer ko call karo").intent, "CALL_CUSTOMER");
  assert.equal(interpret("next order").intent, "NEXT_ORDER");
  assert.equal(interpret("emergency help").intent, "EMERGENCY");
});

test("cash intent extracts the amount", () => {
  const a = interpret("cash three twenty collected");
  assert.equal(a.intent, "RECORD_CASH");
  assert.equal(a.amount, 320);
  const b = interpret("collected 320 rupees");
  assert.equal(b.intent, "RECORD_CASH");
  assert.equal(b.amount, 320);
});

test("read-back context detects yes / no", () => {
  assert.equal(interpret("haan", { awaitingConfirm: true }).isYes, true);
  assert.equal(interpret("nahi cancel", { awaitingConfirm: true }).isNo, true);
});

test("unclear speech → UNKNOWN", () => {
  assert.equal(interpret("blah wobble zzz").intent, "UNKNOWN");
});

test("extractAmount: digits and spoken numbers", () => {
  assert.equal(extractAmount("320"), 320);
  assert.equal(extractAmount("three twenty"), 320);
  assert.equal(extractAmount("three hundred twenty"), 320);
  assert.equal(extractAmount("five fifty"), 550);
});
