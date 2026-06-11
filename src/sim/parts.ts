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
  connectors: [
    { id: "mount", kind: "rigid", position: { x: 0, y: 0, z: 0.2 } },
  ],
};

export const PART_CATALOG: Record<string, PartDef> = Object.fromEntries(
  [CORE_CUBE, FRAME_PLATE, DRIVE_WHEEL, RAM_SPIKE].map((p) => [p.id, p]),
);
