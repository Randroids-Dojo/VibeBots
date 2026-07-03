"use client";

import type { ReactElement } from "react";
import { WebGPURenderer } from "three/webgpu";
import type { PartCategory, PartShape } from "@/sim/parts";

/** Geometry element matching a part's collider shape. */
/**
 * Physical response per part category (battle slice B2a, shared with the
 * workshop in the glow-up slice): weapons read as polished steel, cores
 * glow, mobility parts stay rubbery, structure sits between.
 */
export const CATEGORY_SURFACE: Record<
  PartCategory,
  { metalness: number; roughness: number; emissiveBoost: number }
> = {
  core: { metalness: 0.45, roughness: 0.35, emissiveBoost: 0.35 },
  structure: { metalness: 0.6, roughness: 0.42, emissiveBoost: 0 },
  mobility: { metalness: 0.1, roughness: 0.85, emissiveBoost: 0 },
  weapon: { metalness: 0.85, roughness: 0.2, emissiveBoost: 0.08 },
};

export function partGeometry(shape: PartShape): ReactElement {
  switch (shape.type) {
    case "cuboid":
      return <boxGeometry args={[shape.hx * 2, shape.hy * 2, shape.hz * 2]} />;
    case "ball":
      return <icosahedronGeometry args={[shape.radius, 1]} />;
    case "cylinder":
      return (
        <cylinderGeometry
          args={[shape.radius, shape.radius, shape.halfHeight * 2, 14]}
        />
      );
  }
}

/** Mesh-local rotation matching the collider's axis reorientation. */
export function shapeRotation(shape: PartShape): [number, number, number] {
  if (shape.type === "cylinder" && shape.axis === "x") {
    return [0, 0, Math.PI / 2];
  }
  if (shape.type === "cylinder" && shape.axis === "z") {
    return [Math.PI / 2, 0, 0];
  }
  return [0, 0, 0];
}

/**
 * R3F gl factory: WebGPU renderer with automatic WebGL2 fallback.
 * Coarse-pointer devices force the WebGL2 backend outright: Android
 * Chrome exposes WebGPU but its mobile backend rendered the mine at a
 * fraction of WebGL2's framerate (user-reported jank); desktop keeps
 * WebGPU. Same renderer class either way, so TSL materials still work.
 */
export async function createWebGPU(glProps: unknown): Promise<WebGPURenderer> {
  const coarsePointer =
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches;
  const canvas =
    glProps && typeof glProps === "object" && "canvas" in glProps
      ? (glProps as { canvas?: HTMLCanvasElement }).canvas
      : undefined;
  if (canvas) {
    canvas.dataset.renderer = coarsePointer ? "webgl2-forced" : "webgpu-auto";
  }
  const renderer = new WebGPURenderer({
    ...(glProps as ConstructorParameters<typeof WebGPURenderer>[0]),
    forceWebGL: coarsePointer,
  });
  await renderer.init();
  return renderer;
}
