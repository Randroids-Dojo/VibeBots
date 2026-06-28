import { create } from "zustand";
import type {
  BunkerPlayerProgress,
  BunkerRouteResponse,
} from "@/lib/bunker-api-types";
import {
  type BasePartId,
  type BasePartInventory,
  type BunkerRaidRewardReport,
  type BunkerRaidSnapshot,
  type BunkerState,
  EMPTY_BASE_PART_INVENTORY,
} from "@/sim/bunker";
import {
  type BunkerApiResult,
  bunkerErrorMessage,
  buyRemoteBasePart,
  claimRemoteBunker,
  collectRemoteRaidPickup,
  finishRemoteBunkerRaid,
  loadRemoteBunker,
  moveRemoteBunkerPart,
  placeRemoteBunkerPart,
  removeRemoteBunkerPart,
  startRemoteBunkerRaid,
} from "./bunker-api-client";

type BunkerMutationResult = BunkerRouteResponse | null;
type BunkerStoreStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

export interface BunkerStoreState {
  status: BunkerStoreStatus;
  bunker: BunkerState | null;
  inventory: BasePartInventory;
  activeRaid: BunkerRaidSnapshot | null;
  player: BunkerPlayerProgress | null;
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
  ) => Promise<BunkerMutationResult>;
  removePart: (col: number, row: number) => Promise<BunkerMutationResult>;
  movePart: (
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
  ) => Promise<BunkerMutationResult>;
  startRaid: () => Promise<BunkerMutationResult>;
  collectRaidPickup: (
    col: number,
    row: number,
  ) => Promise<BunkerMutationResult>;
  finishRaid: () => Promise<BunkerMutationResult>;
}

function applyResponse(
  set: (state: Partial<BunkerStoreState>) => void,
  body: BunkerRouteResponse,
) {
  set({
    status: "ready",
    bunker: body.bunker,
    inventory: body.inventory,
    activeRaid: body.activeRaid,
    player: body.player,
    lastRaidReward: body.reward ?? null,
    note: null,
  });
}

function applyMutationResult(
  set: (state: Partial<BunkerStoreState>) => void,
  result: BunkerApiResult,
  fallback: string,
): BunkerMutationResult {
  if (result.status === 503) {
    set({ status: "unavailable", note: "bunker ledger offline" });
    return null;
  }
  if (!result.ok) {
    set({
      status: "error",
      note: bunkerErrorMessage(result.body, fallback),
    });
    return null;
  }
  applyResponse(set, result.body);
  return result.body;
}

export const useBunkerStore = create<BunkerStoreState>((set) => ({
  status: "idle",
  bunker: null,
  inventory: { ...EMPTY_BASE_PART_INVENTORY },
  activeRaid: null,
  player: null,
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
    applyResponse(set, result.body);
  },

  claimBunker: async (col, row) =>
    applyMutationResult(
      set,
      await claimRemoteBunker(col, row),
      "bunker action failed",
    ),
  buyBasePart: async (partId, quantity = 1) =>
    applyMutationResult(
      set,
      await buyRemoteBasePart(partId, quantity),
      "bunker action failed",
    ),
  placePart: async (partId, col, row) =>
    applyMutationResult(
      set,
      await placeRemoteBunkerPart(partId, col, row),
      "bunker action failed",
    ),
  removePart: async (col, row) =>
    applyMutationResult(
      set,
      await removeRemoteBunkerPart(col, row),
      "bunker action failed",
    ),
  movePart: async (fromCol, fromRow, toCol, toRow) =>
    applyMutationResult(
      set,
      await moveRemoteBunkerPart(fromCol, fromRow, toCol, toRow),
      "bunker action failed",
    ),
  startRaid: async () =>
    applyMutationResult(
      set,
      await startRemoteBunkerRaid(),
      "bunker action failed",
    ),
  collectRaidPickup: async (col, row) =>
    applyMutationResult(
      set,
      await collectRemoteRaidPickup(col, row),
      "bunker action failed",
    ),
  finishRaid: async () =>
    applyMutationResult(
      set,
      await finishRemoteBunkerRaid(),
      "bunker action failed",
    ),
}));
