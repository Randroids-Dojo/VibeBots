import { expect, test } from "@playwright/test";
import {
  APP_VERSION_PATTERN,
  dismissReleaseNotes,
} from "./support/mine-helpers";

/**
 * Opt-in deep performance telemetry (F-054). The toggle in the mine
 * settings menu starts a live collector that batches snapshots (frame
 * percentiles + renderer/scene probe) into POST /api/performance/trace.
 */

function speedUpTrace() {
  const w = window as typeof window & {
    __vibebotsPerfTraceSnapshotMs?: number;
    __vibebotsPerfTraceFlushMs?: number;
  };
  // Wide enough windows to catch frames even on software-GL CI runners
  // that render the mine at a handful of fps.
  w.__vibebotsPerfTraceSnapshotMs = 2_000;
  w.__vibebotsPerfTraceFlushMs = 4_000;
}

test.describe("performance telemetry", () => {
  test("toggle starts trace batches with scene probe data", async ({
    page,
  }) => {
    const batches: unknown[] = [];
    await page.route("**/api/performance/trace", async (route) => {
      batches.push(route.request().postDataJSON());
      await route.fulfill({ json: { saved: 1 } });
    });
    await page.addInitScript(speedUpTrace);

    await page.goto("/mine");
    await expect(page.locator("canvas")).toBeVisible();
    await dismissReleaseNotes(page);

    // Off by default: no batches while the toggle is off.
    await page.waitForTimeout(2_200);
    expect(batches).toHaveLength(0);

    // Flip the toggle on from the settings menu.
    await page.getByRole("button", { name: "Open settings" }).click();
    const toggle = page.locator("[data-perf-telemetry-toggle]");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    await expect
      .poll(() => batches.length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    const payload = batches[0] as Record<string, unknown>;
    expect(payload.source).toBe("mine");
    expect(String(payload.appVersion)).toMatch(APP_VERSION_PATTERN);
    expect(String(payload.sessionId)).toMatch(/^[0-9a-f]{16}$/);
    expect(payload.viewportWidth).toBeGreaterThan(0);
    expect(
      payload.qualityTier === "low" || payload.qualityTier === "high",
    ).toBe(true);
    const snapshots = payload.snapshots as Record<string, unknown>[];
    expect(snapshots.length).toBeGreaterThan(0);
    const first = snapshots[0];
    expect(first.frameCount).toBeGreaterThanOrEqual(2);
    expect(first.p95FrameMs).toBeGreaterThan(0);
    expect(first.hiddenMs).toBeGreaterThanOrEqual(0);
    expect(first.visibilityChangeCount).toBeGreaterThanOrEqual(0);
    // Chromium supports resource timing, so the network rollup must be
    // present, and its request paths must never carry a query string.
    const net = first.net as {
      requestCount: number;
      topRequests: { path: string }[];
    } | null;
    expect(net).not.toBeNull();
    if (net) {
      expect(net.requestCount).toBeGreaterThanOrEqual(0);
      for (const request of net.topRequests) {
        expect(request.path).not.toContain("?");
      }
    }
    const probe = first.probe as Record<string, unknown> | null;
    expect(probe).not.toBeNull();
    if (probe) {
      expect(probe.backend === "webgpu" || probe.backend === "webgl2").toBe(
        true,
      );
      expect(probe.meshCount).toBeGreaterThan(0);
      expect(probe.lightCount).toBeGreaterThan(0);
      expect(probe.drawCalls).toBeGreaterThan(0);
    }

    // Flip it back off: collection stops.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await page.waitForTimeout(1_000);
    const settled = batches.length;
    await page.waitForTimeout(5_000);
    expect(batches.length).toBe(settled);
  });

  test("an enabled toggle persists and collects on other surfaces", async ({
    page,
  }) => {
    const batches: unknown[] = [];
    await page.route("**/api/performance/trace", async (route) => {
      batches.push(route.request().postDataJSON());
      await route.fulfill({ json: { saved: 1 } });
    });
    await page.addInitScript(speedUpTrace);
    await page.addInitScript(() => {
      window.localStorage.setItem("vibebots-perf-analyzer-v1", "on");
    });

    await page.goto("/workshop");
    await expect(page.locator("canvas")).toBeVisible();
    await expect
      .poll(() => batches.length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    const payload = batches[0] as Record<string, unknown>;
    expect(payload.source).toBe("workshop");
    const snapshots = payload.snapshots as Record<string, unknown>[];
    expect(snapshots[0].seq).toBe(1);
  });
});
