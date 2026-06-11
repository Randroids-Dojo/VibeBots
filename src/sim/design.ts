import { z } from "zod";
import { PART_CATALOG, type PartDef, partMass } from "./parts";

/**
 * A bot design is a connector graph: part instances plus connections that
 * must form a tree rooted at the single core part. validateDesign is the
 * pure validity check the GDD requires before any combat (REQ-002); the
 * workshop UI and the server both call it.
 */

export const partInstanceSchema = z.object({
  /** Instance id, unique within the design. */
  iid: z.string().min(1),
  partId: z.string().min(1),
});
export type PartInstance = z.infer<typeof partInstanceSchema>;

export const connectionSchema = z.object({
  parentIid: z.string().min(1),
  parentConnector: z.string().min(1),
  childIid: z.string().min(1),
  childConnector: z.string().min(1),
});
export type Connection = z.infer<typeof connectionSchema>;

export const botDesignSchema = z.object({
  name: z.string().min(1),
  parts: z.array(partInstanceSchema).min(1),
  connections: z.array(connectionSchema),
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
  name: "Testbot",
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
