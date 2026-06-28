import { create } from "zustand";
import {
  type BasePartId,
  type BasePartInventory,
  type BunkerRaidRewardReport,
  type BunkerRaidSnapshot,
  type BunkerState,
  EMPTY_BASE_PART_INVENTORY,
} from "@/sim/bunker";

export interface BunkerPlayerProgress {
  balance: number;
  trackXp: number;
  defenseXp: number;
  overallLevel: number;
  levelCap: number;
  progressXp: number;
  neededXp: number;
  nextLevelXp: number | null;
  beaconLimit: number;
}

interface BunkerResponse {
  bunker: BunkerState | null;
  inventory: BasePartInventory;
  activeRaid: BunkerRaidSnapshot | null;
  player: BunkerPlayerProgress;
  raid?: BunkerRaidSnapshot;
  reward?: BunkerRaidRewardReport;
}

type BunkerMutationResult = BunkerResponse | null;
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
  body: BunkerResponse,
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

async function readResponse(res: Response): Promise<BunkerResponse | null> {
  if (!res.ok) return null;
  return (await res.json()) as BunkerResponse;
}

async function mutation(
  set: (state: Partial<BunkerStoreState>) => void,
  url: string,
  body?: unknown,
): Promise<BunkerMutationResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? "{}" : JSON.stringify(body),
    });
    if (res.status === 503) {
      set({ status: "unavailable", note: "bunker ledger offline" });
      return null;
    }
    const parsed = await readResponse(res);
    if (!parsed) {
      const error = await res.json().catch(() => ({}));
      set({
        status: "error",
        note:
          typeof error.error === "string"
            ? error.error
            : "bunker action failed",
      });
      return null;
    }
    applyResponse(set, parsed);
    return parsed;
  } catch {
    set({ status: "error", note: "bunker action failed" });
    return null;
  }
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
    try {
      const res = await fetch("/api/bunker");
      if (res.status === 503) {
        set({ status: "unavailable", note: "bunker ledger offline" });
        return;
      }
      const body = await readResponse(res);
      if (!body) {
        set({ status: "error", note: "could not load bunker" });
        return;
      }
      applyResponse(set, body);
    } catch {
      set({ status: "error", note: "could not load bunker" });
    }
  },

  claimBunker: (col, row) => mutation(set, "/api/bunker/claim", { col, row }),
  buyBasePart: (partId, quantity = 1) =>
    mutation(set, "/api/bunker/parts/buy", { partId, quantity }),
  placePart: (partId, col, row) =>
    mutation(set, "/api/bunker/parts/place", { partId, col, row }),
  removePart: (col, row) =>
    mutation(set, "/api/bunker/parts/remove", { col, row }),
  movePart: (fromCol, fromRow, toCol, toRow) =>
    mutation(set, "/api/bunker/parts/move", {
      fromCol,
      fromRow,
      toCol,
      toRow,
    }),
  startRaid: () => mutation(set, "/api/bunker/raid/start", { tier: 1 }),
  collectRaidPickup: (col, row) =>
    mutation(set, "/api/bunker/raid/collect", { col, row }),
  finishRaid: () => mutation(set, "/api/bunker/raid/finish"),
}));
