"use client";

import type { Order } from "@/lib/types";

// The incoming ride request — arrives on its own, reads out via VOX, and counts
// down. Voice ("accept" / "reject") is primary; the buttons are a fallback.
export default function RequestCard({
  offer,
  secsLeft,
  total,
  onAccept,
  onReject,
  disabled,
}: {
  offer: Order;
  secsLeft: number;
  total: number;
  onAccept: () => void;
  onReject: () => void;
  disabled?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, (secsLeft / total) * 100));
  const urgent = secsLeft <= 6;
  return (
    <section
      style={{
        background: "var(--surface)",
        border: "2px solid var(--accent)",
        borderRadius: 16,
        padding: 16,
        boxShadow: "0 8px 30px rgba(0,0,0,0.45)",
        animation: "voxrise 240ms ease",
      }}
      aria-live="assertive"
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, color: "var(--accent)", textTransform: "uppercase" }}>
          ● New ride request
        </span>
        <span style={{ fontSize: 13, fontWeight: 800, fontFamily: "ui-monospace, Menlo, monospace", color: urgent ? "var(--danger)" : "var(--text)" }}>
          {secsLeft}s
        </span>
      </div>
      {/* countdown bar */}
      <div style={{ height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden", marginBottom: 14 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: urgent ? "var(--danger)" : "var(--accent)", transition: "width 250ms linear" }} />
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Pickup</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{offer.pickup_name}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Drop</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{offer.drop_name}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <Stat label="Distance" value={`${offer.distance_km} km`} />
        <Stat label="You earn" value={`₹${offer.earnings}`} accent />
        <Stat label="Collect" value={`₹${offer.cod_amount}`} />
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button
          onClick={onReject}
          disabled={disabled}
          style={{ flex: 1, padding: "12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
        >
          Reject
        </button>
        <button
          onClick={onAccept}
          disabled={disabled}
          style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: "var(--accent)", color: "var(--on-accent)", fontSize: 14, fontWeight: 800, cursor: "pointer" }}
        >
          Accept
        </button>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", marginTop: 8 }}>
        or just say “accept” / “reject”
      </div>
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ flex: 1, background: "var(--surface-2)", borderRadius: 10, padding: "8px 10px" }}>
      <div style={{ fontSize: 10, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: accent ? "var(--accent)" : "var(--text)" }}>{value}</div>
    </div>
  );
}
