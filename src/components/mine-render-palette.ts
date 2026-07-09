import { Color } from "three/webgpu";
import {
  biomeAt,
  type MineBiomeId,
  type OreId,
  STRATA,
  stratumAt,
} from "@/sim/mine";

export const ORE_COLORS: Record<OreId, string> = {
  coal: "#33343a",
  copper: "#c77b3f",
  silver: "#cfd6e0",
  emerald: "#2ecc71",
  ruby: "#e03358",
  diamond: "#8fe9f2",
  "core-crystal": "#b04df0",
  "frozen-coal": "#3d4f66",
  "frost-copper": "#b7d2dc",
  "rime-silver": "#e4f7ff",
  "aurora-emerald": "#7fffd4",
  "glacier-ruby": "#ff7fb0",
  "blue-diamond": "#9ee7ff",
  "permafrost-core": "#d6f8ff",
  "brass-knob": "#d8a24a",
  "wire-spool": "#ff7a45",
  "logic-chip": "#5df2a4",
  "micro-monitor": "#7aa8ff",
  "keyboard-matrix": "#e6e8ee",
  "servo-motor": "#a2b0c7",
  "quantum-core": "#65ffb8",
};

/** Rare tiers glow so a glimpse at the light's edge reads as treasure. */
export const GLOWING_ORES = new Set<OreId>([
  "diamond",
  "core-crystal",
  "blue-diamond",
  "permafrost-core",
  "micro-monitor",
  "quantum-core",
]);

export const cellX = (col: number) => col;

/** Dirt palette per stratum, in STRATA order (REQ-012: visible descent).
 * Exported so the material warm-up can pre-compile every dirt tint. */
export const STRATA_DIRT = [
  "#7a5a3a",
  "#8c5a45",
  "#6e6862",
  "#4f5d6e",
  "#5a3a35",
  "#4a4448",
  "#2f2c33",
  "#3a4452",
  "#52303f",
];
/** Winter and high-tech dirt bands, deepening every few strata. */
export const WINTER_DIRT_BAND = ["#dcecf3", "#c9dbe5", "#b6ccd8", "#9eb7c6"];
export const TECH_DIRT_BAND = ["#193a32", "#143742", "#202e4d", "#24305b"];
/** Background deepens with the strata so descent reads at the edges. */
export const STRATA_BG = [
  "#0b0e14",
  "#0d0c12",
  "#0a0a10",
  "#070a12",
  "#100809",
  "#0c0a0e",
  "#060608",
  "#05080d",
  "#120608",
];

/** Rock darkens by tier so the hard gates read at a glance. Reached
 * through rockColorsForBiome; the warm-up enumerates via that accessor. */
const ROCK_COLORS = ["#555e6e", "#46506a", "#3b3550"];
const WINTER_ROCK_COLORS = ["#9fb5c8", "#7f9fb8", "#637f9a"];
const TECH_ROCK_COLORS = ["#23483e", "#253f58", "#2b3568"];
export const CACHE_COLOR = "#f5c542";
export const BOULDER_COLOR = "#8a7f70";
export const BOULDER_WOBBLE_COLOR = "#b59f82";
export const METAL_COLOR = "#9aa4b2";
/** Warm warning glow on a rock or boulder that is about to drop. */
export const TEETER_EMISSIVE = "#d9863a";
export const GAS_COLOR = "#8fa32e";
export const MAGMA_COLOR = "#ff5a2e";

/** Depth (in rows) at which the lighting reaches full darkness. */
export const DARK_DEPTH = 14;

function dirtColorAt(row: number): string {
  const index = STRATA.indexOf(stratumAt(row));
  return STRATA_DIRT[Math.min(index, STRATA_DIRT.length - 1)];
}

export function biomeDirtColorAt(col: number, row: number): string {
  const biome = biomeAt(col);
  if (biome === "winter") {
    return WINTER_DIRT_BAND[
      Math.min(Math.floor(row / 24), WINTER_DIRT_BAND.length - 1)
    ];
  }
  if (biome === "highTech") {
    return TECH_DIRT_BAND[
      Math.min(Math.floor(row / 28), TECH_DIRT_BAND.length - 1)
    ];
  }
  return dirtColorAt(row);
}

export function rockColorsForBiome(biome: MineBiomeId): readonly string[] {
  if (biome === "winter") return WINTER_ROCK_COLORS;
  if (biome === "highTech") return TECH_ROCK_COLORS;
  return ROCK_COLORS;
}

export function tunnelColorForBiome(biome: MineBiomeId): string {
  if (biome === "winter") return "#152532";
  if (biome === "highTech") return "#071f1b";
  return "#15120e";
}

export function surfaceColorForBiome(biome: MineBiomeId): string {
  if (biome === "winter") return "#d7edf6";
  if (biome === "highTech") return "#1f4f46";
  return "#3d5c3a";
}

export function surfaceTrimColorForBiome(biome: MineBiomeId): string {
  if (biome === "winter") return "#eefbff";
  if (biome === "highTech") return "#5ff0a8";
  return "#4f7a4a";
}

/**
 * Stable per-cell randomness for visual variation. Render-layer only;
 * deterministic per (col, row, salt) so blocks do not shimmer when the
 * scene re-renders on every action tick.
 */
export function cellHash(col: number, row: number, salt: number): number {
  let h = (col * 374761393 + row * 668265263 + salt * 1274126177) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Lightness-jittered variant of a base color, stable per cell. */
export function variedColor(base: string, col: number, row: number): Color {
  const c = new Color(base);
  c.offsetHSL(0, 0, (cellHash(col, row, 5) - 0.5) * 0.1);
  return c;
}
