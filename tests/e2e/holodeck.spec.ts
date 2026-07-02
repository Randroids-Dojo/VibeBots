import { expect, test } from "@playwright/test";
import { dismissReleaseNotes, openSettings } from "./support/mine-helpers";

test("holodeck is reachable from the mine options menu", async ({ page }) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);

  // Open the options (gear) menu and jump to the Holodeck.
  await openSettings(page);
  await page.getByRole("button", { name: "Holodeck" }).click();

  await expect(page).toHaveURL(/\/holodeck$/);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to mine" })).toBeVisible();

  // The scenario selector and its declared controls render.
  await expect(page.getByLabel("Scenario")).toBeVisible();
  await expect(page.getByLabel("Pickaxe level")).toBeVisible();
  await expect(page.getByLabel("Block type")).toBeVisible();
});

test("holodeck auto-mines on a loop with visible motion (Rule 10)", async ({
  page,
}) => {
  await page.goto("/holodeck");

  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  // The render loop drives the pick arm: its exposed value must change.
  // The dig swing is a real impulse (active ~0.18s of each 0.62s loop),
  // so poll until a different sample lands instead of comparing two
  // fixed instants that can both fall in the rest phase.
  await expect
    .poll(async () => canvas.getAttribute("data-holodeck-arm"), {
      timeout: 15_000,
    })
    .not.toBeNull();
  const armA = await canvas.getAttribute("data-holodeck-arm");
  await expect
    .poll(async () => canvas.getAttribute("data-holodeck-arm"), {
      timeout: 5_000,
    })
    .not.toBe(armA);

  // The auto-driver completes at least one mine + reload cycle.
  await expect
    .poll(
      async () => Number(await canvas.getAttribute("data-holodeck-loops")),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  // Visible pixels actually change over the loop.
  const shotBefore = await canvas.screenshot();
  await page.waitForTimeout(700);
  const shotAfter = await canvas.screenshot();
  expect(Buffer.compare(shotBefore, shotAfter)).not.toBe(0);
});

test("holodeck controls reconfigure the scene without a reload", async ({
  page,
}) => {
  await page.goto("/holodeck");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  // Change the block type; the page must not navigate and the canvas stays.
  await page.getByLabel("Block type").selectOption("diamond");
  await expect(page).toHaveURL(/\/holodeck$/);
  await expect(canvas).toBeVisible();
  await expect(page.getByLabel("Block type")).toHaveValue("diamond");

  // The loop keeps running on the new configuration.
  await expect
    .poll(
      async () => Number(await canvas.getAttribute("data-holodeck-loops")),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
});

test("holodeck pause freezes the mining animation, play resumes it", async ({
  page,
}) => {
  await page.goto("/holodeck");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => canvas.getAttribute("data-holodeck-arm"), {
      timeout: 15_000,
    })
    .not.toBeNull();

  // Pause: the pick arm must stop moving and the loop must stop advancing.
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(300); // let any in-flight swing settle to rest
  const armPaused = await canvas.getAttribute("data-holodeck-arm");
  const loopsPaused = Number(await canvas.getAttribute("data-holodeck-loops"));
  await page.waitForTimeout(900);
  expect(await canvas.getAttribute("data-holodeck-arm")).toBe(armPaused);
  expect(Number(await canvas.getAttribute("data-holodeck-loops"))).toBe(
    loopsPaused,
  );

  // Play: motion resumes.
  await page.getByRole("button", { name: "Play" }).click();
  await expect
    .poll(async () => canvas.getAttribute("data-holodeck-arm"), {
      timeout: 15_000,
    })
    .not.toBe(armPaused);
});

test("miner showcase plays clips and spins the turntable", async ({ page }) => {
  await page.goto("/holodeck");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  await page.getByLabel("Scenario").selectOption("miner-showcase");
  await expect(page.getByLabel("Animation")).toBeVisible();
  await expect(page.getByLabel("Turntable")).toBeVisible();
  await expect(canvas).toHaveAttribute("data-holodeck-clip", "idle", {
    timeout: 15_000,
  });

  // Idle still renders live motion: the hover bob moves the body (Rule 10).
  const bobA = await canvas.getAttribute("data-holodeck-body-y");
  await expect
    .poll(async () => canvas.getAttribute("data-holodeck-body-y"), {
      timeout: 5_000,
    })
    .not.toBe(bobA);

  // The dig clip drives the pick arm.
  await page.getByLabel("Animation").selectOption("dig");
  await expect(canvas).toHaveAttribute("data-holodeck-clip", "dig");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-holodeck-arm")), {
      timeout: 5_000,
    })
    .toBeLessThan(-0.5);

  // The turntable accumulates yaw while spinning and holds when off.
  await page.getByLabel("Turntable").selectOption("spin");
  const yawA = Number(await canvas.getAttribute("data-holodeck-yaw"));
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-holodeck-yaw")), {
      timeout: 5_000,
    })
    .toBeGreaterThan(yawA + 0.05);
  await page.getByLabel("Turntable").selectOption("off");
  await page.waitForTimeout(150);
  const yawHeld = Number(await canvas.getAttribute("data-holodeck-yaw"));
  await page.waitForTimeout(400);
  expect(Number(await canvas.getAttribute("data-holodeck-yaw"))).toBe(yawHeld);

  // Visible pixels change while a clip plays (Rule 10).
  const shotBefore = await canvas.screenshot();
  await page.waitForTimeout(500);
  const shotAfter = await canvas.screenshot();
  expect(Buffer.compare(shotBefore, shotAfter)).not.toBe(0);
});
