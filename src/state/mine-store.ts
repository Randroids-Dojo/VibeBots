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
 * re-render. Every session gets a fresh random seed and records its move
 * log: cashing out submits (seed, moves) and the server replays it (the
 * mine is a pure function of both), then the seed is consumed and a new
 * session starts.
 */

function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

export type CashOutState =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "done"; emeralds: number; parts: string[]; balance: number }
  | { state: "unavailable" }
  | { state: "error"; message: string };

export interface MineSessionState {
  mine: MineState;
  seed: number;
  moves: Direction[];
  tick: number;
  lastResult: MoveResult | null;
  cashOut: CashOutState;
  move: (dir: Direction) => void;
  submitCashOut: () => Promise<void>;
  restart: (seed?: number) => void;
}

export const useMineStore = create<MineSessionState>((set, get) => {
  const seed = randomSeed();
  return {
    mine: createMine(seed),
    seed,
    moves: [],
    tick: 0,
    lastResult: null,
    cashOut: { state: "idle" },

    move: (dir) => {
      const { mine, tick, moves, cashOut } = get();
      // The submitted log must match what gets credited; digging during
      // a pending cash-out would be silently discarded on success.
      if (cashOut.state === "pending") return;
      const result = step(mine, dir);
      moves.push(dir);
      set({ tick: tick + 1, lastResult: result });
    },

    submitCashOut: async () => {
      const { seed: currentSeed, moves } = get();
      set({ cashOut: { state: "pending" } });
      try {
        const res = await fetch("/api/mine/bank", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ seed: currentSeed, moves }),
        });
        if (res.status === 503) {
          set({ cashOut: { state: "unavailable" } });
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          set({
            cashOut: {
              state: "error",
              message:
                typeof body.error === "string" ? body.error : "cash out failed",
            },
          });
          return;
        }
        const body = await res.json();
        // The seed is consumed server-side: a fresh mine starts.
        const nextSeed = randomSeed();
        set({
          cashOut: {
            state: "done",
            emeralds: body.credited.emeralds,
            parts: body.credited.parts,
            balance: body.balance,
          },
          mine: createMine(nextSeed),
          seed: nextSeed,
          moves: [],
          tick: 0,
          lastResult: null,
        });
      } catch {
        set({ cashOut: { state: "error", message: "cash out failed" } });
      }
    },

    restart: (seedOverride) => {
      const nextSeed = seedOverride ?? randomSeed();
      set({
        mine: createMine(nextSeed),
        seed: nextSeed,
        moves: [],
        tick: 0,
        lastResult: null,
        cashOut: { state: "idle" },
      });
    },
  };
});
