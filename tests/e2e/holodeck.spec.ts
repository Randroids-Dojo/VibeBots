import { expect, type Page, test } from "@playwright/test";
import { dismissReleaseNotes, openSettings } from "./support/mine-helpers";

const REDUCED_MOTION_PIXEL_DIFF_BUDGET = 0.0001;

async function imagePixelDifferenceRatio(
  page: Page,
  before: Buffer,
  after: Buffer,
): Promise<number> {
  return page.evaluate(
    async ([beforeBase64, afterBase64]) => {
      const decode = async (encoded: string) => {
        const response = await fetch(`data:image/png;base64,${encoded}`);
        return createImageBitmap(await response.blob());
      };
      const [beforeImage, afterImage] = await Promise.all([
        decode(beforeBase64),
        decode(afterBase64),
      ]);
      if (
        beforeImage.width !== afterImage.width ||
        beforeImage.height !== afterImage.height
      ) {
        beforeImage.close();
        afterImage.close();
        return 1;
      }
      const canvas = document.createElement("canvas");
      canvas.width = beforeImage.width;
      canvas.height = beforeImage.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        beforeImage.close();
        afterImage.close();
        return 1;
      }
      context.drawImage(beforeImage, 0, 0);
      const beforePixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(afterImage, 0, 0);
      const afterPixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      beforeImage.close();
      afterImage.close();
      let changed = 0;
      for (let i = 0; i < beforePixels.length; i += 4) {
        if (
          Math.abs(beforePixels[i] - afterPixels[i]) > 12 ||
          Math.abs(beforePixels[i + 1] - afterPixels[i + 1]) > 12 ||
          Math.abs(beforePixels[i + 2] - afterPixels[i + 2]) > 12
        ) {
          changed += 1;
        }
      }
      return changed / (canvas.width * canvas.height);
    },
    [before.toString("base64"), after.toString("base64")],
  );
}

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

test("miner showcase plays clips and spins the turntable", async ({ page }) => {
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

test("holodeck camera pans on swipe and zooms on pinch (REQ-021)", async ({
  page,
}) => {
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
    .poll(async () => Number(await canvas.getAttribute("data-holodeck-pan-x")))
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
});

test("surface village review bench frames the production models within budget", async ({
  page,
}) => {
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
      async () => Number(await canvas.getAttribute("data-holodeck-draw-calls")),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  expect(
    Number(await canvas.getAttribute("data-holodeck-draw-calls")),
  ).toBeLessThanOrEqual(110);

  await page.getByLabel("Review framing").selectOption("right");
  await expect(canvas).toHaveAttribute("data-holodeck-surface-view", "right");
});

test("surface Warp ring changes visible pixels and stops for reduced motion", async ({
  page,
}) => {
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
});
