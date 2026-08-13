import { describe, expect, it } from "vitest";
import {
  type BotDesign,
  CPU_BULLDOZER_DESIGN,
  CPU_WHIRLIGIG_DESIGN,
  TEST_BOT_DESIGN,
  validateDesign,
} from "./design";
import { designMass, inspectDesign } from "./inspection";
import { REPLICA_OPPONENTS } from "./opponents";
import {
  WEIGHT_CLASSES,
  weightClassById,
  weightClassForMass,
} from "./weight-classes";

const ALL_STOCK: BotDesign[] = [
  TEST_BOT_DESIGN,
  CPU_BULLDOZER_DESIGN,
  CPU_WHIRLIGIG_DESIGN,
  ...REPLICA_OPPONENTS.map((opponent) => opponent.design),
];

function itemFor(design: BotDesign, id: string) {
  return inspectDesign(design).items.find((item) => item.id === id);
}

describe("weight classes", () => {
  it("are ordered lightest first with rising ceilings", () => {
    for (let i = 1; i < WEIGHT_CLASSES.length; i++) {
      expect(WEIGHT_CLASSES[i].maxMass).toBeGreaterThan(
        WEIGHT_CLASSES[i - 1].maxMass,
      );
    }
    const ids = WEIGHT_CLASSES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("picks the lightest class a mass fits, inclusive of the ceiling", () => {
    expect(weightClassForMass(0)?.id).toBe("antweight");
    expect(weightClassForMass(0.6)?.id).toBe("antweight");
    expect(weightClassForMass(0.61)?.id).toBe("beetleweight");
    expect(weightClassForMass(999)).toBeNull();
    expect(weightClassById("nope")).toBeNull();
  });

  it("gives every stock design a home", () => {
    // A rule that outlawed the shipped roster would be a broken rule.
    for (const design of ALL_STOCK) {
      const mass = designMass(design);
      const fits = weightClassForMass(mass);
      expect(fits, `${design.name} (mass ${mass})`).not.toBeNull();
    }
  });
});

describe("validateDesign weight rule", () => {
  it("leaves an undeclared design unconstrained", () => {
    expect(validateDesign(CPU_BULLDOZER_DESIGN).ok).toBe(true);
  });

  it("rejects a design heavier than the class it declared", () => {
    // The Bulldozer is a Hobbyweight; declaring it an Antweight is a lie.
    const cheating: BotDesign = {
      ...CPU_BULLDOZER_DESIGN,
      weightClass: "antweight",
    };
    const result = validateDesign(cheating);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.code === "weight-class")).toBe(
      true,
    );
    // errors stays in sync with issues for every existing caller.
    expect(result.errors).toHaveLength(result.issues.length);
  });

  it("accepts a design inside the class it declared", () => {
    expect(
      validateDesign({ ...CPU_BULLDOZER_DESIGN, weightClass: "hobbyweight" })
        .ok,
    ).toBe(true);
  });

  it("treats an unknown class id as a bad declaration, not a free pass", () => {
    const result = validateDesign({
      ...TEST_BOT_DESIGN,
      weightClass: "cruiserweight",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.code === "weight-class")).toBe(
      true,
    );
  });
});

describe("inspectDesign", () => {
  it("passes every check for a legal design and reports its stats", () => {
    const inspection = inspectDesign(TEST_BOT_DESIGN);
    expect(inspection.passed).toBe(true);
    expect(inspection.items.every((item) => item.passed)).toBe(true);
    expect(inspection.stats).not.toBeNull();
    expect(inspection.mass).toBeCloseTo(designMass(TEST_BOT_DESIGN), 6);
    expect(inspection.fitsClass).not.toBeNull();
    expect(inspection.declaredClass).toBeNull();
  });

  it("covers every issue code, so no failure can go unreported", () => {
    // If a new DesignIssueCode is added without a home, this catches it:
    // an unmapped code would land under `undefined` and vanish from the
    // checklist while still failing validation.
    const ids = new Set(inspectDesign(TEST_BOT_DESIGN).items.map((i) => i.id));
    expect(ids).toEqual(
      new Set([
        "parts",
        "core",
        "frame",
        "connections",
        "clearance",
        "power",
        "weight",
      ]),
    );
  });

  it("fails the Core check when the core is missing", () => {
    const coreless: BotDesign = {
      name: "Coreless",
      parts: [{ iid: "plate", partId: "frame-plate" }],
      connections: [],
    };
    const inspection = inspectDesign(coreless);
    expect(inspection.passed).toBe(false);
    expect(itemFor(coreless, "core")?.passed).toBe(false);
    expect(itemFor(coreless, "core")?.messages.length).toBeGreaterThan(0);
    expect(inspection.stats).toBeNull();
  });

  it("fails the Frame check when a part is not attached to the core", () => {
    const floating: BotDesign = {
      ...TEST_BOT_DESIGN,
      parts: [...TEST_BOT_DESIGN.parts, { iid: "loose", partId: "mast-pole" }],
    };
    expect(itemFor(floating, "frame")?.passed).toBe(false);
    // The other checks stay green: a checklist localizes the fault.
    expect(itemFor(floating, "core")?.passed).toBe(true);
    expect(itemFor(floating, "power")?.passed).toBe(true);
  });

  it("fails only the Weight check when the build is merely over class", () => {
    const overweight: BotDesign = {
      ...CPU_BULLDOZER_DESIGN,
      weightClass: "antweight",
    };
    const inspection = inspectDesign(overweight);
    expect(inspection.passed).toBe(false);
    for (const item of inspection.items) {
      expect(item.passed, item.id).toBe(item.id !== "weight");
    }
    expect(itemFor(overweight, "weight")?.detail).toContain("Antweight");
  });

  it("still fails Weight for a bad class id behind a structural fault", () => {
    // validateDesign returns early on the missing core, so the weight rule
    // never ran there. The inspection re-asks the shared rule, which covers
    // the unknown-id case; a mass-only re-check would show Weight green.
    const broken: BotDesign = {
      name: "Coreless and misdeclared",
      parts: [{ iid: "plate", partId: "frame-plate" }],
      connections: [],
      weightClass: "cruiserweight",
    };
    const inspection = inspectDesign(broken);
    expect(inspection.passed).toBe(false);
    expect(itemFor(broken, "core")?.passed).toBe(false);
    expect(itemFor(broken, "weight")?.passed).toBe(false);
    expect(itemFor(broken, "weight")?.detail).toContain("cruiserweight");
  });

  it("names the class an unclassed build would make", () => {
    const detail = itemFor(TEST_BOT_DESIGN, "weight")?.detail ?? "";
    expect(detail).toContain("unclassed");
    expect(detail).toContain(
      weightClassForMass(designMass(TEST_BOT_DESIGN))?.name ?? "",
    );
  });

  it("reports the declared class budget when one is declared", () => {
    const classed: BotDesign = {
      ...CPU_WHIRLIGIG_DESIGN,
      weightClass: "beetleweight",
    };
    const inspection = inspectDesign(classed);
    expect(inspection.passed).toBe(true);
    expect(inspection.declaredClass?.id).toBe("beetleweight");
    expect(itemFor(classed, "weight")?.detail).toContain("Beetleweight");
  });
});
