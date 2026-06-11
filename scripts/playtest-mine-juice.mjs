// Local juice verification (Rule 10: visible pixels move): digs around,
// proves particle/tween motion via frame diffs, hunts a cache fanfare,
// and pushes until the lamp dies to capture the wreck reveal.
import { chromium } from "@playwright/test";

const BASE = process.env.PLAYTEST_BASE ?? "http://localhost:3000";
const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: node scripts/playtest-mine-juice.mjs <captures-dir>");
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

try {
  await page.goto(`${BASE}/mine`, { waitUntil: "networkidle" });
  await page.waitForSelector('[aria-label="Mine status"]', { timeout: 30000 });
  await page.waitForTimeout(2500);
  log(`start: ${(await status()).replace(/\n/g, " | ")}`);

  // Rule 10 motion proof: consecutive frames differ after one input.
  await page.keyboard.press("ArrowDown");
  const f1 = await page.screenshot();
  await page.waitForTimeout(120);
  const f2 = await page.screenshot();
  await page.waitForTimeout(120);
  const f3 = await page.screenshot();
  log(
    `frames differ after input: ${!f1.equals(f2)} then ${!f2.equals(f3)} (tween + particles)`,
  );
  await page.screenshot({ path: `${OUT}/juice-01-dig-burst.png` });

  // Wander for loot, floats, and (with luck) a cache fanfare; stop on
  // the wreck overlay when the lamp dies.
  let sawFanfare = false;
  let sawFloat = false;
  // Row sweeps burn energy reliably: left wall to right wall, then one
  // row down, reversing when blocked.
  let heading = "ArrowLeft";
  for (let i = 0; i < 1800; i++) {
    const before = await status();
    await page.keyboard.press(heading);
    await page.waitForTimeout(45);
    const after = await status();
    if (/Hard rock|No way|Edge|hold is full/.test(after) && after !== before) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(45);
      heading = heading === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
    }
    if (!sawFloat) {
      const float = page.locator("text=/\\+\\d+ cr/").first();
      if (await float.isVisible().catch(() => false)) {
        sawFloat = true;
        await page.screenshot({ path: `${OUT}/juice-02-pickup-float.png` });
        log(`pickup float visible at step ${i}`);
      }
    }
    if (!sawFanfare) {
      const fanfare = page.locator("text=/Cache cracked/").first();
      if (await fanfare.isVisible().catch(() => false)) {
        sawFanfare = true;
        await page.screenshot({ path: `${OUT}/juice-03-cache-fanfare.png` });
        log(`cache fanfare visible at step ${i}`);
      }
    }
    const reveal = page.getByText(/The lamp died|Crushed by a boulder/);
    if (await reveal.isVisible().catch(() => false)) {
      await page.screenshot({ path: `${OUT}/juice-04-wreck-reveal.png` });
      log(`wreck reveal visible at step ${i}`);
      const nearMiss = await page
        .getByText(/So close:/)
        .innerText()
        .catch(() => "(no near-miss line in range)");
      log(`near miss: ${nearMiss}`);
      await page.mouse.click(640, 400);
      await page.waitForTimeout(300);
      break;
    }
  }
  log(`end: ${(await status()).replace(/\n/g, " | ")}`);
  log(
    `floats: ${sawFloat}, fanfare: ${sawFanfare} (fanfare is luck of the seed)`,
  );
  log(`console errors: ${errors.length}`);
  for (const e of errors.slice(0, 5)) log(`  error: ${e}`);
} finally {
  await browser.close();
}
