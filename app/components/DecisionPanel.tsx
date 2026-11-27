"use client";

import { useEffect, useRef } from "react";
import type { Decision } from "@/lib/intents";

export interface Metrics {
  total: number; // commands run
  executed: number; // validation === PASSED
  blocked: number; // validation === BLOCKED
  confirms: number; // validation === CONFIRM_REQUIRED (read-backs)
  lastLatency: number | null;
  avgLatency: number | null;
  tapsOldWay: number; // screen taps the completed actions would have cost
}

const vColor = (v?: string) =>
  v === "PASSED" ? "var(--accent)" : v === "BLOCKED" ? "var(--danger)" : v === "CONFIRM_REQUIRED" ? "var(--warn)" : "var(--muted)";

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: color ?? "var(--text)", textAlign: "right", fontFamily: "ui-monospace, Menlo, monospace" }}>{value}</span>
    </div>
  );
}

// The judge view: a discreet panel that shows the structured decision VOX made
// for the last command — read live from the real /api/intent response, not
// scripted — plus running metrics and the screen-taps-saved counter.
export default function DecisionPanel({
  decision,
  metrics,
  open,
  onClose,
}: {
  decision: Decision | null;
  metrics: Metrics;
  open: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus(); // move focus into the dialog
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const d = decision;
  const pct = (c?: number) => (typeof c === "number" ? `${Math.round(c * 100)}%` : "—");
  const geo = d?.geo
    ? `${d.geo.distanceM} m (limit ${d.geo.thresholdM} m) ${d.geo.within ? "✓ inside" : "✗ outside"}`
    : "—";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)" }} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="VOX decision panel" style={{ position: "relative", width: "100%", maxWidth: 480, margin: "0 auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "16px 16px 0 0", padding: 16, maxHeight: "82vh", overflowY: "auto" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>VOX decision · judge view</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>live from the validation engine — nothing scripted</div>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close panel" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 14 }}>✕</button>
        </header>

        {/* Last decision */}
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--muted)", margin: "10px 0 2px" }}>Last command</div>
        {d ? (
          <>
            <Row label="Intent" value={d.intent} />
            <Row label="Language" value={d.language ?? "— (voice adds this)"} />
            <Row label="Confidence" value={pct(d.confidence)} />
            <Row label="State" value={`${d.statusBefore ?? "—"} → ${d.statusAfter ?? "(no change)"}`} />
            <Row label="GPS / geofence" value={geo} color={d.geo ? (d.geo.within ? "var(--accent)" : "var(--danger)") : undefined} />
            <Row label="Action" value={d.action} />
            <Row label="Validation" value={d.validation} color={vColor(d.validation)} />
            {d.reason && <Row label="Reason" value={d.reason} color="var(--danger)" />}
          </>
        ) : (
          <div style={{ fontSize: 13, color: "var(--muted)", padding: "8px 0" }}>Run a command to see the decision.</div>
        )}

        {/* Metrics */}
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--muted)", margin: "16px 0 2px" }}>Metrics</div>
        <Row label="Response latency" value={metrics.lastLatency != null ? `${metrics.lastLatency} ms · avg ${metrics.avgLatency} ms` : "—"} />
        <Row label="Commands" value={`${metrics.total} run · ${metrics.executed} executed`} />
        <Row label="Blocked / read-backs" value={`${metrics.blocked} blocked · ${metrics.confirms} read-backs`} color={metrics.blocked > 0 ? "var(--accent)" : undefined} />

        {/* Taps counter */}
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--muted)", margin: "16px 0 6px" }}>Screen taps</div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1, background: "var(--surface-2)", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: "var(--accent)" }}>0</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>by voice (Part 5)</div>
          </div>
          <div style={{ flex: 1, background: "var(--surface-2)", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text)" }}>~{metrics.tapsOldWay}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>tap-based app</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", marginTop: 8 }}>
          ~{metrics.tapsOldWay} taps for the completed actions in a tap-based app (est.) — by voice, VOX needs none.
        </div>
      </div>
    </div>
  );
}
