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
/** Perimeter wall height and thickness. */
export const ARENA_WALL_HEIGHT = 3;
export const ARENA_WALL_THICKNESS = 0.5;
/** How bouncy the walls are: enough to read as a rebound, not a trampoline. */
export const ARENA_WALL_RESTITUTION = 0.55;

/**
 * A fresh world with the standard arena floor and the bounce walls, fixed
 * timestep configured. Shared by the arena viewer, combat tests, and the
 * match-resolve function; identical construction everywhere is part of the
 * determinism contract.
 */
export async function createArenaWorld(): Promise<World> {
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
  // offset keeps the inner faces exactly at +-ARENA_WALL_HALF_EXTENT.
  const reach = ARENA_WALL_HALF_EXTENT + ARENA_WALL_THICKNESS;
  const wallY = ARENA_WALL_HEIGHT / 2;
  const walls: ReadonlyArray<{
    hx: number;
    hz: number;
    x: number;
    z: number;
  }> = [
    { hx: reach, hz: ARENA_WALL_THICKNESS, x: 0, z: -reach },
    { hx: reach, hz: ARENA_WALL_THICKNESS, x: 0, z: reach },
    { hx: ARENA_WALL_THICKNESS, hz: reach, x: -reach, z: 0 },
    { hx: ARENA_WALL_THICKNESS, hz: reach, x: reach, z: 0 },
  ];
  for (const wall of walls) {
    world.createCollider(
      R.ColliderDesc.cuboid(wall.hx, wallY, wall.hz)
        .setTranslation(wall.x, wallY, wall.z)
        .setRestitution(ARENA_WALL_RESTITUTION),
    );
  }
  return world;
}
