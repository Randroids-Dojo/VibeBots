"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Group } from "three/webgpu";
import { createWebGPU } from "@/components/part-visuals";
import {
  isVisible,
  MINE_WIDTH,
  type OreId,
  STRATA,
  stratumAt,
} from "@/sim/mine";
import { useMineStore } from "@/state/mine-store";

const ORE_COLORS: Record<OreId, string> = {
  coal: "#33343a",
  copper: "#c77b3f",
  silver: "#cfd6e0",
  emerald: "#2ecc71",
  ruby: "#e03358",
  diamond: "#8fe9f2",
  "core-crystal": "#b04df0",
};

/** Rare tiers glow so a glimpse at the light's edge reads as treasure. */
const GLOWING_ORES = new Set<OreId>(["diamond", "core-crystal"]);

/** Dirt palette per stratum, in STRATA order (REQ-012: visible descent). */
const STRATA_DIRT = ["#7a5a3a", "#8c5a45", "#6e6862", "#4f5d6e", "#5a3a35"];
/** Background deepens with the strata so descent reads at the edges. */
const STRATA_BG = ["#0b0e14", "#0d0c12", "#0a0a10", "#070a12", "#100809"];

/** Rock darkens by tier so the hard gates read at a glance. */
const ROCK_COLORS = ["#555e6e", "#46506a", "#3b3550"];
const CACHE_COLOR = "#f5c542";
const BOULDER_COLOR = "#8a7f70";
const BOULDER_WOBBLE_COLOR = "#b59f82";
const GAS_COLOR = "#8fa32e";

/** Rows rendered above and below the miner. */
const VIEW_ABOVE = 8;
const VIEW_BELOW = 6;

function dirtColorAt(row: number): string {
  const index = STRATA.indexOf(stratumAt(row));
  return STRATA_DIRT[Math.min(index, STRATA_DIRT.length - 1)];
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  /** Seconds of life remaining (counts down in useFrame). */
  life: number;
}

interface JuiceState {
  particles: Particle[];
  nextId: number;
  /** Screen-shake magnitude, decays in useFrame. */
  shake: number;
}

const cellX = (col: number) => col - (MINE_WIDTH - 1) / 2;

function spawnBurst(
  juice: JuiceState,
  x: number,
  y: number,
  color: string,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    juice.particles.push({
      id: juice.nextId++,
      x: x + (Math.random() - 0.5) * 0.5,
      y: y + (Math.random() - 0.5) * 0.5,
      vx: (Math.random() - 0.5) * 3,
      vy: Math.random() * 2.5 + 0.5,
      color,
      life: 0.45 + Math.random() * 0.3,
    });
  }
  if (juice.particles.length > 220)
    juice.particles.splice(0, juice.particles.length - 220);
}

function MineScene() {
  const tick = useMineStore((s) => s.tick);
  const mine = useMineStore((s) => s.mine);
  const lastResult = useMineStore((s) => s.lastResult);
  const lastAction = useMineStore((s) => s.lastAction);
  void tick; // subscription trigger: the mine object mutates in place
  const rigRef = useRef<Group>(null);
  const minerRef = useRef<Group>(null);
  const particlesRef = useRef<Group>(null);
  const juice = useRef<JuiceState>({ particles: [], nextId: 1, shake: 0 });
  const wobbleClock = useRef(0);

  const minerRow = mine.miner.row;
  const firstRow = Math.max(0, minerRow - VIEW_ABOVE);
  const lastRow = minerRow + VIEW_BELOW;

  // Dig/blast feedback: bursts and shake keyed to the last sim result.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the event stream; the rest is read-at-fire
  useEffect(() => {
    if (!lastResult?.ok) return;
    const j = juice.current;
    const miner = mine.miner;
    const at = lastResult.lost ?? { col: miner.col, row: miner.row };
    if (lastResult.dug) {
      const color =
        lastResult.dugOre != null
          ? ORE_COLORS[lastResult.dugOre]
          : lastResult.dug === "rock"
            ? ROCK_COLORS[0]
            : lastResult.dug === "part-cache"
              ? CACHE_COLOR
              : dirtColorAt(at.row);
      spawnBurst(
        j,
        cellX(at.col),
        -at.row,
        color,
        lastResult.dug === "rock" ? 14 : 9,
      );
      if (lastResult.dug === "rock") j.shake = Math.max(j.shake, 0.12);
    }
    if ((lastResult.blasted ?? 0) > 0 && lastAction?.startsWith("dynamite")) {
      const dir = lastAction.slice("dynamite-".length);
      const dc = dir === "left" ? -1 : dir === "right" ? 1 : 0;
      const dr = dir === "down" ? 1 : dir === "up" ? -1 : 0;
      spawnBurst(
        j,
        cellX(at.col + dc),
        -(at.row + dr),
        "#ffb347",
        26 + (lastResult.blasted ?? 0) * 4,
      );
      j.shake = Math.max(j.shake, 0.35);
    }
    if ((lastResult.vented ?? 0) > 0) {
      spawnBurst(j, cellX(at.col), -at.row, GAS_COLOR, 16);
      j.shake = Math.max(j.shake, 0.25);
    }
    if (lastResult.crushed) j.shake = Math.max(j.shake, 0.5);
  }, [tick]);

  useFrame((state, delta) => {
    const j = juice.current;
    wobbleClock.current += delta;
    // Camera rig eases down the shaft after the miner, with shake.
    const targetY = -minerRow;
    const rig = rigRef.current;
    if (rig) {
      rig.position.y += (targetY - rig.position.y) * Math.min(1, delta * 5);
      j.shake = Math.max(0, j.shake - delta * 0.9);
      const sx = (Math.random() - 0.5) * j.shake;
      const sy = (Math.random() - 0.5) * j.shake;
      state.camera.position.set(sx, rig.position.y + 1.5 + sy, 13);
      state.camera.lookAt(sx, rig.position.y + sy, 0);
    }
    // The miner glides between cells instead of teleporting.
    const miner = minerRef.current;
    if (miner) {
      const tx = cellX(mine.miner.col);
      const ty = -mine.miner.row;
      const ease = Math.min(1, delta * 14);
      miner.position.x += (tx - miner.position.x) * ease;
      miner.position.y += (ty - miner.position.y) * ease;
    }
    // Particles: integrate, gravity, expire; positions sync imperatively
    // (creation/removal re-renders on tick).
    for (const p of j.particles) {
      p.life -= delta;
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.vy -= 9 * delta;
    }
    j.particles = j.particles.filter((p) => p.life > 0);
    const group = particlesRef.current;
    if (group) {
      for (const child of group.children) {
        const p = j.particles.find((q) => q.id === child.userData.id);
        if (p) {
          child.position.set(p.x, p.y, 0.4);
          child.scale.setScalar(Math.max(0.05, p.life));
        } else {
          child.scale.setScalar(0);
        }
      }
    }
  });

  const blocks: Array<{
    key: string;
    x: number;
    y: number;
    color: string;
    glow: boolean;
    wobble: boolean;
  }> = [];
  for (let row = firstRow; row <= lastRow; row++) {
    if (!isVisible(mine, row)) continue;
    for (let col = 0; col < MINE_WIDTH; col++) {
      const cell = mine.rows[row]?.[col];
      if (!cell || cell.kind === "empty") continue;
      const color =
        cell.kind === "ore" && cell.ore
          ? ORE_COLORS[cell.ore]
          : cell.kind === "rock"
            ? ROCK_COLORS[
                Math.min((cell.rockTier ?? 1) - 1, ROCK_COLORS.length - 1)
              ]
            : cell.kind === "part-cache"
              ? CACHE_COLOR
              : cell.kind === "boulder"
                ? cell.wobbling
                  ? BOULDER_WOBBLE_COLOR
                  : BOULDER_COLOR
                : cell.kind === "gas"
                  ? GAS_COLOR
                  : dirtColorAt(row);
      blocks.push({
        key: `${col}:${row}`,
        x: cellX(col),
        y: -row,
        color,
        glow:
          (cell.kind === "ore" && !!cell.ore && GLOWING_ORES.has(cell.ore)) ||
          cell.kind === "part-cache" ||
          (cell.kind === "boulder" && !!cell.wobbling),
        wobble: cell.kind === "boulder" && !!cell.wobbling,
      });
    }
  }

  const bg =
    STRATA_BG[
      Math.min(STRATA.indexOf(stratumAt(minerRow)), STRATA_BG.length - 1)
    ];

  return (
    <>
      <color attach="background" args={[bg]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 6, 8]} intensity={1.2} />
      <group ref={rigRef} />
      {blocks.map((block) => (
        <mesh
          key={block.key}
          position={[
            block.x +
              (block.wobble
                ? Math.sin(wobbleClock.current * 30 + block.y) * 0.05
                : 0),
            block.y,
            0,
          ]}
        >
          <boxGeometry args={[0.94, 0.94, 0.94]} />
          <meshStandardMaterial
            color={block.color}
            emissive={block.glow ? block.color : "#000000"}
            emissiveIntensity={block.glow ? 0.45 : 0}
            flatShading
          />
        </mesh>
      ))}
      <group ref={particlesRef}>
        {juice.current.particles.map((p) => (
          <mesh key={p.id} position={[p.x, p.y, 0.4]} userData={{ id: p.id }}>
            <boxGeometry args={[0.14, 0.14, 0.14]} />
            <meshStandardMaterial
              color={p.color}
              emissive={p.color}
              emissiveIntensity={0.4}
              flatShading
            />
          </mesh>
        ))}
      </group>
      {/* Surface strip */}
      <mesh position={[0, 0.75, 0]}>
        <boxGeometry args={[MINE_WIDTH + 2, 0.5, 1.5]} />
        <meshStandardMaterial color="#2f3640" flatShading />
      </mesh>
      {/* The miner bot */}
      <group ref={minerRef} position={[cellX(mine.miner.col), 0, 0.2]}>
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
      <MineScene />
    </Canvas>
  );
}
