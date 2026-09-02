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
  // The merge pulse (K) overshoots harder so a level-up reads as the biggest
  // beat on the bench, then settles back to exactly 1 as it decays.
  return 0.4 + 0.6 * smoothstep(mountT) + 0.3 * clamp01(pulseT);
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

/*
 * Feel pass (G7): removal dissolves, drops spark, chains celebrate.
 */

/** How long a removed part takes to dissolve off the bench. */
export const DISSOLVE_SECONDS = 0.28;
/** How long a drop's spark burst lives. */
export const SPARK_SECONDS = 0.6;
/** Sparks per burst; the instanced mesh is sized to this once. */
export const SPARK_COUNT = 18;

/** A removed part shrinks from full size to a fifth as it goes. */
export function dissolveScale(t: number): number {
  return 1 - 0.8 * smoothstep(t);
}

/** And fades out on the same curve, fully gone at the end. */
export function dissolveOpacity(t: number): number {
  return 1 - smoothstep(t);
}

/** And drops a little, so it reads as falling off rather than popping. */
export function dissolveSink(t: number): number {
  return 0.12 * smoothstep(t);
}

/**
 * Fixed spark directions: a golden-angle spiral over the upper hemisphere,
 * so a burst is even, deterministic (tests can pin it), and needs no
 * randomness at drop time.
 */
export function sparkDirections(
  count: number = SPARK_COUNT,
): { x: number; y: number; z: number }[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    // y from 0.25 to 0.95: every spark rises, none goes straight up.
    const y = 0.25 + (0.7 * (i + 0.5)) / count;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * golden;
    out.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r });
  }
  return out;
}

/** Spark travel along its direction: fast out, then hanging as it dies. */
export function sparkTravel(t: number): number {
  const c = clamp01(t);
  return 0.55 * (1 - (1 - c) * (1 - c));
}

/** Spark drop under gravity, applied to y after the travel. */
export function sparkDrop(t: number): number {
  const c = clamp01(t);
  return 0.35 * c * c;
}

/**
 * Spark size: near full for most of its life, gone at the end. The first
 * curve shrank quadratically from birth and a capture a tenth of a second
 * after the drop already caught the motes at a third of their size.
 */
export function sparkScale(t: number): number {
  const c = clamp01(t);
  return SPARK_SIZE * (1 - c * c);
}

/**
 * A spark's radius at birth in bench units. The first cut (0.06 shrinking
 * from birth, in the part's own grey) was invisible in a 390 wide capture
 * taken right after a drop (F-244); 0.14 turned the motes into popcorn and
 * 0.03 vanished again. At 0.07, warm white, holding its size for most
 * of a longer burst and started clear of the core, eighteen motes read
 * as sparks at phone size.
 */
export const SPARK_SIZE = 0.07;
