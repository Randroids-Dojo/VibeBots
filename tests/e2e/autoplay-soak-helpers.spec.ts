import { expect, test } from "@playwright/test";
import {
  blockingOverlay,
  drainKnownDialogs,
  drainTripReports,
} from "../../scripts/autoplay-soak-lib.mjs";

// Fixture-level coverage for the browser helpers the soak driver relies on.
// Each test serves isolated HTML that reproduces a condition the driver must
// handle, then drives the real helper against it. No app server needed.

test.describe("blockingOverlay", () => {
  test("returns the first VISIBLE modal, skipping a hidden earlier match", async ({
    page,
  }) => {
    await page.setContent(`
      <div role="dialog" aria-label="Hidden one" style="display:none"></div>
      <div role="dialog" aria-label="Real blocker"><p>stuck</p></div>
    `);
    expect(await blockingOverlay(page)).toBe("Real blocker");
  });

  test("returns null when no modal is visible", async ({ page }) => {
    await page.setContent(`
      <div role="dialog" aria-label="Hidden" style="display:none"></div>
      <main>playable</main>
    `);
    expect(await blockingOverlay(page)).toBeNull();
  });
});

test.describe("drainKnownDialogs", () => {
  test("dismisses each known dialog through its own control by name", async ({
    page,
  }) => {
    // Two dialogs share an "Ok" button; the helper must scope each click to
    // its dialog (by accessible name) so the two do not collide.
    await page.setContent(`
      <div role="dialog" aria-modal="true" aria-labelledby="fr">
        <h2 id="fr">Falling rock</h2>
        <button type="button" onclick="this.closest('[role=dialog]').remove()">Ok</button>
      </div>
      <div role="dialog" aria-modal="true" aria-labelledby="ld">
        <h2 id="ld">Ladders can fall now</h2>
        <button type="button" onclick="this.closest('[role=dialog]').remove()">Ok</button>
      </div>
    `);
    const { drained, byName } = await drainKnownDialogs(page);
    expect(drained).toBe(2);
    expect(byName["Falling rock"]).toBe(1);
    expect(byName["Ladders can fall now"]).toBe(1);
    expect(byName["New in VibeBots"]).toBe(0);
    expect(await blockingOverlay(page)).toBeNull();
  });

  test("leaves an unknown dialog for the blocking-overlay net", async ({
    page,
  }) => {
    await page.setContent(`
      <div role="dialog" aria-label="Some other popup"><p>x</p></div>
    `);
    const { drained } = await drainKnownDialogs(page);
    expect(drained).toBe(0);
    expect(await blockingOverlay(page)).toBe("Some other popup");
  });
});

test.describe("drainTripReports", () => {
  test("reports nothing to drain when no report is present", async ({
    page,
  }) => {
    await page.setContent("<main>playing</main>");
    const result = await drainTripReports(page);
    expect(result).toMatchObject({ drained: 0, stuck: false, persists: false });
  });

  test("drains a dismissable report and does not flag it", async ({ page }) => {
    await page.setContent(`
      <button aria-label="Dismiss trip report" onclick="this.remove()">tap</button>
    `);
    const result = await drainTripReports(page);
    expect(result.drained).toBe(1);
    expect(result.stuck).toBe(false);
    expect(result.persists).toBe(false);
  });

  test("signals stuck and persists when a report stays visible after the bound", async ({
    page,
  }) => {
    // The dismiss control exists and clicks fine, but the report never hides,
    // so the hidden-wait throws (a real interaction failure) and the report
    // is still on screen after the bound: both `stuck` and `persists` are
    // set. The caller uses these to avoid pressing a policy key behind the
    // full-screen report (it skips the turn and only fails after the report
    // blocks play for many consecutive turns). A dismissable-but-recurring
    // report reaches the same `persists` signal; its reappear timing cannot
    // be made deterministic in a fixture, so this covers the signal.
    await page.setContent(`
      <button aria-label="Dismiss trip report">tap (does nothing)</button>
    `);
    const result = await drainTripReports(page);
    expect(result.stuck).toBe(true);
    expect(result.persists).toBe(true);
    expect(result.stuckError).not.toBeNull();
  });
});
