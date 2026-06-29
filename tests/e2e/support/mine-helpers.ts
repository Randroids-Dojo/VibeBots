import { expect, type Page } from "@playwright/test";
import packageJson from "../../../package.json";
import { getAppRelease } from "../../../src/lib/app-release";
import {
  applyAction,
  createMine,
  DEFAULT_GEAR,
  ELEVATOR_COL,
  ELEVATOR_SEGMENT_ROWS,
  exportDiff,
  MINE_VERSION,
  type MineState,
  returnEnergyCost,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
} from "../../../src/sim/mine";

export const MINE_KEY_CADENCE_MS = 190;
export const APP_VERSION_PATTERN = new RegExp(
  `^${packageJson.version.replaceAll(".", "\\.")}([.+]|$)`,
);
export const CURRENT_RELEASE_NOTICE_ID = getAppRelease().noticeId;

export async function pressMineKey(
  page: Page,
  key: "ArrowDown" | "ArrowUp" | "ArrowLeft" | "ArrowRight",
): Promise<void> {
  await page.keyboard.press(key);
  await page.waitForTimeout(MINE_KEY_CADENCE_MS);
}

export async function pressMineKeyUntilStatus(
  page: Page,
  key: "ArrowDown" | "ArrowUp" | "ArrowLeft" | "ArrowRight",
  attribute: string,
  value: string,
): Promise<void> {
  const status = page.getByLabel("Mine status");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await pressMineKey(page, key);
    if ((await status.getAttribute(attribute)) === value) return;
  }
  await expect(status).toHaveAttribute(attribute, value);
}

export async function touchDrag(
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

export async function touchHoldDrag(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
): Promise<() => Promise<void>> {
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
  return async () => {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await client.detach();
  };
}

export async function touchPinchOut(
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
export async function digTo(page: Page, depth: number): Promise<void> {
  const status = page.getByLabel("Mine status");
  for (let i = 0; i < 8 * depth + 8; i++) {
    if (Number(await status.getAttribute("data-depth")) >= depth) return;
    await pressMineKey(page, "ArrowDown");
  }
}

/** Standing on a stall shows a prompt; tap it to open the menu. Returns
 * the menu region. Stalls no longer auto-open on walk-by. */
export async function openStall(
  page: Page,
  name: string,
  direction?: "ArrowLeft" | "ArrowRight",
) {
  const prompt = page.getByRole("button", { name: `Open ${name}` });
  if (direction && !(await prompt.isVisible().catch(() => false))) {
    await walkToStallPrompt(page, direction, name);
  }
  await expect(prompt).toBeVisible();
  await prompt.click();
  const sheet = page.getByRole("region", { name, exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
}

export async function walkToStallPrompt(
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

export async function expectSurfacePromptBottomClearance(
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

export async function expectMineShellViewportLocked(page: Page): Promise<void> {
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

export async function installStandaloneVisualViewport(
  page: Page,
): Promise<void> {
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

export async function expectRegionHorizontalBounds(
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
export async function enterBuilding(
  page: Page,
  key: "ArrowLeft" | "ArrowRight",
  name: string,
): Promise<void> {
  const prompt = page.getByRole("button", { name: `Enter ${name}` });
  for (let i = 0; i < 72; i++) {
    if (await prompt.isVisible().catch(() => false)) break;
    await pressMineKey(page, key);
  }
  await expect(prompt).toBeVisible();
  await prompt.click();
}

export async function walkUntilBaseIndicator(page: Page) {
  const indicator = page.getByRole("button", { name: "Base is left" });
  for (let i = 0; i < 72; i++) {
    if (await indicator.isVisible().catch(() => false)) break;
    await pressMineKey(page, "ArrowRight");
  }
  await expect(indicator).toBeVisible();
  return indicator;
}

export async function routeStarterMineWorld(
  page: Page,
  seed: number,
  setup?: (mine: MineState) => void,
): Promise<void> {
  const mine = createMine(seed, DEFAULT_GEAR, STARTING_CONSUMABLES);
  setup?.(mine);
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
}

/** Swing a lateral direction until the rendered miner crosses targetX. */
export async function digLateral(
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

export async function dismissReleaseNotes(page: Page): Promise<void> {
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

export async function openSettings(page: Page) {
  const settings = page.getByRole("region", { name: "Settings" });
  if (!(await settings.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Open settings" }).click();
  }
  await expect(settings).toBeVisible();
  return settings;
}

export async function speedUpVersionRefreshChecks(page: Page): Promise<void> {
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

export async function installGamepadBackControl(page: Page): Promise<void> {
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

export async function pressGamepadBack(page: Page): Promise<void> {
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

export async function countRedPixels(
  page: Page,
  image: Buffer,
): Promise<number> {
  return countPixels(page, image, "red");
}

export async function countRaidXpPixels(
  page: Page,
  image: Buffer,
): Promise<number> {
  return countPixels(page, image, "raidXp");
}

async function countPixels(
  page: Page,
  image: Buffer,
  mode: "red" | "raidXp",
): Promise<number> {
  return page.evaluate(
    async ({ base64, mode }) => {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () =>
          reject(new Error("canvas screenshot decode failed"));
        img.src = `data:image/png;base64,${base64}`;
      });
      const scratch = document.createElement("canvas");
      scratch.width = img.width;
      scratch.height = img.height;
      const ctx = scratch.getContext("2d");
      if (!ctx) return 0;
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, scratch.width, scratch.height).data;
      const bounds =
        mode === "raidXp"
          ? {
              left: scratch.width * 0.25,
              right: scratch.width * 0.58,
              top: scratch.height * 0.34,
              bottom: scratch.height * 0.68,
            }
          : {
              left: 0,
              right: scratch.width,
              top: 0,
              bottom: scratch.height,
            };
      const isRedPixel = (r: number, g: number, b: number, a: number) =>
        r > 210 && g < 90 && b < 90 && a > 180;
      const isRaidXpPixel = (r: number, g: number, b: number, a: number) => {
        const cyan = b > 100 && g > 110 && r < 150 && a > 180;
        const gold = r > 120 && g > 95 && b < 110 && a > 180;
        return cyan || gold;
      };
      const shouldCount = mode === "red" ? isRedPixel : isRaidXpPixel;
      let count = 0;
      for (
        let y = Math.floor(bounds.top);
        y < Math.ceil(bounds.bottom);
        y += 1
      ) {
        for (
          let x = Math.floor(bounds.left);
          x < Math.ceil(bounds.right);
          x += 1
        ) {
          const i = (y * scratch.width + x) * 4;
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          const a = pixels[i + 3];
          if (shouldCount(r, g, b, a)) count++;
        }
      }
      return count;
    },
    { base64: image.toString("base64"), mode },
  );
}

export type { MineAction, MineState } from "../../../src/sim/mine";
export {
  applyAction,
  createMine,
  DEFAULT_GEAR,
  ELEVATOR_COL,
  ELEVATOR_SEGMENT_ROWS,
  exportDiff,
  MINE_VERSION,
  returnEnergyCost,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
};
