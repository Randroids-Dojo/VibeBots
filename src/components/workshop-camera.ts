/**
 * Bench camera framing (G1, workshop garage program). Pure math, no three
 * and no React, so the glide and the framing rules are unit tested and the
 * canvas rig only applies them.
 *
 * Three rules:
 *   - The default view is the front three-quarter. Every core's front is
 *     -z, so the camera lives on the -z side. It used to sit at +z, which
 *     showed the player the back of their bot and hid the weapon.
 *   - Tapping a placed part glides the view toward it (auto-frame), most of
 *     the way but not all of it, so the rest of the bot stays in shot.
 *   - Recenter puts the orbit target back on the bot's bounds centre and
 *     the camera back at the default offset from it.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Camera position relative to the orbit target: front three-quarter, above. */
export const DEFAULT_CAMERA_OFFSET: Readonly<Vec3Like> = {
  x: 2.6,
  y: 1.8,
  z: -3.2,
};

/**
 * Glide rate per second for camera moves. Exponential, so each frame covers
 * the same fraction of what is left: about 95% of the way in half a second,
 * quick enough to feel like a snap, slow enough to read as a move.
 */
export const CAMERA_GLIDE_RATE = 6;

/**
 * How far from the bot's centre toward a tapped part the view travels.
 * 1 would centre the part exactly and push a wide bot off frame; 0 would
 * never move. Two thirds keeps the tapped part clearly the subject while
 * the bot stays in shot.
 */
export const FRAME_TOWARD_PART = 0.65;

/** Below this distance (world units) a glide counts as arrived. */
export const SETTLE_EPSILON = 0.002;

/**
 * Centre of the axis-aligned bounds of a set of points. The canvas passes
 * each part's two bounding corners so extents count, not just anchors
 * (a wide wheel shifts the centre more than a spike does). Empty input
 * centres on the origin, where the core sits.
 */
export function boundsCenter(points: Iterable<Vec3Like>): Vec3Like {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const p of points) {
    any = true;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  if (!any) return { x: 0, y: 0, z: 0 };
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  };
}

/**
 * Where the view should look after a tap: from the bot's centre, most of
 * the way toward the tapped part. With no part (a deselect, or a part that
 * has no placement) the centre itself.
 */
export function frameTarget(
  center: Vec3Like,
  part: Vec3Like | null,
  toward = FRAME_TOWARD_PART,
): Vec3Like {
  if (!part) return { x: center.x, y: center.y, z: center.z };
  return {
    x: center.x + (part.x - center.x) * toward,
    y: center.y + (part.y - center.y) * toward,
    z: center.z + (part.z - center.z) * toward,
  };
}

/** The camera position that frames a target from the default offset. */
export function defaultCameraPosition(target: Vec3Like): Vec3Like {
  return {
    x: target.x + DEFAULT_CAMERA_OFFSET.x,
    y: target.y + DEFAULT_CAMERA_OFFSET.y,
    z: target.z + DEFAULT_CAMERA_OFFSET.z,
  };
}

/**
 * Fraction of the remaining distance to cover this frame. Frame-rate
 * independent: two 8 ms frames land where one 16 ms frame does.
 */
export function glideFraction(dt: number, rate = CAMERA_GLIDE_RATE): number {
  if (!(dt > 0)) return 0;
  return 1 - Math.exp(-rate * dt);
}

/** True when two points are within the settle distance of each other. */
export function isSettled(
  a: Vec3Like,
  b: Vec3Like,
  epsilon = SETTLE_EPSILON,
): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz <= epsilon * epsilon;
}
