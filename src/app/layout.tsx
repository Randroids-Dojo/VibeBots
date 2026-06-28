import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ClientErrorTelemetry } from "@/components/app-error-telemetry";
import "./globals.css";
import "./mine.css";

export const metadata: Metadata = {
  title: "VibeBots",
  description:
    "Autonomous robot battler with a mining-driven economy. Dig, build, and watch your bots fight.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "VibeBots",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClientErrorTelemetry />
        {children}
      </body>
    </html>
  );
}
