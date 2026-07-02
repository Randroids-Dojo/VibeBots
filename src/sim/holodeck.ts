/**
 * Holodeck scenarios (F-043): small, controlled, reloadable mine scenes
 * for builders to inspect a single mechanic in isolation. Pure logic, like
 * the rest of `src/sim`: a scenario is just a fabricated `MineState` plus a
 * scripted action plan, so the same settings always produce the same scene
 * and the same loop. The renderer and the auto-driver live in the
 * component/store layer; nothing here touches react/three/zustand.
 */
import {
  applyAction,
  cellAt,
  createMine,
  DEFAULT_GEAR,
  type MineAction,
  type MineCell,
  type MineGear,
  type MineState,
  type MoveResult,
  setCell,
} from "./mine";

export type HolodeckBlockType = "dirt" | "coal" | "diamond" | "rock";

export interface HolodeckSettings {
  /** Pickaxe level (1-10): swings to break and rock-tier permission. */
  pickaxe: number;
  /** Which block the miner chews on. */
  blockType: HolodeckBlockType;
  /** Fixed seed so the scene is fully deterministic. */
  seed: number;
  /** Miner Showcase: which animation clip plays. The values are plain
   * strings here so the pure registry never imports the render-side
   * clip table; the canvas resolves unknown ids to idle. */
  clip?: string;
  /** Miner Showcase: stage rotation ("off" | "spin"). */
  turntable?: string;
}

export interface HolodeckControlOption {
  value: string;
  label: string;
}

/**
 * A scenario declares its own controls so the panel renders them generically.
 * New scenarios add controls here, never in the options menu.
 */
export interface HolodeckControlDef {
  key: keyof HolodeckSettings;
  label: string;
  kind: "range" | "select";
  /** range controls */
  min?: number;
  max?: number;
  step?: number;
  /** select controls */
  options?: readonly HolodeckControlOption[];
}

export interface HolodeckScene {
  state: MineState;
  /** The single block the scenario is about. */
  target: { col: number; row: number };
  /** Actions the driver replays in order (cycled if it runs past the end). */
  plan: readonly MineAction[];
  /** Watchdog: rebuild after this many drive steps no matter what, so an
   * unproductive configuration (a rock too hard for the pickaxe) still loops
   * visibly instead of freezing. */
  maxSteps: number;
}

export interface HolodeckScenario {
  id: string;
  name: string;
  icon: string;
  description: string;
  controls: readonly HolodeckControlDef[];
  defaults: HolodeckSettings;
  build(settings: HolodeckSettings): HolodeckScene;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const SINGLE_BLOCK_COL = 0;
/** Rows of empty headroom above the block: keeps the surface row out of frame. */
const SINGLE_BLOCK_MINER_ROW = 4;
/** Empty columns to either side so only the one block reads as solid. */
const SINGLE_BLOCK_VOID_RADIUS = 5;

function singleBlockCell(settings: HolodeckSettings): MineCell {
  switch (settings.blockType) {
    case "dirt":
      return { kind: "dirt" };
    case "coal":
      return { kind: "ore", ore: "coal" };
    case "diamond":
      return { kind: "ore", ore: "diamond" };
    case "rock":
      // Scale the rock to the pickaxe (level N digs tiers up to N-1) so the
      // auto loop keeps progressing while higher levels demo tougher rock.
      // A level-1 pickaxe cannot cut even tier 1: the watchdog still loops it.
      return { kind: "rock", rockTier: clamp(settings.pickaxe - 1, 1, 9) };
  }
}

function buildSingleBlock(settings: HolodeckSettings): HolodeckScene {
  const pickaxe = clamp(Math.floor(settings.pickaxe), 1, 10);
  const gear: MineGear = {
    ...DEFAULT_GEAR,
    pickaxe,
    // Full battery and lantern so energy and visibility never gate the demo.
    battery: 10,
    lantern: 8,
  };
  const state = createMine(settings.seed, gear);

  const minerRow = SINGLE_BLOCK_MINER_ROW;
  const targetRow = minerRow + 1;
  const floorRow = minerRow + 2;
  const firstCol = SINGLE_BLOCK_COL - SINGLE_BLOCK_VOID_RADIUS;
  const lastCol = SINGLE_BLOCK_COL + SINGLE_BLOCK_VOID_RADIUS;

  // Carve an empty void around the miner so the procedural world never shows.
  for (let row = 1; row <= floorRow + 1; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      setCell(state, col, row, { kind: "empty" });
    }
  }
  // A solid floor gives the miner footing once the block is gone.
  for (let col = firstCol; col <= lastCol; col++) {
    setCell(state, col, floorRow, { kind: "metal" });
  }
  // The one block, directly under the miner.
  const target = { col: SINGLE_BLOCK_COL, row: targetRow };
  setCell(state, target.col, target.row, singleBlockCell(settings));

  state.miner.col = SINGLE_BLOCK_COL;
  state.miner.row = minerRow;

  return { state, target, plan: ["down"], maxSteps: 24 };
}

export const SINGLE_BLOCK_SCENARIO: HolodeckScenario = {
  id: "single-block",
  name: "Single Block",
  icon: "🧱",
  description: "Miner auto-mines one block on a loop. Tune pickaxe and block.",
  controls: [
    {
      key: "pickaxe",
      label: "Pickaxe level",
      kind: "range",
      min: 1,
      max: 10,
      step: 1,
    },
    {
      key: "blockType",
      label: "Block type",
      kind: "select",
      options: [
        { value: "dirt", label: "Dirt" },
        { value: "coal", label: "Coal ore" },
        { value: "diamond", label: "Diamond ore" },
        { value: "rock", label: "Rock" },
      ],
    },
  ],
  defaults: { pickaxe: 3, blockType: "dirt", seed: 1 },
  build: buildSingleBlock,
};

/** Empty columns to either side of the showcase stage. */
const SHOWCASE_VOID_RADIUS = 5;
const SHOWCASE_MINER_ROW = 4;

function buildMinerShowcase(settings: HolodeckSettings): HolodeckScene {
  const gear: MineGear = {
    ...DEFAULT_GEAR,
    pickaxe: clamp(Math.floor(settings.pickaxe), 1, 10),
    battery: 10,
    lantern: 8,
  };
  const state = createMine(settings.seed, gear);

  const minerRow = SHOWCASE_MINER_ROW;
  const floorRow = minerRow + 1;
  const firstCol = SINGLE_BLOCK_COL - SHOWCASE_VOID_RADIUS;
  const lastCol = SINGLE_BLOCK_COL + SHOWCASE_VOID_RADIUS;

  // An empty stage: void around the miner, a metal catwalk underfoot.
  for (let row = 1; row <= floorRow + 1; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      setCell(state, col, row, { kind: "empty" });
    }
  }
  for (let col = firstCol; col <= lastCol; col++) {
    setCell(state, col, floorRow, { kind: "metal" });
  }

  state.miner.col = SINGLE_BLOCK_COL;
  state.miner.row = minerRow;

  // The animation is renderer-driven (clip inputs), so the plan is empty:
  // the driver idles and the scene never rebuilds underneath a pose.
  return {
    state,
    target: { col: SINGLE_BLOCK_COL, row: floorRow },
    plan: [],
    maxSteps: Number.MAX_SAFE_INTEGER,
  };
}

export const MINER_SHOWCASE_SCENARIO: HolodeckScenario = {
  id: "miner-showcase",
  name: "Miner Showcase",
  icon: "🤖",
  description:
    "The miner on an empty stage. Pick an animation clip and spin the turntable to inspect the model.",
  controls: [
    {
      key: "clip",
      label: "Animation",
      kind: "select",
      options: [
        { value: "idle", label: "Idle" },
        { value: "walk", label: "Walk" },
        { value: "dig", label: "Dig" },
        { value: "rebuff", label: "Rebuff" },
        { value: "crush", label: "Crush" },
      ],
    },
    {
      key: "turntable",
      label: "Turntable",
      kind: "select",
      options: [
        { value: "off", label: "Off" },
        { value: "spin", label: "Spin" },
      ],
    },
  ],
  defaults: {
    pickaxe: 3,
    blockType: "dirt",
    seed: 1,
    clip: "idle",
    turntable: "off",
  },
  build: buildMinerShowcase,
};

export const HOLODECK_SCENARIOS: readonly HolodeckScenario[] = [
  SINGLE_BLOCK_SCENARIO,
  MINER_SHOWCASE_SCENARIO,
];

export function holodeckScenario(id: string): HolodeckScenario {
  return HOLODECK_SCENARIOS.find((s) => s.id === id) ?? SINGLE_BLOCK_SCENARIO;
}

/** The scenario's target block has been fully mined out. */
export function holodeckComplete(scene: HolodeckScene): boolean {
  return (
    cellAt(scene.state, scene.target.col, scene.target.row)?.kind === "empty"
  );
}

/**
 * Advance the scene by one driver step. Returns the rebuilt scene when the
 * block is gone or the watchdog trips (the loop), otherwise mutates the
 * current scene in place and returns it.
 */
export function holodeckDrive(
  scenario: HolodeckScenario,
  settings: HolodeckSettings,
  scene: HolodeckScene,
  stepCount: number,
): {
  scene: HolodeckScene;
  action: MineAction | null;
  result: MoveResult | null;
  reset: boolean;
} {
  // A planless scenario (Miner Showcase) is a static stage: the driver
  // idles and never rebuilds the scene underneath the rendered pose.
  if (scene.plan.length === 0) {
    return { scene, action: null, result: null, reset: false };
  }
  if (holodeckComplete(scene) || stepCount >= scene.maxSteps) {
    return {
      scene: scenario.build(settings),
      action: null,
      result: null,
      reset: true,
    };
  }
  const action = scene.plan[stepCount % scene.plan.length];
  const result = applyAction(scene.state, action);
  return { scene, action, result, reset: false };
}
