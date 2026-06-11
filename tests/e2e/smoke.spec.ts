import { expect, test } from "@playwright/test";
import { SIM_VERSION } from "../../src/sim/constants";
import { CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN } from "../../src/sim/design";

test("home page renders a moving match (Rule 10 motion QA)", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  // The match HUD must render alongside the arena.
  await expect(page.getByText("Brawler", { exact: true })).toBeVisible();
  await expect(page.getByText("Rammer", { exact: true })).toBeVisible();

  // Every page must reach the others (a missing nav link shipped once).
  const nav = page.getByLabel("Game sections");
  await expect(nav.getByRole("link", { name: "Workshop" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Mine" })).toBeVisible();

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
  await expect(
    page.getByLabel("Game sections").getByRole("link", { name: "Mine" }),
  ).toBeVisible();
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
  await expect(page.locator("canvas")).toBeVisible();
  await expect(
    page.getByLabel("Game sections").getByRole("link", { name: "Arena" }),
  ).toBeVisible();
  const status = page.getByLabel("Mine status");
  await expect(status).toContainText("depth 0");
  await expect(status).toContainText("Topsoil");

  await page.getByRole("button", { name: "Down" }).click();
  await expect(status).toContainText("depth 1");
  await expect(status).toContainText("energy 59.0");

  await page.getByRole("button", { name: "Up" }).click();
  await expect(status).toContainText("depth 0");
  // Banking on the surface refills the lamp.
  await expect(status).toContainText("energy 60.0");

  // Consumable controls exist even when empty (REQ-016); a scripted
  // edit once shipped without them, so the smoke pins their presence.
  await expect(
    page.getByRole("button", { name: /Dynamite \(\d+\)/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Recall \(\d+\)/ }),
  ).toBeVisible();
});

test("miner stays at depth when walking sideways (lateral teleport regression)", async ({
  page,
}) => {
  await page.goto("/mine");
  const status = page.getByLabel("Mine status");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  // Rows 1-2 are rock-free and hazard-free, so two digs down and one
  // lateral step are guaranteed to succeed regardless of the session seed.
  await page.getByRole("button", { name: "Down" }).click();
  await expect(status).toContainText("depth 1");
  await page.getByRole("button", { name: "Down" }).click();
  await expect(status).toContainText("depth 2");

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

  await page.getByRole("button", { name: "Left" }).click();
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

test("shop lists parts and balance (needs storage)", async ({
  page,
  request,
}) => {
  const probe = await request.get("/api/shop");
  test.skip(
    probe.status() === 503,
    "storage not configured in this environment",
  );

  await page.goto("/shop");
  const shop = page.getByLabel("Part shop");
  await expect(shop).toBeVisible();
  await expect(shop.getByText("balance:")).toBeVisible();
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
