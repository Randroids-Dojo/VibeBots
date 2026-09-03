import { describe, expect, it } from "vitest";
import {
  PART_CATALOG,
  type PartCategory,
  type PartDef,
  partCategorySchema,
} from "@/sim/parts";
import {
  CATEGORY_LOOK,
  MAX_PART_TONE,
  PART_LOOKS,
  type PartLook,
  type PartToneRegion,
  partAccent,
  partLook,
} from "./part-look";

const HEX = /^#[0-9a-f]{6}$/;
const REGIONS: readonly PartToneRegion[] = [
  "none",
  "deck",
  "band",
  "ends",
  "front",
  "tip",
  "tread",
  "arbor",
  "shaft",
  "poles",
];

function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function expectSaneLook(look: PartLook) {
  expect(look.color).toMatch(HEX);
  // Never black, never white: the base has to survive both the workshop
  // studio and the arena's darkening damage char.
  const [r, g, b] = channels(look.color);
  expect(Math.max(r, g, b)).toBeGreaterThanOrEqual(0x40);
  expect(Math.min(r, g, b)).toBeLessThanOrEqual(0xf0);
  expect(REGIONS).toContain(look.region);
  expect(look.tone).toBeGreaterThanOrEqual(0);
  expect(look.tone).toBeLessThanOrEqual(MAX_PART_TONE);
  expect(look.metalness).toBeGreaterThanOrEqual(0);
  expect(look.metalness).toBeLessThanOrEqual(1);
  expect(look.roughness).toBeGreaterThanOrEqual(0);
  expect(look.roughness).toBeLessThanOrEqual(1);
  expect(look.emissiveBoost).toBeGreaterThanOrEqual(0);
  expect(look.emissiveBoost).toBeLessThanOrEqual(1);
}

describe("partLook", () => {
  const parts = Object.values(PART_CATALOG);

  it("gives every catalog part its own row", () => {
    for (const part of parts) {
      expect(PART_LOOKS[part.id]).toBeDefined();
      expect(partLook(part)).toBe(PART_LOOKS[part.id]);
    }
  });

  it("has no rows for parts that left the catalog", () => {
    for (const id of Object.keys(PART_LOOKS)) {
      expect(PART_CATALOG[id]).toBeDefined();
    }
  });

  for (const part of parts) {
    it(`${part.id} has a sane look`, () => {
      expectSaneLook(partLook(part));
    });
  }

  for (const category of partCategorySchema.options) {
    it(`${category} fallback look is sane`, () => {
      expectSaneLook(CATEGORY_LOOK[category]);
    });
  }

  it("falls back to the category look for an unknown part", () => {
    for (const category of partCategorySchema.options) {
      const sample = parts.find((p) => p.category === category);
      if (!sample) throw new Error(`no ${category} part in the catalog`);
      const future: PartDef = { ...sample, id: `future-${category}` };
      expect(partLook(future)).toBe(CATEGORY_LOOK[category]);
      expect(partAccent(future)).toEqual({
        region: CATEGORY_LOOK[category].region,
        tone: CATEGORY_LOOK[category].tone,
      });
    }
  });

  it("never repeats a colour and tone pair within a category", () => {
    const seen = new Map<PartCategory, Set<string>>();
    for (const part of parts) {
      const look = partLook(part);
      const pair = `${look.color}@${look.tone}`;
      const pairs = seen.get(part.category) ?? new Set<string>();
      expect(pairs.has(pair), `${part.id} repeats ${pair}`).toBe(false);
      pairs.add(pair);
      seen.set(part.category, pairs);
    }
  });

  it("keeps each category legible from across the arena", () => {
    for (const part of parts) {
      const look = partLook(part);
      switch (part.category) {
        case "mobility":
          // Rubber: the tread multiplies well down, matte, not metal.
          expect(look.region).toBe("tread");
          expect(look.tone).toBeLessThanOrEqual(0.35);
          expect(look.roughness).toBeGreaterThanOrEqual(0.8);
          expect(look.metalness).toBeLessThanOrEqual(0.2);
          break;
        case "core":
          // The warm glowing unit.
          expect(look.emissiveBoost).toBeGreaterThanOrEqual(0.25);
          expect(look.region).toBe("band");
          break;
        case "weapon":
          // Bare steel, bright or dark.
          expect(look.metalness).toBeGreaterThanOrEqual(0.8);
          break;
        case "structure":
          // Painted or bare metal, never a glowing core.
          expect(look.emissiveBoost).toBeLessThan(0.25);
          break;
      }
    }
  });

  it("partAccent carries the look's region and tone", () => {
    for (const part of parts) {
      const look = partLook(part);
      expect(partAccent(part)).toEqual({
        region: look.region,
        tone: look.tone,
      });
    }
  });
});
