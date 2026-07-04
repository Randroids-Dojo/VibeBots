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

// Bot-first sheet (N): the tab controls live in a bottom sheet that defaults
// collapsed on Build (so the bot, carousel, and hero-drag band stay clear).
// These helpers expand or collapse it so a test can reach Build-tab controls
// (Chassis, Mirror) and then get the sheet out of the way to drag the hero.
function sheetCollapsed(page: Page) {
  return page
    .locator(".workshop-sheet")
    .evaluate((el) => el.classList.contains("workshop-sheet-collapsed"));
}
async function openSheet(page: Page) {
  if (await sheetCollapsed(page)) {
    await page.locator(".workshop-sheet-handle").click();
  }
}
async function collapseSheet(page: Page) {
  if (!(await sheetCollapsed(page))) {
    await page.locator(".workshop-sheet-handle").click();
  }
}

// Tap the hero part (press and release, no movement) to toggle its stats in
// the bottom inspector (G). The part must be owned so the hero is grabbable.
async function tapHero(page: Page) {
  await page.mouse.move(195, 545);
  await page.mouse.down();
  await page.waitForTimeout(120);
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
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
    .not.toBeUndefined();
  // Rotate lives in the part-details inspector, revealed by tapping the hero.
  await tapHero(page);
  const details = page.getByRole("region", { name: "Part details" });
  const rotate = details.getByRole("button", { name: /Rotate mount/ });
  await expect(rotate).toHaveText("Rotate 0°");
  await rotate.click();
  await expect(rotate).toHaveText("Rotate 90°");

  // Placement still works after rotating the mount: drag the hero onto the bot.
  await dragHeroOntoCore(page);
  await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
});

test("carousel shows part stats on tap, arrows flank the part (G)", async ({
  page,
}) => {
  // Stats are hidden until you tap the part; the carousel is a thin overlay
  // (name + prev/next arrows) instead of a menu box (user feedback).
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

  // The overlay shows the name and both arrows; stats stay hidden.
  const carousel = page.getByLabel("Part carousel");
  await expect(carousel.getByTestId("carousel-part-name")).toHaveText(
    "Drive Wheel",
  );
  await expect(
    carousel.getByRole("button", { name: "Previous part" }),
  ).toBeVisible();
  await expect(
    carousel.getByRole("button", { name: "Next part" }),
  ).toBeVisible();
  const details = page.getByRole("region", { name: "Part details" });
  await expect(details).toBeHidden();

  // Tap the part: its stats appear in the bottom inspector.
  await tapHero(page);
  await expect(details).toBeVisible();
  await expect(details).toContainText("80 HP");
  await expect(details).toContainText("20 power");

  // Tap again to hide them.
  await tapHero(page);
  await expect(details).toBeHidden();
});

test("workshop tabs keep panels on-screen on portrait phones", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workshop");
  // Bot-first (N): the tab controls live in a bottom sheet. Opening a menu
  // tab expands the sheet; its panel must stay within the viewport bounds on
  // portrait (never wider than the screen, never below the bottom edge).
  await page.getByRole("tab", { name: "Tune" }).click();
  const controls = page.getByLabel("Workshop build controls");
  await expect(controls).toBeVisible();
  const controlsBox = await controls.boundingBox();
  expect(controlsBox).not.toBeNull();
  if (!controlsBox) return;
  expect(controlsBox.x).toBeGreaterThanOrEqual(0);
  expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(390);
  expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(844);

  // One panel at a time: switching to Shop replaces the tune panels, and the
  // build overlay only shows on the Build tab.
  await page.getByRole("tab", { name: "Shop" }).click();
  await expect(page.getByLabel("Parts shop")).toBeVisible();
  await expect(page.getByLabel("Temperament")).not.toBeVisible();
  await expect(page.getByLabel("Part carousel")).not.toBeVisible();
});

test("sheet: tab and handle toggle, switching keeps it open (N)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/workshop");
  const sheet = page.locator(".workshop-sheet");
  const handle = page.locator(".workshop-sheet-handle");
  const build = page.getByRole("tab", { name: "Build" });
  const garage = page.getByRole("tab", { name: "Garage" });
  const tune = page.getByRole("tab", { name: "Tune" });
  await expect(sheet).toBeVisible();
  // Build lands closed so the bot is the hero, not a stack of menus.
  await expect(sheet).toHaveClass(/workshop-sheet-collapsed/);

  // Tapping the active tab always toggles the sheet: open, then closed.
  await build.click();
  await expect(sheet).not.toHaveClass(/workshop-sheet-collapsed/);
  await expect(page.getByRole("region", { name: "Chassis" })).toBeVisible();
  await build.click();
  await expect(sheet).toHaveClass(/workshop-sheet-collapsed/);

  // Tapping a different tab opens and switches to it.
  await garage.click();
  await expect(sheet).not.toHaveClass(/workshop-sheet-collapsed/);
  await expect(page.getByRole("region", { name: "Blueprints" })).toBeVisible();
  // Tapping ANOTHER tab while open switches without closing (never toggles).
  await tune.click();
  await expect(sheet).not.toHaveClass(/workshop-sheet-collapsed/);
  await expect(page.getByLabel("Temperament")).toBeVisible();
  // Tapping the now-active tab toggles it closed.
  await tune.click();
  await expect(sheet).toHaveClass(/workshop-sheet-collapsed/);

  // The handle toggles too.
  await handle.click();
  await expect(sheet).not.toHaveClass(/workshop-sheet-collapsed/);
});

test("sheet drag: down closes, up opens (N)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/workshop");
  const sheet = page.locator(".workshop-sheet");
  const handle = page.locator(".workshop-sheet-handle");
  // Open a menu tab so the sheet has content to slide.
  await page.getByRole("tab", { name: "Garage" }).click();
  await expect(sheet).not.toHaveClass(/workshop-sheet-collapsed/);

  // Drive the drag by dispatching pointer events straight at the handle. A
  // real finger keeps events on the handle via pointer capture, but a
  // synthetic mouse drag that leaves the small handle loses that capture, so
  // dispatching on the element is the deterministic way to exercise the
  // handler's open/close thresholds.
  const dragHandle = (delta: number) =>
    handle.evaluate((el, dy) => {
      const target = el as HTMLElement & {
        setPointerCapture: (id: number) => void;
      };
      const orig = target.setPointerCapture;
      target.setPointerCapture = () => {};
      const y0 = 300;
      const fire = (type: string, y: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            clientX: 120,
            clientY: y,
            button: 0,
            bubbles: true,
            cancelable: true,
          }),
        );
      fire("pointerdown", y0);
      for (let i = 1; i <= 6; i++) fire("pointermove", y0 + (dy * i) / 6);
      fire("pointerup", y0 + dy);
      target.setPointerCapture = orig;
    }, delta);

  // Drag the handle down past the threshold to close it.
  await dragHandle(140);
  await expect(sheet).toHaveClass(/workshop-sheet-collapsed/);
  // Drag the handle up to open it again.
  await dragHandle(-140);
  await expect(sheet).not.toHaveClass(/workshop-sheet-collapsed/);
});

test("the bot lifts above an open menu sheet (O)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/workshop");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const lift = () =>
    canvas.evaluate((c: HTMLCanvasElement) =>
      Number(c.dataset.menuLift ?? "0"),
    );
  // Build lands collapsed: no lift, so the hero-drag band never shifts.
  await expect.poll(lift).toBe(0);
  // Opening a tall menu tab lifts the bot up into the band above the sheet.
  await page.getByRole("tab", { name: "Garage" }).click();
  await expect.poll(lift).toBeGreaterThan(0.05);
  // Build never lifts (lift 0), even with its own controls open.
  await page.getByRole("tab", { name: "Build" }).click();
  await expect.poll(lift).toBe(0);
});

test("menu opens instantly and streams content behind a spinner (perf)", async ({
  page,
}) => {
  // Hold the shop fetch open so the loading state is observable: the sheet
  // must open immediately without waiting on it, then a spinner streams the
  // content in.
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/shop", async (route) => {
    await gate;
    await route.fulfill({
      json: {
        emeralds: 50,
        inventory: [],
        catalog: [
          {
            id: "drive-wheel",
            name: "Drive Wheel",
            category: "mobility",
            priceEmeralds: 5,
          },
        ],
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/workshop");
  const sheet = page.locator(".workshop-sheet");
  // Tapping Shop opens the sheet right away, before the fetch resolves.
  await page.getByRole("tab", { name: "Shop" }).click();
  await expect(sheet).not.toHaveClass(/workshop-sheet-collapsed/);
  // A spinner covers the still-loading parts shop.
  const spinner = page.getByRole("status", { name: /parts shop/i });
  await expect(spinner).toBeVisible();
  // Releasing the fetch swaps the spinner for the real content.
  release();
  await expect(page.getByText("50 vibes")).toBeVisible();
  await expect(spinner).toHaveCount(0);
});

test("workshop tabs press in when held (H)", async ({ page }) => {
  // Buttons should feel tactile: holding a control presses it in (Rule 10,
  // prove the pixels move, not just that a style exists).
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/workshop");
  const tab = page.getByRole("tab", { name: "Tune" });
  await expect(tab).toBeVisible();
  const box = await tab.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const readTransform = () =>
    tab.evaluate((el) => getComputedStyle(el).transform);
  // At rest the button is untransformed.
  expect(await readTransform()).toBe("none");
  // While held (:active), it presses in, so the transform is a real matrix.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const held = await readTransform();
  await page.mouse.up();
  expect(held).not.toBe("none");
  expect(held).toContain("matrix");
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

test("choose a chassis variant, resetting to a fresh bot (I)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/workshop");
  await expect(page.getByRole("link", { name: "Back to mine" })).toBeVisible();

  // Build lands bot-first with the sheet collapsed; open it to reach Chassis.
  await openSheet(page);
  const chassis = page.getByRole("region", { name: "Chassis" });
  await expect(chassis).toBeVisible();
  const cube = chassis.getByRole("button", { name: "Cube" });
  const tower = chassis.getByRole("button", { name: "Tower" });
  await expect(cube).toHaveAttribute("aria-pressed", "true");
  await expect(tower).toHaveAttribute("aria-pressed", "false");

  // Swap to the Tower chassis: it becomes the active core and the bot resets
  // to a fresh one-part build (name preserved).
  await tower.click();
  await expect(tower).toHaveAttribute("aria-pressed", "true");
  await expect(cube).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("My Bot: 1 part")).toBeVisible();

  // The swap is undoable: one Undo restores the Cube chassis.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(cube).toHaveAttribute("aria-pressed", "true");
});

test("load a starter blueprint and its chassis follows (J)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/workshop");
  await expect(page.getByRole("link", { name: "Back to mine" })).toBeVisible();

  await page.getByRole("tab", { name: "Garage" }).click();
  const blueprints = page.getByRole("region", { name: "Blueprints" });
  await expect(blueprints).toBeVisible();
  await blueprints.getByRole("button", { name: /Wedge Razor/ }).click();

  // The loaded bot replaces the design (5 parts: core, two wheels, plow, spike).
  await expect(page.getByText("Wedge Razor: 5 parts")).toBeVisible();

  // Its chassis is reflected on the Build tab (open the sheet to see it).
  await page.getByRole("tab", { name: "Build" }).click();
  await openSheet(page);
  const chassis = page.getByRole("region", { name: "Chassis" });
  await expect(chassis.getByRole("button", { name: "Wedge" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("mirror mode fills both twin mounts from one drag (L)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.route("**/api/shop", async (route) => {
    await route.fulfill({
      json: {
        emeralds: 20,
        inventory: [{ part_id: DRIVE_WHEEL.id, count: 4 }],
        catalog: [],
      },
    });
  });
  await page.goto("/workshop");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  // Turn Mirror on (open the sheet for the Build controls), then collapse the
  // sheet so it clears the carousel and hero-drag band.
  await openSheet(page);
  const chassis = page.getByRole("region", { name: "Chassis" });
  const mirror = chassis.getByRole("button", { name: /Mirror/ });
  await expect(mirror).toHaveAttribute("aria-pressed", "false");
  await mirror.click();
  await expect(mirror).toHaveAttribute("aria-pressed", "true");
  await collapseSheet(page);
  await selectCarouselPart(page, "Drive Wheel");
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
    .not.toBeUndefined();

  // One drag onto an axle fills both axles, so the bot gains two wheels.
  await dragHeroOntoCore(page);
  await expect(page.getByText("My Bot: 3 parts")).toBeVisible();
});
