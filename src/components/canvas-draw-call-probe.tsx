"use client";

import { useCallback, useRef } from "react";
import { setDatasetNumber } from "./dataset-diagnostics";

/**
 * Transparent last-rendered sentinel that exposes the completed frame's
 * draw count. useFrame runs before rendering, where WebGPU's per-frame
 * drawCalls value is still zero. The sentinel costs one bounded draw.
 */
export function CanvasDrawCallProbe({
  datasetKey = "drawCalls",
}: {
  datasetKey?: "drawCalls" | "holodeckDrawCalls";
}) {
  const cache = useRef<Record<string, number | string>>({});
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
    },
    [datasetKey],
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
