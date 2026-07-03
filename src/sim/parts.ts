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

export function partMass(part: PartDef): number {
  return partVolume(part.shape) * part.density;
}

const X_AXIS: Vec3 = { x: 1, y: 0, z: 0 };

export const CORE_CUBE: PartDef = {
  id: "core-cube",
  name: "Cube Core",
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

export const FRAME_PLATE: PartDef = {
  id: "frame-plate",
  name: "Frame Plate",
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

export const PART_CATALOG: Record<string, PartDef> = Object.fromEntries(
  [
    CORE_CUBE,
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
  ].map((p) => [p.id, p]),
);
