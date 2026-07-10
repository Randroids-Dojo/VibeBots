import { describe, expect, it } from "vitest";
import {
  BLOCK_GALLERY_SCENARIO,
  HOLODECK_SCENARIOS,
  type HolodeckSettings,
  holodeckComplete,
  holodeckDrive,
  holodeckScenario,
  MINER_SHOWCASE_SCENARIO,
  SINGLE_BLOCK_SCENARIO,
  SURFACE_VILLAGE_SCENARIO,
} from "./holodeck";
import { applyAction, cellAt, exportDiff } from "./mine";

const BASE: HolodeckSettings = { pickaxe: 3, blockType: "dirt", seed: 1 };

describe("holodeck single-block scenario", () => {
  it("fabricates a void with one solid target block and a floor", () => {
    const scene = SINGLE_BLOCK_SCENARIO.build({ ...BASE, blockType: "coal" });
    const { state, target } = scene;

    // The one block is the chosen kind.
    const block = cellAt(state, target.col, target.row);
    expect(block?.kind).toBe("ore");
    expect(block?.ore).toBe("coal");

    // The miner stands directly above it.
    expect(state.miner.col).toBe(target.col);
    expect(state.miner.row).toBe(target.row - 1);

    // Cells beside the block are carved empty; below it is solid footing.
    expect(cellAt(state, target.col - 1, target.row)?.kind).toBe("empty");
    expect(cellAt(state, target.col + 1, target.row)?.kind).toBe("empty");
    expect(cellAt(state, target.col, target.row + 1)?.kind).toBe("metal");
  });

  it("maps block-type and pickaxe settings onto the target", () => {
    const dirt = SINGLE_BLOCK_SCENARIO.build({ ...BASE, blockType: "dirt" });
    expect(cellAt(dirt.state, dirt.target.col, dirt.target.row)?.kind).toBe(
      "dirt",
    );

    const rock = SINGLE_BLOCK_SCENARIO.build({
      ...BASE,
      blockType: "rock",
      pickaxe: 4,
    });
    const rockCell = cellAt(rock.state, rock.target.col, rock.target.row);
    expect(rockCell?.kind).toBe("rock");
    // Level 4 pickaxe digs rock tiers up to 3, so the block stays diggable.
    expect(rockCell?.rockTier).toBe(3);
  });

  it("is deterministic: same settings build and replay to the same world", () => {
    const settings: HolodeckSettings = {
      pickaxe: 2,
      blockType: "diamond",
      seed: 7,
    };
    const a = SINGLE_BLOCK_SCENARIO.build(settings);
    const b = SINGLE_BLOCK_SCENARIO.build(settings);
    expect(exportDiff(a.state)).toEqual(exportDiff(b.state));

    for (let i = 0; i < 5; i++) {
      applyAction(a.state, "down");
      applyAction(b.state, "down");
    }
    expect(exportDiff(a.state)).toEqual(exportDiff(b.state));
  });

  it("auto-mines the block to completion within the watchdog", () => {
    const scene = SINGLE_BLOCK_SCENARIO.build(BASE);
    expect(holodeckComplete(scene)).toBe(false);

    let completed = false;
    for (let i = 0; i < scene.maxSteps; i++) {
      applyAction(scene.state, "down");
      if (holodeckComplete(scene)) {
        completed = true;
        break;
      }
    }
    expect(completed).toBe(true);
  });

  it("loops: the driver rebuilds a fresh solid block once mined", () => {
    const scenario = holodeckScenario("single-block");
    let scene = scenario.build(BASE);
    let stepCount = 0;

    // Drive until the rebuild fires.
    let rebuilt = false;
    for (let i = 0; i < scene.maxSteps + 5; i++) {
      const driven = holodeckDrive(scenario, BASE, scene, stepCount);
      scene = driven.scene;
      stepCount = driven.reset ? 0 : stepCount + 1;
      if (driven.reset) {
        rebuilt = true;
        break;
      }
    }
    expect(rebuilt).toBe(true);
    // The fresh scene has a solid block again: the loop is closed.
    expect(holodeckComplete(scene)).toBe(false);
    expect(stepCount).toBe(0);
  });
});

describe("holodeck registry", () => {
  it("exposes scenarios and falls back to the first for unknown ids", () => {
    expect(HOLODECK_SCENARIOS.length).toBeGreaterThan(0);
    expect(holodeckScenario("does-not-exist")).toBe(SINGLE_BLOCK_SCENARIO);
    expect(holodeckScenario("miner-showcase")).toBe(MINER_SHOWCASE_SCENARIO);
    expect(holodeckScenario("surface-village")).toBe(SURFACE_VILLAGE_SCENARIO);
    expect(SURFACE_VILLAGE_SCENARIO.controls[0]?.key).toBe("surfaceView");
  });
});

describe("holodeck block gallery scenario", () => {
  it("lines up every kind in the selected set on a metal stage", () => {
    const scene = BLOCK_GALLERY_SCENARIO.build(BLOCK_GALLERY_SCENARIO.defaults);
    const row = scene.state.miner.row;
    const kinds = new Set<string>();
    for (let col = -12; col <= 12; col++) {
      const cell = cellAt(scene.state, col, row);
      if (cell && cell.kind !== "empty") kinds.add(cell.kind);
    }
    for (const kind of [
      "dirt",
      "rock",
      "metal",
      "part-cache",
      "gas",
      "boulder",
    ]) {
      expect(kinds).toContain(kind);
    }
    expect(cellAt(scene.state, scene.state.miner.col, row + 1)?.kind).toBe(
      "metal",
    );
  });

  it("switches sets through the gallerySet control", () => {
    const scene = BLOCK_GALLERY_SCENARIO.build({
      ...BLOCK_GALLERY_SCENARIO.defaults,
      gallerySet: "ores-frost",
    });
    const row = scene.state.miner.row;
    const ores = new Set<string>();
    for (let col = -12; col <= 12; col++) {
      const cell = cellAt(scene.state, col, row);
      if (cell?.kind === "ore" && cell.ore) ores.add(cell.ore);
    }
    // The scan range can catch procedural ore outside the carved stage,
    // so assert the staged set is present rather than an exact count.
    for (const ore of [
      "frozen-coal",
      "frost-copper",
      "rime-silver",
      "aurora-emerald",
      "glacier-ruby",
      "blue-diamond",
      "permafrost-core",
    ]) {
      expect(ores).toContain(ore);
    }
  });

  it("idles the driver like the showcase (planless stage)", () => {
    const scene = BLOCK_GALLERY_SCENARIO.build(BLOCK_GALLERY_SCENARIO.defaults);
    const driven = holodeckDrive(
      BLOCK_GALLERY_SCENARIO,
      BLOCK_GALLERY_SCENARIO.defaults,
      scene,
      5,
    );
    expect(driven.scene).toBe(scene);
    expect(driven.reset).toBe(false);
  });
});

describe("holodeck miner showcase scenario", () => {
  const SETTINGS = MINER_SHOWCASE_SCENARIO.defaults;

  it("builds an empty stage with a metal catwalk under the miner", () => {
    const scene = MINER_SHOWCASE_SCENARIO.build(SETTINGS);
    const { col, row } = scene.state.miner;
    expect(cellAt(scene.state, col, row)?.kind).toBe("empty");
    expect(cellAt(scene.state, col, row + 1)?.kind).toBe("metal");
    for (let dc = -3; dc <= 3; dc++) {
      expect(cellAt(scene.state, col + dc, row)?.kind).toBe("empty");
    }
  });

  it("declares the clip and turntable controls with defaults", () => {
    const keys = MINER_SHOWCASE_SCENARIO.controls.map((c) => c.key);
    expect(keys).toContain("clip");
    expect(keys).toContain("turntable");
    expect(SETTINGS.clip).toBe("idle");
    expect(SETTINGS.turntable).toBe("off");
  });

  it("idles the driver: a planless scene never resets or acts", () => {
    const scene = MINER_SHOWCASE_SCENARIO.build(SETTINGS);
    for (let step = 0; step < 40; step++) {
      const driven = holodeckDrive(
        MINER_SHOWCASE_SCENARIO,
        SETTINGS,
        scene,
        step,
      );
      expect(driven.scene).toBe(scene);
      expect(driven.reset).toBe(false);
      expect(driven.action).toBeNull();
    }
    // The stage is intact: the metal target is not something to complete.
    expect(holodeckComplete(scene)).toBe(false);
  });
});
