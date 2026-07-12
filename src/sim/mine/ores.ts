import type { MineBiomeId } from "./biomes";
import type { MineGear } from "./gear";
import { cellRandom } from "./random";

/**
 * Ore tiers (REQ-011): richer tiers have stronger reserves and modest
 * whole-vibe chunk values, each living in a depth band with overlap (trapezoid ramp:
 * fade in from minRow, full strength peakStart..peakEnd, fade out to
 * maxRow). After the main band, old tiers keep a low trace chance so
 * deeper rows still contain earlier resources, but as larger stacks.
 */
export type OreId =
  | "coal"
  | "copper"
  | "silver"
  | "emerald"
  | "ruby"
  | "diamond"
  | "core-crystal"
  | "frozen-coal"
  | "frost-copper"
  | "rime-silver"
  | "aurora-emerald"
  | "glacier-ruby"
  | "blue-diamond"
  | "permafrost-core"
  | "brass-knob"
  | "wire-spool"
  | "logic-chip"
  | "micro-monitor"
  | "keyboard-matrix"
  | "servo-motor"
  | "quantum-core";

export interface OreDef {
  id: OreId;
  name: string;
  /** Vibes paid for one mined unit when banked. */
  value: number;
  biome: MineBiomeId;
  minRow: number;
  peakStart: number;
  peakEnd: number;
  /** Infinity = present all the way down. */
  maxRow: number;
  peakChance: number;
}

export const ORES: readonly OreDef[] = [
  {
    id: "coal",
    name: "Coal",
    value: 1,
    biome: "default",
    minRow: 1,
    peakStart: 1,
    peakEnd: 12,
    maxRow: 24,
    peakChance: 0.09,
  },
  {
    id: "copper",
    name: "Copper",
    value: 1,
    biome: "default",
    minRow: 4,
    peakStart: 8,
    peakEnd: 20,
    maxRow: 30,
    peakChance: 0.07,
  },
  {
    id: "silver",
    name: "Silver",
    value: 1,
    biome: "default",
    minRow: 14,
    peakStart: 20,
    peakEnd: 34,
    maxRow: 44,
    peakChance: 0.06,
  },
  {
    id: "emerald",
    name: "Emerald",
    value: 1,
    biome: "default",
    minRow: 24,
    peakStart: 32,
    peakEnd: 46,
    maxRow: 58,
    peakChance: 0.05,
  },
  {
    id: "ruby",
    name: "Ruby",
    value: 2,
    biome: "default",
    minRow: 36,
    peakStart: 44,
    peakEnd: 58,
    maxRow: 72,
    peakChance: 0.04,
  },
  {
    id: "diamond",
    name: "Diamond",
    value: 3,
    biome: "default",
    minRow: 48,
    peakStart: 58,
    peakEnd: 76,
    maxRow: 92,
    peakChance: 0.03,
  },
  {
    id: "core-crystal",
    name: "Core Crystal",
    value: 4,
    biome: "default",
    minRow: 64,
    peakStart: 80,
    peakEnd: Number.POSITIVE_INFINITY,
    maxRow: Number.POSITIVE_INFINITY,
    peakChance: 0.025,
  },
  {
    id: "frozen-coal",
    name: "Frozen Coal",
    value: 1,
    biome: "winter",
    minRow: 1,
    peakStart: 1,
    peakEnd: 12,
    maxRow: 24,
    peakChance: 0.09,
  },
  {
    id: "frost-copper",
    name: "Frost Copper",
    value: 1,
    biome: "winter",
    minRow: 4,
    peakStart: 8,
    peakEnd: 20,
    maxRow: 30,
    peakChance: 0.07,
  },
  {
    id: "rime-silver",
    name: "Rime Silver",
    value: 1,
    biome: "winter",
    minRow: 14,
    peakStart: 20,
    peakEnd: 34,
    maxRow: 44,
    peakChance: 0.055,
  },
  {
    id: "aurora-emerald",
    name: "Aurora Emerald",
    value: 1,
    biome: "winter",
    minRow: 24,
    peakStart: 32,
    peakEnd: 46,
    maxRow: 58,
    peakChance: 0.05,
  },
  {
    id: "glacier-ruby",
    name: "Glacier Ruby",
    value: 2,
    biome: "winter",
    minRow: 36,
    peakStart: 44,
    peakEnd: 58,
    maxRow: 72,
    peakChance: 0.035,
  },
  {
    id: "blue-diamond",
    name: "Blue Diamond",
    value: 3,
    biome: "winter",
    minRow: 48,
    peakStart: 58,
    peakEnd: 76,
    maxRow: 92,
    peakChance: 0.026,
  },
  {
    id: "permafrost-core",
    name: "Permafrost Core",
    value: 5,
    biome: "winter",
    minRow: 64,
    peakStart: 80,
    peakEnd: Number.POSITIVE_INFINITY,
    maxRow: Number.POSITIVE_INFINITY,
    peakChance: 0.022,
  },
  {
    id: "brass-knob",
    name: "Brass Knob",
    value: 1,
    biome: "highTech",
    minRow: 1,
    peakStart: 1,
    peakEnd: 12,
    maxRow: 24,
    peakChance: 0.09,
  },
  {
    id: "wire-spool",
    name: "Wire Spool",
    value: 1,
    biome: "highTech",
    minRow: 4,
    peakStart: 8,
    peakEnd: 20,
    maxRow: 30,
    peakChance: 0.07,
  },
  {
    id: "logic-chip",
    name: "Logic Chip",
    value: 1,
    biome: "highTech",
    minRow: 14,
    peakStart: 20,
    peakEnd: 34,
    maxRow: 44,
    peakChance: 0.055,
  },
  {
    id: "micro-monitor",
    name: "Micro Monitor",
    value: 1,
    biome: "highTech",
    minRow: 24,
    peakStart: 32,
    peakEnd: 46,
    maxRow: 58,
    peakChance: 0.045,
  },
  {
    id: "keyboard-matrix",
    name: "Keyboard Matrix",
    value: 2,
    biome: "highTech",
    minRow: 36,
    peakStart: 44,
    peakEnd: 58,
    maxRow: 72,
    peakChance: 0.036,
  },
  {
    id: "servo-motor",
    name: "Servo Motor",
    value: 3,
    biome: "highTech",
    minRow: 48,
    peakStart: 58,
    peakEnd: 76,
    maxRow: 92,
    peakChance: 0.026,
  },
  {
    id: "quantum-core",
    name: "Quantum Core",
    value: 5,
    biome: "highTech",
    minRow: 64,
    peakStart: 80,
    peakEnd: Number.POSITIVE_INFINITY,
    maxRow: Number.POSITIVE_INFINITY,
    peakChance: 0.021,
  },
];

export const ORE_BY_ID = new Map(ORES.map((ore) => [ore.id, ore]));

const ORE_IDS_BY_BIOME: Record<MineBiomeId, readonly OreId[]> = {
  default: [
    "coal",
    "copper",
    "silver",
    "emerald",
    "ruby",
    "diamond",
    "core-crystal",
  ],
  winter: [
    "frozen-coal",
    "frost-copper",
    "rime-silver",
    "aurora-emerald",
    "glacier-ruby",
    "blue-diamond",
    "permafrost-core",
  ],
  highTech: [
    "brass-knob",
    "wire-spool",
    "logic-chip",
    "micro-monitor",
    "keyboard-matrix",
    "servo-motor",
    "quantum-core",
  ],
};

export function oreIdsForBiome(biome: MineBiomeId): readonly OreId[] {
  return ORE_IDS_BY_BIOME[biome];
}

export function oreValueTier(id: OreId): number {
  const ids = oreIdsForBiome(oreDef(id).biome);
  const tier = ids.indexOf(id);
  return tier >= 0 ? tier : 0;
}

const ORE_BASE_RESERVES: Record<OreId, number> = {
  coal: 4,
  copper: 5,
  silver: 7,
  emerald: 9,
  ruby: 12,
  diamond: 18,
  "core-crystal": 28,
  "frozen-coal": 4,
  "frost-copper": 5,
  "rime-silver": 6,
  "aurora-emerald": 9,
  "glacier-ruby": 11,
  "blue-diamond": 17,
  "permafrost-core": 27,
  "brass-knob": 4,
  "wire-spool": 5,
  "logic-chip": 6,
  "micro-monitor": 8,
  "keyboard-matrix": 11,
  "servo-motor": 16,
  "quantum-core": 26,
};

export function oreDef(id: OreId): OreDef {
  const def = ORE_BY_ID.get(id);
  if (!def) throw new Error(`unknown ore: ${id}`);
  return def;
}

export function oreBaseReserve(id: OreId): number {
  return ORE_BASE_RESERVES[id];
}

export function oreReserveAt(id: OreId, row: number): number {
  return oreBaseReserve(id) * oreUnitsAt(row);
}

export function oreCellValueAt(id: OreId, row: number): number {
  return oreReserveAt(id, row) * oreDef(id).value;
}

export function oreSwingYield(
  seed: number,
  gear: Pick<MineGear, "pickaxe">,
  id: OreId,
  row: number,
  col: number,
  remainingBeforeSwing: number,
): number {
  const reserve = oreReserveAt(id, row);
  const swingIndex = Math.max(0, reserve - remainingBeforeSwing);
  const tier = oreValueTier(id);
  const depthBonus = oreUnitsAt(row) - 1;
  const pickaxeBonus = Math.max(0, gear.pickaxe - 1);
  const richness = tier + depthBonus + pickaxeBonus;
  const missChance = Math.max(0.06, 0.22 - richness * 0.012);
  const rollSalt = 0x4f524500 ^ Math.imul(swingIndex + 1, 0x9e3779b1);
  if (
    remainingBeforeSwing > 1 &&
    cellRandom(seed, row, col, rollSalt) < missChance
  ) {
    return 0;
  }

  const maxBurst = Math.min(
    remainingBeforeSwing,
    1 + Math.floor((tier + 1) / 2) + Math.floor(depthBonus / 2) + pickaxeBonus,
  );
  let units = 1;
  for (let bonus = 0; units < maxBurst; bonus++) {
    const chance = Math.max(
      0.07,
      0.32 +
        tier * 0.025 +
        depthBonus * 0.018 +
        pickaxeBonus * 0.02 -
        bonus * 0.13,
    );
    const salt =
      0x5949454c ^
      Math.imul(swingIndex + 1, 0x85ebca6b) ^
      Math.imul(bonus + 1, 0xc2b2ae35);
    if (cellRandom(seed, row, col, salt) >= chance) break;
    units++;
  }
  return units;
}

/**
 * The shallowest rows carry an ore-density bonus so early trips surface a
 * reward quickly (F-060). Without it the first couple rows are almost all
 * dirt: only tier-0 coal reaches these rows, and its band barely opens.
 * The multiplier peaks at row 1 and tapers to 1 by EARLY_ORE_BOOST_ROWS,
 * so nothing past the opening cut is enriched.
 */
export const EARLY_ORE_BOOST_ROWS = 3;
export const EARLY_ORE_BOOST_PEAK = 2.1;

export function earlyOreBoost(row: number): number {
  if (row < 1 || row > EARLY_ORE_BOOST_ROWS) return 1;
  // 1 at row 1, 0 at EARLY_ORE_BOOST_ROWS.
  const t = (EARLY_ORE_BOOST_ROWS - row) / (EARLY_ORE_BOOST_ROWS - 1);
  return 1 + (EARLY_ORE_BOOST_PEAK - 1) * t;
}

/** Post-band trace: old tiers keep this share of their peak chance below
 * maxRow, so deeper rows still carry earlier resources as larger stacks. */
export const ORE_TRACE_SHARE = 0.06;

/** Trapezoid band ramp: 0 above the band, linear fade in, 1 across the
 * peak, then a fade out that bottoms on the trace floor instead of dying
 * at zero (F-041: the taper used to hit exactly 0 at maxRow and jump
 * back up to the trace one row later, leaving a one-row dead zone and a
 * discontinuity at every band boundary). */
export function oreChanceAt(ore: OreDef, row: number): number {
  if (row < ore.minRow) return 0;
  const trace = ore.peakChance * ORE_TRACE_SHARE;
  if (row > ore.maxRow) return trace;
  if (row < ore.peakStart)
    return (ore.peakChance * (row - ore.minRow)) / (ore.peakStart - ore.minRow);
  if (row <= ore.peakEnd) return ore.peakChance;
  return Math.max(
    trace,
    (ore.peakChance * (ore.maxRow - row)) / (ore.maxRow - ore.peakEnd),
  );
}

const ORE_UNIT_STEPS: ReadonlyArray<{ minRow: number; units: number }> = [
  { minRow: 1000, units: 12 },
  { minRow: 760, units: 10 },
  { minRow: 580, units: 8 },
  { minRow: 420, units: 6 },
  { minRow: 280, units: 4 },
  { minRow: 160, units: 3 },
  { minRow: 80, units: 2 },
];

/** Ore chunks yielded by one ore cell at this row. */
export function oreUnitsAt(row: number): number {
  for (const step of ORE_UNIT_STEPS) {
    if (row >= step.minRow) return step.units;
  }
  return 1;
}

/** Named strata (REQ-012): every band has its own look and stamp goal. */
export interface Stratum {
  name: string;
  startRow: number;
}

export const STRATA: readonly Stratum[] = [
  { name: "Topsoil", startRow: 0 },
  { name: "Clay Beds", startRow: 12 },
  { name: "Old Granite", startRow: 24 },
  { name: "Glow Caverns", startRow: 36 },
  { name: "Magma Verge", startRow: 48 },
  { name: "Ashfall Galleries", startRow: 64 },
  { name: "The Black Seam", startRow: 84 },
  { name: "Echo Vaults", startRow: 110 },
  { name: "Core Approach", startRow: 140 },
  { name: "Crystal Foundry", startRow: 220 },
  { name: "Pressure Cathedral", startRow: 340 },
  { name: "Ion Mantle", startRow: 500 },
  { name: "Sunken Circuit", startRow: 680 },
  { name: "Depth 1000 Gate", startRow: 880 },
];

export function stratumAt(row: number): Stratum {
  let current = STRATA[0];
  for (const stratum of STRATA) {
    if (row >= stratum.startRow) current = stratum;
  }
  return current;
}
