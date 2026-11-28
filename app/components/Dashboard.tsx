"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Order, OrderStatus, GeoPoint } from "@/lib/types";
import { CONFIDENCE_FLOOR, CLIENT_INTENTS, type Decision, type IntentType } from "@/lib/intents";
import VoxButton, { type VoiceState } from "./VoxButton";
import DecisionPanel, { type Metrics, type TraceEntry } from "./DecisionPanel";
import RideMap from "./RideMap";
import RequestCard from "./RequestCard";
import DevPanel from "./DevPanel";
import { useVoice } from "./useVoice";
import { useWakeWord } from "./useWakeWord";
import { useRideSim } from "./useRideSim";
import PlatformHeader from "./PlatformHeader";
import { PLATFORMS, type PlatformId } from "./platforms";

const PLATFORM_KEY = "vox.platform";

// Lifecycle stepper for the active ride.
const STEPS: { key: string; label: string }[] = [
  { key: "ACCEPTED", label: "Accepted" },
  { key: "NAVIGATING", label: "To pickup" },
  { key: "PICKED_UP", label: "Picked up" },
  { key: "NAVIGATING_DROP", label: "To drop" },
  { key: "DELIVERED", label: "Delivered" },
  { key: "PAID", label: "Paid" },
];
function stepIndex(status: OrderStatus | null): number {
  if (!status) return -1;
  const norm = status === "NAVIGATING_PICKUP" ? "NAVIGATING" : status;
  return STEPS.findIndex((s) => s.key === norm);
}

// Rough screen-tap cost each action would take in a normal rider app (for the
// "taps saved" counter in the judge panel).
const TAP_COST: Record<string, number> = {
  ACCEPT_ORDER: 2, REJECT_ORDER: 1, START_NAVIGATION: 2, MARK_PICKED_UP: 2, CALL_CUSTOMER: 3,
  MARK_DELIVERED: 2, RECORD_CASH: 4, NEXT_ORDER: 1, REPORT_HAZARD: 3, EMERGENCY: 3,
};

// A short incoming-request chime (WebAudio, no asset). Best-effort; respects autoplay.
function playChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((f, idx) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = now + idx * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.32);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {
    /* ignore */
  }
}

interface Props {
  hasGemini: boolean;
  hasSarvam: boolean;
  voiceProvider: string;
}

export default function Dashboard({ hasGemini, hasSarvam, voiceProvider }: Props) {
  const [order, setOrder] = useState<Order | null>(null);
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [feedback, setFeedback] = useState<string>("Go online to start receiving rides.");
  const [connected, setConnected] = useState(true);
  const [pendingConfirm, setPendingConfirm] = useState<{ intent: IntentType; amount: number; orderId?: string } | null>(null);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [voiceLang, setVoiceLang] = useState("en-IN");
  const [safety, setSafety] = useState<{ type: "EMERGENCY" | "HAZARD" } | null>(null);
  const [justPaid, setJustPaid] = useState<Order | null>(null); // briefly held completed ride
  const [simStt, setSimStt] = useState(false); // armed: next voice capture fails
  const [simNet, setSimNet] = useState(false); // armed: next engine call fails
  const sttFailRef = useRef(false);
  const netFailRef = useRef(false);
  const [platform, setPlatform] = useState<PlatformId>("rapido");
  const [wakeOn, setWakeOn] = useState(false);
  const [wakeSupported, setWakeSupported] = useState(false);

  const speech = useVoice();
  const busyRef = useRef(false);
  const voiceActiveRef = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paidTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeStopRef = useRef<() => void>(() => {});
  const voiceLangRef = useRef(voiceLang);
  voiceLangRef.current = voiceLang;
  const replyLangRef = useRef("en-IN");
  const traceId = useRef(0);

  // The in-flight ride (an AVAILABLE order is an offer, owned by the sim; a PAID
  // order is finished) — this is what the cockpit treats as the active ride.
  const activeOrder = order && order.status !== "AVAILABLE" && order.status !== "PAID" ? order : null;

  const pushTrace = useCallback((e: Omit<TraceEntry, "id" | "at">) => {
    setTrace((t) => [...t, { ...e, id: traceId.current++, at: Date.now() }].slice(-60));
  }, []);

  // Speak a system line (offer read-out, arrival cue) in the rider's language.
  const announce = useCallback(
    (text: string) => {
      if (!text) return;
      if (hasSarvam) void speech.speakSarvam(text, replyLangRef.current);
      else speech.speak(text, voiceLangRef.current);
    },
    [hasSarvam, speech]
  );

  const sim = useRideSim({
    activeOrder,
    onOffer: (o) => {
      playChime();
      setFeedback(`New request · ${o.pickup_name} → ${o.drop_name}`);
      announce(`New ride request. Pickup ${o.pickup_name}. Drop ${o.drop_name}. ${o.distance_km} kilometres. You earn ${o.earnings} rupees. Say accept or reject.`);
    },
    onArrive: (where, o) => {
      if (where === "pickup") {
        setFeedback(`Arrived at pickup · ${o.pickup_name}`);
        announce(`You've reached ${o.pickup_name}. Say pickup done when you have it.`);
      } else {
        setFeedback(`Arrived at drop · ${o.drop_name}`);
        announce(`You've reached ${o.drop_name}. Say delivered to complete the ride.`);
      }
    },
  });
  const simRef = useRef(sim);
  simRef.current = sim;

  // Restore platform skin + detect wake support after mount (no hydration mismatch).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PLATFORM_KEY);
      if (saved === "rapido" || saved === "zomato") setPlatform(saved);
    } catch {
      /* ignore */
    }
    setWakeSupported("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  }, []);

  // Apply platform brand colours as CSS variables + persist.
  useEffect(() => {
    const p = PLATFORMS[platform];
    const root = document.documentElement.style;
    root.setProperty("--accent", p.accent);
    root.setProperty("--accent-dim", p.accentDim);
    root.setProperty("--on-accent", p.onAccent);
    root.setProperty("--glow", p.glow);
    try {
      localStorage.setItem(PLATFORM_KEY, platform);
    } catch {
      /* ignore */
    }
  }, [platform]);

  // Recover an in-flight ride on reload (otherwise start clean/offline).
  useEffect(() => {
    fetch("/api/orders/current", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const o = d?.order as Order | undefined;
        if (o && o.status !== "AVAILABLE" && o.status !== "PAID") setOrder(o);
      })
      .catch(() => {});
  }, []);

  // Connectivity dot (browser flag + periodic health ping).
  useEffect(() => {
    const set = () => setConnected(navigator.onLine);
    set();
    window.addEventListener("online", set);
    window.addEventListener("offline", set);
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/health?strict=1", { cache: "no-store" });
        setConnected(r.ok);
      } catch {
        setConnected(false);
      }
    }, 30000);
    return () => {
      window.removeEventListener("online", set);
      window.removeEventListener("offline", set);
      clearInterval(id);
    };
  }, []);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    if (paidTimer.current) clearTimeout(paidTimer.current);
  }, []);

  // A hazard report is transient; an emergency stays until the rider dismisses it.
  useEffect(() => {
    if (safety?.type !== "HAZARD") return;
    const id = setTimeout(() => setSafety(null), 6000);
    return () => clearTimeout(id);
  }, [safety]);

  const flash = (state: VoiceState, ms: number) => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setVoice(state);
    resetTimer.current = setTimeout(() => setVoice("idle"), ms);
  };

  // Run one intent through the real engine (/api/intent). Targets a specific order
  // and sends the rider's CURRENT simulated GPS, so the geofence is genuinely checked.
  const send = useCallback(
    async (
      intent: IntentType,
      kind?: "geo" | "cash",
      opts?: { amount?: number; confirmed?: boolean; confidence?: number; transcript?: string; orderId?: string; source?: TraceEntry["source"]; language?: string }
    ): Promise<{ validation?: string; feedback?: string } | undefined> => {
      if (busyRef.current) return undefined;
      busyRef.current = true;
      if (resetTimer.current) clearTimeout(resetTimer.current);
      setVoice("processing");
      const body: Record<string, unknown> = { intent };
      if (opts?.orderId) body.orderId = opts.orderId;
      if (typeof opts?.confidence === "number") body.confidence = opts.confidence;
      if (opts?.transcript) body.transcript = opts.transcript;
      if (opts?.language) body.language = opts.language;
      // Real simulated GPS for the geofence check.
      if (kind === "geo") {
        const r = simRef.current.rider;
        body.riderLat = r.lat;
        body.riderLng = r.lng;
      }
      if (kind === "cash") {
        body.amount = opts?.amount ?? order?.cod_amount ?? 0;
        if (opts?.confirmed) body.confirmed = true;
      }
      try {
        // Simulated network failure (dev): fail BEFORE the fetch, so no state is
        // touched — the ride is provably unchanged. Recovers on the next attempt.
        if (netFailRef.current) {
          netFailRef.current = false;
          setSimNet(false);
          pushTrace({ source: opts?.source ?? "voice", transcript: opts?.transcript, intent,
            decision: { intent, orderId: opts?.orderId ?? null, statusBefore: activeOrder?.status ?? null, statusAfter: null, validation: "NOOP", action: "NETWORK_ERROR", feedback: "Network error — ride unchanged." } as Decision });
          setFeedback("Network error — ride unchanged. Try again.");
          flash("blocked", 1800);
          return { feedback: "Network error — ride unchanged. Try again." };
        }
        const r = await fetch("/api/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) {
          setFeedback(d.error ?? "Something went wrong.");
          flash("blocked", 1800);
          return { feedback: d.error ?? "Something went wrong." };
        }
        const dec = d.decision as Decision | undefined;
        pushTrace({ source: opts?.source ?? "voice", transcript: opts?.transcript, intent, language: dec?.language ?? opts?.language, confidence: dec?.confidence, decision: dec, latencyMs: typeof d.latencyMs === "number" ? d.latencyMs : undefined });
        setFeedback(dec?.feedback ?? "");
        if (dec?.validation === "CONFIRM_REQUIRED") {
          setPendingConfirm({ intent, amount: order?.cod_amount ?? 0, orderId: opts?.orderId });
          if (resetTimer.current) clearTimeout(resetTimer.current);
          setVoice("confirm");
          return { validation: "CONFIRM_REQUIRED", feedback: dec?.feedback };
        }
        setPendingConfirm(null);
        // A PAID order is already excluded from activeOrder, so the cockpit returns
        // to "searching" and the sim banks earnings + brings the next ride. We keep
        // `order` as-is until the next accept overwrites it (never shown while PAID).
        const newOrder = (d.order as Order | null) ?? null;
        setOrder(newOrder);
        // Hold the finished ride briefly so the judge sees the journey complete
        // (the "Paid" step lights up) before it returns to searching.
        if (newOrder?.status === "PAID") {
          setJustPaid(newOrder);
          if (paidTimer.current) clearTimeout(paidTimer.current);
          paidTimer.current = setTimeout(() => setJustPaid(null), 3600);
        }
        if (dec?.sideEffect?.type === "CALL" && dec.sideEffect.value) {
          window.location.href = `tel:${String(dec.sideEffect.value).replace(/[^+\d]/g, "")}`;
        }
        // Surface a distinct safety state (clearly simulated) for SOS / hazard.
        if (dec?.sideEffect?.type === "EMERGENCY") setSafety({ type: "EMERGENCY" });
        else if (dec?.sideEffect?.type === "HAZARD") setSafety({ type: "HAZARD" });
        flash(dec?.validation === "BLOCKED" ? "blocked" : "speaking", 1700);
        return { validation: dec?.validation, feedback: dec?.feedback };
      } catch {
        setFeedback("Network error — try again.");
        flash("blocked", 1800);
        return { feedback: "Network error — try again." };
      } finally {
        busyRef.current = false;
      }
    },
    [order, activeOrder, pushTrace]
  );

  const confirmCash = useCallback(async () => {
    if (!pendingConfirm) return undefined;
    const p = pendingConfirm;
    setPendingConfirm(null);
    return send(p.intent, "cash", { amount: p.amount, confirmed: true, orderId: p.orderId });
  }, [pendingConfirm, send]);

  const cancelConfirm = useCallback(() => {
    setPendingConfirm(null);
    setFeedback("Cancelled.");
    setVoice("idle");
  }, []);

  // A manual chip / button → same engine path as voice (never a bypass).
  const runCommand = useCallback(
    (intent: IntentType, kind?: "geo" | "cash") => {
      void send(intent, kind, { orderId: activeOrder?.id, source: "manual" });
    },
    [send, activeOrder]
  );

  // Accept / reject buttons mirror the voice path: await the engine BEFORE advancing
  // the offer, so a reject always lands an audit row (never a silent local drop).
  const acceptOffer = useCallback(() => {
    const o = simRef.current.offer;
    if (o) void send("ACCEPT_ORDER", undefined, { orderId: o.id, source: "manual" });
  }, [send]);
  const rejectOffer = useCallback(async () => {
    const o = simRef.current.offer;
    if (!o) return;
    await send("REJECT_ORDER", undefined, { orderId: o.id, source: "manual" });
    simRef.current.rejectOffer();
  }, [send]);

  // The shared tail of every voice interaction: interpret the transcript → route it
  // (client answer, offer accept/reject, or the engine) → speak back. Factored out
  // so BOTH real speech and an injected test utterance go through the exact same path.
  const processUtterance = useCallback(
    async (transcript: string, confidence: number, language: string | undefined) => {
      const replyLang = language ?? replyLangRef.current;
      if (language) replyLangRef.current = language;
      const sp = (t: string) => (hasSarvam ? speech.speakSarvam(t, replyLang) : speech.speak(t, voiceLangRef.current));

      if (!transcript.trim()) {
        setFeedback("I didn't catch that — say it again.");
        void sp("I didn't catch that. Please say it again.");
        flash("blocked", 1500);
        return;
      }
      setVoice("processing");
      setFeedback(`“${transcript}”`);

      let r: { intent?: string; amount?: number; isYes?: boolean; isNo?: boolean };
      try {
        const resp = await fetch("/api/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript, awaitingConfirm: !!pendingConfirm, status: activeOrder?.status }),
        });
        r = await resp.json();
      } catch {
        setFeedback("Couldn't understand — try again.");
        void sp("Say that again, please.");
        flash("blocked", 1600);
        return;
      }

      // Answering a cash read-back.
      if (pendingConfirm) {
        if (r.isNo) {
          cancelConfirm();
          void sp("Cancelled.");
          return;
        }
        if (r.isYes) {
          const res = await confirmCash();
          void sp(res?.feedback ?? "Recorded.");
          return;
        }
        setFeedback("Please say yes or no to confirm.");
        void sp("Please say yes or no to confirm.");
        setVoice("confirm");
        return;
      }

      // Low confidence or genuinely unclear → ask again, never act. Logged to the
      // trace as a real NOOP/CLARIFY decision (this is the misheard-recovery proof).
      if (!r.intent || r.intent === "UNKNOWN" || confidence < CONFIDENCE_FLOOR) {
        const intent = (r.intent as IntentType) || "UNKNOWN";
        pushTrace({
          source: "voice", transcript, intent, language, confidence,
          decision: { intent, language, confidence, orderId: activeOrder?.id ?? null, statusBefore: activeOrder?.status ?? null, statusAfter: null, validation: "NOOP", action: "CLARIFY", feedback: "I didn't catch that — say it again." },
        });
        setFeedback("I didn't catch that — say it again.");
        void sp("I didn't catch that. Please say it again.");
        flash("blocked", 1600);
        return;
      }

      const intent = r.intent as IntentType;
      const s = simRef.current;

      // Client-handled intents (no engine state change).
      if (CLIENT_INTENTS.has(intent)) {
        let answer = "";
        if (intent === "GO_ONLINE") {
          if (!s.online) {
            s.goOnline();
            answer = "You're online. Looking for ride requests.";
          } else {
            answer = "You're already online.";
          }
        } else if (intent === "QUERY_EARNINGS") {
          answer = `You've earned ${s.earnings} rupees across ${s.rides} ${s.rides === 1 ? "ride" : "rides"} today.`;
        } else if (intent === "QUERY_DISTANCE") {
          answer =
            s.distanceToTargetM != null
              ? `The ${s.navTarget === "pickup" ? "pickup" : "drop"} is ${(s.distanceToTargetM / 1000).toFixed(1)} kilometres away${s.etaMin ? `, about ${s.etaMin} minutes` : ""}.`
              : "There's no active navigation right now.";
        } else if (intent === "CANCEL_RIDE") {
          if (s.offer) {
            s.rejectOffer();
            answer = "Request cancelled. Finding your next ride.";
          } else if (activeOrder) {
            answer = "You're mid-ride — finish or report an issue; I won't cancel it.";
          } else {
            answer = "There's nothing to cancel.";
          }
        }
        setFeedback(answer);
        pushTrace({ source: "voice", transcript, intent, language, answer });
        void sp(answer);
        flash("speaking", 1600);
        return;
      }

      // Accept / reject the current request (targets the offered order).
      if (intent === "ACCEPT_ORDER") {
        if (!s.offer) {
          setFeedback("There's no ride request to accept.");
          void sp("There's no ride request right now.");
          flash("blocked", 1500);
          return;
        }
        const res = await send("ACCEPT_ORDER", undefined, { orderId: s.offer.id, confidence, transcript, language });
        void sp(res?.feedback ?? "");
        return;
      }
      if (intent === "REJECT_ORDER") {
        if (!s.offer) {
          setFeedback("There's no request to reject.");
          void sp("There's no ride request right now.");
          flash("blocked", 1500);
          return;
        }
        const res = await send("REJECT_ORDER", undefined, { orderId: s.offer.id, confidence, transcript, language });
        s.rejectOffer();
        void sp(res?.feedback ?? "Finding your next ride.");
        return;
      }

      // Everything else runs against the active ride through the engine.
      const kind = intent === "MARK_DELIVERED" ? "geo" : intent === "RECORD_CASH" ? "cash" : undefined;
      const opts: { amount?: number; confidence?: number; transcript?: string; orderId?: string; language?: string } = {
        confidence, transcript, orderId: activeOrder?.id, language,
      };
      if (intent === "RECORD_CASH" && typeof r.amount === "number") opts.amount = r.amount;
      const res = await send(intent, kind, opts);
      void sp(res?.feedback ?? "");
    },
    [hasSarvam, speech, pendingConfirm, activeOrder, send, confirmCash, cancelConfirm, pushTrace]
  );

  // Push-to-talk (and wake): listen on the mic, then run the shared pipeline.
  const handleVoice = useCallback(async () => {
    if (voice === "listening") {
      if (hasSarvam) speech.stopRecording();
      return;
    }
    if (voice === "processing" || busyRef.current || voiceActiveRef.current) return;
    if (!hasSarvam && !speech.isSupported) {
      setFeedback("Voice isn't available in this browser — use the controls below.");
      flash("blocked", 1800);
      return;
    }
    voiceActiveRef.current = true;
    try {
      // Simulated STT failure (dev): the capture "fails" — recover via retry/manual.
      if (sttFailRef.current) {
        sttFailRef.current = false;
        setSimStt(false);
        setFeedback("Couldn't hear you (simulated) — tap VOX to retry, or use manual controls.");
        if (hasSarvam) void speech.speakSarvam("I couldn't hear you. Please try again.", replyLangRef.current);
        else speech.speak("I couldn't hear you. Please try again.", voiceLangRef.current);
        flash("blocked", 1700);
        return;
      }
      let heard: { transcript: string; confidence: number; language?: string };
      try {
        wakeStopRef.current();
        setVoice("listening");
        heard = hasSarvam ? await speech.listenSarvam() : await speech.listen(voiceLang);
      } catch {
        setFeedback("Didn't hear anything — tap VOX and speak.");
        setVoice("idle");
        return;
      }
      await processUtterance(heard.transcript, heard.confidence, heard.language);
    } finally {
      voiceActiveRef.current = false;
    }
  }, [voice, hasSarvam, speech, voiceLang, processUtterance]);

  // Inject a realistic noisy/ambiguous utterance through the SAME pipeline (dev) —
  // so misheard-recovery is demoable on demand, not left to chance.
  const simulateNoisy = useCallback(() => {
    if (busyRef.current || voiceActiveRef.current || voice === "listening" || voice === "processing") return;
    const phrases = ["uh, the, you know, that one", "umm... can you... the thing", "hmm, [static] ... go", "... take the ... er"];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    wakeStopRef.current();
    voiceActiveRef.current = true;
    void processUtterance(phrase, 0.35, undefined).finally(() => {
      voiceActiveRef.current = false;
    });
  }, [voice, processUtterance]);

  const toggleSimStt = useCallback(() => setSimStt((v) => { const n = !v; sttFailRef.current = n; return n; }), []);
  const toggleSimNet = useCallback(() => setSimNet((v) => { const n = !v; netFailRef.current = n; return n; }), []);

  useWakeWord(wakeOn && wakeSupported && voice === "idle", handleVoice, wakeStopRef);

  const curStep = stepIndex(activeOrder?.status ?? null);

  // Metrics from the engine-decided trace entries.
  const decided = trace.filter((e) => e.decision);
  const executed = decided.filter((e) => e.decision!.validation === "PASSED");
  const lats = decided.map((e) => e.latencyMs).filter((n): n is number => typeof n === "number");
  const metrics: Metrics = {
    total: decided.length,
    executed: executed.length,
    blocked: decided.filter((e) => e.decision!.validation === "BLOCKED").length,
    confirms: decided.filter((e) => e.decision!.validation === "CONFIRM_REQUIRED").length,
    lastLatency: lats.length ? lats[lats.length - 1] : null,
    avgLatency: lats.length ? Math.round(lats.reduce((s, n) => s + n, 0) / lats.length) : null,
    tapsOldWay: executed.reduce((s, e) => s + (TAP_COST[e.intent] ?? 2), 0),
  };

  const busy = voice === "processing"; // re-renders (unlike the busyRef used for guards)
  const plat = PLATFORMS[platform];
  const pickup: GeoPoint | null = activeOrder ? { lat: activeOrder.pickup_lat, lng: activeOrder.pickup_lng } : null;
  const drop: GeoPoint | null = activeOrder ? { lat: activeOrder.drop_lat, lng: activeOrder.drop_lng } : null;

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh", padding: 16, paddingBottom: 72, display: "flex", flexDirection: "column", gap: 12 }}>
      <PlatformHeader platform={plat} onSwitch={setPlatform} online={sim.online && connected} onTrip={!!activeOrder} />

      {/* Rider status bar */}
      <section style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "8px 12px" }}>
        <button
          onClick={() => (sim.online ? sim.goOffline() : sim.goOnline())}
          style={{ padding: "7px 14px", borderRadius: 999, cursor: "pointer", fontSize: 12, fontWeight: 800,
            background: sim.online ? "var(--accent)" : "var(--surface-2)", color: sim.online ? "var(--on-accent)" : "var(--text)", border: sim.online ? "none" : "1px solid var(--border)" }}
        >
          {sim.online ? "● Online" : "Go Online"}
        </button>
        <div style={{ flex: 1 }} />
        <Stat label="Earnings" value={`₹${sim.earnings}`} accent />
        <Stat label="Rides" value={`${sim.rides}`} />
        <Stat label="Rating" value="4.9★" />
      </section>

      {/* Safety state — SOS / road hazard (clearly simulated) */}
      {safety && (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: 12, padding: "12px 14px",
          background: safety.type === "EMERGENCY" ? "rgba(255,89,100,0.16)" : "rgba(245,166,35,0.14)",
          border: `1px solid ${safety.type === "EMERGENCY" ? "var(--danger)" : "var(--warn)"}`,
          animation: safety.type === "EMERGENCY" ? "voxblink 1s ease-in-out infinite" : "voxrise 200ms ease" }}>
          <span style={{ fontSize: 22 }}>{safety.type === "EMERGENCY" ? "🆘" : "⚠️"}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: safety.type === "EMERGENCY" ? "var(--danger)" : "var(--warn)" }}>
              {safety.type === "EMERGENCY" ? "Emergency alert sent" : "Road hazard reported"}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              {safety.type === "EMERGENCY" ? "Support team + emergency contact notified · simulated for demo" : "Nearby riders warned on this route · simulated for demo"}
            </div>
          </div>
          <button onClick={() => setSafety(null)} aria-label="Dismiss alert"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 13 }}>✕</button>
        </div>
      )}

      {!hasSarvam && (
        <div style={{ fontSize: 11, color: "var(--warn)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 10px" }}>
          {!hasGemini && <strong>🔑 Demo mode (keyless) — browser speech + rule understanding. </strong>}
          {voiceProvider}. Add SARVAM_API_KEY for natural Hindi/Kannada voice
          {!hasGemini ? " · GEMINI_API_KEY for smarter understanding" : ""}.
        </div>
      )}

      {/* Map */}
      <RideMap rider={sim.rider} pickup={pickup} drop={drop} pickupName={activeOrder?.pickup_name} dropName={activeOrder?.drop_name} navTarget={sim.navTarget} active={!!activeOrder} />

      {/* Navigation info (when a leg is active) */}
      {activeOrder && sim.navTarget && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px" }}>
          <span style={{ fontSize: 20 }}>🧭</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {sim.moving ? "Navigating to" : "Arrived at"} {sim.navTarget === "pickup" ? activeOrder.pickup_name : activeOrder.drop_name}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              {sim.distanceToTargetM != null ? `${sim.distanceToTargetM >= 1000 ? (sim.distanceToTargetM / 1000).toFixed(1) + " km" : sim.distanceToTargetM + " m"}` : "—"}
              {sim.etaMin ? ` · ~${sim.etaMin} min` : ""}
              {sim.moving ? ` · ${sim.speedMult}× sim` : ""}
            </div>
          </div>
        </div>
      )}

      {/* Context panel — changes with the journey phase */}
      {sim.phase === "OFFER" && sim.offer ? (
        <RequestCard
          offer={sim.offer}
          secsLeft={sim.offerSecsLeft}
          total={22}
          onAccept={acceptOffer}
          onReject={() => void rejectOffer()}
          disabled={busy}
        />
      ) : activeOrder ? (
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Active ride · {activeOrder.id}</span>
            <span style={{ fontSize: 12, color: "var(--accent)" }}>{activeOrder.status.replace(/_/g, " ")}</span>
          </div>
          {/* Stepper */}
          <div style={{ display: "flex", gap: 4, margin: "12px 0" }} aria-label="Ride progress">
            {STEPS.map((s, idx) => (
              <div key={s.key} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ height: 4, borderRadius: 2, background: idx <= curStep ? "var(--accent)" : "var(--border)" }} />
                <div style={{ fontSize: 9, marginTop: 4, color: idx === curStep ? "var(--accent)" : "var(--muted)" }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Drop</div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{activeOrder.drop_name}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Earn</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--accent)" }}>₹{activeOrder.earnings}</div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, background: "var(--surface-2)", borderRadius: 10, padding: "8px 12px" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Collect (COD)</span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>₹{activeOrder.cod_amount}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>Customer: {activeOrder.customer_name}</div>
        </section>
      ) : justPaid ? (
        <section style={{ background: "var(--surface)", border: "1px solid var(--accent)", borderRadius: 14, padding: 16, animation: "voxrise 200ms ease" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 22 }}>✅</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>Ride complete</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{justPaid.drop_name} · ₹{justPaid.cod_amount} collected</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--accent)" }}>+₹{justPaid.earnings}</div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>earned</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4 }} aria-label="Ride progress — complete">
            {STEPS.map((s) => (
              <div key={s.key} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ height: 4, borderRadius: 2, background: "var(--accent)" }} />
                <div style={{ fontSize: 9, marginTop: 4, color: s.key === "PAID" ? "var(--accent)" : "var(--muted)" }}>{s.label}</div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, textAlign: "center" }}>
          {sim.phase === "OFFLINE" ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>You're offline</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>Go online to start receiving ride requests — tap below or say “go online”.</div>
              <button onClick={sim.goOnline} style={{ padding: "12px 28px", borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--on-accent)", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
                Go Online
              </button>
            </>
          ) : sim.phase === "NO_RIDES" ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>No more rides in this demo. Reset the scenario in the dev panel to run it again.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700, animation: "voxblink 1.4s ease-in-out infinite" }}>Looking for rides…</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>A request will arrive shortly.</div>
            </div>
          )}
        </section>
      )}

      {/* Spoken feedback line */}
      <div role="status" aria-live="polite" style={{ minHeight: 20, fontSize: 13, color: voice === "blocked" ? "var(--danger)" : "var(--text)", textAlign: "center" }}>
        {feedback}
      </div>

      {/* Hey VOX toggle */}
      {wakeSupported && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              Hey VOX — hands-free
              {wakeOn && voice === "idle" && <span style={{ color: "var(--accent)", fontSize: 11, fontWeight: 700 }}>● listening</span>}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Best-effort — may miss or misfire; while on, the mic streams to the browser&apos;s speech service. Tap-to-talk is always reliable.</div>
          </div>
          <button role="switch" aria-checked={wakeOn} aria-label="Toggle Hey VOX hands-free" onClick={() => setWakeOn((v) => !v)}
            style={{ width: 46, height: 26, borderRadius: 999, border: "none", cursor: "pointer", background: wakeOn ? "var(--accent)" : "var(--border)", position: "relative", transition: "background 160ms ease", flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 3, left: wakeOn ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 160ms ease" }} />
          </button>
        </div>
      )}

      {/* VOX button + SOS */}
      <section style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 20, padding: "6px 0" }}>
        <VoxButton state={voice} onPress={handleVoice} disabled={voice === "processing"} idleHint={wakeOn && wakeSupported ? 'or say "Hey VOX"' : "tap to speak"} />
        <button
          aria-label="Emergency SOS"
          onClick={() => void send("EMERGENCY", undefined, { source: "manual" })}
          style={{ width: 64, height: 64, borderRadius: "50%", border: "1px solid var(--danger)", background: "rgba(255,89,100,0.12)", color: "var(--danger)", fontSize: 13, fontWeight: 800, cursor: "pointer" }}
        >
          SOS
        </button>
      </section>

      {/* Read-back confirmation for cash */}
      {pendingConfirm && (
        <section style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", border: "1px solid var(--warn)", borderRadius: 12, padding: "10px 12px" }}>
          <span style={{ flex: 1, fontSize: 13 }}>Collected ₹{pendingConfirm.amount}?</span>
          <button onClick={confirmCash} disabled={busy} style={{ padding: "8px 16px", borderRadius: 9, border: "none", background: "var(--accent)", color: "var(--on-accent)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Yes</button>
          <button onClick={cancelConfirm} disabled={busy} style={{ padding: "8px 16px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>No</button>
        </section>
      )}

      {hasSarvam ? (
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>🎙 Speak any language — Kannada, Hindi, English, mixed (auto-detected).</div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12 }}>
          <span style={{ color: "var(--muted)" }}>🎙 Voice:</span>
          {([["en-IN", "EN"], ["hi-IN", "हिं"], ["kn-IN", "ಕನ್ನಡ"]] as const).map(([code, label]) => (
            <button key={code} onClick={() => setVoiceLang(code)} aria-pressed={voiceLang === code}
              style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${voiceLang === code ? "var(--accent)" : "var(--border)"}`, background: voiceLang === code ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "var(--surface-2)", color: voiceLang === code ? "var(--accent)" : "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Developer / simulation controls */}
      <DevPanel
        sim={sim}
        order={activeOrder}
        onCommand={runCommand}
        canCommand={voice !== "listening" && voice !== "processing"}
        scenarios={{ onNoisy: simulateNoisy, stt: simStt, net: simNet, toggleStt: toggleSimStt, toggleNet: toggleSimNet }}
      />

      {/* Judge trace */}
      <button onClick={() => setPanelOpen(true)} aria-label="Open VOX trace panel"
        style={{ position: "fixed", right: 14, bottom: 14, zIndex: 40, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 999, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.4)" }}>
        📊 VOX Trace{metrics.tapsOldWay ? ` · ~${metrics.tapsOldWay} saved` : ""}
      </button>
      <DecisionPanel trace={trace} metrics={metrics} open={panelOpen} onClose={() => setPanelOpen(false)} />
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: accent ? "var(--accent)" : "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--muted)" }}>{label}</div>
    </div>
  );
}
