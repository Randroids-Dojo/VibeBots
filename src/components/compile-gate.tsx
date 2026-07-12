"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type { Camera, Object3D } from "three/webgpu";

/**
 * Compiles every material in the mounted scene, then reports done (F-072).
 *
 * Mount inside a Canvas whose frameloop prop is "never" until onCompiled
 * fires, then "always" (the prop must change through React state: R3F
 * reconciles the prop on every parent re-render, so poking the store
 * directly gets reverted by the next render). Without the gate, the first
 * rendered frame compiles the whole mounted scene synchronously on the
 * main thread: navigating from the mine to the holodeck froze the page
 * for the full compile, the worst first-view long task of any surface in
 * the telemetry. compileAsync routes the same compiles through the
 * driver's parallel-compile path while the page stays responsive; the
 * canvas shows its backdrop for the beat the compile needs and then
 * animates as before.
 *
 * Best-effort: if the renderer lacks compileAsync or it rejects,
 * onCompiled still fires and materials compile lazily as before.
 */
export function StartFramesWhenCompiled({
  onCompiled,
}: {
  onCompiled: () => void;
}) {
  const gl = useThree((state) => state.gl) as {
    compileAsync?: (scene: Object3D, camera: Camera) => Promise<unknown>;
  };
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    let cancelled = false;
    const start = () => {
      if (!cancelled) onCompiled();
    };
    try {
      const compiled = gl.compileAsync?.(scene, camera);
      if (compiled) compiled.then(start, start);
      else start();
    } catch {
      start();
    }
    return () => {
      cancelled = true;
    };
  }, [gl, scene, camera, onCompiled]);
  return null;
}
