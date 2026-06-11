import type { World } from "@dimforge/rapier3d-deterministic-compat";
import { DT, GRAVITY } from "./constants";
import { ensureRapier } from "./world";

/** Half extent of the square arena floor collider. */
export const ARENA_HALF_EXTENT = 50;

/**
 * A fresh world with the standard arena floor, fixed timestep configured.
 * Shared by the arena viewer, combat tests, and (later) the match-resolve
 * function; identical construction everywhere is part of the determinism
 * contract.
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
  return world;
}
