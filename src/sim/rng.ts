/**
 * Deterministic randomness for the sim comes exclusively from VibeKit's
 * seeded Mulberry32. Seedless engine randomness is banned in src/sim (see
 * scripts/check-sim-purity.sh). The object form (createRng/splitRng/
 * serializeRng/deserializeRng) is preferred: sub-streams per subsystem
 * keep replay determinism stable as systems are added.
 */

export type { Rng } from "@randroids-dojo/vibekit";
export {
  createRng,
  deserializeRng,
  makeRng,
  serializeRng,
  splitRng,
} from "@randroids-dojo/vibekit";
