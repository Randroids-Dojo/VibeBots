"use client";

import type { ReactElement } from "react";
import { WebGPURenderer } from "three/webgpu";
import type { PartCategory, PartShape } from "@/sim/parts";
import {
  hasCoarsePointer,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";
import { HIGH_DETAIL, LOW_DETAIL, partShapeGeometry } from "./part-geometry";

/**
 * Physical response per part category (battle slice B2a, shared with the
 * workshop in the glow-up slice): weapons read as polished steel, cores
 * glow, mobility parts stay rubbery, structure sits between. Tuned for
 * smooth shading over the beveled part geometry: edge fillets carry the
 * specular highlight, so metals can sit glossier without facet sparkle.
 */
export const CATEGORY_SURFACE: Record<
  PartCategory,
  { metalness: number; roughness: number; emissiveBoost: number }
> = {
  core: { metalness: 0.5, roughness: 0.3, emissiveBoost: 0.35 },
  structure: { metalness: 0.72, roughness: 0.38, emissiveBoost: 0 },
  mobility: { metalness: 0.05, roughness: 0.9, emissiveBoost: 0 },
  weapon: { metalness: 0.9, roughness: 0.18, emissiveBoost: 0.08 },
};

/**
 * Geometry element for a part's collider shape (render-only: the sim
 * collider in src/sim/parts.ts is untouched). Instead of raw primitives,
 * parts get manufactured forms from part-geometry.ts: filleted boxes,
 * machined spheres, hub-and-tread wheels, toothed weapon discs, tapered
 * ram spikes, collared struts. All forms stay inside the collider bounds
 * and keep the cylinder-along-Y convention, so shapeRotation and every
 * drag or layout computation behave exactly as before.
 *
 * Geometries come from a shared module cache (one instance per unique
 * shape and treatment), so pass dispose={null} semantics for free: the
 * returned primitive never disposes the shared geometry.
 *
 * `category` picks the treatment (weapon cylinders grow teeth, mobility
 * cylinders become tires); omitting it falls back to a neutral machined
 * look.
 */
export function partGeometry(
  shape: PartShape,
  category?: PartCategory,
): ReactElement {
  const detail =
    resolveGraphicsQualityTier(
      readStoredGraphicsQuality(),
      hasCoarsePointer(),
    ) === "low"
      ? LOW_DETAIL
      : HIGH_DETAIL;
  return (
    <primitive
      object={partShapeGeometry(shape, category, detail)}
      attach="geometry"
      dispose={null}
    />
  );
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
