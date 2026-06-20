export interface FrameMetricSummary {
  frameCount: number;
  avgFrameMs: number;
  p50FrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  longFrameCount: number;
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
}

export function summarizeFrameMetrics(
  frameMs: readonly number[],
): FrameMetricSummary {
  const valid = frameMs.filter((value) => Number.isFinite(value) && value >= 0);
  const sorted = [...valid].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    frameCount: sorted.length,
    avgFrameMs: sorted.length === 0 ? 0 : roundTenth(total / sorted.length),
    p50FrameMs: roundTenth(percentile(sorted, 0.5)),
    p95FrameMs: roundTenth(percentile(sorted, 0.95)),
    maxFrameMs: roundTenth(sorted.at(-1) ?? 0),
    longFrameCount: sorted.filter((value) => value >= 50).length,
  };
}
