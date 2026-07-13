import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  DEFAULT_GEAR,
  dismissReleaseNotes,
  openStall,
  routeStarterMineWorld,
  STARTING_CONSUMABLES,
  walkToStallPrompt,
} from "./support/mine-helpers";

// Shared scaffolding: stub the gear and depot-buy routes so buying one
// ladder deterministically awards the Depot Regular stamp, then walk to
// the Supply Depot and open it. Tests click Buy themselves (the first
// one arms an observer before the click).
async function openStubbedDepot(page: Page, seed: number): Promise<Locator> {
  await routeStarterMineWorld(page, seed);
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: {
        gear: DEFAULT_GEAR,
        consumables: STARTING_CONSUMABLES,
        balance: 50,
      },
    });
  });
  await page.route("**/api/consumables/buy", async (route) => {
    await route.fulfill({
      json: {
        item: "ladder",
        quantity: 1,
        count: 3,
        balance: 48,
        newStamps: ["tool-depot-regular"],
      },
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await walkToStallPrompt(page, "ArrowRight", "Supply Depot");
  return openStall(page, "Supply Depot");
}

// A freshly collected stamp pops an animated alert that names the stamp
// and clears itself (REQ-032). The buy response is stubbed so the alert
// is deterministic without a stamp ledger behind the local server.
test("collecting a stamp pops a self-clearing alert with its art", async ({
  page,
}) => {
  const depot = await openStubbedDepot(page, 2026071001);

  // Arm an in-page peak-opacity recorder before the buy: on a loaded
  // host the 3s pop-hold-fade can burn through its full-opacity plateau
  // while protocol round-trips are still in flight, so observation must
  // start before the alert exists and record its maximum.
  await page.evaluate(() => {
    const w = window as typeof window & { __stampAlertPeakOpacity?: number };
    w.__stampAlertPeakOpacity = 0;
    const sample = () => {
      const el = document.querySelector("[data-stamp-alert]");
      if (el) {
        const opacity = Number(getComputedStyle(el).opacity);
        if (opacity > (w.__stampAlertPeakOpacity ?? 0)) {
          w.__stampAlertPeakOpacity = opacity;
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await depot
    .getByRole("button", { name: /Buy 1 for/, disabled: false })
    .first()
    .click();

  const alert = page.locator('[data-stamp-alert="tool-depot-regular"]');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Stamp collected");
  await expect(alert).toContainText("Depot Regular");
  expect(await alert.locator("svg").count()).toBeGreaterThan(0);

  // The pop animation drives opacity up from 0 (Rule 10: observe real
  // movement), then the alert removes itself without any player input.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as typeof window & { __stampAlertPeakOpacity?: number })
              .__stampAlertPeakOpacity ?? 0,
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0.9);
  await expect(alert).not.toBeAttached({ timeout: 10_000 });
});

// Tapping the alert opens the Stamp Book scrolled to that stamp, and the
// card itself sits about a quarter of the way down the screen.
test("tapping a stamp alert opens the Stamp Book on that stamp", async ({
  page,
}) => {
  const depot = await openStubbedDepot(page, 2026071002);
  await depot
    .getByRole("button", { name: /Buy 1 for/, disabled: false })
    .first()
    .click();

  const alert = page.locator('[data-stamp-alert="tool-depot-regular"]');
  await expect(alert).toBeVisible();

  // Position: the card's top lands about 25% down the viewport.
  const viewport = page.viewportSize();
  const box = await alert.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs((box?.y ?? 0) - (viewport?.height ?? 0) * 0.25)).toBeLessThan(
    (viewport?.height ?? 0) * 0.05,
  );

  await alert
    .getByRole("button", { name: "Open Depot Regular in the Stamp Book" })
    .click();
  // Opening the book consumes the alert.
  await expect(alert).not.toBeAttached();

  const book = page.getByRole("dialog", { name: "Stamp Book" });
  await expect(book).toBeVisible();
  const focused = book.locator('[data-achievement-focused="true"]');
  await expect(focused).toHaveAttribute(
    "data-achievement-id",
    "tool-depot-regular",
  );
  await expect(focused).toBeInViewport();
});
