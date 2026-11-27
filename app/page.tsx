import { getVoiceKeyStatus } from "@/lib/config";

// Read env at request time so the voice-engine status reflects a key added at runtime
// (still cannot crash: getVoiceKeyStatus only reads process.env with optional chaining).
export const dynamic = "force-dynamic";

export default function Home() {
  const { hasKey, provider } = getVoiceKeyStatus();

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh", padding: "16px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Top bar */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--accent)", display: "grid", placeItems: "center", color: "#04120d", fontWeight: 800 }}>V</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: 0.3 }}>VOX</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Rider operating layer</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: "var(--accent)" }}>● Online</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Ravi · Bengaluru</div>
        </div>
      </header>

      {/* Voice key status — the keyless requirement made visible */}
      <section style={{ background: hasKey ? "var(--surface-2)" : "var(--surface)", border: `1px solid ${hasKey ? "var(--accent-dim)" : "var(--border)"}`, borderRadius: 12, padding: "12px 14px" }}>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Voice engine</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{provider}</div>
        {!hasKey && (
          <div style={{ fontSize: 12, color: "var(--warn)", marginTop: 6 }}>
            Premium voice key not set — the app runs fully in keyless mode. Add <code>GEMINI_API_KEY</code> to enable natural human voice.
          </div>
        )}
      </section>

      {/* Current task card (static shell — live data arrives in Part 1/3) */}
      <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Current order</span>
          <span style={{ fontSize: 12, color: "var(--accent)" }}>Awaiting start</span>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Pickup</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Indiranagar</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Drop</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Domlur</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Distance</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>6 km</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Earn</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)" }}>₹62</div>
          </div>
        </div>
      </section>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* VOX voice button (push-to-talk placeholder — wired in Part 5) */}
      <section style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, paddingBottom: 12 }}>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Hold to talk · or say “Hey VOX”</div>
        <button
          aria-label="Push to talk"
          style={{ width: 96, height: 96, borderRadius: "50%", border: "none", background: "var(--accent)", color: "#04120d", fontSize: 15, fontWeight: 800, cursor: "pointer", boxShadow: "0 0 0 8px rgba(22,212,168,0.12)" }}
        >
          VOX
        </button>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Idle</div>
      </section>
    </main>
  );
}
