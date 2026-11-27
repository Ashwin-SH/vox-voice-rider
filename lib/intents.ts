import type { Order, OrderStatus } from "./types";

// What the rider wants to do. The voice/LLM layer (Part 5) maps free, multilingual
// speech to one of these; the state machine (this module) decides if it's allowed.
export type IntentType =
  | "ACCEPT_ORDER"
  | "START_NAVIGATION"
  | "CALL_CUSTOMER"
  | "MARK_PICKED_UP"
  | "MARK_DELIVERED"
  | "RECORD_CASH"
  | "NEXT_ORDER"
  | "REPORT_HAZARD"
  | "EMERGENCY"
  | "UNKNOWN";

// The structured input to the engine. riderLat/riderLng are the (simulated) GPS
// of the rider at command time; amount/confirmed are used by RECORD_CASH.
export interface IntentInput {
  intent: IntentType;
  language?: string;   // e.g. "kn-en", "hi", "en" — carried through from the voice layer
  confidence?: number; // 0..1 from the recognizer; used for the low-confidence path
  amount?: number;     // rupees, for RECORD_CASH
  confirmed?: boolean; // the rider's read-back confirmation for money/critical actions
  riderLat?: number;
  riderLng?: number;
  transcript?: string; // raw recognized text, for the audit trail / panel
}

export type ValidationResult = "PASSED" | "BLOCKED" | "CONFIRM_REQUIRED" | "NOOP";

// The single structured object the engine returns. This is exactly what the
// judge "decision panel" (Part 4) renders — proof that VOX made a structured
// decision through real rules, not just a clever sentence.
export interface Decision {
  intent: IntentType;
  language?: string;
  confidence?: number;
  orderId: string | null;
  statusBefore: OrderStatus | null;
  statusAfter: OrderStatus | null; // null when the intent causes no state change
  validation: ValidationResult;
  action: string;      // machine label, e.g. "MARK_DELIVERED" | "BLOCKED" | "RECORD_CASH"
  reason?: string;     // human-readable why, esp. when BLOCKED
  geo?: { distanceM: number; thresholdM: number; within: boolean };
  amount?: number;
  sideEffect?: { type: string; value?: string }; // e.g. { type:"CALL", value:"+91…" }
  feedback: string;    // short spoken response text
}

// Low-confidence recognitions never execute — VOX asks again instead of guessing.
export const CONFIDENCE_FLOOR = 0.55;

// Upper sanity bound for a single cash collection (rupees). Guards against
// fat-fingered / pathological amounts reaching a PAID decision.
export const MAX_CASH = 100000;

export type { Order, OrderStatus };
