/**
 * TV-device detection for remote-first controls (Fire TV in the Silk
 * browser is the reference device). Silk's remote drives a virtual mouse
 * cursor: the D-pad moves the pointer and Select clicks, so a TV session
 * plays best with large stationary click targets rather than drag
 * gestures. Detection is user-agent based because no media query
 * distinguishes a TV browser from a desktop one.
 *
 * Fire TV device models all start with "AFT" (per Amazon's user-agent
 * docs), which separates them from Fire tablets, whose Silk UA carries
 * "KF" model codes instead. A handful of other TV browsers are matched
 * by their well-known UA tokens so a paired remote gets the same deck.
 */

/** Fire TV hardware model codes: AFTMA475B1, AFTKA, AFTT, and friends. */
const FIRE_TV_MODEL = /\bAFT[A-Z0-9]/;

/** Non-Amazon TV browsers that also navigate with a remote. */
const GENERIC_TV_TOKENS =
  /\b(?:Android TV|SMART-TV|SmartTV|Tizen|Web0S|WebOS|BRAVIA|CrKey|GoogleTV)\b/i;

export function isTvUserAgent(userAgent: string): boolean {
  return FIRE_TV_MODEL.test(userAgent) || GENERIC_TV_TOKENS.test(userAgent);
}

export const TV_MODE_STORAGE_KEY = "vibebots.tvMode";

/**
 * Resolve whether TV controls should be active. The `tv` query parameter
 * ("1"/"0") wins and persists, so a playtest, an e2e run, or a player on
 * an unrecognized TV browser can force the mode on or off once and keep
 * it across visits. With no override, the user agent decides.
 */
export function resolveTvMode({
  userAgent,
  search,
  stored,
}: {
  userAgent: string;
  search: string;
  stored: string | null;
}): { tvMode: boolean; persist: string | null } {
  const override = new URLSearchParams(search).get("tv");
  if (override === "1" || override === "0") {
    return { tvMode: override === "1", persist: override };
  }
  if (stored === "1" || stored === "0") {
    return { tvMode: stored === "1", persist: null };
  }
  return { tvMode: isTvUserAgent(userAgent), persist: null };
}

/** Client-side entry: detect once per call site, SSR-safe. */
export function detectTvMode(): boolean {
  if (typeof window === "undefined") return false;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(TV_MODE_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode); fall through to the UA.
  }
  const { tvMode, persist } = resolveTvMode({
    userAgent: navigator.userAgent,
    search: window.location.search,
    stored,
  });
  if (persist !== null) {
    try {
      localStorage.setItem(TV_MODE_STORAGE_KEY, persist);
    } catch {
      // Best effort only; the query override still applies this visit.
    }
  }
  return tvMode;
}
