import { create } from "zustand";
import {
  type BasePartId,
  type BasePartInventory,
  type BunkerRaidSnapshot,
  type BunkerState,
  EMPTY_BASE_PART_INVENTORY,
} from "@/sim/bunker";

export interface BunkerPlayerProgress {
  balance: number;
  trackXp: number;
  defenseXp: number;
  overallLevel: number;
}

interface BunkerResponse {
  bunker: BunkerState | null;
  inventory: BasePartInventory;
  activeRaid: BunkerRaidSnapshot | null;
  player: BunkerPlayerProgress;
}

type BunkerStoreStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

export interface BunkerStoreState {
  status: BunkerStoreStatus;
  bunker: BunkerState | null;
  inventory: BasePartInventory;
  activeRaid: BunkerRaidSnapshot | null;
  player: BunkerPlayerProgress | null;
  note: string | null;
  loadBunker: () => Promise<void>;
  claimBunker: (col: number, row: number) => Promise<void>;
  buyBasePart: (partId: BasePartId, quantity?: number) => Promise<void>;
  placePart: (partId: BasePartId, col: number, row: number) => Promise<void>;
  removePart: (col: number, row: number) => Promise<void>;
  startRaid: () => Promise<void>;
  finishRaid: () => Promise<void>;
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
): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? "{}" : JSON.stringify(body),
    });
    if (res.status === 503) {
      set({ status: "unavailable", note: "bunker ledger offline" });
      return;
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
      return;
    }
    applyResponse(set, parsed);
  } catch {
    set({ status: "error", note: "bunker action failed" });
  }
}

export const useBunkerStore = create<BunkerStoreState>((set) => ({
  status: "idle",
  bunker: null,
  inventory: { ...EMPTY_BASE_PART_INVENTORY },
  activeRaid: null,
  player: null,
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
  startRaid: () => mutation(set, "/api/bunker/raid/start", { tier: 1 }),
  finishRaid: () => mutation(set, "/api/bunker/raid/finish"),
}));
