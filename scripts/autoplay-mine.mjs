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
// the visible blocker, anomalies, and a bounded exception summary) plus a
// screenshot before exiting nonzero. An unexpected modal fails fast with a
// named blocking-overlay anomaly rather than silently eating the budget.
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

const report = {
  seed: SEED,
  phase: "startup",
  requested: MAX_ACTIONS,
  actions: 0,
  completed: 0,
  trips: 0,
  collapses: 0,
  planksPlaced: 0,
  abandons: 0,
  maxDepth: 0,
  blocker: null,
  exception: null,
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

function boundedError(err) {
  const text = err?.stack ? String(err.stack) : String(err);
  return text.slice(0, 600);
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
  await page.screenshot({ path: shot }).catch(() => {});
  return shot;
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

async function blockingOverlay() {
  if (!page) return null;
  const modal = page.locator(BLOCKING_OVERLAY_SELECTOR).first();
  if (!(await modal.isVisible().catch(() => false))) return null;
  return overlayName(modal);
}

// Dismiss the release notes through the real Got it control in a bounded
// loop, then prove the dialog is gone. A coordinate click could miss and
// leave the notes covering the mine while the soak reports a regression.
async function drainReleaseNotes() {
  const notes = page.getByRole("dialog", { name: "New in VibeBots" });
  await notes.waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
  for (let i = 0; i < 5; i++) {
    if (!(await notes.isVisible().catch(() => false))) return;
    await page
      .getByRole("button", { name: "Got it" })
      .click()
      .catch(() => {});
    await notes.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  }
  if (await notes.isVisible().catch(() => false)) {
    throw new Error("release notes dialog stayed open after repeated Got it");
  }
}

// Drain any pending trip reports without consuming a policy action or an
// abandon. Returns how many were cleared so callers can react (a report
// covering an underground miner is itself an anomaly).
async function drainTripReports() {
  let drained = 0;
  for (let i = 0; i < 4; i++) {
    if (!(await tripReport.isVisible().catch(() => false))) break;
    await tripReport.click().catch(() => {});
    await tripReport
      .waitFor({ state: "hidden", timeout: 5_000 })
      .catch(() => {});
    drained++;
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
      serverProc.stdout.on("data", (chunk) => {
        if (String(chunk).includes("Ready")) {
          clearTimeout(deadline);
          resolve();
        }
      });
      serverProc.on("exit", () => reject(new Error("server exited early")));
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
  // The soak exercises hazards repeatedly, so suppress the one-time tutorial
  // that would otherwise intercept later policy clicks after its first trigger.
  await page.addInitScript(() => {
    localStorage.setItem("vibebots-falling-rock-alert-dismissed", "true");
    localStorage.setItem("vibebots-ladder-gravity-feedback-never", "true");
  });

  statusEl = page.getByLabel("Mine status");
  canvas = page.locator("canvas");
  tripReport = page.getByRole("button", { name: "Dismiss trip report" });

  await page.goto(`${base}/mine`);
  await drainReleaseNotes();
  await canvas.waitFor({ state: "visible", timeout: 45_000 });
  await statusEl
    .locator(":scope[data-scene-ready='true']")
    .waitFor({ timeout: 45_000 })
    .catch(() => {});
  await page.waitForTimeout(1_500);

  // Before declaring the mine playable, confirm nothing modal covers it.
  const startupBlocker = await blockingOverlay();
  if (startupBlocker) {
    report.blocker = startupBlocker;
    throw new Error(`mine not playable: ${startupBlocker} covers the scene`);
  }

  // ---- play ------------------------------------------------------------
  report.phase = "play";
  let prev = await hud();
  let stuckStreak = 0;
  const run = { lateral: 0, lateralKey: "ArrowRight" };

  for (let i = 0; i < MAX_ACTIONS; i++) {
    if (await drainTripReports()) {
      prev = await hud();
      if (prev.depth > 0) {
        await anomaly(
          "trip-report-underground",
          `trip report covered the miner at depth ${prev.depth}`,
        );
      }
      stuckStreak = 0;
    }
    // Any modal other than a trip report has no business here; name it and
    // stop instead of silently burning the action budget behind it.
    const blocker = await blockingOverlay();
    if (blocker) {
      report.blocker = blocker;
      await anomaly(
        "blocking-overlay",
        `unexpected modal blocked play: ${blocker}`,
      );
      break;
    }
    const key = pickKey(prev, run);
    if (key === "plank") {
      const side = rng() < 0.5 ? "left" : "right";
      const button = page.getByRole("button", { name: `Place plank ${side}` });
      if (await button.isEnabled().catch(() => false)) {
        await button.click();
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
        if ((await drainTripReports()) === 0) {
          // The game's own escape valve: abandon the trip (arm + confirm).
          await page
            .getByRole("button", { name: "Recovery options" })
            .click()
            .catch(() => {});
          const abandonItem = page.getByRole("menuitem", {
            name: "Abandon trip",
          });
          await abandonItem.click().catch(() => {});
          await abandonItem.click().catch(() => {});
          await page.waitForTimeout(600);
          await drainTripReports();
          await page.waitForTimeout(400);
          const after = await hud();
          if (after.depth === 0) {
            // An abandon counts only once the miner is confirmed surfaced.
            report.abandons++;
          } else {
            // Even abandoning failed: that is a real defect, not policy.
            await anomaly(
              "stuck",
              `abandon did not surface the miner from depth ${after.depth}`,
            );
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

  report.phase = "teardown";
} catch (err) {
  report.exception = boundedError(err);
  if (!report.blocker)
    report.blocker = await blockingOverlay().catch(() => null);
  await failureShot(report.phase).catch(() => {});
  process.exitCode = 1;
} finally {
  report.completed = report.actions;
  report.consoleErrors = consoleErrors.slice(0, 20);
  try {
    writeFileSync(
      `${OUT}/autoplay-report.json`,
      JSON.stringify(report, null, 2),
    );
  } catch (writeErr) {
    console.error(`failed to write autoplay-report.json: ${writeErr}`);
  }
  console.log(
    `autoplay ${report.exception ? "FAILED" : "done"} in ${report.phase}: ` +
      `${report.completed}/${report.requested} actions, ${report.trips} trips, ` +
      `${report.collapses} collapses, max depth ${report.maxDepth}, ` +
      `${report.planksPlaced} planks, ${report.anomalies.length} anomalies, ` +
      `${consoleErrors.length} console errors` +
      (report.blocker ? `, blocker: ${report.blocker}` : ""),
  );
  if (report.anomalies.length > 0 || consoleErrors.length > 0) {
    process.exitCode = 1;
  }
  await browser?.close().catch(() => {});
  serverProc?.kill();
}
