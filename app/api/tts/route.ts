import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/tts { text, lang } -> Sarvam Bulbul audio (WAV). Server-side key.
// 503 when no key, so the client falls back to the browser's speech synthesis.
export async function POST(request: Request) {
  const key = process.env.SARVAM_API_KEY?.trim();
  if (!key) return jsonError("Sarvam not configured", 503);
  let body: { text?: string; lang?: string };
  try {
    body = (await request.json()) as { text?: string; lang?: string };
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  let text = (body.text ?? "").trim().slice(0, 500);
  const lang = body.lang ?? "en-IN";
  if (!text) return jsonError("Missing 'text'", 400);
  // Reply in the rider's language: translate the English feedback first (keep
  // English on any failure), then speak it. So Kannada in -> Kannada out.
  if (lang !== "en-IN") {
    try {
      const tr = await fetch("https://api.sarvam.ai/translate", {
        method: "POST",
        headers: { "api-subscription-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ input: text, source_language_code: "en-IN", target_language_code: lang, model: "sarvam-translate:v1" }),
      });
      if (tr.ok) {
        const td = (await tr.json()) as { translated_text?: string };
        if (td.translated_text) text = td.translated_text;
      }
    } catch {
      /* keep English */
    }
  }
  try {
    const res = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: { "api-subscription-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, target_language_code: lang, speaker: "priya", model: "bulbul:v3" }),
    });
    if (!res.ok) return jsonError("TTS failed", 502, await res.text());
    const data = (await res.json()) as { audios?: string[] };
    const b64 = data.audios?.[0];
    if (!b64) return jsonError("No audio returned", 502);
    return new NextResponse(Buffer.from(b64, "base64"), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError("TTS error", 502, e);
  }
}
