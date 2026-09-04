"use client";

import type { ReactElement } from "react";
import type { BufferGeometry } from "three";
import { WebGPURenderer } from "three/webgpu";
import { perfAnalyzerEnabled } from "@/lib/perf-analyzer-settings";
import type { PartDef, PartShape } from "@/sim/parts";
import {
  detectSoftwareRenderer,
  hasCoarsePointer,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";
import { HIGH_DETAIL, LOW_DETAIL, partShapeGeometry } from "./part-geometry";
import { partAccent } from "./part-look";

/**
 * The shared, tier-resolved display geometry for a catalog part. The
 * sim collider in src/sim/parts.ts is untouched: parts get manufactured
 * forms from part-geometry.ts (filleted boxes, machined spheres,
 * hub-and-tread wheels, toothed weapon discs, tapered ram spikes,
 * collared struts), every one inside the collider bounds and on the
 * cylinder-along-Y convention, so shapeRotation and every drag or layout
 * computation behave exactly as before. The part's two-tone accent
 * (part-look.ts) is baked in as a vertex `color` attribute.
 */
function resolvePartGeometry(def: PartDef): BufferGeometry {
  const detail =
    resolveGraphicsQualityTier(
      readStoredGraphicsQuality(),
      hasCoarsePointer(),
      detectSoftwareRenderer(),
    ) === "low"
      ? LOW_DETAIL
      : HIGH_DETAIL;
  return partShapeGeometry(def.shape, def.category, detail, partAccent(def));
}

/**
 * Geometry element for a part. Geometries come from a shared module
 * cache (one instance per unique shape, treatment, tier, and accent),
 * so the returned primitive never disposes the shared geometry.
 */
export function partGeometry(def: PartDef): ReactElement {
  return (
    <primitive
      object={resolvePartGeometry(def)}
      attach="geometry"
      dispose={null}
    />
  );
}

/**
 * Whether a part's geometry carries the two-tone `color` attribute. Pass
 * it to the mesh material's `vertexColors` so single-tone forms (and a
 * future part with no accent) keep rendering in their plain base colour.
 */
export function partVertexColors(def: PartDef): boolean {
  return resolvePartGeometry(def).hasAttribute("color");
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
    // GPU render-pass timing for the opt-in performance analyzer. Only
    // requested when the toggle is already on at canvas creation, so
    // players who never opt in pay nothing.
    trackTimestamp: perfAnalyzerEnabled(),
  });
  await renderer.init();
  return renderer;
}
