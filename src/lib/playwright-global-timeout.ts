/**
 * The Playwright whole-suite deadline, in milliseconds, from
 * `E2E_GLOBAL_TIMEOUT_MS` (F-131). Scheduled Full E2E shards used to hit the
 * 20-minute GitHub job deadline and be CANCELLED, which skips the
 * `failure()`-guarded artifact upload and leaves zero evidence to triage. The
 * CI workflow now computes a deadline that ends before the job deadline (with a
 * teardown and upload buffer) and passes it here, so Playwright itself stops
 * with a normal failure, writes its report, and uploads it.
 *
 * Unset (or empty) means no global timeout, the normal local and Critical E2E
 * behavior. A malformed value fails fast rather than silently running unbounded.
 */
export function parseE2EGlobalTimeout(
  value: string | undefined,
): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(
      `Invalid E2E_GLOBAL_TIMEOUT_MS "${value}". Use a positive integer of milliseconds, or leave it unset for no global timeout.`,
    );
  }
  return Number(value);
}
