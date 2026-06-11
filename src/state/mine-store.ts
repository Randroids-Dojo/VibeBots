import { create } from "zustand";
import {
  applyAction,
  createMine,
  DEFAULT_GEAR,
  MINE_VERSION,
  type MineAction,
  type MineConsumables,
  type MineGear,
  type MineState,
  type MoveResult,
  NO_CONSUMABLES,
} from "@/sim/mine";

/**
 * Mining session state. The MineState object is mutated in place by the
 * pure sim logic; `tick` bumps on every action so React subscribers
 * re-render. Every session gets a fresh random seed and records its move
 * log: cashing out submits (seed, gear, moves) and the server replays it
 * (the mine is a pure function of all three), then the seed is consumed
 * and a new session starts. Gear is fetched once per mount; without
 * storage the defaults apply (level 1 everything).
 */

function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

export type CashOutState =
  | { state: "idle" }
  | { state: "pending" }
  | {
      state: "done";
      credits: number;
      parts: string[];
      milestoneBonus: number;
      balance: number;
    }
  | { state: "unavailable" }
  | { state: "error"; message: string };

export interface MineSessionState {
  mine: MineState;
  seed: number;
  gear: MineGear;
  consumables: MineConsumables;
  moves: MineAction[];
  tick: number;
  lastResult: MoveResult | null;
  cashOut: CashOutState;
  move: (action: MineAction) => void;
  loadGear: () => Promise<void>;
  submitCashOut: () => Promise<void>;
  restart: (seed?: number) => void;
}

export const useMineStore = create<MineSessionState>((set, get) => {
  const seed = randomSeed();
  return {
    mine: createMine(seed),
    seed,
    gear: DEFAULT_GEAR,
    consumables: NO_CONSUMABLES,
    moves: [],
    tick: 0,
    lastResult: null,
    cashOut: { state: "idle" },

    move: (action) => {
      const { mine, tick, moves, cashOut } = get();
      // The submitted log must match what gets credited; digging during
      // a pending cash-out would be silently discarded on success.
      if (cashOut.state === "pending") return;
      const result = applyAction(mine, action);
      // Refused actions are not part of the trip (the sim ignored them).
      if (result.ok) moves.push(action);
      set({ tick: tick + 1, lastResult: result });
    },

    loadGear: async () => {
      try {
        const res = await fetch("/api/gear");
        if (!res.ok) return; // 503 etc: defaults stay
        const body = await res.json();
        const gear: MineGear = body.gear;
        const consumables: MineConsumables = body.consumables ?? NO_CONSUMABLES;
        const current = get().gear;
        const currentCons = get().consumables;
        if (
          gear.pickaxe === current.pickaxe &&
          gear.lamp === current.lamp &&
          gear.cargo === current.cargo &&
          gear.lantern === current.lantern &&
          consumables.dynamite === currentCons.dynamite &&
          consumables.rope === currentCons.rope
        ) {
          return;
        }
        // Gear changes the sim, so a session restarts with the snapshot
        // (only at mount or after shopping; mid-trip this never fires).
        const nextSeed = randomSeed();
        set({
          gear,
          consumables,
          mine: createMine(nextSeed, gear, consumables),
          seed: nextSeed,
          moves: [],
          tick: 0,
          lastResult: null,
        });
      } catch {
        // offline/local: defaults stay
      }
    },

    submitCashOut: async () => {
      const { seed: currentSeed, moves, gear, consumables } = get();
      set({ cashOut: { state: "pending" } });
      try {
        const res = await fetch("/api/mine/bank", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            seed: currentSeed,
            moves,
            mineVersion: MINE_VERSION,
            gear,
            consumables,
          }),
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
        // The seed is consumed server-side: a fresh mine starts with
        // whatever consumables the trip left over.
        const remaining: MineConsumables = { ...get().mine.consumables };
        const nextSeed = randomSeed();
        set({
          cashOut: {
            state: "done",
            credits: body.credited.credits,
            parts: body.credited.parts,
            milestoneBonus: body.credited.milestoneBonus ?? 0,
            balance: body.balance,
          },
          consumables: remaining,
          mine: createMine(nextSeed, get().gear, remaining),
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
        mine: createMine(nextSeed, get().gear, get().consumables),
        seed: nextSeed,
        moves: [],
        tick: 0,
        lastResult: null,
        cashOut: { state: "idle" },
      });
    },
  };
});
