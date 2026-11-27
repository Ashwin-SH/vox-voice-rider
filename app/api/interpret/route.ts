import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { interpret, extractAmount, likelyActions, type Interpretation } from "@/lib/interpret";
import type { IntentType } from "@/lib/intents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTENTS: IntentType[] = [
  "ACCEPT_ORDER", "START_NAVIGATION", "MARK_PICKED_UP", "CALL_CUSTOMER",
  "MARK_DELIVERED", "RECORD_CASH", "NEXT_ORDER", "REPORT_HAZARD", "EMERGENCY", "UNKNOWN",
];

interface Body {
  transcript?: string;
  awaitingConfirm?: boolean;
  status?: string;
}

// POST /api/interpret — turn a (multilingual) transcript into a structured intent
// BY MEANING. With Gemini or Sarvam the model understands any language/phrasing
// (Kannada, Hindi, mixed); with no key it uses the deterministic rule interpreter.
// Keys never leave the server; any model failure falls back so the path never dies.
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const transcript = (body.transcript ?? "").trim().slice(0, 500);
  if (!transcript) return jsonError("Missing 'transcript'", 400);

  // Sarvam first — it's the India-tuned model for Kannada/Hindi/mixed, which is
  // the point. Gemini is the secondary understanding path.
  const sarvam = process.env.SARVAM_API_KEY?.trim();
  if (sarvam) {
    try {
      const s = await interpretWithSarvam(transcript, body, sarvam);
      if (s) return NextResponse.json({ ...s, source: "sarvam", transcript });
    } catch (e) {
      console.error("[interpret] sarvam failed, trying next:", e);
    }
  }
  const gemini = process.env.GEMINI_API_KEY?.trim();
  if (gemini) {
    try {
      const g = await interpretWithGemini(transcript, body, gemini);
      if (g) return NextResponse.json({ ...g, source: "gemini", transcript });
    } catch (e) {
      console.error("[interpret] gemini failed, falling back to rules:", e);
    }
  }
  const r = interpret(transcript, { awaitingConfirm: body.awaitingConfirm });
  return NextResponse.json({ ...r, source: "rules" });
}

const SYSTEM = `You map an Indian delivery rider's spoken command to ONE intent by MEANING.
The rider may speak English, Hindi, Kannada, Tamil, or mixed (Hinglish / Kannada-English) — understand intent, not exact words.
Intents: ${JSON.stringify(INTENTS)}.
For cash, extract the rupee amount as a number. If the rider is answering a yes/no confirmation, set isYes or isNo.
Reply with ONLY compact JSON: {"intent":"...","amount":<number>,"isYes":<bool>,"isNo":<bool>}. Omit fields that don't apply. Use UNKNOWN if genuinely unclear.`;

function ctxLine(body: Body): string {
  const likely = likelyActions(body.status);
  const likelyStr = likely.length ? ` Given this state, the most likely commands right now are: ${likely.join(", ")} — prefer these when the wording is ambiguous (e.g. after DELIVERED, "collect"/"collect maadide"/"cash togondidini" means RECORD_CASH, not pickup).` : "";
  return `Current order status: ${body.status ?? "unknown"}.${likelyStr}${body.awaitingConfirm ? " The rider is answering a yes/no read-back for a cash amount." : ""}`;
}

function parseModelJson(text: string, transcript: string): Interpretation {
  const match = text.match(/\{[\s\S]*\}/);
  const parsed = match ? (JSON.parse(match[0]) as Partial<Interpretation>) : {};
  const intent = (INTENTS.includes(parsed.intent as IntentType) ? parsed.intent : "UNKNOWN") as IntentType;
  const amount =
    typeof parsed.amount === "number" && Number.isFinite(parsed.amount) ? Math.round(parsed.amount) : extractAmount(transcript);
  return { intent, amount, isYes: parsed.isYes === true, isNo: parsed.isNo === true, transcript };
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fn(c.signal);
  } finally {
    clearTimeout(t);
  }
}

async function interpretWithSarvam(transcript: string, body: Body, key: string): Promise<Interpretation | null> {
  return withTimeout(async (signal) => {
    const res = await fetch("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: { "api-subscription-key": key, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: "sarvam-105b",
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `${ctxLine(body)}\nRider said: "${transcript}"` },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content;
    return text ? parseModelJson(text, transcript) : null;
  }, 7000);
}

async function interpretWithGemini(transcript: string, body: Body, key: string): Promise<Interpretation | null> {
  return withTimeout(async (signal) => {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${SYSTEM}\n${ctxLine(body)}\nRider said: "${transcript}"` }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? parseModelJson(text, transcript) : null;
  }, 6000);
}
