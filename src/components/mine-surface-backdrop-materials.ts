import { Color, MeshBasicMaterial } from "three/webgpu";
import type { SurfaceBackdropRole } from "./mine-surface-backdrop";
import type { DaylightGrade } from "./time-of-day";

const backdropMaterials: Record<SurfaceBackdropRole, MeshBasicMaterial> = {
  sky: new MeshBasicMaterial({
    color: "#79b5d2",
    vertexColors: true,
    fog: false,
    depthWrite: false,
  }),
  celestial: new MeshBasicMaterial({
    color: "#d9c3a4",
    vertexColors: true,
    fog: false,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  }),
  farTerrain: new MeshBasicMaterial({
    color: "#71848a",
    vertexColors: true,
    fog: true,
  }),
  industry: new MeshBasicMaterial({
    color: "#273139",
    vertexColors: true,
    fog: true,
  }),
  nearBerm: new MeshBasicMaterial({
    color: "#26302a",
    vertexColors: true,
    fog: true,
  }),
};

const fogScratch = new Color();
const groundScratch = new Color();
const skyScratch = new Color();
const sunScratch = new Color();
const mixScratch = new Color();
let lastSkyColor = "";
let lastFogColor = "";
let lastGroundColor = "";
let lastSunColor = "";
let lastPhase: DaylightGrade["phase"] | "" = "";

export function surfaceBackdropMaterial(
  role: SurfaceBackdropRole,
): MeshBasicMaterial {
  return backdropMaterials[role];
}

/**
 * Updates five shared unlit materials in place. The distant landscape never
 * enters the light or shadow count, and the WebGL2 tier pays the same shader
 * recipes at every phase of the cycle.
 */
export function applySurfaceBackdropGrade(grade: DaylightGrade): void {
  if (
    grade.skyColor === lastSkyColor &&
    grade.fogColor === lastFogColor &&
    grade.groundColor === lastGroundColor &&
    grade.sunColor === lastSunColor &&
    grade.phase === lastPhase
  ) {
    return;
  }

  skyScratch.set(grade.skyColor);
  fogScratch.set(grade.fogColor);
  groundScratch.set(grade.groundColor);
  sunScratch.set(grade.sunColor);

  backdropMaterials.sky.color.copy(skyScratch);
  backdropMaterials.farTerrain.color
    .copy(fogScratch)
    .lerp(groundScratch, 0.34)
    .multiplyScalar(0.88);
  backdropMaterials.industry.color
    .copy(groundScratch)
    .lerp(skyScratch, 0.08)
    .multiplyScalar(0.54);
  backdropMaterials.nearBerm.color.copy(groundScratch).multiplyScalar(0.62);
  mixScratch.copy(sunScratch).lerp(skyScratch, 0.28);
  backdropMaterials.celestial.color.copy(mixScratch);
  backdropMaterials.celestial.opacity =
    grade.phase === "day" ? 0.34 : grade.phase === "night" ? 0.78 : 0.62;

  lastSkyColor = grade.skyColor;
  lastFogColor = grade.fogColor;
  lastGroundColor = grade.groundColor;
  lastSunColor = grade.sunColor;
  lastPhase = grade.phase;
}

export function resetSurfaceBackdropGradeForTests(): void {
  lastSkyColor = "";
  lastFogColor = "";
  lastGroundColor = "";
  lastSunColor = "";
  lastPhase = "";
}
