import type { PartCategory, PartDef } from "@/sim/parts";

/**
 * Per-part identity art (G3, parts with faces): the colour, the secondary
 * tone, and the surface response every render site uses for a catalog
 * part. Pure data, no React and no three, so the workshop, the arena, and
 * the node test suite all read the same table.
 *
 * How the two tones reach the screen with ONE meshStandardMaterial per
 * part: the material colour is the base `color`; the geometry builders
 * (part-geometry.ts) bake a per-vertex `color` attribute holding a
 * multiplier of 1 on the primary surface and `tone` on the `region`
 * (rubber tread, spike tip, plate deck, core window band). The material
 * multiplies vertex colour by base colour, so the arena can swap the base
 * for a team colour and the tread still reads dark and the hub light.
 *
 * Tones are linear-space multipliers, so a rubber tread wants a much
 * smaller number than its perceived darkness suggests (0.16 lands near
 * sRGB 0.44 of the base). Keep every tone within [0, 1.5]: below 0 is
 * meaningless and above 1.5 a bright tip blows out to white under the
 * studio key light.
 */

/**
 * Which surface of a part carries the secondary tone. Each geometry
 * builder honours the regions that make sense for its form and ignores
 * the rest (an unknown part with a "tread" region on a box still renders,
 * just in one tone):
 * - none: single tone, no vertex colours.
 * - deck: the +y top face of a box (plates).
 * - band: a horizontal window band around a box's sides (cores).
 * - ends: the +x and -x tips of a wide box (spinner bar).
 * - front: the -z face of a box (plow, armor wedge, spin mount).
 * - tip: the tapered -z tip of a spike.
 * - tread: the outer ring of a tire or drum, hub stays primary.
 * - arbor: the centre of a toothed disc, rim stays primary.
 * - shaft: the thin shaft of a column between its collars.
 * - poles: the polar mount flats of a machined ball.
 */
export type PartToneRegion =
  | "none"
  | "deck"
  | "band"
  | "ends"
  | "front"
  | "tip"
  | "tread"
  | "arbor"
  | "shaft"
  | "poles";

/** The two-tone request a geometry builder receives. */
export interface PartAccent {
  region: PartToneRegion;
  /** Linear multiplier applied to the region's vertices; 1 means no
   * second tone and the builder skips the attribute. */
  tone: number;
}

export interface PartLook extends PartAccent {
  /** Base colour (sRGB hex), the material colour in the workshop. */
  color: string;
  metalness: number;
  roughness: number;
  /** Idle emissive intensity, multiplied by the material colour. */
  emissiveBoost: number;
}

export const MAX_PART_TONE = 1.5;

/**
 * Category fallback: what an unknown or future part renders as until it
 * gets its own row. The colours are the workshop's original category
 * palette, so an unnamed part never renders black and still reads as its
 * category from across the arena; the idle slot markers borrow them too.
 */
export const CATEGORY_LOOK: Record<PartCategory, PartLook> = {
  core: {
    color: "#ff9f43",
    region: "band",
    tone: 1.3,
    metalness: 0.5,
    roughness: 0.3,
    emissiveBoost: 0.35,
  },
  structure: {
    color: "#a3b1cc",
    region: "deck",
    tone: 1.1,
    metalness: 0.72,
    roughness: 0.38,
    emissiveBoost: 0,
  },
  mobility: {
    color: "#54e0c7",
    region: "tread",
    tone: 0.2,
    metalness: 0.05,
    roughness: 0.9,
    emissiveBoost: 0,
  },
  weapon: {
    color: "#ff6b6b",
    region: "none",
    tone: 1,
    metalness: 0.9,
    roughness: 0.18,
    emissiveBoost: 0.08,
  },
};

/**
 * The catalog's faces. Direction: cores are the warm glowing units (each
 * its own warmth), structure is painted or bare metal in distinct
 * weights, mobility is near-black rubber over a lighter hub, weapons are
 * bare steel from bright ground to dark iron with the striking surface
 * called out by the tone.
 */
export const PART_LOOKS: Record<string, PartLook> = {
  // Cores: a bright equator band reads as the power window.
  "core-cube": {
    color: "#ff9f43",
    region: "band",
    tone: 1.35,
    metalness: 0.45,
    roughness: 0.32,
    emissiveBoost: 0.35,
  },
  "wedge-core": {
    color: "#f26a3d",
    region: "band",
    tone: 1.35,
    metalness: 0.45,
    roughness: 0.3,
    emissiveBoost: 0.32,
  },
  "tower-core": {
    color: "#f4b53c",
    region: "band",
    tone: 1.3,
    metalness: 0.45,
    roughness: 0.34,
    emissiveBoost: 0.3,
  },
  // Structure: plates carry a lighter machined top deck.
  "frame-plate": {
    color: "#b7c1cf",
    region: "deck",
    tone: 1.12,
    metalness: 0.72,
    roughness: 0.4,
    emissiveBoost: 0,
  },
  // Gunmetal, but not so metallic that it mirrors the dark studio and
  // reads black: darker than the frame plate by paint, not by absence.
  "hardened-plate": {
    color: "#6a7280",
    region: "deck",
    tone: 1.2,
    metalness: 0.72,
    roughness: 0.34,
    emissiveBoost: 0,
  },
  "cross-frame": {
    color: "#8794a8",
    region: "deck",
    tone: 1.1,
    metalness: 0.72,
    roughness: 0.42,
    emissiveBoost: 0,
  },
  "mast-pole": {
    color: "#cfd4db",
    region: "shaft",
    tone: 0.78,
    metalness: 0.8,
    roughness: 0.28,
    emissiveBoost: 0,
  },
  "sensor-head": {
    color: "#a6d8f0",
    region: "poles",
    tone: 0.55,
    metalness: 0.35,
    roughness: 0.18,
    emissiveBoost: 0.12,
  },
  "spin-mount": {
    color: "#5d6575",
    region: "front",
    tone: 1.3,
    metalness: 0.65,
    roughness: 0.4,
    emissiveBoost: 0,
  },
  "armor-wedge": {
    color: "#7f8a4e",
    region: "front",
    tone: 1.15,
    metalness: 0.55,
    roughness: 0.5,
    emissiveBoost: 0,
  },
  // Mobility: the base colour is the hub, the tread multiplies down to
  // rubber, so a team colour in the arena still gives a dark tread.
  "drive-wheel": {
    color: "#7e8894",
    region: "tread",
    tone: 0.16,
    metalness: 0.15,
    roughness: 0.85,
    emissiveBoost: 0,
  },
  "roller-drum": {
    color: "#6a7482",
    region: "tread",
    tone: 0.2,
    metalness: 0.12,
    roughness: 0.9,
    emissiveBoost: 0,
  },
  // Weapons: bare steel, the striking surface brightest.
  "ram-spike": {
    color: "#d9dee5",
    region: "tip",
    tone: 1.3,
    metalness: 0.9,
    roughness: 0.2,
    emissiveBoost: 0.06,
  },
  "plow-blade": {
    color: "#c9b79a",
    region: "front",
    tone: 1.15,
    metalness: 0.85,
    roughness: 0.3,
    emissiveBoost: 0.05,
  },
  "hammer-head": {
    color: "#666c76",
    region: "poles",
    tone: 1.35,
    metalness: 0.8,
    roughness: 0.42,
    emissiveBoost: 0.04,
  },
  // Ground steel, held just under the studio's blow-out point so the
  // face-on disc stays a bright grey with visible teeth, not a white card.
  "saw-blade": {
    color: "#c3cad3",
    region: "arbor",
    tone: 0.5,
    metalness: 0.9,
    roughness: 0.24,
    emissiveBoost: 0.06,
  },
  "spinner-bar": {
    color: "#7d93b3",
    region: "ends",
    tone: 1.4,
    metalness: 0.9,
    roughness: 0.22,
    emissiveBoost: 0.08,
  },
};

/** The look for a part, falling back to its category so a part that is
 * not in the table (a future catalog wave) still renders in colour. */
export function partLook(def: PartDef): PartLook {
  return PART_LOOKS[def.id] ?? CATEGORY_LOOK[def.category];
}

/** The two-tone request for a part's geometry builder. */
export function partAccent(def: PartDef): PartAccent {
  const look = partLook(def);
  return { region: look.region, tone: look.tone };
}
