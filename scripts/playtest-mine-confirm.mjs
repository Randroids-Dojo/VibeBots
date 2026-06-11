// Production confirmation run for the ore-tiers slice: descend past the
// Clay Beds line (row 12), sweep for ore, retrace exactly (reverse
// path), bank, cash out, and capture evidence.
import { chromium } from "@playwright/test";

const BASE = process.env.PLAYTEST_BASE ?? "https://vibe-bots.vercel.app";
const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: node scripts/playtest-mine-confirm.mjs <captures-dir>");
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

try {
  await page.goto(`${BASE}/mine`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const status = () => page.locator('[aria-label="Mine status"]').innerText();
  await page.screenshot({ path: `${OUT}/confirm-ore-01-surface.png` });
  log(`surface: ${(await status()).replace(/\n/g, " | ")}`);

  const OPP = {
    ArrowDown: "ArrowUp",
    ArrowUp: "ArrowDown",
    ArrowLeft: "ArrowRight",
    ArrowRight: "ArrowLeft",
  };
  const path = [];
  const depth = async () =>
    Number((await status()).match(/depth\s+(\d+)/)?.[1] ?? "0");

  // Descend to ~row 14, side-stepping rock. Record only successful moves.
  let stuck = 0;
  while ((await depth()) < 14 && stuck < 25) {
    for (const key of ["ArrowDown", "ArrowLeft", "ArrowRight"]) {
      const before = await status();
      await page.keyboard.press(key);
      await page.waitForTimeout(110);
      const after = await status();
      if (after !== before && !/Hard rock|No way|Edge/.test(after)) {
        // a real move happened (status text changed without a block notice)
        path.push(key);
        stuck = 0;
        break;
      }
      stuck++;
    }
  }
  await page.screenshot({ path: `${OUT}/confirm-ore-02-claybeds.png` });
  log(`deep: ${(await status()).replace(/\n/g, " | ")}`);

  // Retrace exactly.
  for (const key of path.reverse()) {
    await page.keyboard.press(OPP[key]);
    await page.waitForTimeout(110);
  }
  await page.screenshot({ path: `${OUT}/confirm-ore-03-banked.png` });
  log(`back: ${(await status()).replace(/\n/g, " | ")}`);

  const cashBtn = page.getByRole("button", { name: /cash out/i });
  if (await cashBtn.isVisible().catch(() => false)) {
    await cashBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/confirm-ore-04-cashout.png` });
    log(`cashout: ${(await status()).replace(/\n/g, " | ")}`);
  } else {
    log("no cash out button (nothing banked)");
  }
  log(`console errors: ${errors.length}`);
  for (const e of errors.slice(0, 5)) log(`  error: ${e}`);
} finally {
  await browser.close();
}
