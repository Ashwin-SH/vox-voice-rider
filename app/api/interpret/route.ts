import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { interpret, extractAmount, type Interpretation } from "@/lib/interpret";
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

// POST /api/interpret — turn a (multilingual) transcript into a structured intent.
// With GEMINI_API_KEY the model does the understanding ("thinks" about meaning);
// with no key it uses the deterministic rule interpreter. The key never leaves
// the server. Any Gemini failure falls back to the rules so the path never dies.
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const transcript = (body.transcript ?? "").trim().slice(0, 500);
  if (!transcript) return jsonError("Missing 'transcript'", 400);

  const key = process.env.GEMINI_API_KEY?.trim();
  if (key) {
    try {
      const g = await interpretWithGemini(transcript, body, key);
      if (g) return NextResponse.json({ ...g, source: "gemini", transcript });
    } catch (e) {
      console.error("[interpret] gemini failed, falling back to rules:", e);
    }
  }
  const r = interpret(transcript, { awaitingConfirm: body.awaitingConfirm });
  return NextResponse.json({ ...r, source: "rules" });
}

async function interpretWithGemini(transcript: string, body: Body, key: string): Promise<Interpretation | null> {
  const prompt = `You are the intent parser for VOX, a hands-free assistant for Indian delivery riders.
The rider spoke (English, Hindi, Kannada, or mixed/Hinglish). Understand the MEANING, not exact words.
Current order status: ${body.status ?? "unknown"}.
${body.awaitingConfirm ? "The rider is answering a yes/no read-back to confirm a cash amount." : ""}

Rider said: "${transcript}"

Return ONLY JSON with this shape:
{"intent": one of ${JSON.stringify(INTENTS)}, "amount": number (rupees, only for cash), "isYes": boolean, "isNo": boolean}
Use UNKNOWN if unclear. Only include amount/isYes/isNo when relevant.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    const parsed = JSON.parse(text) as Partial<Interpretation>;
    const intent = (INTENTS.includes(parsed.intent as IntentType) ? parsed.intent : "UNKNOWN") as IntentType;
    const amount =
      typeof parsed.amount === "number" && Number.isFinite(parsed.amount) ? Math.round(parsed.amount) : extractAmount(transcript);
    return { intent, amount, isYes: parsed.isYes === true, isNo: parsed.isNo === true, transcript };
  } finally {
    clearTimeout(timer);
  }
}
