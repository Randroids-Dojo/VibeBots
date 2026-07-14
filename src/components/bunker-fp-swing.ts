/**
 * Pure pickaxe swing state machine for first-person mining (F-114).
 * The rig owns a single FpSwingState and drives it from the frame loop:
 * a press starts a swing, the strike lands once at FP_SWING_IMPACT, and
 * a completed swing auto-restarts while the input stays held so a held
 * press mines block after block. Kept free of three/React so the timing
 * and the swing curve are unit-testable in node; the caller applies the
 * throw to the view-model transform and gates the dig on what the
 * crosshair sees.
 */

/** One full swing (chop plus recover), in seconds. */
export const FP_SWING_SECONDS = 0.42;
/** Fraction of the swing at which the pick connects with the rock. The
 * throw peaks here, so the visual impact matches the dig. */
export const FP_SWING_IMPACT = 0.34;

export interface FpSwingState {
  /** A swing is in progress. */
  active: boolean;
  /** Elapsed seconds within the current swing. */
  t: number;
  /** This swing's impact already reported, so it strikes at most once. */
  struck: boolean;
}

export function createFpSwingState(): FpSwingState {
  return { active: false, t: 0, struck: false };
}

/** Begin a swing unless one is already running (a fresh press). */
export function startFpSwing(state: FpSwingState): void {
  if (state.active) return;
  state.active = true;
  state.t = 0;
  state.struck = false;
}

/**
 * Advance the swing by dt. Returns true on the single frame the pick
 * connects (crosses FP_SWING_IMPACT), so the caller can land the dig.
 * When the swing finishes it auto-restarts while `held`, otherwise it
 * goes idle.
 */
export function advanceFpSwing(
  state: FpSwingState,
  dt: number,
  held: boolean,
): boolean {
  if (!state.active) return false;
  state.t += dt;
  const phase = state.t / FP_SWING_SECONDS;
  let struckNow = false;
  if (!state.struck && phase >= FP_SWING_IMPACT) {
    state.struck = true;
    struckNow = true;
  }
  if (phase >= 1) {
    // Held: restart in place for the next block. Released: go idle.
    if (held) {
      state.t = 0;
      state.struck = false;
    } else {
      state.active = false;
    }
  }
  return struckNow;
}

/**
 * The 0..1 swing throw for the current phase: a quick sine chop up to
 * FP_SWING_IMPACT, then a cosine ease back. Returns 0 when idle and
 * peaks at 1 exactly at impact.
 */
export function fpSwingThrow(state: FpSwingState): number {
  if (!state.active) return 0;
  const phase = Math.min(1, state.t / FP_SWING_SECONDS);
  return phase < FP_SWING_IMPACT
    ? Math.sin((phase / FP_SWING_IMPACT) * (Math.PI / 2))
    : Math.cos(
        ((phase - FP_SWING_IMPACT) / (1 - FP_SWING_IMPACT)) * (Math.PI / 2),
      );
}
