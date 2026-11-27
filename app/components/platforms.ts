// Evocative skins for the two rider platforms — brand colours + wordmark + role,
// no real logos. Switching platform reskins the same working app (VOX on top).
export type PlatformId = "rapido" | "zomato";

export interface Platform {
  id: PlatformId;
  name: string;
  role: string; // what the platform calls its riders
  accent: string; // brand colour (becomes --accent across the app)
  accentDim: string;
  onAccent: string; // readable text on the accent colour
  headerBg: string;
  headerFg: string;
  glow: string; // faint top-of-screen tint, so each skin feels distinct
}

export const PLATFORMS: Record<PlatformId, Platform> = {
  rapido: {
    id: "rapido",
    name: "Rapido",
    role: "Captain",
    accent: "#FFC800",
    accentDim: "#C99E00",
    onAccent: "#141414",
    headerBg: "#141414",
    headerFg: "#FFC800",
    glow: "rgba(255, 200, 0, 0.10)",
  },
  zomato: {
    id: "zomato",
    name: "Zomato",
    role: "Delivery Partner",
    accent: "#E23744",
    accentDim: "#A3262F",
    onAccent: "#FFFFFF",
    headerBg: "#E23744",
    headerFg: "#FFFFFF",
    glow: "rgba(226, 55, 68, 0.13)",
  },
};

export const PLATFORM_IDS: PlatformId[] = ["rapido", "zomato"];
