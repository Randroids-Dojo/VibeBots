// Headless confirmation playtest of the workshop overhaul (slices I-M) at
// Android portrait. Drives the real UI: reads the chassis selector, loads a
// blueprint, steps the carousel to the new Spinner Bar, and opens the shop.
// Saves screenshots into the given captures dir and prints a JSON summary,
// exiting nonzero on any console error or missing feature.
//
// Usage: node scripts/playtest-workshop.mjs <out-dir>
//   PLAYTEST_BASE overrides the target (default http://localhost:3000).
import { chromium } from "@playwright/test";

const BASE = process.env.PLAYTEST_BASE ?? "http://localhost:3000";
const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: node scripts/playtest-workshop.mjs <out-dir>");
  process.exit(2);
}

const errors = [];
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 390, height: 760 } });
pg.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
// Stock a few parts so heroes are grabbable and the shop shows the catalog.
await pg.route("**/api/shop", async (route) => {
  await route.fulfill({
    json: {
      emeralds: 200,
      inventory: [
        { part_id: "drive-wheel", count: 6 },
        { part_id: "spinner-bar", count: 2 },
        { part_id: "hardened-plate", count: 2 },
      ],
      catalog: [
        {
          id: "drive-wheel",
          name: "Drive Wheel",
          category: "mobility",
          priceEmeralds: 5,
        },
        {
          id: "hardened-plate",
          name: "Hardened Plate",
          category: "structure",
          priceEmeralds: 18,
        },
        {
          id: "spinner-bar",
          name: "Spinner Bar",
          category: "weapon",
          priceEmeralds: 20,
        },
      ],
    },
  });
});

await pg.goto(`${BASE}/workshop`, { waitUntil: "networkidle" });
await pg.waitForTimeout(1200);
await pg.screenshot({ path: `${OUT}/wf-01-chassis.png` });

// Load a blueprint from the Garage, then return to Build.
await pg.getByRole("tab", { name: "Garage" }).click();
await pg.waitForTimeout(400);
await pg
  .getByRole("region", { name: "Blueprints" })
  .getByRole("button", { name: /Tower Basher/ })
  .click();
await pg.waitForTimeout(600);
await pg.getByRole("tab", { name: "Build" }).click();
await pg.waitForTimeout(1200);
const loadedTitle = (
  await pg.locator(".workshop-header-title").textContent()
)?.trim();
await pg.screenshot({ path: `${OUT}/wf-02-blueprint.png` });

// Carousel: step to the new Spinner Bar to confirm it is in hand.
async function carouselTo(name) {
  const carousel = pg.getByLabel("Part carousel");
  const nameEl = carousel.getByTestId("carousel-part-name");
  for (let i = 0; i < 30; i++) {
    if ((await nameEl.textContent())?.trim() === name) return true;
    await carousel.getByRole("button", { name: "Next part" }).click();
    await pg.waitForTimeout(120);
  }
  return false;
}
const sawBar = await carouselTo("Spinner Bar");
await pg.waitForTimeout(500);
await pg.screenshot({ path: `${OUT}/wf-03-spinner-bar.png` });

// Shop: confirm the two new parts are listed.
await pg.getByRole("tab", { name: "Shop" }).click();
await pg.waitForTimeout(600);
const shopText = (await pg.locator("body").textContent()) ?? "";
await pg.screenshot({ path: `${OUT}/wf-04-shop.png` });

const summary = {
  loadedTitle,
  sawSpinnerBarInCarousel: sawBar,
  shopHasHardenedPlate: shopText.includes("Hardened Plate"),
  shopHasSpinnerBar: shopText.includes("Spinner Bar"),
  consoleErrors: errors,
};
console.log(JSON.stringify(summary, null, 2));
await b.close();

const ok =
  summary.loadedTitle?.includes("Tower Basher") &&
  summary.sawSpinnerBarInCarousel &&
  summary.shopHasHardenedPlate &&
  summary.shopHasSpinnerBar &&
  errors.length === 0;
process.exit(ok ? 0 : 1);
