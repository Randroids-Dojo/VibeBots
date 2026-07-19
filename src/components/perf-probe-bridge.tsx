"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { TimestampQuery } from "three/webgpu";
import { perfAnalyzerEnabled } from "@/lib/perf-analyzer-settings";
import type { PerfSource } from "@/lib/perf-trace";
import { isWebGPUBackend } from "./graphics-quality";
import {
  collectCanvasDiagnostics,
  collectRendererInfo,
  collectSceneStats,
  type RendererInfoLike,
  registerPerfProbe,
  unregisterPerfProbe,
} from "./perf-probe";

const GPU_TIMESTAMP_INTERVAL_SECONDS = 1;

interface TimestampRenderer {
  trackTimestamp?: boolean;
  resolveTimestampsAsync?: (type: unknown) => Promise<unknown>;
}

/**
 * Mounted inside a canvas to expose that canvas to the performance
 * analyzer. Registers a probe that reads renderer info, traverses the
 * scene for composition counts, and forwards the canvas diagnostics
 * dataset. When the renderer was created with timestamp tracking (the
 * analyzer toggle was on at canvas creation), it also resolves the GPU
 * render-pass time about once per second.
 */
export function PerfProbeBridge({ source }: { source: PerfSource }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const gpuFrameMs = useRef<number | null>(null);
  const nextGpuResolveAt = useRef(0);
  const gpuResolveInFlight = useRef(false);

  useFrame((state) => {
    const renderer = gl as unknown as TimestampRenderer;
    if (
      renderer.trackTimestamp !== true ||
      typeof renderer.resolveTimestampsAsync !== "function" ||
      gpuResolveInFlight.current ||
      state.clock.elapsedTime < nextGpuResolveAt.current ||
      !perfAnalyzerEnabled()
    ) {
      return;
    }
    nextGpuResolveAt.current =
      state.clock.elapsedTime + GPU_TIMESTAMP_INTERVAL_SECONDS;
    gpuResolveInFlight.current = true;
    renderer
      .resolveTimestampsAsync(TimestampQuery.RENDER)
      .then((value) => {
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          gpuFrameMs.current = value;
        }
      })
      .catch(() => {})
      .finally(() => {
        gpuResolveInFlight.current = false;
      });
  });

  useEffect(() => {
    registerPerfProbe(source, () => {
      const stats = collectSceneStats(scene);
      const dataset = gl.domElement?.dataset ?? {};
      const particleCount = Number(dataset.particleCount);
      return {
        backend: isWebGPUBackend(gl) ? "webgpu" : "webgl2",
        ...collectRendererInfo(
          (gl as unknown as { info?: RendererInfoLike }).info,
        ),
        ...stats,
        particleCount: Number.isFinite(particleCount) ? particleCount : null,
        gpuFrameMs: gpuFrameMs.current,
        canvasDiagnostics: collectCanvasDiagnostics(dataset, source),
      };
    });
    return () => unregisterPerfProbe(source);
  }, [gl, scene, source]);

  return null;
}
