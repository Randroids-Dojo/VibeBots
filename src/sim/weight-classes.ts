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

/** Ceiling by class id, for the validity rule. */
export const WEIGHT_CLASS_LIMITS: Record<string, number> = Object.fromEntries(
  WEIGHT_CLASSES.map((entry) => [entry.id, entry.maxMass]),
);

export function weightClassById(id: string): WeightClass | null {
  return WEIGHT_CLASSES.find((entry) => entry.id === id) ?? null;
}

/** The lightest class this mass legally fits, or null if it exceeds them all. */
export function weightClassForMass(mass: number): WeightClass | null {
  for (const entry of WEIGHT_CLASSES) {
    if (mass <= entry.maxMass) return entry;
  }
  return null;
}
