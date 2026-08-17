"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { MoveResult } from "@/sim/mine";
import { useMineStore } from "@/state/mine-store";

import type { MotionTrack } from "./mine-motion";

export interface FallWindow {
  key: number;
  col: number;
  fromRow: number;
  toRow: number;
  fell: number;
  /**
   * Row the render window and the lantern are centred on while the
   * playback runs. A fall travels further than the loaded window is tall,
   * so anchoring on `toRow` for the whole playback culled everything above
   * `toRow - renderWindow.above` and opened a black void where the top of
   * the shaft should be. The frame loop walks this down after the bot, in
   * FALL_ANCHOR_STEP_ROWS steps, so the window streams with the fall
   * instead of covering the whole span at once.
   */
  anchorRow: number;
}

export interface FallPlayback extends FallWindow {
  kind: "fall" | "crush" | "powerdown";
  track: MotionTrack | null;
  impacted: boolean;
  doneAt: number | null;
}

/** How far the bot falls before the render window re-centres on it. Must
 * stay under mineRenderWindow's `above` AND `below`: under `below` so the
 * rows the bot falls into are loaded before it reaches them, under
 * `above` so the rows it just left stay drawn between steps. */
export const FALL_ANCHOR_STEP_ROWS = 4;

/** Pure step rule for the streaming anchor: the next anchor row, or null
 * while the bot is still inside the current step. A step lands ON the
 * bot's rendered row (not anchor + step) so a stalled frame that skipped
 * several rows re-centres the window on the bot immediately instead of
 * trailing it, capped at the impact row. Null on every pre-step frame
 * keeps the useFrame reject path allocation-free. */
export function nextFallAnchorRow(
  anchorRow: number,
  toRow: number,
  row: number,
): number | null {
  if (row < anchorRow + FALL_ANCHOR_STEP_ROWS) return null;
  return Math.min(row, toRow);
}

export const FATAL_FALL_HOLD_SECONDS = 0.38;
export const CRUSH_HOLD_SECONDS = 3.6;
export const FATAL_FALL_SECONDS_PER_ROW = 0.11;

/** Out-of-battery power-down (F-058): the miner slumps in place at the
 * death spot before the trip report. The beat is the slump ramp; the hold
 * keeps the powered-down bot on camera under the report. */
export const POWER_DOWN_BEAT_SECONDS = 1.0;
export const POWER_DOWN_HOLD_SECONDS = 0.7;
export const POWER_DOWN_REPORT_AFTER_IMPACT_MS = 520;

export function fatalFallPlaybackSeconds(fell: number): number {
  return Math.max(0.42, fell * FATAL_FALL_SECONDS_PER_ROW);
}

/** Trip-report delay after the rendered impact frame. Sized against the
 * hold windows above: the fall report lands just past the short fall
 * hold; the crush report sits inside the long crush hold so the flattened
 * bot stays on camera under the report. */
export const FALL_REPORT_AFTER_IMPACT_MS = 430;
export const CRUSH_REPORT_AFTER_IMPACT_MS = 950;

/** Wall-clock report ceiling when the canvas never renders the impact
 * (context lost, hidden tab, scene error). Scales with the fall length
 * because long falls legitimately take fell * 0.11s to reach impact. */
export function wreckReportCeilingMs(fell: number | undefined): number {
  return 4000 + Math.ceil(fatalFallPlaybackSeconds(fell ?? 0) * 1000);
}

function fallPlaybackFromResult(
  result: MoveResult | null,
  key: number,
): FallPlayback | null {
  if (
    result?.ok &&
    result.collapsed &&
    result.fallFatal &&
    result.lost &&
    result.fell
  ) {
    const toRow = result.lost.row;
    const fromRow = Math.max(0, toRow - result.fell);
    return {
      key,
      kind: "fall",
      col: result.lost.col,
      fromRow,
      toRow,
      fell: result.fell,
      // The anchor starts at the top of the fall and streams down after
      // the bot (see FallWindow.anchorRow).
      anchorRow: fromRow,
      track: null,
      impacted: false,
      doneAt: null,
    };
  }
  if (result?.ok && result.collapsed && result.crushed && result.lost) {
    return {
      key,
      kind: "crush",
      col: result.lost.col,
      fromRow: result.lost.row,
      toRow: result.lost.row,
      fell: 0,
      anchorRow: result.lost.row,
      track: null,
      impacted: false,
      doneAt: null,
    };
  }
  // Out-of-battery death (F-058): collapsed with a loss, but not a fatal
  // fall, a crush, or a deliberate abandon. The miner powers down in place.
  if (
    result?.ok &&
    result.collapsed &&
    result.lost &&
    !result.fallFatal &&
    !result.crushed &&
    !result.abandoned
  ) {
    return {
      key,
      kind: "powerdown",
      col: result.lost.col,
      fromRow: result.lost.row,
      toRow: result.lost.row,
      fell: 0,
      anchorRow: result.lost.row,
      track: null,
      impacted: false,
      doneAt: null,
    };
  }
  return null;
}

function fallWindowFromPlayback(playback: FallPlayback): FallWindow {
  return {
    key: playback.key,
    col: playback.col,
    fromRow: playback.fromRow,
    toRow: playback.toRow,
    fell: playback.fell,
    anchorRow: playback.anchorRow,
  };
}

function clearMsForPlayback(playback: FallPlayback): number {
  if (playback.kind === "fall") {
    return Math.ceil(
      (fatalFallPlaybackSeconds(playback.fell) +
        FATAL_FALL_HOLD_SECONDS +
        0.4) *
        1000,
    );
  }
  if (playback.kind === "powerdown") {
    return Math.ceil(
      (POWER_DOWN_BEAT_SECONDS + POWER_DOWN_HOLD_SECONDS + 0.4) * 1000,
    );
  }
  return 4300;
}

/** Fallback clear window measured from the rendered impact, used when the
 * impact frame arrives later than the move-relative estimate assumed (a
 * frame-starved device). Must outlast the report-after-impact delays so
 * the wreck never vanishes before the report lands. */
export function clearMsAfterImpact(
  playback: Pick<FallPlayback, "kind">,
): number {
  if (playback.kind === "fall") {
    return Math.ceil(FATAL_FALL_HOLD_SECONDS * 1000) + 400;
  }
  if (playback.kind === "powerdown") {
    return Math.ceil(POWER_DOWN_HOLD_SECONDS * 1000) + 400;
  }
  return Math.ceil(CRUSH_HOLD_SECONDS * 1000) + 700;
}

export function useMineDeathPlaybackBridge(
  lastResult: MoveResult | null,
  tick: number,
): {
  fallPlayback: RefObject<FallPlayback | null>;
  fallWindow: FallWindow | null;
  clearFallPlayback: (key: number) => void;
  advanceFallAnchor: (row: number) => void;
} {
  const fallPlayback = useRef<FallPlayback | null>(null);
  const fallClearTimeout = useRef<number | null>(null);
  const impactUnsub = useRef<(() => void) | null>(null);
  const [fallWindow, setFallWindow] = useState<FallWindow | null>(null);

  const clearPendingTimeout = useCallback(() => {
    if (fallClearTimeout.current == null) return;
    window.clearTimeout(fallClearTimeout.current);
    fallClearTimeout.current = null;
  }, []);

  const clearImpactSubscription = useCallback(() => {
    impactUnsub.current?.();
    impactUnsub.current = null;
  }, []);

  const clearFallPlayback = useCallback(
    (key: number) => {
      // Timers and the impact subscription belong to the active playback;
      // a stale caller clearing an old key must not disarm them.
      if (fallPlayback.current === null || fallPlayback.current.key === key) {
        clearPendingTimeout();
        clearImpactSubscription();
        fallPlayback.current = null;
      }
      setFallWindow((prev) => (prev?.key === key ? null : prev));
    },
    [clearPendingTimeout, clearImpactSubscription],
  );

  // Called every frame of a fall, so the reject path must stay
  // allocation-free (frame-loop rule): the ref carries the live anchor and
  // only a real step allocates the state updater. Forward-only, so a
  // re-render that rebuilds the window cannot rewind the stream.
  const advanceFallAnchor = useCallback((row: number) => {
    const playback = fallPlayback.current;
    if (playback === null) return;
    const anchorRow = nextFallAnchorRow(
      playback.anchorRow,
      playback.toRow,
      row,
    );
    if (anchorRow === null) return;
    playback.anchorRow = anchorRow;
    setFallWindow((prev) =>
      prev?.key === playback.key ? { ...prev, anchorRow } : prev,
    );
  }, []);

  useEffect(
    () => () => {
      clearPendingTimeout();
      clearImpactSubscription();
    },
    [clearPendingTimeout, clearImpactSubscription],
  );

  useLayoutEffect(() => {
    return useMineStore.subscribe((state, prev) => {
      if (state.tick === prev.tick) return;
      const playback = fallPlaybackFromResult(state.lastResult, state.tick);
      if (playback) {
        fallPlayback.current = playback;
        setFallWindow(fallWindowFromPlayback(playback));
        // Ticks reset to 0 across trips, so a leftover impact mark from a
        // previous trip could collide with this playback's key. Every new
        // playback starts unmarked.
        useMineStore.getState().clearFallVisualMarks();
      } else if (!(state.lastResult?.ok && state.lastResult.collapsed)) {
        fallPlayback.current = null;
        setFallWindow(null);
      }
    });
  }, []);

  // The store subscription above is the pre-frame bridge. This tick effect
  // mirrors it for ordinary React updates and owns the fallback clear timer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the event stream; the result is read at the same tick.
  useLayoutEffect(() => {
    clearPendingTimeout();
    clearImpactSubscription();
    const playback = fallPlaybackFromResult(lastResult, tick);
    if (playback) {
      const activePlayback =
        fallPlayback.current?.key === playback.key
          ? fallPlayback.current
          : playback;
      fallPlayback.current = activePlayback;
      setFallWindow(fallWindowFromPlayback(activePlayback));
      const armClear = (delayMs: number) => {
        clearPendingTimeout();
        fallClearTimeout.current = window.setTimeout(() => {
          clearFallPlayback(activePlayback.key);
          fallClearTimeout.current = null;
        }, delayMs);
      };
      armClear(clearMsForPlayback(activePlayback));
      // A frame-starved device can render the impact later than the
      // move-relative estimate assumed; once the impact frame is real,
      // re-arm the fallback from the impact so the wreck never clears
      // before the impact-gated trip report lands.
      impactUnsub.current = useMineStore.subscribe((state) => {
        if (state.fallVisualImpactKey !== activePlayback.key) return;
        clearImpactSubscription();
        armClear(clearMsAfterImpact(activePlayback));
      });
    } else if (!(lastResult?.ok && lastResult.collapsed)) {
      fallPlayback.current = null;
      setFallWindow(null);
    }
  }, [tick]);

  return { fallPlayback, fallWindow, clearFallPlayback, advanceFallAnchor };
}
