import { describe, expect, it } from "vitest";
import {
  BOT_PAINT_IDS,
  type BotPaint,
  botDesignSchema,
  TEST_BOT_DESIGN,
} from "@/sim/design";
import { PART_CATALOG } from "@/sim/parts";
import {
  isKnownPaint,
  isPaintId,
  PAINT_SWATCHES,
  paintedColor,
  paintSwatch,
} from "./bot-paint";

describe("paint palette", () => {
  it("is a small fixed set of distinct, named, valid swatches", () => {
    expect(PAINT_SWATCHES.length).toBeGreaterThanOrEqual(6);
    expect(PAINT_SWATCHES.length).toBeLessThanOrEqual(12);
    const ids = new Set(PAINT_SWATCHES.map((s) => s.id));
    const hexes = new Set(PAINT_SWATCHES.map((s) => s.hex.toLowerCase()));
    expect(ids.size).toBe(PAINT_SWATCHES.length);
    expect(hexes.size).toBe(PAINT_SWATCHES.length);
    for (const swatch of PAINT_SWATCHES) {
      expect(swatch.hex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(swatch.name.length).toBeGreaterThan(0);
      expect(isPaintId(swatch.id)).toBe(true);
      expect(paintSwatch(swatch.id)).toBe(swatch);
    }
    expect(paintSwatch("no-such-paint")).toBeNull();
    expect(paintSwatch(undefined)).toBeNull();
  });

  it("paints the body and the trim, and leaves weapons as steel", () => {
    const paint = { primary: "cobalt", accent: "gold" } as const;
    const cobalt = paintSwatch("cobalt")?.hex;
    const gold = paintSwatch("gold")?.hex;
    expect(paintedColor(PART_CATALOG["core-cube"], paint, "#111111")).toBe(
      cobalt,
    );
    expect(paintedColor(PART_CATALOG["frame-plate"], paint, "#111111")).toBe(
      cobalt,
    );
    expect(paintedColor(PART_CATALOG["drive-wheel"], paint, "#111111")).toBe(
      gold,
    );
    expect(paintedColor(PART_CATALOG["saw-blade"], paint, "#c3cad3")).toBe(
      "#c3cad3",
    );
  });

  it("leaves a part in its own look with no paint or an unknown swatch", () => {
    expect(paintedColor(PART_CATALOG["core-cube"], undefined, "#abcdef")).toBe(
      "#abcdef",
    );
    expect(
      paintedColor(
        PART_CATALOG["core-cube"],
        // A paint the schema would refuse, as an old save might carry.
        { primary: "neon", accent: "jade" } as unknown as BotPaint,
        "#abcdef",
      ),
    ).toBe("#abcdef");
    expect(isKnownPaint(undefined)).toBe(false);
    expect(
      isKnownPaint({ primary: "neon", accent: "jade" } as unknown as BotPaint),
    ).toBe(false);
    expect(isKnownPaint({ primary: "ember", accent: "jade" })).toBe(true);
  });

  it("rides the design schema as an optional field the sim never reads", () => {
    const painted = botDesignSchema.safeParse({
      ...TEST_BOT_DESIGN,
      paint: { primary: "ember", accent: "jade" },
    });
    expect(painted.success).toBe(true);
    expect(botDesignSchema.safeParse(TEST_BOT_DESIGN).success).toBe(true);
    // An unknown id is refused even with a complete pair, and a half pair
    // is refused even with known ids.
    expect(
      botDesignSchema.safeParse({
        ...TEST_BOT_DESIGN,
        paint: { primary: "x", accent: "jade" },
      }).success,
    ).toBe(false);
    expect(
      botDesignSchema.safeParse({
        ...TEST_BOT_DESIGN,
        paint: { primary: "ember" },
      }).success,
    ).toBe(false);
    // The swatch table and the schema name the same palette.
    expect(PAINT_SWATCHES.map((swatch) => swatch.id)).toEqual([
      ...BOT_PAINT_IDS,
    ]);
    // Eight fixed swatches is the contract, not just "the same list twice".
    expect(PAINT_SWATCHES).toHaveLength(8);
    expect(BOT_PAINT_IDS).toHaveLength(8);
  });
});
