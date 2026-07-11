/**
 * Surface shift-cycle lighting. The grade math stays pure and allocation-light
 * so the mine and Holodeck can share the same art direction without React
 * state or extra render passes.
 */

export const SURFACE_CYCLE_SECONDS = 8 * 60;
export const SURFACE_LIGHTING_STEP_SECONDS = 0.25;

export interface DaylightGrade {
  /** Directional sun or moon tint as a hex color. */
  sunColor: string;
  /** Multiplier on the celestial key light. */
  sunStrength: number;
  /** Hemisphere sky tint and the clear color at the surface. */
  skyColor: string;
  /** Horizon and surface fog tint. */
  fogColor: string;
  /** Ambient fill tint. */
  ambientColor: string;
  /** Hemisphere bounce tint from the service deck and terrain. */
  groundLightColor: string;
  /** Distant surface ground tint behind the village. */
  groundColor: string;
  /** Surface ambient-light intensity. */
  ambientStrength: number;
  /** Surface hemisphere-light intensity. */
  hemisphereStrength: number;
  /** Multiplier on image-based environment lighting. */
  environmentStrength: number;
  /** Visibility of the existing batched star field. */
  starOpacity: number;
  /** Label exposed for QA and tests. */
  phase: "night" | "dawn" | "day" | "dusk";
}

interface GradeStop extends Omit<DaylightGrade, "phase"> {
  hour: number;
  phase: DaylightGrade["phase"];
}

/**
 * Industrial shift anchors. Dawn and dusk spend the palette's boldness on a
 * copper horizon, while day stays cool enough for graphite and titanium to
 * retain contrast. Night lets cyan power systems and warm work lights lead.
 */
const STOPS: readonly GradeStop[] = [
  {
    hour: 0,
    sunColor: "#abc8ff",
    sunStrength: 0.72,
    skyColor: "#07101e",
    fogColor: "#101d35",
    ambientColor: "#91a9d2",
    groundLightColor: "#182333",
    groundColor: "#151e29",
    ambientStrength: 0.4,
    hemisphereStrength: 0.36,
    environmentStrength: 0.34,
    starOpacity: 1,
    phase: "night",
  },
  {
    hour: 4.75,
    sunColor: "#abc8ff",
    sunStrength: 0.68,
    skyColor: "#0b1829",
    fogColor: "#172c45",
    ambientColor: "#94a9ca",
    groundLightColor: "#202a35",
    groundColor: "#1b252d",
    ambientStrength: 0.4,
    hemisphereStrength: 0.36,
    environmentStrength: 0.35,
    starOpacity: 0.95,
    phase: "night",
  },
  {
    hour: 6.5,
    sunColor: "#ffd0a0",
    sunStrength: 0.82,
    skyColor: "#70566e",
    fogColor: "#d27c63",
    ambientColor: "#abb8c9",
    groundLightColor: "#353a43",
    groundColor: "#343836",
    ambientStrength: 0.42,
    hemisphereStrength: 0.38,
    environmentStrength: 0.48,
    starOpacity: 0.16,
    phase: "dawn",
  },
  {
    hour: 9,
    sunColor: "#fff0ce",
    sunStrength: 0.92,
    skyColor: "#6fa5c2",
    fogColor: "#a7c6ce",
    ambientColor: "#c5d9e2",
    groundLightColor: "#4b5047",
    groundColor: "#465044",
    ambientStrength: 0.49,
    hemisphereStrength: 0.47,
    environmentStrength: 0.82,
    starOpacity: 0,
    phase: "day",
  },
  {
    hour: 13,
    sunColor: "#fff6dc",
    sunStrength: 1,
    skyColor: "#79b5d2",
    fogColor: "#b8d6dc",
    ambientColor: "#d3e1e5",
    groundLightColor: "#53584b",
    groundColor: "#4b5848",
    ambientStrength: 0.5,
    hemisphereStrength: 0.48,
    environmentStrength: 0.86,
    starOpacity: 0,
    phase: "day",
  },
  {
    hour: 16.75,
    sunColor: "#ffe6bd",
    sunStrength: 0.9,
    skyColor: "#78a3b7",
    fogColor: "#b9c1bd",
    ambientColor: "#cdd2ce",
    groundLightColor: "#504d43",
    groundColor: "#4a4e40",
    ambientStrength: 0.48,
    hemisphereStrength: 0.46,
    environmentStrength: 0.78,
    starOpacity: 0,
    phase: "day",
  },
  {
    hour: 19,
    sunColor: "#ffad72",
    sunStrength: 0.84,
    skyColor: "#9b5e61",
    fogColor: "#ee9365",
    ambientColor: "#9ea9bf",
    groundLightColor: "#383844",
    groundColor: "#403a32",
    ambientStrength: 0.38,
    hemisphereStrength: 0.34,
    environmentStrength: 0.46,
    starOpacity: 0.12,
    phase: "dusk",
  },
  {
    hour: 21,
    sunColor: "#b3c8ff",
    sunStrength: 0.52,
    skyColor: "#282443",
    fogColor: "#633c59",
    ambientColor: "#8993bd",
    groundLightColor: "#20202a",
    groundColor: "#202329",
    ambientStrength: 0.38,
    hemisphereStrength: 0.34,
    environmentStrength: 0.35,
    starOpacity: 0.72,
    phase: "dusk",
  },
  {
    hour: 24,
    sunColor: "#abc8ff",
    sunStrength: 0.72,
    skyColor: "#07101e",
    fogColor: "#101d35",
    ambientColor: "#91a9d2",
    groundLightColor: "#182333",
    groundColor: "#151e29",
    ambientStrength: 0.4,
    hemisphereStrength: 0.36,
    environmentStrength: 0.34,
    starOpacity: 1,
    phase: "night",
  },
];

function hexByte(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, "0");
}

function rgb(hex: string): readonly [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixHex(a: string, b: string, t: number): string {
  const from = rgb(a);
  const to = rgb(b);
  return `#${hexByte(mix(from[0], to[0], t))}${hexByte(
    mix(from[1], to[1], t),
  )}${hexByte(mix(from[2], to[2], t))}`;
}

function wrapHour(hours: number): number {
  return ((hours % 24) + 24) % 24;
}

/** Grade for an in-world hour. Fractional and wrapped hours are supported. */
export function daylightGradeFor(hours: number): DaylightGrade {
  const h = wrapHour(hours);
  let from = STOPS[0];
  let to = STOPS[STOPS.length - 1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (h >= STOPS[i].hour && h <= STOPS[i + 1].hour) {
      from = STOPS[i];
      to = STOPS[i + 1];
      break;
    }
  }
  const span = to.hour - from.hour;
  const t = span > 0 ? (h - from.hour) / span : 0;
  return {
    sunColor: mixHex(from.sunColor, to.sunColor, t),
    sunStrength: mix(from.sunStrength, to.sunStrength, t),
    skyColor: mixHex(from.skyColor, to.skyColor, t),
    fogColor: mixHex(from.fogColor, to.fogColor, t),
    ambientColor: mixHex(from.ambientColor, to.ambientColor, t),
    groundLightColor: mixHex(from.groundLightColor, to.groundLightColor, t),
    groundColor: mixHex(from.groundColor, to.groundColor, t),
    ambientStrength: mix(from.ambientStrength, to.ambientStrength, t),
    hemisphereStrength: mix(from.hemisphereStrength, to.hemisphereStrength, t),
    environmentStrength: mix(
      from.environmentStrength,
      to.environmentStrength,
      t,
    ),
    starOpacity: mix(from.starOpacity, to.starOpacity, t),
    phase: t < 0.5 ? from.phase : to.phase,
  };
}

/** Maps wall-clock milliseconds onto the persistent eight-minute cycle. */
export function surfaceCycleHour(nowMs: number): number {
  const cycleMs = SURFACE_CYCLE_SECONDS * 1_000;
  const position = ((nowMs % cycleMs) + cycleMs) % cycleMs;
  return (position / cycleMs) * 24;
}

/** Local clock hour used as the stable reduced-motion fallback. */
export function localClockHour(now: Date): number {
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / (60 * 60);
}

/**
 * Resolves the visible hour. QA overrides always freeze the grade. Reduced
 * motion follows the local clock instead of running the accelerated cycle.
 */
export function surfaceHourFor(
  nowMs: number,
  reducedMotion: boolean,
  localHour: number,
  overrideHour?: number,
): number {
  if (Number.isFinite(overrideHour)) return wrapHour(overrideHour ?? 0);
  return reducedMotion ? wrapHour(localHour) : surfaceCycleHour(nowMs);
}

/** Reuses one directional light as sun by day and moon by night. */
export function celestialPositionFor(
  hours: number,
): readonly [number, number, number] {
  const angle = ((wrapHour(hours) - 6) / 24) * Math.PI * 2;
  const altitude = Math.sin(angle);
  // Keep the key in the camera-facing half-space so metallic facades retain
  // a readable edge on the WebGL2 tier, which deliberately has no IBL.
  return [
    Math.cos(angle) * 4,
    2.2 + Math.abs(altitude) * 5.8,
    6 + Math.abs(altitude) * 2,
  ];
}

/**
 * Depth-tuned fog range: airy near the surface, pressing closer through the
 * deep strata so descent reads as thickening air.
 */
export function fogRangeForStratum(stratumIndex: number): {
  near: number;
  far: number;
} {
  const depth = Math.max(0, stratumIndex);
  return {
    near: Math.max(7.5, 13 - depth * 1.1),
    far: Math.max(17, 29 - depth * 2.2),
  };
}
