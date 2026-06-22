import { expect, type Page, test } from "@playwright/test";
import packageJson from "../../package.json";

const MINE_KEY_CADENCE_MS = 190;
const APP_VERSION_PATTERN = new RegExp(
  `^${packageJson.version.replaceAll(".", "\\.")}([.+]|$)`,
);

async function pressMineKey(
  page: Page,
  key: "ArrowDown" | "ArrowUp" | "ArrowLeft" | "ArrowRight",
): Promise<void> {
  await page.keyboard.press(key);
  await page.waitForTimeout(MINE_KEY_CADENCE_MS);
}

async function touchDrag(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, x: start.x, y: start.y }],
  });
  for (let step = 1; step <= 6; step += 1) {
    const progress = step / 6;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          id: 1,
          x: start.x + (end.x - start.x) * progress,
          y: start.y + (end.y - start.y) * progress,
        },
      ],
    });
  }
  await page.waitForTimeout(700);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await client.detach();
}

async function touchPinchOut(
  page: Page,
  center: { x: number; y: number },
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const send = async (gap: number, type: "touchStart" | "touchMove") => {
    await client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: [
        { id: 1, x: center.x - gap / 2, y: center.y },
        { id: 2, x: center.x + gap / 2, y: center.y },
      ],
    });
  };
  await send(42, "touchStart");
  for (const gap of [72, 104, 138, 172]) {
    await send(gap, "touchMove");
  }
  await page.waitForTimeout(120);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await client.detach();
}

/** Multi-hit digging (REQ-013): swing down until the depth is reached. */
async function digTo(page: Page, depth: number): Promise<void> {
  const status = page.getByLabel("Mine status");
  for (let i = 0; i < 8 * depth + 8; i++) {
    if (Number(await status.getAttribute("data-depth")) >= depth) return;
    await pressMineKey(page, "ArrowDown");
  }
}

/** Standing on a stall shows a prompt; tap it to open the menu. Returns
 * the menu region. Stalls no longer auto-open on walk-by. */
async function openStall(page: Page, name: string) {
  const prompt = page.getByRole("button", { name: `Open ${name}` });
  await expect(prompt).toBeVisible();
  await prompt.click();
  const sheet = page.getByRole("region", { name, exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function walkToStallPrompt(
  page: Page,
  key: "ArrowLeft" | "ArrowRight",
  name: string,
): Promise<void> {
  const prompt = page.getByRole("button", { name: `Open ${name}` });
  for (let i = 0; i < 20; i++) {
    if (await prompt.isVisible().catch(() => false)) return;
    await pressMineKey(page, key);
  }
  await expect(prompt).toBeVisible();
}

async function expectSurfacePromptBottomClearance(
  page: Page,
  name: string,
): Promise<void> {
  const prompt = page.getByRole("button", { name });
  await expect(prompt).toBeVisible();
  await expect
    .poll(
      async () =>
        prompt.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return window.innerHeight - rect.bottom;
        }),
      { message: `${name} should sit above the bottom controls` },
    )
    .toBeGreaterThanOrEqual(140);
}

async function expectMineShellViewportLocked(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const shell = document.querySelector("[data-mine-shell]");
          const controls = document.querySelector(
            '[aria-label="Dig controls"]',
          );
          const settings = document.querySelector(
            '[aria-label="Open settings"]',
          );
          const zoomIn = document.querySelector('[aria-label="Zoom in"]');
          const zoomOut = document.querySelector('[aria-label="Zoom out"]');
          if (!shell || !controls || !settings || !zoomIn || !zoomOut) {
            return false;
          }
          const visualViewport = window.visualViewport;
          const viewportTop = visualViewport?.offsetTop ?? 0;
          const viewportLeft = visualViewport?.offsetLeft ?? 0;
          const viewportWidth = visualViewport?.width ?? window.innerWidth;
          const viewportHeight = visualViewport?.height ?? window.innerHeight;
          const viewportRight = viewportLeft + viewportWidth;
          const viewportBottom = viewportTop + viewportHeight;
          const inViewport = (element: Element) => {
            const rect = element.getBoundingClientRect();
            return (
              rect.top >= viewportTop &&
              rect.left >= viewportLeft &&
              rect.bottom <= viewportBottom &&
              rect.right <= viewportRight
            );
          };
          const shellRect = shell.getBoundingClientRect();
          const htmlStyle = window.getComputedStyle(document.documentElement);
          const bodyStyle = window.getComputedStyle(document.body);
          return (
            window.scrollY === 0 &&
            Math.abs(shellRect.top - viewportTop) < 1 &&
            Math.abs(shellRect.left - viewportLeft) < 1 &&
            Math.abs(shellRect.right - viewportRight) < 1 &&
            Math.abs(shellRect.bottom - viewportBottom) < 1 &&
            htmlStyle.overflow === "hidden" &&
            bodyStyle.overflow === "hidden" &&
            bodyStyle.position === "fixed" &&
            inViewport(controls) &&
            inViewport(settings) &&
            inViewport(zoomIn) &&
            inViewport(zoomOut)
          );
        }),
      { message: "mine shell should stay locked to the visible viewport" },
    )
    .toBe(true);
}

async function installStandaloneVisualViewport(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.addInitScript(() => {
    const realMatchMedia = window.matchMedia?.bind(window);
    const fakeMediaQueryList = (query: string, matches: boolean) =>
      ({
        addEventListener: () => {},
        addListener: () => {},
        dispatchEvent: () => false,
        matches,
        media: query,
        onchange: null,
        removeEventListener: () => {},
        removeListener: () => {},
      }) as MediaQueryList;

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => {
        if (query === "(display-mode: standalone)") {
          return fakeMediaQueryList(query, true);
        }
        return realMatchMedia?.(query) ?? fakeMediaQueryList(query, false);
      },
    });

    const events = new EventTarget();
    const state = {
      height: 696,
      offsetLeft: 0,
      offsetTop: 64,
      pageLeft: 0,
      pageTop: 0,
      scale: 1,
      width: 390,
    };
    const viewport = {
      addEventListener: events.addEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
      onresize: null,
      onscroll: null,
      onscrollend: null,
      removeEventListener: events.removeEventListener.bind(events),
    } as unknown as VisualViewport;

    for (const key of Object.keys(state) as Array<keyof typeof state>) {
      Object.defineProperty(viewport, key, {
        configurable: true,
        get: () => state[key],
      });
    }

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });
    Object.defineProperty(window, "__vibebotsSetVisualViewport", {
      configurable: true,
      value: (next: Partial<typeof state>) => {
        Object.assign(state, next);
        events.dispatchEvent(new Event("resize"));
        events.dispatchEvent(new Event("scroll"));
        events.dispatchEvent(new Event("scrollend"));
      },
    });
  });
}

async function expectRegionHorizontalBounds(
  page: Page,
  name: string,
): Promise<void> {
  const region = page.getByRole("region", { name });
  await expect
    .poll(
      () =>
        region.evaluate((element) => {
          const panel = element as HTMLElement;
          const panelRect = panel.getBoundingClientRect();
          const childRects = Array.from(
            panel.querySelectorAll<HTMLElement>("*"),
            (child) => child.getBoundingClientRect(),
          );
          const contentLeft = Math.min(
            panelRect.left,
            ...childRects.map((rect) => rect.left),
          );
          const contentRight = Math.max(
            panelRect.right,
            ...childRects.map((rect) => rect.right),
          );
          return (
            panelRect.left >= 0 &&
            panelRect.right <= window.innerWidth &&
            contentLeft >= panelRect.left - 1 &&
            contentRight <= panelRect.right + 1 &&
            panel.scrollWidth <= panel.clientWidth + 1
          );
        }),
      { message: `${name} should stay inside its panel` },
    )
    .toBe(true);
}

/** Walk the surface toward a destination building until its Enter prompt
 * appears, then tap it. Presses are paced past the glide and the loop
 * tolerates the odd dropped synthetic key (it stops on the prompt, not a
 * fixed step count). */
async function enterBuilding(
  page: Page,
  key: "ArrowLeft" | "ArrowRight",
  name: string,
): Promise<void> {
  const prompt = page.getByRole("button", { name: `Enter ${name}` });
  for (let i = 0; i < 16; i++) {
    if (await prompt.isVisible().catch(() => false)) break;
    await pressMineKey(page, key);
  }
  await expect(prompt).toBeVisible();
  await prompt.click();
}

async function walkUntilBaseIndicator(page: Page) {
  const indicator = page.getByRole("button", { name: "Base is left" });
  for (let i = 0; i < 28; i++) {
    if (await indicator.isVisible().catch(() => false)) break;
    await pressMineKey(page, "ArrowRight");
  }
  await expect(indicator).toBeVisible();
  return indicator;
}

/** Swing a lateral direction until the rendered miner crosses targetX. */
async function digLateral(
  page: Page,
  key: "ArrowLeft" | "ArrowRight",
  pastX: number,
): Promise<void> {
  const canvas = page.locator("canvas");
  for (let i = 0; i < 10; i++) {
    await pressMineKey(page, key);
    const x = Number(await canvas.getAttribute("data-miner-x"));
    if (key === "ArrowLeft" ? x < pastX : x > pastX) return;
  }
}

async function dismissReleaseNotes(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "New in VibeBots" });
  const button = dialog.getByRole("button", { name: "Got it" });
  await dialog.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  for (let i = 0; i < 6; i++) {
    if (!(await dialog.isVisible().catch(() => false))) return;
    await button.click();
    await page.waitForTimeout(250);
  }
  await expect(dialog).not.toBeVisible();
}

async function openSettings(page: Page) {
  const settings = page.getByRole("region", { name: "Settings" });
  if (!(await settings.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Open settings" }).click();
  }
  await expect(settings).toBeVisible();
  return settings;
}

async function speedUpVersionRefreshChecks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const realSetTimeout = window.setTimeout;
    const realSetInterval = window.setInterval;
    window.setTimeout = ((...args: Parameters<typeof window.setTimeout>) => {
      const [handler, timeout, ...rest] = args;
      return realSetTimeout(
        handler,
        timeout === 30_000 ? 20 : timeout,
        ...rest,
      );
    }) as typeof window.setTimeout;
    window.setInterval = ((...args: Parameters<typeof window.setInterval>) => {
      const [handler, timeout, ...rest] = args;
      return realSetInterval(
        handler,
        timeout === 60_000 ? 20 : timeout,
        ...rest,
      );
    }) as typeof window.setInterval;
  });
}

async function installGamepadBackControl(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let backPressed = false;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [
        {
          buttons: Array.from({ length: 17 }, (_, index) => ({
            pressed: (index === 1 || index === 8) && backPressed,
            touched: (index === 1 || index === 8) && backPressed,
            value: (index === 1 || index === 8) && backPressed ? 1 : 0,
          })),
        },
      ],
    });
    Object.defineProperty(window, "__setGamepadBackPressed", {
      configurable: true,
      value: (pressed: boolean) => {
        backPressed = pressed;
      },
    });
  });
}

async function pressGamepadBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as Window & {
        __setGamepadBackPressed: (pressed: boolean) => void;
      }
    ).__setGamepadBackPressed(true);
  });
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    (
      window as unknown as Window & {
        __setGamepadBackPressed: (pressed: boolean) => void;
      }
    ).__setGamepadBackPressed(false);
  });
  await page.waitForTimeout(80);
}

async function countRedPixels(page: Page, image: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("canvas screenshot decode failed"));
      img.src = `data:image/png;base64,${base64}`;
    });
    const scratch = document.createElement("canvas");
    scratch.width = img.width;
    scratch.height = img.height;
    const ctx = scratch.getContext("2d");
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, scratch.width, scratch.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      if (r > 210 && g < 90 && b < 90 && a > 180) count++;
    }
    return count;
  }, image.toString("base64"));
}

import { SIM_VERSION } from "../../src/sim/constants";
import { CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN } from "../../src/sim/design";
import {
  applyAction,
  createMine,
  DEFAULT_GEAR,
  ELEVATOR_COL,
  ELEVATOR_SEGMENT_ROWS,
  exportDiff,
  MINE_VERSION,
  type MineAction,
  returnEnergyCost,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
} from "../../src/sim/mine";

test("arena page renders a moving match (Rule 10 motion QA)", async ({
  page,
}) => {
  await page.goto("/arena");

  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  // The match HUD must render alongside the arena.
  await expect(page.getByText("Brawler", { exact: true })).toBeVisible();
  await expect(page.getByText("Rammer", { exact: true })).toBeVisible();

  // Every entered screen returns to the mine hub (the top nav is gone).
  await expect(page.getByRole("link", { name: "Back to mine" })).toBeVisible();

  const stage = page.locator("[data-sim-tick]");
  await expect
    .poll(async () => Number(await stage.getAttribute("data-sim-tick")), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  await expect(stage).toHaveAttribute("data-camera-mode", "cinematic-follow");
  await expect
    .poll(async () => await stage.getAttribute("data-bots-in-frame"), {
      timeout: 15_000,
    })
    .toBe("true");

  const tickBefore = Number(await stage.getAttribute("data-sim-tick"));
  const cameraBefore = await stage.evaluate((el) => ({
    distance: Number(el.getAttribute("data-camera-distance")),
    screenX: Number(el.getAttribute("data-bot0-screen-x")),
    targetX: Number(el.getAttribute("data-camera-target-x")),
    targetZ: Number(el.getAttribute("data-camera-target-z")),
  }));
  const shotBefore = await canvas.screenshot();

  await page.waitForTimeout(700);

  // Assumes the match outlasts the sample window (matches run ~60s and the
  // test samples within the first seconds). If tuning ever makes matches end
  // near-instantly, the exhibition restart resets the tick and this flakes.
  const tickAfter = Number(await stage.getAttribute("data-sim-tick"));
  const shotAfter = await canvas.screenshot();

  // The sim tick must advance and the visible pixels must actually change.
  expect(tickAfter).toBeGreaterThan(tickBefore);
  const cameraAfter = await stage.evaluate((el) => ({
    distance: Number(el.getAttribute("data-camera-distance")),
    screenX: Number(el.getAttribute("data-bot0-screen-x")),
    targetX: Number(el.getAttribute("data-camera-target-x")),
    targetZ: Number(el.getAttribute("data-camera-target-z")),
  }));
  const cameraDelta =
    Math.abs(cameraAfter.distance - cameraBefore.distance) +
    Math.abs(cameraAfter.screenX - cameraBefore.screenX) +
    Math.abs(cameraAfter.targetX - cameraBefore.targetX) +
    Math.abs(cameraAfter.targetZ - cameraBefore.targetZ);
  expect(cameraDelta).toBeGreaterThan(0.01);
  expect(await stage.getAttribute("data-bots-in-frame")).toBe("true");
  expect(Buffer.compare(shotBefore, shotAfter)).not.toBe(0);
});

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

test("mine shows a moving loader and retry when the world stalls", async ({
  page,
}) => {
  const mine = createMine(9191, DEFAULT_GEAR, STARTING_CONSUMABLES);
  let retryReady = false;
  await page.route("**/api/mine/world", async (route) => {
    if (!retryReady) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeSlot: 1,
        seed: 9191,
        tripIndex: 0,
        diff: exportDiff(mine),
      }),
    });
  });
  await page.route("**/api/gear", async (route) => {
    if (!retryReady) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });

  await page.goto("/mine");
  const loader = page.getByRole("status").filter({
    hasText: "Opening the shaft",
  });
  await expect(loader).toBeVisible();
  const bit = page.locator("[data-mine-loader-bit]");
  const firstTransform = await bit.evaluate(
    (node) => getComputedStyle(node).transform,
  );
  await page.waitForTimeout(220);
  await expect
    .poll(() => bit.evaluate((node) => getComputedStyle(node).transform), {
      timeout: 2_000,
    })
    .not.toBe(firstTransform);

  const alert = page.getByRole("alert").filter({ hasText: "Mine signal lost" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Mine signal lost");
  await expect(alert).toContainText("Your save was not changed");

  retryReady = true;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(alert).not.toBeVisible();
});

test("mine digs and tracks depth and energy", async ({ page }) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.locator("canvas")).toBeVisible();
  // The HUD exposes the sim numbers as data attributes (REQ-024): the
  // chip copy can change, the test surface cannot.
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");
  await expect(status).toHaveAttribute("data-horizontal-distance", "0");
  await expect(status).toContainText("Depth 0");
  await expect(status).toContainText("Base 0");
  await expect(status).toContainText("Topsoil");
  // The wallet is always on the HUD now (exposed for tests; empty when
  // storage is offline, a number otherwise).
  expect(await status.getAttribute("data-wallet")).not.toBeNull();

  await pressMineKey(page, "ArrowRight");
  await expect(status).toHaveAttribute("data-horizontal-distance", "1");
  await expect(status).toContainText("Base +1");
  await page.waitForTimeout(650);
  await pressMineKey(page, "ArrowLeft");
  await expect(status).toHaveAttribute("data-horizontal-distance", "0");

  // Blocks soak multiple swings now (REQ-013); dig through row 1.
  await digTo(page, 1);
  await expect(status).toHaveAttribute("data-depth", "1");
  await expect(status).toContainText("Depth 1");
  // The block's swing total preserves the old economy: a dirt or ore
  // block costs 1.0 in total (a rare cache costs 1.5).
  const energy = Number(await status.getAttribute("data-energy"));
  expect(energy).toBeLessThanOrEqual(59.0);
  expect(energy).toBeGreaterThanOrEqual(58.5);
  // The climb estimate prices ladders as well as energy (REQ-020).
  await expect(status).toHaveAttribute("data-climb-ladders", "1");
  const jumpJets = page.getByRole("button", { name: "Jump jets" });
  await expect(jumpJets).toBeVisible();
  await expect(jumpJets).toBeEnabled();
  const settingsButton = page.getByRole("button", { name: "Open settings" });
  await settingsButton.focus();
  await page.keyboard.press("Space");
  const settingsPanel = page.getByRole("region", { name: "Settings" });
  await expect(settingsPanel).toBeVisible();
  await expect(status).toHaveAttribute("data-depth", "1");
  await settingsButton.click();
  await expect(settingsPanel).not.toBeVisible();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  // Climbing out consumes a provisioned ladder (REQ-020).
  // digTo returns as soon as depth updates, so wait through the level 1
  // action cadence before sending the climb key.
  await page.waitForTimeout(650);
  await pressMineKey(page, "ArrowUp");
  await expect(status).toHaveAttribute("data-depth", "0");
  // Banking on the surface recharges the robot battery.
  await expect(status).toHaveAttribute("data-energy", "60.0");

  // Consumable controls exist even when empty (REQ-016); a scripted
  // edit once shipped without them, so the smoke pins their presence.
  const dynamiteButton = page.getByRole("button", {
    name: /Dynamite .*\(\d+\)/,
  });
  await expect(dynamiteButton).toBeVisible();
  await dynamiteButton.click();
  await expect(
    page.getByRole("menu", { name: "Dynamite tiers" }),
  ).toBeVisible();
  for (const name of [/T1 Pulse/, /T2 Bore/, /T3 Block/, /T4 Lamp wipe/]) {
    await expect(page.getByRole("menuitemradio", { name })).toBeVisible();
  }
  await page.getByRole("menuitemradio", { name: /T4 Lamp wipe/ }).click();
  await expect(
    page.getByText("Locked. Buy this dynamite tier at the Upgrades stall."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Deploy tier 4 dynamite" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Recovery options" }).click();
  await expect(
    page.getByRole("menuitem", { name: /Recall \(\d+, range \d+\)/ }),
  ).toBeVisible();
  const placePlankLeft = page.getByRole("button", {
    name: "Place plank left",
  });
  const placePlankRight = page.getByRole("button", {
    name: "Place plank right",
  });
  await expect(placePlankLeft).toBeVisible();
  await expect(placePlankRight).toBeVisible();
  await expect(placePlankLeft).toBeDisabled();
  await expect(placePlankRight).toBeDisabled();
  const jumpBox = await jumpJets.boundingBox();
  const plankBox = await placePlankLeft.boundingBox();
  expect(jumpBox?.width).toBeGreaterThan(plankBox?.width ?? 0);
  expect(jumpBox?.height).toBeGreaterThan(plankBox?.height ?? 0);
  const viewport = page.viewportSize();
  expect(jumpBox?.x ?? 0).toBeGreaterThan((viewport?.width ?? 0) * 0.65);
  expect(jumpBox?.y ?? 0).toBeGreaterThan((viewport?.height ?? 0) * 0.32);
  expect((jumpBox?.y ?? 0) + (jumpBox?.height ?? 0)).toBeLessThan(
    (plankBox?.y ?? 0) - 12,
  );
  const bottomCenterHit = await page.evaluate(() => {
    const target = document.elementFromPoint(
      window.innerWidth / 2,
      window.innerHeight - 32,
    );
    return {
      label: target?.getAttribute("aria-label") ?? null,
      mineShell: target
        ?.closest("[data-mine-shell='true']")
        ?.getAttribute("data-mine-shell"),
    };
  });
  expect(bottomCenterHit.label).not.toBe("Jump jets");
  expect(bottomCenterHit.label).not.toBe("Dig controls");
  expect(bottomCenterHit.mineShell).toBe("true");
  await expect(
    page.getByRole("button", { name: "Scrap placed supports" }),
  ).toBeVisible();
  await expect(status).toHaveAttribute("data-ladders", /\d+/);
});

test("dirt cracks grow before a heavy break burst", async ({ page }) => {
  const seed = 2026062102;
  const mine = createMine(seed, DEFAULT_GEAR, STARTING_CONSUMABLES);
  setCell(mine, START_COL, 1, { kind: "dirt" });
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeSlot: 1,
        seed,
        tripIndex: 0,
        diff: exportDiff(mine),
      }),
    });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  await pressMineKey(page, "ArrowDown");
  let firstCracks = 0;
  await expect
    .poll(
      async () => {
        firstCracks = Number(
          await canvas.getAttribute("data-crack-segment-count"),
        );
        return firstCracks;
      },
      { timeout: 3_000 },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(650);

  await pressMineKey(page, "ArrowDown");
  await expect
    .poll(
      async () => Number(await canvas.getAttribute("data-crack-segment-count")),
      { timeout: 3_000 },
    )
    .toBeGreaterThan(firstCracks);
  await page.waitForTimeout(650);

  await pressMineKey(page, "ArrowDown");
  await page.waitForTimeout(650);
  await pressMineKey(page, "ArrowDown");
  await expect
    .poll(
      async () => Number(await canvas.getAttribute("data-particle-count")),
      { timeout: 3_000 },
    )
    .toBeGreaterThanOrEqual(30);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "1",
  );
});

test("mine low battery and ladder warnings pulse on screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 640 });
  const gear = DEFAULT_GEAR;
  const consumables = { ...STARTING_CONSUMABLES, ladder: 0 };
  const seed = 2026062001;
  const baseMine = createMine(seed, gear, consumables);
  for (let row = 1; row <= 54; row++) {
    setCell(baseMine, START_COL, row, { kind: "dirt" });
  }
  const baseDiff = exportDiff(baseMine);
  const replayMine = createMine(seed, gear, consumables, baseDiff);
  const moves: MineAction[] = [];
  for (let i = 0; i < 240; i++) {
    const result = applyAction(replayMine, "down");
    if (result.ok) moves.push("down");
    const batteryLow =
      replayMine.miner.row > 0 &&
      replayMine.miner.energy < returnEnergyCost(replayMine.miner) * 1.25 + 2;
    if (batteryLow) break;
  }
  expect(replayMine.miner.row).toBeGreaterThanOrEqual(30);
  expect(replayMine.miner.energy).toBeGreaterThan(0);

  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables,
      baseDiff,
      moves,
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-battery-low", "true");
  await expect(status).toHaveAttribute("data-ladder-short", "true");
  await expect(status.locator("[data-battery-chip='true']")).toContainText(
    "Low",
  );
  await expect(page.locator("[data-ladder-chip='true']")).toContainText(
    "needed",
  );

  const edgeWarning = page.locator("[data-battery-edge-warning='true']");
  await expect(edgeWarning).toBeVisible();
  const firstFrame = await page.screenshot();
  await page.waitForTimeout(430);
  const secondFrame = await page.screenshot();
  const firstRedPixels = await countRedPixels(page, firstFrame);
  const secondRedPixels = await countRedPixels(page, secondFrame);
  expect(Math.abs(firstRedPixels - secondRedPixels)).toBeGreaterThan(120);
});

test("mine bunker builder starts a Clanker raid", async ({ page }) => {
  const bunkerView = {
    bunker: {
      footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
      core: { col: START_COL, row: 3, durability: 160 },
      parts: [
        {
          partId: "wall-panel",
          col: START_COL - 3,
          row: 1,
          durability: 90,
        },
      ],
    },
    inventory: {
      "wall-panel": 2,
      "floor-panel": 3,
      "roof-panel": 3,
      "door-panel": 1,
      "basic-turret": 0,
      "floor-spikes": 0,
    },
    activeRaid: null,
    player: {
      balance: 120,
      trackXp: 40,
      defenseXp: 120,
      overallLevel: 2,
      levelCap: 100,
      progressXp: 20,
      neededXp: 80,
      nextLevelXp: 200,
      beaconLimit: 3,
    },
  };
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(bunkerView),
    });
  });
  await page.route("**/api/bunker/raid/start", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...bunkerView,
        activeRaid: {
          raidId: "raid-smoke",
          tier: 1,
          durationSeconds: 180,
          startedAtMs: Date.now(),
          clankers: [
            {
              id: "clanker-1",
              col: START_COL - 6,
              row: 0,
              targetCol: START_COL - 3,
              targetRow: 1,
              batterySteps: 9,
              deathStep: 4,
              status: "self-destructed",
              path: [
                { col: START_COL - 6, row: 0 },
                { col: START_COL - 5, row: 0 },
                { col: START_COL - 4, row: 0 },
                { col: START_COL - 3, row: 0 },
                { col: START_COL - 3, row: 1 },
              ],
            },
          ],
          turretShots: 0,
          turretDamage: 0,
          spikeTriggers: 0,
          spikeDamage: 0,
          totalPartDurability: 90,
          incomingDamage: 40,
          partDamage: [
            {
              clankerId: "clanker-1",
              col: START_COL - 3,
              row: 1,
              target: "part",
              partId: "wall-panel",
              damage: 40,
            },
          ],
          coreDamage: 0,
          xpPickups: [
            {
              id: "clanker-1-xp",
              col: START_COL - 3,
              row: 1,
              defenseXp: 25,
              collected: false,
            },
          ],
          allClankersDead: true,
          breached: false,
          minerKilled: false,
          survived: true,
          reward: { vibes: 30, defenseXp: 25 },
        },
        raid: {
          raidId: "raid-smoke",
          tier: 1,
          durationSeconds: 180,
          startedAtMs: Date.now(),
          clankers: [],
          turretShots: 0,
          turretDamage: 0,
          spikeTriggers: 0,
          spikeDamage: 0,
          totalPartDurability: 90,
          incomingDamage: 40,
          partDamage: [],
          coreDamage: 0,
          xpPickups: [],
          allClankersDead: true,
          breached: false,
          minerKilled: false,
          survived: true,
          reward: { vibes: 30, defenseXp: 25 },
        },
      }),
    });
  });
  await page.route("**/api/bunker/raid/collect", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(bunkerView),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);
  await page.getByRole("button", { name: "Open bunker builder" }).click();
  const builder = page.getByRole("region", { name: "Bunker builder" });
  await expect(builder).toBeVisible();
  await expect(builder.getByLabel("Player level progress")).toContainText(
    "Player level 2/100",
  );
  await expect(builder.getByLabel("Player level progress")).toContainText(
    "Beacon cap 3",
  );
  await expect(builder).toContainText("Wall x2");
  await expect(builder).toContainText("Floor x3");
  await expect(builder).toContainText("Roof x3");
  await builder.getByRole("button", { name: "Start Clanker raid" }).click();
  await page.getByRole("button", { name: "Open bunker builder" }).click();
  await expect(builder).toBeVisible();
  await expect(builder).toContainText("1 Clanker dead");
  await expect(builder).toContainText("Walk over 25 defense XP on the ground");
  await expect(
    builder.getByRole("button", { name: "Walk over raid XP" }),
  ).toBeVisible();
});

test("mine bunker builder explains miner death after an open Clanker path", async ({
  page,
}) => {
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bunker: {
          footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
          core: { col: START_COL, row: 3, durability: 128 },
          parts: [
            {
              partId: "wall-panel",
              col: START_COL - 3,
              row: 1,
              durability: 90,
            },
          ],
        },
        inventory: {
          "wall-panel": 2,
          "floor-panel": 3,
          "roof-panel": 3,
          "door-panel": 1,
          "basic-turret": 0,
          "floor-spikes": 0,
        },
        activeRaid: {
          raidId: "raid-failed-smoke",
          tier: 1,
          durationSeconds: 3,
          startedAtMs: Date.now() - 3000,
          clankers: [
            {
              id: "clanker-1",
              col: START_COL - 6,
              row: 0,
              targetCol: START_COL,
              targetRow: 3,
              batterySteps: 9,
              deathStep: 8,
              status: "self-destructed",
              path: [
                { col: START_COL - 6, row: 0 },
                { col: START_COL - 5, row: 0 },
                { col: START_COL - 4, row: 0 },
                { col: START_COL - 3, row: 0 },
                { col: START_COL - 2, row: 0 },
                { col: START_COL - 2, row: 1 },
                { col: START_COL - 1, row: 1 },
                { col: START_COL, row: 1 },
                { col: START_COL, row: 2 },
                { col: START_COL, row: 3 },
              ],
            },
          ],
          turretShots: 0,
          turretDamage: 0,
          spikeTriggers: 0,
          spikeDamage: 0,
          totalPartDurability: 90,
          incomingDamage: 32,
          partDamage: [
            {
              clankerId: "clanker-1",
              col: START_COL,
              row: 3,
              target: "core",
              damage: 32,
            },
          ],
          coreDamage: 32,
          xpPickups: [],
          allClankersDead: true,
          breached: true,
          minerKilled: true,
          survived: false,
          reward: { vibes: 0, defenseXp: 0 },
        },
        player: {
          balance: 120,
          trackXp: 40,
          defenseXp: 120,
          overallLevel: 2,
          levelCap: 100,
          progressXp: 20,
          neededXp: 80,
          nextLevelXp: 200,
          beaconLimit: 3,
        },
      }),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);
  await page.getByRole("button", { name: "Open bunker builder" }).click();
  const builder = page.getByRole("region", { name: "Bunker builder" });
  await expect(builder).toContainText("Miner killed");
  await expect(builder).toContainText("Clankers follow open bunker cells");
  await expect(builder).toContainText("Fully enclose the player cell");
});

test("mine requires an explicit bunker claim mode before showing the claim panel", async ({
  page,
}) => {
  await installGamepadBackControl(page);
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bunker: null,
        inventory: {
          "wall-panel": 2,
          "floor-panel": 3,
          "roof-panel": 3,
          "door-panel": 1,
          "basic-turret": 0,
          "floor-spikes": 0,
        },
        activeRaid: null,
        player: {
          balance: 120,
          trackXp: 0,
          defenseXp: 0,
          overallLevel: 1,
          levelCap: 100,
          progressXp: 0,
          neededXp: 100,
          nextLevelXp: 100,
          beaconLimit: 2,
        },
      }),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);

  const builder = page.getByRole("region", { name: "Bunker builder" });
  await expect(builder).not.toBeVisible();
  const claimButton = page.getByRole("button", { name: "Start bunker claim" });
  await expect(claimButton).toBeVisible();
  const claimButtonBox = await claimButton.boundingBox();
  const viewport = page.viewportSize();
  if (!claimButtonBox || !viewport) {
    throw new Error("claim button position could not be measured");
  }
  expect(claimButtonBox.y + claimButtonBox.height).toBeLessThan(
    viewport.height - 128,
  );
  await claimButton.click();
  await expect(builder).toBeVisible();
  await expect(builder.getByLabel("Player level progress")).toContainText(
    "Player level 1/100",
  );
  await expect(
    builder.getByRole("button", { name: "Claim 7x5 bunker" }),
  ).toBeVisible();
  await pressGamepadBack(page);
  await expect(builder).not.toBeVisible();
  await expect(claimButton).toBeVisible();
  await claimButton.click();
  await expect(builder).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(builder).not.toBeVisible();
  await expect(claimButton).toBeVisible();
  await claimButton.click();
  await expect(builder).toBeVisible();
  await builder.getByRole("button", { name: "Cancel claim" }).click();
  await expect(builder).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start bunker claim" }),
  ).toBeVisible();
});

test("bunker claim mode highlights uncleared claim cells in red", async ({
  page,
}) => {
  const mine = createMine(6060, DEFAULT_GEAR, STARTING_CONSUMABLES);
  for (let row = 1; row <= 6; row++) {
    setCell(mine, START_COL, row, { kind: "empty", ladder: true });
  }
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeSlot: 1,
        seed: 6060,
        tripIndex: 0,
        diff: exportDiff(mine),
      }),
    });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bunker: null,
        inventory: {
          "wall-panel": 2,
          "floor-panel": 3,
          "roof-panel": 3,
          "door-panel": 1,
          "basic-turret": 0,
          "floor-spikes": 0,
        },
        activeRaid: null,
        player: {
          balance: 120,
          trackXp: 0,
          defenseXp: 0,
          overallLevel: 1,
          levelCap: 2,
          progressXp: 0,
          neededXp: 100,
          nextLevelXp: 100,
          beaconLimit: 2,
        },
      }),
    });
  });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem(
        "vibebots-mine-trip-v2-slot-1",
        JSON.stringify(trip),
      );
    },
    {
      seed: 6060,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down", "down", "down", "down", "down", "down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "6",
  );

  await page.getByRole("button", { name: "Start bunker claim" }).click();
  const builder = page.getByRole("region", { name: "Bunker builder" });
  await expect(builder).toContainText(/Clear \d+ red cells/);
  await expect(
    builder.getByRole("button", { name: "Claim 7x5 bunker" }),
  ).toBeDisabled();

  const redPixels = await countRedPixels(
    page,
    await page.locator("canvas").screenshot(),
  );
  expect(redPixels).toBeGreaterThan(50);
});

test("bunker claims can be edited before banking", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  const mine = createMine(6061, DEFAULT_GEAR, STARTING_CONSUMABLES);
  for (let row = 1; row <= 6; row++) {
    for (let col = START_COL - 3; col <= START_COL + 3; col++) {
      setCell(mine, col, row, { kind: "empty" });
    }
    setCell(mine, START_COL, row, { kind: "empty", ladder: true });
  }
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeSlot: 1,
        seed: 6061,
        tripIndex: 0,
        diff: exportDiff(mine),
      }),
    });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bunker: null,
        inventory: {
          "wall-panel": 2,
          "floor-panel": 3,
          "roof-panel": 3,
          "door-panel": 1,
          "basic-turret": 0,
          "floor-spikes": 0,
        },
        activeRaid: null,
        player: {
          balance: 120,
          trackXp: 0,
          defenseXp: 0,
          overallLevel: 1,
          levelCap: 2,
          progressXp: 0,
          neededXp: 100,
          nextLevelXp: 100,
          beaconLimit: 2,
        },
      }),
    });
  });
  await page.addInitScript(
    (trip) => {
      const key = "vibebots-mine-trip-v2-slot-1";
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(trip));
      }
    },
    {
      seed: 6061,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down", "down", "down", "down", "down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "5",
  );

  await page.getByRole("button", { name: "Start bunker claim" }).click();
  const builder = page.getByRole("region", { name: "Bunker builder" });
  await expect(builder).toContainText(
    "Ready to claim. Build now, then bank at surface to save.",
  );
  await builder.getByRole("button", { name: "Claim 7x5 bunker" }).click();
  await expect(builder.getByRole("button", { name: "Wall x2" })).toBeVisible();
  const builderBox = await builder.boundingBox();
  expect(builderBox?.height ?? 999).toBeLessThanOrEqual(260);
  expect(builderBox?.y ?? 0).toBeGreaterThan(360);
  const modeGroup = builder.getByLabel("Build mode");
  const partsGroup = builder.getByLabel("Base parts");
  await expect(modeGroup).toBeVisible();
  await expect(partsGroup).toBeVisible();
  const placeMode = modeGroup.getByRole("button", { name: "Place" });
  const removeMode = modeGroup.getByRole("button", { name: "Remove" });
  const moveMode = modeGroup.getByRole("button", { name: "Move", exact: true });
  await expect(placeMode).toHaveAttribute("aria-pressed", "true");
  await expect(removeMode).toHaveAttribute("aria-pressed", "false");
  await expect(moveMode).toHaveAttribute("aria-pressed", "false");
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  const placePoint = {
    x: box.x + box.width / 2 + 56,
    y: box.y + box.height / 2,
  };
  await page.mouse.click(placePoint.x, placePoint.y);
  await expect(builder.getByRole("button", { name: "Wall x1" })).toBeVisible();
  const firstPart = await page.evaluate(() => {
    const trip = JSON.parse(
      localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
    );
    return trip.pendingBunker?.bunker.parts[0] ?? null;
  });
  expect(firstPart).toMatchObject({ partId: "wall-panel" });
  await removeMode.click();
  await expect(removeMode).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(placePoint.x, placePoint.y);
  await expect(builder.getByRole("button", { name: "Wall x2" })).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const trip = JSON.parse(
            localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
          );
          return trip.pendingBunker?.bunker.parts.length ?? 0;
        }),
      { timeout: 3_000 },
    )
    .toBe(0);
  await placeMode.click();
  await page.mouse.click(placePoint.x, placePoint.y);
  await expect(builder.getByRole("button", { name: "Wall x1" })).toBeVisible();
  await moveMode.click();
  await page.mouse.move(placePoint.x, placePoint.y);
  await page.mouse.down();
  await page.mouse.move(placePoint.x + 112, placePoint.y, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const trip = JSON.parse(
            localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
          );
          return trip.pendingBunker?.bunker.parts[0] ?? null;
        }),
      { timeout: 3_000 },
    )
    .toMatchObject({
      partId: "wall-panel",
      col: firstPart.col + 1,
      row: firstPart.row,
    });
  await builder.getByRole("button", { name: "Walk up" }).click();
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "4",
  );
  await expect(builder).toBeVisible();
  await page.reload();
  await dismissReleaseNotes(page);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "4",
  );
  await expect(
    page.getByRole("region", { name: "Bunker builder" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open bunker builder" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open bunker builder" }).click();
  const reopenedBuilder = page.getByRole("region", { name: "Bunker builder" });
  await expect(reopenedBuilder).toBeVisible();
  const raidButton = reopenedBuilder.getByRole("button", {
    name: "Start Clanker raid",
  });
  await expect(raidButton).toBeDisabled();
  await expect(reopenedBuilder).toContainText(
    "Raids unlock after the bunker saves at the surface.",
  );
});

test("fatal free fall stays on camera until impact", async ({ page }) => {
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  const mine = createMine(6161, DEFAULT_GEAR, STARTING_CONSUMABLES);
  for (let row = 1; row <= 6; row++) {
    setCell(mine, START_COL, row, { kind: "empty" });
  }
  setCell(mine, START_COL, 7, { kind: "dirt" });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 6161,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: [],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByRole("button", { name: "Jump jets" })).toHaveCount(0);

  const beforeFallShot = await canvas.screenshot();
  await pressMineKey(page, "ArrowDown");
  await expect
    .poll(async () => canvas.getAttribute("data-fall-visual-active"), {
      timeout: 5_000,
    })
    .toBe("true");
  await expect
    .poll(
      async () => Number(await canvas.getAttribute("data-rendered-cell-count")),
      {
        timeout: 5_000,
      },
    )
    .toBeGreaterThan(20);
  const fallActiveShot = await canvas.screenshot();
  expect(Buffer.compare(beforeFallShot, fallActiveShot)).not.toBe(0);

  const report = page.getByRole("button", { name: "Dismiss trip report" });
  await expect(report).toBeVisible({ timeout: 15_000 });
  await expect(report).toContainText("Fell too far");
  await expect(report).not.toContainText("Crushed by falling rock");
  await expect(page.getByRole("button", { name: "Jump jets" })).toHaveCount(0);
});

test("mine shows the needed pickaxe level on gated rock hits", async ({
  page,
}) => {
  const mine = createMine(6261, DEFAULT_GEAR, STARTING_CONSUMABLES);
  setCell(mine, START_COL, 1, { kind: "rock", rockTier: 1 });
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      json: {
        activeSlot: 1,
        seed: 6261,
        tripIndex: 0,
        diff: exportDiff(mine),
      },
    });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: {
        gear: DEFAULT_GEAR,
        consumables: STARTING_CONSUMABLES,
        balance: 0,
      },
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.locator("canvas")).toBeVisible();
  await pressMineKey(page, "ArrowDown");

  const hint = page.locator(".mine-pickaxe-gate-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("Pickaxe level 2 needed");
  await expect(hint).toHaveCSS("pointer-events", "none");
  await expect(hint).toBeHidden({ timeout: 3_000 });
});

test("falling-rock crush stays on camera before the report", async ({
  page,
}) => {
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  const gear = { ...DEFAULT_GEAR, pickaxe: 4, fall: 5 };
  const mine = createMine(6262, gear, STARTING_CONSUMABLES);
  const c = START_COL;
  for (let row = 1; row <= 6; row++) {
    setCell(mine, c, row, { kind: "empty" });
  }
  setCell(mine, c, 7, { kind: "dirt" });
  setCell(mine, c + 1, 5, { kind: "rock", rockTier: 1 });
  setCell(mine, c + 1, 6, { kind: "dirt" });
  setCell(mine, c + 1, 7, { kind: "dirt" });
  setCell(mine, c + 1, 8, { kind: "dirt" });
  setCell(mine, c + 1, 9, { kind: "dirt" });
  setCell(mine, c + 4, 9, { kind: "part-cache" });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-falling-rock-alert-dismissed", "true");
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 6262,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  const status = page.getByLabel("Mine status");
  await pressMineKey(page, "ArrowRight");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 5_000,
    })
    .toBeGreaterThan(0.5);
  await pressMineKey(page, "ArrowDown");
  await expect
    .poll(async () => status.getAttribute("data-depth"), { timeout: 5_000 })
    .toBe("7");
  const beforeCrushShot = await canvas.screenshot();
  let firstActiveFrame: { camY: number; minerY: number } | null = null;
  for (let attempt = 0; attempt < 4 && !firstActiveFrame; attempt++) {
    await pressMineKey(page, "ArrowDown");
    for (let i = 0; i < 60; i++) {
      const active = await canvas.getAttribute("data-fall-visual-active");
      if (active === "true") {
        firstActiveFrame = {
          camY: Number(await canvas.getAttribute("data-cam-y")),
          minerY: Number(await canvas.getAttribute("data-miner-y")),
        };
        break;
      }
      await page.waitForTimeout(16);
    }
  }
  expect(firstActiveFrame).not.toBeNull();
  expect(firstActiveFrame?.camY).toBeLessThan(-7);
  expect(firstActiveFrame?.minerY).toBeLessThan(-7);
  await expect(
    page.getByRole("button", { name: "Dismiss trip report" }),
  ).not.toBeVisible();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-y")), {
      timeout: 5_000,
    })
    .toBeLessThan(-7);
  await expect
    .poll(
      async () => Number(await canvas.getAttribute("data-rendered-cell-count")),
      {
        timeout: 5_000,
      },
    )
    .toBeGreaterThan(20);
  await expect
    .poll(async () => canvas.getAttribute("data-fall-visual-impact"), {
      timeout: 5_000,
    })
    .toBe("true");
  const activeCrushShot = await canvas.screenshot();
  expect(Buffer.compare(beforeCrushShot, activeCrushShot)).not.toBe(0);

  const report = page.getByRole("button", { name: "Dismiss trip report" });
  await expect(report).toBeVisible({ timeout: 15_000 });
  await expect(report).toContainText("Crushed by falling rock");
  await expect(report).toContainText("where the rock fell");
  await expect(report).not.toContainText("battery died");
  await expect(canvas).toHaveAttribute("data-fall-visual-active", "true");
  expect(Number(await canvas.getAttribute("data-cam-y"))).toBeLessThan(-7);
  expect(
    Number(await canvas.getAttribute("data-rendered-cell-count")),
  ).toBeGreaterThan(20);
});

test("scrap selection outlines selected cells in red", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  const mine = createMine(7171, DEFAULT_GEAR, STARTING_CONSUMABLES);
  setCell(mine, START_COL, 1, { kind: "empty", ladder: true });
  setCell(mine, START_COL + 1, 1, { kind: "empty", plank: true });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 7171,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Scrap placed supports" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Scrap placed supports" }).click();
  const salvage = page.getByRole("region", { name: "Scrap mode" });
  await expect(salvage).toBeVisible();
  await expectRegionHorizontalBounds(page, "Scrap mode");
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const clickUntilSelected = async (expectedCount: number) => {
    const xPoints = [0.32, 0.42, 0.5, 0.58, 0.68].map((x) => x * box.width);
    const yPoints = [0.42, 0.5, 0.58, 0.66, 0.74, 0.82].map(
      (y) => y * box.height,
    );
    for (const y of yPoints) {
      for (const x of xPoints) {
        await canvas.click({ position: { x, y }, force: true });
        const text = await salvage.textContent();
        if (text?.includes(`${expectedCount} selected`)) return;
      }
    }
    throw new Error(`Could not select ${expectedCount} scrap target(s)`);
  };

  await clickUntilSelected(1);
  await expect(salvage).toContainText("1 selected");
  await expectRegionHorizontalBounds(page, "Scrap mode");

  const after = await canvas.screenshot();
  const selectedRedPixels = await countRedPixels(page, after);
  expect(selectedRedPixels).toBeGreaterThan(
    (await countRedPixels(page, before)) + 80,
  );

  await salvage.getByRole("button", { name: "Confirm scrap" }).click();
  await expect(salvage).toHaveCount(0);
  const cleared = await canvas.screenshot();
  expect(await countRedPixels(page, cleared)).toBeLessThan(
    selectedRedPixels - 80,
  );
});

test("scrap mode closes bunker claim overlays", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  const mine = createMine(7173, DEFAULT_GEAR, STARTING_CONSUMABLES);
  setCell(mine, START_COL, 1, { kind: "empty", ladder: true });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 7173,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Start bunker claim" }).click();
  await expect(
    page.getByRole("region", { name: "Bunker builder" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Scrap placed supports" }).click();
  await expect(
    page.getByRole("region", { name: "Bunker builder" }),
  ).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Scrap mode" })).toBeVisible();
});

test("standing on a ladder uses scrap mode for removal", async ({ page }) => {
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  const mine = createMine(7172, DEFAULT_GEAR, STARTING_CONSUMABLES);
  setCell(mine, START_COL, 1, { kind: "empty", ladder: true });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 7172,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "1",
  );
  await expect(
    page.getByRole("button", { name: "Salvage ladder" }),
  ).toHaveCount(0);

  const scrapSupports = page.getByRole("button", {
    name: "Scrap placed supports",
  });
  await expect(scrapSupports).toBeEnabled();
  await scrapSupports.click();
  await expect(page.getByRole("region", { name: "Scrap mode" })).toBeVisible();
});

test("home redirects to the mine hub", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/mine$/);
});

test("village buildings enter the workshop and arena (REQ-021)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // The Workshop building stands left of the shaft; standing on it offers
  // an Enter prompt that routes there (not a stall sheet).
  await enterBuilding(page, "ArrowLeft", "Workshop");
  await expect(page).toHaveURL(/\/workshop$/);
  // The workshop returns to the mine hub.
  await page.getByRole("link", { name: "Back to mine" }).click();
  await expect(page).toHaveURL(/\/mine$/);

  // The Battles building stands right of the shaft. A fresh load resets the
  // miner to the shaft so the walk starts from a known spot.
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(status).toHaveAttribute("data-depth", "0");
  await enterBuilding(page, "ArrowRight", "Battles");
  await expect(page).toHaveURL(/\/arena$/);
});

test("surface base indicator offers a paid return", async ({ page }) => {
  let chargedCost = 0;
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: {
        gear: DEFAULT_GEAR,
        consumables: STARTING_CONSUMABLES,
        balance: 6,
      },
    });
  });
  await page.route("**/api/mine/base-teleport", async (route) => {
    const body = route.request().postDataJSON() as { cost: number };
    chargedCost = body.cost;
    await route.fulfill({ json: { balance: 6 - body.cost } });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  const canvas = page.locator("canvas");
  await expect(status).toHaveAttribute("data-depth", "0");
  await expect(status).toHaveAttribute("data-wallet", "6");

  const indicator = await walkUntilBaseIndicator(page);
  await expect(indicator).toHaveAttribute("data-base-direction", "left");
  await indicator.click();

  const menu = page.getByRole("region", { name: "Base return" });
  await expect(menu).toBeVisible();
  const teleport = menu.getByRole("button");
  await expect(teleport).toContainText(/Teleport for \d+ vibes/);
  await expect(teleport).toBeEnabled();
  await teleport.click();
  await expect(teleport).toContainText("Confirm for");
  await expect(teleport).toHaveCSS("background-color", "rgb(74, 31, 40)");
  await expect(teleport).toHaveCSS("color", "rgb(255, 217, 217)");
  await teleport.click();

  await expect(page.locator(".mine-base-teleport-burst")).toBeVisible();
  await expect
    .poll(async () =>
      Math.abs(Number(await canvas.getAttribute("data-miner-x"))),
    )
    .toBeLessThan(0.6);
  await expect(indicator).not.toBeVisible();
  expect(chargedCost).toBeGreaterThanOrEqual(1);
  await expect(status).toHaveAttribute("data-wallet", String(6 - chargedCost));
});

test("surface base return skips checkpoint for a touched surface mine", async ({
  page,
}) => {
  let bankRequests = 0;
  let chargedCost = 0;
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: {
        gear: DEFAULT_GEAR,
        consumables: STARTING_CONSUMABLES,
        balance: 6,
      },
    });
  });
  await page.route("**/api/mine/bank", async (route) => {
    bankRequests++;
    await route.fulfill({ status: 500, json: { error: "unexpected bank" } });
  });
  await page.route("**/api/mine/base-teleport", async (route) => {
    const body = route.request().postDataJSON() as { cost: number };
    chargedCost = body.cost;
    await route.fulfill({ json: { balance: 6 - body.cost } });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  const canvas = page.locator("canvas");
  await expect(status).toHaveAttribute("data-depth", "0");

  await pressMineKey(page, "ArrowDown");
  await expect(status).toHaveAttribute("data-depth", "0");

  const indicator = await walkUntilBaseIndicator(page);
  await indicator.click();
  const teleport = page
    .getByRole("region", { name: "Base return" })
    .getByRole("button");
  await teleport.click();
  await expect(teleport).toContainText("Confirm for");
  await teleport.click();

  await expect
    .poll(async () =>
      Math.abs(Number(await canvas.getAttribute("data-miner-x"))),
    )
    .toBeLessThan(0.6);
  expect(bankRequests).toBe(0);
  expect(chargedCost).toBeGreaterThanOrEqual(1);
  await expect(status).toHaveAttribute("data-wallet", String(6 - chargedCost));
});

test("surface base return disables when vibes are short", async ({ page }) => {
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: {
        gear: DEFAULT_GEAR,
        consumables: STARTING_CONSUMABLES,
        balance: 0,
      },
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-wallet", "0");

  const indicator = await walkUntilBaseIndicator(page);
  await indicator.click();

  const menu = page.getByRole("region", { name: "Base return" });
  const teleport = menu.getByRole("button");
  await expect(teleport).toBeDisabled();
  await expect(teleport).toContainText("Need");
});

test("mine shows the latest release note once to a fresh browser", async ({
  page,
}) => {
  await page.goto("/mine");
  const dialog = page.getByRole("dialog", { name: "New in VibeBots" });
  await expect(dialog).toBeVisible();
  const version = await dialog.getAttribute("data-app-version");
  const noteId = await dialog.getAttribute("data-release-note-id");
  expect(version).toBeTruthy();
  expect(noteId).toBeTruthy();
  await expect(dialog).not.toContainText("Mason, load your first save now.");
  await expect(dialog).toContainText(
    "Bunker roof cells now sit cleanly together.",
  );
  await expect(dialog.locator("li")).toHaveCount(3);
  await expect(dialog.locator("li").first()).toContainText(
    "bounded gabled cells",
  );
  await expect(dialog.locator("li").nth(1)).toContainText(
    "eave, ridge, and shingle silhouette",
  );
  await expect(dialog.locator("li").nth(2)).toContainText(
    "three-roof starter-base layout",
  );

  await page.mouse.click(8, 8);
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("vibebots-release-notes-dismissed-id"),
    ),
  ).toBe(noteId);

  await page.reload();
  await expect(dialog).not.toBeVisible();

  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Release notes" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Release notes")).toBeVisible();
  const notes = dialog.locator("[data-release-note]");
  const recentReleaseNotes = [
    ["0.1.135", "Roof cell polish"],
    ["0.1.134", "Clanker visuals"],
    ["0.1.133", "Clanker open paths"],
    ["0.1.132", "Dirt break polish"],
    ["0.1.131", "Base part visuals"],
    ["0.1.130", "Raid XP pickups"],
    ["0.1.129", "Clanker raid damage"],
    ["0.1.128", "Lantern zoom overview fix"],
    ["0.1.127", "Bunker builder controls"],
    ["0.1.126", "Scrap selection cleanup"],
    ["0.1.125", "Terminal replay movement fix"],
    ["0.1.124", "Mine terminal state fix"],
    ["0.1.123", "Save touch diagnostics"],
    ["0.1.122", "Touch drag layer"],
    ["0.1.121", "Touch zoom lock"],
    ["0.1.120", "Underground bunker claims"],
    ["0.1.119", "Jump button placement"],
    ["0.1.118", "Visual viewport refresh"],
    ["0.1.117", "Jump Jets"],
    ["0.1.116", "Shop release copy"],
    ["0.1.115", "Clean shop layout"],
    ["0.1.114", "Shop button feedback"],
    ["0.1.113", "Scrap panel text bounds"],
    ["0.1.112", "Scrap language"],
    ["0.1.111", "Hardware Store copy"],
    ["0.1.110", "Mine death report"],
    ["0.1.109", "Mine refresh viewport lock"],
    ["0.1.108", "Mine warning visuals"],
    ["0.1.107", "Sheet drag dismiss"],
    ["0.1.106", "Mine refresh layout"],
    ["0.1.105", "Battle camera"],
    ["0.1.104", "Mine input cadence"],
    ["0.1.103", "Mine load fallback"],
    ["0.1.102", "Falling rock chains"],
    ["0.1.101", "Depot copy cleanup"],
    ["0.1.100", "Surface shop prompts"],
    ["0.1.99", "Meaningful mine zoom"],
    ["0.1.98", "Mine text and status layout"],
    ["0.1.97", "Credits"],
    ["0.1.96", "Menu outside taps"],
    ["0.1.95", "Death cam surface jump fix"],
    ["0.1.94", "Cargo hold rebalance"],
    ["0.1.93", "Pickaxe battery tuning"],
    ["0.1.92", "Recall rope range"],
    ["0.1.91", "Zoom placement fix"],
    ["0.1.90", "Save slot start safety"],
    ["0.1.89", "Bunker part drag"],
    ["0.1.88", "Death cam flash fix"],
    ["0.1.87", "Mine zoom buttons"],
    ["0.1.86", "Death cam fix"],
    ["0.1.85", "Save slot refresh"],
    ["0.1.84", "Upgrade rebalance"],
    ["0.1.83", "Beacon depth gate"],
    ["0.1.82", "Pickaxe gate hints"],
    ["0.1.81", "Bunker claim clarity"],
    ["0.1.80", "Bag stacks and ore rebalance"],
    ["0.1.79", "Stamp catalog refresh"],
    ["0.1.78", "Falling rock durability"],
    ["0.1.77", "Upward mining warning"],
    ["0.1.76", "Surface tip rotation"],
    ["0.1.75", "Mine performance samples"],
    ["0.1.74", "Stale trip recovery"],
    ["0.1.73", "Falling rock crush"],
    ["0.1.72", "Plank side buttons"],
    ["0.1.71", "Ore yield tuning"],
    ["0.1.70", "Biome portal beacons"],
    ["0.1.69", "Installed app refresh"],
    ["0.1.68", "Ladder removal cleanup"],
    ["0.1.67", "Release note accuracy"],
    ["0.1.66", "Bag drop controls"],
    ["0.1.65", "Tool satchel bag"],
    ["0.1.64", "Feedback window"],
    ["0.1.63", "Native release alerts"],
    ["0.1.62", "Refresh availability guard"],
    ["0.1.61", "Ladder gravity"],
    ["0.1.60", "Dismissible windows"],
    ["0.1.59", "Bunker claim HUD"],
    ["0.1.58", "Dropped bag gravity"],
    ["0.1.57", "Bag grid"],
    ["0.1.56", "Version refresh prompt"],
    ["0.1.55", "Mine metal floor"],
    ["0.1.54", "Death bag recovery"],
  ] as const;
  const renderedReleaseNotes = await notes.evaluateAll((items) =>
    items.map((item) => ({
      version: item.getAttribute("data-release-note"),
      text: item.textContent ?? "",
    })),
  );
  expect(renderedReleaseNotes.length).toBeGreaterThanOrEqual(
    recentReleaseNotes.length,
  );
  for (const [
    index,
    [noteVersion, noteTitle],
  ] of recentReleaseNotes.entries()) {
    expect(renderedReleaseNotes[index]).toMatchObject({
      version: noteVersion,
    });
    expect(renderedReleaseNotes[index]?.text).toContain(noteTitle);
  }
  await dialog.getByRole("button", { name: "Got it" }).click();
  await expect(dialog).not.toBeVisible();

  const settingsAgain = await openSettings(page);
  await expect(settingsAgain.getByLabel("Update alerts")).toBeVisible();
  await expect(
    settingsAgain.getByRole("button", { name: "Enable update alerts" }),
  ).toBeDisabled();
  await expect(settingsAgain).toContainText(
    /Notification keys are not set on this deploy\.|Notifications are blocked in browser settings\./,
  );
});

test("mine credits open from settings and pause mine movement", async ({
  page,
}) => {
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Credits" }).click();
  const dialog = page.getByRole("dialog", { name: "Credits" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Mason and MJ Lutcavich");
  await expect(dialog).toContainText("testing VibeBots");
  await expect(dialog).toContainText("feedback");
  await expect(dialog).toContainText("great ideas");

  const status = page.getByLabel("Mine status");
  const depthBefore = await status.getAttribute("data-depth");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(MINE_KEY_CADENCE_MS);
  await expect(status).toHaveAttribute("data-depth", depthBefore ?? "0");

  await page.mouse.click(8, 8);
  await expect(dialog).not.toBeVisible();

  const settingsAgain = await openSettings(page);
  await settingsAgain.getByRole("button", { name: "Credits" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("mine prompts to refresh when the deployed version changes", async ({
  page,
}) => {
  await installStandaloneVisualViewport(page);
  await speedUpVersionRefreshChecks(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "vibebots-release-notes-dismissed-id",
      "2026-06-20-0.1.123-save-touch-diagnostics",
    );
  });
  await page.route("**/api/version", async (route) => {
    await route.fulfill({ json: { version: "999.0.0-test" } });
  });
  await page.route("**/mine?vibebots_version_probe=*", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: '<span hidden data-vibebots-app-version="999.0.0-test"></span>',
    });
  });
  await page.goto("/mine");
  const dismissedBeforeRefresh = await page.evaluate(() =>
    localStorage.getItem("vibebots-release-notes-dismissed-id"),
  );
  expect(dismissedBeforeRefresh).toBeTruthy();

  const prompt = page.getByRole("dialog", {
    name: "New version available",
  });
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText(
    "Refresh to load the latest VibeBots build.",
  );
  await expect(prompt).toHaveAttribute(
    "data-version-refresh-prompt",
    "999.0.0-test",
  );
  await prompt.getByRole("button", { name: "Refresh" }).click();
  await page.waitForURL("**/mine?vibebots_refresh=999.0.0-test");
  const shell = page.locator("[data-mine-shell]");
  await expect(shell).toBeVisible();
  await expect(shell).toHaveAttribute("data-display-mode", "standalone");
  await expect(shell).toHaveAttribute("data-refresh-entry", "999.0.0-test");
  await expect(shell).toHaveAttribute("data-visual-viewport-top", "64.00");
  await expect(shell).toHaveAttribute("data-visual-viewport-height", "696.00");
  await expectMineShellViewportLocked(page);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("vibebots-release-notes-dismissed-id"),
    ),
  ).toBe(dismissedBeforeRefresh);
  await expect(
    page.getByRole("dialog", { name: "New in VibeBots" }),
  ).not.toBeVisible();
});

test("mine realigns installed app controls when the visual viewport changes", async ({
  page,
}) => {
  await installStandaloneVisualViewport(page);
  await page.goto("/mine");
  await dismissReleaseNotes(page);

  await expectMineShellViewportLocked(page);
  await page.evaluate(() => {
    const setVisualViewport = (
      window as typeof window & {
        __vibebotsSetVisualViewport?: (next: {
          height: number;
          offsetTop: number;
        }) => void;
      }
    ).__vibebotsSetVisualViewport;
    if (!setVisualViewport) {
      throw new Error("visual viewport test fixture was not installed");
    }
    setVisualViewport({ height: 668, offsetTop: 92 });
  });

  const shell = page.locator("[data-mine-shell]");
  await expect(shell).toHaveAttribute("data-display-mode", "standalone");
  await expect(shell).toHaveAttribute("data-visual-viewport-top", "92.00");
  await expect(shell).toHaveAttribute("data-visual-viewport-height", "668.00");
  await expectMineShellViewportLocked(page);
});

test("mine waits to show refresh prompt until the new page is refreshable", async ({
  page,
}) => {
  await speedUpVersionRefreshChecks(page);
  await page.route("**/api/version", async (route) => {
    await route.fulfill({ json: { version: "999.0.0-test" } });
  });
  await page.route("**/mine?vibebots_version_probe=*", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: '<span hidden data-vibebots-app-version="0.1.59.old"></span>',
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await page.waitForTimeout(120);

  await expect(
    page.getByRole("dialog", { name: "New version available" }),
  ).not.toBeVisible();
});

test("mine rechecks stale installed app shells when the app returns to foreground", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(
    page.getByRole("dialog", { name: "New version available" }),
  ).not.toBeVisible();

  const version = "999.0.1-test";
  await page.route("**/api/version", async (route) => {
    await route.fulfill({ json: { version } });
  });
  await page.route("**/mine?vibebots_version_probe=*", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<span hidden data-vibebots-app-version="${version}"></span>`,
    });
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    window.dispatchEvent(new Event("focus"));
  });

  await expect(
    page.getByRole("dialog", { name: "New version available" }),
  ).toBeVisible();
});

test("mine refresh prompt dismisses from an outside tap", async ({ page }) => {
  await speedUpVersionRefreshChecks(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "vibebots-release-notes-dismissed-id",
      "2026-06-20-0.1.113-scrap-panel-text-bounds",
    );
  });
  await page.route("**/api/version", async (route) => {
    await route.fulfill({ json: { version: "999.0.2-test" } });
  });
  await page.route("**/mine?vibebots_version_probe=*", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: '<span hidden data-vibebots-app-version="999.0.2-test"></span>',
    });
  });

  await page.goto("/mine");

  const prompt = page.getByRole("dialog", {
    name: "New version available",
  });
  await expect(prompt).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(prompt).not.toBeVisible();
});

test("mine asks mobile Safari users to add the Home Screen app for alerts", async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  await page.goto("/mine");
  await dismissReleaseNotes(page);

  const dialog = page.getByRole("dialog", {
    name: "Add VibeBots to Home Screen",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "Mobile Safari needs the Home Screen app before notifications can work.",
  );
  await expect(dialog).toContainText(
    "Safari does not let websites open that sheet automatically.",
  );

  await page.mouse.click(8, 8);
  await expect(dialog).not.toBeVisible();

  await page.reload();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Ok" }).click();
  await expect(dialog).not.toBeVisible();

  await page.reload();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Never show again" }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("vibebots-ios-home-screen-prompt-never"),
    ),
  ).toBe("1");

  await page.reload();
  await expect(dialog).not.toBeVisible();
  await context.close();
});

test("mine falling-rock alert can be dismissed or permanently hidden", async ({
  page,
}) => {
  await installGamepadBackControl(page);
  const gear = { ...DEFAULT_GEAR, pickaxe: 4, fall: 5 };
  const mine = createMine(8080, gear, STARTING_CONSUMABLES);
  const c = START_COL;
  for (let row = 1; row <= 6; row++) {
    setCell(mine, c, row, { kind: "empty" });
  }
  setCell(mine, c, 7, { kind: "dirt" });
  for (let dc = 1; dc <= 3; dc++) {
    setCell(mine, c + dc, 5, { kind: "rock", rockTier: 1 });
    setCell(mine, c + dc, 6, { kind: "dirt" });
    setCell(mine, c + dc, 7, { kind: "dirt" });
  }

  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 8080,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "6",
  );

  await pressMineKey(page, "ArrowRight");
  const alert = page.getByRole("dialog", { name: "Falling rock" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(
    "The miner must avoid being under the rock in the next 2 turns.",
  );
  await pressGamepadBack(page);
  await expect(alert).not.toBeVisible();

  await pressMineKey(page, "ArrowRight");
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "Never Show Again" }).click();
  await expect(alert).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("vibebots-falling-rock-alert-dismissed"),
      ),
    )
    .toBe("true");

  await page.reload();
  await dismissReleaseNotes(page);
  await pressMineKey(page, "ArrowRight");
  await expect(alert).not.toBeVisible();
});

test("upward mining warns when it starts a falling rock", async ({ page }) => {
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  const gear = { ...DEFAULT_GEAR, pickaxe: 4, fall: 5 };
  const mine = createMine(8180, gear, STARTING_CONSUMABLES);
  const c = START_COL - 1;
  for (let row = 1; row <= 9; row++) {
    setCell(mine, START_COL, row, { kind: "empty" });
  }
  setCell(mine, START_COL, 10, { kind: "dirt" });
  setCell(mine, c, 9, { kind: "empty" });
  setCell(mine, c, 10, { kind: "dirt" });
  setCell(mine, c, 8, { kind: "dirt" });
  setCell(mine, c, 7, { kind: "rock", rockTier: 1 });

  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-falling-rock-alert-dismissed", "true");
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      mineVersion: MINE_VERSION,
      seed: 8180,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down", "left"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  const status = page.getByLabel("Mine status");
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "9",
  );
  await expect(status).toHaveAttribute("data-ladders", "8");
  const before = await canvas.screenshot();
  await page.keyboard.down("ArrowUp");
  await expect
    .poll(async () => canvas.getAttribute("data-falling-rock-warning"), {
      timeout: 5_000,
    })
    .toBe("true");
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        repeat: true,
        bubbles: true,
      }),
    );
  });
  await page.waitForTimeout(120);
  await expect(status).toHaveAttribute("data-depth", "9");
  await expect(status).toHaveAttribute("data-ladders", "8");
  await page.keyboard.up("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(status).toHaveAttribute("data-depth", "8");
  await expect(status).toHaveAttribute("data-ladders", "7");
  const after = await canvas.screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);
  await expect(page.getByRole("dialog", { name: "Falling rock" })).toBeHidden();
});

test("mine feedback form submits from settings and closes with gamepad back", async ({
  page,
}) => {
  await installGamepadBackControl(page);
  let feedbackBody: unknown = null;
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/feedback", async (route) => {
    feedbackBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ saved: true }),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Feedback" });
  await expect(dialog).toBeVisible();
  await dialog.locator("select").selectOption("balance");
  await dialog.getByLabel("Comment").fill("The new support rule feels fair.");
  await dialog.getByLabel("Email (optional)").fill("miner@example.test");
  await dialog.getByRole("button", { name: "Submit feedback" }).click();
  await expect(dialog.getByRole("status")).toContainText("Feedback saved.");
  expect(feedbackBody).toMatchObject({
    category: "balance",
    comment: "The new support rule feels fair.",
    email: "miner@example.test",
    context: {
      source: "pause",
      mineVersion: MINE_VERSION,
    },
  });

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const settingsAgain = await openSettings(page);
  await settingsAgain.getByRole("button", { name: "Feedback" }).click();
  await expect(dialog).toBeVisible();
  await pressGamepadBack(page);
  await expect(dialog).not.toBeVisible();
});

test("ladder gravity prompt opens mechanic feedback after the fall settles", async ({
  page,
}) => {
  const gear = { ...DEFAULT_GEAR, pickaxe: 4, fall: 5 };
  const mine = createMine(8282, gear, STARTING_CONSUMABLES);
  const c = START_COL;
  mine.miner.col = c;
  mine.miner.row = 2;
  setCell(mine, c, 2, { kind: "empty" });
  setCell(mine, c, 3, { kind: "dirt" });
  setCell(mine, c + 1, 1, { kind: "empty", ladder: true });
  setCell(mine, c + 1, 2, { kind: "dirt" });
  setCell(mine, c + 1, 3, { kind: "empty" });
  setCell(mine, c + 1, 4, { kind: "dirt" });
  let feedbackBody: unknown = null;

  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/feedback", async (route) => {
    feedbackBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ saved: true }),
    });
  });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 8282,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "2",
  );
  await pressMineKey(page, "ArrowRight");

  const prompt = page.getByRole("dialog", {
    name: "Ladders can fall now",
  });
  await expect(prompt).toBeVisible({ timeout: 3_000 });
  await expect(prompt.getByRole("button", { name: "Ok" })).toBeVisible();
  await expect(
    prompt.getByRole("button", { name: "Give Feedback Now" }),
  ).toBeVisible();
  await expect(
    prompt.getByRole("button", { name: "Never Show Again" }),
  ).toBeVisible();

  await prompt.getByRole("button", { name: "Give Feedback Now" }).click();
  const dialog = page.getByRole("dialog", { name: "Feedback" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Ladder gravity mechanic");
  await dialog.getByLabel("Comment").fill("The slide made the shaft clearer.");
  await dialog.getByRole("button", { name: "Submit feedback" }).click();
  await expect(dialog.getByRole("status")).toContainText("Feedback saved.");
  expect(feedbackBody).toMatchObject({
    category: "confusing",
    comment: "The slide made the shaft clearer.",
    email: "",
    context: {
      source: "ladder-gravity",
      prompt: "ladder-fall-after-mining-support",
      mineVersion: MINE_VERSION,
      depth: 2,
      column: 1,
    },
  });
});

test("mine bag chip opens a scrollable capacity grid", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 360 });
  const gear = { ...DEFAULT_GEAR, battery: 4, cargo: 10 };
  const mine = createMine(8181, gear, STARTING_CONSUMABLES);
  setCell(mine, START_COL, 1, {
    kind: "empty",
    drop: { coal: 5, diamond: 2 },
  });

  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
      let cancelPressed = false;
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => [
          {
            buttons: Array.from({ length: 17 }, (_, index) => ({
              pressed: index === 1 && cancelPressed,
              touched: index === 1 && cancelPressed,
              value: index === 1 && cancelPressed ? 1 : 0,
            })),
          },
        ],
      });
      Object.defineProperty(window, "__setBagCancelPressed", {
        configurable: true,
        value: (pressed: boolean) => {
          cancelPressed = pressed;
        },
      });
    },
    {
      seed: 8181,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "1",
  );

  const bagButton = page.getByRole("button", { name: "Open bag" });
  await expect(bagButton).toBeVisible();
  await expect(bagButton).toContainText("7 ore (2/50)");
  await expect(page.getByLabel("Mine status").getByText("Coal x5")).toHaveCount(
    0,
  );

  await bagButton.click();
  await expect(page.getByRole("dialog", { name: "Bag 2/50" })).toBeVisible();
  const dialog = page.locator("#mine-bag-panel");
  await expect(dialog).toHaveAttribute("data-bag-variant", "tool-satchel");
  await expect(dialog).toHaveAttribute("data-bag-capacity", "50");
  await expect(dialog).toHaveAttribute("data-bag-filled", "2");
  await expect(dialog).toHaveAttribute("data-bag-ore-count", "7");
  await expect(dialog).toHaveAttribute("data-bag-stack-limit", "5");
  await expect(dialog.locator("[data-bag-lid='true']")).toBeVisible();
  await expect(dialog.locator("[data-bag-tray='true']")).toBeVisible();
  await expect(dialog.getByText("Stack slots", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Ore chunks", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Scrap", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Parts", { exact: true })).toBeVisible();
  const coalStack = dialog.locator("[data-ore='coal']");
  const diamondStack = dialog.locator("[data-ore='diamond']");
  await expect(coalStack).toHaveCount(1);
  await expect(coalStack).toHaveAttribute("data-stack-count", "5");
  await expect(coalStack).toHaveAttribute("data-stack-full", "true");
  await expect(
    coalStack.locator("[data-stack-full-overlay='true']"),
  ).toBeVisible();
  await expect(diamondStack).toHaveCount(1);
  await expect(diamondStack).toHaveAttribute("data-stack-count", "2");
  await expect(diamondStack).toHaveAttribute("data-stack-full", "false");
  await expect(
    diamondStack.locator("[data-resource-graphic='true']"),
  ).toBeVisible();
  await expect(dialog.locator("[data-empty-cell='true']")).toHaveCount(48);
  const dropButton = dialog.getByRole("button", { name: "Drop selected" });
  await expect(dropButton).toBeDisabled();
  await coalStack
    .getByRole("button", { name: "Select Coal stack of 5 for dropping" })
    .click();
  await expect(dropButton).toContainText("5");
  await expect(dropButton).toBeEnabled();
  await dropButton.click();
  await expect(dialog).toHaveAttribute("data-bag-filled", "1");
  await expect(dialog).toHaveAttribute("data-bag-ore-count", "2");
  await expect(dialog.locator("[data-ore='coal']")).toHaveCount(0);
  await expect(dialog.locator("[data-empty-cell='true']")).toHaveCount(49);
  const scrollState = await dialog
    .locator("[data-bag-scroll='true']")
    .evaluate((node) => {
      const element = node as HTMLElement;
      return {
        clientHeight: element.clientHeight,
        overflowY: window.getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight,
      };
    });
  expect(scrollState.overflowY).toBe("auto");
  expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);

  await page.mouse.click(8, 8);
  await expect(dialog).not.toBeVisible();

  await bagButton.click();
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const setter = (
      window as unknown as Window & {
        __setBagCancelPressed: (pressed: boolean) => void;
      }
    ).__setBagCancelPressed;
    setter(true);
  });
  await expect(dialog).not.toBeVisible();
});

test("save slot deletion requires a destructive double confirmation", async ({
  page,
}) => {
  let deleteRequests = 0;
  await page.route("**/api/save-slots", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        json: {
          activeSlot: 1,
          slots: [
            {
              slot: 1,
              active: true,
              exists: true,
              createdAt: "2026-06-18T00:00:00.000Z",
              balance: 12,
              deepestDepth: 5,
              partsOwned: 2,
              designs: 1,
              stamps: 3,
            },
            {
              slot: 2,
              active: false,
              exists: true,
              createdAt: "2026-06-18T00:00:00.000Z",
              balance: 4,
              deepestDepth: 2,
              partsOwned: 1,
              designs: 1,
              stamps: 1,
            },
            {
              slot: 3,
              active: false,
              exists: false,
              createdAt: null,
              balance: 0,
              deepestDepth: 0,
              partsOwned: 0,
              designs: 0,
              stamps: 0,
            },
          ],
        },
      });
      return;
    }
    if (request.method() === "DELETE") {
      deleteRequests++;
      expect(request.postDataJSON()).toEqual({
        slot: 2,
        confirm: "DELETE SLOT 2",
      });
      await route.fulfill({
        json: {
          activeSlot: 1,
          slots: [
            {
              slot: 1,
              active: true,
              exists: true,
              createdAt: "2026-06-18T00:00:00.000Z",
              balance: 12,
              deepestDepth: 5,
              partsOwned: 2,
              designs: 1,
              stamps: 3,
            },
            {
              slot: 2,
              active: false,
              exists: false,
              createdAt: null,
              balance: 0,
              deepestDepth: 0,
              partsOwned: 0,
              designs: 0,
              stamps: 0,
            },
            {
              slot: 3,
              active: false,
              exists: false,
              createdAt: null,
              balance: 0,
              deepestDepth: 0,
              partsOwned: 0,
              designs: 0,
              stamps: 0,
            },
          ],
        },
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await page.getByRole("button", { name: "Open settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Load game" }).click();
  const saveSlots = page.getByRole("dialog", { name: "Load Save Slot" });
  await expect(saveSlots).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(saveSlots).not.toBeVisible();
  const settingsAgain = await openSettings(page);
  await settingsAgain.getByRole("button", { name: "Load game" }).click();
  await expect(saveSlots).toBeVisible();

  const slotTwo = saveSlots.getByRole("group", { name: "Slot 2" });
  await slotTwo.getByRole("button", { name: "Delete" }).click();
  expect(deleteRequests).toBe(0);
  await expect(slotTwo).toContainText("Destructive action");
  await expect(slotTwo).toContainText("cannot be restored");

  await slotTwo.getByRole("button", { name: "Delete Slot 2 Forever" }).click();
  await expect(slotTwo).toContainText("New game");
  expect(deleteRequests).toBe(1);
});

test("loading a save slot refreshes the selected world and gear", async ({
  page,
}) => {
  let activeSlot = 1;
  let postRequests = 0;
  const worldSlots: number[] = [];
  const gearSlots: number[] = [];
  const gear = {
    pickaxe: 1,
    battery: 1,
    cargo: 1,
    lantern: 1,
    elevator: 0,
    warpcoil: 1,
    blast: 1,
    elevatorSpeed: 1,
    fall: 1,
  };
  const consumables = {
    dynamite: 0,
    rope: 0,
    ladder: 2,
    plank: 2,
    beacon: 0,
  };
  const filledSlot = (
    slot: 1 | 2,
    balance: number,
    deepestDepth: number,
    partsOwned: number,
    designs: number,
    stamps: number,
  ) => ({
    slot,
    active: activeSlot === slot,
    exists: true,
    createdAt: "2026-06-18T00:00:00.000Z",
    balance,
    deepestDepth,
    partsOwned,
    designs,
    stamps,
  });
  const slots = () => [
    filledSlot(1, 12, 5, 2, 1, 3),
    filledSlot(2, 4, 2, 1, 1, 1),
    {
      slot: 3,
      active: false,
      exists: false,
      createdAt: null,
      balance: 0,
      deepestDepth: 0,
      partsOwned: 0,
      designs: 0,
      stamps: 0,
    },
  ];
  await page.route("**/api/save-slots", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ slot: 2, create: false });
      activeSlot = 2;
      postRequests++;
    }
    await route.fulfill({ json: { activeSlot, slots: slots() } });
  });
  await page.route("**/api/mine/world", async (route) => {
    worldSlots.push(activeSlot);
    await route.fulfill({
      json: {
        seed: activeSlot === 1 ? 111 : 222,
        tripIndex: activeSlot === 1 ? 3 : 8,
        diff: [],
        activeSlot,
      },
    });
  });
  await page.route("**/api/gear", async (route) => {
    gearSlots.push(activeSlot);
    await route.fulfill({
      json: {
        gear: activeSlot === 1 ? gear : { ...gear, lantern: 2 },
        consumables,
        balance: activeSlot === 1 ? 12 : 4,
      },
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Load game" }).click();
  const saveSlots = page.getByRole("dialog", { name: "Load Save Slot" });
  await expect(saveSlots).toBeVisible();
  await expect(
    saveSlots.getByRole("group", { name: "Slot 3" }).getByRole("button", {
      name: "Start",
    }),
  ).toBeVisible();

  await saveSlots
    .getByRole("group", { name: "Slot 2" })
    .getByRole("button", { name: "Load" })
    .click();

  await expect.poll(() => postRequests).toBe(1);
  await expect.poll(() => worldSlots.includes(2)).toBe(true);
  await expect.poll(() => gearSlots.includes(2)).toBe(true);
});

test("mine rotates surface game tips and sometimes leaves the slot empty", async ({
  page,
}) => {
  await page.setViewportSize({ width: 575, height: 1280 });
  await page.addInitScript(() => {
    const w = window as typeof window & {
      __vibebotsSurfaceTipSequence?: (string | null)[];
      __vibebotsSurfaceTipRotationMs?: number;
    };
    w.__vibebotsSurfaceTipSequence = [
      "Tip: rich ore may need several hits. Every swing still costs battery.",
      "Tip: press up into solid ground to dig overhead without using a ladder.",
      null,
    ];
    w.__vibebotsSurfaceTipRotationMs = 5_000;
  });
  await page.goto("/mine");
  await dismissReleaseNotes(page);

  const status = page.getByLabel("Mine status");
  await expect(status).toContainText(
    "Tip: rich ore may need several hits. Every swing still costs battery.",
  );
  const longTip = page.getByText(
    "Tip: rich ore may need several hits. Every swing still costs battery.",
    { exact: true },
  );
  await expect(longTip).toBeVisible();
  const box = await longTip.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(575 - 12);
  expect(box?.height ?? 0).toBeGreaterThan(22);
  await expect(status).toContainText(
    "Tip: press up into solid ground to dig overhead without using a ladder.",
    { timeout: 8_000 },
  );
  await expect(status).not.toContainText("Tip:", { timeout: 8_000 });
});

test("auto sell result replaces tips and wraps in the status chip", async ({
  page,
}) => {
  await page.setViewportSize({ width: 575, height: 1280 });
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/mine/bank", async (route) => {
    await route.fulfill({
      json: {
        credited: {
          credits: 27,
          parts: ["test-part"],
          milestoneBonus: 0,
          soldHaul: {
            ores: { coal: 17, copper: 9 },
            salvageCredits: 1,
            totalVibes: 27,
          },
        },
        balance: 61,
        tripIndex: 1,
        consumables: STARTING_CONSUMABLES,
      },
    });
  });

  const gear = {
    ...DEFAULT_GEAR,
    pickaxe: 9,
    battery: 9,
    cargo: 9,
  };
  const baseMine = createMine(20260620, gear, STARTING_CONSUMABLES);
  setCell(baseMine, START_COL, 1, { kind: "ore", ore: "coal" });
  setCell(baseMine, START_COL, 2, { kind: "dirt" });
  const baseDiff = exportDiff(baseMine);
  const mine = createMine(20260620, gear, STARTING_CONSUMABLES, baseDiff);
  const moves: string[] = [];
  for (let i = 0; i < 24 && mine.miner.row === 0; i++) {
    const result = applyAction(mine, "down");
    if (result.ok) moves.push("down");
  }
  expect(mine.miner.row).toBe(1);
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      json: {
        activeSlot: 1,
        seed: 20260620,
        tripIndex: 0,
        diff: baseDiff,
      },
    });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: { gear, consumables: STARTING_CONSUMABLES, balance: 0 },
    });
  });

  await page.addInitScript(
    (trip) => {
      localStorage.setItem(
        "vibebots-mine-trip-v2-slot-1",
        JSON.stringify(trip),
      );
    },
    {
      mineVersion: MINE_VERSION,
      seed: 20260620,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff,
      moves,
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "1");

  await pressMineKey(page, "ArrowUp");
  await expect(status).toHaveAttribute("data-depth", "0");
  const sellNote = status.getByText(/^Sold Coal x17, Copper x9/);
  await expect(sellNote).toBeVisible();
  await page.waitForTimeout(100);
  await expect(sellNote).toBeVisible();
  await expect(status.getByText(/^Tip:/)).toHaveCount(0);
  const box = await sellNote.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(575 - 12);
  expect(box?.height ?? 0).toBeGreaterThan(22);
});

test("ladders count as support: no plank spent crossing the shaft mouth (REQ-022)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");
  // A fresh player starts with the one-time plank gift.
  await expect(status).toHaveAttribute("data-planks", "4");

  // Dig a two-deep shaft, climb out one (planting a ladder in the cell
  // below), tunnel one cell left, then step back across the shaft
  // mouth: the ladder top under the step is support, so the crossing
  // must NOT consume a plank (the reported bug burned one here).
  await digTo(page, 2);
  await expect(status).toHaveAttribute("data-depth", "2");
  await pressMineKey(page, "ArrowUp");
  await expect(status).toHaveAttribute("data-depth", "1");
  await digLateral(page, "ArrowLeft", -0.8);
  await pressMineKey(page, "ArrowRight");
  await expect(status).toHaveAttribute("data-ladders", "7");
  await expect(status).toHaveAttribute("data-planks", "4");
});

test("plank controls always show both sides with side-specific disabled state", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  const placePlankLeft = page.getByRole("button", {
    name: "Place plank left",
  });
  const placePlankRight = page.getByRole("button", {
    name: "Place plank right",
  });

  await expect(placePlankLeft).toBeVisible();
  await expect(placePlankRight).toBeVisible();
  await expect(placePlankLeft).toBeDisabled();
  await expect(placePlankRight).toBeDisabled();

  await digTo(page, 2);
  await digLateral(page, "ArrowRight", 0.8);
  await pressMineKey(page, "ArrowLeft");
  await pressMineKey(page, "ArrowUp");
  await expect(status).toHaveAttribute("data-depth", "1");
  await expect(placePlankLeft).toBeVisible();
  await expect(placePlankRight).toBeVisible();
  await expect(placePlankLeft).toBeDisabled();
  await expect(placePlankRight).toBeEnabled();
});

test("mine actions begin immediately and settle smoothly (REQ-018, REQ-023)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByText("Opening the shaft")).not.toBeVisible({
    timeout: 5_000,
  });
  await expect
    .poll(async () => canvas.getAttribute("data-miner-x"), { timeout: 5_000 })
    .not.toBeNull();

  const initialX = Number(await canvas.getAttribute("data-miner-x"));
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 2_000,
    })
    .toBeGreaterThan(initialX + 0.05);
  await expect
    .poll(
      async () => Number(await canvas.getAttribute("data-miner-motion-frames")),
      { timeout: 2_000 },
    )
    .toBeGreaterThan(1);
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 600,
    })
    .toBeGreaterThan(initialX + 0.85);

  await page.waitForTimeout(620);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 1_000,
    })
    .toBeGreaterThan(initialX + 1.05);
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 600,
    })
    .toBeGreaterThan(initialX + 1.85);

  const beforeStrike = await canvas.screenshot();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(90);
  const afterStrike = await canvas.screenshot();
  expect(Buffer.compare(beforeStrike, afterStrike)).not.toBe(0);
});

test("rapid repeated keyboard taps do not bypass held cadence (REQ-023)", async ({
  page,
}) => {
  const status = page.getByLabel("Mine status");
  const horizontalDistance = async () =>
    Number(await status.getAttribute("data-horizontal-distance"));

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(status).toHaveAttribute("data-depth", "0");

  const keyboardStart = await horizontalDistance();
  await page.keyboard.press("ArrowRight");
  await expect(status).toHaveAttribute(
    "data-horizontal-distance",
    String(keyboardStart + 1),
  );
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
      );
      window.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, key: "ArrowRight" }),
      );
    }
  });
  await page.waitForTimeout(100);
  expect(await horizontalDistance()).toBe(keyboardStart + 1);

  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(650);
  await page.keyboard.up("ArrowRight");
  expect(await horizontalDistance()).toBeGreaterThanOrEqual(keyboardStart + 2);
});

test("thumbstick spawns where pressed and drives digging (REQ-023)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // Game text never selects (the mobile long-press copy/share bug).
  expect(
    await page.evaluate(() => getComputedStyle(document.body).userSelect),
  ).toBe("none");

  // Fine-pointer devices keep the keyboard mention in the hint.
  await expect(page.getByText(/drag anywhere to move/)).toContainText("WASD");

  const canvas = page.locator("canvas");
  await expect
    .poll(async () => canvas.getAttribute("data-miner-x"), { timeout: 5_000 })
    .not.toBeNull();

  const initialX = Number(await canvas.getAttribute("data-miner-x"));
  await page.mouse.move(760, 380);
  await page.mouse.down();
  await page.mouse.move(860, 380, { steps: 5 });
  await expect(page.locator("[data-joystick]")).toBeVisible();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 3_500,
    })
    .toBeGreaterThan(initialX + 3.75);
  await page.mouse.up();
  await expect(page.locator("[data-joystick]")).not.toBeVisible();

  // Press on open ground right of the panels: the stick appears there.
  await page.mouse.move(900, 380);
  await page.mouse.down();
  await page.mouse.move(900, 450, { steps: 5 });
  await expect(page.locator("[data-joystick]")).toBeVisible();

  // Holding past the deadzone fires immediately, then auto-repeats.
  await expect
    .poll(async () => Number(await status.getAttribute("data-depth")), {
      timeout: 12_000,
    })
    .toBeGreaterThanOrEqual(2);

  await page.mouse.up();
  await expect(page.locator("[data-joystick]")).not.toBeVisible();
});

test("abandoning a stuck trip hauls up and forfeits the carry (REQ-025)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");
  const recovery = page.getByRole("button", { name: "Recovery options" });
  await recovery.click();
  const abandon = page.getByRole("menuitem", { name: "Abandon trip" });
  await expect(abandon).toBeDisabled();
  await recovery.click();

  await digTo(page, 1);
  await expect(status).toHaveAttribute("data-depth", "1");
  await recovery.click();
  await expect(abandon).toBeEnabled();

  // Two-tap confirm: the first tap arms, the second fires (the window
  // is 8s, which covers slow CI between two awaited clicks).
  await abandon.click();
  await expect(abandon).toContainText("Sure?");
  await abandon.click();
  await expect(status).toHaveAttribute("data-depth", "0", {
    timeout: 15_000,
  });
  await expect(
    page.getByLabel("Dismiss trip report").getByText("Abandoned the dig"),
  ).toBeVisible();
  // Dismiss the trip report.
  await page.getByLabel("Dismiss trip report").click();
});

test.describe("phone viewport", () => {
  test.use({
    viewport: { width: 390, height: 760 },
    hasTouch: true,
    isMobile: true,
  });

  test("touch drag moves the miner and page pinch stays locked", async ({
    browserName,
    page,
  }) => {
    test.skip(browserName !== "chromium", "uses CDP touch events");
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    const canvas = page.locator("canvas");
    await expect(status).toHaveAttribute("data-depth", "0");
    await expect(canvas).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const openTarget = document.elementFromPoint(150, 470);
          const jumpButton = document.querySelector('[aria-label="Jump jets"]');
          const jumpRect = jumpButton?.getBoundingClientRect();
          const hudTarget = jumpRect
            ? document.elementFromPoint(
                jumpRect.left + jumpRect.width / 2,
                jumpRect.top + jumpRect.height / 2,
              )
            : null;
          return {
            hudButton: hudTarget?.closest("button")?.getAttribute("aria-label"),
            openMineIsTouchSurface: Boolean(
              openTarget?.closest("[data-touch-surface]"),
            ),
          };
        }),
      )
      .toEqual({
        hudButton: "Jump jets",
        openMineIsTouchSurface: true,
      });

    const viewportMeta = await page
      .locator('meta[name="viewport"]')
      .getAttribute("content");
    expect(viewportMeta).toContain("maximum-scale=1");
    expect(viewportMeta).toContain("user-scalable=no");
    const pageScale = async () =>
      page.evaluate(() => window.visualViewport?.scale ?? 1);
    await expect.poll(pageScale).toBe(1);

    await touchPinchOut(page, { x: 195, y: 120 });
    await expect.poll(pageScale).toBe(1);

    const startDistance = Number(
      await status.getAttribute("data-horizontal-distance"),
    );
    await touchDrag(page, { x: 150, y: 470 }, { x: 250, y: 470 });
    await expect
      .poll(
        async () =>
          Number(await status.getAttribute("data-horizontal-distance")),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(startDistance);
  });

  test("surface saves with bunkers still accept movement drags", async ({
    browserName,
    page,
  }) => {
    test.skip(browserName !== "chromium", "uses CDP touch events");
    const mine = createMine(8086, DEFAULT_GEAR, STARTING_CONSUMABLES);
    await page.route("**/api/mine/world", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          activeSlot: 2,
          seed: 8086,
          tripIndex: 0,
          diff: exportDiff(mine),
        }),
      });
    });
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({ status: 503, body: "{}" });
    });
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          bunker: {
            footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
            core: { col: START_COL, row: 3, durability: 160 },
            parts: [
              {
                partId: "wall-panel",
                col: START_COL - 3,
                row: 1,
                durability: 90,
              },
            ],
          },
          inventory: {
            "wall-panel": 2,
            "floor-panel": 3,
            "roof-panel": 3,
            "door-panel": 1,
            "basic-turret": 0,
            "floor-spikes": 0,
          },
          activeRaid: null,
          player: {
            balance: 120,
            trackXp: 40,
            defenseXp: 120,
            overallLevel: 2,
            levelCap: 100,
            progressXp: 20,
            neededXp: 80,
            nextLevelXp: 200,
            beaconLimit: 3,
          },
        }),
      });
    });

    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    await expect(page.locator("canvas")).toBeVisible();
    await expect(status).toHaveAttribute("data-depth", "0");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const openTarget = document.elementFromPoint(150, 470);
          return Boolean(openTarget?.closest("[data-touch-surface]"));
        }),
      )
      .toBe(true);

    const startDistance = Number(
      await status.getAttribute("data-horizontal-distance"),
    );
    await touchDrag(page, { x: 150, y: 470 }, { x: 250, y: 470 });
    await expect
      .poll(
        async () =>
          Number(await status.getAttribute("data-horizontal-distance")),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(startDistance);
  });

  test("control copy never mentions the keyboard on touch devices", async ({
    page,
  }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const hint = page.getByText(/drag anywhere to move/);
    await expect(hint).toBeVisible();
    await expect(hint).not.toContainText("WASD");
  });

  test("camera pans laterally so mining left stays on screen", async ({
    page,
  }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    const canvas = page.locator("canvas");
    await expect(status).toHaveAttribute("data-depth", "0");

    // Dig down one, then tunnel left three: on a 390px-wide portrait
    // viewport the half-width is ~2.6 world units, so without lateral
    // camera tracking the bot at x=-3 left the screen entirely (the
    // reported "horizontal mining does not update the screen").
    await digTo(page, 1);
    await expect(status).toHaveAttribute("data-depth", "1");
    for (let i = 0; i < 18; i++) {
      await pressMineKey(page, "ArrowLeft");
      if (Number(await canvas.getAttribute("data-cam-x")) < -1.5) break;
    }
    // The rig pans toward the miner; the bot stays in frame.
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-cam-x")), {
        timeout: 5_000,
      })
      .toBeLessThan(-1.5);
    // And the visible pixels actually changed across the lateral digs
    // (Rule 10): two frames straddling one more lateral dig differ.
    const before = await canvas.screenshot();
    await pressMineKey(page, "ArrowRight");
    await page.waitForTimeout(250);
    const after = await canvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test("walking the surface shop row stays responsive", async ({ page }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    const canvas = page.locator("canvas");
    await expect(status).toHaveAttribute("data-depth", "0");
    await page.waitForTimeout(800);

    // Walk left across the shops (the elevator is five columns out) and confirm
    // the camera actually tracks the whole way: the static village (no
    // per-step reconciliation) must not stall input. Absolute frame time
    // is not asserted here, since CI's software renderer is far slower
    // than any device; data-frame-ms exists for manual perf probing.
    for (let i = 0; i < 8; i++) {
      await pressMineKey(page, "ArrowLeft");
    }
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-cam-x")), {
        timeout: 5_000,
      })
      .toBeLessThan(-3);
    // The frame-time stat is wired up (a real number, not NaN/absent).
    expect(Number(await canvas.getAttribute("data-frame-ms"))).toBeGreaterThan(
      0,
    );
    // Walking back the other way still tracks, so input never wedged.
    for (let i = 0; i < 10; i++) {
      await pressMineKey(page, "ArrowRight");
    }
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-cam-x")), {
        timeout: 5_000,
      })
      .toBeGreaterThan(0);
  });

  test("mine posts a compact performance sample", async ({ page }) => {
    const samples: unknown[] = [];
    await page.route("**/api/performance", async (route) => {
      samples.push(route.request().postDataJSON());
      await route.fulfill({ json: { saved: true } });
    });
    await page.addInitScript(() => {
      const w = window as typeof window & {
        __vibebotsPerfInitialDelayMs?: number;
        __vibebotsPerfSampleMs?: number;
        __vibebotsPerfRepeatMs?: number;
        __vibebotsPerfMinSendIntervalMs?: number;
      };
      w.__vibebotsPerfInitialDelayMs = 0;
      w.__vibebotsPerfSampleMs = 2_000;
      w.__vibebotsPerfRepeatMs = 60_000;
      w.__vibebotsPerfMinSendIntervalMs = 0;
    });

    await page.goto("/mine");
    await expect(page.locator("canvas")).toBeVisible();
    await dismissReleaseNotes(page);
    await expect.poll(() => samples.length, { timeout: 15_000 }).toBe(1);
    const payload = samples[0] as Record<string, unknown>;
    expect(payload.source).toBe("mine");
    expect(String(payload.appVersion)).toMatch(APP_VERSION_PATTERN);
    expect(payload.mineVersion).toBe(MINE_VERSION);
    expect(payload.frameCount).toBeGreaterThan(5);
    expect(payload.p95FrameMs).toBeGreaterThan(0);
    expect(payload.viewportWidth).toBeGreaterThan(0);
    expect(payload.devicePixelRatio).toBeGreaterThan(0);
  });

  test("a downward drag from anywhere inside a stall sheet dismisses it", async ({
    page,
  }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-depth", "0");

    // Stand at the Upgrades stall and tap the prompt to open the sheet.
    const upgradesPrompt = page.getByRole("button", { name: "Open Upgrades" });
    for (let i = 0; i < 12; i++) {
      if (await upgradesPrompt.isVisible().catch(() => false)) break;
      await pressMineKey(page, "ArrowRight");
    }
    const upgrades = await openStall(page, "Upgrades");
    // Let the slide-up entrance (0.28s) settle so the docked baseline
    // is the resting position, not a mid-animation frame.
    await page.waitForTimeout(450);

    // Grab the interior of the sheet, below the header affordance.
    const box = await upgrades.boundingBox();
    if (!box) throw new Error("sheet has no bounding box");
    const x = box.x + box.width / 2;
    const y = box.y + Math.min(220, box.height * 0.55);
    await page.mouse.move(x, y);
    await page.mouse.down();

    // Rule 10: the sheet visibly follows the finger before release. Pull
    // partway (under the close threshold) and confirm it actually moved
    // down, then that a short pull snaps back to its docked position.
    await page.mouse.move(x, y + 40);
    await page.waitForTimeout(30);
    const dragged = await upgrades.boundingBox();
    if (!dragged) throw new Error("sheet vanished mid-drag");
    expect(dragged.y).toBeGreaterThan(box.y + 15);
    await page.mouse.up();
    await page.waitForTimeout(250);
    const snapped = await upgrades.boundingBox();
    if (!snapped) throw new Error("sheet dismissed on a sub-threshold drag");
    expect(snapped.y).toBeLessThan(dragged.y - 10);
    await expect(upgrades).toBeVisible();

    // Now a full pull past the threshold dismisses, still on the column.
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(x, y + i * 25);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await expect(upgrades).not.toBeVisible();
    await expect(status).toHaveAttribute("data-depth", "0");
  });
});

test("mine wheel zoom extends into the starter lantern falloff", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => canvas.getAttribute("data-cam-zoom"), {
      timeout: 5_000,
    })
    .not.toBeNull();

  const startZoom = Number(await canvas.getAttribute("data-cam-zoom"));
  await page.mouse.move(500, 380);
  await page.mouse.wheel(0, -600);
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-zoom")), {
      timeout: 5_000,
    })
    .toBeLessThan(startZoom);
  await expect(canvas).toHaveAttribute("data-darkness-opacity-min", "0.00");
  await expect(canvas).toHaveAttribute("data-darkness-opacity-max", "0.00");

  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 600);
  }
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-zoom")), {
      timeout: 5_000,
    })
    .toBeGreaterThan(startZoom);
  await expect(canvas).toHaveAttribute("data-lit-below", "3");
  await expect(canvas).toHaveAttribute("data-render-below", "5");
  await expect(canvas).toHaveAttribute("data-render-radius", "5");
  await expect(canvas).toHaveAttribute(
    "data-render-min-col",
    String(START_COL - 5),
  );
  await expect(canvas).toHaveAttribute(
    "data-render-max-col",
    String(START_COL + 5),
  );
  const minDarkness = Number(
    await canvas.getAttribute("data-darkness-opacity-min"),
  );
  const maxDarkness = Number(
    await canvas.getAttribute("data-darkness-opacity-max"),
  );
  expect(minDarkness).toBeGreaterThanOrEqual(0.44);
  expect(minDarkness).toBeLessThanOrEqual(0.45);
  expect(maxDarkness).toBeGreaterThanOrEqual(0.56);
  expect(maxDarkness).toBeLessThanOrEqual(0.57);
});

test("mine HUD zoom buttons adjust the lantern-capped camera", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const w = window as typeof window & {
      __vibebotsSurfaceTipSequence?: (string | null)[];
      __vibebotsSurfaceTipRotationMs?: number;
    };
    w.__vibebotsSurfaceTipSequence = [
      "Tip: Distant biome beacons become free portals back to base.",
    ];
    w.__vibebotsSurfaceTipRotationMs = 60_000;
  });
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  const zoomControls = page.locator('[aria-label="Zoom controls"]');
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  const settingsButton = page.getByRole("button", { name: "Open settings" });
  await expect(canvas).toBeVisible();
  await expect(zoomControls).toBeVisible();
  await expect(settingsButton).toBeVisible();
  await expect(
    page.getByText(
      "Tip: Distant biome beacons become free portals back to base.",
    ),
  ).toBeVisible();
  const expectZoomControlsClear = async () => {
    await expect(
      page.evaluate(() => {
        const zoom = document
          .querySelector('[aria-label="Zoom controls"]')
          ?.getBoundingClientRect();
        const statusTargets = [
          ...document.querySelectorAll('[aria-label="Mine status"] > span'),
        ].map((node) => node.getBoundingClientRect());
        const settings = document
          .querySelector('[aria-label="Open settings"]')
          ?.getBoundingClientRect();
        if (!zoom || !settings || statusTargets.length === 0) return false;
        const overlaps = (a: DOMRect, b: DOMRect) =>
          a.left < b.right &&
          a.right > b.left &&
          a.top < b.bottom &&
          a.bottom > b.top;
        return (
          Math.abs(zoom.right - settings.right) < 1 &&
          zoom.top >= settings.bottom + 8 &&
          statusTargets.every((status) => !overlaps(zoom, status)) &&
          !overlaps(zoom, settings)
        );
      }),
    ).resolves.toBe(true);
  };
  const expectZoomControlsClearOfSettings = async () => {
    await expect(
      page.evaluate(() => {
        const zoom = document
          .querySelector('[aria-label="Zoom controls"]')
          ?.getBoundingClientRect();
        const settings = document
          .querySelector('[aria-label="Settings"]')
          ?.getBoundingClientRect();
        if (!zoom || !settings) return false;
        return (
          zoom.left >= settings.right ||
          zoom.right <= settings.left ||
          zoom.top >= settings.bottom ||
          zoom.bottom <= settings.top
        );
      }),
    ).resolves.toBe(true);
  };
  await expectZoomControlsClear();
  await settingsButton.click();
  const settingsPanel = page.getByRole("region", { name: "Settings" });
  await expect(settingsPanel).toBeVisible();
  await expectZoomControlsClearOfSettings();
  await settingsButton.click();
  await expect(settingsPanel).not.toBeVisible();
  await expectZoomControlsClear();
  await settingsButton.click();
  await expect(settingsPanel).toBeVisible();
  await expectZoomControlsClearOfSettings();
  await settingsButton.click();
  await expect(settingsPanel).not.toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(
    page.evaluate(() => {
      const zoom = document
        .querySelector('[aria-label="Zoom controls"]')
        ?.getBoundingClientRect();
      if (!zoom) return false;
      return zoom.left >= 0 && zoom.right <= window.innerWidth;
    }),
  ).resolves.toBe(true);
  await expect
    .poll(async () => canvas.getAttribute("data-cam-zoom"), {
      timeout: 5_000,
    })
    .not.toBeNull();

  const startZoom = Number(await canvas.getAttribute("data-cam-zoom"));
  await expect(canvas).toHaveAttribute("data-darkness-opacity-min", "0.00");
  await expect(canvas).toHaveAttribute("data-darkness-opacity-max", "0.00");
  await zoomOut.click();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-zoom")), {
      timeout: 5_000,
    })
    .toBeGreaterThan(startZoom);
  await expect(canvas).toHaveAttribute("data-darkness-opacity-min", "0.00");
  await expect(canvas).toHaveAttribute("data-darkness-opacity-max", "0.00");

  await zoomOut.click();
  await expect(zoomOut).toBeDisabled();
  await expect(canvas).toHaveAttribute("data-cam-zoom", "1.32");
  await expect(canvas).toHaveAttribute("data-lit-below", "3");
  await expect(canvas).toHaveAttribute("data-render-below", "5");
  await expect(canvas).toHaveAttribute("data-lamp-distance", "9.00");
  const minDarkness = Number(
    await canvas.getAttribute("data-darkness-opacity-min"),
  );
  const maxDarkness = Number(
    await canvas.getAttribute("data-darkness-opacity-max"),
  );
  expect(minDarkness).toBeGreaterThanOrEqual(0.44);
  expect(minDarkness).toBeLessThanOrEqual(0.45);
  expect(maxDarkness).toBeGreaterThanOrEqual(0.56);
  expect(maxDarkness).toBeLessThanOrEqual(0.57);
  await expect(zoomControls).toHaveAttribute("data-camera-zoom-max", "1.32");

  await zoomIn.click();
  await expect(zoomOut).toBeEnabled();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-zoom")), {
      timeout: 5_000,
    })
    .toBeLessThan(1.32);
});

test("the carved world survives a reload (REQ-026)", async ({ page }) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // Dig a two-deep shaft, then abandon (a trip-ending moment, which
  // checkpoints the guest world to local storage).
  await digTo(page, 2);
  await page.getByRole("button", { name: "Recovery options" }).click();
  const abandon = page.getByRole("menuitem", { name: "Abandon trip" });
  await abandon.click();
  await expect(abandon).toContainText("Sure?");
  await abandon.click();
  await expect(status).toHaveAttribute("data-depth", "0", {
    timeout: 15_000,
  });
  await page.getByLabel("Dismiss trip report").click();

  // Reload: the mine must still be carved. Descending the old shaft
  // is one paid walk, then gravity settles the miner through empty cells.
  await page.reload();
  await dismissReleaseNotes(page);
  await expect(status).toHaveAttribute("data-depth", "0");
  await pressMineKey(page, "ArrowDown");
  await expect(status).toHaveAttribute("data-depth", "2");
  await expect(status).toHaveAttribute("data-energy", "59.5");

  // And a MID-TRIP reload resumes exactly where the trip stood: the
  // in-flight log replays over the trip-start checkpoint, so depth and
  // energy come back identical (carry included).
  const energyBefore = await status.getAttribute("data-energy");
  await page.reload();
  await dismissReleaseNotes(page);
  await expect(status).toHaveAttribute("data-depth", "2");
  await expect(status).toHaveAttribute("data-energy", energyBefore ?? "");
});

test("surface village stalls open their menus on tap (REQ-021)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // Walk left from the shaft to the Hardware Store; the menu does not pop
  // on walk-by, the prompt does, and tapping it opens the menu.
  await walkToStallPrompt(page, "ArrowLeft", "Hardware Store");
  await expect(
    page.getByRole("region", { name: "Hardware Store", exact: true }),
  ).not.toBeVisible();
  const buyer = await openStall(page, "Hardware Store");
  await expect(buyer).toContainText("Wall");
  await expect(buyer).toContainText("Floor");
  await expect(buyer).toContainText("Roof");
  await expect(buyer).toContainText("Door");
  await expect(buyer).toContainText("Basic Turret");
  await expect(buyer).toContainText("Requires level 2");
  await expect(buyer).toContainText("3 shots per raid");
  await expect(buyer).toContainText("Breaks after 5 Clanker hits");
  await expect(buyer).toContainText("Floor Spikes");
  await expect(buyer).toContainText("Breaks after 3 steps");
  await expect(buyer).toContainText("Limit 4 at your level");
  await expect(buyer).not.toContainText("Base stock unlocks by player level");
  await expect(buyer).not.toContainText("New claims start with");

  // Walk right to the Supply Depot: consumables with prices.
  await walkToStallPrompt(page, "ArrowRight", "Supply Depot");
  const depot = await openStall(page, "Supply Depot");
  await expect(depot).toContainText("supplies for digging deeper");
  await expect(depot).toContainText("Ladder");
  await expect(depot).toContainText("have");
  await expect(depot).toContainText("Buy 1 for 2 vibes");
  await expect(depot).not.toContainText("best for");
  await expect(depot).not.toContainText("vibes left");
  await expect(depot).not.toContainText("current trip");
  await expect(depot).not.toContainText("purchases pack");
  await expect(depot).not.toContainText("Basic Turret");
  await expect(depot).not.toContainText("Floor Spikes");
  await depot.getByRole("button", { name: "x5" }).click();
  await expect(depot).toContainText("Buy 5 for 10 vibes");

  // And on to the Upgrades stall: the gear tracks.
  await walkToStallPrompt(page, "ArrowRight", "Upgrades");
  const upgrades = await openStall(page, "Upgrades");
  await expect(upgrades).toContainText("Pickaxe");
  await expect(upgrades).toContainText("Cargo Hold");
  await expect(upgrades).toContainText("Fall Harness");
  await expect(upgrades).toContainText("Recall Rope");
  await expect(upgrades).toContainText("row 12");
  await expect(upgrades).not.toContainText("best for");
  await expect(upgrades).not.toContainText("vibes after");

  // Walking off the stall column closes the menu.
  await pressMineKey(page, "ArrowLeft");
  await expect(upgrades).not.toBeVisible();
});

test("upgrade buys require a completed hold", async ({ page }) => {
  let upgradeRequests = 0;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: VibratePattern) => {
        const target = window as Window & {
          __vibebotsVibrations?: VibratePattern[];
        };
        target.__vibebotsVibrations ??= [];
        target.__vibebotsVibrations.push(pattern);
        return true;
      },
    });
  });
  const mine = createMine(7193, DEFAULT_GEAR, STARTING_CONSUMABLES);
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      json: { seed: 7193, diff: exportDiff(mine), tripIndex: 0 },
    });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: {
        gear: DEFAULT_GEAR,
        consumables: STARTING_CONSUMABLES,
        balance: 120,
        playerLevel: 1,
        deepestDepth: 0,
      },
    });
  });
  await page.route("**/api/gear/upgrade", async (route) => {
    upgradeRequests++;
    await route.fulfill({
      json: { track: "pickaxe", level: 2, balance: 75 },
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await walkToStallPrompt(page, "ArrowRight", "Upgrades");
  const upgrades = await openStall(page, "Upgrades");
  await expect(upgrades).toContainText("Pickaxe");
  await expect(upgrades).not.toContainText("best for");
  await expect(upgrades).not.toContainText("vibes after");

  const buyPickaxe = upgrades.getByRole("button", {
    name: "Hold to buy Pickaxe for 45 vibes",
  });
  await expect(buyPickaxe).toBeEnabled();
  await buyPickaxe.focus();
  await page.keyboard.down("Enter");
  await page.waitForTimeout(180);
  await page.keyboard.up("Enter");
  await page.waitForTimeout(650);
  expect(upgradeRequests).toBe(0);
  await expect(page.getByText("pickaxe is now level 2")).toHaveCount(0);

  const activeUpgrades = (await upgrades.isVisible().catch(() => false))
    ? upgrades
    : await openStall(page, "Upgrades");
  const activeBuyPickaxe = activeUpgrades.getByRole("button", {
    name: "Hold to buy Pickaxe for 45 vibes",
  });
  await activeBuyPickaxe.focus();
  await page.keyboard.down("Enter");
  await page.waitForTimeout(820);
  await page.keyboard.up("Enter");
  await expect.poll(() => upgradeRequests).toBe(1);
  await expect(activeUpgrades).toContainText("pickaxe is now level 2");
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-wallet",
    "75",
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const target = window as Window & {
          __vibebotsVibrations?: VibratePattern[];
        };
        return target.__vibebotsVibrations?.length ?? 0;
      }),
    )
    .toBeGreaterThanOrEqual(3);
});

test("a stall opens on tap and closes back to the prompt", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // Stand at the Hardware Store (three columns left of the shaft).
  for (let i = 0; i < 3; i++) {
    await pressMineKey(page, "ArrowLeft");
  }
  const prompt = page.getByRole("button", { name: "Open Hardware Store" });
  const buyer = page.getByRole("region", {
    name: "Hardware Store",
    exact: true,
  });
  await expect(prompt).toBeVisible();
  await expectSurfacePromptBottomClearance(page, "Open Hardware Store");
  await expect(buyer).not.toBeVisible();

  // Tap opens; the close button dismisses without walking away (still on
  // the column at depth 0) and the prompt comes back.
  await prompt.click();
  await expect(buyer).toBeVisible();
  await buyer.getByRole("button", { name: "Close shop" }).click();
  await expect(buyer).not.toBeVisible();
  await expect(prompt).toBeVisible();
  await expectSurfacePromptBottomClearance(page, "Open Hardware Store");
  await expect(status).toHaveAttribute("data-depth", "0");

  // Tapping the prompt again reopens it.
  await prompt.click();
  await expect(buyer).toBeVisible();
  await buyer.getByRole("button", { name: "Close shop" }).click();
  await expect(buyer).not.toBeVisible();

  // The reported phone layout was at the Supply Depot. The same raised
  // prompt slot applies to every stall.
  for (let i = 0; i < 5; i++) {
    await pressMineKey(page, "ArrowRight");
  }
  await expectSurfacePromptBottomClearance(page, "Open Supply Depot");
});

test("floating mine menus dismiss from outside taps", async ({ page }) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const outsidePoint = { x: 18, y: 220 };

  await page.getByRole("button", { name: "Open settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await expect(settings).toBeVisible();
  await page.mouse.click(outsidePoint.x, outsidePoint.y);
  await expect(settings).not.toBeVisible();

  await page.getByRole("button", { name: /Dynamite .*\(/ }).click();
  const dynamiteMenu = page.getByRole("menu", { name: "Dynamite tiers" });
  await expect(dynamiteMenu).toBeVisible();
  await page.mouse.click(outsidePoint.x, outsidePoint.y);
  await expect(dynamiteMenu).not.toBeVisible();

  await page.getByRole("button", { name: "Recovery options" }).click();
  const recoveryMenu = page.getByRole("menu", { name: "Recovery actions" });
  await expect(recoveryMenu).toBeVisible();
  await page.mouse.click(outsidePoint.x, outsidePoint.y);
  await expect(recoveryMenu).not.toBeVisible();

  for (let i = 0; i < 3; i++) {
    await pressMineKey(page, "ArrowLeft");
  }
  const hardware = await openStall(page, "Hardware Store");
  await page.mouse.click(outsidePoint.x, outsidePoint.y);
  await expect(hardware).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Hardware Store" }),
  ).toBeVisible();

  const indicator = await walkUntilBaseIndicator(page);
  await indicator.click();
  const baseReturn = page.getByRole("region", { name: "Base return" });
  await expect(baseReturn).toBeVisible();
  await page.mouse.click(outsidePoint.x, outsidePoint.y);
  await expect(baseReturn).not.toBeVisible();
});

test("the warp pad gates jumps on a planted beacon (REQ-029)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // The pad stands six columns right of the shaft.
  for (let i = 0; i < 6; i++) {
    await pressMineKey(page, "ArrowRight");
  }
  const pad = await openStall(page, "Warp Pad");
  await expect(pad).toContainText("No planted beacons yet");
  await expect(pad).toContainText("Warpcoil range: 60 rows");
  await expect(
    pad.getByRole("button", { name: "Warp to beacon" }),
  ).toBeDisabled();
});

test("warp beacon planting disables beyond current Warpcoil range", async ({
  page,
}) => {
  const gear = {
    ...DEFAULT_GEAR,
    pickaxe: 5,
    battery: 4,
    cargo: 4,
    lantern: 3,
    warpcoil: 1,
  };
  const targetRow = 61;
  const baseDiff = Array.from({ length: targetRow }, (_, index) => [
    START_COL,
    index + 1,
    { kind: "empty", ladder: true },
  ]);
  const trip = {
    seed: 20260620,
    mineVersion: MINE_VERSION,
    tripIndex: 0,
    gear,
    consumables: { ...STARTING_CONSUMABLES, beacon: 1 },
    baseDiff,
    moves: Array.from({ length: targetRow }, () => "down"),
  };
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      json: {
        activeSlot: 1,
        seed: trip.seed,
        tripIndex: trip.tripIndex,
        diff: baseDiff,
      },
    });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: {
        gear,
        consumables: trip.consumables,
        balance: 0,
      },
    });
  });
  await page.addInitScript((savedTrip) => {
    localStorage.setItem(
      "vibebots-mine-trip-v2-slot-1",
      JSON.stringify(savedTrip),
    );
  }, trip);

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", String(targetRow));

  const beacon = page.getByRole("button", { name: "Plant warp beacon" });
  await expect(beacon).toBeVisible();
  await expect(beacon).toHaveAttribute("aria-disabled", "true");
  await expect(beacon).toHaveCSS("opacity", "0.42");
  await beacon.click({ force: true });
  await expect(
    page.getByText("Beacon is beyond Warpcoil range. Upgrade Warpcoil."),
  ).toBeVisible();
  await expect(beacon).toContainText("1");
});

test.describe
  .serial("deep saved-trip smoke", () => {
    test("biome portal beacons activate and appear at the Warp Pad", async ({
      page,
    }) => {
      await page.route("**/api/mine/world", async (route) => {
        await route.fulfill({
          json: {
            activeSlot: 1,
            seed: 20260619,
            tripIndex: 0,
            diff: [],
          },
        });
      });
      await page.route("**/api/gear", async (route) => {
        await route.fulfill({
          json: {
            gear: DEFAULT_GEAR,
            consumables: STARTING_CONSUMABLES,
            balance: 0,
          },
        });
      });
      await page.goto("/mine");
      await dismissReleaseNotes(page);
      const status = page.getByLabel("Mine status");
      await expect(status).toHaveAttribute("data-depth", "0");

      for (let i = 0; i < 75; i++) await pressMineKey(page, "ArrowLeft");
      const activate = page.getByRole("button", {
        name: "Activate Winter Beacon",
      });
      await expect(activate).toBeVisible();
      const canvas = page.locator("canvas");
      const before = await canvas.screenshot();
      await activate.click();
      const portal = page.getByRole("region", { name: "Winter Beacon portal" });
      await expect(portal).toBeVisible();
      const after = await canvas.screenshot();
      expect(Buffer.compare(before, after)).not.toBe(0);

      await portal.getByRole("button", { name: "Base" }).click();
      await expect(status).toHaveAttribute("data-depth", "0");
      for (let i = 0; i < 6; i++) await pressMineKey(page, "ArrowRight");
      const pad = await openStall(page, "Warp Pad");
      await expect(pad).toContainText("Winter Beacon");
      await expect(pad).toContainText("portals are free");
    });

    test("deep dropped ore markers do not create a white text card", async ({
      page,
    }) => {
      const gear = {
        ...DEFAULT_GEAR,
        pickaxe: 5,
        battery: 5,
        cargo: 5,
        lantern: 4,
        warpcoil: 5,
      };
      const consumables = { ...STARTING_CONSUMABLES, beacon: 0 };
      const baseDiff = [
        [0, 665, { kind: "empty", beacon: true, drop: { coal: 12 } }],
        [1, 665, { kind: "rock", rockTier: 3, fallen: true }],
        [1, 664, { kind: "rock", rockTier: 3, fallen: true }],
        [0, 666, { kind: "rock", rockTier: 3, fallen: true }],
        [-1, 665, { kind: "empty" }],
        [0, 664, { kind: "empty" }],
      ];
      await page.route("**/api/mine/world", async (route) => {
        await route.fulfill({
          json: {
            activeSlot: 1,
            seed: 12345,
            tripIndex: 0,
            diff: baseDiff,
          },
        });
      });
      await page.route("**/api/gear", async (route) => {
        await route.fulfill({ json: { gear, consumables, balance: 0 } });
      });
      await page.goto("/mine");
      await dismissReleaseNotes(page);
      const status = page.getByLabel("Mine status");

      for (let i = 0; i < 6; i++) await pressMineKey(page, "ArrowRight");
      const pad = await openStall(page, "Warp Pad");
      await pad.getByRole("button", { name: "Warp" }).click();
      await expect(status).toHaveAttribute("data-depth", "665");

      const canvas = page.locator("canvas");
      await expect(canvas).toBeVisible();
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(300);
      await expect(canvas).toHaveAttribute("data-miner-x", "-1.00");
      const brightPixels = await canvas.evaluate((node) => {
        const source = node as HTMLCanvasElement;
        const sample = document.createElement("canvas");
        sample.width = source.width;
        sample.height = source.height;
        const ctx = sample.getContext("2d", { willReadFrequently: true });
        if (!ctx) return Number.POSITIVE_INFINITY;
        ctx.drawImage(source, 0, 0);
        const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
        let bright = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (
            data[i] > 245 &&
            data[i + 1] > 245 &&
            data[i + 2] > 245 &&
            data[i + 3] > 180
          ) {
            bright++;
          }
        }
        return bright;
      });
      expect(brightPixels).toBeLessThan(800);
    });
  });

test("the warp pad lists beacons newest first (REQ-029)", async ({ page }) => {
  const mine = createMine(9797, DEFAULT_GEAR, STARTING_CONSUMABLES);
  setCell(mine, START_COL, 3, {
    kind: "empty",
    beacon: true,
    beaconOrder: 1,
  });
  setCell(mine, START_COL - 2, 70, {
    kind: "empty",
    beacon: true,
    beaconOrder: 2,
  });
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: {
        gear: DEFAULT_GEAR,
        consumables: STARTING_CONSUMABLES,
        balance: 0,
      },
    });
  });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 9797,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: [],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  for (let i = 0; i < 6; i++) {
    await pressMineKey(page, "ArrowRight");
  }
  const pad = await openStall(page, "Warp Pad");
  await expect(pad).toContainText("2 destinations online");
  await expect(pad).toContainText("row 70, col -2 out of range");
  await expect(pad).toContainText("row 3, col 0");
  await expect(
    pad.getByRole("button", { name: "Warp" }).first(),
  ).toBeDisabled();
  await expect(pad.getByRole("button", { name: "Warp" }).nth(1)).toBeEnabled();
  await pad.getByLabel("Rename Newest beacon").fill("Deep Door");
  await pad.getByRole("button", { name: "Rename" }).first().click();
  await expect(pad).toContainText("Deep Door");
});

test("the elevator sells rail and gates rides on it (REQ-028)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // The tower stands five columns left of the shaft.
  for (let i = 0; i < 5; i++) {
    await pressMineKey(page, "ArrowLeft");
  }
  const elevator = await openStall(page, "Elevator");
  await expect(elevator).toContainText("no rail yet");
  await expect(elevator).toContainText("45 vibes");
  // Without rail the ride is disabled; without storage so is the buy.
  await expect(
    elevator.getByRole("button", { name: /Ride down|Auto ride/ }),
  ).toBeDisabled();
});

test("elevator controls work from any elevator floor", async ({ page }) => {
  const gear = { ...DEFAULT_GEAR, elevator: ELEVATOR_SEGMENT_ROWS };
  const mine = createMine(9292, gear, STARTING_CONSUMABLES);
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: {
        gear,
        consumables: STARTING_CONSUMABLES,
        balance: 0,
      },
    });
  });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 9292,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: [],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  const canvas = page.locator("canvas");
  await expect(status).toHaveAttribute("data-depth", "0");
  await expect(canvas).toHaveAttribute("data-miner-x", "0.00");
  await expect(
    page.getByRole("button", { name: "Ride elevator down" }),
  ).not.toBeVisible();

  for (let i = 0; i < Math.abs(ELEVATOR_COL - START_COL); i++) {
    await pressMineKey(page, "ArrowLeft");
  }
  await expect(canvas).toHaveAttribute("data-miner-x", "-5.00");

  const rideDown = page.getByRole("button", { name: "Ride elevator down" });
  await expect(rideDown).toBeVisible();
  await rideDown.click();

  await expect
    .poll(async () => Number(await status.getAttribute("data-depth")), {
      timeout: 5_000,
    })
    .toBe(ELEVATOR_SEGMENT_ROWS);
  await expect(canvas).toHaveAttribute("data-miner-x", "-5.00");

  const rideUp = page.getByRole("button", { name: "Ride elevator up" });
  await expect(rideUp).toBeVisible();
  await expect(rideUp).toBeEnabled();
});

test("miner stays at depth when walking sideways (lateral teleport regression)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  // Rows 1-2 are rock-free and hazard-free, so digging down and one
  // lateral dig are guaranteed to succeed regardless of the session seed.
  await digTo(page, 2);
  await expect(status).toHaveAttribute("data-depth", "2");

  // Wait for the eased render position to settle at the dug depth.
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-y")), {
      timeout: 15_000,
    })
    .toBeLessThan(-1.8);

  // Record the highest rendered Y across every frame of the lateral step.
  await page.evaluate(() => {
    const el = document.querySelector("canvas");
    const w = window as unknown as { __maxMinerY: number; __minerRaf: number };
    w.__maxMinerY = Number.NEGATIVE_INFINITY;
    const sample = () => {
      const y = Number(el?.getAttribute("data-miner-y"));
      if (!Number.isNaN(y)) w.__maxMinerY = Math.max(w.__maxMinerY, y);
      w.__minerRaf = requestAnimationFrame(sample);
    };
    sample();
  });

  for (let i = 0; i < 6; i++) {
    await pressMineKey(page, "ArrowLeft");
  }
  // The miner glides one cell left (start col 4 renders at x=0, col 3 at -1)...
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 15_000,
    })
    .toBeLessThan(-0.8);

  const maxY = await page.evaluate(() => {
    const w = window as unknown as { __maxMinerY: number; __minerRaf: number };
    cancelAnimationFrame(w.__minerRaf);
    return w.__maxMinerY;
  });
  // ...without ever lifting toward the surface. The old bug re-applied the
  // JSX position prop on column changes, snapping the rendered Y to 0.
  expect(maxY).toBeLessThan(-1.5);
});

test("workshop sells parts and shows balance (needs storage)", async ({
  page,
  request,
}) => {
  const probe = await request.get("/api/shop");
  test.skip(
    probe.status() === 503,
    "storage not configured in this environment",
  );

  // Parts buying lives inside the Workshop now; the standalone /shop is gone.
  await page.goto("/workshop");
  const shop = page.getByLabel("Parts shop");
  await expect(shop).toBeVisible();
  await expect(shop.getByText("vibes").first()).toBeVisible();
  await expect(shop.getByText("Drive Wheel")).toBeVisible();
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

test("match resolve API returns a deterministic official result", async ({
  request,
}) => {
  const payload = {
    designs: [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN],
    simVersion: SIM_VERSION,
    timeLimitTicks: 600,
  };
  const first = await request.post("/api/match/resolve", { data: payload });
  expect(first.ok()).toBeTruthy();
  const a = await first.json();
  expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
  expect(a.status.over).toBe(true);

  const second = await request.post("/api/match/resolve", { data: payload });
  const b = await second.json();
  expect(b.hash).toBe(a.hash);
});

test("sim verify API returns a stable deterministic hash", async ({
  request,
}) => {
  const first = await request.get("/api/sim/verify?seed=42&steps=300");
  expect(first.ok()).toBeTruthy();
  const a = await first.json();
  expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
  expect(a.simVersion).toBe(SIM_VERSION);

  const second = await request.get("/api/sim/verify?seed=42&steps=300");
  const b = await second.json();
  expect(b.hash).toBe(a.hash);
});
