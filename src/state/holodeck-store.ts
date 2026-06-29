import { create } from "zustand";
import {
  HOLODECK_SCENARIOS,
  type HolodeckScene,
  type HolodeckSettings,
  holodeckDrive,
  holodeckScenario,
} from "@/sim/holodeck";
import type { MineAction, MoveResult } from "@/sim/mine";

/**
 * Holodeck session state (F-043). Isolated from the live mine session: the
 * scene's MineState is fabricated by the scenario registry and mutated in
 * place by the auto-driver, with `tick` bumped so React subscribers
 * re-render. Selecting a scenario or changing a setting rebuilds the scene
 * without any route reload.
 */
interface HolodeckSessionState {
  scenarioId: string;
  settings: HolodeckSettings;
  scene: HolodeckScene;
  /** Driver steps since the current scene was built. */
  stepCount: number;
  /** Completed auto-mine + reload cycles since mount (monotonic). */
  loops: number;
  tick: number;
  lastResult: MoveResult | null;
  lastAction: MineAction | null;
  selectScenario: (id: string) => void;
  updateSetting: <K extends keyof HolodeckSettings>(
    key: K,
    value: HolodeckSettings[K],
  ) => void;
  /** Rebuild the current scenario from the current settings. */
  reset: () => void;
  /** Advance the auto-mine loop by one action (or rebuild on completion). */
  driveStep: () => void;
}

const INITIAL = HOLODECK_SCENARIOS[0];

export const useHolodeckStore = create<HolodeckSessionState>((set, get) => ({
  scenarioId: INITIAL.id,
  settings: INITIAL.defaults,
  scene: INITIAL.build(INITIAL.defaults),
  stepCount: 0,
  loops: 0,
  tick: 0,
  lastResult: null,
  lastAction: null,
  selectScenario: (id) => {
    const scenario = holodeckScenario(id);
    set((s) => ({
      scenarioId: id,
      settings: scenario.defaults,
      scene: scenario.build(scenario.defaults),
      stepCount: 0,
      lastResult: null,
      lastAction: null,
      tick: s.tick + 1,
    }));
  },
  updateSetting: (key, value) => {
    const { scenarioId, settings } = get();
    const scenario = holodeckScenario(scenarioId);
    const next = { ...settings, [key]: value };
    set((s) => ({
      settings: next,
      scene: scenario.build(next),
      stepCount: 0,
      lastResult: null,
      lastAction: null,
      tick: s.tick + 1,
    }));
  },
  reset: () => {
    const { scenarioId, settings } = get();
    const scenario = holodeckScenario(scenarioId);
    set((s) => ({
      scene: scenario.build(settings),
      stepCount: 0,
      lastResult: null,
      lastAction: null,
      tick: s.tick + 1,
    }));
  },
  driveStep: () => {
    const { scenarioId, settings, scene, stepCount } = get();
    const scenario = holodeckScenario(scenarioId);
    const driven = holodeckDrive(scenario, settings, scene, stepCount);
    set((s) => ({
      scene: driven.scene,
      stepCount: driven.reset ? 0 : stepCount + 1,
      loops: driven.reset ? s.loops + 1 : s.loops,
      lastAction: driven.action,
      lastResult: driven.result,
      tick: s.tick + 1,
    }));
  },
}));
