#!/usr/bin/env node
/**
 * Captures the production surface village from its Holodeck review bench.
 * The caller owns the server process and passes its isolated base URL.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const baseUrl = readArg("--base-url", process.env.PLAYWRIGHT_BASE_URL ?? "");
const outDir = readArg("--out", "playtest-captures/surface-village");
const prefix = readArg("--prefix", "surface-village");
if (!baseUrl) {
  console.error(
    "capture-surface-village: pass --base-url or set PLAYWRIGHT_BASE_URL",
  );
  process.exit(1);
}

const GRAPHICS_KEY = "vibebots-graphics-quality-v1";
const CAPTURES = [
  {
    quality: "high",
    view: "wide",
    phase: "dawn",
    hour: 6.5,
    width: 1280,
    height: 800,
  },
  {
    quality: "high",
    view: "wide",
    phase: "day",
    hour: 13,
    width: 1280,
    height: 800,
  },
  {
    quality: "high",
    view: "wide",
    phase: "dusk",
    hour: 19,
    width: 1280,
    height: 800,
  },
  {
    quality: "high",
    view: "wide",
    phase: "night",
    hour: 0,
    width: 1280,
    height: 800,
  },
  {
    quality: "low",
    view: "wide",
    phase: "day",
    hour: 13,
    width: 1280,
    height: 800,
  },
  {
    quality: "low",
    view: "wide",
    phase: "night",
    hour: 0,
    width: 1280,
    height: 800,
  },
  ...["left", "center", "right"].flatMap((view) => [
    { quality: "high", view, phase: "day", hour: 13, width: 390, height: 760 },
    { quality: "low", view, phase: "day", hour: 13, width: 390, height: 760 },
  ]),
];

async function sampleFrameTimes(page, count = 90) {
  return page.evaluate(
    (sampleCount) =>
      new Promise((resolve) => {
        const samples = [];
        let previous = performance.now();
        const sample = (now) => {
          samples.push(now - previous);
          previous = now;
          if (samples.length < sampleCount + 1) {
            requestAnimationFrame(sample);
            return;
          }
          samples.shift();
          samples.sort((a, b) => a - b);
          const at = (fraction) =>
            samples[
              Math.min(
                samples.length - 1,
                Math.floor(samples.length * fraction),
              )
            ];
          resolve({ medianMs: at(0.5), p95Ms: at(0.95), maxMs: at(1) });
        };
        requestAnimationFrame(sample);
      }),
    count,
  );
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const report = [];
try {
  for (const capture of CAPTURES) {
    const context = await browser.newContext({
      viewport: { width: capture.width, height: capture.height },
      reducedMotion: "reduce",
    });
    await context.addInitScript(
      ([key, quality, hour]) => {
        localStorage.setItem(key, quality);
        window.__vibebotsTimeOfDayHour = hour;
      },
      [GRAPHICS_KEY, capture.quality, capture.hour],
    );
    const page = await context.newPage();
    await page.goto(`${baseUrl}/holodeck`, { waitUntil: "networkidle" });
    const canvas = page.locator("canvas");
    await canvas.waitFor({ state: "visible", timeout: 30_000 });
    await page.getByLabel("Scenario").selectOption("surface-village");
    await page.getByLabel("Review framing").selectOption(capture.view);
    await canvas
      .and(page.locator(`[data-holodeck-surface-view="${capture.view}"]`))
      .waitFor({ timeout: 30_000 });
    await page
      .getByRole("region", { name: "Holodeck controls" })
      .evaluate((element) => {
        element.style.display = "none";
      });
    await page.locator('a[href="/mine"]').evaluate((element) => {
      element.style.display = "none";
    });
    await page.waitForTimeout(1_200);
    const frameTimes = await sampleFrameTimes(page);
    const drawCalls = Number(
      (await canvas.getAttribute("data-holodeck-draw-calls")) ?? "NaN",
    );
    const backend =
      (await canvas.getAttribute("data-holodeck-backend")) ?? "unknown";
    const file = join(
      outDir,
      `${prefix}-${capture.quality}-${capture.phase}-${capture.view}-${capture.width}x${capture.height}.png`,
    );
    await canvas.screenshot({ path: file });
    const entry = { ...capture, backend, drawCalls, ...frameTimes, file };
    report.push(entry);
    console.log(
      `${file} backend=${backend} draws=${drawCalls} median=${frameTimes.medianMs.toFixed(2)}ms p95=${frameTimes.p95Ms.toFixed(2)}ms`,
    );
    if (!Number.isFinite(drawCalls) || drawCalls > 14) {
      throw new Error(`${file}: draw-call budget exceeded (${drawCalls} > 14)`);
    }
    if (capture.width === 390 && frameTimes.p95Ms > 18.5) {
      throw new Error(
        `${file}: phone p95 frame budget exceeded (${frameTimes.p95Ms.toFixed(2)}ms > 18.5ms)`,
      );
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const reportPath = join(outDir, `${prefix}-report.json`);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(reportPath);
