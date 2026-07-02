#!/usr/bin/env node
/**
 * Art-pipeline baseline diffing (companion to capture-miner-showcase.mjs).
 *
 * Compares every same-named PNG between a baseline directory and a fresh
 * capture directory and reports the changed-pixel percentage per image.
 * Diffing runs inside headless Chromium on a canvas, so the repo takes
 * no image-decoding dependency.
 *
 * Usage:
 *   node scripts/compare-captures.mjs <baselineDir> <currentDir> [threshold%]
 *
 * Exit code 1 when any shared image differs beyond the threshold
 * (default 1.5%), or when either directory has PNGs the other lacks.
 * Never starts servers; never writes outside the current directory's
 * <currentDir>/diff-report.json.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const [baselineDir, currentDir, thresholdArg] = process.argv.slice(2);
if (!baselineDir || !currentDir) {
  console.error(
    "usage: node scripts/compare-captures.mjs <baselineDir> <currentDir> [threshold%]",
  );
  process.exit(2);
}
const threshold = Number(thresholdArg ?? "1.5");

function pngs(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".png"))
    .sort();
}

const baseNames = pngs(baselineDir);
const currentNames = pngs(currentDir);
const shared = baseNames.filter((name) => currentNames.includes(name));
const missing = baseNames.filter((name) => !currentNames.includes(name));
const added = currentNames.filter((name) => !baseNames.includes(name));

const browser = await chromium.launch();
const page = await browser.newPage();

const results = [];
for (const name of shared) {
  const a = readFileSync(resolve(join(baselineDir, name))).toString("base64");
  const b = readFileSync(resolve(join(currentDir, name))).toString("base64");
  const result = await page.evaluate(
    async ([baseData, currData]) => {
      const load = (data) =>
        new Promise((ok, err) => {
          const img = new Image();
          img.onload = () => ok(img);
          img.onerror = err;
          img.src = `data:image/png;base64,${data}`;
        });
      const [imgA, imgB] = await Promise.all([load(baseData), load(currData)]);
      if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
        return { sizeMismatch: true, diffPct: 100 };
      }
      const canvas = document.createElement("canvas");
      canvas.width = imgA.width;
      canvas.height = imgA.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(imgA, 0, 0);
      const dataA = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imgB, 0, 0);
      const dataB = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let changed = 0;
      const total = canvas.width * canvas.height;
      // A pixel counts as changed when any channel moves more than 12
      // of 255: below that is antialiasing and compression noise.
      for (let i = 0; i < dataA.length; i += 4) {
        if (
          Math.abs(dataA[i] - dataB[i]) > 12 ||
          Math.abs(dataA[i + 1] - dataB[i + 1]) > 12 ||
          Math.abs(dataA[i + 2] - dataB[i + 2]) > 12
        ) {
          changed++;
        }
      }
      return { sizeMismatch: false, diffPct: (changed / total) * 100 };
    },
    [a, b],
  );
  results.push({ name, ...result });
}
await browser.close();

let failed = false;
for (const r of results) {
  const flag = r.sizeMismatch
    ? "SIZE MISMATCH"
    : r.diffPct > threshold
      ? "CHANGED"
      : "ok";
  if (flag !== "ok") failed = true;
  console.log(
    `${r.diffPct.toFixed(2).padStart(7)}%  ${flag.padEnd(13)} ${r.name}`,
  );
}
for (const name of missing) {
  failed = true;
  console.log(`   MISSING in current: ${name}`);
}
for (const name of added) {
  failed = true;
  console.log(`   NEW (no baseline): ${name}`);
}

const report = { threshold, results, missing, added };
writeFileSync(
  join(currentDir, "diff-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  `${results.length} compared, ${missing.length} missing, ${added.length} new; report: ${join(basename(currentDir), "diff-report.json")}`,
);
process.exit(failed ? 1 : 0);
