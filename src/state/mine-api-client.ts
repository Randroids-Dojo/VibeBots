import {
  MINE_VERSION,
  type MineConsumables,
  type MineGearTrack,
} from "@/sim/mine";
import { type SaveSlotId, validSaveSlot } from "./mine-trip-persistence";

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

export type MineApiResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: unknown }
  | { ok: false; status: null; body: null };

async function mineApi<T>(
  url: string,
  init?: RequestInit,
): Promise<MineApiResult<T>> {
  try {
    const res = init === undefined ? await fetch(url) : await fetch(url, init);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
      if (res.ok) return { ok: false, status: res.status, body };
    }
    if (!res.ok) return { ok: false, status: res.status, body };
    return { ok: true, status: res.status, body: body as T };
  } catch {
    return { ok: false, status: null, body: null };
  }
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function deleteSaveSlotConfirmation(slot: SaveSlotId): string {
  return `DELETE SLOT ${slot}`;
}

export function saveSlotSummariesFromResponse(value: unknown): {
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

export function consumablesFromResponse(
  value: unknown,
): MineConsumables | null {
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

export function isMineVersionMismatch(body: unknown): boolean {
  return (
    Boolean(body) &&
    typeof body === "object" &&
    (body as Record<string, unknown>).code === "mine_version_mismatch"
  );
}

export function cashOutErrorMessage(body: unknown): string {
  if (isMineVersionMismatch(body)) {
    return "Mine updated. Your save is restored; start a fresh trip.";
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
  }
  return "cash out failed";
}

export function loadMineWorld() {
  return mineApi<unknown>("/api/mine/world");
}

export function loadMineGear() {
  return mineApi<unknown>("/api/gear");
}

export function loadSaveSlotSummaries() {
  return mineApi<unknown>("/api/save-slots");
}

export function switchRemoteSaveSlot(
  slot: SaveSlotId,
  options: { create?: boolean } = {},
) {
  return mineApi<unknown>(
    "/api/save-slots",
    jsonPost({ slot, create: options.create === true }),
  );
}

export function deleteRemoteSaveSlot(slot: SaveSlotId) {
  return mineApi<unknown>("/api/save-slots", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      slot,
      confirm: deleteSaveSlotConfirmation(slot),
    }),
  });
}

export function submitMineBank(body: {
  seed: number;
  tripIndex: number;
  moves: unknown;
  gear: unknown;
  consumables: unknown;
  pendingBunker?: unknown;
}) {
  return mineApi<unknown>(
    "/api/mine/bank",
    jsonPost({
      ...body,
      mineVersion: MINE_VERSION,
    }),
  );
}

export function buyRemoteConsumable(
  item: keyof MineConsumables,
  quantity: number,
) {
  return mineApi<unknown>("/api/consumables/buy", jsonPost({ item, quantity }));
}

export function buyRemoteGearUpgrade(track: MineGearTrack) {
  return mineApi<unknown>("/api/gear/upgrade", jsonPost({ track }));
}

export function buyRemoteElevator() {
  return mineApi<unknown>("/api/elevator/upgrade", { method: "POST" });
}

export function teleportRemoteBase(cost: number) {
  return mineApi<unknown>("/api/mine/base-teleport", jsonPost({ cost }));
}
