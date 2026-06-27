import { expect, test } from "@playwright/test";
import { DRIVE_WHEEL } from "../../src/sim/parts";

test("workshop builds and undoes parts", async ({ page }) => {
  await page.goto("/workshop");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to mine" })).toBeVisible();
  await expect(page.getByText("My Bot: 1 part", { exact: true })).toBeVisible();

  const palette = page.getByLabel("Part palette");
  const driveWheelAdd = palette
    .locator("div")
    .filter({ hasText: "Drive Wheel" })
    .getByRole("button", { name: "Add" });
  await expect(driveWheelAdd).toBeEnabled();
  await driveWheelAdd.click();
  await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
  await page.getByRole("button", { name: "Merge selected" }).click();
  await expect(page.getByText("level 2")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("My Bot: 1 part", { exact: true })).toBeVisible();

  // Test arena (REQ-009): fight the current bot against the CPU Brawler.
  await page.getByRole("button", { name: "Test fight vs Brawler" }).click();
  await expect(page.getByText("My Bot", { exact: true })).toBeVisible();
  await expect(page.getByText("Brawler", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to build" }).click();
  await expect(page.getByLabel("Part palette")).toBeVisible();
});

test("workshop panels stack on portrait phones", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workshop");
  const controls = page.getByLabel("Workshop build controls");
  const shop = page.getByLabel("Parts shop");
  await expect(controls).toBeVisible();
  await expect(shop).toBeVisible();

  const controlsBox = await controls.boundingBox();
  const shopBox = await shop.boundingBox();
  expect(controlsBox).not.toBeNull();
  expect(shopBox).not.toBeNull();
  if (!controlsBox || !shopBox) return;

  expect(controlsBox.x).toBeGreaterThanOrEqual(0);
  expect(shopBox.x).toBeGreaterThanOrEqual(0);
  expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(390);
  expect(shopBox.x + shopBox.width).toBeLessThanOrEqual(390);
  expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(shopBox.y + 1);
});

test("workshop buys parts and refreshes balance", async ({ page }) => {
  let boughtDriveWheel = false;
  let buyRequests = 0;
  await page.route("**/api/shop", async (route) => {
    await route.fulfill({
      json: {
        emeralds: boughtDriveWheel ? 14 : 20,
        inventory: boughtDriveWheel
          ? [{ part_id: DRIVE_WHEEL.id, count: 1 }]
          : [],
        catalog: [
          {
            id: DRIVE_WHEEL.id,
            name: DRIVE_WHEEL.name,
            category: DRIVE_WHEEL.category,
            priceEmeralds: DRIVE_WHEEL.priceEmeralds,
          },
        ],
      },
    });
  });
  await page.route("**/api/shop/buy", async (route) => {
    buyRequests += 1;
    expect(route.request().postDataJSON()).toEqual({ partId: DRIVE_WHEEL.id });
    boughtDriveWheel = true;
    await route.fulfill({
      json: { bought: DRIVE_WHEEL.id, emeralds: 14 },
    });
  });

  // Parts buying lives inside the Workshop now; the standalone /shop is gone.
  await page.goto("/workshop");
  const shop = page.getByLabel("Parts shop");
  await expect(shop).toBeVisible();
  await expect(shop.locator("p").first()).toContainText("20 vibes");
  const driveWheel = shop.locator("li").filter({ hasText: DRIVE_WHEEL.name });
  await expect(driveWheel).toContainText(DRIVE_WHEEL.category);
  const buyDriveWheel = driveWheel.getByRole("button", {
    name: `${DRIVE_WHEEL.priceEmeralds} vibes`,
  });
  await expect(buyDriveWheel).toBeEnabled();
  await buyDriveWheel.click();
  await expect(shop.locator("p").first()).toContainText("14 vibes");
  await expect(shop.locator("p").first()).toContainText("bought!");
  await expect(driveWheel).toContainText("x1");
  expect(buyRequests).toBe(1);
});

test("garage saves and lists designs (needs storage)", async ({
  page,
  request,
}) => {
  const probe = await request.get("/api/designs");
  test.skip(
    probe.status() === 503,
    "storage not configured in this environment",
  );

  await page.goto("/workshop");
  const garage = page.getByLabel("Saved designs");
  await expect(garage).toBeVisible();
  const name = `E2E Bot ${Date.now()}`;
  await garage.getByLabel("Design name").fill(name);
  await garage.getByLabel("Design name").blur();
  await garage.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("saved to the garage")).toBeVisible();
  await expect(garage.getByRole("button", { name })).toBeVisible();
});
