import { expect, test } from "@playwright/test";
import { imagePixelDifferenceRatio } from "./support/image-pixels";
import {
  awaitMineSceneReady,
  digTo,
  dismissReleaseNotes,
  START_COL,
} from "./support/mine-helpers";

/** The banked-bunker view the walkable-viewer flow runs against: a
 * 7x5 claim around the miner's dig column with one placed wall. */
const FP_BUNKER_VIEW = {
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
    "wall-panel": 6,
    "floor-panel": 4,
    "roof-panel": 4,
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

test("first-person bunker viewer walks, looks, jumps, and exits in place", async ({
  page,
}) => {
  // Software-GL runners compile the fp scene slowly, and the test
  // decodes several full screenshots for the motion proof.
  test.setTimeout(180_000);
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FP_BUNKER_VIEW),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);

  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-fp-mode", "0");
  const depthBefore = await status.getAttribute("data-depth");
  const distanceBefore = await status.getAttribute("data-horizontal-distance");
  const energyBefore = await status.getAttribute("data-energy");
  expect(depthBefore).toBe("1");

  // Enter from the toolbelt (the miner stands inside the claim).
  const enterButton = page.getByTestId("bunker-fp-enter");
  await expect(enterButton).toBeVisible();
  await enterButton.click();
  await expect(status).toHaveAttribute("data-fp-mode", "1");

  // The fp canvas replaces the 2D canvas and starts publishing the rig
  // probes once its compile gate opens.
  const canvas = page.locator("canvas");
  await expect
    .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
      timeout: 45_000,
    })
    .not.toBeNull();
  await expect(
    page.getByRole("region", { name: "Bunker build tool" }),
  ).toHaveCount(0);
  await expect
    .poll(async () => canvas.getAttribute("data-fp-grounded"), {
      timeout: 20_000,
    })
    .toBe("1");
  // Spawn: the miner's column maps to local x 3 on the tunnel plane,
  // feet on the floor (eye 0.22), facing -z into the rock.
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fp-eye-x")))
    .toBeCloseTo(3, 1);

  // Walk right (strafe +x): the eye must actually travel.
  await page.keyboard.down("d");
  const walkFrameA = await canvas.screenshot();
  await page.waitForTimeout(90);
  const walkFrameB = await canvas.screenshot();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fp-eye-x")), {
      timeout: 15_000,
    })
    .toBeGreaterThan(3.6);
  await page.keyboard.up("d");
  // Rule 10 motion proof: consecutive frames during the held walk show
  // different pixels, not just a moving diagnostic number.
  expect(
    await imagePixelDifferenceRatio(page, walkFrameA, walkFrameB),
  ).toBeGreaterThan(0.00005);

  // And back left.
  const xAfterRight = Number(await canvas.getAttribute("data-fp-eye-x"));
  await page.keyboard.down("a");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fp-eye-x")), {
      timeout: 15_000,
    })
    .toBeLessThan(xAfterRight - 0.5);
  await page.keyboard.up("a");

  // Look: the one-shot test hook aims the camera; the rig consumes it
  // next frame and reports the yaw probe.
  await page.evaluate(() => {
    (window as unknown as { __vibebotsFp?: { setYaw?: number } }).__vibebotsFp =
      { setYaw: 1.57 };
  });
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fp-yaw")), {
      timeout: 10_000,
    })
    .toBeCloseTo(1.57, 1);

  // Jump: the eye rises past the walk height and lands grounded again.
  // Sample fast (the airborne window is about half a second) and
  // re-press periodically in case a loaded runner missed the arc.
  await page.keyboard.press("Space");
  let jumpSamples = 0;
  await expect
    .poll(
      async () => {
        jumpSamples += 1;
        if (jumpSamples % 20 === 0) await page.keyboard.press("Space");
        return Number(await canvas.getAttribute("data-fp-eye-y"));
      },
      { timeout: 20_000, intervals: [60] },
    )
    .toBeGreaterThan(0.7);
  await expect
    .poll(async () => canvas.getAttribute("data-fp-grounded"), {
      timeout: 10_000,
    })
    .toBe("1");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fp-eye-y")))
    .toBeCloseTo(0.22, 1);

  // Exit restores the 2D mine exactly where the miner stood.
  await page.getByRole("button", { name: "Exit bunker" }).click();
  await expect(status).toHaveAttribute("data-fp-mode", "0");
  await awaitMineSceneReady(page);
  await expect
    .poll(async () => canvas.getAttribute("data-miner-x"), {
      timeout: 45_000,
    })
    .not.toBeNull();
  await expect(status).toHaveAttribute("data-depth", depthBefore ?? "1");
  await expect(status).toHaveAttribute(
    "data-horizontal-distance",
    distanceBefore ?? "0",
  );
  await expect(status).toHaveAttribute("data-energy", energyBefore ?? "");
  await expect(page.getByTestId("bunker-fp-enter")).toBeVisible();
});

test("second Escape leaves the first-person view", async ({ page }) => {
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FP_BUNKER_VIEW),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);
  await page.getByTestId("bunker-fp-enter").click();
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-fp-mode", "1");
  const canvas = page.locator("canvas");
  await expect
    .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
      timeout: 45_000,
    })
    .not.toBeNull();
  // Headless runs never hold pointer lock, so one Escape exits the
  // mode outright (in play, a locked pointer consumes the first).
  await page.keyboard.press("Escape");
  await expect(status).toHaveAttribute("data-fp-mode", "0");
  await awaitMineSceneReady(page);
});

test("the first-person entry hides while a failed raid blocks editing", async ({
  page,
}) => {
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...FP_BUNKER_VIEW,
        bunker: {
          ...FP_BUNKER_VIEW.bunker,
          core: { col: START_COL, row: 3, durability: 128 },
        },
        activeRaid: {
          raidId: "raid-fp-gate",
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
      }),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);

  // Editing is blocked after the failed raid: no toolbelt, no Enter
  // affordance anywhere, and the panel offers no 3D row either.
  await expect(
    page.getByRole("region", { name: "Bunker build tool" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("bunker-fp-enter")).toHaveCount(0);
  await page.getByRole("button", { name: "Open bunker status" }).click();
  const builder = page.getByRole("region", { name: "Bunker status" });
  await expect(builder).toContainText("Miner killed");
  await expect(page.getByTestId("bunker-fp-enter-panel")).toHaveCount(0);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-fp-mode", "0");
});
