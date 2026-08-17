/**
 * Eased point-to-point motion tracks (mine-canvas decomposition slice).
 * One shape serves the camera glide, the miner glide, and the death
 * playback: this module replaces the private copy MineScene carried and
 * the structurally identical DeathPlaybackMotionTrack the playback
 * bridge redefined. Pure TypeScript so the easing math is unit-testable
 * without a frame loop.
 */

export interface MotionTrack {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAt: number;
  duration: number;
  /**
   * How much of the cosine ease applies: 1 is the classic full
   * ease-in-out (isolated steps settle softly), CHAIN_EASE_WEIGHT keeps
   * a mostly-linear cruise for mid-chain steps so a held walk carries
   * momentum through cell boundaries instead of stopping at each one.
   * Optional so externally-built tracks (death playback) keep the old
   * full-ease behavior without changes.
   */
  easeWeight?: number;
  /** Frames rendered while the track was still in motion (QA surface). */
  frames: number;
}

export const easeStep = (t: number) => 0.5 - Math.cos(t * Math.PI) * 0.5;

/** Mid-chain segments keep 65% of linear velocity at the boundaries:
 * enough softening to read as footfalls, no full stop per cell. */
export const CHAIN_EASE_WEIGHT = 0.35;

/** A new step chains when it starts within this many seconds of the
 * previous track's end (held repeats land ~90ms after the shortened
 * isolated glide settles; isolated re-taps arrive far later). Sized
 * with headroom for real-device timer jitter: a held repeat that lands
 * ~15% late must still read as one continuous stride. */
export const CHAIN_GAP_SECONDS = 0.22;

/** A track already at its target: used for camera jumps and resets. */
export function snapMotion(
  now: number,
  targetX: number,
  targetY: number,
  duration: number,
): MotionTrack {
  return {
    fromX: targetX,
    fromY: targetY,
    toX: targetX,
    toY: targetY,
    startedAt: now,
    duration,
    easeWeight: 1,
    frames: 0,
  };
}

/** Re-aim a live track at a new target; an unchanged target keeps the
 * current track so mid-glide progress never restarts.
 *
 * When chainDuration is provided, a step that CONTINUES the previous
 * one (starts within CHAIN_GAP_SECONDS of its end, heading the same
 * way) becomes a chained segment: it runs for chainDuration (the full
 * input-repeat interval, no standstill gap) with a mostly-linear ease,
 * so held walks and climbs stride through cells instead of stopping at
 * every boundary. Direction changes and late taps ease fresh. */
export function retargetMotion(
  track: MotionTrack | null,
  now: number,
  currentX: number,
  currentY: number,
  targetX: number,
  targetY: number,
  duration: number,
  chainDuration = duration,
): MotionTrack {
  if (track && track.toX === targetX && track.toY === targetY) return track;
  let chained = false;
  if (track && chainDuration !== duration) {
    const sinceEnd = now - (track.startedAt + track.duration);
    if (sinceEnd < CHAIN_GAP_SECONDS) {
      const prevDx = track.toX - track.fromX;
      const prevDy = track.toY - track.fromY;
      const nextDx = targetX - track.toX;
      const nextDy = targetY - track.toY;
      chained = prevDx * nextDx + prevDy * nextDy > 0;
    }
  }
  return {
    fromX: currentX,
    fromY: currentY,
    toX: targetX,
    toY: targetY,
    startedAt: now,
    duration: chained ? chainDuration : duration,
    easeWeight: chained ? CHAIN_EASE_WEIGHT : 1,
    frames: 0,
  };
}

export function motionProgress(track: MotionTrack, now: number): number {
  // A zero-length track is already done; dividing by it would poison the
  // first frame's sample with NaN.
  if (track.duration <= 0) return 1;
  const raw = (now - track.startedAt) / track.duration;
  return Math.max(0, Math.min(1, raw));
}

export function sampleMotion(
  track: MotionTrack,
  now: number,
  out?: [number, number],
): [number, number] {
  const t = motionProgress(track, now);
  const weight = track.easeWeight ?? 1;
  const eased = t + (easeStep(t) - t) * weight;
  const x = track.fromX + (track.toX - track.fromX) * eased;
  const y = track.fromY + (track.toY - track.fromY) * eased;
  // Frame loops pass a reused tuple so per-frame sampling allocates
  // nothing; without one the call returns a fresh pair.
  if (out) {
    out[0] = x;
    out[1] = y;
    return out;
  }
  return [x, y];
}
