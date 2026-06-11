// Full-loop production playtest: earn credits, buy supplies, blast,
// recall, and die properly (collapse reveal). Run after the hazards and
// juice slices deploy. Also proves moving pixels per AGENTS Rule 10.
import { chromium } from "@playwright/test";

const BASE = process.env.PLAYTEST_BASE ?? "https://vibe-bots.vercel.app";
const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: node scripts/playtest-mine-full.mjs <captures-dir>");
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
});
const page = await context.newPage();
const log = (msg) => console.log(msg);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

const status = () => page.locator('[aria-label="Mine status"]').innerText();
const depth = async () =>
  Number((await status()).match(/depth\s+(\d+)/)?.[1] ?? "0");
const OPP = {
  ArrowDown: "ArrowUp",
  ArrowUp: "ArrowDown",
  ArrowLeft: "ArrowRight",
  ArrowRight: "ArrowLeft",
};

async function tripAndBank(targetDepth) {
  const path = [];
  let stuck = 0;
  while ((await depth()) < targetDepth && stuck < 30) {
    let moved = false;
    for (const key of ["ArrowDown", "ArrowLeft", "ArrowRight"]) {
      const before = await status();
      await page.keyboard.press(key);
      await page.waitForTimeout(90);
      const after = await status();
      if (
        after !== before &&
        !/Hard rock|No way|Edge|hold is full/.test(after)
      ) {
        path.push(key);
        moved = true;
        break;
      }
      stuck++;
    }
    if (!moved) break;
    stuck = 0;
  }
  for (const key of path.reverse()) {
    await page.keyboard.press(OPP[key]);
    await page.waitForTimeout(90);
  }
  const cashBtn = page.getByRole("button", { name: /cash out/i });
  if (await cashBtn.isVisible().catch(() => false)) {
    await cashBtn.click();
    await page.waitForTimeout(2500);
  }
  log(`trip done: ${(await status()).replace(/\n/g, " | ")}`);
}

try {
  await page.goto(`${BASE}/mine`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  log(`start: ${(await status()).replace(/\n/g, " | ")}`);

  // Rule 10: prove the pixels move after an input (tweened miner).
  await page.keyboard.press("ArrowDown");
  const shotA = await page.screenshot();
  await page.waitForTimeout(150);
  const shotB = await page.screenshot();
  log(`pixels move after input: ${!shotA.equals(shotB)}`);

  // Earn credits over a few trips.
  for (let trip = 0; trip < 3; trip++) await tripAndBank(13);

  // Shop: buy dynamite and a rope.
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const shopText = () => page.getByLabel("Part shop").innerText();
  log(`shop: ${(await shopText()).split("\n").slice(0, 2).join(" | ")}`);
  for (const name of ["Dynamite", "Recall Rope"]) {
    const row = page.locator("li", { hasText: name }).first();
    const buy = row.getByRole("button");
    if (await buy.isEnabled().catch(() => false)) {
      await buy.click();
      await page.waitForTimeout(1200);
      log(`bought ${name}`);
    } else {
      log(`could not afford ${name}`);
    }
  }
  await page.screenshot({ path: `${OUT}/full-01-shop-supplies.png` });

  // Back to the mine: counts visible, dynamite arm + blast down.
  await page.goto(`${BASE}/mine`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  log(`gear HUD: ${(await status()).replace(/\n/g, " | ")}`);
  const dynBtn = page.getByRole("button", { name: /dynamite/i });
  if (await dynBtn.isEnabled().catch(() => false)) {
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(150);
    await dynBtn.click();
    await page.waitForTimeout(120);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/full-02-dynamite.png` });
    log(`after blast: ${(await status()).replace(/\n/g, " | ")}`);
  } else {
    log("no dynamite to test");
  }

  // Dig a bit, then recall home with the carry.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(90);
  }
  const recallBtn = page.getByRole("button", { name: /recall/i });
  if (await recallBtn.isEnabled().catch(() => false)) {
    await recallBtn.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/full-03-recalled.png` });
    log(`after recall: ${(await status()).replace(/\n/g, " | ")}`);
  } else {
    log("no rope to test");
  }

  // Push the luck until the lamp dies: the wreck reveal should appear.
  let safety = 220;
  while (safety-- > 0) {
    const text = await status();
    if (/collapses:/.test(text)) break;
    for (const key of ["ArrowDown", "ArrowLeft", "ArrowRight"]) {
      const before = await status();
      await page.keyboard.press(key);
      await page.waitForTimeout(60);
      if ((await status()) !== before) break;
    }
    const reveal = page.getByText(/The lamp died|Crushed by a boulder/);
    if (await reveal.isVisible().catch(() => false)) {
      await page.screenshot({ path: `${OUT}/full-04-wreck-reveal.png` });
      log("wreck reveal visible");
      const nearMiss = await page
        .getByText(/So close:/)
        .innerText()
        .catch(() => "(no near-miss line)");
      log(`near miss: ${nearMiss}`);
      await page.mouse.click(640, 400); // dismiss
      await page.waitForTimeout(300);
      break;
    }
  }
  log(`end: ${(await status()).replace(/\n/g, " | ")}`);
  log(`console errors: ${errors.length}`);
  for (const e of errors.slice(0, 5)) log(`  error: ${e}`);
} finally {
  await browser.close();
}
