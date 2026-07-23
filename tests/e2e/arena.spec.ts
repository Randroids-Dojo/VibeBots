import { expect, test } from "@playwright/test";
import { ciCase } from "./support/ci-case";

test(
  "arena page renders a moving match (Rule 10 motion QA)",
  ciCase("E2E-ARENA-0001", "@render"),
  async ({ page }) => {
    await page.goto("/arena");

    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();

    // The match HUD must render alongside the arena.
    await expect(page.getByText("Brawler", { exact: true })).toBeVisible();
    await expect(page.getByText("Rammer", { exact: true })).toBeVisible();

    // Every entered screen returns to the mine hub (the top nav is gone).
    await expect(
      page.getByRole("link", { name: "Back to mine" }),
    ).toBeVisible();

    const stage = page.locator("[data-sim-tick]");
    await expect
      .poll(async () => Number(await stage.getAttribute("data-sim-tick")), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    await expect(stage).toHaveAttribute("data-camera-mode", "cinematic-follow");
    await expect
      .poll(async () => await stage.getAttribute("data-bots-in-frame"), {
        timeout: 15_000,
      })
      .toBe("true");

    const tickBefore = Number(await stage.getAttribute("data-sim-tick"));
    const cameraBefore = await stage.evaluate((el) => ({
      distance: Number(el.getAttribute("data-camera-distance")),
      screenX: Number(el.getAttribute("data-bot0-screen-x")),
      targetX: Number(el.getAttribute("data-camera-target-x")),
      targetZ: Number(el.getAttribute("data-camera-target-z")),
    }));
    const shotBefore = await canvas.screenshot();

    await page.waitForTimeout(700);

    // Assumes the match outlasts the sample window (matches run ~60s and the
    // test samples within the first seconds). If tuning ever makes matches end
    // near-instantly, the exhibition restart resets the tick and this flakes.
    const tickAfter = Number(await stage.getAttribute("data-sim-tick"));
    const shotAfter = await canvas.screenshot();

    // The sim tick must advance and the visible pixels must actually change.
    expect(tickAfter).toBeGreaterThan(tickBefore);
    const cameraAfter = await stage.evaluate((el) => ({
      distance: Number(el.getAttribute("data-camera-distance")),
      screenX: Number(el.getAttribute("data-bot0-screen-x")),
      targetX: Number(el.getAttribute("data-camera-target-x")),
      targetZ: Number(el.getAttribute("data-camera-target-z")),
    }));
    const cameraDelta =
      Math.abs(cameraAfter.distance - cameraBefore.distance) +
      Math.abs(cameraAfter.screenX - cameraBefore.screenX) +
      Math.abs(cameraAfter.targetX - cameraBefore.targetX) +
      Math.abs(cameraAfter.targetZ - cameraBefore.targetZ);
    expect(cameraDelta).toBeGreaterThan(0.01);
    expect(await stage.getAttribute("data-bots-in-frame")).toBe("true");
    expect(Buffer.compare(shotBefore, shotAfter)).not.toBe(0);
  },
);

test(
  "arena match opens with a countdown before the sim starts",
  ciCase("E2E-ARENA-0002", "@functional"),
  async ({ page }) => {
    await page.goto("/arena");
    const stage = page.locator("[data-sim-tick]");
    await expect(page.getByTestId("arena-countdown")).toBeVisible();
    // The sim holds at tick 0 while the countdown runs.
    expect(Number(await stage.getAttribute("data-sim-tick"))).toBe(0);
    // FIGHT flashes, then the overlay clears and the sim advances.
    await expect(page.getByTestId("arena-countdown")).toContainText("FIGHT", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("arena-countdown")).not.toBeVisible({
      timeout: 10_000,
    });
    await expect
      .poll(async () => Number(await stage.getAttribute("data-sim-tick")), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
  },
);
