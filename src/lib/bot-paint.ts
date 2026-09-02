import type { BotPaint, BotPaintId } from "@/sim/design";
import type { PartDef } from "@/sim/parts";

/**
 * Bot paint (G5, workshop garage program). A bot carries two cosmetic
 * colours chosen from a fixed palette: the body paint on the core and the
 * structure, and the trim on the wheel hubs. Weapons stay bare steel so a
 * blade still reads as a blade from across the arena, and the baked
 * two-tone vertex attribute (dark tread, bright tip, deck line) keeps
 * every part's identity under any paint.
 *
 * Paint lives on the design as palette ids (never hex), so the palette can
 * be retuned without touching a saved bot, and it is never read by the
 * sim: a painted bot and an unpainted one fight byte for byte the same.
 */

export interface PaintSwatch {
  id: BotPaintId;
  name: string;
  /** sRGB hex, the material colour the swatch paints. */
  hex: string;
}

export const PAINT_SWATCHES: readonly PaintSwatch[] = [
  { id: "ember", name: "Ember", hex: "#ff9f43" },
  { id: "crimson", name: "Crimson", hex: "#d94a4a" },
  { id: "cobalt", name: "Cobalt", hex: "#3f7fd6" },
  { id: "jade", name: "Jade", hex: "#3fbf9a" },
  { id: "violet", name: "Violet", hex: "#8c6bd9" },
  { id: "gold", name: "Gold", hex: "#e0b23a" },
  { id: "slate", name: "Slate", hex: "#6b7686" },
  { id: "bone", name: "Bone", hex: "#e6e1d3" },
];

export function paintSwatch(id: string | undefined): PaintSwatch | null {
  if (!id) return null;
  return PAINT_SWATCHES.find((entry) => entry.id === id) ?? null;
}

export function isPaintId(id: string): boolean {
  return paintSwatch(id) !== null;
}

/**
 * The material colour a part renders with under a paint job, given the
 * colour it would render with unpainted. Body paint covers cores and
 * structure, trim covers mobility (the hub, since the tread is a baked
 * multiplier), weapons keep their own steel. An unknown palette id, or no
 * paint at all, leaves the part in its own look.
 */
export function paintedColor(
  def: Pick<PartDef, "category">,
  paint: BotPaint | undefined,
  unpainted: string,
): string {
  if (!paint) return unpainted;
  if (def.category === "core" || def.category === "structure") {
    return paintSwatch(paint.primary)?.hex ?? unpainted;
  }
  if (def.category === "mobility") {
    return paintSwatch(paint.accent)?.hex ?? unpainted;
  }
  return unpainted;
}

/** True when the design's paint names swatches this palette knows. */
export function isKnownPaint(paint: BotPaint | undefined): boolean {
  return (
    paint !== undefined && isPaintId(paint.primary) && isPaintId(paint.accent)
  );
}
