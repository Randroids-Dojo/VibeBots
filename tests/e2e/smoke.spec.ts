import { expect, type Page, test } from "@playwright/test";

/** Multi-hit digging (REQ-013): swing down until the depth is reached. */
async function digTo(page: Page, depth: number): Promise<void> {
  const status = page.getByLabel("Mine status");
  for (let i = 0; i < 8 * depth + 8; i++) {
    if (Number(await status.getAttribute("data-depth")) >= depth) return;
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(60);
  }
}

/** Standing on a stall shows a prompt; tap it to open the menu. Returns
 * the menu region. Stalls no longer auto-open on walk-by. */
async function openStall(page: Page, name: string) {
  const prompt = page.getByRole("button", { name: `Open ${name}` });
  await expect(prompt).toBeVisible();
  await prompt.click();
  const sheet = page.getByRole("region", { name, exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Walk the surface toward a destination building until its Enter prompt
 * appears, then tap it. Presses are paced past the glide and the loop
 * tolerates the odd dropped synthetic key (it stops on the prompt, not a
 * fixed step count). */
async function enterBuilding(
  page: Page,
  key: "ArrowLeft" | "ArrowRight",
  name: string,
): Promise<void> {
  const prompt = page.getByRole("button", { name: `Enter ${name}` });
  for (let i = 0; i < 16; i++) {
    if (await prompt.isVisible().catch(() => false)) break;
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  }
  await expect(prompt).toBeVisible();
  await prompt.click();
}

/** Swing a lateral direction until the rendered miner crosses targetX. */
async function digLateral(
  page: Page,
  key: "ArrowLeft" | "ArrowRight",
  pastX: number,
): Promise<void> {
  const canvas = page.locator("canvas");
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
    const x = Number(await canvas.getAttribute("data-miner-x"));
    if (key === "ArrowLeft" ? x < pastX : x > pastX) return;
  }
}

async function dismissReleaseNotes(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "New in VibeBots" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "Got it" }).click();
  }
  await expect(dialog).not.toBeVisible();
}

import { SIM_VERSION } from "../../src/sim/constants";
import { CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN } from "../../src/sim/design";

test("arena page renders a moving match (Rule 10 motion QA)", async ({
  page,
}) => {
  await page.goto("/arena");

  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  // The match HUD must render alongside the arena.
  await expect(page.getByText("Brawler", { exact: true })).toBeVisible();
  await expect(page.getByText("Rammer", { exact: true })).toBeVisible();

  // Every entered screen returns to the mine hub (the top nav is gone).
  await expect(page.getByRole("link", { name: "Back to mine" })).toBeVisible();

  const stage = page.locator("[data-sim-tick]");
  await expect
    .poll(async () => Number(await stage.getAttribute("data-sim-tick")), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  const tickBefore = Number(await stage.getAttribute("data-sim-tick"));
  const shotBefore = await canvas.screenshot();

  await page.waitForTimeout(700);

  // Assumes the match outlasts the sample window (matches run ~60s and the
  // test samples within the first seconds). If tuning ever makes matches end
  // near-instantly, the exhibition restart resets the tick and this flakes.
  const tickAfter = Number(await stage.getAttribute("data-sim-tick"));
  const shotAfter = await canvas.screenshot();

  // The sim tick must advance and the visible pixels must actually change.
  expect(tickAfter).toBeGreaterThan(tickBefore);
  expect(Buffer.compare(shotBefore, shotAfter)).not.toBe(0);
});

test("workshop builds and undoes parts", async ({ page }) => {
  await page.goto("/workshop");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to mine" })).toBeVisible();
  await expect(page.getByText("My Bot: 1 part", { exact: true })).toBeVisible();

  const palette = page.getByLabel("Part palette");
  await palette
    .locator("div")
    .filter({ hasText: "Drive Wheel" })
    .getByRole("button", { name: "Add" })
    .click();
  await expect(page.getByText("My Bot: 2 parts")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("My Bot: 1 part", { exact: true })).toBeVisible();

  // Test arena (REQ-009): fight the current bot against the CPU Brawler.
  await page.getByRole("button", { name: "Test fight vs Brawler" }).click();
  await expect(page.getByText("My Bot", { exact: true })).toBeVisible();
  await expect(page.getByText("Brawler", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to build" }).click();
  await expect(page.getByLabel("Part palette")).toBeVisible();
});

test("mine digs and tracks depth and energy", async ({ page }) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.locator("canvas")).toBeVisible();
  // The HUD exposes the sim numbers as data attributes (REQ-024): the
  // chip copy can change, the test surface cannot.
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");
  await expect(status).toContainText("Topsoil");
  // The wallet is always on the HUD now (exposed for tests; empty when
  // storage is offline, a number otherwise).
  expect(await status.getAttribute("data-wallet")).not.toBeNull();

  // Blocks soak multiple swings now (REQ-013); dig through row 1.
  await digTo(page, 1);
  await expect(status).toHaveAttribute("data-depth", "1");
  // The block's swing total preserves the old economy: a dirt or ore
  // block costs 1.0 in total (a rare cache costs 1.5).
  const energy = Number(await status.getAttribute("data-energy"));
  expect(energy).toBeLessThanOrEqual(59.0);
  expect(energy).toBeGreaterThanOrEqual(58.5);
  // The climb estimate prices ladders as well as energy (REQ-020).
  await expect(status).toHaveAttribute("data-climb-ladders", "1");

  // Climbing out consumes a provisioned ladder (REQ-020).
  await page.keyboard.press("ArrowUp");
  await expect(status).toHaveAttribute("data-depth", "0");
  // Banking on the surface refills the lamp.
  await expect(status).toHaveAttribute("data-energy", "60.0");

  // Consumable controls exist even when empty (REQ-016); a scripted
  // edit once shipped without them, so the smoke pins their presence.
  await expect(
    page.getByRole("button", { name: /Dynamite \(\d+\)/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Recall \(\d+\)/ }),
  ).toBeVisible();
  await expect(status).toHaveAttribute("data-ladders", /\d+/);
});

test("home redirects to the mine hub", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/mine$/);
});

test("village buildings enter the workshop and arena (REQ-021)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // The Workshop building stands left of the shaft; standing on it offers
  // an Enter prompt that routes there (not a stall sheet).
  await enterBuilding(page, "ArrowLeft", "Workshop");
  await expect(page).toHaveURL(/\/workshop$/);
  // The workshop returns to the mine hub.
  await page.getByRole("link", { name: "Back to mine" }).click();
  await expect(page).toHaveURL(/\/mine$/);

  // The Battles building stands right of the shaft. A fresh load resets the
  // miner to the shaft so the walk starts from a known spot.
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(status).toHaveAttribute("data-depth", "0");
  await enterBuilding(page, "ArrowRight", "Battles");
  await expect(page).toHaveURL(/\/arena$/);
});

test("mine shows the backfilled release note once to a fresh browser", async ({
  page,
}) => {
  await page.goto("/mine");
  const dialog = page.getByRole("dialog", { name: "New in VibeBots" });
  await expect(dialog).toBeVisible();
  const version = await dialog.getAttribute("data-app-version");
  const noteId = await dialog.getAttribute("data-release-note-id");
  expect(version).toBeTruthy();
  expect(noteId).toBeTruthy();
  await expect(dialog).toContainText("Thanks for the feedback.");
  await expect(dialog.locator("li")).toHaveCount(6);
  await expect(dialog.locator("li").first()).toContainText("Falling rocks");
  await expect(dialog.locator("li").nth(1)).toContainText("Supply Depot");

  await dialog.getByRole("button", { name: "Got it" }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("vibebots-release-notes-dismissed-id"),
    ),
  ).toBe(noteId);

  await page.reload();
  await expect(dialog).not.toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Release notes" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Thanks for the feedback.");
  await expect(dialog.locator("li")).toHaveCount(6);
  await expect(dialog.locator("li").first()).toContainText("Falling rocks");
  await expect(dialog.locator("li").nth(1)).toContainText("Supply Depot");
  await dialog.getByRole("button", { name: "Got it" }).click();
  await expect(dialog).not.toBeVisible();
});

test("ladders count as support: no plank spent crossing the shaft mouth (REQ-022)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");
  // Trips pack 4 free planks.
  await expect(status).toHaveAttribute("data-planks", "4");

  // Dig a two-deep shaft, climb out one (planting a ladder in the cell
  // below), tunnel one cell left, then step back across the shaft
  // mouth: the ladder top under the step is support, so the crossing
  // must NOT consume a plank (the reported bug burned one here).
  await digTo(page, 2);
  await expect(status).toHaveAttribute("data-depth", "2");
  await page.keyboard.press("ArrowUp");
  await expect(status).toHaveAttribute("data-depth", "1");
  await digLateral(page, "ArrowLeft", -0.8);
  await page.keyboard.press("ArrowRight");
  await expect(status).toHaveAttribute("data-ladders", "7");
  await expect(status).toHaveAttribute("data-planks", "4");
});

test("thumbstick spawns where pressed and drives digging (REQ-023)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // Game text never selects (the mobile long-press copy/share bug).
  expect(
    await page.evaluate(() => getComputedStyle(document.body).userSelect),
  ).toBe("none");

  // Fine-pointer devices keep the keyboard mention in the hint.
  await expect(page.getByText(/drag anywhere to move/)).toContainText("WASD");

  // Press on open ground right of the panels: the stick appears there.
  await page.mouse.move(900, 380);
  await page.mouse.down();
  await page.mouse.move(900, 450, { steps: 5 });
  await expect(page.locator("[data-joystick]")).toBeVisible();

  // Holding past the deadzone fires immediately, then auto-repeats.
  await expect
    .poll(async () => Number(await status.getAttribute("data-depth")), {
      timeout: 12_000,
    })
    .toBeGreaterThanOrEqual(2);

  await page.mouse.up();
  await expect(page.locator("[data-joystick]")).not.toBeVisible();
});

test("abandoning a stuck trip hauls up and forfeits the carry (REQ-025)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");
  const abandon = page.getByRole("button", { name: "Abandon trip" });
  await expect(abandon).toBeDisabled();

  await digTo(page, 1);
  await expect(status).toHaveAttribute("data-depth", "1");
  await expect(abandon).toBeEnabled();

  // Two-tap confirm: the first tap arms, the second fires (the window
  // is 8s, which covers slow CI between two awaited clicks).
  await abandon.click();
  await expect(abandon).toContainText("Sure?");
  await abandon.click();
  await expect(status).toHaveAttribute("data-depth", "0", {
    timeout: 15_000,
  });
  await expect(
    page.getByLabel("Dismiss trip report").getByText("Abandoned the dig"),
  ).toBeVisible();
  // Dismiss the trip report.
  await page.getByLabel("Dismiss trip report").click();
});

test.describe("phone viewport", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

  test("control copy never mentions the keyboard on touch devices", async ({
    page,
  }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const hint = page.getByText(/drag anywhere to move/);
    await expect(hint).toBeVisible();
    await expect(hint).not.toContainText("WASD");
  });

  test("camera pans laterally so mining left stays on screen", async ({
    page,
  }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    const canvas = page.locator("canvas");
    await expect(status).toHaveAttribute("data-depth", "0");

    // Dig down one, then tunnel left three: on a 390px-wide portrait
    // viewport the half-width is ~2.6 world units, so without lateral
    // camera tracking the bot at x=-3 left the screen entirely (the
    // reported "horizontal mining does not update the screen").
    await digTo(page, 1);
    await expect(status).toHaveAttribute("data-depth", "1");
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(120);
      if (Number(await canvas.getAttribute("data-cam-x")) < -1.5) break;
    }
    // The rig pans toward the miner; the bot stays in frame.
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-cam-x")), {
        timeout: 5_000,
      })
      .toBeLessThan(-1.5);
    // And the visible pixels actually changed across the lateral digs
    // (Rule 10): two frames straddling one more lateral dig differ.
    const before = await canvas.screenshot();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250);
    const after = await canvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test("walking the surface shop row stays responsive", async ({ page }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    const canvas = page.locator("canvas");
    await expect(status).toHaveAttribute("data-depth", "0");
    await page.waitForTimeout(800);

    // Walk left across the shops (the elevator is five columns out) and confirm
    // the camera actually tracks the whole way: the static village (no
    // per-step reconciliation) must not stall input. Absolute frame time
    // is not asserted here, since CI's software renderer is far slower
    // than any device; data-frame-ms exists for manual perf probing.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(90);
    }
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-cam-x")), {
        timeout: 5_000,
      })
      .toBeLessThan(-3);
    // The frame-time stat is wired up (a real number, not NaN/absent).
    expect(Number(await canvas.getAttribute("data-frame-ms"))).toBeGreaterThan(
      0,
    );
    // Walking back the other way still tracks, so input never wedged.
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(90);
    }
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-cam-x")), {
        timeout: 5_000,
      })
      .toBeGreaterThan(0);
  });

  test("a downward drag on the sheet handle dismisses it", async ({ page }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-depth", "0");

    // Stand at the Supply Depot (two columns right of the shaft) and
    // tap the prompt to open the sheet.
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press("ArrowRight");
    }
    const depot = await openStall(page, "Supply Depot");
    // Let the slide-up entrance (0.28s) settle so the docked baseline
    // is the resting position, not a mid-animation frame.
    await page.waitForTimeout(450);

    // Grab the top of the sheet (the drag handle).
    const box = await depot.boundingBox();
    if (!box) throw new Error("sheet has no bounding box");
    const x = box.x + box.width / 2;
    const y = box.y + 8;
    await page.mouse.move(x, y);
    await page.mouse.down();

    // Rule 10: the sheet visibly follows the finger before release. Pull
    // partway (under the close threshold) and confirm it actually moved
    // down, then that a short pull snaps back to its docked position.
    await page.mouse.move(x, y + 40);
    await page.waitForTimeout(30);
    const dragged = await depot.boundingBox();
    if (!dragged) throw new Error("sheet vanished mid-drag");
    expect(dragged.y).toBeGreaterThan(box.y + 15);
    await page.mouse.up();
    await page.waitForTimeout(250);
    const snapped = await depot.boundingBox();
    if (!snapped) throw new Error("sheet dismissed on a sub-threshold drag");
    expect(snapped.y).toBeLessThan(dragged.y - 10);
    await expect(depot).toBeVisible();

    // Now a full pull past the threshold dismisses, still on the column.
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(x, y + i * 25);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await expect(depot).not.toBeVisible();
    await expect(status).toHaveAttribute("data-depth", "0");
  });
});

test("the carved world survives a reload (REQ-026)", async ({ page }) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // Dig a two-deep shaft, then abandon (a trip-ending moment, which
  // checkpoints the guest world to local storage).
  await digTo(page, 2);
  const abandon = page.getByRole("button", { name: "Abandon trip" });
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
  await expect(status).toHaveAttribute("data-depth", "0");
  await page.keyboard.press("ArrowDown");
  await expect(status).toHaveAttribute("data-depth", "2");
  await expect(status).toHaveAttribute("data-energy", "59.5");

  // And a MID-TRIP reload resumes exactly where the trip stood: the
  // in-flight log replays over the trip-start checkpoint, so depth and
  // energy come back identical (carry included).
  const energyBefore = await status.getAttribute("data-energy");
  await page.reload();
  await expect(status).toHaveAttribute("data-depth", "2");
  await expect(status).toHaveAttribute("data-energy", energyBefore ?? "");
});

test("surface village stalls open their menus on tap (REQ-021)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // Walk left from the shaft to the Buyer; the menu does not pop
  // on walk-by, the prompt does, and tapping it opens the menu.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ArrowLeft");
  }
  await expect(
    page.getByRole("region", { name: "Buyer", exact: true }),
  ).not.toBeVisible();
  const buyer = await openStall(page, "Buyer");
  await expect(buyer).toContainText("nothing banked yet");

  // Walk right to the Supply Depot: consumables with prices.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("ArrowRight");
  }
  const depot = await openStall(page, "Supply Depot");
  await expect(depot).toContainText("Ladder");
  await expect(depot).toContainText("have");
  await expect(depot).toContainText("Buy 1 for 2 vibes");
  await depot.getByRole("button", { name: "x5" }).click();
  await expect(depot).toContainText("Buy 5 for 10 vibes");

  // And on to the Upgrades stall: the four gear tracks.
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press("ArrowRight");
  }
  const upgrades = await openStall(page, "Upgrades");
  await expect(upgrades).toContainText("Pickaxe");
  await expect(upgrades).toContainText("Cargo Hold");

  // Walking off the stall column closes the menu.
  await page.keyboard.press("ArrowLeft");
  await expect(upgrades).not.toBeVisible();
});

test("a stall opens on tap and closes back to the prompt", async ({ page }) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // Stand at the Buyer (three columns left of the shaft).
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ArrowLeft");
  }
  const prompt = page.getByRole("button", { name: "Open Buyer" });
  const buyer = page.getByRole("region", { name: "Buyer", exact: true });
  await expect(prompt).toBeVisible();
  await expect(buyer).not.toBeVisible();

  // Tap opens; the close button dismisses without walking away (still on
  // the column at depth 0) and the prompt comes back.
  await prompt.click();
  await expect(buyer).toBeVisible();
  await buyer.getByRole("button", { name: "Close shop" }).click();
  await expect(buyer).not.toBeVisible();
  await expect(prompt).toBeVisible();
  await expect(status).toHaveAttribute("data-depth", "0");

  // Tapping the prompt again reopens it.
  await prompt.click();
  await expect(buyer).toBeVisible();
});

test("the warp pad gates jumps on a planted beacon (REQ-029)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // The pad stands six columns right of the shaft.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("ArrowRight");
  }
  const pad = await openStall(page, "Warp Pad");
  await expect(pad).toContainText("no beacon planted");
  await expect(pad).toContainText("range 60 rows");
  await expect(
    pad.getByRole("button", { name: "Warp to beacon" }),
  ).toBeDisabled();
});

test("the elevator sells rail and gates rides on it (REQ-028)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // The tower stands five columns left of the shaft.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("ArrowLeft");
  }
  const elevator = await openStall(page, "Elevator");
  await expect(elevator).toContainText("no rail yet");
  await expect(elevator).toContainText("40 vibes");
  // Without rail the ride is disabled; without storage so is the buy.
  await expect(
    elevator.getByRole("button", { name: /Ride down/ }),
  ).toBeDisabled();
});

test("miner stays at depth when walking sideways (lateral teleport regression)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  // Rows 1-2 are rock-free and hazard-free, so digging down and one
  // lateral dig are guaranteed to succeed regardless of the session seed.
  await digTo(page, 2);
  await expect(status).toHaveAttribute("data-depth", "2");

  // Wait for the eased render position to settle at the dug depth.
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-y")), {
      timeout: 15_000,
    })
    .toBeLessThan(-1.8);

  // Record the highest rendered Y across every frame of the lateral step.
  await page.evaluate(() => {
    const el = document.querySelector("canvas");
    const w = window as unknown as { __maxMinerY: number; __minerRaf: number };
    w.__maxMinerY = Number.NEGATIVE_INFINITY;
    const sample = () => {
      const y = Number(el?.getAttribute("data-miner-y"));
      if (!Number.isNaN(y)) w.__maxMinerY = Math.max(w.__maxMinerY, y);
      w.__minerRaf = requestAnimationFrame(sample);
    };
    sample();
  });

  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(120);
  }
  // The miner glides one cell left (start col 4 renders at x=0, col 3 at -1)...
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 15_000,
    })
    .toBeLessThan(-0.8);

  const maxY = await page.evaluate(() => {
    const w = window as unknown as { __maxMinerY: number; __minerRaf: number };
    cancelAnimationFrame(w.__minerRaf);
    return w.__maxMinerY;
  });
  // ...without ever lifting toward the surface. The old bug re-applied the
  // JSX position prop on column changes, snapping the rendered Y to 0.
  expect(maxY).toBeLessThan(-1.5);
});

test("workshop sells parts and shows balance (needs storage)", async ({
  page,
  request,
}) => {
  const probe = await request.get("/api/shop");
  test.skip(
    probe.status() === 503,
    "storage not configured in this environment",
  );

  // Parts buying lives inside the Workshop now; the standalone /shop is gone.
  await page.goto("/workshop");
  const shop = page.getByLabel("Parts shop");
  await expect(shop).toBeVisible();
  await expect(shop.getByText("vibes").first()).toBeVisible();
  await expect(shop.getByText("Drive Wheel")).toBeVisible();
});

test("garage saves and lists designs (needs storage)", async ({
  page,
  request,
}) => {
  const probe = await request.get("/api/designs");
  test.skip(
    probe.status() === 503,
    "storage not configured in this environment",
  );

  await page.goto("/workshop");
  const garage = page.getByLabel("Saved designs");
  await expect(garage).toBeVisible();
  const name = `E2E Bot ${Date.now()}`;
  await garage.getByLabel("Design name").fill(name);
  await garage.getByLabel("Design name").blur();
  await garage.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("saved to the garage")).toBeVisible();
  await expect(garage.getByRole("button", { name })).toBeVisible();
});

test("match resolve API returns a deterministic official result", async ({
  request,
}) => {
  const payload = {
    designs: [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN],
    simVersion: SIM_VERSION,
    timeLimitTicks: 600,
  };
  const first = await request.post("/api/match/resolve", { data: payload });
  expect(first.ok()).toBeTruthy();
  const a = await first.json();
  expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
  expect(a.status.over).toBe(true);

  const second = await request.post("/api/match/resolve", { data: payload });
  const b = await second.json();
  expect(b.hash).toBe(a.hash);
});

test("sim verify API returns a stable deterministic hash", async ({
  request,
}) => {
  const first = await request.get("/api/sim/verify?seed=42&steps=300");
  expect(first.ok()).toBeTruthy();
  const a = await first.json();
  expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
  expect(a.simVersion).toBe(2);

  const second = await request.get("/api/sim/verify?seed=42&steps=300");
  const b = await second.json();
  expect(b.hash).toBe(a.hash);
});
