// Visual check of the bot-first bottom sheet (Slice N) at Android portrait.
// Confirms: Build lands collapsed (bot clear), the handle expands/collapses,
// menu tabs open the sheet, and collapsing a menu tab reveals the bot.
// Saves screenshots into <out-dir> and exits nonzero on any console error.
//
// Usage: node scripts/playtest-sheet.mjs <out-dir>
//   PLAYTEST_BASE overrides the target (default http://localhost:3000).
import { chromium } from "@playwright/test";

const BASE = process.env.PLAYTEST_BASE ?? "http://localhost:3000";
const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: node scripts/playtest-sheet.mjs <out-dir>");
  process.exit(2);
}

const errors = [];
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 390, height: 760 } });
pg.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await pg.route("**/api/shop", async (route) => {
  await route.fulfill({
    json: {
      emeralds: 200,
      inventory: [
        { part_id: "drive-wheel", count: 6 },
        { part_id: "spinner-bar", count: 2 },
        { part_id: "hardened-plate", count: 2 },
      ],
      catalog: [],
    },
  });
});

await pg.goto(`${BASE}/workshop`, { waitUntil: "networkidle" });
await pg.waitForTimeout(1200);

const sheet = pg.locator(".workshop-sheet");
const handle = pg.locator(".workshop-sheet-handle");
const collapsed = () =>
  sheet.evaluate((el) => el.classList.contains("workshop-sheet-collapsed"));

// 1. Build lands collapsed: bot is the hero, only the peek shows.
await pg.screenshot({ path: `${OUT}/sheet-01-build-collapsed.png` });
const buildCollapsed = await collapsed();

// 2. Tap the handle to reveal the Chassis controls.
await handle.click();
await pg.waitForTimeout(400);
await pg.screenshot({ path: `${OUT}/sheet-02-build-open.png` });
const buildOpen = !(await collapsed());

// 3. Garage opens as a sheet over the bot.
await pg.getByRole("tab", { name: "Garage" }).click();
await pg.waitForTimeout(400);
await pg.screenshot({ path: `${OUT}/sheet-03-garage-open.png` });
const garageOpen = !(await collapsed());

// 4. Collapse the Garage sheet: the bot fills the screen.
await handle.click();
await pg.waitForTimeout(400);
await pg.screenshot({ path: `${OUT}/sheet-04-garage-collapsed.png` });
const garageCollapsed = await collapsed();

const summary = {
  buildCollapsed,
  buildOpen,
  garageOpen,
  garageCollapsed,
  consoleErrors: errors,
};
console.log(JSON.stringify(summary, null, 2));
await b.close();

const ok =
  buildCollapsed &&
  buildOpen &&
  garageOpen &&
  garageCollapsed &&
  errors.length === 0;
process.exit(ok ? 0 : 1);
