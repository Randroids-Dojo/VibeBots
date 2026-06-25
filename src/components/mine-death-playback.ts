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

export interface DeathPlaybackMotionTrack {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAt: number;
  duration: number;
  frames: number;
}

export interface FallWindow {
  key: number;
  col: number;
  fromRow: number;
  toRow: number;
  fell: number;
}

export interface FallPlayback extends FallWindow {
  kind: "fall" | "crush";
  track: DeathPlaybackMotionTrack | null;
  impacted: boolean;
  doneAt: number | null;
}

export const FATAL_FALL_HOLD_SECONDS = 0.38;
export const CRUSH_HOLD_SECONDS = 3.6;

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
    return {
      key,
      kind: "fall",
      col: result.lost.col,
      fromRow: Math.max(0, toRow - result.fell),
      toRow,
      fell: result.fell,
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
  };
}

function clearMsForPlayback(playback: FallPlayback): number {
  return playback.kind === "fall"
    ? Math.min(1600, Math.max(850, 520 + playback.fell * 100))
    : 4300;
}

export function useMineDeathPlaybackBridge(
  lastResult: MoveResult | null,
  tick: number,
): {
  fallPlayback: RefObject<FallPlayback | null>;
  fallWindow: FallWindow | null;
  clearFallPlayback: (key: number) => void;
} {
  const fallPlayback = useRef<FallPlayback | null>(null);
  const fallClearTimeout = useRef<number | null>(null);
  const [fallWindow, setFallWindow] = useState<FallWindow | null>(null);

  const clearPendingTimeout = useCallback(() => {
    if (fallClearTimeout.current == null) return;
    window.clearTimeout(fallClearTimeout.current);
    fallClearTimeout.current = null;
  }, []);

  const clearFallPlayback = useCallback(
    (key: number) => {
      clearPendingTimeout();
      if (fallPlayback.current?.key === key) fallPlayback.current = null;
      setFallWindow((prev) => (prev?.key === key ? null : prev));
    },
    [clearPendingTimeout],
  );

  useEffect(() => () => clearPendingTimeout(), [clearPendingTimeout]);

  useLayoutEffect(() => {
    return useMineStore.subscribe((state, prev) => {
      if (state.tick === prev.tick) return;
      const playback = fallPlaybackFromResult(state.lastResult, state.tick);
      if (playback) {
        fallPlayback.current = playback;
        setFallWindow(fallWindowFromPlayback(playback));
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
    const playback = fallPlaybackFromResult(lastResult, tick);
    if (playback) {
      const activePlayback =
        fallPlayback.current?.key === playback.key
          ? fallPlayback.current
          : playback;
      fallPlayback.current = activePlayback;
      setFallWindow(fallWindowFromPlayback(activePlayback));
      fallClearTimeout.current = window.setTimeout(() => {
        clearFallPlayback(activePlayback.key);
        fallClearTimeout.current = null;
      }, clearMsForPlayback(activePlayback));
    } else if (!(lastResult?.ok && lastResult.collapsed)) {
      fallPlayback.current = null;
      setFallWindow(null);
    }
  }, [tick]);

  return { fallPlayback, fallWindow, clearFallPlayback };
}
