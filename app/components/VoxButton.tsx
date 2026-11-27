"use client";

export type VoiceState = "idle" | "listening" | "processing" | "speaking" | "blocked" | "confirm";

// Each pipeline state has an unmistakable colour + label, so a rider (or a judge)
// can read what VOX is doing at a glance, in traffic.
const STATES: Record<VoiceState, { label: string; sub: string; color: string; ring: string; pulse: boolean }> = {
  idle:       { label: "Tap to talk",  sub: 'or say "Hey VOX"', color: "var(--accent)", ring: "rgba(22,212,168,0.16)", pulse: false },
  listening:  { label: "Listening",    sub: "speak now",        color: "#3b82f6",       ring: "rgba(59,130,246,0.28)", pulse: true },
  processing: { label: "Thinking",     sub: "understanding",    color: "var(--warn)",   ring: "rgba(245,166,35,0.26)", pulse: true },
  speaking:   { label: "Speaking",     sub: "VOX responds",     color: "#16a34a",       ring: "rgba(22,163,74,0.26)",  pulse: true },
  blocked:    { label: "Blocked",      sub: "not allowed",      color: "var(--danger)", ring: "rgba(255,89,100,0.30)", pulse: false },
  confirm:    { label: "Confirm?",     sub: "yes to record",    color: "var(--warn)",   ring: "rgba(245,166,35,0.28)", pulse: true },
};

export default function VoxButton({ state, onPress, disabled }: { state: VoiceState; onPress?: () => void; disabled?: boolean }) {
  const s = STATES[state];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <button
        onClick={onPress}
        disabled={disabled}
        aria-label={`Voice control — ${s.label}`}
        style={{
          width: 116, height: 116, borderRadius: "50%", border: "none", cursor: "pointer",
          background: s.color, color: "#04120d", fontSize: 16, fontWeight: 800, letterSpacing: 0.5,
          boxShadow: `0 0 0 10px ${s.ring}`,
          animation: s.pulse ? "voxpulse 1.1s ease-in-out infinite" : "none",
          transition: "background 180ms ease, box-shadow 180ms ease",
        }}
      >
        VOX
      </button>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: s.color }}>{s.label}</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{s.sub}</div>
      </div>
    </div>
  );
}
