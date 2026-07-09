import { expect, test } from "@playwright/test";
import {
  awaitMineSceneReady,
  digTo,
  dismissReleaseNotes,
  pressMineKey,
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
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await awaitMineSceneReady(page);

  // Dig a shaft: dug (empty) cells overhead, solid ground below.
  await digTo(page, 3);
  const depthAfterDig = Number(await status.getAttribute("data-depth"));
  expect(depthAfterDig).toBeGreaterThanOrEqual(3);

  // Shift + Down with no plank underfoot is a no-op: it must not mine the
  // way a plain Down does.
  await page.keyboard.press("Shift+ArrowDown");
  await page.waitForTimeout(240);
  expect(Number(await status.getAttribute("data-depth"))).toBe(depthAfterDig);

  // Shift + Up jumps the miner up a row out of the dug shaft.
  await page.keyboard.press("Shift+ArrowUp");
  await expect
    .poll(async () => Number(await status.getAttribute("data-depth")))
    .toBeLessThan(depthAfterDig);
});
