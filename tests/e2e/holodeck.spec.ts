import { expect, type Page, test } from "@playwright/test";
import { ciCase } from "./support/ci-case";
import { imagePixelDifferenceRatio } from "./support/image-pixels";
import { dismissReleaseNotes, openSettingsFor } from "./support/mine-helpers";

const REDUCED_MOTION_PIXEL_DIFF_BUDGET = 0.0001;

test(
  "holodeck is reachable from the mine options menu",
  ciCase("E2E-HOLODECK-0001", "@functional"),
  async ({ page }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);

    // Open the options (gear) menu, drill into Advanced, and jump to the
    // Holodeck.
    await openSettingsFor(page, "holodeck");
    await page.getByRole("button", { name: "Holodeck" }).click();

    await expect(page).toHaveURL(/\/holodeck$/);
    await expect(page.locator("canvas")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to mine" }),
    ).toBeVisible();

    // The scenario selector and its declared controls render.
    await expect(page.getByLabel("Scenario")).toBeVisible();
    await expect(page.getByLabel("Pickaxe level")).toBeVisible();
    await expect(page.getByLabel("Block type")).toBeVisible();
  },
);

test(
  "holodeck auto-mines on a loop with visible motion (Rule 10)",
  ciCase("E2E-HOLODECK-0002", "@render"),
  async ({ page }) => {
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
      .poll(
        async () =>
          canvas.evaluate(
            (element, previous) =>
              new Promise<string | null>((resolve) => {
                let framesLeft = 30;
                const sample = () => {
                  const current = element.dataset.holodeckArm ?? null;
                  if (current !== previous || framesLeft <= 0) {
                    resolve(current);
                    return;
                  }
                  framesLeft -= 1;
                  requestAnimationFrame(sample);
                };
                requestAnimationFrame(sample);
              }),
            armA,
          ),
        { timeout: 5_000 },
      )
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
  },
);

test(
  "holodeck controls reconfigure the scene without a reload",
  ciCase("E2E-HOLODECK-0003", "@render"),
  async ({ page }) => {
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
  },
);

test(
  "holodeck pause freezes the mining animation, play resumes it",
  ciCase("E2E-HOLODECK-0004", "@render"),
  async ({ page }) => {
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
    const loopsPaused = Number(
      await canvas.getAttribute("data-holodeck-loops"),
    );
    await page.waitForTimeout(900);
    expect(await canvas.getAttribute("data-holodeck-arm")).toBe(armPaused);
    expect(Number(await canvas.getAttribute("data-holodeck-loops"))).toBe(
      loopsPaused,
    );

    // Play: motion resumes.
    await page.getByRole("button", { name: "Play" }).click();
    const resumedArms = await sampleCanvasAttrOverFrames(
      page,
      "data-holodeck-arm",
      3_000,
    );
    expect(resumedArms.some((arm) => arm !== Number(armPaused))).toBe(true);
  },
);

/** Sample a canvas data attribute across rendered frames, in-page: rAF
 * fires once per real frame, so this sees short animation pulses that
 * round-trip polling misses entirely on slow runners. */
async function sampleCanvasAttrOverFrames(
  page: Page,
  attr: string,
  windowMs: number,
): Promise<number[]> {
  return page.evaluate(
    ([attrName, ms]) =>
      new Promise<number[]>((resolve) => {
        const canvas = document.querySelector("canvas");
        const seen: number[] = [];
        const startedAt = performance.now();
        const tick = () => {
          const raw = canvas?.getAttribute(attrName);
          if (raw !== null && raw !== undefined) seen.push(Number(raw));
          if (performance.now() - startedAt < ms) {
            requestAnimationFrame(tick);
          } else {
            resolve(seen);
          }
        };
        requestAnimationFrame(tick);
      }),
    [attr, windowMs] as [string, number],
  );
}

test(
  "miner showcase plays clips and spins the turntable",
  ciCase("E2E-HOLODECK-0005", "@render"),
  async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/holodeck");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();

    await page.getByLabel("Scenario").selectOption("miner-showcase");
    await expect(page.getByLabel("Animation")).toBeVisible();
    await expect(page.getByLabel("Turntable")).toBeVisible();
    await expect(canvas).toHaveAttribute("data-holodeck-clip", "idle", {
      timeout: 30_000,
    });

    // Idle still renders live motion: the hover bob moves the body (Rule 10).
    const bobA = await canvas.getAttribute("data-holodeck-body-y");
    await expect
      .poll(async () => canvas.getAttribute("data-holodeck-body-y"), {
        timeout: 5_000,
      })
      .not.toBe(bobA);

    // The dig clip drives the pick arm. The swing is a 0.18s pulse per
    // 0.62s loop: sample in-page across rendered frames so a slow runner
    // that renders few frames still catches the pulse when it draws one.
    await page.getByLabel("Animation").selectOption("dig");
    await expect(canvas).toHaveAttribute("data-holodeck-clip", "dig", {
      timeout: 30_000,
    });
    await expect
      .poll(
        async () => {
          const arms = await sampleCanvasAttrOverFrames(
            page,
            "data-holodeck-arm",
            3_000,
          );
          return arms.length ? Math.min(...arms) : 0;
        },
        {
          message: "the dig swing should reach the pick down-stroke",
          timeout: 30_000,
        },
      )
      .toBeLessThan(-0.5);

    // The turntable accumulates yaw while spinning and holds when off.
    await page.getByLabel("Turntable").selectOption("spin");
    const yawA = Number(await canvas.getAttribute("data-holodeck-yaw"));
    await expect
      .poll(
        async () => Number(await canvas.getAttribute("data-holodeck-yaw")),
        {
          timeout: 5_000,
        },
      )
      .toBeGreaterThan(yawA + 0.05);
    await page.getByLabel("Turntable").selectOption("off");
    await page.waitForTimeout(150);
    const yawHeld = Number(await canvas.getAttribute("data-holodeck-yaw"));
    await page.waitForTimeout(400);
    expect(Number(await canvas.getAttribute("data-holodeck-yaw"))).toBe(
      yawHeld,
    );

    // Visible pixels change while a clip plays (Rule 10).
    const shotBefore = await canvas.screenshot();
    await page.waitForTimeout(500);
    const shotAfter = await canvas.screenshot();
    expect(Buffer.compare(shotBefore, shotAfter)).not.toBe(0);
  },
);

test(
  "holodeck camera pans on swipe and zooms on pinch (REQ-021)",
  ciCase("E2E-HOLODECK-0006", "@render"),
  async ({ page }) => {
    await page.goto("/holodeck");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute("data-holodeck-zoom", /\d/, {
      timeout: 30_000,
    });

    const viewport = page.getByTestId("holodeck-viewport");
    const box = await viewport.boundingBox();
    if (!box) throw new Error("holodeck viewport has no box");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // One-pointer swipe pans the camera.
    const panBefore = Number(await canvas.getAttribute("data-holodeck-pan-x"));
    await viewport.dispatchEvent("pointerdown", {
      pointerId: 1,
      clientX: cx,
      clientY: cy,
      isPrimary: true,
    });
    for (let i = 1; i <= 5; i++) {
      await viewport.dispatchEvent("pointermove", {
        pointerId: 1,
        clientX: cx - i * 30,
        clientY: cy,
      });
    }
    await viewport.dispatchEvent("pointerup", { pointerId: 1 });
    await expect
      .poll(async () =>
        Number(await canvas.getAttribute("data-holodeck-pan-x")),
      )
      .toBeGreaterThan(panBefore + 0.5);

    // Two-pointer pinch-out zooms in (camera dollies closer).
    const camZBefore = Number(await canvas.getAttribute("data-holodeck-cam-z"));
    await viewport.dispatchEvent("pointerdown", {
      pointerId: 2,
      clientX: cx - 40,
      clientY: cy,
    });
    await viewport.dispatchEvent("pointerdown", {
      pointerId: 3,
      clientX: cx + 40,
      clientY: cy,
    });
    for (let i = 1; i <= 5; i++) {
      await viewport.dispatchEvent("pointermove", {
        pointerId: 2,
        clientX: cx - 40 - i * 25,
        clientY: cy,
      });
      await viewport.dispatchEvent("pointermove", {
        pointerId: 3,
        clientX: cx + 40 + i * 25,
        clientY: cy,
      });
    }
    await viewport.dispatchEvent("pointerup", { pointerId: 2 });
    await viewport.dispatchEvent("pointerup", { pointerId: 3 });
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-holodeck-zoom")))
      .toBeGreaterThan(1.4);
    await expect
      .poll(
        async () => Number(await canvas.getAttribute("data-holodeck-cam-z")),
        { timeout: 10_000 },
      )
      .toBeLessThan(camZBefore - 1);

    // Double-tap recenters.
    for (const _ of [0, 1]) {
      await viewport.dispatchEvent("pointerdown", {
        pointerId: 4,
        clientX: cx,
        clientY: cy,
      });
      await viewport.dispatchEvent("pointerup", { pointerId: 4 });
    }
    await expect
      .poll(async () => await canvas.getAttribute("data-holodeck-zoom"))
      .toBe("1.00");
  },
);

test(
  "surface village review bench frames the production models within budget",
  ciCase("E2E-HOLODECK-0007", "@render"),
  async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/holodeck");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();

    await page.getByLabel("Scenario").selectOption("surface-village");
    await expect(page.getByLabel("Review framing")).toBeVisible();
    await expect(canvas).toHaveAttribute("data-holodeck-surface-view", "wide", {
      timeout: 30_000,
    });
    await expect
      .poll(
        async () =>
          Number(await canvas.getAttribute("data-holodeck-draw-calls")),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    expect(
      Number(await canvas.getAttribute("data-holodeck-draw-calls")),
    ).toBeLessThanOrEqual(14);

    await page.getByLabel("Review framing").selectOption("right");
    await expect(canvas).toHaveAttribute("data-holodeck-surface-view", "right");

    await page.getByLabel("Scenario").selectOption("miner-showcase");
    await expect(canvas).toHaveAttribute("data-surface-phase", "");
  },
);

test(
  "surface shift cycle renders distinct day and night grades within budget",
  ciCase("E2E-HOLODECK-0008", "@render"),
  async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      (
        window as typeof window & { __vibebotsTimeOfDayHour?: number }
      ).__vibebotsTimeOfDayHour = 13;
    });
    await page.goto("/holodeck");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    await page.getByLabel("Scenario").selectOption("surface-village");
    await expect(canvas).toHaveAttribute("data-surface-phase", "day", {
      timeout: 30_000,
    });
    await expect(canvas).toHaveAttribute("data-surface-star-opacity", "0.00");
    const dayDraws = Number(
      await canvas.getAttribute("data-holodeck-draw-calls"),
    );
    const day = await canvas.screenshot();

    await page.evaluate(() => {
      (
        window as typeof window & { __vibebotsTimeOfDayHour?: number }
      ).__vibebotsTimeOfDayHour = 0;
    });
    await expect(canvas).toHaveAttribute("data-surface-phase", "night", {
      timeout: 5_000,
    });
    await expect(canvas).toHaveAttribute("data-surface-star-opacity", "1.00");
    const night = await canvas.screenshot();
    const nightDraws = Number(
      await canvas.getAttribute("data-holodeck-draw-calls"),
    );

    expect(await imagePixelDifferenceRatio(page, day, night)).toBeGreaterThan(
      0.08,
    );
    expect(dayDraws).toBeLessThanOrEqual(14);
    expect(nightDraws).toBe(dayDraws);
  },
);

test(
  "surface Warp ring changes visible pixels and stops for reduced motion",
  ciCase("E2E-HOLODECK-0009", "@render"),
  async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/holodeck");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    await page.getByLabel("Scenario").selectOption("surface-village");
    await page.getByLabel("Review framing").selectOption("right");
    await expect(canvas).toHaveAttribute("data-surface-warp-reduced", "0", {
      timeout: 30_000,
    });
    await page.waitForTimeout(1_500);

    const angleA = await canvas.getAttribute("data-surface-warp-angle");
    const movingA = await canvas.screenshot();
    await expect
      .poll(
        async () =>
          Math.abs(
            Number(await canvas.getAttribute("data-surface-warp-angle")) -
              Number(angleA),
          ),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0.2);
    // The QA attribute updates inside the frame callback before the new frame
    // is rasterized. Let the deliberately slow ring advance far enough to
    // produce a stable pixel difference on software renderers.
    await page.waitForTimeout(100);
    const movingB = await canvas.screenshot();
    expect(
      await imagePixelDifferenceRatio(page, movingA, movingB),
    ).toBeGreaterThan(REDUCED_MOTION_PIXEL_DIFF_BUDGET);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(canvas).toHaveAttribute("data-surface-warp-reduced", "1", {
      timeout: 10_000,
    });
    await expect(canvas).toHaveAttribute("data-surface-warp-angle", "0.00");
    await page.waitForTimeout(2_000);
    const stillA = await canvas.screenshot();
    await page.waitForTimeout(400);
    const stillB = await canvas.screenshot();
    expect(
      await imagePixelDifferenceRatio(page, stillA, stillB),
    ).toBeLessThanOrEqual(REDUCED_MOTION_PIXEL_DIFF_BUDGET);
  },
);
