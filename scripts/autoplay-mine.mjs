// Autonomous playtest loop (process slice): a seeded policy plays real
// mine sessions through the browser and checks invariants after every
// action, so soak-style regressions (stuck states, silent energy leaks,
// dead canvases, console errors) surface from play instead of from a
// player report. Anomalies produce screenshots plus a JSON report, and
// the exit code is nonzero when any anomaly or console error appears.
//
// A soak that stalls behind an overlay or dies during startup must still
// leave evidence: startup, play, and teardown are wrapped so any failure
// writes autoplay-report.json (seed, phase, requested/completed actions,
// the visible blocker, anomalies, and a bounded sanitized exception
// summary) plus a screenshot when a page exists, before exiting nonzero.
// The formerly-blocking one-time dialogs (release notes, the falling-rock
// alert, the ladder-gravity feedback) are drained through their real
// controls each turn rather than suppressed, and any other visible modal
// fails fast with a named blocking-overlay anomaly instead of silently
// eating the action budget.
//
// Usage:
//   node scripts/autoplay-mine.mjs <out-dir> [actions]
// Env:
//   AUTOPLAY_BASE  target server (default: starts an isolated local
//                  `next start` on AUTOPLAY_PORT or a derived port; the
//                  build must exist: run `pnpm build` first)
//   AUTOPLAY_SEED  policy seed for reproducible sessions (default 1)
//
// The run is hermetic: server APIs are blocked so the whole session is
// the client sim as a guest, and anomalies always attribute to the app.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const OUT = process.argv[2];
const MAX_ACTIONS = Number(process.argv[3] ?? 400);
if (!OUT) {
  console.error("usage: node scripts/autoplay-mine.mjs <out-dir> [actions]");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const SEED = Number(process.env.AUTOPLAY_SEED ?? 1);
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);

// A modal overlay owns the whole screen; the app uses this exact selector
// to know when a dialog is open. The trip report is a full-screen button,
// not a dialog, so it is drained on its own and never trips this check.
const BLOCKING_OVERLAY_SELECTOR =
  '[role="dialog"], [aria-modal="true"], dialog[open]';

// One-time dialogs that used to intercept policy clicks. Each is drained
// through its real dismiss control (by dialog accessible name so the two
// "Ok" buttons never collide), so the soak survives them at full budget.
const KNOWN_DIALOGS = [
  { name: "New in VibeBots", dismiss: "Got it" },
  { name: "Falling rock", dismiss: "Ok" },
  { name: "Ladders can fall now", dismiss: "Ok" },
];

// Short, explicit action timeouts everywhere so a stuck control fails a
// single step fast instead of hanging on Playwright's 30-second default.
const CLICK_TIMEOUT = 4_000;
const HIDDEN_TIMEOUT = 5_000;

const report = {
  seed: SEED,
  phase: "startup",
  status: "failed", // flips to passed only after a clean finish; see finalize()
  requested: MAX_ACTIONS,
  actions: 0,
  completed: 0,
  trips: 0,
  collapses: 0,
  planksPlaced: 0,
  abandons: 0,
  tripReportsDrained: 0,
  oneTimeDialogsDrained: 0,
  // Per-name evidence so a run proves WHICH one-time dialogs actually
  // appeared, not just an aggregate count.
  dialogsByName: Object.fromEntries(KNOWN_DIALOGS.map((d) => [d.name, 0])),
  maxDepth: 0,
  blocker: null,
  exception: null,
  reportWriteFailed: false,
  failureShot: null,
  anomalies: [],
};

const consoleErrors = [];
let serverProc = null;
let browser = null;
let page = null;
let statusEl = null;
let canvas = null;
let tripReport = null;
let shots = 0;

// Strip ANSI color codes and collapse absolute filesystem paths to their
// basename so the exception summary is stable across machines and logs.
function boundedError(err) {
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

// Send SIGTERM and await the process exit (bounded), so a kill that fails
// to stop the server surfaces as a teardown failure rather than a leak.
function stopServer(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    // SIGTERM first; if it does not stop, escalate to SIGKILL and await the
    // forced exit. Only reject if even SIGKILL leaves it running.
    const termTimer = setTimeout(() => proc.kill("SIGKILL"), 5_000);
    const killTimer = setTimeout(
      () => reject(new Error("server did not exit after SIGKILL")),
      8_000,
    );
    proc.once("exit", () => {
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      resolve();
    });
    proc.kill();
  });
}

async function anomaly(kind, detail) {
  const shot = `${OUT}/anomaly-${String(shots++).padStart(2, "0")}-${kind}.png`;
  if (page) await page.screenshot({ path: shot }).catch(() => {});
  report.anomalies.push({ kind, detail, action: report.actions, shot });
  console.log(`ANOMALY ${kind}: ${detail}`);
}

async function failureShot(tag) {
  if (!page) return null;
  const shot = `${OUT}/failure-${tag}.png`;
  const ok = await page
    .screenshot({ path: shot })
    .then(() => true)
    .catch(() => false);
  return ok ? shot : null;
}

// The accessible name of a blocking modal, so a stall points at the exact
// overlay (aria-label, then aria-labelledby text, then a short text hint).
async function overlayName(handle) {
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

// The first VISIBLE blocking modal, if any. Checks every match, not just
// the first: a hidden first match must not mask a later visible dialog.
async function blockingOverlay() {
  if (!page) return null;
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
// loop, and confirm it is gone. Returns how many were cleared. A dialog
// that will not close is left for the blocking-overlay net to name.
async function drainKnownDialogs() {
  let drained = 0;
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
        report.dialogsByName[d.name]++;
        dismissedThisRound = true;
      } catch {
        // Could not dismiss it; stop and let blockingOverlay() name it.
      }
    }
    if (!dismissedThisRound) break;
  }
  report.oneTimeDialogsDrained += drained;
  return drained;
}

// Drain pending trip reports without consuming a policy action or an
// abandon. Only counts a report that is confirmed gone, and never spends
// the default 30-second timeout on a stuck click. Returns { drained,
// stuck }: `stuck` is true only when a dismiss attempt itself FAILED (the
// click or the hidden-wait threw), i.e. a report that will not close, so
// callers can tell "no report" apart from "report would not dismiss"
// (the trip report is a full-screen button, so blockingOverlay() cannot
// see it; an undismissable one must be surfaced here). A report that
// dismisses fine but recurs is not stuck: the next turn drains it again.
async function drainTripReports() {
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
      stuck = true; // a dismiss attempt failed: an undismissable report
      stuckError = err;
      break;
    }
  }
  report.tripReportsDrained += drained;
  // Fail closed: after the bound, a still-visible report (undismissable, or
  // recurring faster than we can drain) must never be acted behind. This is
  // distinct from a report that dismisses fine and does not reappear.
  const persists = await tripReport.isVisible().catch(() => false);
  return { drained, stuck, persists, stuckError };
}

async function hud() {
  const [depth, energy, horiz, frameMs, cells, teeter] = await Promise.all([
    statusEl.getAttribute("data-depth"),
    statusEl.getAttribute("data-energy"),
    statusEl.getAttribute("data-horizontal-distance"),
    canvas.getAttribute("data-frame-ms"),
    canvas.getAttribute("data-rendered-cell-count"),
    canvas.getAttribute("data-teeter-count"),
  ]);
  return {
    depth: Number(depth),
    energy: Number(energy),
    horiz: Number(horiz),
    frameMs: Number(frameMs),
    cells: Number(cells),
    teeter: Number(teeter),
  };
}

function pickKey(state, run) {
  // Roof shaking overhead: place a plank (the rescue counterplay).
  if (state.teeter > 0 && rng() < 0.6) return "plank";
  if (state.depth === 0 && state.energy < 55) return "ArrowDown"; // re-descend after bank
  // Battery management: head home when the climb estimate approaches
  // the remaining charge (rough ladder cost of one per row).
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

try {
  // ---- server ----------------------------------------------------------
  let base = process.env.AUTOPLAY_BASE ?? null;
  if (!base) {
    const port = Number(process.env.AUTOPLAY_PORT ?? 3800 + (SEED % 100));
    serverProc = spawn(
      "node_modules/.bin/next",
      ["start", "-p", String(port)],
      { stdio: "pipe" },
    );
    base = `http://127.0.0.1:${port}`;
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("server never became ready")),
        30_000,
      );
      const fail = (err) => {
        clearTimeout(deadline);
        reject(err);
      };
      serverProc.stdout.on("data", (chunk) => {
        if (String(chunk).includes("Ready")) {
          clearTimeout(deadline);
          resolve();
        }
      });
      // A spawn failure (missing binary, EACCES) emits "error", not "exit".
      serverProc.on("error", (err) =>
        fail(new Error(`server failed to spawn: ${err.message}`)),
      );
      serverProc.on("exit", () => fail(new Error("server exited early")));
    });
  }

  // ---- session ---------------------------------------------------------
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // The hermetic route blocks below answer 503 on purpose; the browser
    // echoes each one as a resource-load error. Real errors still count.
    if (m.text().includes("status of 503")) return;
    consoleErrors.push(m.text().slice(0, 200));
  });
  for (const route of ["**/api/mine/**", "**/api/gear", "**/api/bunker"]) {
    await page.route(route, (r) => r.fulfill({ status: 503, body: "{}" }));
  }

  statusEl = page.getByLabel("Mine status");
  canvas = page.locator("canvas");
  tripReport = page.getByRole("button", { name: "Dismiss trip report" });

  await page.goto(`${base}/mine`);
  // Release notes can appear a beat after navigation; wait briefly, then
  // drain them (and any other known one-time dialog) through their real
  // controls before proving the scene is playable.
  await page
    .getByRole("dialog", { name: "New in VibeBots" })
    .waitFor({ state: "visible", timeout: 8_000 })
    .catch(() => {});
  await drainKnownDialogs();
  await canvas.waitFor({ state: "visible", timeout: 45_000 });
  // The input gate must exist before play: a missing scene-ready is a
  // startup failure with evidence, not a silent begin-anyway.
  await statusEl
    .locator(":scope[data-scene-ready='true']")
    .waitFor({ timeout: 45_000 });
  await page.waitForTimeout(1_500);

  // Drain anything that appeared during warm-up, then confirm the mine is
  // actually playable: nothing modal may remain over it.
  await drainKnownDialogs();
  const startupBlocker = await blockingOverlay();
  if (startupBlocker) {
    report.blocker = startupBlocker;
    await anomaly(
      "blocking-overlay",
      `modal covered the scene before play: ${startupBlocker}`,
    );
    throw new Error(`mine not playable: ${startupBlocker} covers the scene`);
  }

  // ---- play ------------------------------------------------------------
  report.phase = "play";
  let stoppedByBlocker = false;
  let prev = await hud();
  let stuckStreak = 0;
  const run = { lateral: 0, lateralKey: "ArrowRight" };

  for (let i = 0; i < MAX_ACTIONS; i++) {
    // Drain expected overlays before acting: known one-time dialogs, then
    // trip reports. Neither consumes an action or an abandon.
    await drainKnownDialogs();
    const trip = await drainTripReports();
    if (trip.stuck || trip.persists) {
      // A trip report still on screen after the bound is a full-screen
      // blocker the dialog net cannot see; name it and stop rather than
      // act a policy key behind it. Distinguish a failed interaction
      // (undismissable) from a report recurring faster than we can drain.
      report.blocker = trip.stuck
        ? "trip report (undismissable)"
        : "trip report (recurring)";
      await anomaly(
        trip.stuck ? "trip-report-stuck" : "trip-report-persists",
        trip.stuck
          ? `trip report dismissal failed: ${boundedError(trip.stuckError)}`
          : "trip report stayed visible after the drain bound",
      );
      stoppedByBlocker = true;
      break;
    }
    if (trip.drained) {
      prev = await hud();
      if (prev.depth > 0) {
        await anomaly(
          "trip-report-underground",
          `trip report covered the miner at depth ${prev.depth}`,
        );
      }
      stuckStreak = 0;
    }
    // Any modal that survived draining has no business here; name it and
    // stop instead of silently burning the action budget behind it.
    const blocker = await blockingOverlay();
    if (blocker) {
      report.blocker = blocker;
      await anomaly(
        "blocking-overlay",
        `unexpected modal blocked play: ${blocker}`,
      );
      stoppedByBlocker = true;
      break;
    }
    const key = pickKey(prev, run);
    if (key === "plank") {
      const side = rng() < 0.5 ? "left" : "right";
      const button = page.getByRole("button", { name: `Place plank ${side}` });
      if (await button.isEnabled().catch(() => false)) {
        await button.click({ timeout: CLICK_TIMEOUT }).catch(() => {});
        report.planksPlaced++;
      }
    } else {
      await page.keyboard.press(key);
    }
    report.actions++;
    await page.waitForTimeout(200);
    const next = await hud();

    // Invariants -----------------------------------------------------
    if (Number.isNaN(next.energy) || Number.isNaN(next.depth)) {
      await anomaly("hud-unreadable", JSON.stringify(next));
    }
    if (next.cells === 0 && next.depth > 0) {
      await anomaly("dead-canvas", "rendered-cell-count hit 0 underground");
    }
    // Depth 0 with restored energy = a bank or collapse; count trips.
    if (prev.depth > 0 && next.depth === 0) {
      report.trips++;
      if (prev.energy <= 1) report.collapses++;
    } else if (
      next.depth === prev.depth &&
      next.energy === prev.energy &&
      next.horiz === prev.horiz
    ) {
      stuckStreak++;
      if (stuckStreak === 12) {
        // Boxed in (all moves refused). A real player reaches for jump
        // jets and climbs before giving up; try those first.
        await page.keyboard.press(" ");
        for (let up = 0; up < 3; up++) {
          await page.keyboard.press("ArrowUp");
          await page.waitForTimeout(220);
        }
      } else if (stuckStreak >= 20) {
        // A terminal report can appear after this action's HUD sample. Clear
        // that normal end state before reaching for the escape valve.
        if ((await drainTripReports()).drained === 0) {
          if (prev.depth === 0) {
            // Stuck at the surface: there is nothing to abandon, so the
            // escape valve does not apply. No movement for 20 actions at
            // depth 0 is itself a defect, not a rescuable trip.
            await anomaly(
              "stuck-at-surface",
              "no movement for 20 actions while already at depth 0",
            );
          } else {
            // Underground and boxed in: the game's own escape valve
            // (abandon: arm + confirm). Drain expected reports before each
            // click, bound every click, and require the controls to exist
            // so a missing control is surfaced rather than swallowed.
            const recovery = page.getByRole("button", {
              name: "Recovery options",
            });
            const abandonItem = page.getByRole("menuitem", {
              name: "Abandon trip",
            });
            let recovered = true;
            await drainTripReports();
            if (!(await recovery.isVisible().catch(() => false))) {
              recovered = false;
            } else {
              await recovery.click({ timeout: CLICK_TIMEOUT }).catch(() => {
                recovered = false;
              });
              for (let tap = 0; tap < 2 && recovered; tap++) {
                await drainTripReports();
                if (!(await abandonItem.isVisible().catch(() => false))) {
                  recovered = false;
                  break;
                }
                await abandonItem
                  .click({ timeout: CLICK_TIMEOUT })
                  .catch(() => {
                    recovered = false;
                  });
              }
            }
            if (!recovered) {
              await anomaly(
                "recovery-controls-missing",
                `stuck at depth ${prev.depth} but the abandon controls were absent`,
              );
            } else {
              await page.waitForTimeout(600);
              await drainTripReports();
              await page.waitForTimeout(400);
              const after = await hud();
              // An abandon counts only on a confirmed underground-to-surface
              // transition (prev.depth > 0 above, after.depth === 0 here).
              if (after.depth === 0) {
                report.abandons++;
              } else {
                await anomaly(
                  "stuck",
                  `abandon did not surface the miner from depth ${after.depth}`,
                );
              }
            }
          }
        }
        stuckStreak = 0;
      }
    } else {
      stuckStreak = 0;
    }
    report.maxDepth = Math.max(report.maxDepth, next.depth);
    prev = next;
  }

  // Only a clean pass through play advances to teardown. A blocker break,
  // a recorded anomaly, or a console error means the failure was first seen
  // in play, so the phase must stay "play" rather than be mislabeled.
  if (
    !stoppedByBlocker &&
    report.anomalies.length === 0 &&
    consoleErrors.length === 0
  ) {
    report.phase = "teardown";
  }

  // Close in the teardown phase so a close or kill failure is captured in
  // the report rather than swallowed by the finally cleanup. Await the
  // server's exit so a kill that fails to stop it surfaces here.
  if (browser) {
    await browser.close();
    browser = null;
  }
  if (serverProc) {
    await stopServer(serverProc);
    serverProc = null;
  }
} catch (err) {
  report.exception = boundedError(err);
  if (!report.blocker)
    report.blocker = await blockingOverlay().catch(() => null);
  report.failureShot = await failureShot(report.phase).catch(() => null);
} finally {
  report.completed = report.actions;
  report.consoleErrors = consoleErrors.slice(0, 20);
  // One source of truth for pass/fail, stamped BEFORE the write so the
  // persisted report, the log, and the exit code all agree.
  const failed =
    report.exception !== null ||
    report.anomalies.length > 0 ||
    consoleErrors.length > 0;
  report.status = failed ? "failed" : "passed";
  try {
    writeFileSync(
      `${OUT}/autoplay-report.json`,
      JSON.stringify(report, null, 2),
    );
  } catch (writeErr) {
    // A missing report is itself a failure: this run left no evidence.
    report.reportWriteFailed = true;
    console.error(`failed to write autoplay-report.json: ${writeErr}`);
  }
  // Include a report-write failure in the logged outcome so the label and
  // the exit code never disagree.
  const overallFailed = failed || report.reportWriteFailed;
  if (overallFailed) process.exitCode = 1;
  console.log(
    `autoplay ${overallFailed ? "FAILED" : "PASSED"} in ${report.phase}: ` +
      `${report.completed}/${report.requested} actions, ${report.trips} trips, ` +
      `${report.collapses} collapses, max depth ${report.maxDepth}, ` +
      `${report.planksPlaced} planks, ${report.oneTimeDialogsDrained} dialogs ` +
      `(${JSON.stringify(report.dialogsByName)}), ` +
      `${report.tripReportsDrained} trip reports, ` +
      `${report.anomalies.length} anomalies, ${consoleErrors.length} console errors` +
      (report.reportWriteFailed ? ", report write FAILED" : "") +
      (report.blocker ? `, blocker: ${report.blocker}` : ""),
  );
  // Best-effort cleanup if the teardown phase did not reach it.
  await browser?.close().catch(() => {});
  serverProc?.kill();
}
