import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VOX — Hands-free voice operating layer for gig riders",
  description:
    "VOX lets India's delivery and gig riders run their whole job by voice — accept, navigate, pick up, deliver, collect cash — hands-free, in their own language.",
};

export const viewport: Viewport = {
  themeColor: "#0b0f14",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
