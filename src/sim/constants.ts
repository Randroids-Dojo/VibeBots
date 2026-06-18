/**
 * Sim-wide constants. SIM_VERSION must bump on any change that alters
 * physics results: a rapier version bump, a DT change, or a change to
 * world construction. Stored hashes from older SIM_VERSIONs are invalid.
 */
export const SIM_VERSION = 3;

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
