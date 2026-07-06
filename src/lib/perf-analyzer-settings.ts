/**
 * Opt-in performance analyzer settings (REQ-041 deep telemetry, F-054).
 * Renderer-free so the settings UI, the telemetry collector, and the
 * renderer factory can all read the same flag. Persistence follows the
 * graphics-quality pattern: guarded localStorage, never throws.
 */

export const PERF_ANALYZER_STORAGE_KEY = "vibebots-perf-analyzer-v1";
export const PERF_AB_VARIANT_STORAGE_KEY = "vibebots-perf-ab-variant";

/** Fired on window after the toggle changes so live collectors react. */
export const PERF_ANALYZER_CHANGED_EVENT = "vibebots-perf-analyzer-changed";

export function perfAnalyzerEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PERF_ANALYZER_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function persistPerfAnalyzerEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(
      PERF_ANALYZER_STORAGE_KEY,
      enabled ? "on" : "off",
    );
  } catch {
    // Storage unavailable (private mode): the toggle is session-only.
  }
}

/**
 * A/B variant tag recorded on every trace row. Set explicitly with the
 * `?perfVariant=` query param (persisted) so candidate fixes can be
 * compared quantitatively between cohorts of the same build.
 */
export function readPerfAbVariant(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const fromQuery = new URLSearchParams(window.location.search).get(
      "perfVariant",
    );
    if (fromQuery !== null) {
      const cleaned = fromQuery.slice(0, 40);
      if (cleaned === "") {
        window.localStorage.removeItem(PERF_AB_VARIANT_STORAGE_KEY);
        return null;
      }
      window.localStorage.setItem(PERF_AB_VARIANT_STORAGE_KEY, cleaned);
      return cleaned;
    }
    return window.localStorage.getItem(PERF_AB_VARIANT_STORAGE_KEY);
  } catch {
    return null;
  }
}
