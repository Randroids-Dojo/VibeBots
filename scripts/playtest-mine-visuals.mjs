// Visual-overhaul evidence run: captures the surface camp, the lit
// shaft, lateral walk facing, ore crystals, and deep-lamp lighting.
// Frame pairs after inputs prove the pixels move (Rule 10).
import { chromium } from "@playwright/test";

const BASE = process.env.PLAYTEST_BASE ?? "http://localhost:3000";
const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: node scripts/playtest-mine-visuals.mjs <captures-dir>");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const log = (msg) => console.log(msg);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

const status = () => page.locator('[aria-label="Mine status"]').innerText();
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

  // Sweep down for depth: lighting should hand off to the lamp.
  let heading = "ArrowLeft";
  for (let i = 0; i < 120; i++) {
    const depth = Number(
      ((await status()).match(/depth\s+(\d+)/) ?? [])[1] ?? 0,
    );
    if (depth >= 9) break;
    const before = await status();
    await page.keyboard.press(heading);
    await page.waitForTimeout(60);
    const after = await status();
    if (/Hard rock|No way|Edge/.test(after) && after !== before) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(60);
      heading = heading === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
    }
  }
  await page.waitForTimeout(900);
  log(`deep: ${(await status()).replace(/\n/g, " | ")}`);
  await page.screenshot({ path: `${OUT}/visuals-04-deep-lamp.png` });

  log(`console errors: ${errors.length}`);
  for (const e of errors.slice(0, 5)) log(`  error: ${e}`);
} finally {
  await browser.close();
}
