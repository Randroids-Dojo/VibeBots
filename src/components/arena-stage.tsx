"use client";

import dynamic from "next/dynamic";

// The canvas pulls in three/webgpu and the rapier WASM blob; load it
// client-only so the server bundle for the page stays lean.
const ArenaCanvas = dynamic(() => import("./arena-canvas"), { ssr: false });

export function ArenaStage() {
  return <ArenaCanvas />;
}
