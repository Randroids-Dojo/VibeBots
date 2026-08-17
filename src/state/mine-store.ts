import { create } from "zustand";
import { type AccountErrorCode, accountErrorCode } from "@/lib/api-codes";
import {
  applyBunkerReset,
  type BasePartId,
  type BunkerFootprint,
  type BunkerOrientation,
  type BunkerSlot,
  type BunkerState,
  bunkerCells,
  createBunker,
  excavateBunkerCell,
  moveBasePart,
  type PendingBunkerBuild,
  type PendingBunkerClaimPayload,
  placeBasePart,
  proposedBunkerFootprint,
  removeBasePart,
  STARTER_BASE_PART_INVENTORY,
} from "@/sim/bunker";
import { deriveBunkerBlockSeed } from "@/sim/bunker-blocks";
import {
  addConsumables,
  applyAction,
  bunkerDigAction,
  carryoverConsumables,
  cellAt,
  createMine,
  DEFAULT_GEAR,
  ELEVATOR_UNLOCK_DEPTH,
  elevatorColumn,
  exportDiff,
  installElevatorRailInDiff,
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
  isStaleTripCheckpoint,
  isTripAlreadyCashedOut,
  loadMineGear,
  loadMineWorld,
  loadMineWorldVersion,
  loadRemoteAccountSave,
  loadAccountStatus as loadRemoteAccountStatus,
  loadRemoteAccountTrip,
  loadSaveSlotSummaries,
  type MineWorldVersion,
  type SaveSlotSummary,
  saveSlotSummariesFromResponse,
  startRemoteAccountHandoff,
  storeRemoteAccountTrip,
  submitMineBank,
  switchRemoteSaveSlot,
  teleportRemoteBase,
  worldVersionFromResponse,
} from "./mine-api-client";
import {
  anyRailResyncBlock,
  loadLocalTrip,
  loadRailResyncBlock,
  removeLocalTrip,
  replaySavedTrip,
  type SavedTrip,
  type SaveSlotId,
  saveLocalTrip,
  saveRailResyncBlock,
  storedTripPendingBunkerIsCorrupt,
  validSaveSlot,
} from "./mine-trip-persistence";
import { enqueueStampAlertsFromResponse } from "./stamp-alert-store";

export type {
  AccountHandoffStart,
  AccountProviderStatus,
  AccountSaveSummary,
  SaveSlotSummary,
} from "./mine-api-client";

/**
 * Player-facing note for a rejected rail buy, keyed off the server's stable
 * reason code (F-121). The screen has already adopted the authoritative rail
 * state by the time this shows, so every message reads as "we refreshed you"
 * rather than a dead end.
 */
function elevatorConflictNote(code: string | null): string {
  switch (code) {
    case "elevator-insufficient-balance":
      return "not enough vibes for the next rail";
    case "elevator-stale-rail-state":
      return "your rail moved on another device; refreshed to the latest";
    case "elevator-stale-checkpoint":
      return "the mine changed under you; refreshed to the latest";
    case "elevator-rail-at-bottom":
      return "the rail already reaches the mine bottom";
    case "elevator-depth-locked":
      return `reach depth ${ELEVATOR_UNLOCK_DEPTH} to unlock the elevator`;
    case "elevator-column-required":
      return "choose a surface column for the elevator shaft";
    case "elevator-mine-world-missing":
      return "the mine is still loading; try again in a moment";
    case "elevator-concurrent-loss":
      return "another change landed first; refreshed to the latest";
    case "elevator-duplicate-request":
      return "that purchase already went through; refreshed to the latest";
    default:
      return "purchase failed";
  }
}

/** An integer at least `min`, or null when the value is not one. */
function intAtLeast(v: unknown, min: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= min ? v : null;
}

/**
 * The authoritative gear an elevator response carries (F-121), or null when it
 * is absent (an older server) OR malformed. Validation is strict: every gear
 * level must be a present integer at its floor and the shaft column an integer
 * or null, because `normalizeGear` would otherwise fill a garbage body into a
 * plausible level-1 snapshot that, adopted wholesale, would clobber real gear.
 */
function gearFromElevatorResponse(
  body: Record<string, unknown>,
): MineGear | null {
  const raw = body.gear;
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const col = g.elevatorColumn;
  const columnOk =
    col === null || (typeof col === "number" && Number.isInteger(col));
  if (
    !columnOk ||
    intAtLeast(g.pickaxe, 1) === null ||
    intAtLeast(g.battery, 1) === null ||
    intAtLeast(g.cargo, 1) === null ||
    intAtLeast(g.lantern, 1) === null ||
    intAtLeast(g.warpcoil, 1) === null ||
    intAtLeast(g.elevator, 0) === null ||
    intAtLeast(g.blast, 1) === null ||
    intAtLeast(g.elevatorSpeed, 1) === null ||
    intAtLeast(g.fall, 1) === null ||
    intAtLeast(g.recall, 1) === null
  ) {
    return null;
  }
  return normalizeGear(g as MineGearSnapshot);
}

/**
 * The authoritative consumables an elevator response carries (F-121), or null
 * when absent or malformed. Every count must be a present non-negative integer,
 * so a negative, fractional, or missing count is rejected rather than adopted.
 */
function consumablesFromElevatorResponse(
  body: Record<string, unknown>,
): MineConsumables | null {
  const raw = body.consumables;
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const dynamite = intAtLeast(c.dynamite, 0);
  const rope = intAtLeast(c.rope, 0);
  const ladder = intAtLeast(c.ladder, 0);
  const plank = intAtLeast(c.plank, 0);
  const beacon = intAtLeast(c.beacon, 0);
  if (
    dynamite === null ||
    rope === null ||
    ladder === null ||
    plank === null ||
    beacon === null
  ) {
    return null;
  }
  return { dynamite, rope, ladder, plank, beacon };
}

/**
 * Parse the response's authoritative inventory as ONE atomic unit (F-121): both
 * gear and consumables must validate, and the fields the response duplicates as
 * top-level scalars (rail depth, shaft column, ladder and plank counts) must
 * equal their nested values, since both come from the same committed row. Any
 * omission, malformed value, or mismatch returns null so the caller adopts
 * nothing from a partial or corrupt body and keeps its last-known-good state
 * (which self-heals on the next gear load) rather than persisting mixed
 * authority. An older server that omits the objects entirely also returns null,
 * which routes the caller to its rail-only merge over the valid top-level rail.
 */
function authoritativeInventoryFromResponse(
  body: Record<string, unknown>,
): { gear: MineGear; consumables: MineConsumables } | null {
  const gear = gearFromElevatorResponse(body);
  const consumables = consumablesFromElevatorResponse(body);
  if (!gear || !consumables) return null;
  if (typeof body.elevator === "number" && gear.elevator !== body.elevator) {
    return null;
  }
  if (
    typeof body.elevatorColumn === "number" &&
    gear.elevatorColumn !== body.elevatorColumn
  ) {
    return null;
  }
  if (typeof body.ladders === "number" && consumables.ladder !== body.ladders) {
    return null;
  }
  if (typeof body.planks === "number" && consumables.plank !== body.planks) {
    return null;
  }
  return { gear, consumables };
}

/**
 * Multi-device conflict state (REQ-042). "prompt" means another device
 * advanced the cloud save while this one holds real trip progress; the
 * player must choose to sync (dropping the run) or keep playing. A
 * "dismissed" conflict stops further probes; a failed cash-out re-prompts.
 */
export type SaveConflictState = "none" | "prompt" | "dismissed";

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
      providerStatus: AccountProviderStatus;
      mode: AccountStatusMode;
      accountEmail: string | null;
      currentSave: AccountSaveSummary | null;
      accountSave: AccountSaveSummary | null;
    }
  | {
      state: "error";
      providerStatus: AccountProviderStatus;
      mode: AccountStatusMode;
      accountEmail: string | null;
      currentSave: AccountSaveSummary | null;
      accountSave: AccountSaveSummary | null;
      message: string;
      /** Machine code from the failing response, when one was carried. */
      code?: AccountErrorCode | null;
    };

function accountSyncFromStatus(
  status: AccountStatus,
  state: Extract<AccountSyncState["state"], "ready" | "loading"> = "ready",
): AccountSyncState {
  return {
    state,
    providerStatus: status.providerStatus,
    mode: status.mode,
    accountEmail: status.account?.email ?? null,
    currentSave: status.currentSave,
    accountSave: status.accountSave,
  };
}

/** The storage-offline reset every account action applies on a 503. */
function unavailableAccountSync(current: AccountSyncState): AccountSyncState {
  return {
    ...current,
    state: "unavailable",
    mode: "guest",
    accountEmail: null,
    currentSave: null,
    accountSave: null,
  };
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
  /** Existing owners get one free shaft placement before buying more rail. */
  elevatorPlacementRequired: boolean;
  /** One-line feedback for the stall menus. */
  shopNote: string | null;
  /** True while an elevator buy detected a moved world but the authoritative
   * refresh then failed (offline mid-conflict). The local rail state is known
   * stale and could not be reconciled, so the rail-buy control is blocked until
   * an explicit `retryRailResync` succeeds. Distinct state, not a note string:
   * the shopNote is transient feedback, this gates an action. */
  railResyncFailed: boolean;
  /** True while a `resyncCloudWorld` refresh is running. Transient (never
   * persisted): an async buy yields at the refresh await, so the rail-buy guard
   * must block any concurrent buy for the whole refresh, independent of what the
   * mid-refresh loadWorld reflects into `railResyncFailed` (F-121). */
  railResyncInFlight: boolean;
  /** Server replay-protection counter; null until the world loads. */
  tripIndex: number;
  /** The world checkpoint this trip started from (the replay base). */
  tripBaseDiff: WorldDiff;
  moves: MineAction[];
  pendingBunker: PendingBunkerBuild | null;
  bunkerReplayFootprint: BunkerFootprint | null;
  tick: number;
  lastResult: MoveResult | null;
  lastAction: MineAction | null;
  /** One-shot direction for restored automatic elevator travel. */
  resumeElevatorDirection: "ride-up" | "ride-down" | null;
  cashOut: CashOutState;
  activeSlot: SaveSlotId;
  saveSlots: SaveSlotsState;
  accountSync: AccountSyncState;
  saveConflict: SaveConflictState;
  /** Throttle bookkeeping for the multi-device freshness probe. */
  freshnessProbeInFlight: boolean;
  lastFreshnessProbeAt: number;
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
  /** Tick key of the playback whose FIRST frame has rendered. The trip
   * report's wall-clock ceiling exists for a canvas that never renders the
   * impact, but measured from the death it can expire before a stalled
   * scene has even started the playback, which puts the report on screen
   * ahead of the fall. The report re-arms that ceiling from this signal so
   * it only runs while the playback is really on screen. */
  fallVisualStartKey: number | null;
  markFallVisualStart: (key: number) => void;
  move: (action: MineAction) => MoveResult | null;
  clearTerminalResult: () => void;
  loadWorld: () => Promise<boolean>;
  loadGear: () => Promise<boolean>;
  loadSaveSlots: () => Promise<void>;
  loadAccountStatus: (options?: { silent?: boolean }) => Promise<void>;
  startAccountSignIn: (
    returnTo?: string,
  ) => Promise<AccountHandoffStart | null>;
  finishAccountSignIn: (handoffId: string) => Promise<boolean>;
  claimAccountSave: () => Promise<boolean>;
  loadAccountSave: () => Promise<boolean>;
  checkWorldFreshness: (options?: { force?: boolean }) => Promise<void>;
  resolveSaveConflict: (choice: "sync" | "keep") => Promise<void>;
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
    depth?: number,
    slot?: BunkerSlot,
    orientation?: BunkerOrientation,
  ) => boolean;
  removePendingBunkerPart: (
    col: number,
    row: number,
    depth?: number,
    slot?: BunkerSlot,
  ) => boolean;
  movePendingBunkerPart: (
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
    fromDepth?: number,
    toDepth?: number,
  ) => boolean;
  excavatePendingBunkerCell: (
    col: number,
    row: number,
    depth: number,
  ) => boolean;
  /**
   * Record a dig in a BANKED bunker into the live trip: log a `bunker-dig`
   * action and credit its ore to the shared trip bag. The bunker's block seed
   * derives the drop, so the caller passes the current banked bunker. Called
   * only after the authoritative excavate has persisted the cell server-side,
   * so the bank replay finds the cell in the durable dug set. Returns whether
   * the credit applied.
   */
  recordBankedBunkerDig: (
    bunker: BunkerState,
    col: number,
    row: number,
    depth: number,
  ) => boolean;
  resetPendingBunker: () => boolean;
  submitCashOut: () => Promise<boolean>;
  buyConsumable: (
    item: keyof MineConsumables,
    quantity?: number,
  ) => Promise<void>;
  buyGearUpgrade: (track: MineGearTrack) => Promise<void>;
  buyElevator: (column?: number) => Promise<boolean>;
  /** Re-run the authoritative refresh after a failed rail resync. Clears
   * `railResyncFailed` and unblocks the rail-buy control on success; leaves the
   * block in place (and re-notes the failure) when the refresh fails again. */
  retryRailResync: () => Promise<boolean>;
  teleportToBase: (cost: number) => Promise<boolean>;
  restart: (seed?: number) => void;
}

/**
 * Every logged action is surface traversal: walking, activating a portal
 * beacon, or warping between them. Used to decide whether a save
 * divergence is worth interrupting the player over, where none of these
 * count as progress worth losing a prompt on.
 *
 * NOT a test for "the world is unchanged": activating a portal writes
 * through to its cell and so does persist. Use {@link tripChangedWorld}
 * for that question.
 */
function surfaceOnlyLog(moves: MineAction[]): boolean {
  return moves.every(
    (m) =>
      m === "left" ||
      m === "right" ||
      m.startsWith("activate-portal:") ||
      m.startsWith("portal-warp:"),
  );
}

/**
 * The trip carved, built, or otherwise altered the world, so reaching the
 * surface is worth banking even when the hold came up empty: the stored
 * world diff is the only durable copy of that work (REQ-026).
 *
 * Deliberately narrower than the negation of {@link surfaceOnlyLog}, which
 * also forgives portal activation. `activatePortal` writes `kind`,
 * `portal`, and `portalActive` onto its cell, so an activation is real
 * world state and a trip that only did that still has to be banked. Only
 * pure movement is exempt: walking and portal warps read the world without
 * touching it. Anything else counts, which errs toward banking a no-op
 * rather than dropping a change, and a redundant bank costs one request
 * while keeping the device and server trip counters in step.
 */
export function tripChangedWorld(moves: MineAction[]): boolean {
  return !moves.every(
    (m) => m === "left" || m === "right" || m.startsWith("portal-warp:"),
  );
}

/**
 * {@link tripChangedWorld}, minus surface elevator boardings. Stepping onto
 * the elevator at row 0 logs a "down" that alters nothing (the shaft opening
 * is already rail), but counting it as a world change made the surface
 * auto-bank fire the instant a player boarded from the top: the cash-out
 * reset the trip and yanked the bot back off the car, so the elevator could
 * never ride down from the surface.
 *
 * Forgiving "down" is sound only in the boarded-at-surface state, and there
 * it is sound for the whole log, not just the trailing move: a "down" that
 * dug leaves the surface, and only an up, jump, or ride move (none of them
 * forgiven) could bring the miner back to row 0, so in an otherwise
 * pure-movement log every "down" was a boarding. That also covers boarding,
 * stepping off, and boarding again in one trip.
 */
export function tripChangedWorldBeyondSurfaceBoarding(
  moves: MineAction[],
  elevatorPhase: MineState["elevatorPhase"],
  minerRow: number,
): boolean {
  if (elevatorPhase !== "boarded" || minerRow !== 0) {
    return tripChangedWorld(moves);
  }
  return !moves.every(
    (m) =>
      m === "left" ||
      m === "right" ||
      m === "down" ||
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
    dug: pending.bunker.dug,
  };
}

// Freshness probes are throttled: lifecycle events (focus, visibility,
// pageshow) can fire in bursts and every probe is a network roundtrip.
export const FRESHNESS_PROBE_MIN_INTERVAL_MS = 10_000;

// Incremental server check-ins: how many logged trip actions between
// background uploads of the in-flight trip to the account checkpoint, so a
// long dig session (especially inside a bunker) survives a reload or a swap
// to another device without banking. A claim fires one immediately on top of
// this cadence. Every action would be a network roundtrip per dig; this keeps
// at most one upload per this many actions.
export const TRIP_CHECKPOINT_ACTION_INTERVAL = 25;

/** Same-browser tabs share save updates instantly, no push needed. */
export const SAVE_SYNC_CHANNEL = "vibebots-save-sync";

function notifySaveSyncPeers(): void {
  try {
    const channel = new BroadcastChannel(SAVE_SYNC_CHANNEL);
    channel.postMessage("save-advanced");
    channel.close();
  } catch {
    // BroadcastChannel unavailable: cross-tab sync falls back to probes.
  }
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
      bunkerFootprint: st.bunkerReplayFootprint,
    };
  };
  const persistCurrentTrip = () => {
    const trip = currentTripSnapshot();
    if (!trip) return null;
    saveLocalTrip(get().activeSlot, trip);
    return trip;
  };
  type AccountTripCheckpointResult =
    | "stored"
    | "missing-world"
    | "stale"
    | "failed";
  const storeAccountTripCheckpoint =
    async (): Promise<AccountTripCheckpointResult> => {
      const trip = persistCurrentTrip();
      if (!trip) return "missing-world";
      const res = await storeRemoteAccountTrip(trip);
      if (res.ok) return "stored";
      return isStaleTripCheckpoint(res.body) ? "stale" : "failed";
    };
  const checkpointFailureCanContinue = (
    state: AccountSyncState,
    result: AccountTripCheckpointResult,
  ) =>
    // No loaded world means there is no in-progress trip to persist, so the
    // claim or sign-in can proceed. A real "failed" upload only continues when
    // a device save already exists to fall back on.
    result === "missing-world" ||
    (result === "failed" && state.currentSave?.exists === true);
  // Checkpoints the in-flight trip before an account action. Returns false
  // when the failure is terminal; accountSync then already holds the error
  // (or the save-conflict flow owns the screen for a stale checkpoint).
  const gateOnTripCheckpoint = async (): Promise<boolean> => {
    const checkpointResult = await storeAccountTripCheckpoint();
    if (checkpointResult === "stored") return true;
    const current = get().accountSync;
    if (checkpointResult === "stale") {
      // The server world moved under this device: the earliest multi-device
      // conflict signal. Abort the account action and run the conflict flow.
      set({ accountSync: { ...current, state: "ready" } });
      if (surfaceOnlyLog(get().moves)) {
        await refreshCloudWorld(get().activeSlot);
      } else {
        set({ saveConflict: "prompt" });
      }
      return false;
    }
    if (checkpointFailureCanContinue(current, checkpointResult)) {
      set({ accountSync: { ...current, state: "ready" } });
      return true;
    }
    set({
      accountSync: {
        ...current,
        state: "error",
        message: "could not save current trip",
      },
    });
    return false;
  };
  const loadAccountTripCheckpoint = async (slot: SaveSlotId) => {
    const res = await loadRemoteAccountTrip();
    if (!res.ok) return;
    const trip = accountTripFromResponse(res.body);
    if (trip) saveLocalTrip(slot, trip);
  };
  const clearAccountTripCheckpoint = () => {
    if (get().accountSync.mode === "guest") return;
    void clearRemoteAccountTrip();
  };
  // A background upload of the in-flight trip to the account checkpoint, fired
  // on the action cadence and right after a bunker claim. Best-effort by
  // design: the local trip stays the authority, so a failed or stale upload
  // never blocks digging. Guests have no checkpoint row (they persist
  // locally), and the in-flight guard keeps a burst of actions from stacking
  // uploads. A stale upload means another device advanced the world; the
  // first-move freshness probe and the bank's own re-validation own that
  // conflict, so this stays quiet rather than interrupting play.
  //
  // The calling reducer has already persisted the trip locally, so this only
  // needs the snapshot for the network upload: it builds it once and uploads
  // directly rather than re-persisting (which would re-serialize and re-write
  // local storage a second time on every check-in).
  let tripCheckpointInFlight = false;
  const checkpointTripInBackground = () => {
    if (get().accountSync.mode === "guest") return;
    if (tripCheckpointInFlight) return;
    const trip = currentTripSnapshot();
    if (!trip) return;
    tripCheckpointInFlight = true;
    void storeRemoteAccountTrip(trip)
      .catch(() => {})
      .finally(() => {
        tripCheckpointInFlight = false;
      });
  };
  // Every reducer that appends a logged trip action calls this so the check-in
  // cadence covers the whole trip log, not just `move`. First-move handling
  // (the freshness probe) stays with `move`; this owns only the interval.
  const checkpointTripOnCadence = (moveCount: number) => {
    if (moveCount > 1 && moveCount % TRIP_CHECKPOINT_ACTION_INTERVAL === 0) {
      checkpointTripInBackground();
    }
  };
  // True while the refresh below is in flight, read by the load path.
  let adoptingCloudWorld = false;
  // Drops this device's local trip and adopts the cloud world, gear, and
  // save slots. Used after a cloud load and whenever another device
  // advanced the save.
  const refreshCloudWorld = async (slot: SaveSlotId) => {
    // The player has already chosen the cloud copy, so the load this
    // triggers must never ask again: the checkpoint restore below can put
    // a trip back on disk whose index the incoming world has since moved
    // past, and prompting on that would bounce the player between the
    // dialog and the same load forever.
    adoptingCloudWorld = true;
    try {
      removeLocalTrip(slot);
      await loadAccountTripCheckpoint(slot);
      // The world/gear chain must follow the checkpoint restore, but the
      // save-slot list is independent and can load alongside it.
      await Promise.all([
        (async () => {
          await get().loadWorld();
          await get().loadGear();
        })(),
        get().loadSaveSlots(),
      ]);
    } finally {
      adoptingCloudWorld = false;
    }
  };
  // Bounded authoritative refetch for a rejected surface mutation (an elevator
  // conflict). Unlike refreshCloudWorld it deliberately SKIPS the
  // /api/account/trip checkpoint restore: that checkpoint is guarded by seed
  // plus trip count, not rail depth, so a concurrent rail winner can leave the
  // same tripIndex while the account-trip payload still carries stale rail gear
  // and moves. Restoring it would let loadWorld replay a mixed checkpoint whose
  // gear disagrees with the authoritative rail. Dropping the local trip makes
  // loadWorld rebuild fresh over the authoritative world diff (its no-local-trip
  // branch also zeroes moves), and loadGear then rebuilds mine.gear over the
  // authoritative gear. Returns true only when BOTH authoritative reads
  // succeeded, so the caller does not claim "refreshed" over a failed fetch.
  // Safe here because the buy runs at the surface with any non-surface log
  // already banked, so the dropped trip carries no unbanked progress.
  // The destructive reconcile chain (drop trip, reload world, reload gear, clear
  // checkpoint) for one pinned slot. Returns whether the requested slot was
  // fully reconciled; it does NOT touch the block marker (its owner does).
  const reconcileSlot = async (slot: SaveSlotId): Promise<boolean> => {
    removeLocalTrip(slot);
    // Do NOT pre-clear moves: loadWorld's no-local-trip branch already zeroes
    // them on success, so clearing first would only tear coherent in-memory
    // state (mine paired with its moves) if the read then failed.
    if (!(await get().loadWorld())) return false;
    // Pinned-slot check: loadWorld adopts the server's active slot, which can
    // differ from the slot this resync was asked to reconcile (a client/server
    // slot desync). If so, we did NOT reconcile the requested slot, so its block
    // must not clear off this result; a later retry runs against the now-adopted
    // slot (F-121).
    if (get().activeSlot !== slot) return false;
    // loadGear persists the rebuilt trip before its own fetch; if that fetch
    // then fails, the persisted checkpoint pairs the new world and tripIndex
    // with the old gear. It has no moves, so loadWorld's resume would ignore
    // it, but drop it anyway so no mixed checkpoint can survive a failure.
    if (!(await get().loadGear())) {
      removeLocalTrip(slot);
      return false;
    }
    // The remote /api/account/trip checkpoint can still hold the pre-conflict
    // gear at this same tripIndex, and a later refreshCloudWorld downloads it
    // BEFORE loadWorld, which would restore it. Await an explicit clear and
    // treat a failed clear as a resync failure so success is never reported
    // while a resurrectable checkpoint survives (signed-in only; guests never
    // wrote such a checkpoint).
    if (get().accountSync.mode !== "guest") {
      const cleared = await clearRemoteAccountTrip();
      // The route returns 200 { cleared: false } when no player is resolved,
      // so cleared.ok alone would count an unresolved DELETE as a completed
      // clear and let a resurrectable checkpoint survive. Require the explicit
      // confirmation (F-121 full-authority).
      const clearedBody = cleared.body as { cleared?: unknown } | null;
      if (!cleared.ok || clearedBody?.cleared !== true) {
        removeLocalTrip(slot);
        return false;
      }
    }
    void get().loadSaveSlots();
    return true;
  };
  // Single global, pinned, self-owned recovery action. ONE refresh runs at a
  // time; every concurrent caller (a second Retry tap, or a Retry racing the
  // conflict path) joins the SAME promise rather than launching a parallel
  // destructive chain. The action OWNS the block marker: it raises the block for
  // its pinned slot up front (durability + the live re-entrancy guard the buy
  // reads) and finalizes it exactly once when the chain settles, so no outer
  // caller writes the marker off a shared result (F-121).
  let pendingResync: Promise<boolean> | null = null;
  const runResyncCloudWorld = async (slot: SaveSlotId): Promise<boolean> => {
    saveRailResyncBlock(slot, true);
    set({ railResyncFailed: true, railResyncInFlight: true });
    let success = false;
    try {
      success = await reconcileSlot(slot);
      return success;
    } finally {
      saveRailResyncBlock(slot, !success);
      set({ railResyncFailed: !success, railResyncInFlight: false });
    }
  };
  const resyncCloudWorld = (slot: SaveSlotId): Promise<boolean> => {
    if (pendingResync) return pendingResync;
    pendingResync = runResyncCloudWorld(slot).finally(() => {
      pendingResync = null;
    });
    return pendingResync;
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
    elevatorPlacementRequired: false,
    shopNote: null,
    railResyncFailed: false,
    railResyncInFlight: false,
    tripIndex: 0,
    tripBaseDiff: [],
    moves: [],
    pendingBunker: null,
    bunkerReplayFootprint: null,
    tick: 0,
    lastResult: null,
    lastAction: null,
    resumeElevatorDirection: null,
    cashOut: { state: "idle" },
    activeSlot: 1,
    saveSlots: initialSlots,
    accountSync: initialAccountSync,
    saveConflict: "none",
    freshnessProbeInFlight: false,
    lastFreshnessProbeAt: 0,
    worldLoaded: false,
    fallVisualImpactKey: null,
    markFallVisualImpact: (key) => {
      if (get().fallVisualImpactKey === key) return;
      set({ fallVisualImpactKey: key });
    },
    clearFallVisualImpact: () => {
      if (
        get().fallVisualImpactKey === null &&
        get().fallVisualStartKey === null
      ) {
        return;
      }
      set({ fallVisualImpactKey: null, fallVisualStartKey: null });
    },
    fallVisualStartKey: null,
    markFallVisualStart: (key) => {
      if (get().fallVisualStartKey === key) return;
      set({ fallVisualStartKey: key });
    },

    saveCurrentTrip: persistCurrentTrip,

    move: (action) => {
      const { mine, tick, moves, cashOut, resumeElevatorDirection } = get();
      // The submitted log must match what gets credited; digging during
      // a pending cash-out would be silently discarded on success.
      if (cashOut.state === "pending") return null;
      const result = applyAction(mine, action);
      const preservesRestoredRide =
        !result.ok &&
        ((resumeElevatorDirection === "ride-down" &&
          mine.elevatorPhase === "riding-down") ||
          (resumeElevatorDirection === "ride-up" &&
            mine.elevatorPhase === "riding-up"));
      // Refused actions are not part of the trip (the sim ignored them).
      if (result.ok) moves.push(action);
      set({
        tick: tick + 1,
        lastResult: result,
        lastAction: action,
        resumeElevatorDirection: preservesRestoredRide
          ? resumeElevatorDirection
          : null,
        ...(result.ok && result.collapsed ? { pendingBunker: null } : null),
      });
      // Persist the in-flight trip so a reload resumes mid-trip,
      // carry and carving intact.
      if (result.ok) {
        persistCurrentTrip();
        // A trip is starting: catch a save that advanced on another
        // device while real progress on this one is still tiny.
        if (moves.length === 1) void get().checkWorldFreshness();
        // Incremental server check-in on the action cadence, so a long session
        // survives a reload without banking. `moves` already has this action
        // pushed, so its length is the running action count.
        else checkpointTripOnCadence(moves.length);
      }
      return result;
    },

    clearTerminalResult: () => {
      const { lastResult } = get();
      if (!(lastResult?.ok && lastResult.collapsed)) return;
      set({
        lastResult: null,
        lastAction: null,
        resumeElevatorDirection: null,
      });
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
        const stored = loadLocalTrip(slot);
        // A log for another world, or with no moves, is not progress to
        // protect; narrowing to null here keeps the rest branch-free.
        const saved =
          stored && stored.seed === seed && stored.moves.length > 0
            ? stored
            : null;
        // A trip anchored to a different point in this world's history is
        // still real play: it is restored from its own base rather than
        // spliced onto the server diff. A surface-only log is not worth
        // keeping over the server's, so a diverged one adopts silently,
        // the rule checkWorldFreshness already applies.
        const diverged = saved !== null && saved.tripIndex !== tripIndex;
        // Offering the cloud copy only makes sense when there IS one, and
        // only when the player has not just asked for it. Same precondition
        // checkWorldFreshness states as "only a cloud-linked save can
        // advance on another device"; without it a guest, who also gets a
        // server tripIndex from their cookie, would be told their save
        // changed on a device they have never used.
        const offerCloudCopy =
          diverged &&
          !adoptingCloudWorld &&
          get().accountSync.mode === "cloud_loaded";
        if (saved && !(diverged && surfaceOnlyLog(saved.moves))) {
          // A diverged trip replays over the base it was saved against;
          // an in-step one replays over the server's fresher diff.
          const replayBase = diverged ? saved.baseDiff : baseDiff;
          const effectiveTripIndex = diverged ? saved.tripIndex : tripIndex;
          const replay = replaySavedTrip(saved, replayBase);
          if (
            replay.terminalReplayCollapsed &&
            !replay.terminalReplayConsumed
          ) {
            saveLocalTrip(slot, {
              mineVersion: MINE_VERSION,
              seed,
              tripIndex: effectiveTripIndex,
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
            tripIndex: effectiveTripIndex,
            tripBaseDiff: replayBase,
            gear: saved.gear,
            consumables: saved.consumables,
            mine: replay.mine,
            moves: replay.moves,
            pendingBunker: replay.pendingBunker,
            bunkerReplayFootprint:
              saved.bunkerFootprint ??
              saved.pendingBunker?.bunker.footprint ??
              null,
            tick: replay.moves.length,
            lastResult: replay.lastResult,
            resumeElevatorDirection: replay.resumeElevatorDirection,
            // Diverged: the device's world is loaded and the cloud copy is
            // offered through the normal conflict prompt. Otherwise any
            // prior conflict was about the world being replaced here.
            saveConflict: offerCloudCopy ? "prompt" : "none",
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
          bunkerReplayFootprint: null,
          tick: 0,
          lastResult: null,
          resumeElevatorDirection: null,
          // Any save conflict was about the world being replaced here.
          saveConflict: "none",
        });
      };
      const res = await loadMineWorld();
      // A 200 is authority ONLY if the required world field is well-formed. A
      // malformed body (missing/NaN seed) is NOT proof of fresh rail authority,
      // so it must not adopt a broken world or reconcile the rail: it falls
      // through to the offline branch, which fails closed on any persisted
      // marker (F-121 full-authority).
      if (res.ok && typeof res.body === "object" && res.body !== null) {
        const body = res.body as Record<string, unknown>;
        if (typeof body.seed === "number" && Number.isFinite(body.seed)) {
          const slot = validSaveSlot(body.activeSlot) ?? 1;
          resume(
            slot,
            body.seed,
            typeof body.tripIndex === "number" ? body.tripIndex : 0,
            Array.isArray(body.diff) ? (body.diff as WorldDiff) : [],
          );
          // A world load adopts fresh WORLD state but NOT the rail: rail
          // authority lives in gear (loaded separately by loadGear) and, for
          // signed-in players, in the remote account-trip checkpoint clear. So
          // loadWorld must NOT clear the stale-rail block here (a crash after
          // this success but before gear or the checkpoint clear would fail open
          // again). It only reflects the persisted marker; the block is cleared
          // solely when the full resync chain succeeds (retryRailResync / the
          // buy conflict path with synced === true) or an accepted buy adopts
          // server truth (F-121 reload-durable).
          set({ railResyncFailed: loadRailResyncBlock(slot) });
          return true;
        }
      }
      const slot = get().activeSlot;
      // Check before loadLocalTrip drops the blob: a corrupt pending-bunker
      // checkpoint gets a clear fresh-start notice, while a routine version or
      // shape mismatch resets silently as it always has (F-112).
      const corruptCheckpoint = storedTripPendingBunkerIsCorrupt(slot);
      const saved = loadLocalTrip(slot);
      if (saved) {
        resume(slot, saved.seed, saved.tripIndex, saved.baseDiff);
      } else if (corruptCheckpoint) {
        set({
          shopNote:
            "Your saved trip couldn't be restored, so a fresh one started.",
        });
        // Dropping a corrupt TRIP is not proof of fresh RAIL authority (the
        // world load failed), so it must NOT clear the stale-rail block: fall
        // through to restore the persisted block like any other offline load.
      }
      // Could not adopt fresh authority (offline, storage-less, or malformed).
      // Fail closed from ANY persisted rail block, not just the assumed active
      // slot: a failed conflict resync deletes the local trip BEFORE its world
      // fetch, so the real offline-reload path has no saved trip, and a cold
      // store defaults to slot 1 before the server slot list resolves, so
      // reading only that slot would miss a block on the slot the player is
      // really on (two slots can share a rail depth, so the server depth guard
      // is not a sufficient backstop). Keep the buy gated until a full resync
      // reconciles the rail (F-121 reload-durable).
      set({ railResyncFailed: anyRailResyncBlock() });
      // The authoritative server world did not load (storage-less or a failed
      // fetch); callers that need a confirmed cloud refresh treat this as a miss.
      return false;
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
        // No authoritative player row loaded (storage-less or a failed fetch).
        return false;
      }
      const body =
        typeof res.body === "object" && res.body !== null
          ? (res.body as Record<string, unknown>)
          : null;
      // A 200 is authoritative gear ONLY if both the gear and consumables
      // objects are present. A malformed body (valid gear but missing
      // consumables) must NOT authorize adopting inventory or clearing the
      // stale-rail block, so treat it as a failed read (F-121 full-authority).
      if (
        !body ||
        typeof body.gear !== "object" ||
        body.gear === null ||
        typeof body.consumables !== "object" ||
        body.consumables === null
      ) {
        return false;
      }
      const gear: MineGear = normalizeGear(body.gear as MineGearSnapshot);
      const consumables: MineConsumables = body.consumables as MineConsumables;
      const elevatorPlacementRequired = body.elevatorPlacementRequired === true;
      set({
        balance: typeof body.balance === "number" ? body.balance : null,
        playerLevel:
          typeof body.playerLevel === "number" ? body.playerLevel : 1,
        deepestDepth:
          typeof body.deepestDepth === "number" ? body.deepestDepth : 0,
        elevatorPlacementRequired,
      });
      const current = get().gear;
      const currentCons = get().consumables;
      if (
        gear.pickaxe === current.pickaxe &&
        gear.battery === current.battery &&
        gear.cargo === current.cargo &&
        gear.lantern === current.lantern &&
        gear.elevator === current.elevator &&
        elevatorColumn(gear) === elevatorColumn(current) &&
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
        return true;
      }
      // Gear changes the sim. A fresh trip restarts on the owned
      // snapshot over the same world; a resumed in-flight trip keeps
      // the gear snapshot it was saved with.
      if (get().moves.length > 0) {
        set({ gear });
        return true;
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
        resumeElevatorDirection: null,
      });
      persistCurrentTrip();
      return true;
    },

    loadSaveSlots: async () => {
      // Read-only refresh: every mutating flow (moves, buys, gear, cash-out,
      // slot switches) persists the trip itself, so no write happens here.
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
      // Read-only refresh (F-070): the full-trip serialization to
      // localStorage on every dialog open and silent revalidate was pure
      // overhead; mutating flows persist the trip themselves.
      let current = get().accountSync;
      if (!options.silent) {
        set({
          accountSync: {
            ...current,
            state: "loading",
          },
        });
      }
      const res = await loadRemoteAccountStatus();
      // Re-read after the await so an error branch preserves any newer state a
      // concurrent account-sync call wrote instead of clobbering it with a
      // pre-await snapshot.
      current = get().accountSync;
      if (res.status === 503) {
        set({ accountSync: unavailableAccountSync(current) });
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
    },

    startAccountSignIn: async (returnTo = "/mine") => {
      let current = get().accountSync;
      if (!current.providerStatus.ready) {
        set({
          accountSync: {
            ...current,
            state: "error",
            message: "Google sign-in pending",
          },
        });
        return null;
      }
      if (!(await gateOnTripCheckpoint())) return null;
      current = get().accountSync;
      set({
        accountSync: {
          ...current,
          state: "starting-sign-in",
        },
      });
      const res = await startRemoteAccountHandoff(returnTo);
      current = get().accountSync;
      if (res.status === 503) {
        set({ accountSync: unavailableAccountSync(current) });
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
      let current = get().accountSync;
      set({
        accountSync: {
          ...current,
          state: "finishing-sign-in",
        },
      });
      const res = await finishRemoteAccountHandoff(handoffId);
      current = get().accountSync;
      if (res.status === 503) {
        set({ accountSync: unavailableAccountSync(current) });
        return false;
      }
      if (!res.ok) {
        const code = accountErrorCode(res.body);
        if (res.status === 409) {
          if (code === "account_cloud_save_exists") {
            await get().loadAccountStatus();
            return false;
          }
          set({
            accountSync: {
              ...current,
              state: "error",
              message: accountErrorMessageFromResponse(
                res.body,
                "sign-in finish failed",
              ),
              code,
            },
          });
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
            code,
          },
        });
        return false;
      }
      await Promise.all([get().loadAccountStatus(), get().loadSaveSlots()]);
      return true;
    },

    claimAccountSave: async () => {
      if (!(await gateOnTripCheckpoint())) return false;
      let current = get().accountSync;
      set({
        accountSync: {
          ...current,
          state: "claiming",
        },
      });
      const res = await claimRemoteAccountSave();
      current = get().accountSync;
      if (res.status === 503) {
        set({ accountSync: unavailableAccountSync(current) });
        return false;
      }
      if (!res.ok) {
        const code = accountErrorCode(res.body);
        if (res.status === 409) {
          if (code === "device_save_linked_to_other_account") {
            set({
              accountSync: {
                ...current,
                state: "error",
                message: accountErrorMessageFromResponse(
                  res.body,
                  "claim failed",
                ),
                code,
              },
            });
            return false;
          }
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
            code,
          },
        });
        return false;
      }
      await Promise.all([get().loadAccountStatus(), get().loadSaveSlots()]);
      return true;
    },

    loadAccountSave: async () => {
      persistCurrentTrip();
      let current = get().accountSync;
      set({
        accountSync: {
          ...current,
          state: "loading-cloud",
        },
      });
      const res = await loadRemoteAccountSave();
      current = get().accountSync;
      if (res.status === 503) {
        set({ accountSync: unavailableAccountSync(current) });
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
      await refreshCloudWorld(nextSlot);
      current = get().accountSync;
      set({
        accountSync: {
          ...current,
          state: "ready",
          mode: "cloud_loaded",
          currentSave: parsed.accountSave,
          accountSave: parsed.accountSave,
        },
      });
      return true;
    },

    checkWorldFreshness: async (options = {}) => {
      const {
        accountSync,
        worldLoaded,
        saveConflict,
        cashOut,
        freshnessProbeInFlight,
        lastFreshnessProbeAt,
      } = get();
      // Only a cloud-linked save can advance on another device.
      if (!worldLoaded || accountSync.mode !== "cloud_loaded") return;
      if (saveConflict !== "none") return;
      if (cashOut.state === "pending") return;
      if (freshnessProbeInFlight) return;
      const now = Date.now();
      // A forced probe (a peer tab just banked) skips the lifecycle throttle.
      if (
        !options.force &&
        now - lastFreshnessProbeAt < FRESHNESS_PROBE_MIN_INTERVAL_MS
      ) {
        return;
      }
      set({ freshnessProbeInFlight: true, lastFreshnessProbeAt: now });
      let version: MineWorldVersion | null = null;
      try {
        const res = await loadMineWorldVersion();
        // Offline or signed out is not a conflict signal.
        if (!res.ok) return;
        version = worldVersionFromResponse(res.body);
      } finally {
        set({ freshnessProbeInFlight: false });
      }
      if (!version) return;
      const { seed: localSeed, tripIndex, moves } = get();
      if (version.seed === localSeed && version.tripCount === tripIndex) {
        return;
      }
      if (get().saveConflict !== "none") return;
      if (surfaceOnlyLog(moves)) {
        // No real progress on this device: adopt the newer save silently.
        await refreshCloudWorld(get().activeSlot);
        return;
      }
      set({ saveConflict: "prompt" });
    },

    resolveSaveConflict: async (choice) => {
      if (get().saveConflict === "none") return;
      if (choice === "keep") {
        set({ saveConflict: "dismissed" });
        return;
      }
      set({ saveConflict: "none" });
      await refreshCloudWorld(get().activeSlot);
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
      const { cashOut, mine, moves, pendingBunker, seed } = get();
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
      // Seed the mineable blocks from the trip seed + footprint so the
      // client preview and the server bank credit agree (F-116).
      const bunker = createBunker(
        footprint,
        deriveBunkerBlockSeed(seed, footprint),
      );
      set({
        pendingBunker: {
          claimCol: col,
          claimRow: row,
          claimedAtMoveCount: moves.length,
          bunker,
          inventory: { ...STARTER_BASE_PART_INVENTORY },
        },
        bunkerReplayFootprint: footprint,
        shopNote: "bunker claimed; bank at surface to save it",
      });
      persistCurrentTrip();
      // Claiming a bunker is exactly the progress worth not losing to a
      // reload, so it checks in immediately rather than waiting for the
      // action cadence.
      checkpointTripInBackground();
      return true;
    },

    placePendingBunkerPart: (
      partId,
      col,
      row,
      depth = 0,
      slot,
      orientation,
    ) => {
      const pending = get().pendingBunker;
      if (!pending || get().cashOut.state === "pending") return false;
      const placed = placeBasePart(
        pending.bunker,
        pending.inventory,
        partId,
        col,
        row,
        depth,
        slot,
        orientation,
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

    removePendingBunkerPart: (col, row, depth = 0, slot) => {
      const pending = get().pendingBunker;
      if (!pending || get().cashOut.state === "pending") return false;
      const removed = removeBasePart(
        pending.bunker,
        pending.inventory,
        col,
        row,
        depth,
        slot,
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

    movePendingBunkerPart: (
      fromCol,
      fromRow,
      toCol,
      toRow,
      fromDepth = 0,
      toDepth = 0,
    ) => {
      const pending = get().pendingBunker;
      if (!pending || get().cashOut.state === "pending") return false;
      const moved = moveBasePart(
        pending.bunker,
        fromCol,
        fromRow,
        toCol,
        toRow,
        fromDepth,
        toDepth,
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

    excavatePendingBunkerCell: (col, row, depth) => {
      const { mine, moves, tick, cashOut, pendingBunker: pending } = get();
      if (!pending || cashOut.state === "pending") return false;
      const dug = excavateBunkerCell(pending.bunker, col, row, depth);
      if (!dug.ok) return false;
      // Bunker digging is part of the trip (F-214): the drop rides the SAME
      // shared bag as mine ore via a logged bunker-dig action, positioned in
      // the log so client and server rebuild the identical bag, and pays only
      // at the surface bank. This matches the banked path; the holder is the
      // just-dug pending bunker, and any overflow spills to its loot.
      const holder = { current: dug.bunker };
      const action = bunkerDigAction({ col, row, depth });
      const result = applyAction(mine, action, { bunker: holder });
      if (!result.ok) return false;
      moves.push(action);
      set({
        pendingBunker: { ...pending, bunker: holder.current },
        tick: tick + 1,
        lastResult: result,
        lastAction: null,
      });
      persistCurrentTrip();
      checkpointTripOnCadence(moves.length);
      return true;
    },

    recordBankedBunkerDig: (bunker, col, row, depth) => {
      const { mine, tick, moves, cashOut } = get();
      // Digging during a pending cash-out would be discarded on success, the
      // same guard `move` uses.
      if (cashOut.state === "pending") return false;
      // Credit the drop into the SHARED trip bag at this exact log position,
      // so the server's bank replay rebuilds the identical bag. The holder is
      // throwaway on the client (the banked bunker's structure is server
      // authoritative); only the bag credit and the logged action matter.
      const holder = { current: bunker };
      const action = bunkerDigAction({ col, row, depth });
      const result = applyAction(mine, action, { bunker: holder });
      if (!result.ok) return false;
      moves.push(action);
      set({ tick: tick + 1, lastResult: result, lastAction: null });
      persistCurrentTrip();
      // A bunker-dig is a logged trip action too, so it advances the same
      // check-in cadence; without this a pure in-bunker dig session (all
      // bunker-dig actions, no `move`) would never check in.
      checkpointTripOnCadence(moves.length);
      return true;
    },

    resetPendingBunker: () => {
      const pending = get().pendingBunker;
      if (!pending || get().cashOut.state === "pending") return false;
      const reset = applyBunkerReset(pending.bunker, pending.inventory);
      set({
        pendingBunker: {
          ...pending,
          bunker: reset.bunker,
          inventory: reset.inventory,
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
        if (
          isTripAlreadyCashedOut(body) &&
          get().accountSync.mode === "cloud_loaded"
        ) {
          // Another device banked first; the run cannot be merged. Route
          // the failure into the save-conflict flow instead of a raw error
          // (re-prompts even after an earlier "Keep playing").
          set({ cashOut: { state: "idle" }, saveConflict: "prompt" });
          return false;
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
      enqueueStampAlertsFromResponse(body);
      // The world persists (REQ-026): the next trip resumes the SAME
      // carved mine. Server-owned stock wins after cash-out so stale
      // local support snapshots cannot leak into the next trip.
      const remaining: MineConsumables =
        consumablesFromResponse(body.consumables) ??
        addConsumables(carryoverConsumables(get().mine), get().bought);
      const worldDiff = Array.isArray(body.diff)
        ? (body.diff as WorldDiff)
        : exportDiff(get().mine);
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
      clearAccountTripCheckpoint();
      // Peer tabs in this browser resync instantly; other devices get the
      // server's save-sync push.
      notifySaveSyncPeers();
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
        resumeElevatorDirection: null,
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
      enqueueStampAlertsFromResponse(body);
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
      enqueueStampAlertsFromResponse(body);
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

    buyElevator: async (column) => {
      const { cashOut, mine, moves: currentMoves } = get();
      const relocating =
        get().elevatorPlacementRequired && mine.gear.elevator > 0;
      if (cashOut.state === "pending") return false;
      // Gate every rail mutation at the authority boundary, not just the stall
      // button: a prior conflict whose refresh failed left the local rail known
      // stale, so any buy (extend, first-rail placement, or relocation, and via
      // any surface: stall, placement overlay, keyboard, gamepad) must wait for
      // an explicit retryRailResync rather than fire a blind buy against it.
      // railResyncInFlight also blocks a buy that yields in while an earlier
      // conflict's refresh is still running, so no duplicate upgrade POST slips
      // through the async window (F-121 re-entrancy).
      if (get().railResyncFailed || get().railResyncInFlight) {
        set({ shopNote: "refresh the rail before buying" });
        return false;
      }
      persistCurrentTrip();
      if (mine.miner.row !== 0) {
        set({ shopNote: "return to the surface to extend the rail" });
        return false;
      }
      if (!surfaceOnlyLog(currentMoves)) {
        const banked = await get().submitCashOut();
        if (!banked) return false;
      }
      const res = await buyRemoteElevator(column, get().gear.elevator);
      if (res.status === 503) {
        set({ shopNote: "the tower ledger is offline; nothing was charged" });
        return false;
      }
      if (!res.ok) {
        const body = res.body as Record<string, unknown> | null;
        const code = body && typeof body.code === "string" ? body.code : null;
        // A conflict reject means another request already moved the world under
        // this client, so the local trip is out of date. That covers a moved
        // rail, a moved checkpoint, a bare lost guarded race (an unknown
        // winner), AND a duplicate-request replay (the original buy committed and
        // advanced the world, so the response's authoritative gear/trip index do
        // not match the stale local world): all run one bounded authoritative
        // refetch that drops the local trip and rebuilds the world, gear,
        // balance, trip index, and supports from the server as one checkpoint,
        // never a partial inventory-only merge that would persist new gear over a
        // stale world (F-121). buyElevator already banked any non-surface log
        // before the request, so dropping the surface-only trip loses nothing.
        // The note only claims "refreshed" when both authoritative reads land; a
        // failed fetch fails fast into a reopen prompt rather than leaving stale
        // controls under a false success.
        if (
          code === "elevator-stale-rail-state" ||
          code === "elevator-stale-checkpoint" ||
          code === "elevator-concurrent-loss" ||
          code === "elevator-duplicate-request"
        ) {
          // resyncCloudWorld OWNS the block marker and railResyncFailed for the
          // slot it reconciles (raised up front for durability, finalized once
          // when the chain settles), so the conflict path only reads the result
          // to pick a note. The slot is captured inside the action, not here, so
          // an activeSlot drift cannot split the up-front and final writes.
          const synced = await resyncCloudWorld(get().activeSlot);
          set({
            shopNote: synced
              ? elevatorConflictNote(code)
              : "couldn't refresh the rail; tap Retry to refresh",
            tick: get().tick + 1,
          });
          return false;
        }
        // The remaining codes do not move the world checkpoint: insufficient
        // balance (the guarded write lost only on the price gate, and tripIndex
        // is confirmed in sync, else it classified as stale-checkpoint above)
        // and the rail already at the bottom. The world stays in step with the
        // local trip, so the rail depth, trip index, and base diff are NOT
        // rewritten. Adopt the authoritative balance and, when the reject
        // carries the full inventory (a concurrent player-only purchase can
        // change a non-rail gear or consumable count at this same tripIndex),
        // adopt gear and consumables too by rebuilding the surface trip over the
        // unchanged world so the store's inventory stays in step with the live
        // mine (F-121). buyElevator runs at the surface with a surface-only log,
        // so that rebuild is replay-identical; the adopted rail depth equals the
        // local one for both codes, so no rail desync is possible.
        if (code !== null) {
          const nextBalance =
            body && typeof body.balance === "number"
              ? body.balance
              : get().balance;
          const authoritative = body
            ? authoritativeInventoryFromResponse(body)
            : null;
          const { moves: rejectMoves, seed: rejectSeed } = get();
          if (authoritative && surfaceOnlyLog(rejectMoves)) {
            const rebuilt = createMine(
              rejectSeed,
              authoritative.gear,
              authoritative.consumables,
              get().tripBaseDiff,
            );
            for (const m of rejectMoves) applyAction(rebuilt, m);
            set({
              gear: authoritative.gear,
              consumables: authoritative.consumables,
              bought: NO_CONSUMABLES,
              mine: rebuilt,
              balance: nextBalance,
              shopNote: elevatorConflictNote(code),
              tick: get().tick + 1,
            });
            persistCurrentTrip();
            return false;
          }
          set({
            balance: nextBalance,
            shopNote: elevatorConflictNote(code),
            tick: get().tick + 1,
          });
          return false;
        }
        set({
          shopNote:
            body && typeof body.error === "string"
              ? body.error
              : "purchase failed",
        });
        return false;
      }
      const body = res.body as Record<string, unknown>;
      enqueueStampAlertsFromResponse(body);
      const { gear, consumables, bought, moves, seed: s0, tick } = get();
      const elevator = body.elevator as number;
      // Adopt the full authoritative inventory when the accepted response
      // carries it (F-121), validated and coherence-checked as one atomic unit.
      // A concurrent player-only purchase at this same trip could have changed a
      // non-rail gear or consumable count, so rebuild the trip from the
      // committed server row rather than the local snapshot plus the rail delta.
      // A missing (older server) or malformed body yields null; the client then
      // still adopts the valid top-level rail scalars and keeps its last-known
      // good non-rail inventory rather than persist a partial or corrupt one.
      const authoritative = authoritativeInventoryFromResponse(body);
      const nextElevatorColumn =
        typeof body.elevatorColumn === "number"
          ? body.elevatorColumn
          : elevatorColumn(gear);
      if (nextElevatorColumn === null) {
        set({ shopNote: "choose a surface column for the first rail" });
        return false;
      }
      const nextGear: MineGear = authoritative
        ? {
            ...authoritative.gear,
            elevator,
            elevatorColumn: nextElevatorColumn,
          }
        : { ...gear, elevator, elevatorColumn: nextElevatorColumn };
      const nextTripIndex =
        typeof body.tripIndex === "number" ? body.tripIndex : get().tripIndex;
      const relocationConfirmed = body.relocated === true || relocating;
      const fallbackRefund = installElevatorRailInDiff(
        get().tripBaseDiff,
        nextElevatorColumn,
        relocationConfirmed ? 0 : gear.elevator,
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
      // The headline moment deserves its own line: a first purchase installed
      // the whole starter shaft, not an extension of existing rail.
      const extendNote =
        gear.elevator <= 0
          ? `starter shaft installed, ${elevator} rows deep`
          : `rail extended to ${elevator} deep`;
      // Adopt the authoritative consumables (F-121). The full inventory already
      // folds in the support refund and any concurrent change, so it replaces
      // local stock wholesale. Older servers omit it; fall back to the local
      // merge that adopts only the returned support counts (which likewise fold
      // the refund, so a lost-success retry cannot double-count them) or, on the
      // oldest servers, adds the refund to local stock.
      let owned: MineConsumables;
      if (authoritative) {
        owned = authoritative.consumables;
      } else {
        owned = addConsumables(consumables, bought);
        if (typeof body.ladders === "number") {
          owned.ladder = body.ladders;
        } else {
          owned.ladder += refundedLadders;
        }
        if (typeof body.planks === "number") {
          owned.plank = body.planks;
        } else {
          owned.plank += refundedPlanks;
        }
      }
      if (surfaceOnlyLog(moves)) {
        // Same rule as gear: rail applies to the live trip only while
        // the log is pure surface walks (replay-identical).
        const rebuilt = createMine(s0, nextGear, owned, nextBaseDiff);
        for (const m of moves) applyAction(rebuilt, m);
        saveLocalTrip(get().activeSlot, {
          mineVersion: MINE_VERSION,
          seed: s0,
          tripIndex: nextTripIndex,
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
          tripIndex: nextTripIndex,
          balance: typeof body.balance === "number" ? body.balance : null,
          elevatorPlacementRequired: false,
          railResyncFailed: false,
          shopNote: relocationConfirmed
            ? `shaft moved to column ${nextElevatorColumn}${refundNote}`
            : `${extendNote}${refundNote}`,
          tick: tick + 1,
        });
      } else {
        set({
          gear: nextGear,
          consumables: owned,
          bought: NO_CONSUMABLES,
          tripIndex: nextTripIndex,
          balance: typeof body.balance === "number" ? body.balance : null,
          elevatorPlacementRequired: false,
          railResyncFailed: false,
          shopNote: relocationConfirmed
            ? `shaft moved to column ${nextElevatorColumn}${refundNote}; rides start next trip`
            : `${extendNote}${refundNote}; rides start next trip`,
          tick: tick + 1,
        });
        persistCurrentTrip();
      }
      // An accepted buy adopted authoritative state, so clear any persisted
      // stale-rail block (F-121 reload-durable); both success branches above
      // already cleared it in memory.
      saveRailResyncBlock(get().activeSlot, false);
      notifySaveSyncPeers();
      return true;
    },

    retryRailResync: async () => {
      // Nothing to reconcile only when neither a block is set NOR a refresh is
      // already running: during the automatic conflict resync the flag is still
      // false until the chain settles, so a direct Retry racing that chain must
      // still proceed and JOIN the in-flight refresh (via the slot-matched
      // single-flight) rather than claim success without reconciling (F-121).
      if (!get().railResyncFailed && !get().railResyncInFlight) return true;
      // resyncCloudWorld OWNS the block marker and railResyncFailed for the slot
      // it reconciles, so Retry only reads the result to pick a note. A direct
      // Retry racing an in-flight refresh joins the single global action and
      // shares its result rather than starting a parallel chain (F-121).
      const synced = await resyncCloudWorld(get().activeSlot);
      set({
        shopNote: synced
          ? "rail refreshed; you can buy again"
          : "still couldn't refresh the rail; check your connection",
        tick: get().tick + 1,
      });
      return synced;
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
      clearAccountTripCheckpoint();
      set({
        mine: rebuilt,
        moves: [],
        pendingBunker: null,
        balance: typeof body.balance === "number" ? body.balance : null,
        shopNote: `teleported to base for ${price} vibes`,
        tick: tick + 1,
        lastResult: null,
        lastAction: null,
        resumeElevatorDirection: null,
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
        resumeElevatorDirection: null,
        cashOut: { state: "idle" },
      });
    },
  };
});
