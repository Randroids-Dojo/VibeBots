import { expect, test } from "@playwright/test";
import {
  CURRENT_RELEASE_NOTICE_ID,
  dismissReleaseNotes,
  expectMineShellViewportLocked,
  installStandaloneVisualViewport,
  MINE_KEY_CADENCE_MS,
  openSettings,
  speedUpVersionRefreshChecks,
} from "./support/mine-helpers";

test("mine shows the latest release note once to a fresh browser", async ({
  page,
}) => {
  await page.goto("/mine");
  const dialog = page.getByRole("dialog", { name: "New in VibeBots" });
  await expect(dialog).toBeVisible();
  const version = await dialog.getAttribute("data-app-version");
  const noteId = await dialog.getAttribute("data-release-note-id");
  expect(version).toBeTruthy();
  expect(noteId).toBeTruthy();
  await expect(dialog).not.toContainText("Mason, load your first save now.");
  await expect(dialog).toContainText("Two new parts in the shop.");
  await expect(dialog.locator("li")).toHaveCount(2);
  await expect(dialog.locator("li").first()).toContainText(
    "The shop now stocks a Hardened Plate",
  );
  await expect(dialog.locator("li").nth(1)).toContainText(
    "MINE_VERSION and SIM_VERSION are unchanged",
  );

  await page.mouse.click(8, 8);
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("vibebots-release-notes-dismissed-id"),
    ),
  ).toBe(noteId);

  await page.reload();
  await expect(dialog).not.toBeVisible();

  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Release notes" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Release notes")).toBeVisible();
  const notes = dialog.locator("[data-release-note]");
  const recentReleaseNotes = [
    ["0.1.194", "Armor and a bar spinner"],
    ["0.1.193", "Mirror mode"],
    ["0.1.192", "Merges that land"],
    ["0.1.191", "Starter blueprints"],
    ["0.1.190", "Pick your chassis"],
    ["0.1.189", "Buttons that press back"],
    ["0.1.188", "A cleaner part picker"],
    ["0.1.187", "Remove a part, remove its stack"],
    ["0.1.186", "Parts stop clipping the floor"],
    ["0.1.185", "A tap won't misplace a part"],
    ["0.1.184", "Just drag to build"],
    ["0.1.183", "Merges read at a glance"],
    ["0.1.182", "See where parts fit"],
    ["0.1.181", "Turn parts before you place"],
    ["0.1.180", "Drag to merge parts"],
    ["0.1.179", "Drag parts onto the bot"],
    ["0.1.178", "One part in hand"],
    ["0.1.177", "Workshop feel"],
    ["0.1.176", "Merge on the bench"],
    ["0.1.175", "Part inspector"],
    ["0.1.174", "Tap to place parts"],
    ["0.1.173", "Workshop tabs"],
    ["0.1.172", "Workshop glow-up"],
    ["0.1.171", "Living atmosphere"],
    ["0.1.170", "Mine glow"],
    ["0.1.169", "Shinier treasure"],
    ["0.1.168", "Crush tumble"],
    ["0.1.167", "Gas leaks"],
    ["0.1.166", "Tunnel collapses"],
    ["0.1.165", "Rival fights"],
    ["0.1.164", "Fight records"],
    ["0.1.163", "Bot temperament"],
    ["0.1.162", "Saw blades"],
    ["0.1.161", "New parts shipment"],
    ["0.1.160", "Arena fight night"],
    ["0.1.159", "Playtest polish"],
    ["0.1.158", "Juicier breaks"],
    ["0.1.157", "The village dressed up"],
    ["0.1.156", "Gem-grade ores"],
    ["0.1.155", "Living blocks"],
    ["0.1.154", "Real light in the mine"],
    ["0.1.153", "Miner glow-up"],
    ["0.1.152", "Miner Showcase"],
    ["0.1.151", "Crash reports wait for the crash"],
    ["0.1.150", "Holodeck test scenes"],
    ["0.1.149", "Route-aware ladders"],
    ["0.1.148", "Visible raid XP pickups"],
    ["0.1.147", "Stratum banner fade"],
    ["0.1.146", "Raid XP here marker"],
    ["0.1.145", "Raid XP recovery"],
    ["0.1.144", "Raid XP pickup visibility"],
    ["0.1.143", "Raid XP pickup retry"],
    ["0.1.142", "Crash recovery logging"],
    ["0.1.141", "Release metadata cleanup"],
    ["0.1.140", "Fall death camera"],
    ["0.1.139", "Mine renderer cleanup"],
    ["0.1.138", "Death playback cleanup"],
    ["0.1.137", "Mine panel cleanup"],
    ["0.1.136", "Clanker chew and XP pickups"],
    ["0.1.135", "Roof cell polish"],
    ["0.1.134", "Clanker visuals"],
    ["0.1.133", "Clanker open paths"],
    ["0.1.132", "Dirt break polish"],
    ["0.1.131", "Base part visuals"],
    ["0.1.130", "Raid XP pickups"],
    ["0.1.129", "Clanker raid damage"],
    ["0.1.128", "Lantern zoom overview fix"],
    ["0.1.127", "Bunker builder controls"],
    ["0.1.126", "Scrap selection cleanup"],
    ["0.1.125", "Terminal replay movement fix"],
    ["0.1.124", "Mine terminal state fix"],
    ["0.1.123", "Save touch diagnostics"],
    ["0.1.122", "Touch drag layer"],
    ["0.1.121", "Touch zoom lock"],
    ["0.1.120", "Underground bunker claims"],
    ["0.1.119", "Jump button placement"],
    ["0.1.118", "Visual viewport refresh"],
    ["0.1.117", "Jump Jets"],
    ["0.1.116", "Shop release copy"],
    ["0.1.115", "Clean shop layout"],
    ["0.1.114", "Shop button feedback"],
    ["0.1.113", "Scrap panel text bounds"],
    ["0.1.112", "Scrap language"],
    ["0.1.111", "Hardware Store copy"],
    ["0.1.110", "Mine death report"],
    ["0.1.109", "Mine refresh viewport lock"],
    ["0.1.108", "Mine warning visuals"],
    ["0.1.107", "Sheet drag dismiss"],
    ["0.1.106", "Mine refresh layout"],
    ["0.1.105", "Battle camera"],
    ["0.1.104", "Mine input cadence"],
    ["0.1.103", "Mine load fallback"],
    ["0.1.102", "Falling rock chains"],
    ["0.1.101", "Depot copy cleanup"],
    ["0.1.100", "Surface shop prompts"],
    ["0.1.99", "Meaningful mine zoom"],
    ["0.1.98", "Mine text and status layout"],
    ["0.1.97", "Credits"],
    ["0.1.96", "Menu outside taps"],
    ["0.1.95", "Death cam surface jump fix"],
    ["0.1.94", "Cargo hold rebalance"],
    ["0.1.93", "Pickaxe battery tuning"],
    ["0.1.92", "Recall rope range"],
    ["0.1.91", "Zoom placement fix"],
    ["0.1.90", "Save slot start safety"],
    ["0.1.89", "Bunker part drag"],
    ["0.1.88", "Death cam flash fix"],
    ["0.1.87", "Mine zoom buttons"],
    ["0.1.86", "Death cam fix"],
    ["0.1.85", "Save slot refresh"],
    ["0.1.84", "Upgrade rebalance"],
    ["0.1.83", "Beacon depth gate"],
    ["0.1.82", "Pickaxe gate hints"],
    ["0.1.81", "Bunker claim clarity"],
    ["0.1.80", "Bag stacks and ore rebalance"],
    ["0.1.79", "Stamp catalog refresh"],
    ["0.1.78", "Falling rock durability"],
    ["0.1.77", "Upward mining warning"],
    ["0.1.76", "Surface tip rotation"],
    ["0.1.75", "Mine performance samples"],
    ["0.1.74", "Stale trip recovery"],
    ["0.1.73", "Falling rock crush"],
    ["0.1.72", "Plank side buttons"],
    ["0.1.71", "Ore yield tuning"],
    ["0.1.70", "Biome portal beacons"],
    ["0.1.69", "Installed app refresh"],
    ["0.1.68", "Ladder removal cleanup"],
    ["0.1.67", "Release note accuracy"],
    ["0.1.66", "Bag drop controls"],
    ["0.1.65", "Tool satchel bag"],
    ["0.1.64", "Feedback window"],
    ["0.1.63", "Native release alerts"],
    ["0.1.62", "Refresh availability guard"],
    ["0.1.61", "Ladder gravity"],
    ["0.1.60", "Dismissible windows"],
    ["0.1.59", "Bunker claim HUD"],
    ["0.1.58", "Dropped bag gravity"],
    ["0.1.57", "Bag grid"],
    ["0.1.56", "Version refresh prompt"],
    ["0.1.55", "Mine metal floor"],
    ["0.1.54", "Death bag recovery"],
  ] as const;
  const renderedReleaseNotes = await notes.evaluateAll((items) =>
    items.map((item) => ({
      version: item.getAttribute("data-release-note"),
      text: item.textContent ?? "",
    })),
  );
  expect(renderedReleaseNotes.length).toBeGreaterThanOrEqual(
    recentReleaseNotes.length,
  );
  for (const [
    index,
    [noteVersion, noteTitle],
  ] of recentReleaseNotes.entries()) {
    expect(renderedReleaseNotes[index]).toMatchObject({
      version: noteVersion,
    });
    expect(renderedReleaseNotes[index]?.text).toContain(noteTitle);
  }
  await dialog.getByRole("button", { name: "Got it" }).click();
  await expect(dialog).not.toBeVisible();

  const settingsAgain = await openSettings(page);
  await expect(settingsAgain.getByLabel("Update alerts")).toBeVisible();
  await expect(
    settingsAgain.getByRole("button", { name: "Enable update alerts" }),
  ).toBeDisabled();
  await expect(settingsAgain).toContainText(
    /Notification keys are not set on this deploy\.|Notifications are blocked in browser settings\./,
  );
});

test("mine credits open from settings and pause mine movement", async ({
  page,
}) => {
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Credits" }).click();
  const dialog = page.getByRole("dialog", { name: "Credits" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Mason and MJ Lutcavich");
  await expect(dialog).toContainText("testing VibeBots");
  await expect(dialog).toContainText("feedback");
  await expect(dialog).toContainText("great ideas");

  const status = page.getByLabel("Mine status");
  const depthBefore = await status.getAttribute("data-depth");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(MINE_KEY_CADENCE_MS);
  await expect(status).toHaveAttribute("data-depth", depthBefore ?? "0");

  await page.mouse.click(8, 8);
  await expect(dialog).not.toBeVisible();

  const settingsAgain = await openSettings(page);
  await settingsAgain.getByRole("button", { name: "Credits" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("mine prompts to refresh when the deployed version changes", async ({
  page,
}) => {
  await installStandaloneVisualViewport(page);
  await speedUpVersionRefreshChecks(page);
  await page.addInitScript((noticeId) => {
    localStorage.setItem("vibebots-release-notes-dismissed-id", noticeId);
  }, CURRENT_RELEASE_NOTICE_ID);
  await page.route("**/api/version", async (route) => {
    await route.fulfill({ json: { version: "999.0.0-test" } });
  });
  await page.route("**/mine?vibebots_version_probe=*", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: '<span hidden data-vibebots-app-version="999.0.0-test"></span>',
    });
  });
  await page.goto("/mine");
  const dismissedBeforeRefresh = await page.evaluate(() =>
    localStorage.getItem("vibebots-release-notes-dismissed-id"),
  );
  expect(dismissedBeforeRefresh).toBeTruthy();

  const prompt = page.getByRole("dialog", {
    name: "New version available",
  });
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText(
    "Refresh to load the latest VibeBots build.",
  );
  await expect(prompt).toHaveAttribute(
    "data-version-refresh-prompt",
    "999.0.0-test",
  );
  await prompt.getByRole("button", { name: "Refresh" }).click();
  await page.waitForURL("**/mine?vibebots_refresh=999.0.0-test");
  const shell = page.locator("[data-mine-shell]");
  await expect(shell).toBeVisible();
  await expect(shell).toHaveAttribute("data-display-mode", "standalone");
  await expect(shell).toHaveAttribute("data-refresh-entry", "999.0.0-test");
  await expect(shell).toHaveAttribute("data-visual-viewport-top", "64.00");
  await expect(shell).toHaveAttribute("data-visual-viewport-height", "696.00");
  await expectMineShellViewportLocked(page);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("vibebots-release-notes-dismissed-id"),
    ),
  ).toBe(dismissedBeforeRefresh);
  await expect(
    page.getByRole("dialog", { name: "New in VibeBots" }),
  ).not.toBeVisible();
});

test("mine realigns installed app controls when the visual viewport changes", async ({
  page,
}) => {
  await installStandaloneVisualViewport(page);
  await page.goto("/mine");
  await dismissReleaseNotes(page);

  await expectMineShellViewportLocked(page);
  await page.evaluate(() => {
    const setVisualViewport = (
      window as typeof window & {
        __vibebotsSetVisualViewport?: (next: {
          height: number;
          offsetTop: number;
        }) => void;
      }
    ).__vibebotsSetVisualViewport;
    if (!setVisualViewport) {
      throw new Error("visual viewport test fixture was not installed");
    }
    setVisualViewport({ height: 668, offsetTop: 92 });
  });

  const shell = page.locator("[data-mine-shell]");
  await expect(shell).toHaveAttribute("data-display-mode", "standalone");
  await expect(shell).toHaveAttribute("data-visual-viewport-top", "92.00");
  await expect(shell).toHaveAttribute("data-visual-viewport-height", "668.00");
  await expectMineShellViewportLocked(page);
});

test("mine waits to show refresh prompt until the new page is refreshable", async ({
  page,
}) => {
  await speedUpVersionRefreshChecks(page);
  await page.route("**/api/version", async (route) => {
    await route.fulfill({ json: { version: "999.0.0-test" } });
  });
  await page.route("**/mine?vibebots_version_probe=*", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: '<span hidden data-vibebots-app-version="0.1.59.old"></span>',
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await page.waitForTimeout(120);

  await expect(
    page.getByRole("dialog", { name: "New version available" }),
  ).not.toBeVisible();
});

test("mine rechecks stale installed app shells when the app returns to foreground", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(
    page.getByRole("dialog", { name: "New version available" }),
  ).not.toBeVisible();

  const version = "999.0.1-test";
  await page.route("**/api/version", async (route) => {
    await route.fulfill({ json: { version } });
  });
  await page.route("**/mine?vibebots_version_probe=*", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<span hidden data-vibebots-app-version="${version}"></span>`,
    });
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    window.dispatchEvent(new Event("focus"));
  });

  await expect(
    page.getByRole("dialog", { name: "New version available" }),
  ).toBeVisible();
});

test("mine refresh prompt dismisses from an outside tap", async ({ page }) => {
  await speedUpVersionRefreshChecks(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "vibebots-release-notes-dismissed-id",
      "2026-06-20-0.1.113-scrap-panel-text-bounds",
    );
  });
  await page.route("**/api/version", async (route) => {
    await route.fulfill({ json: { version: "999.0.2-test" } });
  });
  await page.route("**/mine?vibebots_version_probe=*", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: '<span hidden data-vibebots-app-version="999.0.2-test"></span>',
    });
  });

  await page.goto("/mine");

  const prompt = page.getByRole("dialog", {
    name: "New version available",
  });
  await expect(prompt).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(prompt).not.toBeVisible();
});

test("mine asks mobile Safari users to add the Home Screen app for alerts", async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  await page.goto("/mine");
  await dismissReleaseNotes(page);

  const dialog = page.getByRole("dialog", {
    name: "Add VibeBots to Home Screen",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "Mobile Safari needs the Home Screen app before notifications can work.",
  );
  await expect(dialog).toContainText(
    "Safari does not let websites open that sheet automatically.",
  );

  await page.mouse.click(8, 8);
  await expect(dialog).not.toBeVisible();

  await page.reload();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Ok" }).click();
  await expect(dialog).not.toBeVisible();

  await page.reload();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Never show again" }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("vibebots-ios-home-screen-prompt-never"),
    ),
  ).toBe("1");

  await page.reload();
  await expect(dialog).not.toBeVisible();
  await context.close();
});
