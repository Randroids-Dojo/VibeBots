// Allocation-site profiler: plays the mine while Chrome's sampling heap
// profiler records where allocations come from, then prints the top
// call sites by self bytes.
// Usage: node scripts/profile-allocations.mjs <baseURL> [seconds]
import { chromium } from "@playwright/test";

/** Optional escape hatch for environments whose Playwright browser cache
 * does not match the pinned version (set PW_CHROMIUM_PATH to a Chromium
 * binary); normal dev machines resolve the managed browser. */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

const BASE = process.argv[2] ?? "http://127.0.0.1:3862";
const SECONDS = Number(process.argv[3] ?? 40);

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 448, height: 891 } });
await page.goto(`${BASE}/mine`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForSelector("canvas", { timeout: 60000 });
try {
  await page.getByRole("button", { name: "Got it" }).click({ timeout: 8000 });
} catch {}
await page.waitForTimeout(3000);

const cdp = await page.context().newCDPSession(page);
await cdp.send("HeapProfiler.enable");
await cdp.send("HeapProfiler.startSampling", { samplingInterval: 16384 });

const startedAt = Date.now();
const keys = ["ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight"];
let press = 0;
while (Date.now() - startedAt < SECONDS * 1000) {
  await page.keyboard.press(keys[press % keys.length]);
  press += 1;
  await page.waitForTimeout(400);
}

const { profile } = await cdp.send("HeapProfiler.stopSampling");
await browser.close();

// Flatten the call tree into self-bytes per (function, url:line).
const rows = [];
function walk(node, stack) {
  const frame = node.callFrame;
  const label = `${frame.functionName || "(anonymous)"} @ ${frame.url.split("/").pop() || "?"}:${frame.lineNumber + 1}`;
  if (node.selfSize > 0) {
    rows.push({
      label,
      self: node.selfSize,
      stack: [...stack, label].slice(-4),
    });
  }
  for (const child of node.children ?? []) walk(child, [...stack, label]);
}
walk(profile.head, []);
rows.sort((a, b) => b.self - a.self);
const total = rows.reduce((t, r) => t + r.self, 0);
console.log(
  `total sampled: ${(total / 1024 / 1024).toFixed(1)} MB over ${SECONDS}s`,
);
for (const row of rows.slice(0, 25)) {
  console.log(
    `${(row.self / 1024 / 1024).toFixed(2).padStart(7)} MB  ${row.label}`,
  );
  console.log(
    `           via ${row.stack.slice(0, -1).join(" <- ") || "(root)"}`,
  );
}
