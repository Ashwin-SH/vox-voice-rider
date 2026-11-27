import type { IntentType } from "./intents";

export interface Interpretation {
  intent: IntentType;
  amount?: number;
  isYes?: boolean; // answered "yes" to a read-back
  isNo?: boolean; // answered "no" to a read-back
  transcript: string;
}

// Multilingual phrase cues — English + romanized Hindi + romanized Kannada, by
// MEANING not exact wording. This is the keyless best-effort path; when a key is
// present the Gemini interpreter (app/api/interpret) does the real understanding.
// Order matters: more specific intents first.
const CUES: { intent: IntentType; words: string[] }[] = [
  { intent: "CALL_CUSTOMER", words: ["call", "phone", "ring", "dial", "baat kar", "customer ko", "grahak", "kare maadi", "karemaadi", "call maadi", "phone karo", "customer ge call"] },
  { intent: "MARK_PICKED_UP", words: ["picked up", "pick up", "pickup", "pick ho", "uthaya", "uthaa liya", "le liya", "parcel liya", "tegond", "tagond", "pick aytu", "got the parcel", "collected parcel"] },
  { intent: "MARK_DELIVERED", words: ["deliver", "delivered", "pahuncha", "pahunchaya", "de diya", "hand over", "handover", "kottu", "kottaytu", "tagandu", "drop kar", "dropped", "delivery done", "deliver aytu"] },
  { intent: "RECORD_CASH", words: ["cash", "paise", "paisa", "rupaye", "rupay", "rupee", "rupees", "collected", "mil gaya", "mila", "dudu", "payment", "paid", "received"] },
  { intent: "START_NAVIGATION", words: ["navigate", "navigation", "chalo", "nikal", "raasta dikha", "route", "go to pickup", "start nav", "hogu", "direction", "lead the way"] },
  { intent: "NEXT_ORDER", words: ["next order", "next", "agla order", "agla", "mundina", "aage", "another order", "new order"] },
  { intent: "REPORT_HAZARD", words: ["hazard", "traffic", "jam", "road block", "raasta kharab", "pothole", "block hai", "accident ahead"] },
  { intent: "EMERGENCY", words: ["emergency", "help me", "sos", "bachao", "danger", "accident", "madad"] },
  { intent: "ACCEPT_ORDER", words: ["accept", "le lo", "lelo", "le lenge", "haan le", "swikar", "howdu", "take it", "accept maadi", "accept karo", "order le", "yes take"] },
];

const YES = ["yes", "yeah", "yep", "haan", "haa", "ok", "okay", "sari", "howdu", "theek", "confirm", "record it", "correct", "right", "ho gaya"];
const NO = ["no", "nahi", "beda", "cancel", "stop", "galat", "wrong", "mat karo"];

// Whole-word match (t is space-padded) so short tokens like "ok" don't fire on "broke".
const hasWord = (t: string, words: string[]) => words.some((w) => t.includes(` ${w} `));

const ONES: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// Extract a rupee amount: prefer digits; fall back to spoken English numbers,
// including the colloquial "three twenty" = 320 and "three hundred twenty" = 320.
export function extractAmount(text: string): number | undefined {
  const d = text.replace(/[,\s]/g, "").match(/(\d{2,6})/);
  if (d) return parseInt(d[1], 10);

  const toks = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let matched = false;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (w in ONES) {
      // "three twenty" -> 3 then a tens word -> 3*100 + 20
      if (ONES[w] <= 9 && i + 1 < toks.length && toks[i + 1] in TENS) {
        current += ONES[w] * 100 + TENS[toks[i + 1]];
        i++;
      } else {
        current += ONES[w];
      }
      matched = true;
    } else if (w in TENS) {
      current += TENS[w];
      matched = true;
    } else if (w === "hundred") {
      current = (current || 1) * 100;
      matched = true;
    } else if (w === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
      matched = true;
    }
  }
  const val = total + current;
  return matched && val > 0 ? val : undefined;
}

// Pure, testable: transcript (+ whether we're waiting on a read-back) -> intent.
export function interpret(transcript: string, ctx: { awaitingConfirm?: boolean } = {}): Interpretation {
  // Lowercase + collapse punctuation to spaces, so "Yes." / "Nahi, cancel." match
  // (Sarvam returns punctuated transcripts). Digits are kept, so amounts survive.
  const t = ` ${transcript.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

  if (ctx.awaitingConfirm) {
    if (hasWord(t, NO)) return { intent: "UNKNOWN", isNo: true, transcript };
    if (hasWord(t, YES)) return { intent: "RECORD_CASH", isYes: true, amount: extractAmount(t), transcript };
  }

  for (const c of CUES) {
    if (c.words.some((w) => t.includes(w))) {
      const r: Interpretation = { intent: c.intent, transcript };
      if (c.intent === "RECORD_CASH") r.amount = extractAmount(t);
      return r;
    }
  }
  return { intent: "UNKNOWN", amount: extractAmount(t), transcript };
}

// The sensible next intents for a given order state — passed to the model so it
// can disambiguate (e.g. after DELIVERED, "collect" means cash, not pickup).
export function likelyActions(status?: string): IntentType[] {
  switch (status) {
    case "AVAILABLE": return ["ACCEPT_ORDER"];
    case "ACCEPTED": return ["START_NAVIGATION", "MARK_PICKED_UP", "CALL_CUSTOMER"];
    case "NAVIGATING_PICKUP": return ["MARK_PICKED_UP", "CALL_CUSTOMER"];
    case "PICKED_UP": return ["START_NAVIGATION", "MARK_DELIVERED", "CALL_CUSTOMER"];
    case "NAVIGATING_DROP": return ["MARK_DELIVERED", "CALL_CUSTOMER"];
    case "DELIVERED": return ["RECORD_CASH"];
    case "PAID": return ["NEXT_ORDER"];
    default: return [];
  }
}
