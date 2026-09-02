import { z } from "zod";

/**
 * Part definitions and the built-in catalog. Parts are pure data: shapes,
 * densities, power figures, and connectors. Assembly (design.ts and
 * assembly.ts) turns them into bodies and joints.
 */

export const vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export type Vec3 = z.infer<typeof vec3Schema>;

export function vec3Distance(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/**
 * rigid: a fixed structural attachment (fixed joint).
 * axle: a powered rotating attachment (revolute joint with a motor).
 */
export const connectorKindSchema = z.enum(["rigid", "axle"]);
export type ConnectorKind = z.infer<typeof connectorKindSchema>;

export const connectorSchema = z
  .object({
    id: z.string().min(1),
    kind: connectorKindSchema,
    /** Axle motor role: "drive" joins the differential drive (default);
     * "spin" runs at a constant motor velocity (spinner weapons). */
    motor: z.enum(["drive", "spin"]).optional(),
    /** Attachment point in the part's local frame. */
    position: vec3Schema,
    /** Rotation axis in the part's local frame. Required for axle. */
    axis: vec3Schema.optional(),
  })
  .refine((c) => c.kind !== "axle" || c.axis !== undefined, {
    message: "axle connectors require an axis",
  });
export type Connector = z.infer<typeof connectorSchema>;

/**
 * Cylinders default to rapier's local Y axis; `axis` reorients the collider
 * with an exact axis-aligned quaternion (no trig, determinism-safe).
 */
export const partShapeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cuboid"),
    hx: z.number().positive(),
    hy: z.number().positive(),
    hz: z.number().positive(),
  }),
  z.object({ type: z.literal("ball"), radius: z.number().positive() }),
  z.object({
    type: z.literal("cylinder"),
    halfHeight: z.number().positive(),
    radius: z.number().positive(),
    axis: z.enum(["x", "y", "z"]).default("y"),
  }),
]);
export type PartShape = z.infer<typeof partShapeSchema>;

export const partCategorySchema = z.enum([
  "core",
  "structure",
  "mobility",
  "weapon",
]);
export type PartCategory = z.infer<typeof partCategorySchema>;

export const partDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** One line telling a player what the part is for, shown in the
   * workshop's part inspector. Player-facing copy: plain words, no
   * dashes, at most 70 characters (parts.test.ts holds the gate). */
  blurb: z.string().min(1),
  category: partCategorySchema,
  shape: partShapeSchema,
  density: z.number().positive(),
  /** Power consumed by this part while the bot runs. */
  powerDraw: z.number().min(0),
  /** Power provided (cores only in practice). */
  powerSupply: z.number().min(0),
  /** Hit points before the part is destroyed (and detaches, combat slice). */
  durability: z.number().positive(),
  /** Shop price in emeralds; 0 means not sold (cores are starter gear). */
  priceEmeralds: z.number().min(0),
  connectors: z.array(connectorSchema).min(1),
});
export type PartDef = z.infer<typeof partDefSchema>;

export function partVolume(shape: PartShape): number {
  switch (shape.type) {
    case "cuboid":
      return 8 * shape.hx * shape.hy * shape.hz;
    case "ball":
      return (4 / 3) * Math.PI * shape.radius ** 3;
    case "cylinder":
      return Math.PI * shape.radius ** 2 * (2 * shape.halfHeight);
  }
}

/**
 * Axis-aligned half extents of a shape in its own local frame, before any
 * quarter-turn. Shared so the legality check (part overlap) and the
 * workshop's footprint read the shape contract from one place; two copies
 * would let a new shape type make them disagree about the same bot.
 */
export function shapeHalfExtents(shape: PartShape): {
  hx: number;
  hy: number;
  hz: number;
} {
  if (shape.type === "cuboid") {
    return { hx: shape.hx, hy: shape.hy, hz: shape.hz };
  }
  if (shape.type === "ball") {
    return { hx: shape.radius, hy: shape.radius, hz: shape.radius };
  }
  const along = shape.halfHeight;
  const across = shape.radius;
  if (shape.axis === "x") return { hx: along, hy: across, hz: across };
  if (shape.axis === "z") return { hx: across, hy: across, hz: along };
  return { hx: across, hy: along, hz: across };
}

export function partMass(part: PartDef): number {
  return partVolume(part.shape) * part.density;
}

const X_AXIS: Vec3 = { x: 1, y: 0, z: 0 };

export const CORE_CUBE: PartDef = {
  id: "core-cube",
  name: "Cube Core",
  blurb: "Balanced starter chassis. Six mounts, steady power.",
  category: "core",
  shape: { type: "cuboid", hx: 0.3, hy: 0.3, hz: 0.3 },
  density: 2,
  powerDraw: 0,
  powerSupply: 100,
  durability: 180,
  priceEmeralds: 0,
  connectors: [
    { id: "top", kind: "rigid", position: { x: 0, y: 0.3, z: 0 } },
    { id: "bottom", kind: "rigid", position: { x: 0, y: -0.3, z: 0 } },
    { id: "front", kind: "rigid", position: { x: 0, y: 0, z: -0.3 } },
    { id: "back", kind: "rigid", position: { x: 0, y: 0, z: 0.3 } },
    // Axle stubs sit outboard of the face so a mounted wheel (halfHeight
    // 0.08) clears the core body. Overlapping connected parts would fire a
    // violent depenetration impulse the moment the joint is removed.
    {
      id: "axle-left",
      kind: "axle",
      position: { x: -0.39, y: 0, z: 0 },
      axis: X_AXIS,
    },
    {
      id: "axle-right",
      kind: "axle",
      position: { x: 0.39, y: 0, z: 0 },
      axis: X_AXIS,
    },
  ],
};

// C1 low invertible wedge (Tombstone/Bite Force archetype): wide and low
// with a front-loaded weapon feed. Low CG, lighter, less power than the cube,
// two front mounts for a wide weapon or wedge, no bottom/back mounts (it runs
// flush to the floor and works inverted).
export const CORE_WEDGE: PartDef = {
  id: "wedge-core",
  name: "Wedge Core",
  blurb: "Low and wide. Runs inverted, feeds a front weapon.",
  category: "core",
  shape: { type: "cuboid", hx: 0.42, hy: 0.18, hz: 0.34 },
  density: 2,
  powerDraw: 0,
  powerSupply: 90,
  durability: 150,
  priceEmeralds: 0,
  connectors: [
    { id: "top", kind: "rigid", position: { x: 0, y: 0.18, z: 0 } },
    { id: "front-left", kind: "rigid", position: { x: -0.22, y: 0, z: -0.34 } },
    { id: "front-right", kind: "rigid", position: { x: 0.22, y: 0, z: -0.34 } },
    {
      id: "axle-left",
      kind: "axle",
      position: { x: -0.51, y: 0, z: 0 },
      axis: X_AXIS,
    },
    {
      id: "axle-right",
      kind: "axle",
      position: { x: 0.51, y: 0, z: 0 },
      axis: X_AXIS,
    },
  ],
};

// C2 tall brick (Hazard/Tantrum/Vlad archetype): a heavy multi-mount platform.
// More power and durability at the cost of mass and a higher CG. Five rigid
// faces (top/front/back/left/right) for overhead weapons and lifters, plus the
// two drive axles low for stability.
export const CORE_TOWER: PartDef = {
  id: "tower-core",
  name: "Tower Core",
  blurb: "Tall heavy platform. Most power, five rigid mounts.",
  category: "core",
  shape: { type: "cuboid", hx: 0.28, hy: 0.5, hz: 0.28 },
  density: 2.2,
  powerDraw: 0,
  powerSupply: 130,
  durability: 240,
  priceEmeralds: 0,
  connectors: [
    { id: "top", kind: "rigid", position: { x: 0, y: 0.5, z: 0 } },
    { id: "front", kind: "rigid", position: { x: 0, y: 0.1, z: -0.28 } },
    { id: "back", kind: "rigid", position: { x: 0, y: 0.1, z: 0.28 } },
    { id: "left", kind: "rigid", position: { x: -0.28, y: 0.2, z: 0 } },
    { id: "right", kind: "rigid", position: { x: 0.28, y: 0.2, z: 0 } },
    {
      id: "axle-left",
      kind: "axle",
      position: { x: -0.37, y: -0.2, z: 0 },
      axis: X_AXIS,
    },
    {
      id: "axle-right",
      kind: "axle",
      position: { x: 0.37, y: -0.2, z: 0 },
      axis: X_AXIS,
    },
  ],
};

export const FRAME_PLATE: PartDef = {
  id: "frame-plate",
  name: "Frame Plate",
  blurb: "Light deck plate. Extends the stack for cheap.",
  category: "structure",
  shape: { type: "cuboid", hx: 0.3, hy: 0.05, hz: 0.3 },
  density: 1.5,
  powerDraw: 0,
  powerSupply: 0,
  durability: 100,
  priceEmeralds: 3,
  connectors: [
    { id: "top", kind: "rigid", position: { x: 0, y: 0.05, z: 0 } },
    { id: "bottom", kind: "rigid", position: { x: 0, y: -0.05, z: 0 } },
  ],
};

export const DRIVE_WHEEL: PartDef = {
  id: "drive-wheel",
  name: "Drive Wheel",
  blurb: "Rubber drive wheel. One per axle, lifts the belly.",
  category: "mobility",
  // Radius must clear the core's half-height (0.3) so wheels, not the
  // chassis belly, carry the bot, but must NOT protrude far past the core
  // front (0.3) or wheels eat every frontal contact and weapons never land.
  shape: { type: "cylinder", halfHeight: 0.08, radius: 0.34, axis: "x" },
  density: 1.2,
  powerDraw: 20,
  powerSupply: 0,
  durability: 80,
  priceEmeralds: 6,
  connectors: [
    { id: "hub", kind: "axle", position: { x: 0, y: 0, z: 0 }, axis: X_AXIS },
  ],
};

export const RAM_SPIKE: PartDef = {
  id: "ram-spike",
  name: "Ram Spike",
  blurb: "Forward spike. Reach and a hard point, cheap to run.",
  category: "weapon",
  shape: { type: "cuboid", hx: 0.05, hy: 0.05, hz: 0.2 },
  density: 3,
  powerDraw: 5,
  powerSupply: 0,
  durability: 150,
  priceEmeralds: 8,
  connectors: [
    { id: "mount", kind: "rigid", position: { x: 0, y: 0, z: 0.2 } },
  ],
};

export const CROSS_FRAME: PartDef = {
  id: "cross-frame",
  name: "Cross Frame",
  blurb: "Four side mounts on one deck. Builds out wide.",
  category: "structure",
  // Stays inside the wheels (inner edge x 0.31) when stacked on the core.
  shape: { type: "cuboid", hx: 0.3, hy: 0.08, hz: 0.3 },
  density: 1.4,
  powerDraw: 0,
  powerSupply: 0,
  durability: 90,
  priceEmeralds: 5,
  connectors: [
    { id: "top", kind: "rigid", position: { x: 0, y: 0.08, z: 0 } },
    { id: "bottom", kind: "rigid", position: { x: 0, y: -0.08, z: 0 } },
    { id: "north", kind: "rigid", position: { x: 0, y: 0, z: -0.3 } },
    { id: "south", kind: "rigid", position: { x: 0, y: 0, z: 0.3 } },
    { id: "east", kind: "rigid", position: { x: 0.3, y: 0, z: 0 } },
    { id: "west", kind: "rigid", position: { x: -0.3, y: 0, z: 0 } },
  ],
};

export const SENSOR_HEAD: PartDef = {
  id: "sensor-head",
  name: "Sensor Head",
  blurb: "Light glass dome. Adds character, not strength.",
  category: "structure",
  shape: { type: "ball", radius: 0.18 },
  density: 1,
  powerDraw: 2,
  powerSupply: 0,
  durability: 60,
  priceEmeralds: 4,
  connectors: [
    { id: "neck", kind: "rigid", position: { x: 0, y: -0.18, z: 0 } },
  ],
};

export const PLOW_BLADE: PartDef = {
  id: "plow-blade",
  name: "Plow Blade",
  blurb: "Wide low pusher. Shoves with its mass, soaks hits.",
  category: "weapon",
  // A wide, low pusher: less reach than the spike but a broad face that
  // lands hits across the whole frontal arc and shoves with its mass.
  shape: { type: "cuboid", hx: 0.34, hy: 0.12, hz: 0.06 },
  density: 2.6,
  powerDraw: 6,
  powerSupply: 0,
  durability: 190,
  priceEmeralds: 9,
  connectors: [
    { id: "mount", kind: "rigid", position: { x: 0, y: 0, z: 0.06 } },
  ],
};

export const HAMMER_HEAD: PartDef = {
  id: "hammer-head",
  name: "Hammer Head",
  blurb: "Dense iron ball. Hits hard, rides top heavy.",
  category: "weapon",
  // Dense ball on a short mount: top-heavy, hits hard, punishes builds
  // that cannot keep their nose on the target.
  shape: { type: "ball", radius: 0.16 },
  density: 4.2,
  powerDraw: 8,
  powerSupply: 0,
  durability: 130,
  priceEmeralds: 10,
  connectors: [
    { id: "mount", kind: "rigid", position: { x: 0, y: -0.16, z: 0 } },
  ],
};

export const ARMOR_WEDGE: PartDef = {
  id: "armor-wedge",
  name: "Armor Wedge",
  blurb: "Sacrificial nose plate. Soaks frontal hits.",
  category: "structure",
  // Thick sacrificial nose plate: cheap durability that soaks frontal
  // hits before they reach the core.
  shape: { type: "cuboid", hx: 0.28, hy: 0.18, hz: 0.08 },
  density: 2.2,
  powerDraw: 0,
  powerSupply: 0,
  durability: 220,
  priceEmeralds: 7,
  connectors: [
    { id: "mount", kind: "rigid", position: { x: 0, y: 0, z: 0.08 } },
    { id: "face", kind: "rigid", position: { x: 0, y: 0, z: -0.08 } },
  ],
};

export const ROLLER_DRUM: PartDef = {
  id: "roller-drum",
  name: "Roller Drum",
  blurb: "Wide drum on one axle. Stable, hungry for power.",
  category: "mobility",
  // A wide single drum: one axle carries the whole side, trading the
  // wheel's agility for a low, stable tracked silhouette. The hub sits
  // on the inner face (the axle stub is only 0.09 outboard of the core,
  // and a center hub would sink the 0.22 half-width into the chassis);
  // the anchor stays on the spin axis, so rotation is unaffected. The
  // radius matches the drive wheel's ground clearance.
  shape: { type: "cylinder", halfHeight: 0.22, radius: 0.34, axis: "x" },
  density: 1.5,
  powerDraw: 26,
  powerSupply: 0,
  durability: 130,
  priceEmeralds: 9,
  connectors: [
    // Side-specific hubs on the inner face: connections place the child
    // connector onto the parent stub, so each side needs its own inward
    // face. Both anchors lie on the spin axis.
    {
      id: "hub-left",
      kind: "axle",
      position: { x: 0.22, y: 0, z: 0 },
      axis: X_AXIS,
    },
    {
      id: "hub-right",
      kind: "axle",
      position: { x: -0.22, y: 0, z: 0 },
      axis: X_AXIS,
    },
  ],
};

export const MAST_POLE: PartDef = {
  id: "mast-pole",
  name: "Mast Pole",
  blurb: "Tall light spar. Silhouette, not strength.",
  category: "structure",
  // A tall light spar for character builds: banners, heads, and high
  // sensors ride on it; it adds silhouette, not strength.
  shape: { type: "cylinder", halfHeight: 0.24, radius: 0.05, axis: "y" },
  density: 0.8,
  powerDraw: 0,
  powerSupply: 0,
  durability: 45,
  priceEmeralds: 3,
  connectors: [
    { id: "base", kind: "rigid", position: { x: 0, y: -0.24, z: 0 } },
    { id: "tip", kind: "rigid", position: { x: 0, y: 0.24, z: 0 } },
  ],
};

export const SPIN_MOUNT: PartDef = {
  id: "spin-mount",
  name: "Spin Mount",
  blurb: "Spindle housing. Bolts a saw or bar to a mount.",
  category: "structure",
  // A stout housing whose forward stub is a constant-velocity axle: the
  // mount for saw weapons. The rear face bolts flush to a rigid
  // connector; the stub sits outboard so a mounted blade clears the
  // housing.
  shape: { type: "cuboid", hx: 0.12, hy: 0.12, hz: 0.12 },
  density: 2,
  powerDraw: 0,
  powerSupply: 0,
  durability: 120,
  priceEmeralds: 6,
  connectors: [
    { id: "base", kind: "rigid", position: { x: 0, y: 0, z: 0.12 } },
    {
      id: "spindle",
      kind: "axle",
      motor: "spin",
      position: { x: 0, y: 0, z: -0.18 },
      axis: { x: 0, y: 0, z: 1 },
    },
  ],
};

export const SAW_BLADE: PartDef = {
  id: "saw-blade",
  name: "Saw Blade",
  blurb: "Thin spinning disc. Rim speed does the damage.",
  category: "weapon",
  // A thin face-on blade spinning about the forward axis: the rim meets
  // the enemy at every hull height, and rim speed times mass is what
  // the contact-force damage model rewards. Radius clears the ground
  // from wheel-carried ride height (0.34).
  shape: { type: "cylinder", halfHeight: 0.04, radius: 0.28, axis: "z" },
  density: 2.6,
  powerDraw: 30,
  powerSupply: 0,
  durability: 110,
  priceEmeralds: 14,
  connectors: [
    {
      id: "hub",
      kind: "axle",
      motor: "spin",
      position: { x: 0, y: 0, z: 0.06 },
      axis: { x: 0, y: 0, z: 1 },
    },
  ],
};

// A2 hardened plate (M): a thick, heavy steel deck that soaks hits before
// they reach the core. High durability for its size, no power cost, and it
// extends the connector surface like a frame plate but much tougher (and
// heavier, so it trades top speed for protection). BattleBots armor archetype.
export const HARDENED_PLATE: PartDef = {
  id: "hardened-plate",
  name: "Hardened Plate",
  blurb: "Thick armor deck. Heavy, tough, no power.",
  category: "structure",
  shape: { type: "cuboid", hx: 0.28, hy: 0.08, hz: 0.28 },
  density: 3.6,
  powerDraw: 0,
  powerSupply: 0,
  durability: 320,
  priceEmeralds: 18,
  connectors: [
    { id: "top", kind: "rigid", position: { x: 0, y: 0.08, z: 0 } },
    { id: "bottom", kind: "rigid", position: { x: 0, y: -0.08, z: 0 } },
  ],
};

// W2 horizontal bar spinner (M): a dense steel bar on the spin mount's
// constant-velocity spindle, same footprint as the saw disc but heavier, so
// it hits harder at the cost of more power to spin. The Tombstone/Icewave
// archetype in bar form (a distinct silhouette from the round Saw Blade).
export const SPINNER_BAR: PartDef = {
  id: "spinner-bar",
  name: "Spinner Bar",
  blurb: "Heavy steel bar. Hits hardest, drinks power.",
  category: "weapon",
  shape: { type: "cuboid", hx: 0.28, hy: 0.06, hz: 0.08 },
  density: 6.5,
  powerDraw: 36,
  powerSupply: 0,
  durability: 150,
  priceEmeralds: 20,
  connectors: [
    {
      id: "hub",
      kind: "axle",
      motor: "spin",
      position: { x: 0, y: 0, z: 0.06 },
      axis: { x: 0, y: 0, z: 1 },
    },
  ],
};

// Tier ladder, catalog wave one (G4, workshop garage program). Nuts and
// Bolts got its breadth from a legible ladder inside a few part families,
// not from hundreds of unrelated parts. Every part below is additive: a
// new collider, no existing shape moves, SIM_VERSION stays put. Prices
// follow the question-2 default: a tier-two part costs about two tier-one
// copies, which is what a merge to level two costs today.

// Wheels widen and grow. A wider tread is heavier and holds a shove; a
// bigger radius covers more ground per shaft turn and lifts the ride
// height, which the balance readout shows as a higher centre of mass.
// halfHeight 0.085 keeps the inner face outboard of every core's flank
// (cube 0.3 from a 0.39 stub, wedge 0.42 from 0.51, tower 0.28 from 0.37).
export const GRIP_WHEEL: PartDef = {
  id: "grip-wheel",
  name: "Grip Wheel",
  category: "mobility",
  shape: { type: "cylinder", halfHeight: 0.085, radius: 0.34, axis: "x" },
  density: 1.4,
  powerDraw: 24,
  powerSupply: 0,
  durability: 100,
  priceEmeralds: 12,
  blurb: "Wider tread. Holds a shove, costs a little power.",
  connectors: [
    { id: "hub", kind: "axle", position: { x: 0, y: 0, z: 0 }, axis: X_AXIS },
  ],
};

export const SUPER_WHEEL: PartDef = {
  id: "super-wheel",
  name: "Super Wheel",
  category: "mobility",
  shape: { type: "cylinder", halfHeight: 0.085, radius: 0.4, axis: "x" },
  density: 1.5,
  powerDraw: 30,
  powerSupply: 0,
  durability: 130,
  priceEmeralds: 20,
  blurb: "Big and fast. Taller ride, higher centre of mass.",
  connectors: [
    { id: "hub", kind: "axle", position: { x: 0, y: 0, z: 0 }, axis: X_AXIS },
  ],
};

// Structure: a lighter deck below the frame plate, and three silhouettes
// the catalog lacked (a block that turns a corner, a low nose, a runner).
export const LIGHT_PLATE: PartDef = {
  id: "light-plate",
  name: "Light Plate",
  category: "structure",
  shape: { type: "cuboid", hx: 0.3, hy: 0.03, hz: 0.3 },
  density: 1.0,
  powerDraw: 0,
  powerSupply: 0,
  durability: 60,
  priceEmeralds: 2,
  blurb: "Thin deck. Light, cheap, dents easily.",
  connectors: [
    { id: "top", kind: "rigid", position: { x: 0, y: 0.03, z: 0 } },
    { id: "bottom", kind: "rigid", position: { x: 0, y: -0.03, z: 0 } },
  ],
};

export const CORNER_BLOCK: PartDef = {
  id: "corner-block",
  name: "Corner Block",
  category: "structure",
  shape: { type: "cuboid", hx: 0.12, hy: 0.12, hz: 0.12 },
  density: 1.5,
  powerDraw: 0,
  powerSupply: 0,
  durability: 90,
  priceEmeralds: 5,
  blurb: "Small block with mounts on four faces. Turns a corner.",
  connectors: [
    { id: "base", kind: "rigid", position: { x: 0, y: -0.12, z: 0 } },
    { id: "top", kind: "rigid", position: { x: 0, y: 0.12, z: 0 } },
    { id: "front", kind: "rigid", position: { x: 0, y: 0, z: -0.12 } },
    { id: "side", kind: "rigid", position: { x: 0.12, y: 0, z: 0 } },
  ],
};

export const WEDGE_BLOCK: PartDef = {
  id: "wedge-block",
  name: "Wedge Block",
  category: "structure",
  shape: { type: "cuboid", hx: 0.25, hy: 0.1, hz: 0.25 },
  density: 1.8,
  powerDraw: 0,
  powerSupply: 0,
  durability: 120,
  priceEmeralds: 6,
  blurb: "Low nose block. Gets under a rival and takes the hit.",
  connectors: [
    { id: "mount", kind: "rigid", position: { x: 0, y: 0, z: 0.25 } },
    { id: "top", kind: "rigid", position: { x: 0, y: 0.1, z: 0 } },
  ],
};

export const SKID: PartDef = {
  id: "skid",
  name: "Skid",
  category: "structure",
  shape: { type: "cuboid", hx: 0.06, hy: 0.04, hz: 0.3 },
  density: 1.2,
  powerDraw: 0,
  powerSupply: 0,
  durability: 50,
  priceEmeralds: 3,
  blurb: "A runner that props a corner so it cannot tip.",
  connectors: [{ id: "top", kind: "rigid", position: { x: 0, y: 0.04, z: 0 } }],
};

// Weapons: reach above the spike, and a standing edge for a top mount.
export const LANCE: PartDef = {
  id: "lance",
  name: "Lance",
  category: "weapon",
  shape: { type: "cuboid", hx: 0.04, hy: 0.04, hz: 0.32 },
  density: 3.2,
  powerDraw: 6,
  powerSupply: 0,
  durability: 120,
  priceEmeralds: 12,
  blurb: "Longer reach than the spike, and easier to snap.",
  connectors: [
    { id: "mount", kind: "rigid", position: { x: 0, y: 0, z: 0.32 } },
  ],
};

export const CLEAVER: PartDef = {
  id: "cleaver",
  name: "Cleaver",
  category: "weapon",
  shape: { type: "cuboid", hx: 0.04, hy: 0.2, hz: 0.22 },
  density: 5,
  powerDraw: 10,
  powerSupply: 0,
  durability: 160,
  priceEmeralds: 14,
  blurb: "A standing edge. Heavy, hits hard, sits high.",
  connectors: [
    { id: "mount", kind: "rigid", position: { x: 0, y: -0.2, z: 0 } },
  ],
};

export const PART_CATALOG: Record<string, PartDef> = Object.fromEntries(
  [
    CORE_CUBE,
    CORE_WEDGE,
    CORE_TOWER,
    FRAME_PLATE,
    DRIVE_WHEEL,
    RAM_SPIKE,
    CROSS_FRAME,
    SENSOR_HEAD,
    PLOW_BLADE,
    HAMMER_HEAD,
    ARMOR_WEDGE,
    ROLLER_DRUM,
    MAST_POLE,
    SPIN_MOUNT,
    SAW_BLADE,
    HARDENED_PLATE,
    SPINNER_BAR,
    GRIP_WHEEL,
    SUPER_WHEEL,
    LIGHT_PLATE,
    CORNER_BLOCK,
    WEDGE_BLOCK,
    SKID,
    LANCE,
    CLEAVER,
  ].map((p) => [p.id, p]),
);
