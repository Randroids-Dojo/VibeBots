"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { isWebGPUBackend } from "./graphics-quality";

/**
 * Caps the device pixel ratio to 1 on the software (non-WebGPU) GL fallback.
 *
 * Headless CI and GPU-weak machines are fine-pointer, so the tier-derived DPR
 * (up to 2x) makes the SwiftShader WebGL2 fallback do up to 4x the fill work
 * per frame. That stalls frames and flakes the timing-sensitive smoke (camera
 * gestures not settling, sim ticks not advancing inside a test's wall-clock
 * window). On the WebGPU backend the canvas keeps its full tier DPR, so
 * capable devices lose nothing; capability is gated on the live backend, not
 * the pointer tier (see graphics-capability-gating).
 *
 * Rendered as a child of a Canvas; it reads the resolved renderer and, only on
 * the fallback, drops the pixel ratio to 1.
 */
export function FallbackDprCap() {
  const gl = useThree((state) => state.gl);
  const setDpr = useThree((state) => state.setDpr);
  useEffect(() => {
    if (!isWebGPUBackend(gl)) setDpr(1);
  }, [gl, setDpr]);
  return null;
}
