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
  /** Frames rendered while the track was still in motion (QA surface). */
  frames: number;
}

export const easeStep = (t: number) => 0.5 - Math.cos(t * Math.PI) * 0.5;

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
    frames: 0,
  };
}

/** Re-aim a live track at a new target; an unchanged target keeps the
 * current track so mid-glide progress never restarts. */
export function retargetMotion(
  track: MotionTrack | null,
  now: number,
  currentX: number,
  currentY: number,
  targetX: number,
  targetY: number,
  duration: number,
): MotionTrack {
  if (track && track.toX === targetX && track.toY === targetY) return track;
  return {
    fromX: currentX,
    fromY: currentY,
    toX: targetX,
    toY: targetY,
    startedAt: now,
    duration,
    frames: 0,
  };
}

export function motionProgress(track: MotionTrack, now: number): number {
  const raw = (now - track.startedAt) / track.duration;
  return Math.max(0, Math.min(1, raw));
}

export function sampleMotion(
  track: MotionTrack,
  now: number,
  out?: [number, number],
): [number, number] {
  const t = motionProgress(track, now);
  const eased = easeStep(t);
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
