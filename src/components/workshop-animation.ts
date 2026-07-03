/**
 * Pure easing curves for the workshop bench feel (W5). No three or react
 * imports, so the snap, pulse, and ghost-breathing math is unit-testable
 * without a frame loop. This is presentation code (not the deterministic
 * sim), so transcendental Math is allowed here.
 */

export const MOUNT_SECONDS = 0.18;
export const PULSE_SECONDS = 0.35;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Classic smoothstep on [0,1], clamped outside. */
export function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/**
 * Scale for a placed part: it pops in from small on mount (mountT 0..1)
 * and gets a brief bump when it merges up a level (pulseT 0..1). Settles
 * to exactly 1 once mounted and the pulse has decayed.
 */
export function snapScale(mountT: number, pulseT: number): number {
  return 0.4 + 0.6 * smoothstep(mountT) + 0.18 * clamp01(pulseT);
}

/**
 * Ghost opacity: a gentle breathe so the valid placement slots read as
 * interactive rather than static wireframe.
 */
export function ghostOpacity(elapsedSeconds: number): number {
  return 0.28 + 0.12 * (0.5 + 0.5 * Math.sin(elapsedSeconds * 3));
}

/** Advance a 0..1 timer toward 1 over `seconds`, clamped. */
export function advance(current: number, dt: number, seconds: number): number {
  return Math.min(1, current + dt / seconds);
}

/** Decay a 0..1 envelope toward 0 over `seconds`, clamped. */
export function decay(current: number, dt: number, seconds: number): number {
  return Math.max(0, current - dt / seconds);
}
