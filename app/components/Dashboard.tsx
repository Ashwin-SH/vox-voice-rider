"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Order, OrderStatus } from "@/lib/types";
import type { Decision, IntentType } from "@/lib/intents";
import VoxButton, { type VoiceState } from "./VoxButton";
import DecisionPanel, { type Metrics } from "./DecisionPanel";

// Lifecycle shown as a stepper. NAVIGATING_PICKUP sits at "Navigating" (before
// pickup); NAVIGATING_DROP maps to "Picked up" so the bar never regresses when
// the rider starts navigating to the drop after collecting the parcel.
const STEPS: { key: string; label: string }[] = [
  { key: "AVAILABLE", label: "Available" },
  { key: "ACCEPTED", label: "Accepted" },
  { key: "NAVIGATING", label: "Navigating" },
  { key: "PICKED_UP", label: "Picked up" },
  { key: "DELIVERED", label: "Delivered" },
  { key: "PAID", label: "Paid" },
];
function stepIndex(status: OrderStatus | null): number {
  if (!status) return -1;
  const norm =
    status === "NAVIGATING_PICKUP" ? "NAVIGATING" : status === "NAVIGATING_DROP" ? "PICKED_UP" : status;
  return STEPS.findIndex((s) => s.key === norm);
}

// Tap commands = the typed-command fallback (voice drives these in Part 5).
const COMMANDS: { intent: IntentType; label: string; kind?: "geo" | "cash" }[] = [
  { intent: "ACCEPT_ORDER", label: "Accept" },
  { intent: "START_NAVIGATION", label: "Navigate" },
  { intent: "MARK_PICKED_UP", label: "Picked up" },
  { intent: "CALL_CUSTOMER", label: "Call" },
  { intent: "MARK_DELIVERED", label: "Deliver", kind: "geo" },
  { intent: "RECORD_CASH", label: "Cash", kind: "cash" },
  { intent: "NEXT_ORDER", label: "Next" },
];

// Rough screen-tap cost each command would take in a normal rider app — used
// only for the "taps saved" counter in the judge panel.
const TAP_COST: Record<string, number> = {
  ACCEPT_ORDER: 2,
  START_NAVIGATION: 2,
  MARK_PICKED_UP: 2,
  CALL_CUSTOMER: 3,
  MARK_DELIVERED: 2,
  RECORD_CASH: 4,
  NEXT_ORDER: 1,
  REPORT_HAZARD: 3,
  EMERGENCY: 3,
};
interface HistEntry {
  latencyMs: number;
  validation?: string;
  intent: string;
}

interface Props {
  hasKey: boolean;
  voiceProvider: string;
}

export default function Dashboard({ hasKey, voiceProvider }: Props) {
  const [order, setOrder] = useState<Order | null>(null);
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [feedback, setFeedback] = useState<string>("Tap VOX or a command to begin.");
  const [online, setOnline] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ intent: IntentType; amount: number } | null>(null);
  const [lastDecision, setLastDecision] = useState<Decision | null>(null);
  const [history, setHistory] = useState<HistEntry[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const busyRef = useRef(false); // synchronous guard — airtight against a double tap
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/orders/current", { cache: "no-store" });
      const d = await r.json();
      setOrder(d.order ?? null);
    } catch {
      /* keep last known state */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Connectivity: browser online flag + a periodic health ping.
  useEffect(() => {
    const set = () => setOnline(navigator.onLine);
    set();
    window.addEventListener("online", set);
    window.addEventListener("offline", set);
    const id = setInterval(async () => {
      try {
        // strict=1 → 503 when the DB is down, so the dot reflects real health.
        const r = await fetch("/api/health?strict=1", { cache: "no-store" });
        setOnline(r.ok);
      } catch {
        setOnline(false);
      }
    }, 30000);
    return () => {
      window.removeEventListener("online", set);
      window.removeEventListener("offline", set);
      clearInterval(id);
    };
  }, []);

  // Clear any pending voice-state timer on unmount.
  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const flash = (state: VoiceState, ms: number) => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setVoice(state);
    resetTimer.current = setTimeout(() => setVoice("idle"), ms);
  };

  const send = useCallback(
    async (intent: IntentType, kind?: "geo" | "cash", confirm?: { amount: number }) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      setVoice("processing");
      const body: Record<string, unknown> = { intent };
      // Demo stub: simulate the rider standing at the drop so the geofence passes.
      // (Part 6's demo controls let you place the rider "too far" to show the block.)
      if (kind === "geo" && order) {
        body.riderLat = order.drop_lat;
        body.riderLng = order.drop_lng;
      }
      // Cash = the customer's COD total (not the rider's payout). The first tap
      // sends the amount WITHOUT `confirmed`, so the engine asks for a read-back;
      // `confirmed` is supplied only after the rider agrees. Part 5's voice reuses
      // this same path, so the read-back stays real for speech.
      if (kind === "cash" && order) {
        body.amount = confirm?.amount ?? order.cod_amount;
        if (confirm) body.confirmed = true;
      }
      try {
        const r = await fetch("/api/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) {
          setFeedback(d.error ?? "Something went wrong.");
          flash("blocked", 1800);
          return;
        }
        const dec = d.decision as Decision | undefined;
        // Record the real decision + measured latency for the judge panel/metrics.
        setLastDecision(dec ?? null);
        setHistory((h) => [
          ...h,
          { latencyMs: typeof d.latencyMs === "number" ? d.latencyMs : 0, validation: dec?.validation, intent },
        ]);
        setFeedback(dec?.feedback ?? "");
        if (dec?.validation === "CONFIRM_REQUIRED") {
          // Read-back (or a mismatch the engine flagged). Always confirm the
          // order's correct COD amount — never the possibly-misheard echoed value,
          // which would loop forever against the engine's mismatch guard.
          setPendingConfirm({ intent, amount: order?.cod_amount ?? 0 });
          if (resetTimer.current) clearTimeout(resetTimer.current);
          setVoice("confirm"); // persists until Yes/No — no auto-reset timer
          return;
        }
        setPendingConfirm(null);
        setOrder(d.order ?? null);
        // CALL exposes the number only via the sideEffect — dial it (strip spaces).
        if (dec?.sideEffect?.type === "CALL" && dec.sideEffect.value) {
          window.location.href = `tel:${String(dec.sideEffect.value).replace(/[^+\d]/g, "")}`;
        }
        flash(dec?.validation === "BLOCKED" ? "blocked" : "speaking", 1700);
      } catch {
        setFeedback("Network error — try again.");
        flash("blocked", 1800);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [order]
  );

  // Rider answered the read-back → record with the echoed amount + confirmation.
  const confirmCash = useCallback(() => {
    if (!pendingConfirm) return;
    const p = pendingConfirm;
    setPendingConfirm(null);
    void send(p.intent, "cash", { amount: p.amount });
  }, [pendingConfirm, send]);

  const cancelConfirm = useCallback(() => {
    setPendingConfirm(null);
    setFeedback("Cancelled.");
    setVoice("idle");
  }, []);

  const curStep = stepIndex(order?.status ?? null);
  const onTrip = order && order.status !== "AVAILABLE" && order.status !== "PAID";

  const executed = history.filter((h) => h.validation === "PASSED");
  const metrics: Metrics = {
    total: history.length,
    executed: executed.length,
    blocked: history.filter((h) => h.validation === "BLOCKED").length,
    lastLatency: history.length ? history[history.length - 1].latencyMs : null,
    avgLatency: history.length ? Math.round(history.reduce((s, h) => s + h.latencyMs, 0) / history.length) : null,
    tapsOldWay: executed.reduce((s, h) => s + (TAP_COST[h.intent] ?? 2), 0),
  };

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh", padding: 16, paddingBottom: 72, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Top bar */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--accent)", display: "grid", placeItems: "center", color: "#04120d", fontWeight: 800 }}>V</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>VOX</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Rider operating layer</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: online ? "var(--accent)" : "var(--danger)" }}>{online ? "● Online" : "● Offline"}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Ravi · {onTrip ? "On trip" : "Available"}</div>
        </div>
      </header>

      {!hasKey && (
        <div style={{ fontSize: 11, color: "var(--warn)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 10px" }}>
          Keyless mode · {voiceProvider}. Add GEMINI_API_KEY for natural human voice.
        </div>
      )}

      {/* Lifecycle stepper */}
      <section style={{ display: "flex", gap: 4 }} aria-label="Order progress">
        {STEPS.map((s, idx) => (
          <div key={s.key} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ height: 4, borderRadius: 2, background: idx <= curStep ? "var(--accent)" : "var(--border)" }} />
            <div style={{ fontSize: 11, marginTop: 4, color: idx === curStep ? "var(--accent)" : "var(--muted)" }}>{s.label}</div>
          </div>
        ))}
      </section>

      {/* Current order */}
      <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 16 }}>
        {order ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Current order · {order.id}</span>
              <span style={{ fontSize: 12, color: "var(--accent)" }}>{order.status.replace(/_/g, " ")}</span>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Pickup</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{order.pickup_name}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Drop</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{order.drop_name}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Dist</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{order.distance_km} km</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Earn</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)" }}>₹{order.earnings}</div>
              </div>
            </div>
            {/* COD: what the rider collects from the customer (distinct from earnings) */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, background: "var(--surface-2)", borderRadius: 10, padding: "8px 12px" }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Collect from customer (COD)</span>
              <span style={{ fontSize: 16, fontWeight: 800 }}>₹{order.cod_amount}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>Customer: {order.customer_name}</div>
          </>
        ) : loaded ? (
          <div style={{ fontSize: 14, color: "var(--muted)" }}>No orders right now. Say “next order”.</div>
        ) : (
          <div style={{ fontSize: 14, color: "var(--muted)" }}>Loading…</div>
        )}
      </section>

      {/* Spoken feedback line */}
      <div role="status" aria-live="polite" style={{ minHeight: 20, fontSize: 13, color: voice === "blocked" ? "var(--danger)" : "var(--text)", textAlign: "center" }}>
        {feedback}
      </div>

      {/* VOX button */}
      <section style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
        <VoxButton
          state={voice}
          onPress={() => {
            flash("listening", 1200);
            setFeedback("Live voice lands in the next build — use the commands below for now.");
          }}
        />
      </section>

      {/* Read-back confirmation for cash (the same path voice uses in Part 5) */}
      {pendingConfirm && (
        <section style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", border: "1px solid var(--warn)", borderRadius: 12, padding: "10px 12px" }}>
          <span style={{ flex: 1, fontSize: 13 }}>Collected ₹{pendingConfirm.amount}?</span>
          <button onClick={confirmCash} disabled={busy} style={{ padding: "8px 16px", borderRadius: 9, border: "none", background: "var(--accent)", color: "#04120d", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Yes</button>
          <button onClick={cancelConfirm} disabled={busy} style={{ padding: "8px 16px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>No</button>
        </section>
      )}

      {/* Command chips (typed-command fallback; voice drives these in Part 5) */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {COMMANDS.map((c) => (
          <button
            key={c.intent}
            disabled={busy || !loaded}
            onClick={() => send(c.intent, c.kind)}
            style={{ padding: "10px 4px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: busy || !loaded ? "default" : "pointer", opacity: busy || !loaded ? 0.5 : 1 }}
          >
            {c.label}
          </button>
        ))}
        <button
          disabled={busy}
          aria-label="Emergency SOS"
          onClick={() => send("EMERGENCY")}
          style={{ padding: "10px 4px", borderRadius: 10, border: "1px solid var(--danger)", background: "rgba(255,89,100,0.12)", color: "var(--danger)", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}
        >
          SOS
        </button>
      </section>

      {/* Judge-panel toggle (discreet) + the decision/metrics overlay */}
      <button
        onClick={() => setPanelOpen(true)}
        aria-label="Open judge decision panel"
        style={{ position: "fixed", right: 14, bottom: 14, zIndex: 40, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 999, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.4)" }}
      >
        📊 Panel{history.length ? ` · ~${metrics.tapsOldWay} saved` : ""}
      </button>
      <DecisionPanel decision={lastDecision} metrics={metrics} open={panelOpen} onClose={() => setPanelOpen(false)} />
    </main>
  );
}
