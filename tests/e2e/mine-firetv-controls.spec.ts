import { expect, test } from "@playwright/test";
import {
  awaitMineSceneReady,
  dismissReleaseNotes,
  installGamepadPadControl,
  MINE_KEY_STEP_MS,
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

test.describe("fire tv sessions", () => {
  test.use({
    userAgent: FIRE_TV_SILK_UA,
    viewport: { width: 1280, height: 720 },
  });

  test("TV deck renders and single clicks dig one cell at a time", async ({
    page,
  }) => {
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
  });

  test("holding Select on a deck button auto-repeats the move", async ({
    page,
  }) => {
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
  });

  test("remote media keys zoom the camera without touching the HUD", async ({
    page,
  }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    await awaitMineSceneReady(page);
    const zoom = page.getByLabel("Zoom controls");
    const before = await zoom.getAttribute("data-camera-zoom");

    // Rewind zooms out; if the camera already sits at the out stop,
    // Fast Forward must move it instead. Either way the zoom reacts.
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "MediaRewind", bubbles: true }),
      );
    });
    await page.waitForTimeout(120);
    let after = await zoom.getAttribute("data-camera-zoom");
    if (after === before) {
      await page.evaluate(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "MediaFastForward",
            bubbles: true,
          }),
        );
      });
      await page.waitForTimeout(120);
      after = await zoom.getAttribute("data-camera-zoom");
    }
    expect(after).not.toBe(before);
  });

  test("the remote Back button closes an open menu and stays in the mine", async ({
    page,
  }) => {
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
  });
});

test.describe("tv override without a TV user agent", () => {
  test("tv=1 forces the deck on for unrecognized TV browsers", async ({
    page,
  }) => {
    await page.goto("/mine?tv=1");
    await dismissReleaseNotes(page);
    await awaitMineSceneReady(page);
    await expect(page.locator("[data-tv-controls]")).toBeVisible();
  });
});

test("desktop sessions never see the TV deck", async ({ page }) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await awaitMineSceneReady(page);
  await expect(page.locator("[data-tv-controls]")).toHaveCount(0);
});

test("gamepad D-pad digs and releases through the shared cadence", async ({
  page,
}) => {
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
});
