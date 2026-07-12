/**
 * Graphics quality tiers (graphics pipeline slice G1). One knob every
 * render feature keys off: phones default to "low" (the forced-WebGL2
 * coarse-pointer path), everything else to "high". Players can pin a
 * tier from settings; "auto" re-detects per device.
 *
 * Kept renderer-free so both canvas components and settings UI can use
 * it, and unit-testable without a DOM (the detection reads matchMedia
 * through an injectable probe).
 */

export type GraphicsQualityTier = "low" | "high";
export type GraphicsQualitySetting = "auto" | GraphicsQualityTier;

export const GRAPHICS_QUALITY_STORAGE_KEY = "vibebots-graphics-quality-v1";

export const GRAPHICS_QUALITY_OPTIONS: readonly {
  value: GraphicsQualitySetting;
  label: string;
}[] = [
  { value: "auto", label: "Auto (device)" },
  { value: "high", label: "High" },
  { value: "low", label: "Low (battery saver)" },
] as const;

export function parseGraphicsQualitySetting(
  raw: string | null,
): GraphicsQualitySetting {
  return raw === "low" || raw === "high" || raw === "auto" ? raw : "auto";
}

/** Coarse pointers are the phones we force onto the WebGL2 backend; they
 * get the low tier unless the player pins high. */
export function detectGraphicsQualityTier(
  coarsePointer: boolean,
): GraphicsQualityTier {
  return coarsePointer ? "low" : "high";
}

export function resolveGraphicsQualityTier(
  setting: GraphicsQualitySetting,
  coarsePointer: boolean,
): GraphicsQualityTier {
  if (setting === "auto") return detectGraphicsQualityTier(coarsePointer);
  return setting;
}

/** Per-tier render feature switches for slice G1. Later slices extend
 * this shape rather than sprinkling tier conditionals in scenes. */
export interface GraphicsFeatures {
  /** Renderer shadow maps enabled at all. */
  shadows: boolean;
  /** Shadow map resolution for the surface sun. */
  sunShadowMapSize: number;
  /** Environment (IBL) intensity applied to scenes. */
  environmentIntensity: number;
  /** TSL post stack (bloom + vignette grade), G3. WebGPU-backend
   * scenes additionally require the live backend check before
   * mounting it. */
  postBloom: boolean;
  /** The mine's fixed accent-light pool (F-077). Off on the low tier:
   * real-phone telemetry (build 276751, arm valhall) put snapshots with
   * the pool's 5-8 lights at 25.0ms p95 vs 20.0ms with the base 3-4,
   * so three extra always-on point lights overrun the low tier's frame
   * budget. The flag is fixed per session, keeping the light count
   * constant either way (the F-075 no-recompile invariant). */
  accentLights: boolean;
  /** Upper bound on the canvas device-pixel ratio. The low tier serves
   * phones on the WebGL2 backend where pixel fill is the frame-time and
   * thermal-throttling cost (real-phone telemetry, F-074/F-075 follow-up:
   * a 448x923 CSS viewport at DPR 2.25 shades about 2.1M pixels a frame).
   * Capping the low tier at 1.5 roughly halves that with only a modest
   * sharpness loss on a small screen; the high tier keeps 2. */
  maxDpr: number;
}

export function graphicsFeaturesFor(
  tier: GraphicsQualityTier,
): GraphicsFeatures {
  if (tier === "low") {
    // No IBL on the low tier: phones ride the WebGL2 backend, where any
    // environment texture triggers a runtime pre-filter stall, and even
    // an in-shader fresnel stand-in proved too heavy for the weakest
    // GPUs this tier serves (G2). Reflectivity is a high-tier feature.
    return {
      shadows: false,
      sunShadowMapSize: 512,
      environmentIntensity: 0,
      postBloom: false,
      accentLights: false,
      maxDpr: 1.5,
    };
  }
  return {
    shadows: true,
    sunShadowMapSize: 2048,
    environmentIntensity: 0.6,
    postBloom: true,
    accentLights: true,
    maxDpr: 2,
  };
}

export function readStoredGraphicsQuality(): GraphicsQualitySetting {
  if (typeof window === "undefined") return "auto";
  try {
    return parseGraphicsQualitySetting(
      window.localStorage.getItem(GRAPHICS_QUALITY_STORAGE_KEY),
    );
  } catch {
    return "auto";
  }
}

export function persistGraphicsQuality(setting: GraphicsQualitySetting): void {
  try {
    window.localStorage.setItem(GRAPHICS_QUALITY_STORAGE_KEY, setting);
  } catch {
    // Storage can be unavailable (private mode); the setting just
    // does not persist.
  }
}

/** True when the renderer is actually running on the WebGPU backend.
 * Pointer type approximates the device class, but capability gates
 * (shadow passes, runtime PMREM) must check the real backend: headless
 * and software-GL environments are fine-pointer yet GPU-weak, and the
 * WebGL2 fallback serves exactly the machines that cannot afford the
 * extra passes. */
export function isWebGPUBackend(gl: object): boolean {
  const backend = (gl as { backend?: { isWebGPUBackend?: boolean } }).backend;
  return backend?.isWebGPUBackend === true;
}

/** Matches the coarse-pointer probe used by the renderer factory. */
export function hasCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.matchMedia?.("(pointer: coarse)").matches ?? false)
  );
}
