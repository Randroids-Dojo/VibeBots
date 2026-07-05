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
  MINE_VERSION,
  type MineAction,
  type MineConsumables,
  type MineGear,
  type MineGearSnapshot,
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
import {
  type AccountHandoffStart,
  type AccountProviderStatus,
  type AccountSaveSummary,
  type AccountStatus,
  type AccountStatusMode,
  accountCloudLoadFromResponse,
  accountErrorMessageFromResponse,
  accountHandoffStartFromResponse,
  accountStatusFromResponse,
  accountTripFromResponse,
  buyRemoteConsumable,
  buyRemoteElevator,
  buyRemoteGearUpgrade,
  cashOutErrorMessage,
  claimRemoteAccountSave,
  clearRemoteAccountTrip,
  consumablesFromResponse,
  deleteRemoteSaveSlot,
  finishRemoteAccountHandoff,
  isMineVersionMismatch,
  loadMineGear,
  loadMineWorld,
  loadRemoteAccountSave,
  loadAccountStatus as loadRemoteAccountStatus,
  loadRemoteAccountTrip,
  loadSaveSlotSummaries,
  type SaveSlotSummary,
  saveSlotSummariesFromResponse,
  startRemoteAccountHandoff,
  storeRemoteAccountTrip,
  submitMineBank,
  switchRemoteSaveSlot,
  teleportRemoteBase,
} from "./mine-api-client";
import {
  loadLocalTrip,
  removeLocalTrip,
  replaySavedTrip,
  type SavedTrip,
  type SaveSlotId,
  saveLocalTrip,
  validSaveSlot,
} from "./mine-trip-persistence";

export type {
  AccountHandoffStart,
  AccountProviderStatus,
  AccountSaveSummary,
  SaveSlotSummary,
} from "./mine-api-client";

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

export type AccountSyncState =
  | {
      state:
        | "unknown"
        | "loading"
        | "ready"
        | "claiming"
        | "starting-sign-in"
        | "finishing-sign-in"
        | "loading-cloud"
        | "unavailable";
      providerReady: boolean;
      providerStatus: AccountProviderStatus;
      mode: AccountStatusMode;
      accountEmail: string | null;
      currentSave: AccountSaveSummary | null;
      accountSave: AccountSaveSummary | null;
    }
  | {
      state: "error";
      providerReady: boolean;
      providerStatus: AccountProviderStatus;
      mode: AccountStatusMode;
      accountEmail: string | null;
      currentSave: AccountSaveSummary | null;
      accountSave: AccountSaveSummary | null;
      message: string;
    };

function accountSyncFromStatus(
  status: AccountStatus,
  state: Extract<AccountSyncState["state"], "ready" | "loading"> = "ready",
): AccountSyncState {
  return {
    state,
    providerReady: status.providerReady,
    providerStatus: status.providerStatus,
    mode: status.mode,
    accountEmail: status.account?.email ?? null,
    currentSave: status.currentSave,
    accountSave: status.accountSave,
  };
}

function accountStatusShouldAutoClaim(status: AccountStatus): boolean {
  return (
    status.mode === "signed_in" &&
    status.currentSave?.exists === true &&
    status.accountSave?.exists !== true
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
  accountSync: AccountSyncState;
  worldLoaded: boolean;
  /** Tick key of the fall/crush playback whose impact frame has rendered.
   * Written by the mine canvas frame loop so the trip report can wait for
   * the visible impact instead of racing it on a wall-clock timer. Keys
   * are store ticks and ticks reset to 0 on trip/world resets, so the
   * playback bridge clears this when a new playback begins; a stale key
   * from a previous trip must never satisfy a later trip's gate. */
  fallVisualImpactKey: number | null;
  markFallVisualImpact: (key: number) => void;
  clearFallVisualImpact: () => void;
  move: (action: MineAction) => void;
  clearTerminalResult: () => void;
  loadWorld: () => Promise<void>;
  loadGear: () => Promise<void>;
  loadSaveSlots: () => Promise<void>;
  loadAccountStatus: (options?: { silent?: boolean }) => Promise<void>;
  startAccountSignIn: (
    returnTo?: string,
  ) => Promise<AccountHandoffStart | null>;
  finishAccountSignIn: (handoffId: string) => Promise<boolean>;
  claimAccountSave: () => Promise<boolean>;
  loadAccountSave: () => Promise<boolean>;
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
  const initialAccountSync: AccountSyncState = {
    state: "unknown",
    providerReady: false,
    providerStatus: {
      provider: "clerk",
      ready: false,
      reason: "sdk_not_wired",
      issues: [
        "sdk_not_wired",
        "publishable_key_missing",
        "secret_key_missing",
        "public_sign_in_url_missing",
        "public_sign_in_fallback_url_missing",
        "public_sign_up_fallback_url_missing",
      ],
    },
    mode: "guest",
    accountEmail: null,
    currentSave: null,
    accountSave: null,
  };
  const currentTripSnapshot = (): SavedTrip | null => {
    const st = get();
    if (!st.worldLoaded) return null;
    return {
      mineVersion: MINE_VERSION,
      seed: st.seed,
      tripIndex: st.tripIndex,
      gear: st.mine.gear,
      consumables: st.consumables,
      baseDiff: st.tripBaseDiff,
      moves: [...st.moves],
      pendingBunker: st.pendingBunker,
    };
  };
  const persistCurrentTrip = () => {
    const trip = currentTripSnapshot();
    if (!trip) return null;
    saveLocalTrip(get().activeSlot, trip);
    return trip;
  };
  const storeAccountTripCheckpoint = async () => {
    const trip = persistCurrentTrip();
    if (!trip) return true;
    const res = await storeRemoteAccountTrip(trip);
    return res.ok;
  };
  const checkpointFailureCanContinue = (state: AccountSyncState) =>
    state.currentSave?.exists === true;
  const loadAccountTripCheckpoint = async (slot: SaveSlotId) => {
    const res = await loadRemoteAccountTrip();
    if (!res.ok) return;
    const trip = accountTripFromResponse(res.body);
    if (trip) saveLocalTrip(slot, trip);
  };
  const clearAccountTripCheckpoint = async () => {
    await clearRemoteAccountTrip();
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
    accountSync: initialAccountSync,
    worldLoaded: false,
    fallVisualImpactKey: null,
    markFallVisualImpact: (key) => {
      if (get().fallVisualImpactKey === key) return;
      set({ fallVisualImpactKey: key });
    },
    clearFallVisualImpact: () => {
      if (get().fallVisualImpactKey === null) return;
      set({ fallVisualImpactKey: null });
    },

    saveCurrentTrip: persistCurrentTrip,

    move: (action) => {
      const { mine, tick, moves, cashOut } = get();
      // The submitted log must match what gets credited; digging during
      // a pending cash-out would be silently discarded on success.
      if (cashOut.state === "pending") return;
      const result = applyAction(mine, action);
      // Refused actions are not part of the trip (the sim ignored them).
      if (result.ok) moves.push(action);
      set({
        tick: tick + 1,
        lastResult: result,
        lastAction: action,
        ...(result.ok && result.collapsed ? { pendingBunker: null } : null),
      });
      // Persist the in-flight trip so a reload resumes mid-trip,
      // carry and carving intact.
      if (result.ok) {
        persistCurrentTrip();
      }
    },

    clearTerminalResult: () => {
      const { lastResult } = get();
      if (!(lastResult?.ok && lastResult.collapsed)) return;
      set({ lastResult: null, lastAction: null });
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
          const replay = replaySavedTrip(saved, baseDiff);
          if (
            replay.terminalReplayCollapsed &&
            !replay.terminalReplayConsumed
          ) {
            saveLocalTrip(slot, {
              mineVersion: MINE_VERSION,
              seed,
              tripIndex,
              gear: saved.gear,
              consumables: saved.consumables,
              baseDiff: saved.baseDiff,
              moves: replay.moves,
              pendingBunker: null,
              terminalReplayConsumed: true,
            });
          }
          set({
            activeSlot: slot,
            worldLoaded: true,
            seed,
            tripIndex,
            tripBaseDiff: baseDiff,
            gear: saved.gear,
            consumables: saved.consumables,
            mine: replay.mine,
            moves: replay.moves,
            pendingBunker: replay.pendingBunker,
            tick: replay.moves.length,
            lastResult: replay.lastResult,
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
      const res = await loadMineWorld();
      if (res.ok) {
        const body = res.body as Record<string, unknown>;
        const slot = validSaveSlot(body.activeSlot) ?? 1;
        resume(
          slot,
          body.seed as number,
          typeof body.tripIndex === "number" ? body.tripIndex : 0,
          Array.isArray(body.diff) ? (body.diff as WorldDiff) : [],
        );
        return;
      }
      const slot = get().activeSlot;
      const saved = loadLocalTrip(slot);
      if (saved) resume(slot, saved.seed, saved.tripIndex, saved.baseDiff);
    },

    loadGear: async () => {
      persistCurrentTrip();
      const res = await loadMineGear();
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
      const body = res.body as Record<string, unknown>;
      const gear: MineGear = normalizeGear(body.gear as MineGearSnapshot);
      const consumables: MineConsumables =
        (body.consumables as MineConsumables | undefined) ?? NO_CONSUMABLES;
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
      const res = await loadSaveSlotSummaries();
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
      const parsed = saveSlotSummariesFromResponse(res.body);
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
    },

    loadAccountStatus: async (options = {}) => {
      persistCurrentTrip();
      const current = get().accountSync;
      if (!options.silent) {
        set({
          accountSync: {
            ...current,
            state: "loading",
          },
        });
      }
      const res = await loadRemoteAccountStatus();
      if (res.status === 503) {
        set({
          accountSync: {
            ...current,
            state: "unavailable",
            mode: "guest",
            accountEmail: null,
            currentSave: null,
            accountSave: null,
          },
        });
        return;
      }
      if (!res.ok) {
        set({
          accountSync: {
            ...current,
            state: "error",
            message: "could not load account",
          },
        });
        return;
      }
      const parsed = accountStatusFromResponse(res.body);
      if (!parsed) {
        set({
          accountSync: {
            ...current,
            state: "error",
            message: "could not read account",
          },
        });
        return;
      }
      set({ accountSync: accountSyncFromStatus(parsed) });
      if (accountStatusShouldAutoClaim(parsed)) {
        await get().claimAccountSave();
      }
    },

    startAccountSignIn: async (returnTo = "/mine") => {
      const current = get().accountSync;
      if (!current.providerReady || !current.providerStatus.ready) {
        set({
          accountSync: {
            ...current,
            state: "error",
            message: "Google sign-in pending",
          },
        });
        return null;
      }
      const checkpointed = await storeAccountTripCheckpoint();
      if (!checkpointed) {
        if (checkpointFailureCanContinue(current)) {
          set({
            accountSync: {
              ...current,
              state: "ready",
            },
          });
        } else {
          set({
            accountSync: {
              ...current,
              state: "error",
              message: "could not save current trip",
            },
          });
          return null;
        }
      }
      set({
        accountSync: {
          ...current,
          state: "starting-sign-in",
        },
      });
      const res = await startRemoteAccountHandoff(returnTo);
      if (res.status === 503) {
        set({
          accountSync: {
            ...current,
            state: "unavailable",
            mode: "guest",
            accountEmail: null,
            currentSave: null,
            accountSave: null,
          },
        });
        return null;
      }
      if (!res.ok) {
        set({
          accountSync: {
            ...current,
            state: "error",
            message:
              res.status === 409
                ? "guest save required"
                : "sign-in start failed",
          },
        });
        return null;
      }
      const parsed = accountHandoffStartFromResponse(res.body);
      if (!parsed) {
        set({
          accountSync: {
            ...current,
            state: "error",
            message: "could not read sign-in handoff",
          },
        });
        return null;
      }
      set({
        accountSync: {
          ...current,
          state: "ready",
        },
      });
      return parsed;
    },

    finishAccountSignIn: async (handoffId) => {
      persistCurrentTrip();
      const current = get().accountSync;
      set({
        accountSync: {
          ...current,
          state: "finishing-sign-in",
        },
      });
      const res = await finishRemoteAccountHandoff(handoffId);
      if (res.status === 503) {
        set({
          accountSync: {
            ...current,
            state: "unavailable",
            mode: "guest",
            accountEmail: null,
            currentSave: null,
            accountSave: null,
          },
        });
        return false;
      }
      if (!res.ok) {
        if (res.status === 409) {
          await get().loadAccountStatus();
          return false;
        }
        set({
          accountSync: {
            ...current,
            state: "error",
            message:
              res.status === 401
                ? "sign-in required"
                : res.status === 410
                  ? "sign-in handoff expired"
                  : "sign-in finish failed",
          },
        });
        return false;
      }
      await get().loadAccountStatus();
      await get().loadSaveSlots();
      return true;
    },

    claimAccountSave: async () => {
      const current = get().accountSync;
      const checkpointed = await storeAccountTripCheckpoint();
      if (!checkpointed) {
        if (checkpointFailureCanContinue(current)) {
          set({
            accountSync: {
              ...current,
              state: "ready",
            },
          });
        } else {
          set({
            accountSync: {
              ...current,
              state: "error",
              message: "could not save current trip",
            },
          });
          return false;
        }
      }
      set({
        accountSync: {
          ...current,
          state: "claiming",
        },
      });
      const res = await claimRemoteAccountSave();
      if (res.status === 503) {
        set({
          accountSync: {
            ...current,
            state: "unavailable",
            mode: "guest",
            accountEmail: null,
            currentSave: null,
            accountSave: null,
          },
        });
        return false;
      }
      if (!res.ok) {
        if (res.status === 409) {
          await get().loadAccountStatus();
          return false;
        }
        set({
          accountSync: {
            ...current,
            state: "error",
            message:
              res.status === 401
                ? "sign-in required"
                : accountErrorMessageFromResponse(res.body, "claim failed"),
          },
        });
        return false;
      }
      await storeAccountTripCheckpoint();
      await get().loadAccountStatus();
      await get().loadSaveSlots();
      return true;
    },

    loadAccountSave: async () => {
      persistCurrentTrip();
      const current = get().accountSync;
      set({
        accountSync: {
          ...current,
          state: "loading-cloud",
        },
      });
      const res = await loadRemoteAccountSave();
      if (res.status === 503) {
        set({
          accountSync: {
            ...current,
            state: "unavailable",
            mode: "guest",
            accountEmail: null,
            currentSave: null,
            accountSave: null,
          },
        });
        return false;
      }
      if (!res.ok) {
        set({
          accountSync: {
            ...current,
            state: "error",
            message:
              res.status === 404 ? "cloud save not found" : "load failed",
          },
        });
        return false;
      }
      const parsed = accountCloudLoadFromResponse(res.body);
      if (!parsed) {
        set({
          accountSync: {
            ...current,
            state: "error",
            message: "could not read cloud save",
          },
        });
        return false;
      }
      const nextSlot = parsed.activeSlot;
      removeLocalTrip(nextSlot);
      await loadAccountTripCheckpoint(nextSlot);
      await get().loadWorld();
      await get().loadGear();
      await get().loadSaveSlots();
      set({
        accountSync: {
          ...current,
          state: "ready",
          mode: "cloud_loaded",
          currentSave: parsed.accountSave,
          accountSave: parsed.accountSave,
        },
      });
      void get().loadAccountStatus({ silent: true });
      return true;
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
      const res = await switchRemoteSaveSlot(slot, options);
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
      const parsed = saveSlotSummariesFromResponse(res.body);
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
      const res = await deleteRemoteSaveSlot(slot);
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
      const parsed = saveSlotSummariesFromResponse(res.body);
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
      const res = await submitMineBank({
        seed: currentSeed,
        tripIndex,
        moves,
        // The snapshot the trip actually ran on: a gear upgrade
        // bought mid-trip applies to the next trip, not this log.
        gear: mine.gear,
        consumables,
        pendingBunker: pendingBunkerPayload(pendingBunker),
      });
      if (res.status === 503) {
        set({ cashOut: { state: "unavailable" } });
        return false;
      }
      if (!res.ok) {
        const body = res.body;
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
      const body = res.body as Record<string, unknown>;
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
      await clearAccountTripCheckpoint();
      const credited = body.credited as Record<string, unknown>;
      set({
        tripBaseDiff: worldDiff,
        cashOut: {
          state: "done",
          credits: credited.credits as number,
          parts: credited.parts as string[],
          milestoneBonus:
            typeof credited.milestoneBonus === "number"
              ? credited.milestoneBonus
              : 0,
          balance: body.balance as number,
          soldHaul: credited.soldHaul as SoldHaul | undefined,
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
    },

    buyConsumable: async (item, quantity = 1) => {
      const { cashOut } = get();
      if (cashOut.state === "pending") return;
      persistCurrentTrip();
      const count = Math.max(1, Math.floor(quantity));
      const res = await buyRemoteConsumable(item, count);
      if (res.status === 503) {
        set({ shopNote: "the depot ledger is offline; nothing was charged" });
        return;
      }
      if (!res.ok) {
        const body = res.body as Record<string, unknown> | null;
        set({
          shopNote:
            body && typeof body.error === "string"
              ? body.error
              : "purchase failed",
        });
        return;
      }
      const body = res.body as Record<string, unknown>;
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
    },

    buyGearUpgrade: async (track) => {
      const { cashOut, mine, moves: currentMoves } = get();
      if (cashOut.state === "pending") return;
      persistCurrentTrip();
      if (mine.miner.row !== 0) {
        set({ shopNote: "return to the surface to upgrade" });
        return;
      }
      if (!surfaceOnlyLog(currentMoves)) {
        const banked = await get().submitCashOut();
        if (!banked) return;
      }
      const res = await buyRemoteGearUpgrade(track);
      if (res.status === 503) {
        set({
          shopNote: "the upgrades shop is offline; nothing was charged",
        });
        return;
      }
      if (!res.ok) {
        const body = res.body as Record<string, unknown> | null;
        set({
          shopNote:
            body && typeof body.error === "string"
              ? body.error
              : "upgrade failed",
        });
        return;
      }
      const body = res.body as Record<string, unknown>;
      const { gear, consumables, bought, moves, seed: s0, tick } = get();
      const level = body.level as number;
      const nextGear: MineGear = { ...gear, [track]: level };
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
        shopNote: `${track} is now level ${level}`,
        tick: tick + 1,
      });
    },

    buyElevator: async () => {
      if (get().cashOut.state === "pending") return;
      persistCurrentTrip();
      const res = await buyRemoteElevator();
      if (res.status === 503) {
        set({ shopNote: "the tower ledger is offline; nothing was charged" });
        return;
      }
      if (!res.ok) {
        const body = res.body as Record<string, unknown> | null;
        set({
          shopNote:
            body && typeof body.error === "string"
              ? body.error
              : "purchase failed",
        });
        return;
      }
      const body = res.body as Record<string, unknown>;
      const { gear, consumables, bought, moves, seed: s0, tick } = get();
      const elevator = body.elevator as number;
      const nextGear: MineGear = { ...gear, elevator };
      const fallbackRefund = refundRailSupportsInDiff(
        get().tripBaseDiff,
        gear.elevator,
        elevator,
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
          shopNote: `rail extended to ${elevator} deep${refundNote}`,
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
          shopNote: `rail extended to ${elevator} deep${refundNote}; rides start next trip`,
          tick: tick + 1,
        });
        persistCurrentTrip();
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
      const res = await teleportRemoteBase(price);
      if (res.status === 503) {
        set({ shopNote: "the base beacon is offline; nothing was charged" });
        return false;
      }
      if (!res.ok) {
        const body = res.body as Record<string, unknown> | null;
        set({
          shopNote:
            body && typeof body.error === "string"
              ? body.error
              : "teleport failed",
        });
        return false;
      }
      const body = res.body as Record<string, unknown>;
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
      await clearAccountTripCheckpoint();
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
