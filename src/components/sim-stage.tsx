"use client";

import dynamic from "next/dynamic";

// The canvas pulls in three/webgpu and the rapier WASM blob; load it
// client-only so the server bundle for the page stays lean.
const SimCanvas = dynamic(() => import("./sim-canvas"), { ssr: false });

export function SimStage() {
  return <SimCanvas />;
}
