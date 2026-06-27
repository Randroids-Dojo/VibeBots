export function parsePlaywrightWorkerCount(
  configuredWorkers: string | undefined,
): number {
  if (configuredWorkers === undefined) return 2;
  return /^[1-9]\d*$/.test(configuredWorkers)
    ? Number(configuredWorkers)
    : Number.NaN;
}
