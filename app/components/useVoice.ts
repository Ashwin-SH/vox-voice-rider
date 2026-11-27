"use client";

import { useCallback, useRef } from "react";

export interface VoiceResult {
  transcript: string;
  confidence: number;
}

// Thin wrapper over the browser's built-in speech APIs — the keyless path that
// works on any machine with no keys. Everything is defensive: if speech isn't
// supported, listen() rejects and the UI falls back to the command chips.
export function useVoice() {
  const recogRef = useRef<SpeechRecognition | null>(null);

  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) &&
    "speechSynthesis" in window;

  const listen = useCallback((lang: string): Promise<VoiceResult> => {
    return new Promise((resolve, reject) => {
      const Ctor =
        (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ??
        (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
      if (!Ctor) {
        reject(new Error("speech-recognition-unsupported"));
        return;
      }
      const r = new Ctor();
      recogRef.current = r;
      r.lang = lang;
      r.interimResults = false;
      r.maxAlternatives = 1;
      r.continuous = false;
      let settled = false;
      r.onresult = (e: SpeechRecognitionEvent) => {
        settled = true;
        const best = e.results[0]?.[0];
        resolve({
          transcript: best?.transcript ?? "",
          // Chrome gives a confidence; some engines return 0 — treat missing/0 as
          // trusted so we don't falsely trigger the low-confidence re-ask.
          confidence: best && typeof best.confidence === "number" && best.confidence > 0 ? best.confidence : 0.9,
        });
      };
      r.onerror = (e: SpeechRecognitionErrorEvent) => {
        if (!settled) reject(new Error(e.error || "speech-error"));
      };
      r.onend = () => {
        if (!settled) reject(new Error("no-speech"));
      };
      try {
        r.start();
      } catch (err) {
        reject(err instanceof Error ? err : new Error("speech-start-failed"));
      }
    });
  }, []);

  const stop = useCallback(() => {
    try {
      recogRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const speak = useCallback((text: string, lang: string) => {
    try {
      const synth = window.speechSynthesis;
      if (!synth || !text) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 1.0;
      synth.speak(u);
    } catch {
      /* ignore */
    }
  }, []);

  return { isSupported, listen, stop, speak };
}
