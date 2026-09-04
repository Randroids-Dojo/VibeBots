"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { PAUSED_FRAME_INTERVAL_MS } from "./mine-frameloop";

/**
 * While active, renders one frame every PAUSED_FRAME_INTERVAL_MS through
 * the root's advance, the manual step R3F offers for frameloop "never"
 * (F-255). Mount it inside the Canvas next to the scene.
 */
export function PausedFrameTicker({ active }: { active: boolean }) {
  const advance = useThree((state) => state.advance);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(
      () => advance(performance.now()),
      PAUSED_FRAME_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [active, advance]);
  return null;
}

interface MineFrameWindow {
  __vibebotsMineFrames?: number;
}

let mineFrames = 0;

/**
 * Counts rendered frames on window.__vibebotsMineFrames so the e2e cases
 * can measure the frame rate under a dialog. One number write a frame,
 * no allocation (frame-loop-performance rule).
 */
export function MineFrameCounter() {
  useFrame(() => {
    mineFrames += 1;
    (window as unknown as MineFrameWindow).__vibebotsMineFrames = mineFrames;
  });
  return null;
}
