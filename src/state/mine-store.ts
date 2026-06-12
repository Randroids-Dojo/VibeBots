import { create } from "zustand";
import {
  addConsumables,
  applyAction,
  carryoverConsumables,
  createMine,
  DEFAULT_GEAR,
  exportDiff,
  MINE_VERSION,
  type MineAction,
  type MineConsumables,
  type MineGear,
  type MineState,
  type MoveResult,
  NO_CONSUMABLES,
  START_COL,
  type WorldDiff,
} from "@/sim/mine";

/** Guests keep the persistent world in localStorage (REQ-026). */
const LOCAL_WORLD_KEY = "vibebots-mine-world-v1";

function loadLocalWorld(): { seed: number; diff: WorldDiff } | null {
  try {
    const raw = localStorage.getItem(LOCAL_WORLD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.seed !== "number" || !Array.isArray(parsed.diff))
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLocalWorld(seed: number, diff: WorldDiff): void {
  try {
    localStorage.setItem(LOCAL_WORLD_KEY, JSON.stringify({ seed, diff }));
  } catch {
    // Storage full or blocked: the world still lives in memory.
  }
}

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
  /** Village purchases made since this session started (REQ-021). */
  bought: MineConsumables;
  /** Wallet balance from the last server response; null = unknown. */
  balance: number | null;
  /** One-line feedback for the stall menus. */
  shopNote: string | null;
  /** Server replay-protection counter; null until the world loads. */
  tripIndex: number;
  moves: MineAction[];
  tick: number;
  lastResult: MoveResult | null;
  lastAction: MineAction | null;
  cashOut: CashOutState;
  move: (action: MineAction) => void;
  loadWorld: () => Promise<void>;
  loadGear: () => Promise<void>;
  submitCashOut: () => Promise<void>;
  buyConsumable: (item: keyof MineConsumables) => Promise<void>;
  buyGearUpgrade: (track: keyof MineGear) => Promise<void>;
  restart: (seed?: number) => void;
}

/** Every logged action so far is a surface walk (left/right on row 0). */
function surfaceOnlyLog(moves: MineAction[]): boolean {
  return moves.every((m) => m === "left" || m === "right");
}

export const useMineStore = create<MineSessionState>((set, get) => {
  const seed = randomSeed();
  return {
    mine: createMine(seed),
    seed,
    gear: DEFAULT_GEAR,
    consumables: NO_CONSUMABLES,
    bought: NO_CONSUMABLES,
    balance: null,
    shopNote: null,
    tripIndex: 0,
    moves: [],
    tick: 0,
    lastResult: null,
    lastAction: null,
    cashOut: { state: "idle" },

    move: (action) => {
      const { mine, tick, moves, cashOut } = get();
      // The submitted log must match what gets credited; digging during
      // a pending cash-out would be silently discarded on success.
      if (cashOut.state === "pending") return;
      const result = applyAction(mine, action);
      // Refused actions are not part of the trip (the sim ignored them).
      if (result.ok) moves.push(action);
      set({ tick: tick + 1, lastResult: result, lastAction: action });
      // The carved world persists even for guests: checkpoint locally
      // every so often and at trip-ending moments.
      if (
        result.ok &&
        (result.collapsed || result.recalled || moves.length % 25 === 0)
      ) {
        saveLocalWorld(get().seed, exportDiff(mine));
      }
    },

    loadWorld: async () => {
      // Server world first (storage configured); guests fall back to
      // the locally persisted world; a fresh browser starts pristine.
      try {
        const res = await fetch("/api/mine/world");
        if (res.ok) {
          const body = await res.json();
          const { gear, consumables } = get();
          set({
            seed: body.seed,
            tripIndex: body.tripIndex ?? 0,
            mine: createMine(body.seed, gear, consumables, body.diff ?? []),
            moves: [],
            tick: 0,
            lastResult: null,
          });
          return;
        }
      } catch {
        // offline: fall through to local
      }
      const local = loadLocalWorld();
      if (local) {
        const { gear, consumables } = get();
        set({
          seed: local.seed,
          mine: createMine(local.seed, gear, consumables, local.diff),
          moves: [],
          tick: 0,
          lastResult: null,
        });
      }
    },

    loadGear: async () => {
      try {
        const res = await fetch("/api/gear");
        if (!res.ok) return; // 503 etc: defaults stay
        const body = await res.json();
        const gear: MineGear = body.gear;
        const consumables: MineConsumables = body.consumables ?? NO_CONSUMABLES;
        set({
          balance: typeof body.balance === "number" ? body.balance : null,
        });
        const current = get().gear;
        const currentCons = get().consumables;
        if (
          gear.pickaxe === current.pickaxe &&
          gear.lamp === current.lamp &&
          gear.cargo === current.cargo &&
          gear.lantern === current.lantern &&
          consumables.dynamite === currentCons.dynamite &&
          consumables.rope === currentCons.rope &&
          consumables.ladder === currentCons.ladder &&
          consumables.plank === currentCons.plank
        ) {
          return;
        }
        // Gear changes the sim, so the trip restarts with the snapshot,
        // but the carved world stays (REQ-026): same seed, same diff.
        const { seed: worldSeed, mine } = get();
        set({
          gear,
          consumables,
          bought: NO_CONSUMABLES,
          mine: createMine(worldSeed, gear, consumables, exportDiff(mine)),
          moves: [],
          tick: 0,
          lastResult: null,
        });
      } catch {
        // offline/local: defaults stay
      }
    },

    submitCashOut: async () => {
      const { seed: currentSeed, moves, mine, consumables, tripIndex } = get();
      set({ cashOut: { state: "pending" } });
      try {
        const res = await fetch("/api/mine/bank", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            seed: currentSeed,
            tripIndex,
            moves,
            mineVersion: MINE_VERSION,
            // The snapshot the trip actually ran on: a gear upgrade
            // bought mid-trip applies to the next trip, not this log.
            gear: mine.gear,
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
        // The world persists (REQ-026): the next trip resumes the SAME
        // carved claim. Only the trip state is fresh: leftover purchased
        // consumables plus anything bought at the depot since, on the
        // store gear (a deferred upgrade lands here).
        const remaining: MineConsumables = addConsumables(
          carryoverConsumables(get().mine),
          get().bought,
        );
        const worldDiff = exportDiff(get().mine);
        const nextMine = createMine(
          currentSeed,
          get().gear,
          remaining,
          worldDiff,
        );
        // Selling happens standing at the Assay Office; the fresh trip
        // walks back there instead of teleporting to the shaft.
        const atCol = get().mine.miner.col;
        const walk: MineAction[] = [];
        for (let c = START_COL; c !== atCol; c += atCol < c ? -1 : 1) {
          const dir = atCol < c ? "left" : "right";
          applyAction(nextMine, dir);
          walk.push(dir);
        }
        saveLocalWorld(currentSeed, worldDiff);
        set({
          cashOut: {
            state: "done",
            credits: body.credited.credits,
            parts: body.credited.parts,
            milestoneBonus: body.credited.milestoneBonus ?? 0,
            balance: body.balance,
          },
          balance: typeof body.balance === "number" ? body.balance : null,
          consumables: remaining,
          bought: NO_CONSUMABLES,
          mine: nextMine,
          tripIndex:
            typeof body.tripIndex === "number"
              ? body.tripIndex
              : get().tripIndex + 1,
          moves: walk,
          tick: 0,
          lastResult: null,
        });
      } catch {
        set({ cashOut: { state: "error", message: "cash out failed" } });
      }
    },

    buyConsumable: async (item) => {
      const { cashOut } = get();
      if (cashOut.state === "pending") return;
      try {
        const res = await fetch("/api/consumables/buy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ item }),
        });
        if (res.status === 503) {
          set({ shopNote: "the depot ledger is offline; nothing was charged" });
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          set({
            shopNote:
              typeof body.error === "string" ? body.error : "purchase failed",
          });
          return;
        }
        const body = await res.json();
        // Re-provision the live session: replaying the full log over a
        // strictly larger consumable snapshot reproduces the world
        // exactly (refusal thresholds only loosen), so the new stock is
        // usable immediately, mid-claim, without losing the dig.
        const { seed: s0, gear, consumables, bought, moves, tick } = get();
        const owned = addConsumables(consumables, bought);
        owned[item] += 1;
        const rebuilt = createMine(s0, gear, owned, exportDiff(get().mine));
        for (const m of moves) applyAction(rebuilt, m);
        set({
          mine: rebuilt,
          consumables: owned,
          bought: NO_CONSUMABLES,
          balance: typeof body.balance === "number" ? body.balance : null,
          shopNote: `+1 ${item} packed (${body.count} owned)`,
          tick: tick + 1,
        });
      } catch {
        set({ shopNote: "purchase failed" });
      }
    },

    buyGearUpgrade: async (track) => {
      const { cashOut } = get();
      if (cashOut.state === "pending") return;
      try {
        const res = await fetch("/api/gear/upgrade", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ track }),
        });
        if (res.status === 503) {
          set({
            shopNote: "the outfitter ledger is offline; nothing was charged",
          });
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          set({
            shopNote:
              typeof body.error === "string" ? body.error : "upgrade failed",
          });
          return;
        }
        const body = await res.json();
        const { gear, consumables, bought, moves, seed: s0, tick } = get();
        const nextGear: MineGear = { ...gear, [track]: body.level };
        if (surfaceOnlyLog(moves)) {
          // Gear changes the sim, so the live session only absorbs it
          // while the log is pure surface walks (replay-identical under
          // any gear). Otherwise it lands on the next claim.
          const owned = addConsumables(consumables, bought);
          const rebuilt = createMine(
            s0,
            nextGear,
            owned,
            exportDiff(get().mine),
          );
          for (const m of moves) applyAction(rebuilt, m);
          set({
            gear: nextGear,
            mine: rebuilt,
            consumables: owned,
            bought: NO_CONSUMABLES,
            balance: typeof body.balance === "number" ? body.balance : null,
            shopNote: `${track} is now level ${body.level}`,
            tick: tick + 1,
          });
        } else {
          set({
            gear: nextGear,
            balance: typeof body.balance === "number" ? body.balance : null,
            shopNote: `${track} level ${body.level} delivered; it applies on the next claim`,
            tick: tick + 1,
          });
        }
      } catch {
        set({ shopNote: "upgrade failed" });
      }
    },

    restart: (seedOverride) => {
      // A restart abandons the trip log, never the world (REQ-026). The
      // seed override remains for deterministic test harnesses, which
      // get a pristine world for that seed.
      const { consumables, bought, seed: worldSeed, mine } = get();
      const owned = addConsumables(consumables, bought);
      const seed = seedOverride ?? worldSeed;
      const diff = seedOverride === undefined ? exportDiff(mine) : undefined;
      set({
        mine: createMine(seed, get().gear, owned, diff),
        seed,
        consumables: owned,
        bought: NO_CONSUMABLES,
        moves: [],
        tick: 0,
        lastResult: null,
        cashOut: { state: "idle" },
      });
    },
  };
});
