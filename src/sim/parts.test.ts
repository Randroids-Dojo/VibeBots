import { describe, expect, it } from "vitest";
import { createArenaWorld } from "./arena";
import { assembleBot } from "./assembly";
import { type BotDesign, validateDesign } from "./design";
import {
  HARDENED_PLATE,
  PART_CATALOG,
  partDefSchema,
  partMass,
  SPINNER_BAR,
} from "./parts";

// A cube bot carrying both new parts: a hardened plate on the deck and a
// spinner bar on a spin mount, plus two drive wheels.
const M_DESIGN: BotDesign = {
  name: "M test",
  parts: [
    { iid: "core", partId: "core-cube" },
    { iid: "wl", partId: "drive-wheel" },
    { iid: "wr", partId: "drive-wheel" },
    { iid: "plate", partId: "hardened-plate" },
    { iid: "spin", partId: "spin-mount" },
    { iid: "bar", partId: "spinner-bar" },
  ],
  connections: [
    {
      parentIid: "core",
      parentConnector: "axle-left",
      childIid: "wl",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "axle-right",
      childIid: "wr",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "top",
      childIid: "plate",
      childConnector: "bottom",
    },
    {
      parentIid: "core",
      parentConnector: "front",
      childIid: "spin",
      childConnector: "base",
    },
    {
      parentIid: "spin",
      parentConnector: "spindle",
      childIid: "bar",
      childConnector: "hub",
    },
  ],
};

describe("M weapon and armor parts", () => {
  it("registers the hardened plate and spinner bar, both sold", () => {
    expect(PART_CATALOG["hardened-plate"]).toBe(HARDENED_PLATE);
    expect(PART_CATALOG["spinner-bar"]).toBe(SPINNER_BAR);
    expect(HARDENED_PLATE.priceEmeralds).toBeGreaterThan(0);
    expect(SPINNER_BAR.priceEmeralds).toBeGreaterThan(0);
  });

  it("makes the plate tougher armor and the bar a heavier hitter", () => {
    // Armor: much tougher than the light frame plate.
    expect(HARDENED_PLATE.durability).toBeGreaterThan(
      PART_CATALOG["frame-plate"].durability,
    );
    expect(HARDENED_PLATE.category).toBe("structure");
    // Weapon: a real spin power draw and heavier than the saw disc, so the
    // contact-force damage model rewards it more.
    expect(SPINNER_BAR.category).toBe("weapon");
    expect(SPINNER_BAR.powerDraw).toBeGreaterThan(0);
    expect(partMass(SPINNER_BAR)).toBeGreaterThan(
      partMass(PART_CATALOG["saw-blade"]),
    );
  });

  it("builds a valid bot that carries both parts", () => {
    expect(validateDesign(M_DESIGN).ok).toBe(true);
  });

  it("assembles with the spinner bar on its own spin motor", async () => {
    const world = await createArenaWorld();
    try {
      const bot = assembleBot(world, M_DESIGN, { x: 0, y: 0.6, z: 0 });
      expect(bot.bodies.size).toBe(6);
      // Two drive axles, and the spinner bar rides its own spin motor.
      expect(bot.axleJoints.length).toBe(2);
      expect(bot.spinJoints.length).toBe(1);
    } finally {
      world.free();
    }
  });
});

describe("catalog blurbs", () => {
  it("gives every part a short, dash-free line about what it is for", () => {
    for (const part of Object.values(PART_CATALOG)) {
      expect(part.blurb.trim().length, part.id).toBeGreaterThan(0);
      expect(part.blurb.length, part.id).toBeLessThan(71);
      // Player-facing copy: no em-dashes, en-dashes, or hyphens.
      expect(part.blurb, part.id).not.toMatch(/[\u2013\u2014-]/);
      expect(partDefSchema.safeParse(part).success, part.id).toBe(true);
    }
  });

  it("requires the blurb in the schema", () => {
    const { blurb: _blurb, ...missing } = PART_CATALOG["core-cube"];
    expect(partDefSchema.safeParse(missing).success).toBe(false);
    expect(
      partDefSchema.safeParse({ ...PART_CATALOG["core-cube"], blurb: "" })
        .success,
    ).toBe(false);
  });
});
