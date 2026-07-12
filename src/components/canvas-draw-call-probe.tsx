"use client";

import { useCallback, useRef } from "react";
import { setDatasetNumber } from "./dataset-diagnostics";

/**
 * Transparent last-rendered sentinel that exposes the completed frame's
 * draw count. useFrame runs before rendering, where WebGPU's per-frame
 * drawCalls value is still zero. The sentinel costs one bounded draw.
 *
 * onFirstFrame fires once, after the first frame has actually rendered:
 * the earliest moment the canvas shows real pixels instead of the
 * unpainted buffer (frames only start once the compile gate settles, so
 * compile-settled alone does not mean painted). Riding this probe keeps
 * the canvas at one sentinel draw instead of two.
 */
export function CanvasDrawCallProbe({
  datasetKey = "drawCalls",
  onFirstFrame,
}: {
  datasetKey?: "drawCalls" | "holodeckDrawCalls";
  onFirstFrame?: () => void;
}) {
  const cache = useRef<Record<string, number | string>>({});
  const firstFrameFired = useRef(false);
  const onAfterRender = useCallback(
    (renderer: {
      domElement: HTMLCanvasElement;
      info: { render: { calls: number; drawCalls?: number } };
    }) => {
      const renderInfo = renderer.info.render;
      setDatasetNumber(
        cache.current,
        renderer.domElement.dataset,
        datasetKey,
        renderInfo.drawCalls ?? renderInfo.calls,
        0,
      );
      if (!firstFrameFired.current) {
        firstFrameFired.current = true;
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
