"use client";

import { useCallback, useRef } from "react";
import { setDatasetNumber } from "./dataset-diagnostics";

/** The probe's own sentinel draw: a frame at or below this count showed
 * nothing but the probe itself, i.e. the scene content did not draw. */
export const SENTINEL_DRAW_CALLS = 1;

export type FirstFrameGatePhase = "waiting" | "content-seen" | "fired";

/**
 * Per-frame decision for when the first frame has really landed. Runs
 * every frame until it fires, so it must not allocate.
 *
 * Frames can start before the async compile gate's warm-up finishes
 * (the gate deadline is a fallback, not a guarantee): with WebGPU,
 * world objects whose pipelines are still compiling simply do not draw,
 * so the first frames complete with only the probe's sentinel draw and
 * a black canvas. Firing on the first frame dropped the loading veil
 * onto that black canvas (real-phone report, 2026-07-18). The gate
 * therefore waits for a frame that drew actual content, then one more
 * frame so the content frame's work is submitted before the caller's
 * GPU fence (if any) is armed.
 */
export function advanceFirstFrameGate(
  phase: FirstFrameGatePhase,
  frameDrawCalls: number,
): FirstFrameGatePhase {
  if (phase === "fired") return "fired";
  if (phase === "content-seen") return "fired";
  return frameDrawCalls > SENTINEL_DRAW_CALLS ? "content-seen" : "waiting";
}

/**
 * Transparent last-rendered sentinel that exposes the completed frame's
 * draw count. useFrame runs before rendering, where WebGPU's per-frame
 * drawCalls value is still zero. The sentinel costs one bounded draw.
 *
 * onFirstFrame fires once, after a frame has rendered actual scene
 * content (more than the sentinel's own draw) and, when the renderer
 * exposes a WebGPU queue, after that work is done on the GPU. That is
 * the earliest moment the canvas is known to show real pixels instead
 * of the unpainted buffer: compile-settled means frames run, and the
 * first frames can still present black while async pipeline creation
 * catches up. The canvas owner keeps a deadline fallback in case
 * content never draws. Riding this probe keeps the canvas at one
 * sentinel draw instead of two.
 */
export function CanvasDrawCallProbe({
  datasetKey = "drawCalls",
  onFirstFrame,
}: {
  datasetKey?: "drawCalls" | "holodeckDrawCalls";
  onFirstFrame?: () => void;
}) {
  const cache = useRef<Record<string, number | string>>({});
  const gate = useRef<FirstFrameGatePhase>("waiting");
  const onAfterRender = useCallback(
    (renderer: {
      domElement: HTMLCanvasElement;
      info: { render: { calls: number; drawCalls?: number } };
      backend?: {
        device?: {
          queue?: { onSubmittedWorkDone?: () => Promise<unknown> };
        };
      };
    }) => {
      const renderInfo = renderer.info.render;
      const frameDrawCalls = renderInfo.drawCalls ?? renderInfo.calls;
      setDatasetNumber(
        cache.current,
        renderer.domElement.dataset,
        datasetKey,
        frameDrawCalls,
        0,
      );
      if (gate.current === "fired") return;
      gate.current = advanceFirstFrameGate(gate.current, frameDrawCalls);
      if (gate.current !== "fired") return;
      // The content frame was submitted with the previous frame, so a
      // WebGPU fence here resolves only after its pixels really landed;
      // without a queue (WebGL2 fallback), presentation is implicit.
      const workDone = renderer.backend?.device?.queue?.onSubmittedWorkDone?.();
      if (workDone) {
        void workDone.then(() => onFirstFrame?.());
      } else {
        onFirstFrame?.();
      }
    },
    [datasetKey, onFirstFrame],
  );

  return (
    <mesh
      position={[0, 0, -2.8]}
      renderOrder={10_000}
      frustumCulled={false}
      onAfterRender={onAfterRender}
    >
      <planeGeometry args={[0.01, 0.01]} />
      <meshBasicMaterial
        transparent
        opacity={0}
        depthWrite={false}
        colorWrite={false}
      />
    </mesh>
  );
}
