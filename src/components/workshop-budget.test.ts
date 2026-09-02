import { describe, expect, it } from "vitest";
import {
  type BotDesign,
  CPU_WHIRLIGIG_DESIGN,
  TEST_BOT_DESIGN,
  validateDesign,
} from "@/sim/design";
import {
  DRIVE_WHEEL,
  HARDENED_PLATE,
  PART_CATALOG,
  SAW_BLADE,
  SPINNER_BAR,
} from "@/sim/parts";
import { STARTER_DESIGN, validSlotsFor } from "@/state/workshop-store";
import {
  blockerCopy,
  budgetReading,
  designReady,
  meterFill,
  placementBlocker,
} from "./workshop-budget";

describe("budgetReading", () => {
  it("agrees with the validator on a legal design", () => {
    const result = validateDesign(TEST_BOT_DESIGN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const budget = budgetReading(TEST_BOT_DESIGN);
    expect(budget.powerDraw).toBe(result.stats.powerDraw);
    expect(budget.powerSupply).toBe(result.stats.powerSupply);
    expect(budget.mass).toBeCloseTo(result.stats.totalMass, 9);
    expect(budget.overdrawn).toBe(false);
    expect(budget.overweight).toBe(false);
  });

  it("keeps reading on an illegal design instead of stopping at the fault", () => {
    // Two cores is a structural fault the validator returns early on; the
    // meters still need the sums so the player can see what to fix.
    const twoCores: BotDesign = {
      name: "Broken",
      parts: [
        { iid: "core", partId: "core-cube" },
        { iid: "core-2", partId: "core-cube" },
      ],
      connections: [],
    };
    expect(validateDesign(twoCores).ok).toBe(false);
    const budget = budgetReading(twoCores);
    expect(budget.powerSupply).toBe(200);
    expect(budget.mass).toBeGreaterThan(0);
  });

  it("counts gearing in the draw at tenth resolution", () => {
    const geared: BotDesign = {
      ...TEST_BOT_DESIGN,
      connections: TEST_BOT_DESIGN.connections.map((c) =>
        c.parentConnector.startsWith("axle") ? { ...c, gearRatio: 2.2 } : c,
      ),
    };
    const budget = budgetReading(geared);
    // Two axles at 2.2: (2.2 - 1) * 13 = 15.6 each.
    expect(budget.powerDraw).toBe(45 + 31.2);
    expect(Number.isInteger(budget.powerDraw * 10)).toBe(true);
  });

  it("fills the weight meter against the declared class, else the lightest fit", () => {
    const unclassed = budgetReading(TEST_BOT_DESIGN);
    expect(unclassed.declared).toBe(false);
    expect(unclassed.weightClass.id).toBe("antweight");
    expect(unclassed.massLimit).toBe(0.6);

    const declared = budgetReading({
      ...TEST_BOT_DESIGN,
      weightClass: "hobbyweight",
    });
    expect(declared.declared).toBe(true);
    expect(declared.massLimit).toBe(1.4);
    expect(declared.overweight).toBe(false);

    const tooHeavy = budgetReading({
      ...CPU_WHIRLIGIG_DESIGN,
      weightClass: "antweight",
    });
    expect(tooHeavy.overweight).toBe(true);
  });
});

describe("placementBlocker", () => {
  it("is null when the part has a legal slot", () => {
    expect(placementBlocker(STARTER_DESIGN, DRIVE_WHEEL)).toBeNull();
  });

  it("names a missing mount when nothing free matches", () => {
    // Both axles taken: a third wheel has no mount at all.
    expect(placementBlocker(TEST_BOT_DESIGN, DRIVE_WHEEL)).toEqual({
      kind: "mount",
    });
    // A saw blade needs a spin axle; the bare core has none.
    expect(placementBlocker(STARTER_DESIGN, SAW_BLADE)).toEqual({
      kind: "mount",
    });
  });

  it("names the power shortfall when only the budget refuses", () => {
    // The saw bot draws 70 of 100; gear both axles up (31.2) and the
    // spinner bar (36) that would replace the blade has no room, so build
    // a bot where the spindle is free and power is the only thing short.
    const design: BotDesign = {
      name: "Tight",
      parts: [
        { iid: "core", partId: "core-cube" },
        { iid: "wheel-l", partId: "drive-wheel" },
        { iid: "wheel-r", partId: "drive-wheel" },
        { iid: "mount", partId: "spin-mount" },
      ],
      connections: [
        {
          parentIid: "core",
          parentConnector: "axle-left",
          childIid: "wheel-l",
          childConnector: "hub",
          gearRatio: 2.2,
        },
        {
          parentIid: "core",
          parentConnector: "axle-right",
          childIid: "wheel-r",
          childConnector: "hub",
          gearRatio: 2.2,
        },
        {
          parentIid: "core",
          parentConnector: "front",
          childIid: "mount",
          childConnector: "base",
        },
      ],
    };
    expect(validateDesign(design).ok).toBe(true);
    // Draw 40 + 31.2 = 71.2; the bar adds 36 for 107.2 against 100.
    const blocker = placementBlocker(design, SPINNER_BAR);
    expect(blocker).toEqual({ kind: "power", shortfall: 7.2 });
    if (blocker) {
      expect(blockerCopy(SPINNER_BAR, blocker)).toBe(
        "Spinner Bar needs 7.2 more power",
      );
    }
  });

  it("names the weight overage when only the declared class refuses", () => {
    const antweight: BotDesign = {
      ...TEST_BOT_DESIGN,
      weightClass: "antweight",
    };
    expect(validateDesign(antweight).ok).toBe(true);
    const blocker = placementBlocker(antweight, HARDENED_PLATE);
    expect(blocker?.kind).toBe("weight");
    if (blocker?.kind === "weight") {
      expect(blocker.className).toBe("Antweight");
      expect(blocker.over).toBeGreaterThan(0);
      expect(blockerCopy(HARDENED_PLATE, blocker)).toContain("over Antweight");
    }
    // Undeclared, the same plate goes on: weight is only a rule once chosen.
    expect(placementBlocker(TEST_BOT_DESIGN, HARDENED_PLATE)).toBeNull();
  });

  it("reads the placement through the mount orientation the drag uses", () => {
    // Find a rigid placement whose legality flips with a quarter turn (a
    // long part that clears the bot one way and overlaps it the other), so
    // the assertion fails if the blocker ever stops passing the orientation.
    const orientations = [0, 90, 180, 270] as const;
    let sensitive = 0;
    for (const design of [STARTER_DESIGN, TEST_BOT_DESIGN]) {
      for (const part of Object.values(PART_CATALOG)) {
        if (part.category === "core") continue;
        const legal = orientations.map(
          (o) => validSlotsFor(design, part, PART_CATALOG, o).length > 0,
        );
        for (const [index, o] of orientations.entries()) {
          const blocker = placementBlocker(design, part, PART_CATALOG, o);
          expect(blocker === null).toBe(legal[index]);
        }
        if (legal.some(Boolean) && legal.some((v) => !v)) sensitive += 1;
      }
    }
    // The loop above is only a proof if at least one pairing was sensitive.
    expect(sensitive).toBeGreaterThan(0);
  });

  it("covers every catalog part without throwing", () => {
    for (const part of Object.values(PART_CATALOG)) {
      const blocker = placementBlocker(TEST_BOT_DESIGN, part);
      if (blocker) expect(blockerCopy(part, blocker)).toContain(part.name);
    }
  });
});

describe("meter helpers", () => {
  it("clamps the fill so an overdraw reads as full", () => {
    expect(meterFill(50, 100)).toBe(0.5);
    expect(meterFill(150, 100)).toBe(1);
    expect(meterFill(-1, 100)).toBe(0);
    expect(meterFill(10, 0)).toBe(0);
  });

  it("reads ready from the validator", () => {
    expect(designReady(TEST_BOT_DESIGN)).toBe(true);
    expect(
      designReady({ ...TEST_BOT_DESIGN, weightClass: "no-such-class" }),
    ).toBe(false);
  });
});
