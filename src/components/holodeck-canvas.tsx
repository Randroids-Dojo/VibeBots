"use client";

import { RoundedBox } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, PointLight } from "three/webgpu";
import type { MineCell } from "@/sim/mine";
import { DEFAULT_GEAR, hitsFor, oreReserveAt } from "@/sim/mine";
import { useHolodeckStore } from "@/state/holodeck-store";
import { CrackMarks, OreCrystals } from "./mine-block-render";
import { MinerBot } from "./mine-miner-render";
import {
  biomeDirtColorAt,
  cellHash,
  cellX,
  GLOWING_ORES,
  METAL_COLOR,
  ORE_COLORS,
  rockColorsForBiome,
  variedColor,
} from "./mine-render-palette";
import {
  advanceMinerRig,
  createMinerRigState,
  minerClipId,
  minerClipInputs,
} from "./miner-rig";
import { createWebGPU } from "./part-visuals";

/** One solid block body, mirroring the mine canvas for the kinds the
 * Holodeck uses. Cracks ride on top as the block takes damage. */
function HolodeckBlock({
  cell,
  col,
  row,
}: {
  cell: MineCell;
  col: number;
  row: number;
}) {
  const x = cellX(col);
  const y = -row;
  const damage = blockDamage(cell);
  return (
    <group position={[x, y, 0]}>
      <BlockBody cell={cell} col={col} row={row} />
      {damage !== null ? (
        <CrackMarks col={col} row={row} damage={damage} />
      ) : null}
    </group>
  );
}

function blockDamage(cell: MineCell): number | null {
  if (cell.kind === "ore" && cell.ore && cell.oreRemaining !== undefined) {
    return 1 - cell.oreRemaining / oreReserveAt(cell.ore, 0);
  }
  if (cell.hp !== undefined && cell.kind !== "empty") {
    // The crack overlay only needs the damage ratio; a baseline gear read
    // of the full hit count is enough to scale it.
    const full = hitsFor(cell.kind, DEFAULT_GEAR);
    return 1 - cell.hp / full;
  }
  return null;
}

function BlockBody({
  cell,
  col,
  row,
}: {
  cell: MineCell;
  col: number;
  row: number;
}) {
  if (cell.kind === "ore" && cell.ore) {
    return (
      <>
        <RoundedBox args={[0.94, 0.94, 0.94]} radius={0.07} smoothness={2}>
          <meshStandardMaterial
            color={variedColor(biomeDirtColorAt(col, row), col, row)}
            roughness={0.95}
            flatShading
          />
        </RoundedBox>
        <OreCrystals
          col={col}
          row={row}
          color={ORE_COLORS[cell.ore]}
          glow={GLOWING_ORES.has(cell.ore)}
        />
      </>
    );
  }
  if (cell.kind === "rock") {
    const rockColors = rockColorsForBiome("default");
    const tier = Math.min((cell.rockTier ?? 1) - 1, rockColors.length - 1);
    return (
      <mesh
        rotation={[
          cellHash(col, row, 13) * 3.1,
          cellHash(col, row, 17) * 3.1,
          cellHash(col, row, 19) * 3.1,
        ]}
      >
        <dodecahedronGeometry args={[0.62, 0]} />
        <meshStandardMaterial
          color={variedColor(rockColors[tier], col, row)}
          roughness={0.6}
          metalness={0.15}
          flatShading
        />
      </mesh>
    );
  }
  if (cell.kind === "metal") {
    return (
      <RoundedBox args={[0.98, 0.98, 1.02]} radius={0.04} smoothness={1}>
        <meshStandardMaterial
          color={variedColor(METAL_COLOR, col, row)}
          emissive="#101820"
          emissiveIntensity={0.14}
          roughness={0.28}
          metalness={0.85}
          flatShading
        />
      </RoundedBox>
    );
  }
  // Dirt and anything else: chunky beveled cube.
  return (
    <RoundedBox args={[0.94, 0.94, 0.94]} radius={0.07} smoothness={2}>
      <meshStandardMaterial
        color={variedColor(biomeDirtColorAt(col, row), col, row)}
        roughness={0.95}
        flatShading
      />
    </RoundedBox>
  );
}

function HolodeckScene() {
  const scenarioId = useHolodeckStore((s) => s.scenarioId);
  const settings = useHolodeckStore((s) => s.settings);
  const scene = useHolodeckStore((s) => s.scene);
  const tick = useHolodeckStore((s) => s.tick);
  const loops = useHolodeckStore((s) => s.loops);
  const paused = useHolodeckStore((s) => s.paused);
  const lastAction = useHolodeckStore((s) => s.lastAction);
  void tick; // subscription trigger: the scene's state mutates in place

  const minerRef = useRef<Group>(null);
  const bodyRef = useRef<Group>(null);
  const armRef = useRef<Group>(null);
  const lampRef = useRef<PointLight>(null);
  const motesRef = useRef<Group>(null);
  const legLRef = useRef<Group>(null);
  const legRRef = useRef<Group>(null);
  const rig = useRef(createMinerRigState());
  const turntableYaw = useRef(0);

  const miner = scene.state.miner;
  const showcase = scenarioId === "miner-showcase";
  const clip = minerClipId(settings.clip);
  const spinning = showcase && settings.turntable === "spin" && !paused;
  const targetSolid =
    scene.state.cells.get(`${scene.target.col},${scene.target.row}`)?.kind !==
    "empty";

  useFrame(({ clock, gl }, delta) => {
    const t = clock.elapsedTime;
    const minerGroup = minerRef.current;
    if (minerGroup) {
      minerGroup.position.set(cellX(miner.col), -miner.row, 0.2);
      // Turntable: rotate the whole model for an all-around inspection.
      if (spinning) turntableYaw.current += delta * 0.7;
      minerGroup.rotation.y = showcase ? turntableYaw.current : 0;
    }
    // The shared rig drives every joint: the single-block scenario plays
    // the real dig clip while its target block survives, the showcase
    // plays whichever clip is selected, and pause is a full still frame.
    const inputs = showcase
      ? minerClipInputs(clip, t, delta, paused)
      : minerClipInputs(targetSolid ? "dig" : "idle", t, delta, paused);
    const pose = advanceMinerRig(rig.current, inputs);
    const body = bodyRef.current;
    if (body) {
      body.position.x = pose.body.posX;
      body.position.y = pose.body.posY;
      body.rotation.y = pose.body.rotY;
      body.rotation.z = pose.body.rotZ;
      body.scale.set(pose.body.scaleX, pose.body.scaleY, pose.body.scaleZ);
    }
    if (legLRef.current && legRRef.current) {
      legLRef.current.rotation.x = pose.legL.rotX;
      legLRef.current.position.y = pose.legL.posY;
      legRRef.current.rotation.x = pose.legR.rotX;
      legRRef.current.position.y = pose.legR.posY;
    }
    if (armRef.current) {
      armRef.current.rotation.z = pose.arm.rotZ;
      // Expose live motion for QA (Rule 10).
      gl.domElement.dataset.holodeckArm = armRef.current.rotation.z.toFixed(3);
      gl.domElement.dataset.holodeckTargetSolid = targetSolid ? "1" : "0";
      gl.domElement.dataset.holodeckLoops = String(loops);
      gl.domElement.dataset.holodeckClip = showcase ? clip : "";
      gl.domElement.dataset.holodeckYaw = (minerGroup?.rotation.y ?? 0).toFixed(
        3,
      );
      gl.domElement.dataset.holodeckBodyY = (body?.position.y ?? 0).toFixed(4);
    }
  });

  // Render only the solid cells the scenario placed (the void stays empty).
  const blocks: React.ReactNode[] = [];
  for (const [key, cell] of scene.state.cells) {
    if (cell.kind === "empty") continue;
    const [col, row] = key.split(",").map(Number);
    blocks.push(<HolodeckBlock key={key} cell={cell} col={col} row={row} />);
  }
  void lastAction;

  return (
    // Center the small scene in front of the fixed camera.
    <group position={[0, 4.5, 0]}>
      <color attach="background" args={["#0a0c12"]} />
      <ambientLight intensity={0.6} color="#cdd8f4" />
      <hemisphereLight args={["#8fb4e8", "#2a2017", 0.5]} />
      <directionalLight position={[3, 6, 8]} intensity={1.1} />
      <pointLight
        position={[cellX(miner.col), -miner.row + 0.4, 1.6]}
        color="#ffdca8"
        intensity={1.6}
        distance={9}
        decay={1.3}
      />
      {/* Cave backdrop so blocks never float over raw void. */}
      <mesh position={[0, -4, -3]}>
        <planeGeometry args={[40, 30]} />
        <meshStandardMaterial color="#05060a" roughness={1} />
      </mesh>
      {blocks}
      <group ref={minerRef}>
        <MinerBot
          bodyRef={bodyRef}
          armRef={armRef}
          lampRef={lampRef}
          motesRef={motesRef}
          legLRef={legLRef}
          legRRef={legRRef}
        />
      </group>
    </group>
  );
}

export default function HolodeckCanvas() {
  return (
    <Canvas
      camera={{ position: [0, 0, 11], fov: 42 }}
      dpr={[1, 2]}
      gl={createWebGPU}
    >
      <HolodeckScene />
    </Canvas>
  );
}
