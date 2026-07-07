// Heap-churn probe: plays the mine against a local server for a fixed
// duration while sampling performance.memory twice a second. Reports
// the allocation rate (sum of positive heap deltas per second), the
// GC sawtooth (drop count and average drop size), and frame stats.
// Usage: node scripts/measure-heap-churn.mjs <baseURL> <label> [seconds]
// Compare a run against a baseline run of main on identical play.
import { chromium } from "@playwright/test";

/** Optional escape hatch for environments whose Playwright browser cache
 * does not match the pinned version (set PW_CHROMIUM_PATH to a Chromium
 * binary); normal dev machines resolve the managed browser. */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

const BASE = process.argv[2] ?? "http://127.0.0.1:3860";
const LABEL = process.argv[3] ?? "run";
const SECONDS = Number(process.argv[4] ?? 75);

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 448, height: 891 } });
await page.goto(`${BASE}/mine`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForSelector("canvas", { timeout: 60000 });
try {
  await page.getByRole("button", { name: "Got it" }).click({ timeout: 8000 });
} catch {}
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

// Paced dig/walk loop, similar cadence to real play.
const startedAt = Date.now();
const keys = ["ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight"];
let press = 0;
while (Date.now() - startedAt < SECONDS * 1000) {
  await page.keyboard.press(keys[press % keys.length]);
  press += 1;
  await page.waitForTimeout(400);
}
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
console.log(
  JSON.stringify(
    {
      label: LABEL,
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
