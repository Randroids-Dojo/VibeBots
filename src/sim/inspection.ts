import {
  type BotDesign,
  type DesignIssue,
  type DesignIssueCode,
  type DesignStats,
  validateDesign,
} from "./design";
import { PART_CATALOG, type PartDef, partMass } from "./parts";
import {
  type WeightClass,
  weightClassById,
  weightClassForMass,
} from "./weight-classes";

/**
 * Weight classes and the pre-fight tech inspection.
 *
 * validateDesign already computed total mass, but nothing ever pushed back
 * on it, so mass was a readout rather than a constraint. A weight class
 * gives the build budget something to press against: every gram of armour
 * is a gram not spent on the weapon. The inspection then presents the whole
 * result the way a real event does, as a checklist that passes or fails per
 * rule, instead of a paragraph of error strings.
 */

/** Total mass of a design, independent of whether it is otherwise legal. */
export function designMass(
  design: BotDesign,
  catalog: Record<string, PartDef> = PART_CATALOG,
): number {
  let mass = 0;
  for (const instance of design.parts) {
    const def = catalog[instance.partId];
    if (def) mass += partMass(def);
  }
  return mass;
}

export type InspectionItemId =
  | "parts"
  | "core"
  | "frame"
  | "connections"
  | "clearance"
  | "power"
  | "weight";

export interface InspectionItem {
  id: InspectionItemId;
  label: string;
  passed: boolean;
  /** One line stating what was checked, or what is wrong. */
  detail: string;
  /** The underlying validation messages, when it failed. */
  messages: string[];
}

export interface Inspection {
  passed: boolean;
  items: InspectionItem[];
  stats: DesignStats | null;
  mass: number;
  /** The class the design declared, if any. */
  declaredClass: WeightClass | null;
  /** The lightest class the design actually fits. */
  fitsClass: WeightClass | null;
}

/**
 * Which check owns each failure reason. Grouping by code (rather than by
 * matching error text) is why the inspection can never drift out of sync
 * with validateDesign.
 */
const ITEM_FOR_CODE: Record<DesignIssueCode, InspectionItemId> = {
  "duplicate-iid": "parts",
  "unknown-part": "parts",
  "too-many-parts": "parts",
  "core-count": "core",
  "core-is-child": "core",
  "unknown-instance": "connections",
  "missing-connector": "connections",
  "kind-mismatch": "connections",
  "oriented-axle": "connections",
  "connector-reused": "connections",
  "multiple-parents": "connections",
  disconnected: "frame",
  overlap: "clearance",
  power: "power",
  "weight-class": "weight",
  "gear-ratio": "connections",
};

const ITEM_ORDER: ReadonlyArray<{
  id: InspectionItemId;
  label: string;
  ok: string;
}> = [
  { id: "parts", label: "Parts", ok: "Every part is known and unique" },
  { id: "core", label: "Core", ok: "Exactly one core, mounted as the root" },
  { id: "frame", label: "Frame", ok: "Everything is attached to the core" },
  { id: "connections", label: "Connections", ok: "Every mount is legal" },
  { id: "clearance", label: "Clearance", ok: "No two parts occupy one space" },
  { id: "power", label: "Power", ok: "Draw is within the core's supply" },
  { id: "weight", label: "Weight", ok: "Inside the declared class" },
];

/**
 * Runs the tech inspection. The authority stays validateDesign: this groups
 * its issues into checks and adds the weight-class rule on top.
 */
export function inspectDesign(
  design: BotDesign,
  catalog: Record<string, PartDef> = PART_CATALOG,
): Inspection {
  const validation = validateDesign(design, catalog);
  const issues: DesignIssue[] = validation.ok ? [] : [...validation.issues];

  const mass = designMass(design, catalog);
  const declaredClass = design.weightClass
    ? weightClassById(design.weightClass)
    : null;
  const fitsClass = weightClassForMass(mass);
  // validateDesign owns the weight rule and normally reports it. It can
  // return early on a structural fault before reaching that check, though,
  // so fill the gap here rather than duplicating a message it already made.
  if (
    declaredClass &&
    mass > declaredClass.maxMass &&
    !issues.some((issue) => issue.code === "weight-class")
  ) {
    issues.push({
      code: "weight-class",
      message: `over ${declaredClass.name}: ${mass.toFixed(2)} exceeds ${declaredClass.maxMass.toFixed(2)}`,
    });
  }

  const byItem = new Map<InspectionItemId, string[]>();
  for (const issue of issues) {
    const item = ITEM_FOR_CODE[issue.code];
    const list = byItem.get(item) ?? [];
    list.push(issue.message);
    byItem.set(item, list);
  }

  const items = ITEM_ORDER.map((entry): InspectionItem => {
    const messages = byItem.get(entry.id) ?? [];
    const passed = messages.length === 0;
    let detail = entry.ok;
    if (!passed) {
      detail = messages[0];
    } else if (entry.id === "weight") {
      detail = declaredClass
        ? `${mass.toFixed(2)} of ${declaredClass.maxMass.toFixed(2)} in ${declaredClass.name}`
        : fitsClass
          ? `${mass.toFixed(2)}, unclassed (would make ${fitsClass.name})`
          : `${mass.toFixed(2)}, heavier than every class`;
    }
    return { id: entry.id, label: entry.label, passed, detail, messages };
  });

  return {
    passed: items.every((item) => item.passed),
    items,
    stats: validation.ok ? validation.stats : null,
    mass,
    declaredClass,
    fitsClass,
  };
}
