// Headless confirmation playtest of the workshop garage program (G1 to G8)
// at Android portrait. Drives the real UI from a fresh browser: the guided
// first visit, a drop with its sparks and the live meters, the fight roster
// on the thumb bar, the family chips and a part's face and blurb, paint,
// the share code, a chain merge with its cue, a removal with its dissolve,
// and a test fight in the bot's own paint. Saves screenshots into the given
// captures dir, prints a JSON summary, and exits nonzero on any console
// error or missing feature.
//
// Usage: node scripts/playtest-garage.mjs <out-dir>
//   PLAYTEST_BASE overrides the target (default http://localhost:3000).
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.env.PLAYTEST_BASE ?? "http://localhost:3000";
const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: node scripts/playtest-garage.mjs <out-dir>");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const errors = [];
const missing = [];
const summary = {};
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 390, height: 760 } });
pg.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
pg.on("pageerror", (e) => errors.push(String(e)));
const failedResponses = [];
pg.on("response", (r) => {
  if (r.status() >= 500)
    failedResponses.push(`${r.status()} ${new URL(r.url()).pathname}`);
});

// Stock parts so heroes are grabbable and the shop shows the ladder.
await pg.route("**/api/shop", async (route) => {
  await route.fulfill({
    json: {
      emeralds: 120,
      inventory: [
        { part_id: "drive-wheel", count: 5 },
        { part_id: "grip-wheel", count: 1 },
        { part_id: "light-plate", count: 2 },
        { part_id: "saw-blade", count: 1 },
        { part_id: "lance", count: 1 },
      ],
      catalog: [
        {
          id: "light-plate",
          name: "Light Plate",
          category: "structure",
          priceEmeralds: 2,
        },
        {
          id: "frame-plate",
          name: "Frame Plate",
          category: "structure",
          priceEmeralds: 3,
        },
        {
          id: "hardened-plate",
          name: "Hardened Plate",
          category: "structure",
          priceEmeralds: 18,
        },
        {
          id: "drive-wheel",
          name: "Drive Wheel",
          category: "mobility",
          priceEmeralds: 6,
        },
        {
          id: "grip-wheel",
          name: "Grip Wheel",
          category: "mobility",
          priceEmeralds: 12,
        },
        {
          id: "super-wheel",
          name: "Super Wheel",
          category: "mobility",
          priceEmeralds: 24,
        },
        {
          id: "ram-spike",
          name: "Ram Spike",
          category: "weapon",
          priceEmeralds: 8,
        },
        { id: "lance", name: "Lance", category: "weapon", priceEmeralds: 16 },
      ],
    },
  });
});

// No Postgres locally: the saves list answers 503 (storage offline) and the
// client handles it, but the browser logs the 503 as a console error, so
// answer it with an empty list instead.
await pg.route("**/api/designs", async (route) => {
  await route.fulfill({ json: { designs: [] } });
});

const shot = (name) => pg.screenshot({ path: `${OUT}/${name}.png` });
const canvasData = (key) =>
  pg
    .locator("canvas")
    .first()
    .evaluate((c, k) => c.dataset[k] ?? "", key);
// A recorded value that is not what the program promised is a missing
// feature too, so a regression cannot exit zero with evidence attached.
function expectValue(label, actual, ok) {
  if (!ok(actual)) missing.push(`${label}: ${JSON.stringify(actual)}`);
}
async function expectVisible(locator, label) {
  try {
    await locator.first().waitFor({ state: "visible", timeout: 8000 });
    return true;
  } catch {
    missing.push(label);
    return false;
  }
}
async function dragHeroOntoCore() {
  const heroX = 195;
  const heroY = 545;
  const coreY = 405;
  await pg.mouse.move(heroX, heroY);
  await pg.mouse.down();
  await pg.waitForTimeout(80);
  for (let i = 1; i <= 8; i++) {
    await pg.mouse.move(heroX, heroY + ((coreY - heroY) * i) / 8);
    await pg.waitForTimeout(30);
  }
  await pg.mouse.up();
}
async function carouselTo(name) {
  const carousel = pg.getByLabel("Part carousel");
  const nameEl = carousel.getByTestId("carousel-part-name");
  for (let i = 0; i < 30; i++) {
    if ((await nameEl.textContent())?.trim() === name) return true;
    await carousel.getByRole("button", { name: "Next part" }).click();
    await pg.waitForTimeout(120);
  }
  missing.push(`carousel part ${name}`);
  return false;
}
async function sheetCollapsed() {
  return pg
    .locator(".workshop-sheet")
    .evaluate((el) => el.classList.contains("workshop-sheet-collapsed"));
}
async function openSheet() {
  if (await sheetCollapsed())
    await pg.locator(".workshop-sheet-handle").click();
  await pg.waitForTimeout(300);
}
async function collapseSheet() {
  if (!(await sheetCollapsed()))
    await pg.locator(".workshop-sheet-handle").click();
  await pg.waitForTimeout(300);
}

// 1. First visit (G6): the guided bot and the coach card, on the G1 camera.
await pg.goto(`${BASE}/workshop`, { waitUntil: "networkidle" });
await pg.waitForTimeout(1500);
const coach = pg.getByTestId("coach-card");
summary.coachCardOnFirstVisit = await expectVisible(
  coach,
  "coach card on first visit",
);
summary.coachStep = await coach.getAttribute("data-step");
summary.title = (
  await pg.locator(".workshop-header-title").textContent()
)?.trim();
summary.meters = {
  power: await expectVisible(pg.getByTestId("meter-power"), "power meter"),
  weight: await expectVisible(pg.getByTestId("meter-weight"), "weight meter"),
};
summary.thumbBar = await expectVisible(
  pg.getByTestId("thumb-bar"),
  "thumb bar",
);
summary.chips = await expectVisible(
  pg.getByTestId("carousel-chips"),
  "family chips",
);
await shot("garage-01-first-visit");

// 2. The guided drop (G6 + G7 + G2): a wheel onto the free axle, sparks in
// flight, meters moving, the coach card advancing.
await carouselTo("Drive Wheel");
await pg.waitForTimeout(400);
await dragHeroOntoCore();
// The dataset read is quick; the capture right after it is the F-244
// evidence, inside the burst's first tenth of a second on this machine.
summary.sparkingRightAfterDrop = await canvasData("sparking");
await shot("garage-02-drop-sparks");
// A second frame a beat later: a screenshot of a live canvas takes a
// tenth of a second or more, so two of them bracket the burst.
await shot("garage-02b-drop-sparks-later");
await pg.waitForTimeout(700);
summary.titleAfterDrop = (
  await pg.locator(".workshop-header-title").textContent()
)?.trim();
summary.coachStepAfterDrop = await coach
  .getAttribute("data-step")
  .catch(() => null);
summary.sparkingLater = await canvasData("sparking");
await shot("garage-03-after-drop");
expectValue(
  "sparks in flight after the drop",
  summary.sparkingRightAfterDrop,
  (v) => v === "1",
);
expectValue(
  "sparks dead within a second",
  summary.sparkingLater,
  (v) => v === "0",
);
expectValue(
  "coach advanced to the fight step",
  summary.coachStepAfterDrop,
  (v) => v === "fight",
);
expectValue(
  "parts after the guided drop",
  summary.titleAfterDrop,
  (v) => v === "My Bot: 4 parts",
);

// 3. The fight roster on the thumb bar (G2).
const fightBtn = pg.getByRole("button", { name: "Test fight" });
if (await expectVisible(fightBtn, "Test fight button")) {
  await fightBtn.click();
  await pg.waitForTimeout(300);
  summary.rosterItems = await pg.getByRole("menuitem").allTextContents();
  await shot("garage-04-fight-roster");
  expectValue(
    "roster lists the stock fights",
    summary.rosterItems,
    (v) =>
      v.length >= 4 &&
      v.some((t) => /Brawler/.test(t)) &&
      v.some((t) => /rival/i.test(t)),
  );
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(200);
}

// 4. Family chips and a part's face (G4 + G3): weapons only, the lance in
// hand with its blurb.
const chips = pg.getByTestId("carousel-chips");
// Is a chip actually reachable by a finger? Read what sits on top of its
// centre; the header card grows a third line when the reason line shows
// and can cover the chip row. A covered chip still gets a synthetic click
// so the rest of the run produces evidence; the coverage is recorded.
summary.chips = {};
async function tapChip(label) {
  const chip = chips.locator("button", { hasText: label }).first();
  const covered = await chip.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    return top === el || el.contains(top)
      ? null
      : (top?.className?.toString() ?? "unknown");
  });
  let click = "pointer";
  try {
    await chip.click({ timeout: 2500 });
  } catch {
    await chip.dispatchEvent("click");
    click = "dispatched";
  }
  summary.chips[String(label)] = { covered, click };
  expectValue(
    `chip ${label} reachable by a pointer`,
    covered,
    (v) => v === null,
  );
  await pg.waitForTimeout(400);
}
// Keyboard activation (Rule 10): a focused chip toggles on Enter and the
// carousel follows, the same as a tap.
async function keyChip(label) {
  const chip = chips.locator("button", { hasText: label }).first();
  await chip.focus();
  await pg.keyboard.press("Enter");
  await pg.waitForTimeout(400);
  const pressed = await chip.getAttribute("aria-pressed");
  summary.chips[`${String(label)} (keyboard)`] = { pressed };
  expectValue(
    `chip ${label} pressed by keyboard`,
    pressed,
    (v) => v === "true",
  );
}
await tapChip(/weapon/i);
await keyChip(/drive/i);
await keyChip(/weapon/i);
await carouselTo("Lance");
await pg.waitForTimeout(500);
await shot("garage-05-weapon-chip-lance");
// The browsed part's blurb and stats open on a tap of the hero (G3).
await pg.mouse.move(195, 545);
await pg.mouse.down();
await pg.waitForTimeout(120);
await pg.mouse.up();
await pg.waitForTimeout(400);
summary.lanceBlurb =
  (
    await pg
      .locator(".inspector-blurb")
      .first()
      .textContent({ timeout: 3000 })
      .catch(() => null)
  )?.trim() ?? null;
await shot("garage-05b-lance-blurb");
expectValue(
  "lance blurb",
  summary.lanceBlurb,
  (v) => typeof v === "string" && v.length > 0,
);
await pg.mouse.move(195, 545);
await pg.mouse.down();
await pg.waitForTimeout(120);
await pg.mouse.up();
await pg.waitForTimeout(300);
await tapChip(/^all$/i);

// 5. Paint (G5): cobalt body, gold trim, read back from the canvas.
await openSheet();
const body = pg.getByRole("button", { name: /^Body paint cobalt$/i });
const trim = pg.getByRole("button", { name: /^Trim paint gold$/i });
if (await expectVisible(body, "body paint swatch")) {
  await body.click();
  await pg.waitForTimeout(200);
  await trim.click().catch(() => missing.push("trim paint swatch"));
  await pg.waitForTimeout(200);
  await shot("garage-06-paint-sheet");
}
await collapseSheet();
await pg.waitForTimeout(400);
summary.paint = {
  primary: await canvasData("paintPrimary"),
  accent: await canvasData("paintAccent"),
};
await shot("garage-07-painted-bot");
expectValue("body paint applied", summary.paint.primary, (v) => v === "cobalt");
expectValue("trim paint applied", summary.paint.accent, (v) => v === "gold");

// 6. Share (G8): the code for this exact bot.
await pg.getByRole("tab", { name: "Garage" }).click();
await pg.waitForTimeout(400);
await openSheet();
const code = pg.getByTestId("share-code");
if (await expectVisible(code, "share code")) {
  const text = await code
    .inputValue()
    .catch(async () => (await code.textContent()) ?? "");
  summary.shareCode = { prefix: text.slice(0, 4), length: text.length };
  expectValue(
    "share code prefix",
    summary.shareCode.prefix,
    (v) => v === "VB1.",
  );
}
await shot("garage-08-share");
await pg.getByRole("tab", { name: "Build" }).click();
await pg.waitForTimeout(300);
await collapseSheet();

// 7. Chain merge (G7): with both axles full, a dropped wheel merges into a
// placed one; a copy still in stock makes the inspector say Merge again.
await carouselTo("Drive Wheel");
await pg.waitForTimeout(300);
await dragHeroOntoCore();
await pg.waitForTimeout(250);
summary.titleAfterMergeDrop = (
  await pg.locator(".workshop-header-title").textContent()
)?.trim();
await openSheet();
const chain = pg.getByTestId("chain-cue");
summary.chainCue =
  (await chain.textContent().catch(() => null))?.trim() ?? null;
await shot("garage-09-chain-merge");
expectValue(
  "chain cue after the first merge",
  summary.chainCue,
  (v) => v === "Merge again to Lv 3",
);

// 8. Removal (G7): the selected part comes off with a dissolve; the canvas
// publishes the trace (frames animated, smallest scale reached).
const remove = pg.getByRole("button", { name: /^Remove / });
if (await expectVisible(remove, "Remove handle")) {
  await remove.click();
  await pg.waitForTimeout(120);
  await shot("garage-10-remove-dissolve");
  await pg.waitForTimeout(600);
  summary.dissolve = {
    frames: await canvasData("dissolveFrames"),
    min: await canvasData("dissolveMin"),
    stillDissolving: await canvasData("dissolving"),
  };
  summary.titleAfterRemove = (
    await pg.locator(".workshop-header-title").textContent()
  )?.trim();
  expectValue(
    "dissolve animated over frames",
    summary.dissolve.frames,
    (v) => Number(v) >= 2,
  );
  expectValue(
    "dissolve reached its end scale",
    summary.dissolve.min,
    (v) => Number(v) <= 0.25,
  );
  expectValue(
    "dissolve finished",
    summary.dissolve.stillDissolving,
    (v) => v === "0",
  );
  expectValue(
    "parts after the removal",
    summary.titleAfterRemove,
    (v) => v === "My Bot: 3 parts",
  );
}
await collapseSheet();

// 9. Test fight (G2 + G5): the painted bot in the arena with the team ring.
await fightBtn.click();
await pg.waitForTimeout(300);
const firstOpponent = pg.getByRole("menuitem").first();
if (await expectVisible(firstOpponent, "first roster opponent")) {
  summary.opponent = (await firstOpponent.textContent())?.trim();
  await firstOpponent.click();
  await pg.waitForTimeout(3500);
  const arena = pg.locator("canvas").last();
  summary.arenaPaint = {
    bot0: await arena
      .evaluate((c) => c.dataset.botPaint0 ?? "")
      .catch(() => ""),
    bot1: await arena
      .evaluate((c) => c.dataset.botPaint1 ?? "")
      .catch(() => ""),
  };
  await shot("garage-11-test-fight");
  expectValue(
    "player bot fights in its paint",
    summary.arenaPaint.bot1,
    (v) => v === "cobalt:gold",
  );
  expectValue(
    "opponent keeps the team colour",
    summary.arenaPaint.bot0,
    (v) => v === "none",
  );
}

await b.close();
summary.consoleErrors = errors;
summary.failedResponses = failedResponses;
summary.missing = missing;
console.log(JSON.stringify(summary, null, 2));
writeFileSync(
  `${OUT}/../playtest-summary.json`,
  `${JSON.stringify(summary, null, 2)}
`,
);
if (errors.length > 0 || failedResponses.length > 0 || missing.length > 0) {
  process.exit(1);
}
