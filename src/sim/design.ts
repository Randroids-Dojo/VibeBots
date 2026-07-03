import { z } from "zod";
import { computeLayout } from "./layout";
import { PART_CATALOG, type PartDef, partMass } from "./parts";

/**
 * A bot design is a connector graph: part instances plus connections that
 * must form a tree rooted at the single core part. validateDesign is the
 * pure validity check the GDD requires before any combat (REQ-002); the
 * workshop UI and the server both call it.
 */

export const MIN_PART_MERGE_LEVEL = 1;
export const MAX_PART_MERGE_LEVEL = 3;

export const partInstanceSchema = z.object({
  /** Instance id, unique within the design. */
  iid: z.string().min(1),
  partId: z.string().min(1),
  mergeLevel: z
    .number()
    .int()
    .min(MIN_PART_MERGE_LEVEL)
    .max(MAX_PART_MERGE_LEVEL)
    .optional(),
});
export type PartInstance = z.infer<typeof partInstanceSchema>;

export const orientationSchema = z
  .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
  .optional();
export type Orientation = 0 | 90 | 180 | 270;

export const connectionSchema = z.object({
  parentIid: z.string().min(1),
  parentConnector: z.string().min(1),
  childIid: z.string().min(1),
  childConnector: z.string().min(1),
  /** Yaw quarter-turns of the child around the attachment (F-006). */
  orientation: orientationSchema,
});
export type Connection = z.infer<typeof connectionSchema>;

/** Hard cap on parts per design: sim cost is the server's to control. */
export const MAX_DESIGN_PARTS = 32;

export const botDesignSchema = z.object({
  name: z.string().min(1).max(60),
  parts: z
    .array(partInstanceSchema)
    .min(1)
    .max(MAX_DESIGN_PARTS * 2),
  connections: z.array(connectionSchema).max(MAX_DESIGN_PARTS * 2),
});
export type BotDesign = z.infer<typeof botDesignSchema>;

export interface DesignStats {
  partCount: number;
  totalMass: number;
  powerDraw: number;
  powerSupply: number;
}

export type ValidationResult =
  | { ok: true; stats: DesignStats }
  | { ok: false; errors: string[] };

function resolvePart(
  instance: PartInstance,
  catalog: Record<string, PartDef>,
): PartDef | undefined {
  return catalog[instance.partId];
}

export function partMergeLevel(
  instance: Pick<PartInstance, "mergeLevel">,
): number {
  const raw = Math.floor(instance.mergeLevel ?? MIN_PART_MERGE_LEVEL);
  if (raw < MIN_PART_MERGE_LEVEL) return MIN_PART_MERGE_LEVEL;
  if (raw > MAX_PART_MERGE_LEVEL) return MAX_PART_MERGE_LEVEL;
  return raw;
}

export function partInstanceDurability(
  instance: PartInstance,
  catalog: Record<string, PartDef> = PART_CATALOG,
): number {
  const part = resolvePart(instance, catalog);
  if (!part) return 0;
  return (part.durability * (partMergeLevel(instance) + 1)) / 2;
}

export function validateDesign(
  design: BotDesign,
  catalog: Record<string, PartDef> = PART_CATALOG,
): ValidationResult {
  const errors: string[] = [];

  const byIid = new Map<string, PartInstance>();
  for (const part of design.parts) {
    if (byIid.has(part.iid)) errors.push(`duplicate instance id "${part.iid}"`);
    byIid.set(part.iid, part);
    if (!resolvePart(part, catalog))
      errors.push(`unknown part "${part.partId}" (${part.iid})`);
  }

  if (design.parts.length > MAX_DESIGN_PARTS) {
    errors.push(
      `too many parts: ${design.parts.length} (limit ${MAX_DESIGN_PARTS})`,
    );
  }

  const cores = design.parts.filter(
    (p) => resolvePart(p, catalog)?.category === "core",
  );
  if (cores.length !== 1)
    errors.push(`a design needs exactly one core part, found ${cores.length}`);

  if (errors.length > 0) return { ok: false, errors };

  const usedConnectors = new Set<string>();
  const parentOf = new Map<string, string>();
  for (const conn of design.connections) {
    const parent = byIid.get(conn.parentIid);
    const child = byIid.get(conn.childIid);
    if (!parent || !child) {
      errors.push(
        `connection references unknown instance "${!parent ? conn.parentIid : conn.childIid}"`,
      );
      continue;
    }
    const parentConn = resolvePart(parent, catalog)?.connectors.find(
      (c) => c.id === conn.parentConnector,
    );
    const childConn = resolvePart(child, catalog)?.connectors.find(
      (c) => c.id === conn.childConnector,
    );
    if (!parentConn || !childConn) {
      errors.push(
        `connection ${conn.parentIid}:${conn.parentConnector} -> ${conn.childIid}:${conn.childConnector} names a missing connector`,
      );
      continue;
    }
    if (parentConn.kind !== childConn.kind) {
      errors.push(
        `connector kind mismatch: ${conn.parentIid}:${conn.parentConnector} is ${parentConn.kind}, ${conn.childIid}:${conn.childConnector} is ${childConn.kind}`,
      );
    }
    if ((conn.orientation ?? 0) !== 0 && parentConn.kind === "axle") {
      errors.push(
        `axle connections cannot be oriented (${conn.parentIid}:${conn.parentConnector})`,
      );
    }
    for (const key of [
      `${conn.parentIid}:${conn.parentConnector}`,
      `${conn.childIid}:${conn.childConnector}`,
    ]) {
      if (usedConnectors.has(key))
        errors.push(`connector ${key} used more than once`);
      usedConnectors.add(key);
    }
    if (parentOf.has(conn.childIid)) {
      errors.push(`instance "${conn.childIid}" has more than one parent`);
    }
    parentOf.set(conn.childIid, conn.parentIid);
  }

  const rootIid = cores[0].iid;
  if (parentOf.has(rootIid)) errors.push("the core part cannot be a child");

  const reachable = new Set<string>([rootIid]);
  const childrenOf = new Map<string, string[]>();
  for (const [child, parent] of parentOf) {
    const list = childrenOf.get(parent) ?? [];
    list.push(child);
    childrenOf.set(parent, list);
  }
  const queue = [rootIid];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    for (const child of childrenOf.get(next) ?? []) {
      if (!reachable.has(child)) {
        reachable.add(child);
        queue.push(child);
      }
    }
  }
  for (const part of design.parts) {
    if (!reachable.has(part.iid)) {
      errors.push(`instance "${part.iid}" is not connected to the core`);
    }
  }

  // Overlapping part volumes are illegal: contacts between jointed pairs
  // are disabled in combat, so an overlapped part detaching would fire a
  // violent depenetration impulse. Yaw quarter-turns keep every part
  // axis-aligned, so world AABBs are exact.
  if (errors.length === 0) {
    const placements = computeLayout(design, catalog);
    const boxes: Array<{ iid: string; min: number[]; max: number[] }> = [];
    for (const part of design.parts) {
      const def = resolvePart(part, catalog);
      const placement = placements.get(part.iid);
      if (!def || !placement) continue;
      const s = def.shape;
      let hx: number;
      let hy: number;
      let hz: number;
      if (s.type === "cuboid") {
        hx = s.hx;
        hy = s.hy;
        hz = s.hz;
      } else if (s.type === "ball") {
        hx = hy = hz = s.radius;
      } else {
        const along = s.halfHeight;
        const across = s.radius;
        if (s.axis === "x") {
          hx = along;
          hy = hz = across;
        } else if (s.axis === "z") {
          hz = along;
          hx = hy = across;
        } else {
          hy = along;
          hx = hz = across;
        }
      }
      // Quarter-turn yaw swaps the x/z extents for 90 and 270.
      const halfTurned =
        Math.abs(placement.rotation.y) > 0.6 &&
        Math.abs(placement.rotation.y) < 0.8;
      const ex = halfTurned ? hz : hx;
      const ez = halfTurned ? hx : hz;
      const p = placement.position;
      boxes.push({
        iid: part.iid,
        min: [p.x - ex, p.y - hy, p.z - ez],
        max: [p.x + ex, p.y + hy, p.z + ez],
      });
    }
    const EPS = 1e-6;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlaps =
          a.min[0] < b.max[0] - EPS &&
          b.min[0] < a.max[0] - EPS &&
          a.min[1] < b.max[1] - EPS &&
          b.min[1] < a.max[1] - EPS &&
          a.min[2] < b.max[2] - EPS &&
          b.min[2] < a.max[2] - EPS;
        if (overlaps) {
          errors.push(`parts overlap: "${a.iid}" and "${b.iid}"`);
        }
      }
    }
  }

  let totalMass = 0;
  let powerDraw = 0;
  let powerSupply = 0;
  for (const part of design.parts) {
    const def = resolvePart(part, catalog);
    if (!def) continue;
    totalMass += partMass(def);
    powerDraw += def.powerDraw;
    powerSupply += def.powerSupply;
  }
  if (powerDraw > powerSupply) {
    errors.push(
      `power overdraw: parts draw ${powerDraw}, supply is ${powerSupply}`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    stats: {
      partCount: design.parts.length,
      totalMass,
      powerDraw,
      powerSupply,
    },
  };
}

/** A known-valid starter design used by tests and the test arena. */
export const TEST_BOT_DESIGN: BotDesign = {
  name: "Rammer",
  parts: [
    { iid: "core", partId: "core-cube" },
    { iid: "wheel-l", partId: "drive-wheel" },
    { iid: "wheel-r", partId: "drive-wheel" },
    { iid: "spike", partId: "ram-spike" },
  ],
  connections: [
    {
      parentIid: "core",
      parentConnector: "axle-left",
      childIid: "wheel-l",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "axle-right",
      childIid: "wheel-r",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "front",
      childIid: "spike",
      childConnector: "mount",
    },
  ],
};

/**
 * A second stock design so exhibition matchups are asymmetric: identical
 * mirror bots take perfectly symmetric damage and always draw. The plate
 * adds mass and a different silhouette instead of a weapon.
 */
export const CPU_BRAWLER_DESIGN: BotDesign = {
  name: "Brawler",
  parts: [
    { iid: "core", partId: "core-cube" },
    { iid: "wheel-l", partId: "drive-wheel" },
    { iid: "wheel-r", partId: "drive-wheel" },
    { iid: "plate", partId: "frame-plate" },
  ],
  connections: [
    {
      parentIid: "core",
      parentConnector: "axle-left",
      childIid: "wheel-l",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "axle-right",
      childIid: "wheel-r",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "top",
      childIid: "plate",
      childConnector: "bottom",
    },
  ],
};

/**
 * A stock heavy built from the B2 catalog: roller drums for a low
 * tracked stance, an armor wedge nose, and a plow blade. Exercises the
 * new parts in every exhibition and CPU test fight that selects it.
 */
export const CPU_BULLDOZER_DESIGN: BotDesign = {
  name: "Bulldozer",
  parts: [
    { iid: "core", partId: "core-cube" },
    { iid: "drum-l", partId: "roller-drum" },
    { iid: "drum-r", partId: "roller-drum" },
    { iid: "wedge", partId: "armor-wedge" },
    { iid: "plow", partId: "plow-blade" },
  ],
  connections: [
    {
      parentIid: "core",
      parentConnector: "axle-left",
      childIid: "drum-l",
      childConnector: "hub-left",
    },
    {
      parentIid: "core",
      parentConnector: "axle-right",
      childIid: "drum-r",
      childConnector: "hub-right",
    },
    {
      parentIid: "core",
      parentConnector: "front",
      childIid: "wedge",
      childConnector: "mount",
    },
    {
      parentIid: "wedge",
      parentConnector: "face",
      childIid: "plow",
      childConnector: "mount",
    },
  ],
};
