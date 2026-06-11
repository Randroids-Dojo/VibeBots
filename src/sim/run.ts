import { DEFAULT_STEPS, SIM_VERSION } from "./constants";
import { fnv1a64 } from "./hash";
import { createSimWorld, stepSim } from "./world";

export interface RunSimOptions {
  seed: number;
  steps?: number;
}

export interface RunSimResult {
  seed: number;
  steps: number;
  hash: string;
  simVersion: number;
}

/**
 * Runs a complete sim from a seed and fingerprints the final world state.
 * This is the hybrid-authority primitive: the browser and the server both
 * call this and must produce the same hash for the same seed and steps.
 */
export async function runSim({
  seed,
  steps = DEFAULT_STEPS,
}: RunSimOptions): Promise<RunSimResult> {
  const sim = await createSimWorld(seed);
  try {
    for (let i = 0; i < steps; i++) {
      stepSim(sim);
    }
    return {
      seed,
      steps,
      hash: fnv1a64(sim.world.takeSnapshot()),
      simVersion: SIM_VERSION,
    };
  } finally {
    sim.world.free();
  }
}
