import type { BunkerFootprint } from "@/sim/bunker";

/**
 * Pure travel-presentation math for the first-person raid's Clankers:
 * which way a body faces while it walks its 3D route, and whether its
 * interpolated position is inside the visible room or still out in the
 * exterior approach (buried in the claim's shell rock). No three
 * imports, so the heading, climb, and burrow-crossing rules unit-test
 * in node. Every function is scalar-in/scalar-out and runs on the
 * frame path, so nothing here may allocate.
 *
 * Frame convention (matches the FpClankerLayer hierarchy yaw > pitch >
 * upright tilt > body): after the upright tilt the authored body faces
 * world +x with its top up, so a yaw of 0 walks +x, and a positive
 * pitch about the yawed frame's z-axis noses the body upward.
 */

/** How fast a body turns toward its travel heading, per second. High
 * enough to settle well inside one 1/3 s hop, low enough that a corner
 * reads as a turn instead of a snap. */
export const FP_CLANKER_TURN_RATE = 10;

const TWO_PI = Math.PI * 2;

/**
 * Yaw that faces the +x-authored body along the horizontal travel
 * direction (world dx, dz). A three.js rotation.y of a maps body
 * forward +x onto (cos a, 0, -sin a), so facing (dx, dz) needs
 * atan2(-dz, dx). A purely vertical hop has no horizontal heading;
 * the caller passes the current yaw as `fallback` so the climb keeps
 * the last facing instead of whipping to zero.
 */
export function fpClankerTravelYaw(
  dx: number,
  dz: number,
  fallback: number,
): number {
  if (dx === 0 && dz === 0) return fallback;
  return Math.atan2(-dz, dx);
}

/**
 * Pitch (rotation about the yawed frame's z-axis) that noses the body
 * along the vertical component of its travel: +PI/2 climbing straight
 * up, -PI/2 crawling straight down, 0 on a level hop, and a slope for
 * any mixed motion.
 */
export function fpClankerTravelPitch(
  dx: number,
  dy: number,
  dz: number,
): number {
  if (dy === 0) return 0;
  return Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
}

/** Wraps an angle difference to (-PI, PI] so damping always turns the
 * short way around. */
export function shortestAngleDelta(from: number, to: number): number {
  let diff = (to - from) % TWO_PI;
  if (diff > Math.PI) diff -= TWO_PI;
  if (diff <= -Math.PI) diff += TWO_PI;
  return diff;
}

/**
 * Frame-rate-independent exponential approach of `current` toward
 * `target` along the shortest arc. Returns the new angle; the caller
 * stores it as the next frame's `current`.
 */
export function dampAngleToward(
  current: number,
  target: number,
  ratePerSecond: number,
  deltaSeconds: number,
): number {
  const diff = shortestAngleDelta(current, target);
  const step = 1 - Math.exp(-ratePerSecond * Math.max(0, deltaSeconds));
  return current + diff * step;
}

/**
 * True when an interpolated mine-grid position sits inside the visible
 * first-person room. The room's edge cells span half a cell around
 * their integer centers, so the boundary face planes sit at +-0.5
 * outside the footprint's edge columns and rows; a Clanker out in the
 * depth-0 approach ring is beyond a face plane, buried in the claim's
 * shell rock, and must not render. The face plane itself counts as
 * outside, so a body crossing on an enter hop flips visible exactly
 * when its center clears the rock face.
 */
export function fpClankerInsideRoom(
  footprint: BunkerFootprint,
  col: number,
  row: number,
): boolean {
  return (
    col > footprint.col - 0.5 &&
    col < footprint.col + footprint.width - 0.5 &&
    row > footprint.row - 0.5 &&
    row < footprint.row + footprint.height - 0.5
  );
}
