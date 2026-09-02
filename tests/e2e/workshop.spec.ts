import { expect, type Page, test } from "@playwright/test";
import { WORKSHOP_GUIDE_DONE_KEY } from "../../src/components/workshop-onboarding";
import { DRIVE_WHEEL } from "../../src/sim/parts";
import { ciCase } from "./support/ci-case";

// The guided first build (G6) opens a fresh browser on a three-part bot.
// Every case in this file was written against the bare starter core, so
// they all start with the guide already done. The guide cases themselves
// (titled with G6) get no init script at all, so a fresh context starts
// the guide and a reload sees only the flag the guide wrote; two scripts
// racing over one key would leave the start state to script order.
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.includes("(G6)")) return;
  await page.addInitScript((key: string) => {
    try {
      localStorage.setItem(key, "1");
    } catch {}
  }, WORKSHOP_GUIDE_DONE_KEY);
});

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

// The fight roster lives behind the thumb bar's "Test fight" button (G2);
// undo, redo, mirror, and recenter are plain buttons beside it. Open the
// roster (idempotent) before clicking one of its menu items.
async function openActions(page: Page) {
  const btn = page.getByRole("button", { name: "Test fight" });
  if ((await btn.getAttribute("aria-expanded")) !== "true") {
    await btn.click();
  }
  await expect(page.getByRole("menu")).toBeVisible();
}

test(
  "workshop builds and undoes parts",
  ciCase("E2E-WORKSHOP-0001", "@functional"),
  async ({ page }) => {
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
    await expect(
      page.getByRole("link", { name: "Back to mine" }),
    ).toBeVisible();
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

    // Placing selects the new part. Its stats live in the Build sheet now, so
    // open the sheet to reach them and merge it up (removal moved to the on-part
    // X, so this panel only rotates and merges).
    await openSheet(page);
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

    // Tabs swap panels: Tune shows temperament, Build hides it. The part
    // carousel now stays live on every tab (the bench is always buildable).
    await page.getByRole("tab", { name: "Tune" }).click();
    await expect(page.getByLabel("Temperament")).toBeVisible();
    await expect(page.getByLabel("Part carousel")).toBeVisible();
    await page.getByRole("tab", { name: "Build" }).click();
    await expect(page.getByLabel("Part carousel")).toBeVisible();

    // Test arena (REQ-009): fight the current bot against the CPU Brawler.
    await openActions(page);
    await page.getByRole("menuitem", { name: "Test fight vs Brawler" }).click();
    await expect(page.getByText("My Bot", { exact: true })).toBeVisible();
    await expect(page.getByText("Brawler", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to build" }).click();
    await expect(page.getByLabel("Part carousel")).toBeVisible();
  },
);

test(
  "build carousel hero part spins on a turntable (N1)",
  ciCase("E2E-WORKSHOP-0002", "@render"),
  async ({ page }) => {
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
  },
);

test(
  "drag the hero part onto the bot places it (N2)",
  ciCase("E2E-WORKSHOP-0003", "@functional"),
  async ({ page }) => {
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
  },
);

test(
  "tapping the hero part does not place it (D)",
  ciCase("E2E-WORKSHOP-0004", "@functional"),
  async ({ page }) => {
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
  },
);

test(
  "drag the hero part onto a twin merges it (N3)",
  ciCase("E2E-WORKSHOP-0005", "@functional"),
  async ({ page }) => {
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

    // Merged, not added: still two parts, and the wheel is now level 2. The
    // merged part is selected; open the sheet to read its stats in the Build tab.
    await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
    await openSheet(page);
    const inspector = page.getByRole("region", { name: "Selected part" });
    await expect(inspector.getByText("Lv 2")).toBeVisible();
    // The banner clears once the drop resolves.
    await expect(mergeBanner).toBeHidden();
  },
);

test(
  "cycling the carousel clears the selected placed part (P1)",
  ciCase("E2E-WORKSHOP-0006", "@functional"),
  async ({ page }) => {
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

    // Dragging a part on selects it, so the on-part remove handle (X) floats
    // over it in the 3D view.
    await dragHeroOntoCore(page);
    await expect(page.getByRole("button", { name: /^Remove / })).toBeVisible();

    // Cycling to another part clears the selection, so the handle goes away.
    await page
      .getByLabel("Part carousel")
      .getByRole("button", { name: "Next part" })
      .click();
    await expect(page.getByRole("button", { name: /^Remove / })).toBeHidden();
  },
);

test(
  "the on-part X removes the placed part",
  ciCase("E2E-WORKSHOP-0007", "@functional"),
  async ({ page }) => {
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
    await dragHeroOntoCore(page);
    await expect(page.getByText("My Bot: 2 parts")).toBeVisible();

    // Removal is one tap on the X floated over the part, no menu button.
    const removeX = page.getByRole("button", { name: /^Remove / });
    await expect(removeX).toBeVisible();
    await removeX.click();
    await expect(
      page.getByText("My Bot: 1 part", { exact: false }),
    ).toBeVisible();
    await expect(removeX).toBeHidden();
  },
);

test(
  "the hero tray clears the browse inspector on portrait (F-052)",
  ciCase("E2E-WORKSHOP-0008", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto("/workshop");
    const carousel = page.getByLabel("Part carousel");
    await expect(carousel.getByTestId("carousel-part-name")).toBeVisible();
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    // The hero is tappable once its turntable runs.
    await expect
      .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
      .not.toBeUndefined();

    // Reveal the browse inspector by tapping the hero part.
    await tapHero(page);
    const inspector = page.getByRole("region", { name: "Part details" });
    await expect(inspector).toBeVisible();

    // The carousel controls sit with the hero in the lower band and lift
    // clear of the docked inspector: no bounding boxes intersect.
    const inspectorBox = await inspector.boundingBox();
    const nameBox = await carousel
      .getByTestId("carousel-part-name")
      .boundingBox();
    const arrowsBox = await carousel
      .locator(".carousel-overlay-arrows")
      .boundingBox();
    expect(inspectorBox).not.toBeNull();
    expect(nameBox).not.toBeNull();
    expect(arrowsBox).not.toBeNull();
    if (!inspectorBox || !nameBox || !arrowsBox) return;
    // Controls live in the lower band, near the hero part.
    expect(nameBox.y).toBeGreaterThan(760 * 0.45);
    for (const box of [nameBox, arrowsBox]) {
      expect(box.y + box.height).toBeLessThanOrEqual(inspectorBox.y);
    }
  },
);

test(
  "rotate the mount orientation before placing (N4)",
  ciCase("E2E-WORKSHOP-0009", "@functional"),
  async ({ page }) => {
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
  },
);

test(
  "carousel shows part stats on tap, arrows flank the part (G)",
  ciCase("E2E-WORKSHOP-0010", "@functional"),
  async ({ page }) => {
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
  },
);

test(
  "workshop tabs keep panels on-screen on portrait phones",
  ciCase("E2E-WORKSHOP-0011", "@functional"),
  async ({ page }) => {
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

    // One panel at a time: switching to Shop replaces the tune panels. The part
    // carousel stays live on every tab so the bench is always buildable.
    await page.getByRole("tab", { name: "Shop" }).click();
    await expect(page.getByLabel("Parts shop")).toBeVisible();
    await expect(page.getByLabel("Temperament")).not.toBeVisible();
    await expect(page.getByLabel("Part carousel")).toBeVisible();
  },
);

test(
  "sheet: tab and handle toggle, switching keeps it open (N)",
  ciCase("E2E-WORKSHOP-0012", "@functional"),
  async ({ page }) => {
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
    await expect(
      page.getByRole("region", { name: "Blueprints" }),
    ).toBeVisible();
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
  },
);

test(
  "sheet drag: down closes, up opens (N)",
  ciCase("E2E-WORKSHOP-0013", "@functional"),
  async ({ page }) => {
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
  },
);

test(
  "the whole top strip drags the sheet, tabs included",
  ciCase("E2E-WORKSHOP-0014", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto("/workshop");
    const sheet = page.locator(".workshop-sheet");
    await page.getByRole("tab", { name: "Garage" }).click();
    await expect(sheet).not.toHaveClass(/workshop-sheet-collapsed/);

    // Dragging vertically starting on a TAB button (not the grip) still slides
    // the sheet: the whole top strip is one drag surface. Dispatch on the tab so
    // the drag is deterministic; capture throws on the synthetic id and is
    // swallowed by the handler.
    const dragFromTab = (delta: number) =>
      page.getByRole("tab", { name: "Garage" }).evaluate((el, dy) => {
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
      }, delta);

    // Drag down from the tab closes it; a tap on the tab would just select it.
    await dragFromTab(140);
    await expect(sheet).toHaveClass(/workshop-sheet-collapsed/);
    // Drag up from the tab opens it again.
    await dragFromTab(-140);
    await expect(sheet).not.toHaveClass(/workshop-sheet-collapsed/);
  },
);

test(
  "the thumb bar holds undo, redo, mirror, recenter, and the fight roster (G2)",
  ciCase("E2E-WORKSHOP-0015", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/workshop");
    // The bar sits in the sheet's top strip, so it shows with the sheet
    // collapsed (the default on Build) and needs no menu to reach.
    const bar = page.getByTestId("thumb-bar");
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button", { name: "Undo" })).toBeDisabled();
    await expect(bar.getByRole("button", { name: "Redo" })).toBeDisabled();
    await expect(bar.getByRole("button", { name: "Mirror" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(
      bar.getByRole("button", { name: "Recenter the view on the bot" }),
    ).toBeVisible();
    const actions = bar.getByRole("button", { name: "Test fight" });
    await expect(actions).toBeVisible();
    // The old top-bar options menu is gone.
    await expect(page.getByRole("button", { name: "Bot actions" })).toHaveCount(
      0,
    );
    // Closed by default: the roster is not in the DOM until opened.
    await expect(
      page.getByRole("menuitem", { name: "Test fight vs Brawler" }),
    ).toHaveCount(0);

    // Open: the replica opponent roster and both fight actions appear.
    await actions.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Fight Contagion" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Fight Night Terror" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Fight Impaler" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Test fight vs Brawler" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Fight a rival" }),
    ).toBeVisible();

    // A tap outside the menu closes it, and so does Escape, which hands
    // focus back to the button that opened it.
    await page.mouse.click(196, 250);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await actions.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(actions).toBeFocused();
  },
);

test(
  "the carousel filters to owned parts; the Build toggle reveals the rest (P)",
  ciCase("E2E-WORKSHOP-0016", "@functional"),
  async ({ page }) => {
    // Only the Drive Wheel is owned, so the owned-only carousel (default) is
    // pinned to it. Storage-ready inventory drives the filter.
    await page.route("**/api/shop", async (route) => {
      await route.fulfill({
        json: {
          emeralds: 50,
          inventory: [{ part_id: DRIVE_WHEEL.id, count: 2 }],
          catalog: [],
        },
      });
    });
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto("/workshop");
    const carousel = page.getByLabel("Part carousel");
    const nameEl = carousel.getByTestId("carousel-part-name");
    // Owned-only: the pool is just the Drive Wheel, so Next cannot leave it.
    await expect(nameEl).toHaveText("Drive Wheel");
    await carousel.getByRole("button", { name: "Next part" }).click();
    await expect(nameEl).toHaveText("Drive Wheel");

    // Flip the Build-tab toggle to "all parts". The toggle lives in the sheet,
    // so open it, flip, then collapse it again to bring the carousel arrows back
    // to their resting position for the click below.
    const buildTab = page.getByRole("tab", { name: "Build" });
    await buildTab.click(); // opens the sheet
    const toggle = page.getByRole("button", { name: /Carousel:/ });
    await expect(toggle).toHaveText("Carousel: owned only");
    await toggle.click();
    await expect(toggle).toHaveText("Carousel: all parts");
    await buildTab.click(); // collapse so the arrows are reachable again
    await expect(page.locator(".workshop-sheet")).toHaveClass(
      /workshop-sheet-collapsed/,
    );
    // Now Next reaches a part the player does not own.
    await carousel.getByRole("button", { name: "Next part" }).click();
    await expect(nameEl).not.toHaveText("Drive Wheel");
  },
);

test(
  "parts still attach while a menu tab is selected",
  ciCase("E2E-WORKSHOP-0017", "@functional"),
  async ({ page }) => {
    // The hero and drag-to-attach stay live off the Build tab. Own two Drive
    // Wheels so placing one is allowed.
    await page.route("**/api/shop", async (route) => {
      await route.fulfill({
        json: {
          emeralds: 20,
          inventory: [{ part_id: DRIVE_WHEEL.id, count: 2 }],
          catalog: [],
        },
      });
    });
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto("/workshop");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    await expect(
      page.getByText("My Bot: 1 part", { exact: false }),
    ).toBeVisible();

    // Select the Tune tab, then collapse its sheet so the hero-drag band is
    // clear. The carousel and hero must still be live here (not just on Build).
    const tune = page.getByRole("tab", { name: "Tune" });
    await tune.click();
    await tune.click(); // collapse the sheet
    await expect(page.locator(".workshop-sheet")).toHaveClass(
      /workshop-sheet-collapsed/,
    );
    await selectCarouselPart(page, "Drive Wheel");
    await expect
      .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
      .not.toBeUndefined();

    // Dragging the hero onto the bot places it, even though Tune is the open tab.
    await dragHeroOntoCore(page);
    await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
  },
);

test(
  "the bot lifts above an open menu sheet (O)",
  ciCase("E2E-WORKSHOP-0018", "@functional"),
  async ({ page }) => {
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
    // Build lifts too when its sheet is open (its Chassis/Parts would otherwise
    // bury the bot); switching to it keeps the sheet open, so it stays lifted.
    await page.getByRole("tab", { name: "Build" }).click();
    await expect.poll(lift).toBeGreaterThan(0.05);
    // Collapsing the sheet drops the lift back to 0, restoring the drag band.
    await page.getByRole("tab", { name: "Build" }).click();
    await expect.poll(lift).toBe(0);
  },
);

test(
  "the menu lift is restored after returning from a test fight",
  ciCase("E2E-WORKSHOP-0019", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/workshop");
    await expect(page.locator("canvas")).toBeVisible();
    // Non-strict: the arena and workshop canvases overlap for a beat across the
    // fight transition, so read the first one's dataset directly.
    const lift = () =>
      page.evaluate(() =>
        Number(document.querySelector("canvas")?.dataset.menuLift ?? "0"),
      );
    // Open a menu tab so the bot lifts above the sheet.
    await page.getByRole("tab", { name: "Garage" }).click();
    await expect.poll(lift).toBeGreaterThan(0.05);
    // Run a test fight (this unmounts the whole workshop view for the arena),
    // then come straight back.
    await openActions(page);
    await page.getByRole("menuitem", { name: "Test fight vs Brawler" }).click();
    await page.getByRole("button", { name: "Back to build" }).click();
    // The sheet is still open, so the lift must be re-measured and restored, not
    // stranded at 0 by the arena view unmounting the panel mid-measure.
    await expect.poll(lift).toBeGreaterThan(0.05);
  },
);

test(
  "the hero part clears the open menu sheet, not hidden behind it",
  ciCase("E2E-WORKSHOP-0020", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/workshop");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    const heroY = () =>
      canvas.evaluate((c: HTMLCanvasElement) =>
        Number(c.dataset.heroScreenY ?? "-1"),
      );
    // Wait for the docked hero to publish its screen position.
    await expect.poll(heroY).toBeGreaterThan(0);

    // Open a tall menu tab: the sheet covers the lower screen and the bot lifts.
    await page.getByRole("tab", { name: "Garage" }).click();
    await expect
      .poll(() =>
        canvas.evaluate((c: HTMLCanvasElement) =>
          Number(c.dataset.menuLift ?? "0"),
        ),
      )
      .toBeGreaterThan(0.05);

    // The docked part must sit above the sheet's top edge, with margin, so the
    // player can see and grab the part they are browsing while a menu is open.
    const sheetTopFrac = await page
      .locator(".workshop-sheet")
      .evaluate((el) => el.getBoundingClientRect().top / window.innerHeight);
    await expect.poll(heroY).toBeLessThan(sheetTopFrac - 0.03);
    expect(await heroY()).toBeGreaterThan(0);
  },
);

test(
  "menu opens instantly and streams content behind a spinner (perf)",
  ciCase("E2E-WORKSHOP-0021", "@functional"),
  async ({ page }) => {
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
  },
);

test(
  "a warmed fetch-backed tab opens without the spinner blink",
  ciCase("E2E-WORKSHOP-0022", "@functional"),
  async ({ page }) => {
    // The mount prefetch warms the shop cache, so opening Shop later shows the
    // catalog immediately instead of collapsing the sheet to a spinner and
    // springing back. A slow fetch makes the (absent) spinner observable.
    const catalog = Array.from({ length: 14 }, (_, i) => ({
      id: `p${i}`,
      name: `Part ${i}`,
      category: "mobility",
      priceEmeralds: i + 1,
    }));
    await page.route("**/api/shop", async (route) => {
      await new Promise((r) => setTimeout(r, 150));
      await route.fulfill({ json: { emeralds: 999, inventory: [], catalog } });
    });
    await page.route("**/api/designs", async (route) => {
      await new Promise((r) => setTimeout(r, 150));
      await route.fulfill({ json: { designs: [] } });
    });
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/workshop");
    // Let the mount prefetch settle so the cache is warm before Shop is opened.
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Tune" }).click();
    await page.getByRole("tab", { name: "Garage" }).click();
    // Open Shop and watch every frame until its content appears: the loading
    // spinner (which collapses the sheet and blinks) must never show.
    await page.getByRole("tab", { name: "Shop" }).click();
    let spinnerSeen = false;
    for (let i = 0; i < 25; i++) {
      const [hasSpinner, hasContent] = await page.evaluate(() => [
        !!document.querySelector(".workshop-sheet-loading"),
        !!document.querySelector('aside[aria-label="Parts shop"]'),
      ]);
      if (hasSpinner) spinnerSeen = true;
      if (hasContent) break;
      await page.waitForTimeout(15);
    }
    expect(spinnerSeen).toBe(false);
    await expect(page.getByText("999 vibes")).toBeVisible();
  },
);

test(
  "bot clears a tall menu after it loads, and re-opening does not blink (perf)",
  ciCase("E2E-WORKSHOP-0023", "@functional"),
  async ({ page }) => {
    // A tall catalog that arrives after a short delay: the bot lift must
    // re-measure once the real height lands (not stay stuck at the spinner
    // height), and re-opening the tab must show the cached catalog with no
    // spinner collapse.
    const catalog = Array.from({ length: 14 }, (_, i) => ({
      id: `p${i}`,
      name: `Part ${i}`,
      category: "mobility",
      priceEmeralds: i + 1,
    }));
    // Gate the fetch so the spinner phase is deterministic: the lift can be
    // sampled while the spinner is guaranteed to still be showing.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/api/shop", async (route) => {
      await gate;
      await route.fulfill({
        json: { emeralds: 999, inventory: [], catalog },
      });
    });
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto("/workshop");
    const canvas = page.locator("canvas");
    const lift = () =>
      canvas.evaluate((c: HTMLCanvasElement) =>
        Number(c.dataset.menuLift ?? "0"),
      );
    const spinner = page.locator(".workshop-build-panels .workshop-spinner");

    // Open Shop: the spinner shows first at a small lift, then the tall catalog
    // lands and the bot lifts further to clear it.
    await page.getByRole("tab", { name: "Shop" }).click();
    await expect(spinner).toBeVisible();
    expect(await lift()).toBeLessThan(0.1);
    release();
    await expect(page.getByText("999 vibes")).toBeVisible();
    // The re-measure lifts the bot clear of the tall menu (the shorter menu
    // needs less lift than before, but still clearly more than the spinner).
    await expect.poll(lift).toBeGreaterThan(0.11);

    // Switch away and back: the cached catalog shows instantly, no spinner.
    await page.getByRole("tab", { name: "Tune" }).click();
    await expect(page.getByText("999 vibes")).toHaveCount(0);
    await page.getByRole("tab", { name: "Shop" }).click();
    await expect(page.getByText("999 vibes")).toBeVisible();
    await expect(spinner).toHaveCount(0);
  },
);

test(
  "workshop tabs press in when held (H)",
  ciCase("E2E-WORKSHOP-0024", "@functional"),
  async ({ page }) => {
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
  },
);

test(
  "workshop buys parts and refreshes balance",
  ciCase("E2E-WORKSHOP-0025", "@functional"),
  async ({ page }) => {
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
      expect(route.request().postDataJSON()).toEqual({
        partId: DRIVE_WHEEL.id,
      });
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
    // Rows sit under their family heading now (G4), not a category suffix.
    await expect(
      shop
        .getByRole("region", { name: "Drive parts" })
        .locator("li")
        .filter({ hasText: DRIVE_WHEEL.name }),
    ).toBeVisible();
    const buyDriveWheel = driveWheel.getByRole("button", {
      name: `${DRIVE_WHEEL.priceEmeralds} vibes`,
    });
    await expect(buyDriveWheel).toBeEnabled();
    await buyDriveWheel.click();
    await expect(shop.locator("p").first()).toContainText("14 vibes");
    await expect(shop.locator("p").first()).toContainText("bought!");
    await expect(driveWheel).toContainText("x1");
    expect(buyRequests).toBe(1);
  },
);

test(
  "garage saves and lists designs (needs storage)",
  ciCase("E2E-WORKSHOP-0026", "@functional"),
  async ({ page, request }) => {
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
  },
);

test(
  "choose a chassis variant, resetting to a fresh bot (I)",
  ciCase("E2E-WORKSHOP-0027", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto("/workshop");
    await expect(
      page.getByRole("link", { name: "Back to mine" }),
    ).toBeVisible();

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
  },
);

test(
  "load a starter blueprint and its chassis follows (J)",
  ciCase("E2E-WORKSHOP-0028", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto("/workshop");
    await expect(
      page.getByRole("link", { name: "Back to mine" }),
    ).toBeVisible();

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
    await expect(
      chassis.getByRole("button", { name: "Wedge" }),
    ).toHaveAttribute("aria-pressed", "true");
  },
);

test(
  "mirror mode fills both twin mounts from one drag (L)",
  ciCase("E2E-WORKSHOP-0029", "@functional"),
  async ({ page }) => {
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

    // Turn Mirror on from the thumb bar (visible with the sheet collapsed),
    // which leaves the carousel and hero-drag band clear.
    const mirror = page.getByTestId("thumb-bar").getByRole("button", {
      name: "Mirror",
    });
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
  },
);

test(
  "the held part tracks the finger while a menu lifts the view",
  ciCase("E2E-WORKSHOP-0030", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/workshop");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    // Open the Build sheet so the menu-lift view offset is active.
    await page.getByRole("tab", { name: "Build" }).click();
    await expect
      .poll(() =>
        canvas.evaluate((c: HTMLCanvasElement) =>
          Number(c.dataset.menuLift ?? "0"),
        ),
      )
      .toBeGreaterThan(0.05);
    const rect = await canvas.evaluate((c: HTMLCanvasElement) => {
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const heroY = await canvas.evaluate((c: HTMLCanvasElement) =>
      Number(c.dataset.heroScreenY ?? "0.5"),
    );
    // Grab the lifted hero and promote the grab to a drag.
    await page.mouse.move(rect.x + rect.w * 0.5, rect.y + rect.h * heroY);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.w * 0.5, rect.y + rect.h * heroY - 24);
    // Carry it to an off-center point; the held part must be drawn there, under
    // the finger, not offset upward by the view lift.
    const tx = 0.4;
    const ty = 0.4;
    await page.mouse.move(rect.x + rect.w * tx, rect.y + rect.h * ty, {
      steps: 5,
    });
    await expect
      .poll(() =>
        canvas.evaluate((c: HTMLCanvasElement) =>
          Number(c.dataset.dragScreenY ?? "-1"),
        ),
      )
      .toBeGreaterThan(0);
    const part = await canvas.evaluate((c: HTMLCanvasElement) => ({
      x: Number(c.dataset.dragScreenX),
      y: Number(c.dataset.dragScreenY),
    }));
    await page.mouse.up();
    expect(Math.abs(part.x - tx) * rect.w).toBeLessThan(12);
    expect(Math.abs(part.y - ty) * rect.h).toBeLessThan(12);
  },
);

test(
  "the bench fights the stock roster and reports a measurable result",
  ciCase("E2E-WORKSHOP-0032", "@functional"),
  async ({ page }) => {
    await page.goto("/workshop");
    await expect(page.getByLabel("Part carousel")).toBeVisible();

    await page.getByRole("tab", { name: "Tune" }).click();
    const bench = page.getByLabel("Bench");
    await expect(bench).toBeVisible();

    // A whole roster pass is several full 60-second matches resolved
    // headlessly, so give it room; it is still far faster than watching one.
    await bench.getByTestId("run-bench").click();
    const report = bench.getByTestId("bench-report");
    await expect(report).toBeVisible({ timeout: 180_000 });

    // The headline number is a real percentage, not a placeholder.
    await expect(bench.getByTestId("bench-win-rate")).toHaveText(
      /^\d+% win rate$/,
    );
    // One row per stock opponent, each carrying a decided outcome.
    const rows = bench.getByTestId("bench-match-row");
    await expect(rows).toHaveCount(18);
    for (const row of await rows.all()) {
      await expect(row).toHaveText(/win|loss|draw/);
    }

    // Re-running the same build reports the A/B against the previous run.
    // The build did not change, so nothing should have flipped.
    await bench.getByTestId("run-bench").click();
    const comparison = bench.getByTestId("bench-comparison");
    await expect(comparison).toBeVisible({ timeout: 180_000 });
    await expect(comparison).toContainText("No outcome changed");
  },
);

test(
  "the balance readout reports a tip-over angle and draws on the bench",
  ciCase("E2E-WORKSHOP-0033", "@render"),
  async ({ page }) => {
    await page.goto("/workshop");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();

    await page.getByRole("tab", { name: "Tune" }).click();
    const balance = page.getByLabel("Balance");
    await expect(balance).toBeVisible();

    // A real angle, not a placeholder.
    await expect(balance.getByTestId("balance-tipover")).toHaveText(
      /^Leans \d+ degrees before it goes over$/,
    );

    // The overlay is off by default and exposes its state accessibly.
    const toggle = balance.getByTestId("toggle-balance");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    // Rule 10: prove the pixels change, not just that a control says it is on.
    const before = await canvas.screenshot();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => (await canvas.screenshot()).equals(before), {
        timeout: 10_000,
      })
      .toBe(false);
  },
);

test(
  "the tech inspection passes rule by rule and enforces a declared class",
  ciCase("E2E-WORKSHOP-0034", "@functional"),
  async ({ page }) => {
    await page.goto("/workshop");
    await expect(page.getByLabel("Part carousel")).toBeVisible();

    await page.getByRole("tab", { name: "Tune" }).click();
    const inspection = page.getByLabel("Tech inspection");
    await expect(inspection).toBeVisible();

    // Every rule is listed and the starter bot passes all of them.
    const items = inspection.getByTestId("inspection-item");
    await expect(items).toHaveCount(7);
    for (const item of await items.all()) {
      await expect(item).toHaveAttribute("data-passed", "true");
    }
    await expect(inspection.getByTestId("inspection-verdict")).toHaveText(
      "Passed",
    );

    // Unclassed by default; the starter bot is light enough for anything.
    const antweight = inspection.locator(
      '[data-testid="weight-class-option"][data-class-id="antweight"]',
    );
    await antweight.click();
    await expect(antweight).toHaveAttribute("aria-pressed", "true");
    await expect(inspection.getByTestId("inspection-verdict")).toHaveText(
      "Passed",
    );

    // Declaring the lightest class on a heavy build must fail exactly one
    // rule, and it must be the weight rule: a checklist localizes the fault.
    const featherweight = inspection.locator(
      '[data-testid="weight-class-option"][data-class-id="featherweight"]',
    );
    await featherweight.click();
    await expect(featherweight).toHaveAttribute("aria-pressed", "true");
    await expect(
      inspection.locator(
        '[data-testid="inspection-item"][data-item-id="weight"]',
      ),
    ).toHaveAttribute("data-passed", "true");
  },
);

test(
  "drive gearing trades power for torque on the whole axle set",
  ciCase("E2E-WORKSHOP-0035", "@functional"),
  async ({ page }) => {
    await page.goto("/workshop");
    await expect(page.getByLabel("Part carousel")).toBeVisible();
    await page.getByRole("tab", { name: "Tune" }).click();

    const gearing = page.getByLabel("Drive gearing");
    await expect(gearing).toBeVisible();

    // The starter bot has no wheels yet, so there is nothing to gear.
    await expect(gearing.getByTestId("gearing-summary")).toContainText(
      "Add drive wheels",
    );

    // Load a blueprint so the bot actually has drive axles.
    await page.getByRole("tab", { name: "Garage" }).click();
    await page.getByRole("button", { name: /Cube Rammer/ }).click();
    await page.getByRole("tab", { name: "Tune" }).click();

    // Direct drive by default, and the reduction options price themselves.
    await expect(gearing.getByTestId("gearing-summary")).toContainText(
      "Ratio 1.0",
    );
    const crawler = gearing.locator(
      '[data-testid="gear-option"][data-ratio="2.2"]',
    );
    await expect(crawler).toContainText("+15.6W");

    await crawler.click();
    await expect(crawler).toHaveAttribute("aria-pressed", "true");
    await expect(gearing.getByTestId("gearing-summary")).toContainText(
      "Ratio 2.2",
    );

    // The inspection still passes: this build can afford the torque.
    await expect(
      page.getByLabel("Tech inspection").getByTestId("inspection-verdict"),
    ).toHaveText("Passed");
  },
);

test(
  "the bench faces the front of the bot, frames a tapped part, and recenters (G1)",
  ciCase("E2E-WORKSHOP-0036", "@functional"),
  async ({ page }) => {
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
    const read = (key: string) =>
      canvas.evaluate(
        (c: HTMLCanvasElement, k: string) => Number(c.dataset[k] ?? "NaN"),
        key,
      );

    // Front three-quarter: every core's front is -z, so the camera sits on
    // the -z side (it used to sit at +z and show the back of the bot).
    await expect.poll(() => read("cameraZ")).toBeLessThan(0);
    await expect.poll(() => read("cameraY")).toBeGreaterThan(0);

    // Place a wheel. Placement selects the part but is not a tap, so the
    // whole pose (target and camera, all three axes) holds still under a
    // building finger.
    await selectCarouselPart(page, "Drive Wheel");
    await expect
      .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
      .not.toBeUndefined();
    const poseKeys = [
      "cameraTargetX",
      "cameraTargetY",
      "cameraTargetZ",
      "cameraX",
      "cameraY",
      "cameraZ",
    ];
    const readPose = async () => {
      const pose: Record<string, number> = {};
      for (const key of poseKeys) pose[key] = await read(key);
      return pose;
    };
    const before = await readPose();
    await dragHeroOntoCore(page);
    await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
    await page.waitForTimeout(400);
    const after = await readPose();
    for (const key of poseKeys) {
      expect(Math.abs(after[key] - before[key])).toBeLessThan(0.005);
    }
    expect(Math.abs(after.cameraTargetX)).toBeLessThan(0.005);

    // Recenter puts the target on the bot's bounds centre, which the wheel
    // has pulled off the core to one side, and the camera back in front.
    // The placed wheel is selected, so its handle position says which side
    // it landed on; the core tap below stays on the other side of centre.
    const wheelRight = (await read("selectedScreenX")) > 0.5;
    const recenter = page.getByRole("button", {
      name: "Recenter the view on the bot",
    });
    await recenter.click();
    await expect
      .poll(async () => Math.abs(await read("cameraTargetX")))
      .toBeGreaterThan(0.05);
    await expect.poll(() => read("cameraZ")).toBeLessThan(0);
    // Let the glide settle before reading the reference point.
    await page.waitForTimeout(700);
    const centeredX = await read("cameraTargetX");

    // Tap the core: a tap on a placed part frames it, so the target glides
    // from the bounds centre most of the way back toward the core.
    await page.mouse.click(wheelRight ? 172 : 218, 405);
    await expect
      .poll(() => read("cameraTargetX"))
      .not.toBeCloseTo(centeredX, 2);
    await page.waitForTimeout(700);
    const framedX = await read("cameraTargetX");
    expect(Math.abs(framedX)).toBeLessThan(Math.abs(centeredX));
    expect(Math.abs(framedX - centeredX)).toBeGreaterThan(0.04);

    // Recenter again returns to the same centre.
    await recenter.click();
    await expect.poll(() => read("cameraTargetX")).toBeCloseTo(centeredX, 2);
  },
);

test(
  "the header meters read the live budget and name why a part will not fit (G2)",
  ciCase("E2E-WORKSHOP-0037", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.route("**/api/shop", async (route) => {
      await route.fulfill({
        json: {
          emeralds: 20,
          inventory: [
            { part_id: DRIVE_WHEEL.id, count: 3 },
            { part_id: "spin-mount", count: 1 },
            { part_id: "spinner-bar", count: 1 },
            { part_id: "hardened-plate", count: 1 },
          ],
          catalog: [],
        },
      });
    });
    await page.goto("/workshop");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    const power = page.getByTestId("meter-power");
    const weight = page.getByTestId("meter-weight");
    // A bare cube core: no draw, full supply, and an unclassed bot reads
    // against the lightest class it fits.
    await expect(power).toHaveAttribute("data-draw", "0");
    await expect(power).toHaveAttribute("data-supply", "100");
    await expect(weight).toHaveAttribute("data-class", "antweight");
    await expect(page.getByTestId("ready-chip")).toHaveAttribute(
      "data-ready",
      "true",
    );

    // Two wheels in one mirrored drag (the thumb bar's Mirror): the power
    // meter follows the draw the inspection sums.
    await page
      .getByTestId("thumb-bar")
      .getByRole("button", { name: "Mirror" })
      .click();
    await selectCarouselPart(page, "Drive Wheel");
    await expect
      .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
      .not.toBeUndefined();
    await dragHeroOntoCore(page);
    await expect(page.getByText("My Bot: 3 parts")).toBeVisible();
    await expect(power).toHaveAttribute("data-draw", "40");

    // A third wheel has no mount: the reason names the mount, not a budget.
    const reason = page.getByTestId("budget-reason");
    await expect(reason).toHaveAttribute("data-blocker", "mount");
    await expect(reason).toContainText("No room for Drive Wheel");

    // Max reduction on both axles costs 31.2 power; a spin mount on the
    // nose then leaves the spinner bar (36) short by 7.2, and the power
    // meter flashes to say so.
    await page.getByRole("tab", { name: "Tune" }).click();
    await page.locator('[data-testid="gear-option"][data-ratio="2.2"]').click();
    await expect(power).toHaveAttribute("data-draw", "71.2");
    await collapseSheet(page);
    await selectCarouselPart(page, "Spin Mount");
    await expect
      .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
      .not.toBeUndefined();
    await dragHeroOntoCore(page);
    await expect(page.getByText("My Bot: 4 parts")).toBeVisible();
    await selectCarouselPart(page, "Spinner Bar");
    // The flash is armed for 900ms when the block appears, so read it first.
    await expect(page.locator('[data-meter="power"]')).toHaveAttribute(
      "data-flash",
      "true",
    );
    await expect(reason).toHaveAttribute("data-blocker", "power");
    await expect(reason).toContainText("Spinner Bar needs 7.2 more power");

    // Declare Antweight: the weight meter takes the class name and ceiling,
    // and the hardened plate is refused on weight, not on a mount.
    await page.getByRole("tab", { name: "Tune" }).click();
    await page.getByRole("button", { name: /^Antweight/ }).click();
    await expect(weight).toHaveAttribute("data-class", "antweight");
    await expect(weight).toHaveAttribute("data-limit", "0.60");
    await collapseSheet(page);
    await selectCarouselPart(page, "Hardened Plate");
    await expect(reason).toHaveAttribute("data-blocker", "weight");
    await expect(reason).toContainText("over Antweight");
  },
);

test(
  "a share code carries the whole bot out of the garage and back in (G8)",
  ciCase("E2E-WORKSHOP-0038", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto("/workshop");
    await expect(page.locator("canvas")).toBeVisible();

    // Load the Wedge Razor blueprint and read its code from the Share box.
    await page.getByRole("tab", { name: "Garage" }).click();
    await page
      .getByRole("region", { name: "Blueprints" })
      .getByRole("button", { name: /Wedge Razor/ })
      .click();
    await expect(page.getByText("Wedge Razor: 5 parts")).toBeVisible();
    const share = page.getByRole("region", { name: "Share" });
    await expect(share).toBeVisible();
    const code = await share.getByTestId("share-code").inputValue();
    expect(code.startsWith("VB1.")).toBe(true);
    expect(code.length).toBeLessThan(600);

    // Reset to the starter bot, then paste the code back in.
    await page.getByRole("button", { name: "Reset to starter bot" }).click();
    await expect(
      page.getByText("My Bot: 1 part", { exact: false }),
    ).toBeVisible();
    await share.getByTestId("share-import").fill(code);
    await share.getByRole("button", { name: "Load bot" }).click();
    await expect(share.getByTestId("share-import-ok")).toContainText(
      "Loaded Wedge Razor",
    );
    await expect(page.getByText("Wedge Razor: 5 parts")).toBeVisible();

    // A damaged code is refused with a reason, and the bot is untouched.
    await share.getByTestId("share-import").fill("VB1.notacode!!");
    await share.getByRole("button", { name: "Load bot" }).click();
    await expect(share.getByTestId("share-import-error")).toContainText(
      "damaged",
    );
    await expect(page.getByText("Wedge Razor: 5 parts")).toBeVisible();

    // A share link opens the workshop with the bot loaded and drops the code
    // from the address bar.
    await page.goto(`/workshop?code=${encodeURIComponent(code)}`);
    await expect(page.getByText("Wedge Razor: 5 parts")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.location.search))
      .toBe("");
  },
);

test(
  "a first visit opens on a guided bot and the coach card follows the player (G6)",
  ciCase("E2E-WORKSHOP-0039", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    // A brand-new player owns nothing; the guide's wheel must still place.
    await page.route("**/api/shop", async (route) => {
      await route.fulfill({
        json: { emeralds: 0, inventory: [], catalog: [] },
      });
    });
    await page.goto("/workshop");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    const coach = page.getByTestId("coach-card");
    await expect(coach).toHaveAttribute("data-step", "place");
    await expect(coach).toContainText("Drag the wheel");
    await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
    await expect(page.getByTestId("carousel-part-name")).toHaveText(
      "Drive Wheel",
    );

    // The first drag is the tutorial: the wheel lands on the free axle.
    await expect
      .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
      .not.toBeUndefined();
    await dragHeroOntoCore(page);
    await expect(page.getByText("My Bot: 4 parts")).toBeVisible();
    await expect(coach).toHaveAttribute("data-step", "fight");

    // A test fight ends the second step; coming back shows the third.
    await openActions(page);
    await page.getByRole("menuitem", { name: "Test fight vs Brawler" }).click();
    await page.getByRole("button", { name: "Back to build" }).click();
    await expect(coach).toHaveAttribute("data-step", "shop");
    await page.getByRole("tab", { name: "Shop" }).click();
    await expect(coach).toHaveCount(0);

    // Done is remembered: a reload opens on the plain starter bot.
    await page.reload();
    await expect(
      page.getByText("My Bot: 1 part", { exact: false }),
    ).toBeVisible();
    await expect(coach).toHaveCount(0);
  },
);

test(
  "the guided first build can be skipped and replayed from the garage (G6)",
  ciCase("E2E-WORKSHOP-0040", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto("/workshop");
    const coach = page.getByTestId("coach-card");
    await expect(coach).toHaveAttribute("data-step", "place");
    await coach.getByRole("button", { name: "Skip" }).click();
    await expect(coach).toHaveCount(0);
    await page.reload();
    await expect(coach).toHaveCount(0);

    await page.getByRole("tab", { name: "Garage" }).click();
    await page.getByRole("button", { name: "Replay the first build" }).click();
    await expect(coach).toHaveAttribute("data-step", "place");
    await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
  },
);

test(
  "the carousel chips step one family at a time and the shop lists by family (G4)",
  ciCase("E2E-WORKSHOP-0041", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.route("**/api/shop", async (route) => {
      await route.fulfill({
        json: {
          emeralds: 200,
          inventory: [
            { part_id: DRIVE_WHEEL.id, count: 2 },
            { part_id: "frame-plate", count: 1 },
            { part_id: "ram-spike", count: 1 },
          ],
          catalog: [
            {
              id: "frame-plate",
              name: "Frame Plate",
              category: "structure",
              priceEmeralds: 3,
            },
            {
              id: "light-plate",
              name: "Light Plate",
              category: "structure",
              priceEmeralds: 2,
            },
            {
              id: "drive-wheel",
              name: "Drive Wheel",
              category: "mobility",
              priceEmeralds: 6,
            },
            {
              id: "grip-wheel",
              name: "Grip Wheel",
              category: "mobility",
              priceEmeralds: 12,
            },
            {
              id: "super-wheel",
              name: "Super Wheel",
              category: "mobility",
              priceEmeralds: 20,
            },
            {
              id: "lance",
              name: "Lance",
              category: "weapon",
              priceEmeralds: 12,
            },
          ],
        },
      });
    });
    await page.goto("/workshop");
    const carousel = page.getByLabel("Part carousel");
    const nameEl = carousel.getByTestId("carousel-part-name");
    const chips = page.getByTestId("carousel-chips");
    await expect(chips.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Owned-only pool: three parts across three families. The Weapon chip
    // pins the carousel to the one owned weapon; Next cannot leave it.
    await chips.getByRole("button", { name: "Weapon" }).click();
    await expect(nameEl).toHaveText("Ram Spike");
    await carousel.getByRole("button", { name: "Next part" }).click();
    await expect(nameEl).toHaveText("Ram Spike");
    await chips.getByRole("button", { name: "Drive" }).click();
    await expect(nameEl).toHaveText("Drive Wheel");
    await chips.getByRole("button", { name: "Frame" }).click();
    await expect(nameEl).toHaveText("Frame Plate");

    // With unowned parts shown, the Drive family climbs the wheel ladder.
    await page.getByRole("tab", { name: "Build" }).click();
    await page.getByRole("button", { name: /Carousel:/ }).click();
    await page.getByRole("tab", { name: "Build" }).click();
    await chips.getByRole("button", { name: "Drive" }).click();
    await selectCarouselPart(page, "Super Wheel");
    await expect(nameEl).toHaveText("Super Wheel");
    await carousel.getByRole("button", { name: "Next part" }).click();
    await expect(nameEl).not.toHaveText("Super Wheel");
    await expect
      .poll(async () => (await nameEl.textContent())?.trim())
      .toMatch(/Wheel|Drum/);

    // The shop lists by family with the ladder in order, cheapest first
    // even when the payload lists a lower rung after a higher one.
    await page.getByRole("tab", { name: "Shop" }).click();
    const frame = page.getByRole("region", { name: "Frame parts" });
    await expect(frame.locator("li").nth(0)).toContainText("Light Plate");
    await expect(frame.locator("li").nth(1)).toContainText("Frame Plate");
    const drive = page.getByRole("region", { name: "Drive parts" });
    await expect(drive.getByRole("heading", { name: "Drive" })).toBeVisible();
    await expect(drive.locator("li")).toHaveCount(3);
    await expect(drive.locator("li").nth(0)).toContainText("Drive Wheel");
    await expect(drive.locator("li").nth(2)).toContainText("Super Wheel");
    await expect(
      page.getByRole("region", { name: "Weapon parts" }).getByRole("button", {
        name: "Buy Lance for 12 vibes",
      }),
    ).toBeVisible();
  },
);

test(
  "paint colours the bot on the bench and rides into the arena with the team ring (G5)",
  ciCase("E2E-WORKSHOP-0042", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto("/workshop");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    const paintOf = (key: "paintPrimary" | "paintAccent") =>
      canvas.evaluate((c: HTMLCanvasElement, k: string) => c.dataset[k], key);
    await expect.poll(() => paintOf("paintPrimary")).toBe("none");

    // Pick a body colour: the trim defaults, then pick a trim too.
    await openSheet(page);
    const paint = page.getByRole("region", { name: "Paint" });
    await paint.getByRole("button", { name: "Body paint Cobalt" }).click();
    await expect(
      paint.getByRole("button", { name: "Body paint Cobalt" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => paintOf("paintPrimary")).toBe("cobalt");
    await expect.poll(() => paintOf("paintAccent")).toBe("slate");
    await paint.getByRole("button", { name: "Trim paint Gold" }).click();
    await expect.poll(() => paintOf("paintAccent")).toBe("gold");

    // Paint is undoable and clearable.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => paintOf("paintAccent")).toBe("slate");
    await paint.getByRole("button", { name: "Clear paint" }).click();
    await expect.poll(() => paintOf("paintPrimary")).toBe("none");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => paintOf("paintPrimary")).toBe("cobalt");

    // The painted bot fights in its paint; the stock opponent keeps its
    // team colour, and both carry a team ring.
    await collapseSheet(page);
    await openActions(page);
    await page.getByRole("menuitem", { name: "Test fight vs Brawler" }).click();
    await expect(
      page.getByRole("button", { name: "Back to build" }),
    ).toBeVisible();
    const arena = page.locator("canvas").first();
    await expect
      .poll(() =>
        arena.evaluate((c: HTMLCanvasElement) => c.dataset.botPaint1 ?? ""),
      )
      .toBe("cobalt:slate");
    await expect
      .poll(() =>
        arena.evaluate((c: HTMLCanvasElement) => c.dataset.botPaint0 ?? ""),
      )
      .toBe("none");
    // The team ring under each bot is published too: both present, in the
    // two team colours, so the sides read however the hulls are painted.
    const rings = await arena.evaluate((c: HTMLCanvasElement) => [
      c.dataset.teamRing0 ?? "",
      c.dataset.teamRing1 ?? "",
    ]);
    expect(rings[0]).toMatch(/^#[0-9a-f]{6}$/);
    expect(rings[1]).toMatch(/^#[0-9a-f]{6}$/);
    expect(rings[0]).not.toBe(rings[1]);
  },
);

test(
  "a drop sparks, a removal dissolves, and a merge that can chain says so (G7)",
  ciCase("E2E-WORKSHOP-0043", "@functional"),
  async ({ page }) => {
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
    const read = (key: string) =>
      canvas.evaluate(
        (c: HTMLCanvasElement, k: string) => c.dataset[k] ?? "",
        key,
      );
    await selectCarouselPart(page, "Drive Wheel");
    await expect
      .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
      .not.toBeUndefined();

    // A drop sparks: the burst is in flight right after the placement and
    // has died within a second.
    await dragHeroOntoCore(page);
    await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
    await expect.poll(() => read("sparking")).toBe("1");
    await expect.poll(() => read("sparking"), { timeout: 3000 }).toBe("0");

    // A removal dissolves: the ghost shrinks over several frames from full
    // size to a fifth (Rule 10: observable movement, read from the trace
    // the canvas publishes because the dissolve is over in a quarter
    // second), then the ghost is gone.
    await page.getByRole("button", { name: /^Remove / }).click();
    await expect(
      page.getByText("My Bot: 1 part", { exact: false }),
    ).toBeVisible();
    await expect
      .poll(async () => Number(await read("dissolveFrames")))
      .toBeGreaterThan(2);
    await expect
      .poll(async () => Number(await read("dissolveMin")))
      .toBeLessThan(0.25);
    await expect.poll(() => read("dissolving"), { timeout: 3000 }).toBe("0");

    // A merge with another copy still available celebrates the chain;
    // the last merge to the cap does not.
    await dragHeroOntoCore(page);
    await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
    await openSheet(page);
    const inspector = page.getByRole("region", { name: "Selected part" });
    await inspector.getByRole("button", { name: "Merge to Lv 2" }).click();
    await expect(page.getByTestId("chain-cue")).toContainText(
      "Merge again to Lv 3",
    );
    await inspector.getByRole("button", { name: "Merge to Lv 3" }).click();
    await expect(inspector.getByText("Lv 3")).toBeVisible();
    await expect(page.getByTestId("chain-cue")).toHaveCount(0);
  },
);

test(
  "the first minute: the guided axles face the camera and fill together, the chips stay in reach under a reason line, and the remove handle stays off the header (G6) (F-241, F-243, F-242)",
  ciCase("E2E-WORKSHOP-0044", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.route("**/api/shop", async (route) => {
      await route.fulfill({
        json: {
          emeralds: 20,
          inventory: [
            { part_id: DRIVE_WHEEL.id, count: 3 },
            { part_id: "ram-spike", count: 1 },
            { part_id: "frame-plate", count: 1 },
          ],
          catalog: [],
        },
      });
    });
    await page.goto("/workshop");
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId("coach-card")).toHaveAttribute(
      "data-step",
      "place",
    );

    // F-241: the guided start has both axles empty and Mirror on, so the
    // axle facing the camera glows in the frame and one drop over the bot
    // fills both sides: two parts become four, the coach advances, and the
    // selected wheel's published screen anchor is inside the frame.
    await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mirror" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await selectCarouselPart(page, "Drive Wheel");
    await expect
      .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.dataset.heroYaw))
      .not.toBeUndefined();
    await dragHeroOntoCore(page);
    await expect(page.getByText("My Bot: 4 parts")).toBeVisible();
    await expect(page.getByTestId("coach-card")).toHaveAttribute(
      "data-step",
      "fight",
    );
    const anchorX = () =>
      canvas.evaluate((c: HTMLCanvasElement) =>
        Number(c.dataset.selectedScreenX),
      );
    const anchorY = () =>
      canvas.evaluate((c: HTMLCanvasElement) =>
        Number(c.dataset.selectedScreenY),
      );
    await expect.poll(anchorX).toBeGreaterThan(0.05);
    await expect.poll(anchorX).toBeLessThan(0.95);
    await expect.poll(anchorY).toBeGreaterThan(0.05);
    await expect.poll(anchorY).toBeLessThan(0.95);

    // F-243: both axles are full, so the reason line is up; the family
    // chips sit under it inside the header card and a real pointer click
    // still reaches them.
    const reason = page.getByTestId("budget-reason");
    await expect(reason).toHaveAttribute("data-blocker", "mount");
    const chips = page.getByTestId("carousel-chips");
    const weapon = chips.getByRole("button", { name: "Weapon" });
    const hit = await weapon.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return top === el || el.contains(top);
    });
    expect(hit).toBe(true);
    await weapon.click();
    const nameEl = page
      .getByLabel("Part carousel")
      .getByTestId("carousel-part-name");
    await expect(nameEl).toHaveText("Ram Spike");
    // The guided bot already wears a spike on its only spike mount, so the
    // reason line stays up for it; a plate fits the free top mount and gets
    // the neutral line instead, and the chip row stays reachable through
    // both because the header's height does not change.
    await expect(reason).toHaveAttribute("data-blocker", "mount");
    await chips.getByRole("button", { name: "Frame" }).click();
    await expect(nameEl).toHaveText("Frame Plate");
    await expect(reason).toHaveAttribute("data-blocker", "none");
    await expect(reason).toContainText("Frame Plate fits");

    // F-242: with the sheet open the canvas is short and the selected wheel
    // sits near the top of it; the remove handle stays below the header
    // card instead of floating over it.
    await openSheet(page);
    const handle = page.getByRole("button", { name: /^Remove / });
    await expect(handle).toBeVisible();
    const header = page.locator(".workshop-header");
    await expect
      .poll(async () => {
        const h = await handle.boundingBox();
        const hd = await header.boundingBox();
        if (!h || !hd) return -1;
        return h.y - (hd.y + hd.height);
      })
      .toBeGreaterThanOrEqual(0);
  },
);

test.describe("phone", () => {
  test.use({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.6,
    hasTouch: true,
    isMobile: true,
  });

  test(
    "the workshop canvas caps its render resolution on phones",
    ciCase("E2E-WORKSHOP-0031", "@render"),
    async ({ page }) => {
      await page.goto("/workshop");
      const canvas = page.locator("canvas");
      await expect(canvas).toBeVisible();
      const size = await canvas.evaluate((c: HTMLCanvasElement) => ({
        buf: c.width,
        css: c.clientWidth,
      }));
      // The low (phone) tier caps the device pixel ratio at 1.5, so the drawing
      // buffer must stay well under the 2.6 device ratio. This keeps the
      // continuously animating canvas from saturating a mobile GPU (perf).
      expect(size.buf).toBeGreaterThan(0);
      expect(size.buf).toBeLessThanOrEqual(Math.ceil(size.css * 1.5) + 2);
      expect(size.buf).toBeLessThan(size.css * 2);
    },
  );
});
