/**
 * Surface time-of-day grade (graphics slice G4): the village follows the
 * player's real clock. Pure TypeScript so the palette math is
 * unit-testable; the canvas reads the local hour, this module turns it
 * into a sun tint, a sun strength, and a sky tint that the existing
 * daylight rig multiplies in. Underground is untouched: depth already
 * kills the daylight before these grades matter.
 *
 * Night stays playable by design: the darkest grade keeps most of the
 * light and reads as mood, not obstruction.
 */

export interface DaylightGrade {
  /** Directional sun tint as a hex color. */
  sunColor: string;
  /** Multiplier on the sun's intensity (1 at noon). */
  sunStrength: number;
  /** Hemisphere sky tint as a hex color. */
  skyColor: string;
  /** Label exposed for QA and tests. */
  phase: "night" | "dawn" | "day" | "dusk";
}

interface GradeStop {
  hour: number;
  sunColor: [number, number, number];
  sunStrength: number;
  skyColor: [number, number, number];
  phase: DaylightGrade["phase"];
}

/** Anchor grades around the clock; hours between stops interpolate. */
const STOPS: GradeStop[] = [
  {
    hour: 0,
    sunColor: [158, 180, 232],
    sunStrength: 0.62,
    skyColor: [51, 65, 94],
    phase: "night",
  },
  {
    hour: 5,
    sunColor: [158, 180, 232],
    sunStrength: 0.62,
    skyColor: [51, 65, 94],
    phase: "night",
  },
  {
    hour: 7,
    sunColor: [255, 201, 160],
    sunStrength: 0.85,
    skyColor: [120, 130, 170],
    phase: "dawn",
  },
  {
    hour: 10,
    sunColor: [255, 244, 224],
    sunStrength: 1,
    skyColor: [143, 180, 232],
    phase: "day",
  },
  {
    hour: 16,
    sunColor: [255, 244, 224],
    sunStrength: 1,
    skyColor: [143, 180, 232],
    phase: "day",
  },
  {
    hour: 19,
    sunColor: [255, 176, 112],
    sunStrength: 0.82,
    skyColor: [150, 120, 140],
    phase: "dusk",
  },
  {
    hour: 22,
    sunColor: [158, 180, 232],
    sunStrength: 0.62,
    skyColor: [51, 65, 94],
    phase: "night",
  },
  {
    hour: 24,
    sunColor: [158, 180, 232],
    sunStrength: 0.62,
    skyColor: [51, 65, 94],
    phase: "night",
  },
];

function hexByte(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, "0");
}

function hex(rgb: [number, number, number]): string {
  return `#${hexByte(rgb[0])}${hexByte(rgb[1])}${hexByte(rgb[2])}`;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Grade for a local clock hour (fractional hours welcome, wraps 24). */
export function daylightGradeFor(hours: number): DaylightGrade {
  const h = ((hours % 24) + 24) % 24;
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
    sunColor: hex([
      mix(from.sunColor[0], to.sunColor[0], t),
      mix(from.sunColor[1], to.sunColor[1], t),
      mix(from.sunColor[2], to.sunColor[2], t),
    ]),
    sunStrength: mix(from.sunStrength, to.sunStrength, t),
    skyColor: hex([
      mix(from.skyColor[0], to.skyColor[0], t),
      mix(from.skyColor[1], to.skyColor[1], t),
      mix(from.skyColor[2], to.skyColor[2], t),
    ]),
    phase: t < 0.5 ? from.phase : to.phase,
  };
}

/**
 * Depth-tuned fog range (G4): airy near the surface, pressing closer
 * through the deep strata so descent reads as thickening air. Pure so
 * the curve is unit-testable; the canvas feeds it the stratum index.
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
