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
// fails fast with a named blocking-overlay anomaly.
//
// The reusable helpers live in ./autoplay-soak-lib.mjs so the pure pieces
// are unit-tested and the browser pieces are fixture-tested in isolation.
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
import {
  blockingOverlay,
  boundedError,
  CLICK_TIMEOUT,
  classifyStatus,
  drainKnownDialogs,
  drainTripReports,
  KNOWN_DIALOGS,
  mulberry32,
  pickKey,
} from "./autoplay-soak-lib.mjs";

const OUT = process.argv[2];
const MAX_ACTIONS = Number(process.argv[3] ?? 400);
if (!OUT) {
  console.error("usage: node scripts/autoplay-mine.mjs <out-dir> [actions]");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const SEED = Number(process.env.AUTOPLAY_SEED ?? 1);
const rng = mulberry32(SEED);

const report = {
  seed: SEED,
  phase: "startup",
  status: "failed", // flips to passed only after a clean finish
  requested: MAX_ACTIONS,
  actions: 0,
  completed: 0,
  trips: 0,
  collapses: 0,
  planksPlaced: 0,
  abandons: 0,
  tripReportsDrained: 0,
  oneTimeDialogsDrained: 0,
  // Per-name evidence so a run proves WHICH one-time dialogs appeared.
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
let shots = 0;

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

// Drain known one-time dialogs and fold the per-name counts into the report.
async function drainDialogs() {
  const { drained, byName } = await drainKnownDialogs(page);
  report.oneTimeDialogsDrained += drained;
  for (const name of Object.keys(byName)) {
    report.dialogsByName[name] += byName[name];
  }
  return drained;
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

  await page.goto(`${base}/mine`);
  // Release notes can appear a beat after navigation; wait briefly, then
  // drain them (and any other known one-time dialog) through their real
  // controls before proving the scene is playable.
  await page
    .getByRole("dialog", { name: "New in VibeBots" })
    .waitFor({ state: "visible", timeout: 8_000 })
    .catch(() => {});
  await drainDialogs();
  await canvas.waitFor({ state: "visible", timeout: 45_000 });
  // The input gate must exist before play: a missing scene-ready is a
  // startup failure with evidence, not a silent begin-anyway.
  await statusEl
    .locator(":scope[data-scene-ready='true']")
    .waitFor({ timeout: 45_000 });
  await page.waitForTimeout(1_500);

  // Drain anything that appeared during warm-up, then confirm the mine is
  // actually playable: nothing modal may remain over it.
  await drainDialogs();
  const startupBlocker = await blockingOverlay(page);
  if (startupBlocker) {
    report.blocker = startupBlocker;
    await anomaly(
      "blocking-overlay",
      `modal covered the scene before play: ${startupBlocker}`,
    );
    throw new Error(`mine not playable: ${startupBlocker} covers the scene`);
  }

  // ---- play ------------------------------------------------------------
  // Fail closed only after a trip report blocks play for this many turns in a
  // row, so ordinary "one more trip" recurrence is tolerated while a genuine
  // undismissable or infinite-report loop still surfaces.
  const REPORT_BLOCK_LIMIT = 20;
  report.phase = "play";
  let stoppedByBlocker = false;
  let prev = await hud();
  let stuckStreak = 0;
  let reportBlockStreak = 0;
  const run = { lateral: 0, lateralKey: "ArrowRight" };

  for (let i = 0; i < MAX_ACTIONS; i++) {
    // Drain expected overlays before acting: known one-time dialogs, then
    // trip reports. Neither consumes an action or an abandon.
    await drainDialogs();
    const trip = await drainTripReports(page);
    report.tripReportsDrained += trip.drained;
    if (trip.stuck || trip.persists) {
      // A trip report is still on screen after the bound (undismissable, or a
      // fresh one appeared as the last drained one cleared). Never act a
      // policy key behind the full-screen report: skip this turn and drain
      // again next turn. Only fail closed if it blocks play for many
      // consecutive turns, which separates a genuine stuck or infinite-report
      // loop from ordinary "one more trip" recurrence.
      reportBlockStreak++;
      if (reportBlockStreak >= REPORT_BLOCK_LIMIT) {
        report.blocker = trip.stuck
          ? "trip report (undismissable)"
          : "trip report (recurring)";
        await anomaly(
          trip.stuck ? "trip-report-stuck" : "trip-report-persists",
          trip.stuck
            ? `trip report would not dismiss for ${reportBlockStreak} turns: ${boundedError(trip.stuckError)}`
            : `trip report blocked play for ${reportBlockStreak} turns`,
        );
        stoppedByBlocker = true;
        break;
      }
      await page.waitForTimeout(200);
      continue;
    }
    reportBlockStreak = 0;
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
    const blocker = await blockingOverlay(page);
    if (blocker) {
      report.blocker = blocker;
      await anomaly(
        "blocking-overlay",
        `unexpected modal blocked play: ${blocker}`,
      );
      stoppedByBlocker = true;
      break;
    }
    const key = pickKey(prev, run, rng);
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
        if ((await drainTripReports(page)).drained === 0) {
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
            await drainTripReports(page);
            if (!(await recovery.isVisible().catch(() => false))) {
              recovered = false;
            } else {
              await recovery.click({ timeout: CLICK_TIMEOUT }).catch(() => {
                recovered = false;
              });
              for (let tap = 0; tap < 2 && recovered; tap++) {
                await drainTripReports(page);
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
              await drainTripReports(page);
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
  // the report rather than swallowed by the finally cleanup.
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
    report.blocker = page
      ? await blockingOverlay(page).catch(() => null)
      : null;
  report.failureShot = await failureShot(report.phase).catch(() => null);
} finally {
  report.completed = report.actions;
  report.consoleErrors = consoleErrors.slice(0, 20);
  // One source of truth for pass/fail, stamped BEFORE the write so the
  // persisted report, the log, and the exit code all agree.
  report.status = classifyStatus({
    exception: report.exception,
    anomalyCount: report.anomalies.length,
    consoleErrorCount: consoleErrors.length,
  });
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
  const overallFailed = report.status === "failed" || report.reportWriteFailed;
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
