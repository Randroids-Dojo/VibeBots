import { create } from "zustand";
import { ACHIEVEMENT_BY_ID } from "@/lib/achievements";

/**
 * Queue of freshly collected stamps waiting for their collect alert
 * (REQ-032). Award responses report `newStamps` ids; every panel that
 * performs an awarding action feeds this queue and the alert overlay
 * drains it one stamp at a time.
 */

/** The validated `newStamps` list from an award response body. */
export function newStampsFromResponse(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const raw = (body as { newStamps?: unknown }).newStamps;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (id): id is string => typeof id === "string" && ACHIEVEMENT_BY_ID.has(id),
  );
}

interface StampAlertState {
  /** Achievement ids waiting to be announced, oldest first. */
  queue: string[];
  /** Ids must be pre-validated (newStampsFromResponse); this only dedupes. */
  enqueueStampAlerts: (ids: readonly string[]) => void;
  /** Drops the stamp currently on screen, advancing to the next one. */
  shiftStampAlert: () => void;
}

export const useStampAlertStore = create<StampAlertState>((set) => ({
  queue: [],
  enqueueStampAlerts: (ids) =>
    set((state) => {
      const queue = [...state.queue];
      for (const id of ids) {
        if (!queue.includes(id)) queue.push(id);
      }
      return queue.length > state.queue.length ? { queue } : state;
    }),
  shiftStampAlert: () => set((state) => ({ queue: state.queue.slice(1) })),
}));

/** One-liner for award-response call sites. */
export function enqueueStampAlertsFromResponse(body: unknown): void {
  const stamps = newStampsFromResponse(body);
  if (stamps.length) {
    useStampAlertStore.getState().enqueueStampAlerts(stamps);
  }
}
