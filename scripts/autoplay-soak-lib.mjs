// Extracted helpers for the autoplay mine soak (scripts/autoplay-mine.mjs).
// Pulled out so the pure pieces can be unit-tested and the browser pieces
// can be fixture-tested against isolated HTML, instead of only proven by a
// full soak run. The main script imports and wires these.

// A modal overlay owns the whole screen; this is the app's own selector for
// "a dialog is open". The trip report is a full-screen button, not a dialog,
// so it is drained separately and never trips this check.
export const BLOCKING_OVERLAY_SELECTOR =
  '[role="dialog"], [aria-modal="true"], dialog[open]';

// One-time dialogs that used to intercept policy clicks. Each is drained
// through its real dismiss control, keyed by dialog accessible name so the
// two "Ok" buttons never collide.
export const KNOWN_DIALOGS = [
  { name: "New in VibeBots", dismiss: "Got it" },
  { name: "Falling rock", dismiss: "Ok" },
  { name: "Ladders can fall now", dismiss: "Ok" },
];

// Short, explicit action timeouts so a stuck control fails a single step
// fast instead of hanging on Playwright's 30-second default.
export const CLICK_TIMEOUT = 4_000;
export const HIDDEN_TIMEOUT = 5_000;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Strip ANSI color codes and collapse absolute filesystem paths to their
// basename so an exception summary is stable across machines and logs.
export function boundedError(err) {
  let text = err?.stack ? String(err.stack) : String(err);
  // Built at runtime so no ESC control character sits in the source.
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  text = text.replace(ansi, "");
  text = text.replace(
    /(?:\/[^/\s:)]+)+\/([^/\s:)]+\.(?:mjs|c?js|m?ts))/g,
    "$1",
  );
  return text.slice(0, 600);
}

// One source of truth for pass/fail so the persisted report, the log, and
// the exit code all agree.
export function classifyStatus({ exception, anomalyCount, consoleErrorCount }) {
  const failed =
    exception !== null && exception !== undefined
      ? true
      : anomalyCount > 0 || consoleErrorCount > 0;
  return failed ? "failed" : "passed";
}

// The seeded policy. Pure given (state, run, rng): mutates `run` for a lateral
// streak and returns the next key. Kept deterministic for a fixed rng.
export function pickKey(state, run, rng) {
  // Roof shaking overhead: place a plank (the rescue counterplay).
  if (state.teeter > 0 && rng() < 0.6) return "plank";
  if (state.depth === 0 && state.energy < 55) return "ArrowDown"; // re-descend after bank
  // Battery management: head home when the climb estimate approaches the
  // remaining charge (rough ladder cost of one per row).
  if (state.depth > 0 && state.energy < state.depth + 4) return "ArrowUp";
  if (run.lateral > 0) {
    run.lateral--;
    return run.lateralKey;
  }
  const roll = rng();
  if (roll < 0.12) {
    // Start a lateral run of 2-6 cells (6 can condemn a roof: on purpose).
    run.lateral = 2 + Math.floor(rng() * 5);
    run.lateralKey = rng() < 0.5 ? "ArrowLeft" : "ArrowRight";
    return run.lateralKey;
  }
  if (roll < 0.16 && state.depth > 1) return "ArrowUp";
  return "ArrowDown";
}

// The accessible name of a blocking modal (aria-label, then aria-labelledby
// text, then a short text hint) so a stall points at the exact overlay.
export async function overlayName(handle) {
  return handle
    .evaluate((el) => {
      const label = el.getAttribute("aria-label");
      if (label) return label.slice(0, 80);
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
        if (text) return text.slice(0, 80);
      }
      return (el.textContent ?? "").trim().slice(0, 80) || "unnamed overlay";
    })
    .catch(() => "unnamed overlay");
}

// The first VISIBLE blocking modal, if any. Checks every match, not just the
// first: a hidden first match must not mask a later visible dialog.
export async function blockingOverlay(page) {
  const modals = page.locator(BLOCKING_OVERLAY_SELECTOR);
  const count = await modals.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const modal = modals.nth(i);
    if (await modal.isVisible().catch(() => false)) {
      return overlayName(modal);
    }
  }
  return null;
}

// Dismiss any known one-time dialog through its real control in a bounded
// loop and confirm it is gone. Returns { drained, byName }. A dialog that
// will not close is left for the blocking-overlay net to name.
export async function drainKnownDialogs(page) {
  let drained = 0;
  const byName = Object.fromEntries(KNOWN_DIALOGS.map((d) => [d.name, 0]));
  for (let round = 0; round < 6; round++) {
    let dismissedThisRound = false;
    for (const d of KNOWN_DIALOGS) {
      const dialog = page.getByRole("dialog", { name: d.name });
      if (!(await dialog.isVisible().catch(() => false))) continue;
      try {
        await dialog
          .getByRole("button", { name: d.dismiss })
          .click({ timeout: CLICK_TIMEOUT });
        await dialog.waitFor({ state: "hidden", timeout: HIDDEN_TIMEOUT });
        drained++;
        byName[d.name]++;
        dismissedThisRound = true;
      } catch {
        // Could not dismiss it; stop and let blockingOverlay() name it.
      }
    }
    if (!dismissedThisRound) break;
  }
  return { drained, byName };
}

// Drain pending trip reports without consuming a policy action or an abandon.
// Returns { drained, stuck, persists, stuckError }: `stuck` is true only when
// a dismiss attempt itself throws (an undismissable report); `persists` is
// true when a report is still visible after the bound (undismissable, or
// recurring faster than it can drain). Either means callers must not act a
// policy key behind the full-screen report. A report that dismisses fine and
// does not reappear returns both false.
export async function drainTripReports(page) {
  const tripReport = page.getByRole("button", { name: "Dismiss trip report" });
  let drained = 0;
  let stuck = false;
  let stuckError = null;
  for (let i = 0; i < 8; i++) {
    if (!(await tripReport.isVisible().catch(() => false))) break;
    try {
      await tripReport.click({ timeout: CLICK_TIMEOUT });
      await tripReport.waitFor({ state: "hidden", timeout: HIDDEN_TIMEOUT });
      drained++;
    } catch (err) {
      stuck = true;
      stuckError = err;
      break;
    }
  }
  const persists = await tripReport.isVisible().catch(() => false);
  return { drained, stuck, persists, stuckError };
}
