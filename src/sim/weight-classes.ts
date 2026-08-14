/**
 * Weight classes (F-228).
 *
 * validateDesign already computed total mass, but nothing pushed back on
 * it, so mass was a readout rather than a constraint. A declared class
 * gives the build budget something to press against: every gram of armour
 * is a gram not spent on the weapon.
 *
 * This is its own module because design.ts enforces the limit and
 * inspection.ts presents it, and neither may import the other.
 */

export interface WeightClass {
  id: string;
  name: string;
  /** Inclusive mass ceiling for the class. */
  maxMass: number;
  blurb: string;
}

/**
 * Ceilings are set against the shipped catalog so each stock archetype has
 * a natural home: the plain Rammer is an Antweight, the Brawler and the saw
 * bot are Beetleweights, and the drum-and-plow Bulldozer is a Hobbyweight.
 * Featherweight is the ceiling for a fully loaded build.
 */
export const WEIGHT_CLASSES: readonly WeightClass[] = [
  {
    id: "antweight",
    name: "Antweight",
    maxMass: 0.6,
    blurb: "Minimal frames. Speed and reach over armour.",
  },
  {
    id: "beetleweight",
    name: "Beetleweight",
    maxMass: 0.9,
    blurb: "One real weapon and enough plate to survive it.",
  },
  {
    id: "hobbyweight",
    name: "Hobbyweight",
    maxMass: 1.4,
    blurb: "Drums, heavy noses, and armour that shrugs off a spike.",
  },
  {
    id: "featherweight",
    name: "Featherweight",
    maxMass: 2.2,
    blurb: "Everything you can bolt on and still drive.",
  },
];

export function weightClassById(id: string): WeightClass | null {
  return WEIGHT_CLASSES.find((entry) => entry.id === id) ?? null;
}

/**
 * The weight-class complaint for a design, or null when there is none.
 *
 * Lives with the classes rather than in the validator so the rule and its
 * wording have one home: inspectDesign has to re-run this when
 * validateDesign returns early on a structural fault, and a second copy of
 * the format string would drift. Covers the unknown-id case too, which a
 * mass-only re-check would silently pass.
 */
export function weightClassProblem(
  mass: number,
  classId: string | undefined,
): string | null {
  if (classId === undefined) return null;
  const declared = weightClassById(classId);
  if (declared === null) return `unknown weight class "${classId}"`;
  if (mass <= declared.maxMass) return null;
  return `over ${declared.name}: ${mass.toFixed(2)} exceeds ${declared.maxMass.toFixed(2)}`;
}

/** The lightest class this mass legally fits, or null if it exceeds them all. */
export function weightClassForMass(mass: number): WeightClass | null {
  for (const entry of WEIGHT_CLASSES) {
    if (mass <= entry.maxMass) return entry;
  }
  return null;
}
