import { expect, test } from "@playwright/test";
import { ciCase } from "./support/ci-case";
import {
  awaitMineSceneReady,
  descendLadderShaft,
  dismissReleaseNotes,
  pressMineKey,
  pressMineKeyPaced,
  routeLadderShaftWorld,
  routeStarterMineWorld,
  START_COL,
  setCell,
} from "./support/mine-helpers";

/**
 * Desktop keyboard controls raised as followups (F-059, F-061, F-062):
 * Enter walks into a building, Escape returns from it, and Shift modifies
 * the vertical movement keys (jump / plank drop) without disturbing the
 * plain arrow paths.
 */

test(
  "Enter enters a building and Escape returns to the mine (F-061, F-062)",
  ciCase("E2E-MINE-KEYBOARD-CONTROLS-0001", "@functional"),
  async ({ page }) => {
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

    // The URL changes before the destination's passive effects have to run.
    // Wait on the handler's explicit readiness contract instead of racing it.
    await expect(
      page.getByRole("link", { name: "Back to mine" }),
    ).toHaveAttribute("data-escape-ready", "true");

    // Escape returns to the mine hub (F-062).
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/mine$/);
  },
);

test(
  "Shift modifies the vertical mine keys (F-059)",
  ciCase("E2E-MINE-KEYBOARD-CONTROLS-0002", "@functional"),
  async ({ page }) => {
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
  },
);

// Smoother movement slice: a tap during the cooldown is remembered and
// fires at the next legal time (never faster than holding), the opposite
// tap cancels it, and a held "up" may keep mining but never plants a
// ladder without a fresh press.
// Rapid key taps must be dispatched inside the page in one synchronous
// burst: Playwright's keyboard API pays a protocol round trip per press,
// and even in-page setTimeout gaps dilate to hundreds of ms while the
// scene warms up. Same-tick dispatch guarantees every tap after the first
// lands inside the action cooldown, which is the state under test.
async function tapKeysInPage(
  page: import("@playwright/test").Page,
  keys: string[],
): Promise<void> {
  await page.evaluate((keys) => {
    for (const key of keys) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key }));
    }
  }, keys);
}

test(
  "a tap during the cooldown lands at the next legal time, once",
  ciCase("E2E-MINE-KEYBOARD-CONTROLS-0003", "@functional"),
  async ({ page }) => {
    await routeStarterMineWorld(page, 5151);
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    await awaitMineSceneReady(page);
    const status = page.getByLabel("Mine status");

    // Three same-tick taps: the first moves immediately, the other two
    // collapse into exactly one buffered move at the next legal time.
    await tapKeysInPage(page, ["ArrowRight", "ArrowRight", "ArrowRight"]);
    await expect
      .poll(async () =>
        Number(await status.getAttribute("data-horizontal-distance")),
      )
      .toBe(2);
    await page.waitForTimeout(900);
    expect(Number(await status.getAttribute("data-horizontal-distance"))).toBe(
      2,
    );
  },
);

test(
  "the opposite tap cancels a buffered move",
  ciCase("E2E-MINE-KEYBOARD-CONTROLS-0004", "@functional"),
  async ({ page }) => {
    await routeStarterMineWorld(page, 5252);
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    await awaitMineSceneReady(page);
    const status = page.getByLabel("Mine status");

    await tapKeysInPage(page, ["ArrowRight", "ArrowRight", "ArrowLeft"]);
    // The first right moves; the second buffers; the left erases it. The
    // distance must settle at 1 and never reach 2 (which an executed
    // buffered right, or an uncancelled left-then-drift, would produce).
    await expect
      .poll(async () =>
        Number(await status.getAttribute("data-horizontal-distance")),
      )
      .toBe(1);
    await page.waitForTimeout(1400);
    expect(Number(await status.getAttribute("data-horizontal-distance"))).toBe(
      1,
    );
  },
);

test(
  "holding up keeps mining but never plants a ladder",
  ciCase("E2E-MINE-KEYBOARD-CONTROLS-0005", "@functional"),
  async ({ page }) => {
    // A shaft below the spawn and a side pocket with a dirt ceiling: the
    // miner drops in, steps into the pocket, and holds "up" at the ceiling.
    await routeStarterMineWorld(page, 5353, (mine) => {
      setCell(mine, START_COL, 1, { kind: "empty" });
      setCell(mine, START_COL, 2, { kind: "empty" });
      setCell(mine, START_COL + 1, 2, { kind: "empty" });
      setCell(mine, START_COL + 1, 1, { kind: "dirt" });
    });
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    await awaitMineSceneReady(page);
    const status = page.getByLabel("Mine status");

    await pressMineKeyPaced(page, "ArrowDown");
    await expect(status).toHaveAttribute("data-depth", "2");
    await pressMineKeyPaced(page, "ArrowRight");
    const laddersBefore = Number(await status.getAttribute("data-ladders"));

    // Hold up long enough to dig the ceiling open and for several would-be
    // repeats after it opens: the dig lands, the climb never does.
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(3200);
    await page.keyboard.up("ArrowUp");
    await expect(status).toHaveAttribute("data-depth", "2");
    expect(Number(await status.getAttribute("data-ladders"))).toBe(
      laddersBefore,
    );

    // A fresh press climbs and plants the ladder deliberately.
    await page.waitForTimeout(700);
    await page.keyboard.press("ArrowUp");
    await expect(status).toHaveAttribute("data-depth", "1");
    expect(Number(await status.getAttribute("data-ladders"))).toBe(
      laddersBefore - 1,
    );
  },
);
