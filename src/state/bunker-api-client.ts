import type { BunkerRouteResponse } from "@/lib/bunker-api-types";
import type { BasePartId, BunkerSkinId } from "@/sim/bunker";
import type { LiveRaidOutcomeReport } from "@/sim/bunker-raid-live";

export type BunkerApiResult =
  | { ok: true; status: number; body: BunkerRouteResponse }
  | { ok: false; status: number; body: unknown }
  | { ok: false; status: null; body: null };

async function bunkerApi(
  url: string,
  init?: RequestInit,
): Promise<BunkerApiResult> {
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
    return { ok: true, status: res.status, body: body as BunkerRouteResponse };
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

export function bunkerErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
  }
  return fallback;
}

export function loadRemoteBunker() {
  return bunkerApi("/api/bunker");
}

export function claimRemoteBunker(col: number, row: number) {
  return bunkerApi("/api/bunker/claim", jsonPost({ col, row }));
}

export function buyRemoteBasePart(partId: BasePartId, quantity: number) {
  return bunkerApi("/api/bunker/parts/buy", jsonPost({ partId, quantity }));
}

export function placeRemoteBunkerPart(
  partId: BasePartId,
  col: number,
  row: number,
  depth = 0,
  expectedRevision?: number,
) {
  return bunkerApi(
    "/api/bunker/parts/place",
    jsonPost({ partId, col, row, depth, expectedRevision }),
  );
}

export function removeRemoteBunkerPart(
  col: number,
  row: number,
  depth = 0,
  expectedRevision?: number,
) {
  return bunkerApi(
    "/api/bunker/parts/remove",
    jsonPost({ col, row, depth, expectedRevision }),
  );
}

export function moveRemoteBunkerPart(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
  fromDepth = 0,
  toDepth = 0,
  expectedRevision?: number,
) {
  return bunkerApi(
    "/api/bunker/parts/move",
    jsonPost({
      fromCol,
      fromRow,
      toCol,
      toRow,
      fromDepth,
      toDepth,
      expectedRevision,
    }),
  );
}

export function excavateRemoteBunkerCell(
  col: number,
  row: number,
  depth: number,
  expectedRevision?: number,
) {
  return bunkerApi(
    "/api/bunker/excavate",
    jsonPost({ col, row, depth, expectedRevision }),
  );
}

export function collectRemoteBunkerLoot(
  col: number,
  row: number,
  depth: number,
) {
  return bunkerApi("/api/bunker/collect", jsonPost({ col, row, depth }));
}

export function repairRemoteBunker() {
  return bunkerApi("/api/bunker/repair", jsonPost({}));
}

export function resetRemoteBunker() {
  return bunkerApi("/api/bunker/reset", jsonPost({}));
}

/** Hard-reset a layout-incompatible bunker to a bare current-version claim
 * (F-117, Q-022): no refund, keeps the excavation, stamps the new layout
 * version so building is allowed again. */
export function startFreshRemoteBunker() {
  return bunkerApi("/api/bunker/start-fresh", jsonPost({}));
}

export function setRemoteBunkerSkin(skinId: BunkerSkinId) {
  return bunkerApi("/api/bunker/skin", jsonPost({ skinId }));
}

/** Start the live first-person raid (Q-024 option D), the only raid path: the
 * start route freezes a snapshot the client fights against and later resolves. */
export function startRemoteLiveBunkerRaid(tier = 1) {
  return bunkerApi("/api/bunker/raid/start", jsonPost({ tier }));
}

/** Submit the bounded outcome of a live raid the client just fought.
 * The server validates it against the frozen start snapshot before it
 * settles wear and rewards (single-submission guarded server-side). */
export function resolveRemoteLiveRaid(report: LiveRaidOutcomeReport) {
  return bunkerApi("/api/bunker/raid/resolve", jsonPost(report));
}

/** Forfeit the active live raid on demand (F-160): leaving first person
 * mid-raid abandons it now (no reward, no wear) so it cannot be re-rolled by
 * re-entering. Idempotent server-side; a raid that already resolved is a
 * no-op that just returns the current view. */
export function forfeitRemoteLiveRaid() {
  return bunkerApi("/api/bunker/raid/forfeit", jsonPost({}));
}
