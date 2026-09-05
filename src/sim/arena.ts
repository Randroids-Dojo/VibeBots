import type { World } from "@dimforge/rapier3d-deterministic-compat";
import { DT, GRAVITY } from "./constants";
import { ensureRapier } from "./world";

/** Half extent of the square arena floor collider. */
export const ARENA_HALF_EXTENT = 50;

/**
 * The fight happens inside a tight walled ring (F-063), not the wide open
 * floor: bots spawn near the middle (z = +-3) and the walls sit just past
 * them, so a shove that used to send a bot skating off into empty space
 * now bounces it back into the brawl. Small enough to keep the action
 * framed, wide enough that the opening clash still happens at center.
 */
export const ARENA_WALL_HALF_EXTENT = 9;
/**
 * Perimeter wall height and thickness. The height matches the rendered
 * barrier (arena-canvas derives its wall mesh from this), so a bot bounces
 * off exactly what it sees: no phantom collision above the visible wall,
 * and tall parts overhang the rail instead of hitting hidden geometry.
 */
export const ARENA_WALL_HEIGHT = 1.4;
export const ARENA_WALL_THICKNESS = 0.5;
/** How bouncy the walls are: enough to read as a rebound, not a trampoline. */
export const ARENA_WALL_RESTITUTION = 0.55;

/**
 * An arena is the ring the walls make (the arenas program, 2026-09-05):
 * the floor collider is shared, the walls' half extent, height, and bounce
 * are the spec. The ring is today's arena byte for byte; every other spec
 * builds its colliders in the same order, so a fight's hash depends on
 * which arena it ran in and on nothing about how the world was assembled.
 */
export interface ArenaSpec {
  id: ArenaId;
  name: string;
  /** One line for the picker and the debrief. */
  blurb: string;
  wallHalfExtent: number;
  wallHeight: number;
  wallThickness: number;
  wallRestitution: number;
}

export const ARENA_IDS = ["ring", "pit"] as const;
export type ArenaId = (typeof ARENA_IDS)[number];

export const ARENAS: Record<ArenaId, ArenaSpec> = {
  ring: {
    id: "ring",
    name: "the Ring",
    blurb: "The standard floor: room to flank, walls that bounce.",
    wallHalfExtent: ARENA_WALL_HALF_EXTENT,
    wallHeight: ARENA_WALL_HEIGHT,
    wallThickness: ARENA_WALL_THICKNESS,
    wallRestitution: ARENA_WALL_RESTITUTION,
  },
  pit: {
    id: "pit",
    name: "the Pit",
    blurb:
      "A tight floor with hard walls: no room to flank, every shove rebounds.",
    wallHalfExtent: 6,
    wallHeight: 1.4,
    wallThickness: ARENA_WALL_THICKNESS,
    wallRestitution: 0.8,
  },
};

export const DEFAULT_ARENA_ID: ArenaId = "ring";

export function isArenaId(value: unknown): value is ArenaId {
  return (
    typeof value === "string" &&
    (ARENA_IDS as readonly string[]).includes(value)
  );
}

/**
 * A fresh world with the standard arena floor and the bounce walls, fixed
 * timestep configured. Shared by the arena viewer, combat tests, and the
 * match-resolve function; identical construction everywhere is part of the
 * determinism contract.
 */
export async function createArenaWorld(
  spec: ArenaSpec = ARENAS[DEFAULT_ARENA_ID],
): Promise<World> {
  const R = await ensureRapier();
  const world = new R.World(GRAVITY);
  world.integrationParameters.dt = DT;
  world.createCollider(
    R.ColliderDesc.cuboid(
      ARENA_HALF_EXTENT,
      0.5,
      ARENA_HALF_EXTENT,
    ).setTranslation(0, -0.5, 0),
  );
  // Four perimeter walls centered on the play ring. The half-thickness
  // offset keeps the inner faces exactly at +-wallHalfExtent.
  const reach = spec.wallHalfExtent + spec.wallThickness;
  const wallY = spec.wallHeight / 2;
  const walls: ReadonlyArray<{
    hx: number;
    hz: number;
    x: number;
    z: number;
  }> = [
    { hx: reach, hz: spec.wallThickness, x: 0, z: -reach },
    { hx: reach, hz: spec.wallThickness, x: 0, z: reach },
    { hx: spec.wallThickness, hz: reach, x: -reach, z: 0 },
    { hx: spec.wallThickness, hz: reach, x: reach, z: 0 },
  ];
  for (const wall of walls) {
    world.createCollider(
      R.ColliderDesc.cuboid(wall.hx, wallY, wall.hz)
        .setTranslation(wall.x, wallY, wall.z)
        .setRestitution(spec.wallRestitution),
    );
  }
  return world;
}
