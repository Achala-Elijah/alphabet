import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AlphaBet — Sportsbook",
  description: "AlphaBet frontend UI recreation"
};

// Mobile-first: without this, phones render the desktop layout at ~980px
// and zoom out — which is why the whole site looked "not mobile".
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#f00032"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
