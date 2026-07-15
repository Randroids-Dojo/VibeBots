import { expect, test } from "@playwright/test";
import {
  createMine,
  DEFAULT_GEAR,
  digTo,
  dismissReleaseNotes,
  exportDiff,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
} from "./support/mine-helpers";

// Capture driver for bunker-arc playtest evidence (F-087), not a smoke
// test: it saves screenshots of the repair and skin loop into the
// directory named by PLAYTEST_CAPTURE_DIR. Server responses are simulated
// at the API boundary (same harness as mine-bunker.spec.ts) so the run
// needs no Postgres; the client experience is the real build.
// Run: PLAYTEST_CAPTURE_DIR=docs/reviews/<session>/captures \
//   pnpm exec playwright test bunker-arc-capture
const OUT = process.env.PLAYTEST_CAPTURE_DIR;

test("bunker arc capture run", async ({ page }) => {
  test.skip(!OUT, "capture-only driver: set PLAYTEST_CAPTURE_DIR to run");
  test.setTimeout(180_000);
  const shot = (name: string) =>
    page.screenshot({ path: `${OUT}/bunker-arc-${name}.png` });

  const mine = createMine(7171, DEFAULT_GEAR, STARTING_CONSUMABLES);
  for (let row = 1; row <= 5; row++) {
    for (let offset = -3; offset <= 3; offset++) {
      setCell(mine, START_COL + offset, row, { kind: "empty" });
    }
    setCell(mine, START_COL, row, { kind: "empty", ladder: true });
  }
  const damagedParts = [-3, -2, -1, 1, 2, 3].map((offset) => ({
    partId: "wall-panel",
    col: START_COL + offset,
    row: 2,
    durability: offset === -3 ? 45 : 90,
  }));
  const view = {
    bunker: {
      footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
      core: { col: START_COL, row: 3, durability: 140 },
      parts: damagedParts,
      skin: "steelworks",
      skinsOwned: [] as string[],
    },
    inventory: {
      "wall-panel": 2,
      "floor-panel": 2,
      "roof-panel": 2,
      "door-panel": 1,
      "basic-turret": 0,
      "floor-spikes": 0,
    },
    player: {
      balance: 250,
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
  let current = structuredClone(view);
  await page.route("**/api/mine/world", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeSlot: 1,
        seed: 7171,
        tripIndex: 0,
        diff: exportDiff(mine),
      }),
    }),
  );
  await page.route("**/api/bunker", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(current),
    }),
  );
  await page.route("**/api/bunker/repair", (route) => {
    current = structuredClone(current);
    current.bunker.core.durability = 160;
    current.bunker.parts = current.bunker.parts.map((part) => ({
      ...part,
      durability: 90,
    }));
    current.player = { ...current.player, balance: current.player.balance - 7 };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(current),
    });
  });
  await page.route("**/api/bunker/skin", (route) => {
    const { skinId } = route.request().postDataJSON() as { skinId: string };
    current = structuredClone(current);
    current.bunker.skin = skinId;
    if (
      skinId !== "steelworks" &&
      !current.bunker.skinsOwned.includes(skinId)
    ) {
      current.bunker.skinsOwned = [...current.bunker.skinsOwned, skinId];
      current.player = {
        ...current.player,
        balance: current.player.balance - (skinId === "gilded" ? 120 : 80),
      };
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(current),
    });
  });

  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/mine");
  await shot("01-release-note");
  await dismissReleaseNotes(page);
  await digTo(page, 2);
  await page.waitForTimeout(600);
  await shot("02-claim-steelworks");

  await page.getByRole("button", { name: "Open bunker status" }).click();
  const builder = page.getByRole("region", { name: "Bunker status" });
  await expect(builder).toBeVisible();
  await page.waitForTimeout(400);
  await shot("03-sheet-damaged");

  const repair = builder.getByRole("button", { name: /Repair bunker/ });
  await repair.click();
  await expect(repair).toHaveCount(0);
  await shot("04-repaired");

  const picker = builder.getByRole("group", { name: "Bunker skins" });
  await picker.getByRole("button", { name: "Verdant (80v)" }).click();
  await expect(picker.getByRole("button", { name: "Verdant" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await builder.getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(600);
  await shot("05-skin-verdant-world");

  await page.getByRole("button", { name: "Open bunker status" }).click();
  await expect(builder).toBeVisible();
  await picker.getByRole("button", { name: "Gilded (120v)" }).click();
  await expect(picker.getByRole("button", { name: "Gilded" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await builder.getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(600);
  await shot("06-skin-gilded-world");
});
