/**
 * Pure geometry helpers for the direct-manipulation build (N2). The canvas
 * projects each valid placement slot to normalized device coordinates with
 * the live camera; these helpers turn a drag pointer plus those projected
 * points into "which slot is under the finger", with no three or react
 * imports so the pick is unit-tested.
 */

export interface ProjectedPoint {
  x: number;
  y: number;
  /** NDC depth: outside [-1, 1] means behind the camera or past the far
   *  plane, so the slot is not a real on-screen target. */
  z: number;
}

/**
 * Index of the projected slot nearest the pointer in NDC, or -1 when none
 * is within maxDist or all are outside the frustum. Ties keep the earlier
 * (deterministic design-order) slot.
 */
export function pickNearestSlot(
  slots: ProjectedPoint[],
  pointer: { x: number; y: number },
  maxDist: number,
): number {
  let best = -1;
  let bestSq = maxDist * maxDist;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.z < -1 || slot.z > 1) continue;
    const dx = slot.x - pointer.x;
    const dy = slot.y - pointer.y;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      bestSq = sq;
      best = i;
    }
  }
  return best;
}

/**
 * Client pixel coordinates to NDC within an element's bounding rect, with
 * the y axis flipped (NDC up is positive, screen down is positive).
 */
export function clientToNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -(((clientY - rect.top) / rect.height) * 2 - 1),
  };
}
