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
/**
 * Upper bound for a valid deadline: 24 hours in milliseconds. The real deadline
 * is always well under the 20-minute job budget; this only rejects absurd or
 * precision-losing values (a digit string past this is a mistake, and anything
 * near Number.MAX_SAFE_INTEGER would round when parsed).
 */
const MAX_E2E_GLOBAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export function parseE2EGlobalTimeout(
  value: string | undefined,
): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(
      `Invalid E2E_GLOBAL_TIMEOUT_MS "${value}". Use a positive integer of milliseconds, or leave it unset for no global timeout.`,
    );
  }
  const parsed = Number(value);
  if (parsed > MAX_E2E_GLOBAL_TIMEOUT_MS) {
    throw new Error(
      `E2E_GLOBAL_TIMEOUT_MS "${value}" exceeds the maximum of ${MAX_E2E_GLOBAL_TIMEOUT_MS} ms (24 hours).`,
    );
  }
  return parsed;
}
