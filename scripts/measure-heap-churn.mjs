// Heap-churn probe: drives a fixed play loop against a local server for
// a fixed duration while sampling performance.memory twice a second.
// Reports the allocation rate (sum of positive heap deltas per second),
// the GC sawtooth (drop count and average drop size), and heap bounds.
// Usage: node scripts/measure-heap-churn.mjs <baseURL> <label> [seconds]
// A label starting with "fp" (e.g. fp-bunker, fp-main) measures the
// first-person bunker loop: a banked-claim fixture, dig to depth 1,
// enter through the toolbelt's Enter button, then walk/look/dig for the
// window. Any other label drives the classic 2D mine dig loop. Compare
// a run against a baseline run of main under the same scenario.
import { chromium } from "@playwright/test";

/** Optional escape hatch for environments whose Playwright browser cache
 * does not match the pinned version (set PW_CHROMIUM_PATH to a Chromium
 * binary); normal dev machines resolve the managed browser. */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

const BASE = process.argv[2] ?? "http://127.0.0.1:3860";
const LABEL = process.argv[3] ?? "run";
const SECONDS = Number(process.argv[4] ?? 75);
const FP_SCENARIO = LABEL.startsWith("fp");

/** Miner start column in the sim (src/sim/mine/digging.ts). */
const START_COL = 0;

/** Banked 7x5 claim around the start column: the same fixture shape the
 * fp e2e suite drives, served from a route mock so the scenario never
 * depends on server storage state. */
const FP_BUNKER_VIEW = {
  bunker: {
    footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
    core: { col: START_COL, row: 3, durability: 160 },
    parts: [
      { partId: "wall-panel", col: START_COL - 3, row: 1, durability: 90 },
    ],
    dug: [],
  },
  inventory: {
    "wall-panel": 6,
    "floor-panel": 4,
    "roof-panel": 4,
    "door-panel": 1,
    "basic-turret": 0,
    "floor-spikes": 0,
  },
  activeRaid: null,
  player: {
    balance: 120,
    trackXp: 40,
    defenseXp: 120,
    overallLevel: 2,
    levelCap: 100,
    progressXp: 20,
    neededXp: 80,
    nextLevelXp: 200,
    beaconLimit: 3,
  },
};

// Without --enable-precise-memory-info, performance.memory is quantized
// and rate-limited: headless runs report a frozen heap size and the
// probe silently measures nothing.
const browser = await chromium.launch({
  executablePath,
  args: ["--enable-precise-memory-info"],
});
const page = await browser.newPage({ viewport: { width: 448, height: 891 } });

if (FP_SCENARIO) {
  const dug = [];
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fpViewWithDug(dug)),
    });
  });
  // Stateful excavate mock so the drive loop's digs land: each accepted
  // dig grows the served dug list exactly like the real route would.
  await page.route("**/api/bunker/excavate", async (route) => {
    const body = route.request().postDataJSON();
    if (body) dug.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fpViewWithDug(dug)),
    });
  });
}

await page.goto(`${BASE}/mine`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForSelector("canvas", { timeout: 60000 });
// Dismiss the release-notes dialog in a loop: a single click has raced
// a restack before, leaving every later key press landing in the dialog
// instead of the mine (the silent stall an earlier fp probe died on).
for (let i = 0; i < 6; i += 1) {
  const gotIt = page.getByRole("button", { name: "Got it" });
  if (!(await gotIt.isVisible().catch(() => false))) break;
  await gotIt.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
}

if (FP_SCENARIO) await enterFpBunker(page);
// Let load-time churn settle before measuring steady-state play.
await page.waitForTimeout(4000);

const samples = [];
const sampler = setInterval(async () => {
  try {
    const mb = await page.evaluate(() => {
      const memory = performance.memory;
      return memory ? memory.usedJSHeapSize / (1024 * 1024) : null;
    });
    if (mb !== null) samples.push({ t: Date.now(), mb });
  } catch {}
}, 500);

if (FP_SCENARIO) await driveFpLoop(page, SECONDS);
else await driveMineLoop(page, SECONDS);
clearInterval(sampler);

let grown = 0;
let dropped = 0;
let drops = 0;
let peak = 0;
let trough = Infinity;
for (let i = 1; i < samples.length; i += 1) {
  const delta = samples[i].mb - samples[i - 1].mb;
  if (delta > 0) grown += delta;
  else {
    dropped += -delta;
    if (-delta > 5) drops += 1;
  }
  peak = Math.max(peak, samples[i].mb);
  trough = Math.min(trough, samples[i].mb);
}
const wallSeconds = (samples.at(-1).t - samples[0].t) / 1000;
if (samples.length > 10 && peak === trough) {
  console.error(
    "warning: heap size never changed across the whole run; the memory " +
      "API is likely frozen (is --enable-precise-memory-info in effect?) " +
      "and this measurement is meaningless.",
  );
}
console.log(
  JSON.stringify(
    {
      label: LABEL,
      scenario: FP_SCENARIO ? "fp-bunker" : "mine",
      seconds: Math.round(wallSeconds),
      samples: samples.length,
      allocMbPerSec: Math.round((grown / wallSeconds) * 100) / 100,
      gcDrops: drops,
      reclaimedMb: Math.round(dropped),
      heapTroughMb: Math.round(trough * 10) / 10,
      heapPeakMb: Math.round(peak * 10) / 10,
      endMb: Math.round(samples.at(-1).mb * 10) / 10,
    },
    null,
    2,
  ),
);
await browser.close();

function fpViewWithDug(dug) {
  return {
    ...FP_BUNKER_VIEW,
    bunker: { ...FP_BUNKER_VIEW.bunker, dug: [...dug] },
  };
}

/** Digs the miner one row into the claim and enters the first-person
 * view. Every wait targets the gate the app actually opens (scene-ready
 * before keys work, the Enter affordance before clicking, the rig's eye
 * probe before play), because fixed sleeps stalled the earlier probe. */
async function enterFpBunker(page) {
  // Movement keys are dropped until the world/gear/bunker fetches
  // settle; pressing earlier silently loses the dig.
  await page.waitForSelector(
    '[aria-label="Mine status"][data-scene-ready="true"]',
    { timeout: 60000 },
  );
  // Hold the key and let the app repeat at its own cadence (dirt takes
  // several swings per row; paced single presses under-dig on slow
  // machines and overshoot on carved seeds).
  const status = page.locator('[aria-label="Mine status"]');
  await page.keyboard.down("ArrowDown");
  try {
    const deadline = Date.now() + 45000;
    while (Number(await status.getAttribute("data-depth")) < 1) {
      if (Date.now() > deadline) {
        throw new Error("fp scenario never reached depth 1");
      }
      await page.waitForTimeout(200);
    }
  } finally {
    await page.keyboard.up("ArrowDown");
  }
  const enter = page.getByTestId("bunker-fp-enter");
  await enter.waitFor({ state: "visible", timeout: 30000 });
  await enter.click();
  // The compile gate holds frames until the warm pass settles; the eye
  // probe is the first sign the rig is live. Software GL is slow here.
  await page.waitForFunction(
    () => document.querySelector("canvas")?.dataset.fpEyeX !== undefined,
    undefined,
    { timeout: 90000 },
  );
  // First canvas click acquires (or proves unavailable) pointer lock
  // and is swallowed by design; settle that so later clicks act.
  const canvas = page.locator("canvas");
  await canvas.click();
  const armDeadline = Date.now() + 10000;
  while ((await canvas.getAttribute("data-fp-lock")) === "unlocked") {
    if (Date.now() > armDeadline) break;
    await page.waitForTimeout(100);
  }
  // The pick digs claim rock; walking and looking need no tool.
  await page.keyboard.press("0");
}

/** Steady-state fp play: sweep the look, hold walks, hop, and dig the
 * crosshair cell every few steps (grid rebuild + crumble burst). */
async function driveFpLoop(page, seconds) {
  const startedAt = Date.now();
  const moves = ["w", "a", "s", "d"];
  let step = 0;
  while (Date.now() - startedAt < seconds * 1000) {
    const key = moves[step % moves.length];
    await page.evaluate(
      ([yaw, pitch]) => {
        window.__vibebotsFp = { setYaw: yaw, setPitch: pitch };
      },
      [(step * Math.PI) / 7, Math.sin(step * 0.9) * 0.4 - 0.1],
    );
    await page.keyboard.down(key);
    await page.waitForTimeout(400);
    await page.keyboard.up(key);
    if (step % 5 === 2) await page.keyboard.press("Space");
    if (step % 4 === 3) {
      // Act with the pick at the viewport center: digs when the
      // crosshair sees diggable rock, no-ops otherwise.
      await page.mouse.click(224, 445);
    }
    step += 1;
  }
}

/** Paced 2D dig/walk loop, similar cadence to real play. */
async function driveMineLoop(page, seconds) {
  const startedAt = Date.now();
  const keys = ["ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight"];
  let press = 0;
  while (Date.now() - startedAt < seconds * 1000) {
    await page.keyboard.press(keys[press % keys.length]);
    press += 1;
    await page.waitForTimeout(400);
  }
}
