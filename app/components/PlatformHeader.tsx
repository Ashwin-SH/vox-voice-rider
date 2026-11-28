"use client";

import { PLATFORMS, PLATFORM_IDS, type Platform, type PlatformId } from "./platforms";

// Top tab switcher + the selected platform's branded header. The app below is
// the same VOX-powered dashboard, reskinned per platform.
export default function PlatformHeader({
  platform,
  onSwitch,
  online,
  onTrip,
}: {
  platform: Platform;
  onSwitch: (id: PlatformId) => void;
  online: boolean;
  onTrip: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Platform tabs */}
      <div style={{ display: "flex", justifyContent: "center", gap: 6 }} role="tablist" aria-label="Rider platform">
        {PLATFORM_IDS.map((id) => {
          const p = PLATFORMS[id];
          const active = id === platform.id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => onSwitch(id)}
              style={{
                padding: "7px 18px",
                borderRadius: 999,
                border: `1px solid ${active ? p.accent : "var(--border)"}`,
                background: active ? p.accent : "var(--surface-2)",
                color: active ? p.onAccent : "var(--text)",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
                letterSpacing: -0.2,
              }}
            >
              {p.name}
            </button>
          );
        })}
      </div>

      {/* Branded header for the selected platform */}
      <div style={{ background: platform.headerBg, color: platform.headerFg, borderRadius: 16, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: -0.6, lineHeight: 1 }}>{platform.name}</div>
          <div style={{ fontSize: 11, opacity: 0.85, marginTop: 3 }}>
            {platform.role} · powered by <strong>VOX</strong> 🎙
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{online ? "● Online" : "● Offline"}</div>
          <div style={{ fontSize: 11, opacity: 0.85 }}>Ravi · {onTrip ? "On trip" : "Available"}</div>
        </div>
      </div>
    </div>
  );
}
