import type { BotDesign, Connection, Orientation, Pitch } from "./design";
import {
  PART_CATALOG,
  type PartDef,
  type PartShape,
  shapeHalfExtents,
  type Vec3,
} from "./parts";

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

/**
 * Weapon tilt about the mount's lateral (x) axis, applied in the child's
 * frame after the yaw. Literal half-angle sines and cosines (7.5 and 15
 * degrees), because the sim may not call Math.sin: a positive pitch turns
 * the child's -z nose upward.
 */
export const PITCH_QUATS: Record<Pitch, Quat> = {
  [-30]: { x: -0.2588190451, y: 0, z: 0, w: 0.9659258263 },
  [-15]: { x: -0.1305261922, y: 0, z: 0, w: 0.9914448614 },
  0: { x: 0, y: 0, z: 0, w: 1 },
  15: { x: 0.1305261922, y: 0, z: 0, w: 0.9914448614 },
  30: { x: 0.2588190451, y: 0, z: 0, w: 0.9659258263 },
};

/** |tan| of each pitch preset, literal because the sim may not call Math.tan. */
export const PITCH_TANS: Record<Pitch, number> = {
  [-30]: 0.5773502692,
  [-15]: 0.2679491924,
  0: 0,
  15: 0.2679491924,
  30: 0.5773502692,
};

/**
 * Where a pitched child meets its parent. Tilting a box about the point
 * where it touches its mount swings the corner nearest the mount into the
 * mount; pushing the child out along its own (tilted) mount axis by (the
 * half extent across the tilt) times tan(pitch) puts that deepest corner
 * back on the mount plane, so the overlap rule keeps meaning what it says. A flat mount returns the anchor untouched, so designs without
 * angles keep their layouts and their hashes.
 */
export function pitchedChildAnchor(
  conn: Pick<Connection, "pitch">,
  shape: PartShape,
  anchor: Vec3,
): Vec3 {
  const pitch = (conn.pitch ?? 0) as Pitch;
  if (pitch === 0) return anchor;
  const s = PITCH_TANS[pitch];
  const { hy, hz } = shapeHalfExtents(shape);
  const ax = Math.abs(anchor.x);
  const ay = Math.abs(anchor.y);
  const az = Math.abs(anchor.z);
  if (az >= ay && az >= ax && az > 0) {
    return {
      x: anchor.x,
      y: anchor.y,
      z: anchor.z + (anchor.z > 0 ? 1 : -1) * hy * s,
    };
  }
  if (ay >= ax && ay > 0) {
    return {
      x: anchor.x,
      y: anchor.y + (anchor.y > 0 ? 1 : -1) * hz * s,
      z: anchor.z,
    };
  }
  return anchor;
}

/**
 * Half extents of the axis-aligned box that contains a part's box after a
 * rotation: the absolute rotation matrix applied to the extents. Exact for
 * quarter turns, conservative for a pitch.
 */
export function rotatedHalfExtents(
  q: Quat,
  hx: number,
  hy: number,
  hz: number,
): Vec3 {
  const xx = q.x * q.x;
  const yy = q.y * q.y;
  const zz = q.z * q.z;
  const xy = q.x * q.y;
  const xz = q.x * q.z;
  const yz = q.y * q.z;
  const wx = q.w * q.x;
  const wy = q.w * q.y;
  const wz = q.w * q.z;
  const r00 = 1 - 2 * (yy + zz);
  const r01 = 2 * (xy - wz);
  const r02 = 2 * (xz + wy);
  const r10 = 2 * (xy + wz);
  const r11 = 1 - 2 * (xx + zz);
  const r12 = 2 * (yz - wx);
  const r20 = 2 * (xz - wy);
  const r21 = 2 * (yz + wx);
  const r22 = 1 - 2 * (xx + yy);
  return {
    x: Math.abs(r00) * hx + Math.abs(r01) * hy + Math.abs(r02) * hz,
    y: Math.abs(r10) * hx + Math.abs(r11) * hy + Math.abs(r12) * hz,
    z: Math.abs(r20) * hx + Math.abs(r21) * hy + Math.abs(r22) * hz,
  };
}

/** The child frame a connection asks for: its yaw, then its pitch. A
 * connection without a pitch gets exactly the yaw quaternion it always
 * got, so designs without angles keep their hashes. */
export function connectionRotation(
  conn: Pick<Connection, "orientation" | "pitch">,
): Quat {
  const yaw = YAW_QUATS[(conn.orientation ?? 0) as Orientation];
  const pitch = (conn.pitch ?? 0) as Pitch;
  return pitch === 0 ? yaw : quatMultiply(yaw, PITCH_QUATS[pitch]);
}

/**
 * Whether a placement carries a 90 or 270 degree yaw, which swaps a part's
 * x and z extents. Reads the y component of the quaternions in YAW_QUATS
 * above, so it stays correct if that encoding ever changes; callers that
 * inline the magic 0.6/0.8 bounds would not.
 */
export function isQuarterTurned(rotation: Quat): boolean {
  return Math.abs(rotation.y) > 0.6 && Math.abs(rotation.y) < 0.8;
}

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
      if (!childPart || !parentAnchor || !childAnchor) continue;
      const rotation = quatMultiply(
        placement.rotation,
        connectionRotation(conn),
      );
      const parentOffset = quatRotate(
        placement.rotation,
        parentAnchor.position,
      );
      const childOffset = quatRotate(
        rotation,
        pitchedChildAnchor(conn, childPart.shape, childAnchor.position),
      );
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
