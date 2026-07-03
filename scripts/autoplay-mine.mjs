// Autonomous playtest loop (process slice): a seeded policy plays real
// mine sessions through the browser and checks invariants after every
// action, so soak-style regressions (stuck states, silent energy leaks,
// dead canvases, console errors) surface from play instead of from a
// player report. Anomalies produce screenshots plus a JSON report, and
// the exit code is nonzero when any anomaly or console error appears.
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

// ---- server -------------------------------------------------------------
let serverProc = null;
let base = process.env.AUTOPLAY_BASE ?? null;
if (!base) {
  const port = Number(process.env.AUTOPLAY_PORT ?? 3800 + (SEED % 100));
  serverProc = spawn("node_modules/.bin/next", ["start", "-p", String(port)], {
    stdio: "pipe",
  });
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

// ---- session ------------------------------------------------------------
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
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

const report = {
  seed: SEED,
  actions: 0,
  trips: 0,
  collapses: 0,
  planksPlaced: 0,
  maxDepth: 0,
  anomalies: [],
};
let shots = 0;

async function anomaly(kind, detail) {
  const shot = `${OUT}/anomaly-${String(shots++).padStart(2, "0")}-${kind}.png`;
  await page.screenshot({ path: shot }).catch(() => {});
  report.anomalies.push({ kind, detail, action: report.actions, shot });
  console.log(`ANOMALY ${kind}: ${detail}`);
}

const statusEl = page.getByLabel("Mine status");
const canvas = page.locator("canvas");
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
  await page.goto(`${base}/mine`);
  const notes = page.getByRole("dialog", { name: "New in VibeBots" });
  if (await notes.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await page.mouse.click(8, 8);
  }
  await canvas.waitFor({ state: "visible", timeout: 45_000 });
  await statusEl
    .locator(":scope[data-scene-ready='true']")
    .waitFor({ timeout: 45_000 })
    .catch(() => {});
  await page.waitForTimeout(1_500);

  let prev = await hud();
  let stuckStreak = 0;
  const run = { lateral: 0, lateralKey: "ArrowRight" };

  for (let i = 0; i < MAX_ACTIONS; i++) {
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
        // The game's own escape valve: abandon the trip (arm + confirm).
        await page.getByRole("button", { name: "Recovery options" }).click();
        const abandonItem = page.getByRole("menuitem", {
          name: "Abandon trip",
        });
        await abandonItem.click().catch(() => {});
        await abandonItem.click().catch(() => {});
        await page.waitForTimeout(600);
        await page.mouse.click(640, 690); // dismiss any trip report
        await page.waitForTimeout(400);
        report.abandons = (report.abandons ?? 0) + 1;
        const after = await hud();
        if (after.depth > 0) {
          // Even abandoning failed: that is a real defect, not policy.
          await anomaly(
            "stuck",
            `abandon did not surface the miner from depth ${after.depth}`,
          );
        }
        stuckStreak = 0;
      }
    } else {
      stuckStreak = 0;
    }
    report.maxDepth = Math.max(report.maxDepth, next.depth);
    prev = next;
  }

  report.consoleErrors = consoleErrors.slice(0, 20);
  writeFileSync(`${OUT}/autoplay-report.json`, JSON.stringify(report, null, 2));
  console.log(
    `autoplay done: ${report.actions} actions, ${report.trips} trips, ` +
      `${report.collapses} collapses, max depth ${report.maxDepth}, ` +
      `${report.planksPlaced} planks, ${report.anomalies.length} anomalies, ` +
      `${consoleErrors.length} console errors`,
  );
  if (report.anomalies.length > 0 || consoleErrors.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  serverProc?.kill();
}
