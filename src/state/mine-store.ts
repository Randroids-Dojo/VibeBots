import { create } from "zustand";
import {
  createMine,
  type Direction,
  type MineState,
  type MoveResult,
  step,
} from "@/sim/mine";

/**
 * Mining session state. The MineState object is mutated in place by the
 * pure sim logic; `tick` bumps on every action so React subscribers
 * re-render. Deterministic per seed.
 */

const DEFAULT_SEED = 1337;

export interface MineSessionState {
  mine: MineState;
  tick: number;
  lastResult: MoveResult | null;
  move: (dir: Direction) => void;
  restart: (seed?: number) => void;
}

export const useMineStore = create<MineSessionState>((set, get) => ({
  mine: createMine(DEFAULT_SEED),
  tick: 0,
  lastResult: null,

  move: (dir) => {
    const { mine, tick } = get();
    const result = step(mine, dir);
    set({ tick: tick + 1, lastResult: result });
  },

  restart: (seed = DEFAULT_SEED) =>
    set({ mine: createMine(seed), tick: 0, lastResult: null }),
}));
