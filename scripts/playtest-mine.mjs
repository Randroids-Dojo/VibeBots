// Headless baseline playtest of /mine for the VibeReview session.
// Drives a real trip: dig down, route around rock, grab loot, return,
// bank, cash out. Saves screenshots into the session captures dir.
import { chromium } from "@playwright/test";

const BASE = process.env.PLAYTEST_BASE ?? "https://vibebots.randroid.dev";
const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: node scripts/playtest-mine.mjs <captures-dir>");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const t0 = Date.now();
const log = (msg) =>
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${BASE}/mine`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500); // canvas boot
await page.screenshot({ path: `${OUT}/mine-01-first-load.png` });
log("loaded /mine");

const status = () => page.locator('[aria-label="Mine status"]').innerText();
log(`status: ${(await status()).replace(/\n/g, " | ")}`);

// Trip 1: straight down 10, then zigzag for loot, then climb back.
const press = async (key, n, delayMs = 120) => {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(delayMs);
  }
};

await press("ArrowDown", 6);
await page.screenshot({ path: `${OUT}/mine-02-depth6.png` });
log(`after 6 down: ${(await status()).replace(/\n/g, " | ")}`);

// sweep sideways at depth for emeralds
await press("ArrowLeft", 3);
await press("ArrowDown", 3);
await press("ArrowRight", 5);
await press("ArrowDown", 3);
await press("ArrowLeft", 4);
await page.screenshot({ path: `${OUT}/mine-03-sweep.png` });
log(`after sweep: ${(await status()).replace(/\n/g, " | ")}`);

// climb home along the dug shaft: retrace exactly
await press("ArrowRight", 4);
await press("ArrowUp", 3);
await press("ArrowLeft", 5);
await press("ArrowUp", 3);
await press("ArrowRight", 3);
await press("ArrowUp", 6);
await page.screenshot({ path: `${OUT}/mine-04-back-on-surface.png` });
log(`back up: ${(await status()).replace(/\n/g, " | ")}`);

// Trip 2: push-your-luck. Dig down until collapse to see the fail state.
await press("ArrowDown", 40, 60);
await page.screenshot({ path: `${OUT}/mine-05-deep-or-collapsed.png` });
log(`deep trip: ${(await status()).replace(/\n/g, " | ")}`);

// Cash out whatever banked.
const cashBtn = page.getByRole("button", { name: /cash out/i });
if (await cashBtn.isVisible().catch(() => false)) {
  await cashBtn.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/mine-06-cashout.png` });
  log(`cashout: ${(await status()).replace(/\n/g, " | ")}`);
} else {
  log("cashout button not visible (nothing banked?)");
}

log(`console errors: ${errors.length}`);
for (const e of errors.slice(0, 5)) log(`  error: ${e}`);
await browser.close();
