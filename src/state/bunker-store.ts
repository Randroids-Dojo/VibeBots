import { create } from "zustand";
import { apiErrorCode, BUNKER_REVISION_CONFLICT_CODE } from "@/lib/api-codes";
import type {
  BunkerPlayerProgress,
  BunkerRouteResponse,
  LiveRaidActiveView,
} from "@/lib/bunker-api-types";
import {
  type BasePartId,
  type BasePartInventory,
  type BunkerRaidRewardReport,
  type BunkerRaidSnapshot,
  type BunkerSkinId,
  type BunkerState,
  EMPTY_BASE_PART_INVENTORY,
} from "@/sim/bunker";
import type { LiveRaidOutcomeReport } from "@/sim/bunker-raid-live";
import {
  type BunkerApiResult,
  bunkerErrorMessage,
  buyRemoteBasePart,
  claimRemoteBunker,
  collectRemoteBunkerLoot,
  collectRemoteRaidPickup,
  excavateRemoteBunkerCell,
  finishRemoteBunkerRaid,
  forfeitRemoteLiveRaid,
  loadRemoteBunker,
  moveRemoteBunkerPart,
  placeRemoteBunkerPart,
  removeRemoteBunkerPart,
  repairRemoteBunker,
  resetRemoteBunker,
  resolveRemoteLiveRaid,
  setRemoteBunkerSkin,
  startRemoteBunkerRaid,
  startRemoteLiveBunkerRaid,
} from "./bunker-api-client";
import { enqueueStampAlertsFromResponse } from "./stamp-alert-store";

type BunkerMutationResult = BunkerRouteResponse | null;
type BunkerStoreStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

export interface BunkerStoreState {
  status: BunkerStoreStatus;
  bunker: BunkerState | null;
  inventory: BasePartInventory;
  activeRaid: BunkerRaidSnapshot | null;
  /** A live first-person raid in flight, frozen from a start snapshot
   * (Q-024 option D). Mutually exclusive with `activeRaid`; the client
   * fights it in the first-person canvas and resolves it. */
  activeLiveRaid: LiveRaidActiveView | null;
  player: BunkerPlayerProgress | null;
  /** Last server revision the store has adopted (F-122). Banked edits echo
   * it as `expectedRevision` and the store drops any response that would
   * move it backwards. */
  revision: number;
  lastRaidReward: BunkerRaidRewardReport | null;
  note: string | null;
  loadBunker: () => Promise<void>;
  claimBunker: (col: number, row: number) => Promise<BunkerMutationResult>;
  buyBasePart: (
    partId: BasePartId,
    quantity?: number,
  ) => Promise<BunkerMutationResult>;
  placePart: (
    partId: BasePartId,
    col: number,
    row: number,
    depth?: number,
  ) => Promise<BunkerMutationResult>;
  removePart: (
    col: number,
    row: number,
    depth?: number,
  ) => Promise<BunkerMutationResult>;
  movePart: (
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
    fromDepth?: number,
    toDepth?: number,
  ) => Promise<BunkerMutationResult>;
  excavateCell: (
    col: number,
    row: number,
    depth: number,
  ) => Promise<BunkerMutationResult>;
  collectLoot: (
    col: number,
    row: number,
    depth: number,
  ) => Promise<BunkerMutationResult>;
  startRaid: (tier?: number) => Promise<BunkerMutationResult>;
  /** Start a live first-person raid (opt-in `mode: "live"`); the
   * response carries the frozen `activeLiveRaid` snapshot to fight. */
  startLiveRaid: (tier?: number) => Promise<BunkerMutationResult>;
  /** Submit a fought live raid's bounded outcome to settle it. */
  resolveLiveRaid: (
    report: LiveRaidOutcomeReport,
  ) => Promise<BunkerMutationResult>;
  forfeitLiveRaid: () => Promise<BunkerMutationResult>;
  repairBunker: () => Promise<BunkerMutationResult>;
  resetBunker: () => Promise<BunkerMutationResult>;
  setSkin: (skinId: BunkerSkinId) => Promise<BunkerMutationResult>;
  collectRaidPickup: (
    col: number,
    row: number,
  ) => Promise<BunkerMutationResult>;
  finishRaid: () => Promise<BunkerMutationResult>;
}

type Getter = () => BunkerStoreState;
type Setter = (state: Partial<BunkerStoreState>) => void;

/**
 * Serialize banked edits so overlapping held strikes never race (F-122).
 * Each queued edit runs only after the previous one settles, so it reads
 * the freshest revision and sends it as `expectedRevision`; without this
 * a rapid burst would send one stale revision and the server would 409
 * every strike but the first. A rejected edit does not break the chain.
 */
let editChain: Promise<unknown> = Promise.resolve();

function serializeEdit<T>(task: () => Promise<T>): Promise<T> {
  const run = editChain.then(task, task);
  editChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * A revision-conflict 409 carries the full authoritative view (the server
 * spreads it into the error body under {@link BUNKER_REVISION_CONFLICT_CODE}),
 * so the client resyncs to it instead of just showing an error. Branching on
 * the shared code keeps this from guessing at the body shape (F-068, F-122).
 */
function conflictResyncView(body: unknown): BunkerRouteResponse | null {
  if (apiErrorCode(body) !== BUNKER_REVISION_CONFLICT_CODE) return null;
  return body as BunkerRouteResponse;
}

/**
 * Adopt a response into the store, unless it would move the revision
 * backwards: an earlier edit's reply arriving after a newer edit already
 * landed (F-122). Returns whether the response was adopted so callers do not
 * report success for a body the store dropped.
 */
function applyResponse(
  set: Setter,
  get: Getter,
  body: BunkerRouteResponse,
): boolean {
  if (body.revision < get().revision) return false;
  enqueueStampAlertsFromResponse(body);
  set({
    status: "ready",
    bunker: body.bunker,
    inventory: body.inventory,
    activeRaid: body.activeRaid,
    activeLiveRaid: body.activeLiveRaid ?? null,
    player: body.player,
    revision: body.revision,
    lastRaidReward: body.reward ?? null,
    note: null,
  });
  return true;
}

function applyMutationResult(
  set: Setter,
  get: Getter,
  result: BunkerApiResult,
  fallback: string,
): BunkerMutationResult {
  if (result.status === 503) {
    set({ status: "unavailable", note: "bunker ledger offline" });
    return null;
  }
  if (!result.ok) {
    // A revision conflict carries the authoritative view: adopt it so the
    // client resyncs to server truth, then report the edit as failed so a
    // retry runs against the fresh state.
    const resync = conflictResyncView(result.body);
    if (resync) {
      applyResponse(set, get, resync);
      return null;
    }
    set({
      status: "error",
      note: bunkerErrorMessage(result.body, fallback),
    });
    return null;
  }
  // Report success only when the store actually adopted the body; a response
  // dropped by the monotonic guard is superseded, not something to echo.
  return applyResponse(set, get, result.body) ? result.body : null;
}

export const useBunkerStore = create<BunkerStoreState>((set, get) => ({
  status: "idle",
  bunker: null,
  inventory: { ...EMPTY_BASE_PART_INVENTORY },
  activeRaid: null,
  activeLiveRaid: null,
  player: null,
  revision: 0,
  lastRaidReward: null,
  note: null,

  loadBunker: async () => {
    set({ status: "loading" });
    const result = await loadRemoteBunker();
    if (result.status === 503) {
      set({ status: "unavailable", note: "bunker ledger offline" });
      return;
    }
    if (!result.ok) {
      set({ status: "error", note: "could not load bunker" });
      return;
    }
    applyResponse(set, get, result.body);
  },

  claimBunker: async (col, row) =>
    applyMutationResult(
      set,
      get,
      await claimRemoteBunker(col, row),
      "bunker action failed",
    ),
  // Buy/collect/skin change the bunker view without bumping the revision, so
  // they join the same serialization chain as the banked edits: applied in
  // write order, their response can never be dropped by the monotonic guard
  // for carrying a revision a concurrent structural edit already advanced past
  // (F-122).
  buyBasePart: (partId, quantity = 1) =>
    serializeEdit(async () =>
      applyMutationResult(
        set,
        get,
        await buyRemoteBasePart(partId, quantity),
        "bunker action failed",
      ),
    ),
  // The four banked edits run through the serialization chain so a held
  // strike burst never overlaps writes; each reads the freshest revision
  // inside the queued task and echoes it as expectedRevision (F-122).
  placePart: (partId, col, row, depth = 0) =>
    serializeEdit(async () =>
      applyMutationResult(
        set,
        get,
        await placeRemoteBunkerPart(partId, col, row, depth, get().revision),
        "bunker action failed",
      ),
    ),
  removePart: (col, row, depth = 0) =>
    serializeEdit(async () =>
      applyMutationResult(
        set,
        get,
        await removeRemoteBunkerPart(col, row, depth, get().revision),
        "bunker action failed",
      ),
    ),
  movePart: (fromCol, fromRow, toCol, toRow, fromDepth = 0, toDepth = 0) =>
    serializeEdit(async () =>
      applyMutationResult(
        set,
        get,
        await moveRemoteBunkerPart(
          fromCol,
          fromRow,
          toCol,
          toRow,
          fromDepth,
          toDepth,
          get().revision,
        ),
        "bunker action failed",
      ),
    ),
  excavateCell: (col, row, depth) =>
    serializeEdit(async () =>
      applyMutationResult(
        set,
        get,
        await excavateRemoteBunkerCell(col, row, depth, get().revision),
        "bunker action failed",
      ),
    ),
  collectLoot: (col, row, depth) =>
    serializeEdit(async () =>
      applyMutationResult(
        set,
        get,
        await collectRemoteBunkerLoot(col, row, depth),
        "bunker action failed",
      ),
    ),
  repairBunker: async () =>
    applyMutationResult(
      set,
      get,
      await repairRemoteBunker(),
      "bunker action failed",
    ),
  resetBunker: async () =>
    applyMutationResult(
      set,
      get,
      await resetRemoteBunker(),
      "bunker action failed",
    ),
  setSkin: (skinId) =>
    serializeEdit(async () =>
      applyMutationResult(
        set,
        get,
        await setRemoteBunkerSkin(skinId),
        "bunker action failed",
      ),
    ),
  startRaid: async (tier = 1) =>
    applyMutationResult(
      set,
      get,
      await startRemoteBunkerRaid(tier),
      "bunker action failed",
    ),
  // Dependency (F-146, PR #218), safe while dark: these run outside the
  // serializeEdit chain and applyResponse adopts equal revisions, so a
  // loadBunker begun before a start can return afterward at the same
  // bunker revision (a live start inserts a raid row without bumping the
  // revision) and clear the just-adopted activeLiveRaid. Resolve them
  // under the global sequencing contract before the first-person raid
  // loop wires these to the UI.
  startLiveRaid: async (tier = 1) =>
    applyMutationResult(
      set,
      get,
      await startRemoteLiveBunkerRaid(tier),
      "bunker action failed",
    ),
  resolveLiveRaid: async (report) =>
    applyMutationResult(
      set,
      get,
      await resolveRemoteLiveRaid(report),
      "bunker action failed",
    ),
  forfeitLiveRaid: async () =>
    applyMutationResult(
      set,
      get,
      await forfeitRemoteLiveRaid(),
      "bunker action failed",
    ),
  collectRaidPickup: async (col, row) =>
    applyMutationResult(
      set,
      get,
      await collectRemoteRaidPickup(col, row),
      "bunker action failed",
    ),
  finishRaid: async () =>
    applyMutationResult(
      set,
      get,
      await finishRemoteBunkerRaid(),
      "bunker action failed",
    ),
}));
