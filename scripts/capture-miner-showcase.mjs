#!/usr/bin/env node
/**
 * Miner Showcase capture driver (character art pipeline tooling).
 *
 * Drives the Holodeck's Miner Showcase scenario through every animation
 * clip and saves labeled screenshots for art review, at both a desktop
 * viewport and the primary Android portrait size. Also records the
 * canvas draw-call counter so model changes stay inside the phone budget.
 *
 * Usage:
 *   node scripts/capture-miner-showcase.mjs --base-url http://127.0.0.1:3000 \
 *     [--out docs/reviews/<session>/captures] [--prefix miner-v2]
 *
 * The target server must already be running (pnpm build && pnpm start, or
 * pnpm dev). The script never starts or stops servers; per the repo's
 * test-isolation rules, point it at a server you started for this run.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const baseUrl = readArg("--base-url", process.env.PLAYWRIGHT_BASE_URL ?? "");
const outDir = readArg("--out", "playtest-captures");
const prefix = readArg("--prefix", "miner");
if (!baseUrl) {
  console.error(
    "capture-miner-showcase: pass --base-url (or set PLAYWRIGHT_BASE_URL)",
  );
  process.exit(1);
}

const CLIPS = ["idle", "walk", "dig", "rebuff", "crush"];
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 720 },
  // The primary player device: Android portrait (see repo rules).
  { name: "portrait", width: 390, height: 760 },
];

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
    });
    await page.goto(`${baseUrl}/holodeck`, { waitUntil: "networkidle" });
    const canvas = page.locator("canvas");
    await canvas.waitFor({ state: "visible", timeout: 20_000 });
    await page.getByLabel("Scenario").selectOption("miner-showcase");
    await page
      .locator('canvas[data-holodeck-clip="idle"]')
      .waitFor({ timeout: 20_000 });

    for (const clip of CLIPS) {
      await page.getByLabel("Animation").selectOption(clip);
      // Let the clip reach a representative frame (mid-swing for dig).
      await page.waitForTimeout(clip === "dig" ? 750 : 900);
      const file = join(outDir, `${prefix}-${viewport.name}-${clip}.png`);
      await canvas.screenshot({ path: file });
      const drawCalls = await canvas.getAttribute("data-holodeck-draw-calls");
      console.log(`${file} (draw calls: ${drawCalls ?? "?"})`);
    }

    // A three-quarter turntable angle for silhouette review.
    await page.getByLabel("Animation").selectOption("idle");
    await page.getByLabel("Turntable").selectOption("spin");
    await page.waitForTimeout(1_200);
    await page.getByLabel("Turntable").selectOption("off");
    const angled = join(outDir, `${prefix}-${viewport.name}-angled.png`);
    await canvas.screenshot({ path: angled });
    console.log(angled);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("capture complete");
