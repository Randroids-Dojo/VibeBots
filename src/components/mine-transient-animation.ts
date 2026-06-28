export const CLANKER_BURST_VISIBLE_SECONDS = 1.15;

export function transientAnimationProgress(
  ageSeconds: number,
  durationSeconds: number,
): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 1;
  if (!Number.isFinite(ageSeconds)) return 1;
  return Math.min(1, Math.max(0, ageSeconds / durationSeconds));
}

export function transientAnimationActive(
  ageSeconds: number,
  durationSeconds: number,
): boolean {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  return ageSeconds >= 0 && ageSeconds <= durationSeconds;
}

export function dissipatingOpacity(
  ageSeconds: number,
  durationSeconds: number,
): number {
  return 1 - transientAnimationProgress(ageSeconds, durationSeconds);
}
