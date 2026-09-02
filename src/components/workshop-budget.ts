import {
  type BotDesign,
  gearPowerDraw,
  type Orientation,
  validateDesign,
} from "@/sim/design";
import { PART_CATALOG, type PartDef, partMass } from "@/sim/parts";
import {
  WEIGHT_CLASSES,
  type WeightClass,
  weightClassById,
  weightClassForMass,
} from "@/sim/weight-classes";
import { findFreeConnectors, validSlotsFor } from "@/state/workshop-store";

/**
 * Live build budget (G2, workshop garage program). The tech inspection says
 * pass or fail after the fact; a builder also needs to see how much room is
 * left while placing, and why a part will not go on. This module derives
 * both from the design alone, so the header meters, the reason line, and
 * the inspection can never disagree about the same bot.
 */

export interface BudgetReading {
  /** Power the parts and their gearing draw. */
  powerDraw: number;
  /** Power the core supplies. */
  powerSupply: number;
  /** Total mass from shape volume times density. */
  mass: number;
  /**
   * The mass ceiling the meter fills against: the declared class when one
   * is set, else the lightest class the bot currently fits (so an unclassed
   * bot still reads "how close am I to the next class"), else the heaviest
   * class when it fits none.
   */
  massLimit: number;
  /** The class the ceiling belongs to. */
  weightClass: WeightClass;
  /** True when the design declared its class (the ceiling is a rule). */
  declared: boolean;
  /** True when the draw exceeds the supply. */
  overdrawn: boolean;
  /** True when a declared class is exceeded. */
  overweight: boolean;
}

/** Rounds to a tenth, the resolution gearing draws are quoted at. */
function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Sums the budget the way validateDesign does, but without stopping at the
 * first structural fault: an invalid design still has a mass and a draw,
 * and the meters must keep reading while the player fixes it.
 */
export function budgetReading(
  design: BotDesign,
  catalog: Record<string, PartDef> = PART_CATALOG,
): BudgetReading {
  let powerDraw = 0;
  let powerSupply = 0;
  let mass = 0;
  for (const part of design.parts) {
    const def = catalog[part.partId];
    if (!def) continue;
    powerDraw += def.powerDraw;
    powerSupply += def.powerSupply;
    mass += partMass(def);
  }
  for (const conn of design.connections) {
    powerDraw += gearPowerDraw(conn.gearRatio);
  }
  powerDraw = tenth(powerDraw);
  const declaredClass = design.weightClass
    ? weightClassById(design.weightClass)
    : null;
  const weightClass =
    declaredClass ??
    weightClassForMass(mass) ??
    WEIGHT_CLASSES[WEIGHT_CLASSES.length - 1];
  return {
    powerDraw,
    powerSupply,
    mass,
    massLimit: weightClass.maxMass,
    weightClass,
    declared: declaredClass !== null,
    overdrawn: powerDraw > powerSupply,
    overweight: declaredClass !== null && mass > declaredClass.maxMass,
  };
}

/** Why the part in hand cannot go anywhere on the bot right now. */
export type PlacementBlocker =
  | { kind: "power"; shortfall: number }
  | { kind: "weight"; over: number; className: string }
  | { kind: "mount" };

/**
 * The one reason a part has no legal placement, in the order a builder
 * would check: is there a mount at all, does the power budget allow it,
 * does the declared class allow it, and otherwise it does not fit (an
 * overlap, or a rule the inspection lists). Null when at least one
 * placement is legal, which is the same test the drag targets use.
 */
export function placementBlocker(
  design: BotDesign,
  part: PartDef,
  catalog: Record<string, PartDef> = PART_CATALOG,
  orientation: Orientation = 0,
): PlacementBlocker | null {
  // Same orientation the drag commits with (rigid mounts honour it, axle
  // mounts ignore it), so the reason can never disagree with the drop.
  if (validSlotsFor(design, part, catalog, orientation).length > 0) {
    return null;
  }
  if (findFreeConnectors(design, part, catalog).length === 0) {
    return { kind: "mount" };
  }
  const budget = budgetReading(design, catalog);
  const powerAfter = tenth(budget.powerDraw + part.powerDraw);
  if (powerAfter > budget.powerSupply) {
    return { kind: "power", shortfall: tenth(powerAfter - budget.powerSupply) };
  }
  if (budget.declared) {
    const massAfter = budget.mass + partMass(part);
    if (massAfter > budget.massLimit) {
      return {
        kind: "weight",
        over: Math.round((massAfter - budget.massLimit) * 100) / 100,
        className: budget.weightClass.name,
      };
    }
  }
  return { kind: "mount" };
}

/** One line of DOM copy for a blocker, naming the part and the number. */
export function blockerCopy(part: PartDef, blocker: PlacementBlocker): string {
  switch (blocker.kind) {
    case "power":
      return `${part.name} needs ${blocker.shortfall} more power`;
    case "weight":
      return `${part.name} would put you ${blocker.over} over ${blocker.className}`;
    case "mount":
      return `No room for ${part.name} on any mount`;
  }
}

/** Fill fraction for a meter, clamped so an overdraw reads as full. */
export function meterFill(value: number, limit: number): number {
  if (!(limit > 0)) return 0;
  return Math.max(0, Math.min(1, value / limit));
}

/** True when the design passes validation (the header chip's state). */
export function designReady(design: BotDesign): boolean {
  return validateDesign(design).ok;
}
