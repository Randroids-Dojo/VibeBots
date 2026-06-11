"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three/webgpu";
import { createWebGPU } from "@/components/part-visuals";
import { type CellKind, isVisible, MINE_WIDTH } from "@/sim/mine";
import { useMineStore } from "@/state/mine-store";

const CELL_COLORS: Record<Exclude<CellKind, "empty">, string> = {
  dirt: "#7a5a3a",
  rock: "#555e6e",
  emerald: "#2ecc71",
  "part-cache": "#f5c542",
};

/** Rows rendered above and below the miner. */
const VIEW_ABOVE = 8;
const VIEW_BELOW = 6;

function MineScene() {
  const tick = useMineStore((s) => s.tick);
  const mine = useMineStore((s) => s.mine);
  void tick; // subscription trigger: the mine object mutates in place
  const rigRef = useRef<Group>(null);

  const minerRow = mine.miner.row;
  const firstRow = Math.max(0, minerRow - VIEW_ABOVE);
  const lastRow = minerRow + VIEW_BELOW;

  useFrame((state, delta) => {
    // Camera rig eases down the shaft after the miner.
    const targetY = -minerRow;
    const rig = rigRef.current;
    if (rig) {
      rig.position.y += (targetY - rig.position.y) * Math.min(1, delta * 5);
      state.camera.position.set(0, rig.position.y + 1.5, 13);
      state.camera.lookAt(0, rig.position.y, 0);
    }
  });

  const blocks: Array<{
    key: string;
    x: number;
    y: number;
    kind: Exclude<CellKind, "empty">;
  }> = [];
  for (let row = firstRow; row <= lastRow; row++) {
    if (!isVisible(mine, row)) continue;
    for (let col = 0; col < MINE_WIDTH; col++) {
      const cell = mine.rows[row]?.[col];
      if (!cell || cell.kind === "empty") continue;
      blocks.push({
        key: `${col}:${row}`,
        x: col - (MINE_WIDTH - 1) / 2,
        y: -row,
        kind: cell.kind,
      });
    }
  }

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 6, 8]} intensity={1.2} />
      <group ref={rigRef} />
      {blocks.map((block) => (
        <mesh key={block.key} position={[block.x, block.y, 0]}>
          <boxGeometry args={[0.94, 0.94, 0.94]} />
          <meshStandardMaterial color={CELL_COLORS[block.kind]} flatShading />
        </mesh>
      ))}
      {/* Surface strip */}
      <mesh position={[0, 0.75, 0]}>
        <boxGeometry args={[MINE_WIDTH + 2, 0.5, 1.5]} />
        <meshStandardMaterial color="#2f3640" flatShading />
      </mesh>
      {/* The miner bot */}
      <group
        position={[mine.miner.col - (MINE_WIDTH - 1) / 2, -mine.miner.row, 0.2]}
      >
        <mesh>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshStandardMaterial color="#ff9f43" flatShading />
        </mesh>
        <mesh position={[0, 0.4, 0]}>
          <icosahedronGeometry args={[0.16, 1]} />
          <meshStandardMaterial
            color="#ffe66d"
            emissive="#ffe66d"
            emissiveIntensity={0.7}
            flatShading
          />
        </mesh>
      </group>
    </>
  );
}

export default function MineCanvas() {
  return (
    <Canvas camera={{ position: [0, 1.5, 13], fov: 42 }} gl={createWebGPU}>
      <color attach="background" args={["#0b0e14"]} />
      <MineScene />
    </Canvas>
  );
}
