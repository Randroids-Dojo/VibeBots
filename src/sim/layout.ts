import type { BotDesign, Connection, Orientation } from "./design";
import { PART_CATALOG, type PartDef, type Vec3 } from "./parts";

/**
 * Pure part placement for a design tree: BFS from the core with children
 * sorted by instance id. Child rotation composes the parent rotation with
 * the connection's yaw quarter-turn (exact quaternions, no trig, F-006);
 * child position = parent position + rotated parent anchor - rotated
 * child anchor. Assembly and the workshop preview share this so what you
 * build is what fights; traversal order is part of the determinism
 * contract.
 */

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };

const HALF_SQRT2 = Math.sqrt(0.5);

export const YAW_QUATS: Record<Orientation, Quat> = {
  0: { x: 0, y: 0, z: 0, w: 1 },
  90: { x: 0, y: HALF_SQRT2, z: 0, w: HALF_SQRT2 },
  180: { x: 0, y: 1, z: 0, w: 0 },
  270: { x: 0, y: -HALF_SQRT2, z: 0, w: HALF_SQRT2 },
};

export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2*q.w*(q.xyz x v) + 2*(q.xyz x (q.xyz x v))
  const cx = q.y * v.z - q.z * v.y;
  const cy = q.z * v.x - q.x * v.z;
  const cz = q.x * v.y - q.y * v.x;
  return {
    x: v.x + 2 * (q.w * cx + q.y * cz - q.z * cy),
    y: v.y + 2 * (q.w * cy + q.z * cx - q.x * cz),
    z: v.z + 2 * (q.w * cz + q.x * cy - q.y * cx),
  };
}

export interface Placement {
  position: Vec3;
  rotation: Quat;
}

export function computeLayout(
  design: BotDesign,
  catalog: Record<string, PartDef> = PART_CATALOG,
  origin: Vec3 = { x: 0, y: 0, z: 0 },
): Map<string, Placement> {
  const partByIid = new Map(
    design.parts.map((p) => [p.iid, catalog[p.partId]]),
  );
  const childConnections = new Map<string, Connection[]>();
  for (const conn of design.connections) {
    const list = childConnections.get(conn.parentIid) ?? [];
    list.push(conn);
    childConnections.set(conn.parentIid, list);
  }
  for (const list of childConnections.values()) {
    list.sort((a, b) =>
      a.childIid < b.childIid ? -1 : a.childIid > b.childIid ? 1 : 0,
    );
  }

  const rootIid = design.parts.find(
    (p) => catalog[p.partId]?.category === "core",
  )?.iid;
  const placements = new Map<string, Placement>();
  if (rootIid === undefined) return placements;
  placements.set(rootIid, { position: { ...origin }, rotation: IDENTITY_QUAT });

  const queue = [rootIid];
  while (queue.length > 0) {
    const iid = queue.shift();
    if (iid === undefined) break;
    const part = partByIid.get(iid);
    const placement = placements.get(iid);
    if (!part || !placement) continue;
    for (const conn of childConnections.get(iid) ?? []) {
      const childPart = partByIid.get(conn.childIid);
      const parentAnchor = part.connectors.find(
        (c) => c.id === conn.parentConnector,
      );
      const childAnchor = childPart?.connectors.find(
        (c) => c.id === conn.childConnector,
      );
      if (!parentAnchor || !childAnchor) continue;
      const rotation = quatMultiply(
        placement.rotation,
        YAW_QUATS[(conn.orientation ?? 0) as Orientation],
      );
      const parentOffset = quatRotate(
        placement.rotation,
        parentAnchor.position,
      );
      const childOffset = quatRotate(rotation, childAnchor.position);
      placements.set(conn.childIid, {
        position: {
          x: placement.position.x + parentOffset.x - childOffset.x,
          y: placement.position.y + parentOffset.y - childOffset.y,
          z: placement.position.z + parentOffset.z - childOffset.z,
        },
        rotation,
      });
      queue.push(conn.childIid);
    }
  }
  return placements;
}
