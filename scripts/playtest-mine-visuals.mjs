// Visual-overhaul evidence run: captures the surface camp, the lit
// shaft, lateral walk facing, ore crystals, and deep-lamp lighting.
// Frame pairs after inputs prove the pixels move (Rule 10).
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.env.PLAYTEST_BASE ?? "http://localhost:3000";
const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: node scripts/playtest-mine-visuals.mjs <captures-dir>");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

/** Deep enough that the lamp has fully taken over from daylight. */
const TARGET_DEPTH = 8;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const log = (msg) => console.log(msg);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

const status = () => page.locator('[aria-label="Mine status"]').innerText();
const hudNumber = async (attr) =>
  Number(await page.locator('[aria-label="Mine status"]').getAttribute(attr));
const minerY = async () =>
  Number(await page.locator("canvas").getAttribute("data-miner-y"));

try {
  await page.goto(`${BASE}/mine`, { waitUntil: "networkidle" });
  await page.waitForSelector('[aria-label="Mine status"]', { timeout: 30000 });
  await page.waitForTimeout(2500);
  log(`start: ${(await status()).replace(/\n/g, " | ")}`);
  await page.screenshot({ path: `${OUT}/visuals-01-surface.png` });

  // Dig a short shaft; the camera and lighting should follow down.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(350);
  }
  const f1 = await page.screenshot();
  await page.waitForTimeout(140);
  const f2 = await page.screenshot();
  log(`frames differ after dig: ${!f1.equals(f2)}`);
  await page.screenshot({ path: `${OUT}/visuals-02-shaft.png` });

  // Lateral walk: facing flips, glide stays at depth (F-020 regression).
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(160);
  await page.screenshot({ path: `${OUT}/visuals-03-walk-left.png` });
  await page.waitForTimeout(400);
  log(`miner y after left walk: ${await minerY()} (expect near -3)`);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(550);

  // Sweep down for depth: lighting should hand off to the lamp. Stop
  // while the lamp still burns; a collapse would snap the capture back
  // to the surface and silently fake the "deep" evidence.
  let heading = "ArrowLeft";
  for (let i = 0; i < 120; i++) {
    const depth = await hudNumber("data-depth");
    const energy = await hudNumber("data-energy");
    if (depth >= TARGET_DEPTH || energy < 14) break;
    await page.keyboard.press(heading);
    await page.waitForTimeout(60);
    const after = await status();
    // Successful moves clear the status line, so a lingering blocked
    // message always means this press was refused: step down and flip
    // (comparing against the pre-press text stalled on back-to-back
    // identical blocked states).
    if (/Too hard|No way|Edge|No planks/.test(after)) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(60);
      heading = heading === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
    }
  }
  await page.waitForTimeout(900);
  const deepHud = await status();
  const deepDepth = await hudNumber("data-depth");
  if (deepDepth < TARGET_DEPTH) {
    log(
      `FAIL: deep capture taken at depth ${deepDepth} (target ${TARGET_DEPTH}); visuals-04 is not valid deep evidence`,
    );
    // Confirmation runs must not promote shallow captures silently.
    process.exitCode = 1;
  }
  log(`deep: ${deepHud.replace(/\n/g, " | ")}`);
  await page.screenshot({ path: `${OUT}/visuals-04-deep-lamp.png` });

  log(`console errors: ${errors.length}`);
  for (const e of errors.slice(0, 5)) log(`  error: ${e}`);
} finally {
  await browser.close();
}
