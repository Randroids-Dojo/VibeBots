import { create } from "zustand";
import {
  type BasePartId,
  bunkerCells,
  createBunker,
  moveBasePart,
  type PendingBunkerBuild,
  type PendingBunkerClaimPayload,
  placeBasePart,
  proposedBunkerFootprint,
  removeBasePart,
  STARTER_BASE_PART_INVENTORY,
} from "@/sim/bunker";
import {
  addConsumables,
  applyAction,
  carryoverConsumables,
  cellAt,
  createMine,
  DEFAULT_GEAR,
  exportDiff,
  isMineAction,
  MINE_VERSION,
  type MineAction,
  type MineConsumables,
  type MineGear,
  type MineGearTrack,
  type MineState,
  type MoveResult,
  NO_CONSUMABLES,
  normalizeGear,
  refundRailSupportsInDiff,
  type SoldHaul,
  START_COL,
  STARTING_CONSUMABLES,
  type WorldDiff,
} from "@/sim/mine";

/**
 * The in-flight trip persists locally on every move (REQ-026): the
 * trip-start checkpoint plus the action log replays to the exact
 * mid-trip state on reload, carry included. The server's diff only
 * advances at cash-out, so this is what keeps un-sold carving alive.
 */
const LEGACY_LOCAL_TRIP_KEY = "vibebots-mine-trip-v2";
const LOCAL_TRIP_SLOT_PREFIX = "vibebots-mine-trip-v2-slot-";
const SAVE_SLOT_IDS = [1, 2, 3] as const;
type SaveSlotId = (typeof SAVE_SLOT_IDS)[number];

export interface SaveSlotSummary {
  slot: SaveSlotId;
  active: boolean;
  exists: boolean;
  createdAt: string | null;
  balance: number;
  deepestDepth: number;
  partsOwned: number;
  designs: number;
  stamps: number;
}

export type SaveSlotsState =
  | { state: "unknown"; activeSlot: SaveSlotId; slots: SaveSlotSummary[] }
  | { state: "loading"; activeSlot: SaveSlotId; slots: SaveSlotSummary[] }
  | { state: "ready"; activeSlot: SaveSlotId; slots: SaveSlotSummary[] }
  | { state: "switching"; activeSlot: SaveSlotId; slots: SaveSlotSummary[] }
  | { state: "deleting"; activeSlot: SaveSlotId; slots: SaveSlotSummary[] }
  | { state: "unavailable"; activeSlot: SaveSlotId; slots: SaveSlotSummary[] }
  | {
      state: "error";
      activeSlot: SaveSlotId;
      slots: SaveSlotSummary[];
      message: string;
    };

interface SavedTrip {
  mineVersion: number;
  seed: number;
  tripIndex: number;
  gear: MineGear;
  consumables: MineConsumables;
  baseDiff: WorldDiff;
  moves: MineAction[];
  pendingBunker?: PendingBunkerBuild | null;
}

function validSaveSlot(value: unknown): SaveSlotId | null {
  return SAVE_SLOT_IDS.find((slot) => slot === value) ?? null;
}

function localTripKey(slot: SaveSlotId): string {
  return `${LOCAL_TRIP_SLOT_PREFIX}${slot}`;
}

function migrateLegacyTripToSlotOne(): void {
  try {
    const raw = localStorage.getItem(LEGACY_LOCAL_TRIP_KEY);
    if (!raw) return;
    if (!localStorage.getItem(localTripKey(1))) {
      localStorage.setItem(localTripKey(1), raw);
    }
    localStorage.removeItem(LEGACY_LOCAL_TRIP_KEY);
  } catch {
    // Storage full or blocked: leave the trip wherever the browser keeps it.
  }
}

function loadLocalTrip(slot: SaveSlotId): SavedTrip | null {
  try {
    if (slot === 1) migrateLegacyTripToSlotOne();
    const raw = localStorage.getItem(localTripKey(slot));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.seed !== "number" ||
      typeof parsed.tripIndex !== "number" ||
      parsed.mineVersion !== MINE_VERSION ||
      !Array.isArray(parsed.baseDiff) ||
      !Array.isArray(parsed.moves)
    ) {
      removeLocalTrip(slot);
      return null;
    }
    const saved = parsed as SavedTrip;
    if (
      !saved.moves.every(
        (move) => typeof move === "string" && isMineAction(move),
      )
    ) {
      removeLocalTrip(slot);
      return null;
    }
    return { ...saved, gear: normalizeGear(saved.gear) };
  } catch {
    return null;
  }
}

function saveLocalTrip(slot: SaveSlotId, trip: SavedTrip): void {
  try {
    localStorage.setItem(localTripKey(slot), JSON.stringify(trip));
  } catch {
    // Storage full or blocked: the trip still lives in memory.
  }
}

function removeLocalTrip(slot: SaveSlotId): void {
  try {
    localStorage.removeItem(localTripKey(slot));
  } catch {
    // Storage blocked: the server-side save is still deleted.
  }
}

function deleteSaveSlotConfirmation(slot: SaveSlotId): string {
  return `DELETE SLOT ${slot}`;
}

function saveSlotSummariesFromResponse(value: unknown): {
  activeSlot: SaveSlotId;
  slots: SaveSlotSummary[];
} | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { activeSlot?: unknown; slots?: unknown };
  const activeSlot = validSaveSlot(body.activeSlot);
  if (!activeSlot || !Array.isArray(body.slots)) return null;
  const slots = body.slots.flatMap((candidate): SaveSlotSummary[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as Partial<Record<keyof SaveSlotSummary, unknown>>;
    const slot = validSaveSlot(raw.slot);
    if (!slot) return [];
    return [
      {
        slot,
        active: raw.active === true,
        exists: raw.exists === true,
        createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
        balance: typeof raw.balance === "number" ? raw.balance : 0,
        deepestDepth:
          typeof raw.deepestDepth === "number" ? raw.deepestDepth : 0,
        partsOwned: typeof raw.partsOwned === "number" ? raw.partsOwned : 0,
        designs: typeof raw.designs === "number" ? raw.designs : 0,
        stamps: typeof raw.stamps === "number" ? raw.stamps : 0,
      },
    ];
  });
  return { activeSlot, slots };
}

function consumablesFromResponse(value: unknown): MineConsumables | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Record<keyof MineConsumables, unknown>>;
  if (
    typeof candidate.dynamite !== "number" ||
    typeof candidate.rope !== "number" ||
    typeof candidate.ladder !== "number" ||
    typeof candidate.plank !== "number" ||
    typeof candidate.beacon !== "number"
  ) {
    return null;
  }
  return {
    dynamite: candidate.dynamite,
    rope: candidate.rope,
    ladder: candidate.ladder,
    plank: candidate.plank,
    beacon: candidate.beacon,
  };
}

function cashOutErrorMessage(body: unknown): string {
  if (isMineVersionMismatch(body)) {
    return "Mine updated. Your save is restored; start a fresh trip.";
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
  }
  return "cash out failed";
}

function isMineVersionMismatch(body: unknown): boolean {
  return (
    Boolean(body) &&
    typeof body === "object" &&
    (body as Record<string, unknown>).code === "mine_version_mismatch"
  );
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
      soldHaul?: SoldHaul;
      bunkerClaimed?: boolean;
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
  /** Overall player level from raid defense XP; used by shop gates. */
  playerLevel: number;
  /** Durable deepest row reached; used by shop gates. */
  deepestDepth: number;
  /** One-line feedback for the stall menus. */
  shopNote: string | null;
  /** Server replay-protection counter; null until the world loads. */
  tripIndex: number;
  /** The world checkpoint this trip started from (the replay base). */
  tripBaseDiff: WorldDiff;
  moves: MineAction[];
  pendingBunker: PendingBunkerBuild | null;
  tick: number;
  lastResult: MoveResult | null;
  lastAction: MineAction | null;
  cashOut: CashOutState;
  activeSlot: SaveSlotId;
  saveSlots: SaveSlotsState;
  worldLoaded: boolean;
  move: (action: MineAction) => void;
  loadWorld: () => Promise<void>;
  loadGear: () => Promise<void>;
  loadSaveSlots: () => Promise<void>;
  switchSaveSlot: (
    slot: SaveSlotId,
    options?: { create?: boolean },
  ) => Promise<boolean>;
  deleteSaveSlot: (slot: SaveSlotId) => Promise<boolean>;
  saveCurrentTrip: () => void;
  claimPendingBunker: (col: number, row: number) => boolean;
  placePendingBunkerPart: (
    partId: BasePartId,
    col: number,
    row: number,
  ) => boolean;
  removePendingBunkerPart: (col: number, row: number) => boolean;
  movePendingBunkerPart: (
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
  ) => boolean;
  submitCashOut: () => Promise<boolean>;
  buyConsumable: (
    item: keyof MineConsumables,
    quantity?: number,
  ) => Promise<void>;
  buyGearUpgrade: (track: MineGearTrack) => Promise<void>;
  buyElevator: () => Promise<void>;
  teleportToBase: (cost: number) => Promise<boolean>;
  restart: (seed?: number) => void;
}

/** Every logged action so far is a surface walk (left/right on row 0). */
function surfaceOnlyLog(moves: MineAction[]): boolean {
  return moves.every(
    (m) =>
      m === "left" ||
      m === "right" ||
      m.startsWith("activate-portal:") ||
      m.startsWith("portal-warp:"),
  );
}

function pendingBunkerPayload(
  pending: PendingBunkerBuild | null,
): PendingBunkerClaimPayload | undefined {
  if (!pending) return undefined;
  return {
    claimCol: pending.claimCol,
    claimRow: pending.claimRow,
    claimedAtMoveCount: pending.claimedAtMoveCount,
    parts: pending.bunker.parts,
  };
}

export const useMineStore = create<MineSessionState>((set, get) => {
  const seed = randomSeed();
  const initialSlots: SaveSlotsState = {
    state: "unknown",
    activeSlot: 1,
    slots: [],
  };
  const persistCurrentTrip = () => {
    const st = get();
    if (!st.worldLoaded) return;
    saveLocalTrip(st.activeSlot, {
      mineVersion: MINE_VERSION,
      seed: st.seed,
      tripIndex: st.tripIndex,
      gear: st.mine.gear,
      consumables: st.consumables,
      baseDiff: st.tripBaseDiff,
      moves: [...st.moves],
      pendingBunker: st.pendingBunker,
    });
  };
  return {
    mine: createMine(seed),
    seed,
    gear: DEFAULT_GEAR,
    consumables: NO_CONSUMABLES,
    bought: NO_CONSUMABLES,
    balance: null,
    playerLevel: 1,
    deepestDepth: 0,
    shopNote: null,
    tripIndex: 0,
    tripBaseDiff: [],
    moves: [],
    pendingBunker: null,
    tick: 0,
    lastResult: null,
    lastAction: null,
    cashOut: { state: "idle" },
    activeSlot: 1,
    saveSlots: initialSlots,
    worldLoaded: false,

    saveCurrentTrip: persistCurrentTrip,

    move: (action) => {
      const { mine, tick, moves, cashOut } = get();
      // The submitted log must match what gets credited; digging during
      // a pending cash-out would be silently discarded on success.
      if (cashOut.state === "pending") return;
      const result = applyAction(mine, action);
      // Refused actions are not part of the trip (the sim ignored them).
      if (result.ok) moves.push(action);
      set({ tick: tick + 1, lastResult: result, lastAction: action });
      // Persist the in-flight trip so a reload resumes mid-trip,
      // carry and carving intact.
      if (result.ok) {
        persistCurrentTrip();
      }
    },

    loadWorld: async () => {
      // Server checkpoint first (storage configured); the locally saved
      // in-flight trip resumes on top of it when it matches; guests run
      // entirely from the local trip; a fresh browser starts pristine.
      const resume = (
        slot: SaveSlotId,
        seed: number,
        tripIndex: number,
        baseDiff: WorldDiff,
      ) => {
        const saved = loadLocalTrip(slot);
        if (
          saved &&
          saved.seed === seed &&
          saved.tripIndex === tripIndex &&
          saved.moves.length > 0
        ) {
          const resumed = createMine(
            seed,
            saved.gear,
            saved.consumables,
            baseDiff,
          );
          for (const a of saved.moves) applyAction(resumed, a);
          set({
            activeSlot: slot,
            worldLoaded: true,
            seed,
            tripIndex,
            tripBaseDiff: baseDiff,
            gear: saved.gear,
            consumables: saved.consumables,
            mine: resumed,
            moves: [...saved.moves],
            pendingBunker: saved.pendingBunker ?? null,
            tick: saved.moves.length,
            lastResult: null,
          });
          return;
        }
        const { gear, consumables } = get();
        set({
          activeSlot: slot,
          worldLoaded: true,
          seed,
          tripIndex,
          tripBaseDiff: baseDiff,
          mine: createMine(seed, gear, consumables, baseDiff),
          moves: [],
          pendingBunker: null,
          tick: 0,
          lastResult: null,
        });
      };
      try {
        const res = await fetch("/api/mine/world");
        if (res.ok) {
          const body = await res.json();
          const slot = validSaveSlot(body.activeSlot) ?? 1;
          resume(slot, body.seed, body.tripIndex ?? 0, body.diff ?? []);
          return;
        }
      } catch {
        // offline: fall through to local
      }
      const slot = get().activeSlot;
      const saved = loadLocalTrip(slot);
      if (saved) resume(slot, saved.seed, saved.tripIndex, saved.baseDiff);
    },

    loadGear: async () => {
      persistCurrentTrip();
      try {
        const res = await fetch("/api/gear");
        if (!res.ok) {
          // Storage-less (guest / local dev): no player row to front the
          // one-time starting kit, so the client grants it for a fresh
          // session. A resumed local trip keeps its own logged stock.
          if (res.status === 503 && get().moves.length === 0) {
            const { seed: s, gear: g, tripBaseDiff } = get();
            set({
              worldLoaded: true,
              consumables: STARTING_CONSUMABLES,
              mine: createMine(s, g, STARTING_CONSUMABLES, tripBaseDiff),
            });
            persistCurrentTrip();
          }
          return;
        }
        const body = await res.json();
        const gear: MineGear = normalizeGear(body.gear);
        const consumables: MineConsumables = body.consumables ?? NO_CONSUMABLES;
        set({
          balance: typeof body.balance === "number" ? body.balance : null,
          playerLevel:
            typeof body.playerLevel === "number" ? body.playerLevel : 1,
          deepestDepth:
            typeof body.deepestDepth === "number" ? body.deepestDepth : 0,
        });
        const current = get().gear;
        const currentCons = get().consumables;
        if (
          gear.pickaxe === current.pickaxe &&
          gear.battery === current.battery &&
          gear.cargo === current.cargo &&
          gear.lantern === current.lantern &&
          gear.elevator === current.elevator &&
          gear.warpcoil === current.warpcoil &&
          (gear.blast ?? 1) === (current.blast ?? 1) &&
          (gear.elevatorSpeed ?? 1) === (current.elevatorSpeed ?? 1) &&
          (gear.fall ?? 1) === (current.fall ?? 1) &&
          (gear.recall ?? 1) === (current.recall ?? 1) &&
          consumables.dynamite === currentCons.dynamite &&
          consumables.rope === currentCons.rope &&
          consumables.ladder === currentCons.ladder &&
          consumables.plank === currentCons.plank &&
          consumables.beacon === currentCons.beacon
        ) {
          return;
        }
        // Gear changes the sim. A fresh trip restarts on the owned
        // snapshot over the same world; a resumed in-flight trip keeps
        // the gear snapshot it was saved with.
        if (get().moves.length > 0) {
          set({ gear });
          return;
        }
        const { seed: worldSeed, mine } = get();
        const baseDiff = exportDiff(mine);
        set({
          gear,
          consumables,
          bought: NO_CONSUMABLES,
          tripBaseDiff: baseDiff,
          mine: createMine(worldSeed, gear, consumables, baseDiff),
          moves: [],
          pendingBunker: null,
          tick: 0,
          lastResult: null,
        });
        persistCurrentTrip();
      } catch {
        // offline/local: defaults stay
      }
    },

    loadSaveSlots: async () => {
      persistCurrentTrip();
      const current = get().saveSlots;
      set({
        saveSlots: {
          state: "loading",
          activeSlot: current.activeSlot,
          slots: current.slots,
        },
      });
      try {
        const res = await fetch("/api/save-slots");
        if (res.status === 503) {
          set({
            saveSlots: {
              state: "unavailable",
              activeSlot: get().activeSlot,
              slots: [],
            },
          });
          return;
        }
        if (!res.ok) {
          set({
            saveSlots: {
              state: "error",
              activeSlot: get().activeSlot,
              slots: current.slots,
              message: "could not load saves",
            },
          });
          return;
        }
        const parsed = saveSlotSummariesFromResponse(await res.json());
        if (!parsed) {
          set({
            saveSlots: {
              state: "error",
              activeSlot: get().activeSlot,
              slots: current.slots,
              message: "could not read saves",
            },
          });
          return;
        }
        set({
          activeSlot: parsed.activeSlot,
          saveSlots: { state: "ready", ...parsed },
        });
      } catch {
        set({
          saveSlots: {
            state: "error",
            activeSlot: get().activeSlot,
            slots: current.slots,
            message: "could not load saves",
          },
        });
      }
    },

    switchSaveSlot: async (slot, options = {}) => {
      persistCurrentTrip();
      const current = get().saveSlots;
      set({
        saveSlots: {
          state: "switching",
          activeSlot: get().activeSlot,
          slots: current.slots,
        },
      });
      try {
        const res = await fetch("/api/save-slots", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slot, create: options.create === true }),
        });
        if (!res.ok) {
          if (res.status === 503) {
            set({
              saveSlots: {
                state: "unavailable",
                activeSlot: get().activeSlot,
                slots: current.slots,
              },
            });
            return false;
          }
          set({
            saveSlots: {
              state: "error",
              activeSlot: get().activeSlot,
              slots: current.slots,
              message: "load failed",
            },
          });
          return false;
        }
        const parsed = saveSlotSummariesFromResponse(await res.json());
        if (!parsed) {
          set({
            saveSlots: {
              state: "error",
              activeSlot: get().activeSlot,
              slots: current.slots,
              message: "could not read saves",
            },
          });
          return false;
        }
        set({
          activeSlot: parsed.activeSlot,
          saveSlots: { state: "ready", ...parsed },
        });
        await get().loadWorld();
        await get().loadGear();
        return true;
      } catch {
        set({
          saveSlots: {
            state: "error",
            activeSlot: get().activeSlot,
            slots: current.slots,
            message: "load failed",
          },
        });
        return false;
      }
    },

    deleteSaveSlot: async (slot) => {
      persistCurrentTrip();
      const current = get().saveSlots;
      set({
        saveSlots: {
          state: "deleting",
          activeSlot: get().activeSlot,
          slots: current.slots,
        },
      });
      try {
        const res = await fetch("/api/save-slots", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            slot,
            confirm: deleteSaveSlotConfirmation(slot),
          }),
        });
        if (!res.ok) {
          if (res.status === 503) {
            set({
              saveSlots: {
                state: "unavailable",
                activeSlot: get().activeSlot,
                slots: current.slots,
              },
            });
            return false;
          }
          set({
            saveSlots: {
              state: "error",
              activeSlot: get().activeSlot,
              slots: current.slots,
              message: "delete failed",
            },
          });
          return false;
        }
        const parsed = saveSlotSummariesFromResponse(await res.json());
        if (!parsed) {
          set({
            saveSlots: {
              state: "error",
              activeSlot: get().activeSlot,
              slots: current.slots,
              message: "could not read saves",
            },
          });
          return false;
        }
        removeLocalTrip(slot);
        set({
          activeSlot: parsed.activeSlot,
          saveSlots: { state: "ready", ...parsed },
        });
        return true;
      } catch {
        set({
          saveSlots: {
            state: "error",
            activeSlot: get().activeSlot,
            slots: current.slots,
            message: "delete failed",
          },
        });
        return false;
      }
    },

    claimPendingBunker: (col, row) => {
      const { cashOut, mine, moves, pendingBunker } = get();
      if (cashOut.state === "pending" || pendingBunker || mine.miner.row <= 0) {
        return false;
      }
      const footprint = proposedBunkerFootprint(col, row);
      if (footprint.row < 1) return false;
      if (
        bunkerCells(footprint).some((cell) => {
          return cellAt(mine, cell.col, cell.row)?.kind !== "empty";
        })
      ) {
        return false;
      }
      const bunker = createBunker(footprint);
      set({
        pendingBunker: {
          claimCol: col,
          claimRow: row,
          claimedAtMoveCount: moves.length,
          bunker,
          inventory: { ...STARTER_BASE_PART_INVENTORY },
        },
        shopNote: "bunker claimed; bank at surface to save it",
      });
      persistCurrentTrip();
      return true;
    },

    placePendingBunkerPart: (partId, col, row) => {
      const pending = get().pendingBunker;
      if (!pending || get().cashOut.state === "pending") return false;
      const placed = placeBasePart(
        pending.bunker,
        pending.inventory,
        partId,
        col,
        row,
      );
      if (!placed.ok) return false;
      set({
        pendingBunker: {
          ...pending,
          bunker: placed.bunker,
          inventory: placed.inventory,
        },
      });
      persistCurrentTrip();
      return true;
    },

    removePendingBunkerPart: (col, row) => {
      const pending = get().pendingBunker;
      if (!pending || get().cashOut.state === "pending") return false;
      const removed = removeBasePart(
        pending.bunker,
        pending.inventory,
        col,
        row,
      );
      if (!removed.ok) return false;
      set({
        pendingBunker: {
          ...pending,
          bunker: removed.bunker,
          inventory: removed.inventory,
        },
      });
      persistCurrentTrip();
      return true;
    },

    movePendingBunkerPart: (fromCol, fromRow, toCol, toRow) => {
      const pending = get().pendingBunker;
      if (!pending || get().cashOut.state === "pending") return false;
      const moved = moveBasePart(
        pending.bunker,
        fromCol,
        fromRow,
        toCol,
        toRow,
      );
      if (!moved.ok) return false;
      set({
        pendingBunker: {
          ...pending,
          bunker: moved.bunker,
        },
      });
      persistCurrentTrip();
      return true;
    },

    submitCashOut: async () => {
      persistCurrentTrip();
      const {
        seed: currentSeed,
        moves,
        mine,
        consumables,
        tripIndex,
        pendingBunker,
      } = get();
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
            pendingBunker: pendingBunkerPayload(pendingBunker),
          }),
        });
        if (res.status === 503) {
          set({ cashOut: { state: "unavailable" } });
          return false;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (isMineVersionMismatch(body)) {
            removeLocalTrip(get().activeSlot);
            await get().loadWorld();
            await get().loadGear();
          }
          set({
            cashOut: {
              state: "error",
              message: cashOutErrorMessage(body),
            },
          });
          return false;
        }
        const body = await res.json();
        // The world persists (REQ-026): the next trip resumes the SAME
        // carved mine. Server-owned stock wins after cash-out so stale
        // local support snapshots cannot leak into the next trip.
        const remaining: MineConsumables =
          consumablesFromResponse(body.consumables) ??
          addConsumables(carryoverConsumables(get().mine), get().bought);
        const worldDiff = exportDiff(get().mine);
        const nextMine = createMine(
          currentSeed,
          get().gear,
          remaining,
          worldDiff,
        );
        // Banking happens wherever the surface was reached; the fresh
        // trip walks back there instead of teleporting to the shaft.
        const atCol = get().mine.miner.col;
        const walk: MineAction[] = [];
        for (let c = START_COL; c !== atCol; c += atCol < c ? -1 : 1) {
          const dir = atCol < c ? "left" : "right";
          applyAction(nextMine, dir);
          walk.push(dir);
        }
        const nextTripIndex =
          typeof body.tripIndex === "number"
            ? body.tripIndex
            : get().tripIndex + 1;
        saveLocalTrip(get().activeSlot, {
          mineVersion: MINE_VERSION,
          seed: currentSeed,
          tripIndex: nextTripIndex,
          gear: get().gear,
          consumables: remaining,
          baseDiff: worldDiff,
          moves: walk,
          pendingBunker: null,
        });
        set({
          tripBaseDiff: worldDiff,
          cashOut: {
            state: "done",
            credits: body.credited.credits,
            parts: body.credited.parts,
            milestoneBonus: body.credited.milestoneBonus ?? 0,
            balance: body.balance,
            soldHaul: body.credited.soldHaul,
            ...(body.bunkerClaimed === true ? { bunkerClaimed: true } : {}),
          },
          balance: typeof body.balance === "number" ? body.balance : null,
          deepestDepth:
            typeof body.deepestDepth === "number"
              ? body.deepestDepth
              : get().deepestDepth,
          consumables: remaining,
          bought: NO_CONSUMABLES,
          mine: nextMine,
          tripIndex: nextTripIndex,
          moves: walk,
          pendingBunker: null,
          tick: 0,
          lastResult: null,
        });
        return true;
      } catch {
        set({ cashOut: { state: "error", message: "cash out failed" } });
        return false;
      }
    },

    buyConsumable: async (item, quantity = 1) => {
      const { cashOut } = get();
      if (cashOut.state === "pending") return;
      persistCurrentTrip();
      const count = Math.max(1, Math.floor(quantity));
      try {
        const res = await fetch("/api/consumables/buy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ item, quantity: count }),
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
        // usable immediately, mid-trip, without losing the dig.
        const { seed: s0, gear, consumables, bought, moves, tick } = get();
        const owned = addConsumables(consumables, bought);
        owned[item] += count;
        // Replay over the TRIP-START checkpoint, never the live diff:
        // the live diff already contains the moves' effects and the
        // server replays from the checkpoint too.
        const rebuilt = createMine(s0, gear, owned, get().tripBaseDiff);
        for (const m of moves) applyAction(rebuilt, m);
        set({
          mine: rebuilt,
          consumables: owned,
          bought: NO_CONSUMABLES,
          balance: typeof body.balance === "number" ? body.balance : null,
          shopNote: `+${count} ${item} packed (${body.count} owned)`,
          tick: tick + 1,
        });
        persistCurrentTrip();
      } catch {
        set({ shopNote: "purchase failed" });
      }
    },

    buyGearUpgrade: async (track) => {
      const { cashOut, mine, moves } = get();
      if (cashOut.state === "pending") return;
      persistCurrentTrip();
      if (mine.miner.row !== 0) {
        set({ shopNote: "return to the surface to upgrade" });
        return;
      }
      if (!surfaceOnlyLog(moves)) {
        const banked = await get().submitCashOut();
        if (!banked) return;
      }
      try {
        const res = await fetch("/api/gear/upgrade", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ track }),
        });
        if (res.status === 503) {
          set({
            shopNote: "the upgrades shop is offline; nothing was charged",
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
        const owned = addConsumables(consumables, bought);
        const baseDiff = get().tripBaseDiff;
        const rebuilt = createMine(s0, nextGear, owned, baseDiff);
        for (const m of moves) applyAction(rebuilt, m);
        saveLocalTrip(get().activeSlot, {
          mineVersion: MINE_VERSION,
          seed: s0,
          tripIndex: get().tripIndex,
          gear: nextGear,
          consumables: owned,
          baseDiff,
          moves,
          pendingBunker: get().pendingBunker,
        });
        set({
          gear: nextGear,
          mine: rebuilt,
          consumables: owned,
          bought: NO_CONSUMABLES,
          balance: typeof body.balance === "number" ? body.balance : null,
          shopNote: `${track} is now level ${body.level}`,
          tick: tick + 1,
        });
      } catch {
        set({ shopNote: "upgrade failed" });
      }
    },

    buyElevator: async () => {
      if (get().cashOut.state === "pending") return;
      persistCurrentTrip();
      try {
        const res = await fetch("/api/elevator/upgrade", { method: "POST" });
        if (res.status === 503) {
          set({ shopNote: "the tower ledger is offline; nothing was charged" });
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
        const { gear, consumables, bought, moves, seed: s0, tick } = get();
        const nextGear: MineGear = { ...gear, elevator: body.elevator };
        const fallbackRefund = refundRailSupportsInDiff(
          get().tripBaseDiff,
          gear.elevator,
          body.elevator,
        );
        const nextBaseDiff = Array.isArray(body.diff)
          ? (body.diff as WorldDiff)
          : fallbackRefund.diff;
        const refundedSupports =
          typeof body.refundedSupports === "object" && body.refundedSupports
            ? (body.refundedSupports as Partial<
                Record<"ladder" | "plank", number>
              >)
            : fallbackRefund.refunded;
        const refundedLadders =
          typeof body.refundedLadders === "number"
            ? body.refundedLadders
            : (refundedSupports.ladder ?? 0);
        const refundedPlanks = refundedSupports.plank ?? 0;
        const refundNote =
          refundedLadders + refundedPlanks > 0
            ? `; recovered ${refundedLadders} ladders and ${refundedPlanks} planks`
            : "";
        if (surfaceOnlyLog(moves)) {
          // Same rule as gear: rail applies to the live trip only while
          // the log is pure surface walks (replay-identical).
          const owned = addConsumables(consumables, bought);
          owned.ladder += refundedLadders;
          owned.plank += refundedPlanks;
          const rebuilt = createMine(s0, nextGear, owned, nextBaseDiff);
          for (const m of moves) applyAction(rebuilt, m);
          saveLocalTrip(get().activeSlot, {
            mineVersion: MINE_VERSION,
            seed: s0,
            tripIndex: get().tripIndex,
            gear: nextGear,
            consumables: owned,
            baseDiff: nextBaseDiff,
            moves,
            pendingBunker: get().pendingBunker,
          });
          set({
            gear: nextGear,
            mine: rebuilt,
            consumables: owned,
            bought: NO_CONSUMABLES,
            tripBaseDiff: nextBaseDiff,
            balance: typeof body.balance === "number" ? body.balance : null,
            shopNote: `rail extended to ${body.elevator} deep${refundNote}`,
            tick: tick + 1,
          });
        } else {
          const owned = addConsumables(consumables, bought);
          owned.ladder += refundedLadders;
          owned.plank += refundedPlanks;
          set({
            gear: nextGear,
            consumables: owned,
            bought: NO_CONSUMABLES,
            balance: typeof body.balance === "number" ? body.balance : null,
            shopNote: `rail extended to ${body.elevator} deep${refundNote}; rides start next trip`,
            tick: tick + 1,
          });
          persistCurrentTrip();
        }
      } catch {
        set({ shopNote: "purchase failed" });
      }
    },

    teleportToBase: async (cost) => {
      const { cashOut, mine } = get();
      if (cashOut.state === "pending") return false;
      persistCurrentTrip();
      if (mine.miner.row !== 0) {
        set({ shopNote: "return to the surface to teleport" });
        return false;
      }
      if (Math.abs(mine.miner.col - START_COL) > 5000) {
        set({ shopNote: "teleport path is too far" });
        return false;
      }
      const price = Math.max(1, Math.min(99, Math.floor(cost)));
      try {
        const res = await fetch("/api/mine/base-teleport", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cost: price }),
        });
        if (res.status === 503) {
          set({ shopNote: "the base beacon is offline; nothing was charged" });
          return false;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          set({
            shopNote:
              typeof body.error === "string" ? body.error : "teleport failed",
          });
          return false;
        }
        const body = await res.json();
        const {
          seed: s0,
          gear,
          consumables,
          tripBaseDiff,
          tick,
          tripIndex,
        } = get();
        const rebuilt = createMine(s0, gear, consumables, tripBaseDiff);
        saveLocalTrip(get().activeSlot, {
          mineVersion: MINE_VERSION,
          seed: s0,
          tripIndex,
          gear,
          consumables,
          baseDiff: tripBaseDiff,
          moves: [],
          pendingBunker: null,
        });
        set({
          mine: rebuilt,
          moves: [],
          pendingBunker: null,
          balance: typeof body.balance === "number" ? body.balance : null,
          shopNote: `teleported to base for ${price} vibes`,
          tick: tick + 1,
          lastResult: null,
          lastAction: null,
        });
        return true;
      } catch {
        set({ shopNote: "teleport failed" });
        return false;
      }
    },

    restart: (seedOverride) => {
      // A restart abandons the trip log, never the world (REQ-026). The
      // seed override remains for deterministic test harnesses, which
      // get a pristine world for that seed.
      const { consumables, bought, seed: worldSeed, mine } = get();
      const owned = addConsumables(consumables, bought);
      const seed = seedOverride ?? worldSeed;
      const diff = seedOverride === undefined ? exportDiff(mine) : [];
      saveLocalTrip(get().activeSlot, {
        mineVersion: MINE_VERSION,
        seed,
        tripIndex: get().tripIndex,
        gear: get().gear,
        consumables: owned,
        baseDiff: diff,
        moves: [],
        pendingBunker: null,
      });
      set({
        worldLoaded: true,
        mine: createMine(seed, get().gear, owned, diff),
        seed,
        tripBaseDiff: diff,
        consumables: owned,
        bought: NO_CONSUMABLES,
        moves: [],
        pendingBunker: null,
        tick: 0,
        lastResult: null,
        cashOut: { state: "idle" },
      });
    },
  };
});
