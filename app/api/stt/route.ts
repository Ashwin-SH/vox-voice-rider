import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/stt (multipart: file) -> Sarvam Saarika transcript. Server-side key.
// 503 when no key, so the client falls back to the browser's Web Speech.
export async function POST(request: Request) {
  const key = process.env.SARVAM_API_KEY?.trim();
  if (!key) return jsonError("Sarvam not configured", 503);
  let file: FormDataEntryValue | null;
  try {
    const form = await request.formData();
    file = form.get("file");
  } catch {
    return jsonError("Expected multipart form with 'file'", 400);
  }
  if (!(file instanceof Blob)) return jsonError("Missing audio 'file'", 400);
  try {
    const fd = new FormData();
    // Preserve the client's filename/extension so Sarvam sees the right container
    // (Chrome/Firefox send webm, Safari sends mp4).
    const name = file instanceof File && file.name ? file.name : "audio.webm";
    fd.append("file", file, name);
    fd.append("model", "saarika:v2.5");
    const res = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": key },
      body: fd,
    });
    if (!res.ok) return jsonError("STT failed", 502, await res.text());
    const data = (await res.json()) as { transcript?: string; language_code?: string; language_probability?: number };
    return NextResponse.json({
      transcript: data.transcript ?? "",
      language: data.language_code ?? null,
      // NOTE: Sarvam returns language-detection probability, not ASR confidence —
      // used only as a coarse floor; a garbage transcript is caught by the
      // interpreter returning UNKNOWN ("say it again").
      confidence: typeof data.language_probability === "number" ? data.language_probability : 0.9,
    });
  } catch (e) {
    return jsonError("STT error", 502, e);
  }
}
