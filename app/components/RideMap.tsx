"use client";

import type { GeoPoint } from "@/lib/types";

// A schematic, API-key-free "map": it projects the real lat/lng points into an SVG
// so the route and the moving rider marker are understandable at a glance. Not a
// real tile map — deliberately, so the demo never depends on a paid maps key.

interface Props {
  rider: GeoPoint;
  pickup?: GeoPoint | null;
  drop?: GeoPoint | null;
  pickupName?: string;
  dropName?: string;
  navTarget: "pickup" | "drop" | null;
  active: boolean; // a ride is in flight
}

const W = 340;
const H = 210;
const PAD = 34;

export default function RideMap({ rider, pickup, drop, pickupName, dropName, navTarget, active }: Props) {
  const pts: GeoPoint[] = [rider];
  if (active && pickup) pts.push(pickup);
  if (active && drop) pts.push(drop);

  // Fit the points into the padded canvas. lng → x, lat → y (inverted).
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  // Avoid a zero span (single point / idle) so projection stays stable.
  const spanLat = maxLat - minLat || 0.01;
  const spanLng = maxLng - minLng || 0.01;
  minLat -= spanLat * 0.15; maxLat += spanLat * 0.15;
  minLng -= spanLng * 0.15; maxLng += spanLng * 0.15;

  const project = (p: GeoPoint) => {
    const x = PAD + ((p.lng - minLng) / (maxLng - minLng)) * (W - 2 * PAD);
    const y = PAD + ((maxLat - p.lat) / (maxLat - minLat)) * (H - 2 * PAD);
    return { x, y };
  };

  const r = project(rider);
  const p = pickup ? project(pickup) : null;
  const d = drop ? project(drop) : null;
  const dest = navTarget === "pickup" ? p : navTarget === "drop" ? d : null;

  const grid = [];
  for (let x = 0; x <= W; x += 34) grid.push(<line key={`gx${x}`} x1={x} y1={0} x2={x} y2={H} stroke="var(--border)" strokeWidth={1} opacity={0.35} />);
  for (let y = 0; y <= H; y += 34) grid.push(<line key={`gy${y}`} x1={0} y1={y} x2={W} y2={y} stroke="var(--border)" strokeWidth={1} opacity={0.35} />);

  return (
    <div style={{ position: "relative", width: "100%", borderRadius: 16, overflow: "hidden", border: "1px solid var(--border)", background: "linear-gradient(160deg, #0d141d, #0a0f16)" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} role="img" aria-label="Rider map">
        {grid}
        {/* Base route pickup → drop */}
        {active && p && d && (
          <line x1={p.x} y1={p.y} x2={d.x} y2={d.y} stroke="var(--muted)" strokeWidth={3} strokeDasharray="2 6" strokeLinecap="round" opacity={0.6} />
        )}
        {/* Remaining path: rider → current destination */}
        {active && dest && (
          <line x1={r.x} y1={r.y} x2={dest.x} y2={dest.y} stroke="var(--accent)" strokeWidth={4} strokeLinecap="round" />
        )}
        {/* Pickup marker */}
        {active && p && (
          <g>
            <circle cx={p.x} cy={p.y} r={7} fill="var(--surface)" stroke="var(--accent)" strokeWidth={3} />
            {pickupName && <text x={p.x} y={p.y - 12} fill="var(--text)" fontSize={11} fontWeight={700} textAnchor="middle">{pickupName}</text>}
          </g>
        )}
        {/* Drop marker (with geofence ring) */}
        {active && d && (
          <g>
            <circle cx={d.x} cy={d.y} r={16} fill="none" stroke="var(--accent)" strokeWidth={1} strokeDasharray="3 4" opacity={0.5} />
            <rect x={d.x - 6} y={d.y - 6} width={12} height={12} rx={3} fill="var(--accent)" />
            {dropName && <text x={d.x} y={d.y + 22} fill="var(--text)" fontSize={11} fontWeight={700} textAnchor="middle">{dropName}</text>}
          </g>
        )}
        {/* Rider marker */}
        <g>
          <circle cx={r.x} cy={r.y} r={12} fill="var(--accent)" opacity={0.18}>
            <animate attributeName="r" values="10;16;10" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <circle cx={r.x} cy={r.y} r={6} fill="#fff" stroke="var(--accent)" strokeWidth={3} />
        </g>
      </svg>
      {!active && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <div style={{ fontSize: 12, color: "var(--muted)", background: "rgba(0,0,0,0.35)", padding: "4px 10px", borderRadius: 999 }}>
            Jayanagar, Bengaluru
          </div>
        </div>
      )}
    </div>
  );
}
