import { expect, test } from "@playwright/test";
import { ciCase } from "./support/ci-case";
import { imageRegionRgbStats } from "./support/image-pixels";
import {
  applyAction,
  awaitMineSceneReady,
  bypassMineRenderer,
  createMine,
  DEFAULT_GEAR,
  dismissReleaseNotes,
  exportDiff,
  installGamepadBackControl,
  MINE_VERSION,
  openSettingsFor,
  pressGamepadBack,
  pressMineKey,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
} from "./support/mine-helpers";

test(
  "mine shows a moving loader and retry when the world stalls",
  ciCase("E2E-MINE-UI-0001", "@render"),
  async ({ page }) => {
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
    const dialog = page.getByRole("dialog", { name: "New in VibeBots" });
    await expect(dialog).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const element = document.elementFromPoint(
            window.innerWidth / 2,
            window.innerHeight / 2,
          );
          return element
            ?.closest('[role="dialog"]')
            ?.getAttribute("aria-labelledby");
        }),
      )
      .toBe("release-notes-title");

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

    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Mine signal lost" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Mine signal lost");
    await expect(alert).toContainText("Your save was not changed");

    retryReady = true;
    await dismissReleaseNotes(page);
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("canvas")).toBeVisible();
    await expect(alert).not.toBeVisible();
  },
);

test(
  "mine falling-rock alert can be dismissed or permanently hidden",
  ciCase("E2E-MINE-UI-0002", "@functional"),
  async ({ page }) => {
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
    await awaitMineSceneReady(page);

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
  },
);

test(
  "mine feedback form submits from settings and closes with gamepad back",
  ciCase("E2E-MINE-UI-0003", "@functional"),
  async ({ page }) => {
    await bypassMineRenderer(page);
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
    const settings = await openSettingsFor(page, "feedback");
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
    const settingsAgain = await openSettingsFor(page, "feedback");
    await settingsAgain.getByRole("button", { name: "Feedback" }).click();
    await expect(dialog).toBeVisible();
    await pressGamepadBack(page);
    await expect(dialog).not.toBeVisible();
  },
);

test(
  "ladder gravity prompt opens mechanic feedback after the fall settles",
  ciCase("E2E-MINE-UI-0004", "@functional"),
  async ({ page }) => {
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
    await awaitMineSceneReady(page);
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
    await dialog
      .getByLabel("Comment")
      .fill("The slide made the shaft clearer.");
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
  },
);

test(
  "mine bag chip opens a scrollable capacity grid",
  ciCase("E2E-MINE-UI-0005", "@functional"),
  async ({ page }) => {
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
    await expect(
      page.getByLabel("Mine status").getByText("Coal x5"),
    ).toHaveCount(0);

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
    await expect(
      dialog.getByText("Stack slots", { exact: true }),
    ).toBeVisible();
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
  },
);

test(
  "the long surface tip fits inside the status chip",
  ciCase("E2E-MINE-UI-0006", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 575, height: 1280 });
    await page.addInitScript(() => {
      const w = window as typeof window & {
        __vibebotsSurfaceTipSequence?: (string | null)[];
        __vibebotsSurfaceTipRotationMs?: number;
      };
      // Frozen on the longest tip: measuring a rotating element races the
      // rotation boundary (a slower first paint made that race real).
      w.__vibebotsSurfaceTipSequence = [
        "Tip: rich ore may need several hits. Every swing still costs battery.",
      ];
      w.__vibebotsSurfaceTipRotationMs = 60_000;
    });
    await page.goto("/mine");
    await dismissReleaseNotes(page);

    const longTip = page.getByText(
      "Tip: rich ore may need several hits. Every swing still costs battery.",
      { exact: true },
    );
    await expect(longTip).toBeVisible({ timeout: 20_000 });
    const box = await longTip.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(575 - 12);
    expect(box?.height ?? 0).toBeGreaterThan(22);
  },
);

test(
  "mine rotates surface game tips and sometimes leaves the slot empty",
  ciCase("E2E-MINE-UI-0007", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 575, height: 1280 });
    const longTip =
      "Tip: rich ore may need several hits. Every swing still costs battery.";
    const shortTip =
      "Tip: press up into solid ground to dig overhead without using a ladder.";
    await page.addInitScript(
      (tips) => {
        const w = window as typeof window & {
          __vibebotsSurfaceTipSequence?: (string | null)[];
          __vibebotsSurfaceTipRotationMs?: number;
        };
        // The sequence is consumed one entry per rotation (then random tips
        // resume), so each phase is padded wide enough that its assertion
        // cannot miss the window even after a slow first paint.
        w.__vibebotsSurfaceTipSequence = [
          tips.long,
          tips.long,
          tips.long,
          tips.long,
          tips.short,
          tips.short,
          tips.short,
          null,
          null,
          null,
          null,
        ];
        w.__vibebotsSurfaceTipRotationMs = 2_000;
      },
      { long: longTip, short: shortTip },
    );
    await page.goto("/mine");
    await dismissReleaseNotes(page);

    // Tips live in the bottom toast lane, not the top status chip (#309).
    const surfaceInfo = page.locator("[data-mine-surface-info='true']");
    await expect(surfaceInfo).toHaveText(longTip, { timeout: 12_000 });
    await expect(surfaceInfo).toHaveText(shortTip, { timeout: 12_000 });
    // An empty slot unmounts the line rather than rendering a blank chip.
    await expect(surfaceInfo).toHaveCount(0, { timeout: 12_000 });
  },
);

test(
  "auto sell result replaces tips and wraps in the status chip",
  ciCase("E2E-MINE-UI-0008", "@functional"),
  async ({ page }) => {
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
    await awaitMineSceneReady(page);

    await pressMineKey(page, "ArrowUp");
    await expect(status).toHaveAttribute("data-depth", "0");
    // The sell result takes the same toast-lane slot the tips rotate through
    // (#309), so it must be the only line there.
    const sellNote = page.locator("[data-mine-surface-info='true']");
    await expect(sellNote).toContainText(/^Sold Coal x17, Copper x9/);
    await page.waitForTimeout(100);
    await expect(sellNote).toContainText(/^Sold Coal x17, Copper x9/);
    await expect(sellNote.getByText(/^Tip:/)).toHaveCount(0);
    const box = await sellNote.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(575 - 12);
    expect(box?.height ?? 0).toBeGreaterThan(22);
  },
);

test(
  "mine loader stays up until the canvas paints, never a black gap",
  ciCase("E2E-MINE-UI-0009", "@render"),
  async ({ page }) => {
    await page.goto("/mine");
    const loader = page.getByRole("status").filter({
      hasText: "Opening the shaft",
    });
    await expect(loader).toBeVisible();
    // The release-notes dialog is a full-page overlay: left up, it would
    // sit inside the canvas screenshot below and skew the pixel check.
    await dismissReleaseNotes(page);

    const shell = page.getByLabel("Mine status");
    // Data can be ready while the canvas is still warming pipelines; the
    // loader must survive that window and only leave once a frame painted.
    await expect(loader).not.toBeVisible({ timeout: 30_000 });
    await expect(shell).toHaveAttribute("data-scene-painted", "true");

    // Rule 10: at the moment the loader leaves, the canvas must be showing
    // real pixels, not the unpainted black buffer the loader used to hide.
    const shot = await page.locator("canvas").first().screenshot();
    const stats = await imageRegionRgbStats(page, shot, {
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
    });
    expect(stats.nearBlackRatio).toBeLessThan(0.85);
  },
);
