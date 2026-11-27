"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

// Best-effort "Hey VOX" wake word (keyless — uses the browser's SpeechRecognition).
// HONEST LIMITS, surfaced in the UI: a browser tab can't always-listen like a phone
// OS, so this can misfire or miss, and the browser ends the session periodically
// (we restart it) and whenever the tab is hidden (we pause — no battery drain in the
// background). Tap-to-talk stays the reliable path.
//
// `active` is computed by the caller as (toggle on && supported && VOX is idle), so
// the whole listener tears down the moment a real interaction starts — a wake
// session never fights tap-to-talk for the mic. When the interaction ends and VOX
// returns to idle, `active` flips true again and the effect restarts cleanly.
//
// `stopRef` (optional) is populated with a synchronous abort so a caller can release
// the mic in the SAME tick it starts its own recognition (tap-to-talk), instead of
// waiting for React's deferred effect cleanup.
export function useWakeWord(
  active: boolean,
  onWake: () => void,
  stopRef?: MutableRefObject<() => void>
) {
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  useEffect(() => {
    if (!active) return;
    const Ctor =
      (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
    if (!Ctor) return;

    // Common mishears of "Hey VOX" — generous, since a false reject is worse than an
    // occasional false accept (the rider just sees VOX start listening).
    const PHRASES = ["hey vox", "hey box", "hey fox", "hey vlogs", "hey walks", "hi vox", "hey voss", "hey vaux", "a vox", "hevox", "heyvox"];

    let rec: SpeechRecognition | null = null;
    let stopped = false;
    let fired = false;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;

    const start = () => {
      if (stopped || fired || document.hidden) return;
      // Clear any pending restart and abort a lingering session FIRST, so two
      // recognition instances never hold the mic at once (e.g. visibility flapping).
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      if (rec) {
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
        rec = null;
      }
      let r: SpeechRecognition;
      try {
        r = new Ctor();
      } catch {
        return;
      }
      rec = r;
      r.lang = "en-IN";
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.onresult = (e: SpeechRecognitionEvent) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const txt = (e.results[i]?.[0]?.transcript ?? "").toLowerCase();
          if (PHRASES.some((p) => txt.includes(p))) {
            if (fired) return;
            fired = true; // one-shot; `active` goes false on wake, tearing this down
            try {
              r.stop();
            } catch {
              /* ignore */
            }
            onWakeRef.current();
            return;
          }
        }
      };
      r.onerror = (ev: SpeechRecognitionErrorEvent) => {
        // Mic permission denied / unavailable → stop retrying (avoid a hot loop).
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") stopped = true;
      };
      r.onend = () => {
        // Only the CURRENT session restarts; a stale session's onend (e.g. the one we
        // just aborted) is ignored, so there's no runaway/overlapping restart loop.
        if (rec === r && !stopped && !fired && !document.hidden) {
          restartTimer = setTimeout(start, 500);
        }
      };
      try {
        r.start();
      } catch {
        /* start() throws if a session is already live; ignore */
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (restartTimer) {
          clearTimeout(restartTimer);
          restartTimer = null;
        }
        try {
          rec?.abort();
        } catch {
          /* ignore */
        }
      } else {
        start();
      }
    };

    // Synchronous release for a caller about to start its own recognition.
    if (stopRef) {
      stopRef.current = () => {
        if (restartTimer) {
          clearTimeout(restartTimer);
          restartTimer = null;
        }
        try {
          rec?.abort();
        } catch {
          /* ignore */
        }
        rec = null;
      };
    }

    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        rec?.abort();
      } catch {
        /* ignore */
      }
      rec = null;
      if (stopRef) stopRef.current = () => {};
    };
  }, [active, stopRef]);
}
