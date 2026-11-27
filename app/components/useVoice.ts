"use client";

import { useCallback, useRef } from "react";

export interface VoiceResult {
  transcript: string;
  confidence: number;
}

// Pick a file extension that matches what MediaRecorder actually produced
// (Chrome/Firefox → webm, Safari → mp4), so Sarvam gets a correctly labelled file.
function extForType(type: string): string {
  if (type.includes("mp4") || type.includes("aac")) return "mp4";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("wav")) return "wav";
  return "webm";
}

// Browser speech (keyless) + a Sarvam path (keyed). Everything is defensive: any
// failure rejects/falls back so the UI never wedges and the keyless path survives.
export function useVoice() {
  const recogRef = useRef<SpeechRecognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

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

  // --- Sarvam path (used when the server has SARVAM_API_KEY) ---------------
  // Record the mic → /api/stt (Sarvam Saarika). Auto-stops after `maxMs`;
  // stopRecording() ends it early. A watchdog guarantees the promise always
  // settles (so the UI can't hang at "listening" if the mic prompt is ignored).
  const listenSarvam = useCallback((maxMs = 6000): Promise<VoiceResult> => {
    return new Promise((resolve, reject) => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        reject(new Error("recording-unsupported"));
        return;
      }
      let settled = false;
      const finish = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };
      // Watchdog: covers a mic prompt left open / getUserMedia never resolving.
      const watchdog = setTimeout(() => finish(() => reject(new Error("mic-timeout"))), maxMs + 15000);

      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
          let rec: MediaRecorder;
          try {
            rec = new MediaRecorder(stream);
          } catch (err) {
            clearTimeout(watchdog);
            stopTracks();
            finish(() => reject(err instanceof Error ? err : new Error("recorder-failed")));
            return;
          }
          recorderRef.current = rec;
          const chunks: BlobPart[] = [];
          rec.ondataavailable = (e) => {
            if (e.data.size) chunks.push(e.data);
          };
          rec.onstop = async () => {
            clearTimeout(watchdog);
            stopTracks();
            const type = rec.mimeType || "audio/webm";
            const blob = new Blob(chunks, { type });
            if (!blob.size) {
              finish(() => reject(new Error("no-audio")));
              return;
            }
            try {
              const fd = new FormData();
              fd.append("file", blob, `audio.${extForType(type)}`);
              const res = await fetch("/api/stt", { method: "POST", body: fd });
              if (!res.ok) {
                finish(() => reject(new Error("stt-failed")));
                return;
              }
              const d = (await res.json()) as { transcript?: string; confidence?: number };
              finish(() => resolve({ transcript: d.transcript ?? "", confidence: typeof d.confidence === "number" ? d.confidence : 0.9 }));
            } catch (err) {
              finish(() => reject(err instanceof Error ? err : new Error("stt-error")));
            }
          };
          try {
            rec.start();
          } catch (err) {
            clearTimeout(watchdog);
            stopTracks();
            finish(() => reject(err instanceof Error ? err : new Error("start-failed")));
            return;
          }
          setTimeout(() => {
            try {
              if (rec.state !== "inactive") rec.stop();
            } catch {
              /* ignore */
            }
          }, maxMs);
        })
        .catch((err) => {
          clearTimeout(watchdog);
          finish(() => reject(err instanceof Error ? err : new Error("mic-denied")));
        });
    });
  }, []);

  const stopRecording = useCallback(() => {
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    } catch {
      /* ignore */
    }
  }, []);

  // Speak via Sarvam Bulbul (natural Indian voice); fall back to the browser.
  const speakSarvam = useCallback(
    async (text: string, lang: string) => {
      if (!text) return;
      let url: string | null = null;
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, lang }),
        });
        if (!res.ok) throw new Error("tts-failed");
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        const u = url;
        const audio = new Audio(u);
        audio.onended = () => URL.revokeObjectURL(u);
        audio.onerror = () => URL.revokeObjectURL(u);
        await audio.play();
      } catch {
        if (url) URL.revokeObjectURL(url);
        speak(text, lang); // browser synthesis fallback
      }
    },
    [speak]
  );

  return { isSupported, listen, stop, speak, listenSarvam, stopRecording, speakSarvam };
}
