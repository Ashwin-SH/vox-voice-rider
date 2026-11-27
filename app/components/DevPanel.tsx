"use client";

import { useState } from "react";
import type { IntentType } from "@/lib/intents";
import type { RideSim } from "./useRideSim";
import type { Order } from "@/lib/types";

// Simulation / developer controls — deliberately tucked away so the rider UI stays
// clean, but easy to find. Manual actions run the SAME engine path as voice (never
// a validation bypass); movement controls drive the demo simulation.
const MANUAL: { intent: IntentType; label: string; kind?: "geo" | "cash" }[] = [
  { intent: "START_NAVIGATION", label: "Navigate" },
  { intent: "MARK_PICKED_UP", label: "Picked up" },
  { intent: "CALL_CUSTOMER", label: "Call" },
  { intent: "MARK_DELIVERED", label: "Deliver", kind: "geo" },
  { intent: "RECORD_CASH", label: "Cash", kind: "cash" },
  { intent: "NEXT_ORDER", label: "Next" },
];

export default function DevPanel({
  sim,
  order,
  onCommand,
  canCommand,
}: {
  sim: RideSim;
  order: Order | null;
  onCommand: (intent: IntentType, kind?: "geo" | "cash") => void;
  canCommand: boolean;
}) {
  const [open, setOpen] = useState(false);
  const inRide = !!order;

  const chip = (label: string, onClick: () => void, disabled?: boolean, danger?: boolean) => (
    <button
      key={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 6px", borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: disabled ? "default" : "pointer",
        border: `1px solid ${danger ? "var(--warn)" : "var(--border)"}`, background: "var(--surface-2)",
        color: danger ? "var(--warn)" : "var(--text)", opacity: disabled ? 0.45 : 1,
      }}
    >
      {label}
    </button>
  );

  return (
    <section style={{ border: "1px dashed var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
      >
        <span>🛠 Simulation &amp; developer controls</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "4px 12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Scenario */}
          <div>
            <Label>Scenario</Label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {chip("↺ Reset demo", () => void sim.reset())}
              {chip("＋ Trigger request", sim.triggerRequest, !sim.online || inRide)}
            </div>
          </div>

          {/* Movement */}
          <div>
            <Label>Movement {inRide ? "" : "(start a ride first)"}</Label>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {[2, 4, 8].map((m) => (
                <button
                  key={m}
                  onClick={() => sim.setSpeed(m)}
                  style={{ flex: 1, padding: "8px 6px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer",
                    border: `1px solid ${sim.speedMult === m ? "var(--accent)" : "var(--border)"}`,
                    background: sim.speedMult === m ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "var(--surface-2)",
                    color: sim.speedMult === m ? "var(--accent)" : "var(--text)" }}
                >
                  {m}×
                </button>
              ))}
              {chip(sim.moving ? "⏸ Pause" : "▶ Resume", sim.togglePause, !inRide)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {chip("→ Pickup", sim.jumpToPickup, !inRide)}
              {chip("→ Drop", sim.jumpToDrop, !inRide)}
              {chip("180 m away", sim.setFarFromDrop, !inRide, true)}
            </div>
          </div>

          {/* Manual actions (same engine path as voice) */}
          <div>
            <Label>Manual actions (fallback — same validation as voice)</Label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {MANUAL.map((c) => chip(c.label, () => onCommand(c.intent, c.kind), !canCommand || !inRide))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "var(--muted)", marginBottom: 6 }}>{children}</div>;
}
