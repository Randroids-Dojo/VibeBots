import { describe, expect, it } from "vitest";
import {
  HOLODECK_SCENARIOS,
  type HolodeckSettings,
  holodeckComplete,
  holodeckDrive,
  holodeckScenario,
  SINGLE_BLOCK_SCENARIO,
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
  });
});
