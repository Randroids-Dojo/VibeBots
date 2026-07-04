import { expect, type Page, test } from "@playwright/test";
import { DRIVE_WHEEL } from "../../src/sim/parts";

// The Build tab shows one part at a time (N1 carousel); step Next until the
// named part is in hand. Bounded so a missing part fails loudly.
async function selectCarouselPart(page: Page, name: string) {
  const carousel = page.getByLabel("Part carousel");
  const nameEl = carousel.getByTestId("carousel-part-name");
  for (let i = 0; i < 30; i++) {
    if ((await nameEl.textContent())?.trim() === name) return;
    await carousel.getByRole("button", { name: "Next part" }).click();
  }
  throw new Error(`carousel never reached ${name}`);
}

// Drag the hero part straight up onto the core to place it on the nearest
// open slot. Tap-to-place was removed, so drag is the only placement path.
// Requires a 390x760 viewport and the hero turntable running (heroYaw set).
async function dragHeroOntoCore(page: Page) {
  const heroX = 195;
  const heroY = 545;
  const coreY = 405;
  await page.mouse.move(heroX, heroY);
  await page.mouse.down();
  await page.waitForTimeout(80);
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(heroX, heroY + ((coreY - heroY) * i) / 8);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
}

test("workshop builds and undoes parts", async ({ page }) => {
  // Pin inventory so the run does not depend on real storage: placing a
  // Drive Wheel spends one owned copy and merging it spends a second, so
  // stock two. Matches CI's storage-offline sandbox (memory F-048: a
  // local .env.local attaches real Neon and leaves the palette
  // "Checking inventory" past the test timeout).
  await page.route("**/api/shop", async (route) => {
    await route.fulfill({
      json: {
        emeralds: 20,
        inventory: [{ part_id: DRIVE_WHEEL.id, count: 2 }],
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

  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/workshop");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to mine" })).toBeVisible();
  await expect(
    page.getByText("My Bot: 1 part", { exact: false }),
  ).toBeVisible();

  // The Build tab is the default: the carousel and part actions live there.
  await expect(page.getByRole("tab", { name: "Build" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Direct-manipulation build (N1): parts are a one-at-a-time carousel. Step
  // to the Drive Wheel, then drag the hero part onto the bot to place it
  // (tap-to-place was removed as redundant).
  await selectCarouselPart(page, "Drive Wheel");
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
    .not.toBeUndefined();
  await dragHeroOntoCore(page);
  await expect(page.getByText("My Bot: 2 parts")).toBeVisible();

  // Placing selects the new part, so its inspector chip appears (W3).
  const inspector = page.getByRole("region", { name: "Selected part" });
  await expect(inspector).toBeVisible();
  await inspector.getByRole("button", { name: "Merge to Lv 2" }).click();
  await expect(inspector.getByText("Lv 2")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(
    page.getByText("My Bot: 1 part", { exact: false }),
  ).toBeVisible();

  // Tabs swap panels: Tune shows temperament, Build hides it.
  await page.getByRole("tab", { name: "Tune" }).click();
  await expect(page.getByLabel("Temperament")).toBeVisible();
  await expect(page.getByLabel("Part carousel")).not.toBeVisible();
  await page.getByRole("tab", { name: "Build" }).click();
  await expect(page.getByLabel("Part carousel")).toBeVisible();

  // Test arena (REQ-009): fight the current bot against the CPU Brawler.
  await page.getByRole("button", { name: "Test fight vs Brawler" }).click();
  await expect(page.getByText("My Bot", { exact: true })).toBeVisible();
  await expect(page.getByText("Brawler", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to build" }).click();
  await expect(page.getByLabel("Part carousel")).toBeVisible();
});

test("build carousel hero part spins on a turntable (N1)", async ({ page }) => {
  // The hero part rides in front of the bench and turntables so the player
  // sees a real 3D part. Its yaw is published to the canvas dataset; assert
  // it actually advances (Rule 10: prove the pixels move, not just a flag).
  await page.goto("/workshop");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const readYaw = () =>
    canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw);
  await expect.poll(readYaw).not.toBeUndefined();
  const first = await readYaw();
  await expect.poll(readYaw).not.toBe(first);
});

test("drag the hero part onto the bot places it (N2)", async ({ page }) => {
  // Direct manipulation: grab the hero part and drop it on the bot. Drag is
  // now the only placement path. Camera is fixed, so screen positions are
  // stable across GPU backends at a pinned viewport.
  await page.setViewportSize({ width: 390, height: 760 });
  await page.route("**/api/shop", async (route) => {
    await route.fulfill({
      json: {
        emeralds: 20,
        inventory: [{ part_id: DRIVE_WHEEL.id, count: 3 }],
        catalog: [],
      },
    });
  });
  await page.goto("/workshop");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await selectCarouselPart(page, "Drive Wheel");
  await expect(
    page.getByText("My Bot: 1 part", { exact: false }),
  ).toBeVisible();
  // Wait until the hero part is mounted and its turntable is running, so
  // the grab lands on the mesh rather than an empty canvas.
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
    .not.toBeUndefined();

  // The hero part docks in the lower band (~y 545); the core sits near the
  // middle (~y 405). Grab the part and drag it up onto the core.
  const heroX = 195;
  const heroY = 545;
  const coreY = 405;
  await page.mouse.move(heroX, heroY);
  await page.mouse.down();
  await page.waitForTimeout(80);
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(heroX, heroY + ((coreY - heroY) * i) / 8);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
});

test("tapping the hero part does not place it (D)", async ({ page }) => {
  // A grab only becomes a drag past a movement threshold, so a tap on the
  // hero must place nothing (previously a zero-distance drag snapped it onto
  // the nearest slot).
  await page.setViewportSize({ width: 390, height: 760 });
  await page.route("**/api/shop", async (route) => {
    await route.fulfill({
      json: {
        emeralds: 20,
        inventory: [{ part_id: DRIVE_WHEEL.id, count: 3 }],
        catalog: [],
      },
    });
  });
  await page.goto("/workshop");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await selectCarouselPart(page, "Drive Wheel");
  await expect(
    page.getByText("My Bot: 1 part", { exact: false }),
  ).toBeVisible();
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
    .not.toBeUndefined();

  // Tap the hero: press and release at the same point, no movement.
  await page.mouse.move(195, 545);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();

  // Still one part: the tap placed nothing.
  await expect(
    page.getByText("My Bot: 1 part", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("My Bot: 2 parts")).toBeHidden();
});

test("drag the hero part onto a twin merges it (N3)", async ({ page }) => {
  // Place one wheel on the left axle by dragging there, then drag the hero
  // wheel onto that twin: it should level up (no third part appears).
  await page.setViewportSize({ width: 390, height: 760 });
  await page.route("**/api/shop", async (route) => {
    await route.fulfill({
      json: {
        emeralds: 20,
        inventory: [{ part_id: DRIVE_WHEEL.id, count: 3 }],
        catalog: [],
      },
    });
  });
  await page.goto("/workshop");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await selectCarouselPart(page, "Drive Wheel");
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
    .not.toBeUndefined();

  // A helper drag from the docked hero up-left onto the left axle.
  const dragToLeftAxle = async () => {
    await page.mouse.move(195, 545);
    await page.mouse.down();
    await page.waitForTimeout(80);
    for (const [x, y] of [
      [180, 500],
      [150, 470],
      [120, 440],
      [110, 430],
    ]) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(30);
    }
  };

  // First wheel: drag it onto the left axle to place it.
  await dragToLeftAxle();
  await page.mouse.up();
  await expect(page.getByText("My Bot: 2 parts")).toBeVisible();

  // Second wheel: drag it onto the same twin to merge.
  await dragToLeftAxle();

  // Hovering the twin: the release-to-merge banner names the resulting level
  // (Slice B), so the merge intent reads in always-visible DOM.
  const mergeBanner = page.getByTestId("merge-banner");
  await expect(mergeBanner).toBeVisible();
  await expect(mergeBanner).toHaveText("↑ Release to merge into Lv 2");

  await page.mouse.up();

  // Merged, not added: still two parts, and the wheel is now level 2.
  await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
  const inspector = page.getByRole("region", { name: "Selected part" });
  await expect(inspector.getByText("Lv 2")).toBeVisible();
  // The banner clears once the drop resolves.
  await expect(mergeBanner).toBeHidden();
});

test("cycling the carousel clears the selected placed part (P1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.route("**/api/shop", async (route) => {
    await route.fulfill({
      json: {
        emeralds: 20,
        inventory: [{ part_id: DRIVE_WHEEL.id, count: 3 }],
        catalog: [],
      },
    });
  });
  await page.goto("/workshop");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await selectCarouselPart(page, "Drive Wheel");
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
    .not.toBeUndefined();

  // Dragging a part on selects it, so the placed-part inspector (Remove) shows.
  await dragHeroOntoCore(page);
  await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();

  // Cycling to another part clears the selection, so the inspector goes away.
  await page
    .getByLabel("Part carousel")
    .getByRole("button", { name: "Next part" })
    .click();
  await expect(page.getByRole("button", { name: "Remove" })).toBeHidden();
});

test("rotate the mount orientation before placing (N4)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.route("**/api/shop", async (route) => {
    await route.fulfill({
      json: {
        emeralds: 20,
        inventory: [{ part_id: DRIVE_WHEEL.id, count: 2 }],
        catalog: [],
      },
    });
  });
  await page.goto("/workshop");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await selectCarouselPart(page, "Drive Wheel");
  const carousel = page.getByLabel("Part carousel");
  const rotate = carousel.getByRole("button", { name: /Rotate mount/ });
  await expect(rotate).toHaveText("Rotate 0°");
  await rotate.click();
  await expect(rotate).toHaveText("Rotate 90°");

  // Placement still works after rotating the mount: drag the hero onto the bot.
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
    .not.toBeUndefined();
  await dragHeroOntoCore(page);
  await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
});

test("workshop tabs keep panels on-screen on portrait phones", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workshop");
  const controls = page.getByLabel("Workshop build controls");
  await expect(controls).toBeVisible();
  const controlsBox = await controls.boundingBox();
  expect(controlsBox).not.toBeNull();
  if (!controlsBox) return;
  expect(controlsBox.x).toBeGreaterThanOrEqual(0);
  expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(390);
  // The active panel stops above the lower half so the bot stays visible.
  expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(844 * 0.62);

  // One panel at a time: switching to Shop replaces the carousel.
  await page.getByRole("tab", { name: "Shop" }).click();
  await expect(page.getByLabel("Parts shop")).toBeVisible();
  await expect(page.getByLabel("Part carousel")).not.toBeVisible();
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

  // Parts buying lives in the workshop's Shop tab.
  await page.goto("/workshop");
  await page.getByRole("tab", { name: "Shop" }).click();
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
  await page.getByRole("tab", { name: "Garage" }).click();
  const garage = page.getByLabel("Saved designs");
  await expect(garage).toBeVisible();
  const name = `E2E Bot ${Date.now()}`;
  await garage.getByLabel("Design name").fill(name);
  await garage.getByLabel("Design name").blur();
  await garage.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("saved to the garage")).toBeVisible();
  await expect(garage.getByRole("button", { name })).toBeVisible();
});
