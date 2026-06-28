import { expect, test } from "@playwright/test";
import {
  digTo,
  dismissReleaseNotes,
  openSettings,
  pressMineKey,
} from "./support/mine-helpers";

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

test("an active mine trip resumes at the same depth after reload", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  await digTo(page, 2);
  await expect(status).toHaveAttribute("data-depth", "2");
  const energyBeforeReload = await status.getAttribute("data-energy");
  expect(energyBeforeReload).toBeTruthy();

  await page.reload();
  await dismissReleaseNotes(page);
  await expect(status).toHaveAttribute("data-depth", "2");
  await expect(status).toHaveAttribute("data-energy", energyBeforeReload ?? "");
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
});
