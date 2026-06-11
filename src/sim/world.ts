import type { RigidBody, World } from "@dimforge/rapier3d-deterministic-compat";
import RAPIER from "@dimforge/rapier3d-deterministic-compat";
import { DT, GRAVITY, RESET_INTERVAL_STEPS } from "./constants";
import { createRng } from "./rng";

let rapierReady: Promise<typeof RAPIER> | null = null;

/**
 * Resolves once the rapier WASM module is compiled. Cached module-wide:
 * cheap on warm serverless instances, safe under React strict mode.
 */
export function ensureRapier(): Promise<typeof RAPIER> {
  if (!rapierReady) {
    rapierReady = RAPIER.init().then(() => RAPIER);
  }
  return rapierReady;
}

interface SpawnState {
  translation: { x: number; y: number; z: number };
}

export interface SimWorld {
  world: World;
  bodies: { box: RigidBody; ball: RigidBody };
  spawns: { box: SpawnState; ball: SpawnState };
  tick: number;
}

/**
 * Builds the walking-skeleton scene: a ground slab plus a box and a ball
 * whose spawn positions are jittered by the seeded rng. Body and collider
 * creation order is part of the determinism contract; never reorder
 * without bumping SIM_VERSION.
 */
export async function createSimWorld(seed: number): Promise<SimWorld> {
  const R = await ensureRapier();
  const rng = createRng(seed);

  const world = new R.World(GRAVITY);
  world.integrationParameters.dt = DT;

  world.createCollider(
    R.ColliderDesc.cuboid(10, 0.5, 10).setTranslation(0, -0.5, 0),
  );

  const boxSpawn = {
    x: -2 + rng.next() * 1.5,
    y: 3 + rng.next() * 2,
    z: -0.75 + rng.next() * 1.5,
  };
  const box = world.createRigidBody(
    R.RigidBodyDesc.dynamic().setTranslation(
      boxSpawn.x,
      boxSpawn.y,
      boxSpawn.z,
    ),
  );
  world.createCollider(
    R.ColliderDesc.cuboid(0.5, 0.5, 0.5).setRestitution(0.4),
    box,
  );

  const ballSpawn = {
    x: 0.5 + rng.next() * 1.5,
    y: 4 + rng.next() * 2,
    z: -0.75 + rng.next() * 1.5,
  };
  const ball = world.createRigidBody(
    R.RigidBodyDesc.dynamic().setTranslation(
      ballSpawn.x,
      ballSpawn.y,
      ballSpawn.z,
    ),
  );
  world.createCollider(R.ColliderDesc.ball(0.5).setRestitution(0.7), ball);

  return {
    world,
    bodies: { box, ball },
    spawns: {
      box: { translation: boxSpawn },
      ball: { translation: ballSpawn },
    },
    tick: 0,
  };
}

/**
 * Advances the sim by exactly one fixed timestep. The periodic respawn is
 * part of the deterministic evolution: every consumer (browser preview,
 * server verification) steps through the same stepSim, so tick N of a
 * given seed is identical everywhere.
 */
export function stepSim(sim: SimWorld): void {
  if (sim.tick > 0 && sim.tick % RESET_INTERVAL_STEPS === 0) {
    respawnBody(sim.bodies.box, sim.spawns.box);
    respawnBody(sim.bodies.ball, sim.spawns.ball);
  }
  sim.world.step();
  sim.tick += 1;
}

function respawnBody(body: RigidBody, spawn: SpawnState): void {
  body.setTranslation(spawn.translation, true);
  body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}
