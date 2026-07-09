import { expect, test } from "@playwright/test";
import {
  awaitMineSceneReady,
  descendLadderShaft,
  dismissReleaseNotes,
  pressMineKey,
  routeLadderShaftWorld,
} from "./support/mine-helpers";

/**
 * Desktop keyboard controls raised as followups (F-059, F-061, F-062):
 * Enter walks into a building, Escape returns from it, and Shift modifies
 * the vertical movement keys (jump / plank drop) without disturbing the
 * plain arrow paths.
 */

test("Enter enters a building and Escape returns to the mine (F-061, F-062)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await awaitMineSceneReady(page);
  await expect(status).toHaveAttribute("data-depth", "0");

  // Walk left onto the Workshop column until its Enter prompt appears.
  const prompt = page.getByRole("button", { name: "Enter Workshop" });
  for (let i = 0; i < 72; i++) {
    if (await prompt.isVisible().catch(() => false)) break;
    await pressMineKey(page, "ArrowLeft");
  }
  await expect(prompt).toBeVisible();

  // The Enter key routes into the building (F-061).
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/workshop$/);

  // Escape returns to the mine hub (F-062).
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/mine$/);
});

test("Shift modifies the vertical mine keys (F-059)", async ({ page }) => {
  // A carved ladder shaft: empty cells overhead and a supported stance, so
  // the descent is fast and deterministic (no mining) on the harness.
  await routeLadderShaftWorld(page, 4242, 6);
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await descendLadderShaft(page, 4);
  const depth = Number(await status.getAttribute("data-depth"));
  expect(depth).toBeGreaterThanOrEqual(4);

  // Shift + Down with no plank underfoot is a no-op: it must not move the
  // miner the way a plain Down does.
  await page.keyboard.press("Shift+ArrowDown");
  await page.waitForTimeout(240);
  expect(Number(await status.getAttribute("data-depth"))).toBe(depth);

  // Shift + Up jumps the miner up a row out of the shaft.
  await page.keyboard.press("Shift+ArrowUp");
  await expect
    .poll(async () => Number(await status.getAttribute("data-depth")))
    .toBeLessThan(depth);
});
