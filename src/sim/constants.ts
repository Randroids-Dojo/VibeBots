/**
 * Sim-wide constants. SIM_VERSION must bump on any change that alters
 * physics results: a rapier version bump, a DT change, or a change to
 * world construction. Stored hashes from older SIM_VERSIONs are invalid.
 *
 * 9 (2026-09-04): weapon mounts can carry a pitch (the second bench
 *   lever); a design with one builds a different world, so every stored
 *   hash from 8 or earlier is invalid.
 * 8 (2026-09-02): the Tower core's collider changed (0.8 tall, axles a
 * tenth below centre) so the tall chassis can close on an opponent (F-249).
 */
export const SIM_VERSION = 9;

/** Fixed timestep in seconds. The sim never steps with a variable dt. */
export const DT = 1 / 60;

export const GRAVITY = { x: 0, y: -9.81, z: 0 } as const;

/** Default step count for a verification run (10 seconds of sim time). */
export const DEFAULT_STEPS = 600;

/**
 * The walking-skeleton scene teleports its bodies back to spawn every
 * this-many ticks so the scene moves forever. Part of the deterministic
 * evolution: client and server both apply it inside stepSim.
 */
export const RESET_INTERVAL_STEPS = 240;
