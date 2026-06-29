"use client";

import dynamic from "next/dynamic";

// The canvas pulls in three/webgpu; load it client-only so the server
// bundle for the page stays lean (matches the arena/workshop stages).
const HolodeckCanvas = dynamic(() => import("./holodeck-canvas"), {
  ssr: false,
});

export function HolodeckStage() {
  return <HolodeckCanvas />;
}
