import type { BotDesign } from "./design";
import { computeLayout, isQuarterTurned } from "./layout";
import {
  PART_CATALOG,
  type PartDef,
  type PartShape,
  partMass,
  shapeHalfExtents,
} from "./parts";

/**
 * Where a bot's mass sits, what carries it, and whether it stands up.
 *
 * This is sim-domain geometry, not presentation: it reads the same
 * computeLayout placements assembly uses, so what it measures is what
 * fights, and living here means the sim can reach it (a future legality
 * rule about bots that cannot stand has somewhere to live). Only the
 * tip-over ANGLE is exiled to src/lib, because converting the margin to
 * degrees needs an inverse tangent, and the purity gate bans transcendental
 * calls here; every computation below is arithmetic and square roots, which
 * are allowed. (The gate greps for the call by name, comments included, so
 * this note deliberately spells it out in words.)
 */

export interface Point2 {
  x: number;
  z: number;
}

/**
 * How far above the floor a part can sit and still form the footprint, in
 * metres.
 *
 * A strict "is it touching" test is the wrong model here. A two-wheeled bot
 * touches the floor along a single axle line, so a strict test reports it as
 * having no fore-aft support at all and a tip-over angle of zero, which is
 * both alarming and useless: the chassis catches it the instant it pitches.
 * What the builder needs to know is how far the bot can lean before the mass
 * leaves the shape it can settle onto, so the footprint is every part low
 * enough to carry OR catch the bot. 0.25 covers a chassis riding on wheels of
 * the catalog's size while still excluding parts mounted up high.
 */
export const SUPPORT_REACH = 0.25;

/**
 * Where a part meets the floor, in the ground plane. A round part rolling
 * on its rim touches along a line, not across its whole footprint, so a
 * horizontal cylinder contributes a segment along its axis and a ball
 * contributes a point. Anything else contributes its footprint rectangle.
 */
function contactPoints(
  shape: PartShape,
  center: Point2,
  yawSwapped: boolean,
): Point2[] {
  if (shape.type === "ball") return [{ ...center }];
  if (shape.type === "cylinder" && shape.axis !== "y") {
    const half = shape.halfHeight;
    // A yaw quarter-turn swaps which ground axis the barrel lies along.
    const alongX = (shape.axis === "x") !== yawSwapped;
    return alongX
      ? [
          { x: center.x - half, z: center.z },
          { x: center.x + half, z: center.z },
        ]
      : [
          { x: center.x, z: center.z - half },
          { x: center.x, z: center.z + half },
        ];
  }
  const { hx, hz } = shapeHalfExtents(shape);
  const ex = yawSwapped ? hz : hx;
  const ez = yawSwapped ? hx : hz;
  return [
    { x: center.x - ex, z: center.z - ez },
    { x: center.x + ex, z: center.z - ez },
    { x: center.x + ex, z: center.z + ez },
    { x: center.x - ex, z: center.z + ez },
  ];
}

function cross(o: Point2, a: Point2, b: Point2): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

/**
 * Andrew's monotone chain. Returns the hull counter-clockwise in the x/z
 * plane, or the 1 or 2 distinct points when the input is degenerate (a bot
 * balanced on a single axle really does have a line for a footprint).
 */
export function convexHull(points: readonly Point2[]): Point2[] {
  const sorted = [...points].sort((a, b) =>
    a.x === b.x ? a.z - b.z : a.x - b.x,
  );
  const unique: Point2[] = [];
  for (const point of sorted) {
    const last = unique[unique.length - 1];
    if (last && last.x === point.x && last.z === point.z) continue;
    unique.push(point);
  }
  if (unique.length < 3) return unique;

  const build = (input: readonly Point2[]): Point2[] => {
    const chain: Point2[] = [];
    for (const point of input) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0
      ) {
        chain.pop();
      }
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  // Collinear input legitimately reduces to the two endpoints of the line.
  // Falling back to the raw points here would report a bot balanced on one
  // axle as having a real footprint.
  return [...build(unique), ...build([...unique].reverse())];
}

function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) {
    return Math.sqrt((p.x - a.x) ** 2 + (p.z - a.z) ** 2);
  }
  const raw = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq;
  const t = Math.max(0, Math.min(1, raw));
  const cx = a.x + t * dx;
  const cz = a.z + t * dz;
  return Math.sqrt((p.x - cx) ** 2 + (p.z - cz) ** 2);
}

/**
 * Signed distance from a point to a convex hull: positive inside, negative
 * outside, and the magnitude is the distance to the nearest edge. A
 * degenerate hull (fewer than 3 points) has no interior, so the result is
 * never positive: a bot with a line for a footprint has nothing holding it
 * up fore and aft.
 */
export function signedDistanceToHull(
  point: Point2,
  hull: readonly Point2[],
): number {
  if (hull.length === 0) return Number.NEGATIVE_INFINITY;
  if (hull.length < 3) {
    const distance =
      hull.length === 1
        ? Math.sqrt((point.x - hull[0].x) ** 2 + (point.z - hull[0].z) ** 2)
        : distanceToSegment(point, hull[0], hull[1]);
    return -distance;
  }
  let inside = true;
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    if (cross(a, b, point) < 0) inside = false;
    nearest = Math.min(nearest, distanceToSegment(point, a, b));
  }
  return inside ? nearest : -nearest;
}

export interface BalanceReport {
  totalMass: number;
  /** Mass-weighted centre of the whole design, in bot-local space. */
  centerOfMass: { x: number; y: number; z: number };
  /** Height of the centre of mass above the parts that touch the floor. */
  centerOfMassHeight: number;
  /** The footprint the bot stands on, counter-clockwise. */
  support: Point2[];
  /** Instance ids of the parts forming the footprint, in design order. */
  supportingIids: string[];
  /**
   * Horizontal distance from the centre of mass to the nearest edge of the
   * footprint. Positive means the mass sits over the footprint.
   */
  stabilityMargin: number;
  /** True when the centre of mass sits over the footprint. */
  balanced: boolean;
}

export function computeBalance(
  design: BotDesign,
  catalog: Record<string, PartDef> = PART_CATALOG,
): BalanceReport {
  const placements = computeLayout(design, catalog);

  let totalMass = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  let groundY = Number.POSITIVE_INFINITY;
  const resolved: Array<{
    iid: string;
    def: PartDef;
    position: { x: number; y: number; z: number };
    yawSwapped: boolean;
    lowY: number;
  }> = [];

  for (const instance of design.parts) {
    const def = catalog[instance.partId];
    const placement = placements.get(instance.iid);
    if (!def || !placement) continue;
    const mass = partMass(def);
    totalMass += mass;
    mx += placement.position.x * mass;
    my += placement.position.y * mass;
    mz += placement.position.z * mass;

    // Quarter-turn yaw swaps the x and z extents; same shared test the
    // design overlap check uses, which keeps every part axis aligned.
    const yawSwapped = isQuarterTurned(placement.rotation);
    const { hy } = shapeHalfExtents(def.shape);
    const lowY = placement.position.y - hy;
    groundY = Math.min(groundY, lowY);
    resolved.push({
      iid: instance.iid,
      def,
      position: placement.position,
      yawSwapped,
      lowY,
    });
  }

  const centerOfMass =
    totalMass > 0
      ? { x: mx / totalMass, y: my / totalMass, z: mz / totalMass }
      : { x: 0, y: 0, z: 0 };

  const points: Point2[] = [];
  const supportingIids: string[] = [];
  for (const entry of resolved) {
    if (entry.lowY - groundY > SUPPORT_REACH) continue;
    supportingIids.push(entry.iid);
    points.push(
      ...contactPoints(
        entry.def.shape,
        { x: entry.position.x, z: entry.position.z },
        entry.yawSwapped,
      ),
    );
  }

  const support = convexHull(points);
  const stabilityMargin = signedDistanceToHull(
    { x: centerOfMass.x, z: centerOfMass.z },
    support,
  );
  const centerOfMassHeight = Number.isFinite(groundY)
    ? centerOfMass.y - groundY
    : 0;

  return {
    totalMass,
    centerOfMass,
    centerOfMassHeight,
    support,
    supportingIids,
    stabilityMargin,
    balanced: stabilityMargin > 0,
  };
}
