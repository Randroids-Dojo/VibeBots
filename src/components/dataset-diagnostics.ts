/**
 * Quantize-and-cache canvas dataset diagnostics. Frame loops call these
 * every frame, but a string (and a DOM attribute mutation) is only
 * produced when the rounded value actually changed. Unconditional
 * per-frame dataset writes were the top garbage source in the
 * real-phone GC traces behind F-074; the mine canvas adopted these
 * first, and the arena, workshop, and holodeck loops should follow
 * (F-076). Callers own the cache object (one per canvas, kept in a
 * ref) so caches never leak across mounts.
 */

const DATASET_QUANTUM = [1, 10, 100, 1_000, 10_000] as const;

export function setDatasetNumber(
  cache: Record<string, number | string>,
  dataset: DOMStringMap,
  key: string,
  value: number,
  decimals: 0 | 1 | 2 | 3 | 4,
): void {
  const quantized = Math.round(value * DATASET_QUANTUM[decimals]);
  if (cache[key] === quantized) return;
  cache[key] = quantized;
  dataset[key] = (quantized / DATASET_QUANTUM[decimals]).toFixed(decimals);
}

export function setDatasetText(
  cache: Record<string, number | string>,
  dataset: DOMStringMap,
  key: string,
  value: string,
): void {
  if (cache[key] === value) return;
  cache[key] = value;
  dataset[key] = value;
}
