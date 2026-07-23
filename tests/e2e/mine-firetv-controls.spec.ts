import { expect, test } from "@playwright/test";
import { TV_SAFE_FRACTION } from "../../src/lib/tv-device";
import { ciCase } from "./support/ci-case";
import {
  awaitMineSceneReady,
  dismissReleaseNotes,
  installGamepadPadControl,
  MINE_KEY_STEP_MS,
  openSettings,
  setGamepadPressed,
} from "./support/mine-helpers";

/**
 * Fire TV remote controls: the Silk browser drives a virtual cursor
 * (D-pad moves the pointer, Select clicks), so a TV session gets a
 * click-first control deck, media-key bindings, gamepad D-pad movement,
 * and a Back button that closes surfaces instead of leaving the game.
 */

const FIRE_TV_SILK_UA =
  "Mozilla/5.0 (Linux; Android 11; AFTMA475B1) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Silk/146.3.4 like Chrome/146.0.7680.165 Safari/537.36";

async function pressRemoteKey(
  page: import("@playwright/test").Page,
  key: string,
  keyCode = 0,
) {
  await page.evaluate(
    ({ remoteKey, legacyCode }) => {
      const options = { key: remoteKey, keyCode: legacyCode, bubbles: true };
      window.dispatchEvent(new KeyboardEvent("keydown", options));
      window.dispatchEvent(new KeyboardEvent("keyup", options));
    },
    { remoteKey: key, legacyCode: keyCode },
  );
}

test.describe("fire tv sessions", () => {
  test.use({
    userAgent: FIRE_TV_SILK_UA,
    viewport: { width: 1280, height: 720 },
  });

  test(
    "TV deck renders and single clicks dig one cell at a time",
    ciCase("E2E-MINE-FIRETV-CONTROLS-0003", "@functional"),
    async ({ page }) => {
      await page.goto("/mine");
      await dismissReleaseNotes(page);
      await awaitMineSceneReady(page);
      const deck = page.locator("[data-tv-controls]");
      await expect(deck).toBeVisible();

      const status = page.getByLabel("Mine status");
      await expect(status).toHaveAttribute("data-depth", "0");
      const down = page.locator("[data-tv-direction='down']");
      for (let i = 0; i < 4; i += 1) {
        await down.click();
        await page.waitForTimeout(MINE_KEY_STEP_MS);
        if (Number(await status.getAttribute("data-depth")) >= 1) break;
      }
      await expect
        .poll(async () => Number(await status.getAttribute("data-depth")))
        .toBeGreaterThanOrEqual(1);
    },
  );

  test(
    "holding Select on a deck button auto-repeats the move",
    ciCase("E2E-MINE-FIRETV-CONTROLS-0004", "@functional"),
    async ({ page }) => {
      await page.goto("/mine");
      await dismissReleaseNotes(page);
      await awaitMineSceneReady(page);
      const status = page.getByLabel("Mine status");
      const left = page.locator("[data-tv-direction='left']");
      const box = await left.boundingBox();
      if (!box) throw new Error("TV deck left button has no bounding box");

      // A held press (cursor parked, Select held) repeats through the
      // shared cadence. Walking left along the boardwalked surface row is
      // deterministic (no dig rolls), so one continuous hold must cover
      // several columns.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(MINE_KEY_STEP_MS * 4);
      await page.mouse.up();
      await expect
        .poll(async () =>
          Number(await status.getAttribute("data-horizontal-distance")),
        )
        .toBeLessThanOrEqual(-2);
    },
  );

  test(
    "channel and transport keys move without using the cursor",
    ciCase("E2E-MINE-FIRETV-CONTROLS-0005", "@functional"),
    async ({ page }) => {
      await page.goto("/mine");
      await dismissReleaseNotes(page);
      await awaitMineSceneReady(page);
      const status = page.getByLabel("Mine status");

      await pressRemoteKey(page, "MediaRewind");
      await expect(status).toHaveAttribute("data-horizontal-distance", "-1");
      await pressRemoteKey(page, "MediaFastForward");
      await expect(status).toHaveAttribute("data-horizontal-distance", "0");

      for (let i = 0; i < 6; i += 1) {
        await pressRemoteKey(page, "ChannelDown");
        await page.waitForTimeout(MINE_KEY_STEP_MS);
        if (Number(await status.getAttribute("data-depth")) >= 1) break;
      }
      await expect
        .poll(async () => Number(await status.getAttribute("data-depth")))
        .toBeGreaterThanOrEqual(1);

      await pressRemoteKey(page, "ChannelUp");
      await expect(status).toHaveAttribute("data-depth", "0");
    },
  );

  test(
    "the shell insets to the overscan safe area and the pause menu fits",
    ciCase("E2E-MINE-FIRETV-CONTROLS-0006", "@functional"),
    async ({ page }) => {
      await page.goto("/mine");
      await dismissReleaseNotes(page);
      await awaitMineSceneReady(page);

      // TVs crop the outer edges of the picture (overscan), so the TV
      // session's shell shrinks to the central 90% and every edge-anchored
      // overlay anchors inside the visible screen.
      const shell = page.locator("[data-mine-shell]");
      await expect(shell).toHaveAttribute("data-tv-safe-area", "on");
      const viewport = page.viewportSize();
      if (!viewport) throw new Error("viewport size unavailable");
      const safeX = Math.round(viewport.width * TV_SAFE_FRACTION);
      const safeY = Math.round(viewport.height * TV_SAFE_FRACTION);
      const box = await shell.boundingBox();
      if (!box) throw new Error("mine shell has no bounding box");
      expect(Math.round(box.x)).toBe(safeX);
      expect(Math.round(box.y)).toBe(safeY);
      expect(Math.round(box.x + box.width)).toBe(viewport.width - safeX);
      expect(Math.round(box.y + box.height)).toBe(viewport.height - safeY);

      // The pause menu (the gear's settings panel) was the reported victim:
      // it hung half off the right side of a Fire TV screen.
      const menu = await openSettings(page);
      const menuBox = await menu.boundingBox();
      if (!menuBox) throw new Error("settings menu has no bounding box");
      expect(menuBox.x).toBeGreaterThanOrEqual(safeX);
      expect(menuBox.y).toBeGreaterThanOrEqual(safeY);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(
        viewport.width - safeX + 1,
      );
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(
        viewport.height - safeY + 1,
      );
    },
  );

  test(
    "Select keeps its focused activation behavior",
    ciCase("E2E-MINE-FIRETV-CONTROLS-0007", "@functional"),
    async ({ page }) => {
      await page.goto("/mine");
      await dismissReleaseNotes(page);
      await awaitMineSceneReady(page);

      await page.getByLabel("Open settings").focus();
      await page.keyboard.press("Enter");
      await expect(
        page.locator("section[aria-label='Settings']"),
      ).toBeVisible();
    },
  );

  test(
    "the remote Back button closes an open menu and stays in the mine",
    ciCase("E2E-MINE-FIRETV-CONTROLS-0008", "@functional"),
    async ({ page }) => {
      await page.goto("/mine");
      await dismissReleaseNotes(page);
      await awaitMineSceneReady(page);

      await page.getByLabel("Open settings").click();
      const menu = page.locator("section[aria-label='Settings']");
      await expect(menu).toBeVisible();

      // Silk's Back button performs a history back; the TV marker turns it
      // into a dismiss instead of leaving the game.
      await page.goBack();
      await expect(menu).toBeHidden();
      await expect(page).toHaveURL(/\/mine/);
    },
  );
});

test.describe("tv override without a TV user agent", () => {
  test(
    "tv=1 forces the deck on for unrecognized TV browsers",
    ciCase("E2E-MINE-FIRETV-CONTROLS-0009", "@functional"),
    async ({ page }) => {
      await page.goto("/mine?tv=1");
      await dismissReleaseNotes(page);
      await awaitMineSceneReady(page);
      await expect(page.locator("[data-tv-controls]")).toBeVisible();
    },
  );
});

test(
  "desktop sessions never see the TV deck and keep a full-bleed shell",
  ciCase("E2E-MINE-FIRETV-CONTROLS-0001", "@functional"),
  async ({ page }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    await awaitMineSceneReady(page);
    await expect(page.locator("[data-tv-controls]")).toHaveCount(0);

    const shell = page.locator("[data-mine-shell]");
    await expect(shell).toHaveAttribute("data-tv-safe-area", "off");
    const box = await shell.boundingBox();
    if (!box) throw new Error("mine shell has no bounding box");
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("viewport size unavailable");
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.y)).toBe(0);
    expect(Math.round(box.width)).toBe(viewport.width);
    expect(Math.round(box.height)).toBe(viewport.height);
  },
);

test(
  "gamepad D-pad digs and releases through the shared cadence",
  ciCase("E2E-MINE-FIRETV-CONTROLS-0002", "@functional"),
  async ({ page }) => {
    await installGamepadPadControl(page);
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    await awaitMineSceneReady(page);
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-depth", "0");

    // Hold D-pad down (button 13) long enough for the cadence to repeat.
    await setGamepadPressed(page, [13]);
    await expect
      .poll(async () => Number(await status.getAttribute("data-depth")), {
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(1);
    await setGamepadPressed(page, []);
    await page.waitForTimeout(MINE_KEY_STEP_MS);
    const settled = Number(await status.getAttribute("data-depth"));

    // Released pad stops the repeat: depth holds steady afterward.
    await page.waitForTimeout(MINE_KEY_STEP_MS * 3);
    expect(Number(await status.getAttribute("data-depth"))).toBe(settled);
  },
);
