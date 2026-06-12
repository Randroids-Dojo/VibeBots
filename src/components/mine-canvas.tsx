"use client";

import { RoundedBox } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef } from "react";
import type {
  AmbientLight,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  PointLight,
} from "three/webgpu";
import { Color } from "three/webgpu";
import { createWebGPU } from "@/components/part-visuals";
import {
  cellAt,
  ELEVATOR_COL,
  hitsFor,
  isVisible,
  type OreId,
  START_COL,
  STRATA,
  stratumAt,
} from "@/sim/mine";
import { useMineStore } from "@/state/mine-store";
import { STALLS } from "./mine-stalls";

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

/** Depth (in rows) at which the lighting reaches full darkness. */
const DARK_DEPTH = 14;

function dirtColorAt(row: number): string {
  const index = STRATA.indexOf(stratumAt(row));
  return STRATA_DIRT[Math.min(index, STRATA_DIRT.length - 1)];
}

/**
 * Stable per-cell randomness for visual variation. Render-layer only;
 * deterministic per (col, row, salt) so blocks do not shimmer when the
 * scene re-renders on every action tick.
 */
function cellHash(col: number, row: number, salt: number): number {
  let h = (col * 374761393 + row * 668265263 + salt * 1274126177) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Lightness-jittered variant of a base color, stable per cell. */
function variedColor(base: string, col: number, row: number): Color {
  const c = new Color(base);
  c.offsetHSL(0, 0, (cellHash(col, row, 5) - 0.5) * 0.1);
  return c;
}

type ParticleKind = "debris" | "spark" | "dust";

interface Particle {
  id: number;
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Downward pull per second (dust floats, debris drops). */
  gravity: number;
  size: number;
  color: string;
  /** Seconds of life remaining (counts down in useFrame). */
  life: number;
}

interface JuiceState {
  particles: Particle[];
  nextId: number;
  /** Screen-shake magnitude, decays in useFrame. */
  shake: number;
  /** Seconds left in the pick-swing animation. */
  swing: number;
  /** Lateral facing: -1 left, 1 right, 0 camera-facing. */
  facing: number;
  /** Dig lunge: body offset toward the struck cell, decaying. */
  lunge: { x: number; y: number; t: number };
}

/** World coordinates ARE render coordinates in the endless claim. */
const cellX = (col: number) => col;
/** Columns rendered to either side of the miner: the widest desktop
 * frustum sees ~8.2, so 9 covers every aspect with glide margin while
 * keeping the mesh count near the old fixed-width world. */
const VIEW_COLS = 9;
/** Width of the dressed surface camp strip around the origin. */
const CAMP_WIDTH = 60;

function pushParticle(juice: JuiceState, p: Omit<Particle, "id">): void {
  juice.particles.push({ ...p, id: juice.nextId++ });
  if (juice.particles.length > 260)
    juice.particles.splice(0, juice.particles.length - 260);
}

/** Chunky debris in the struck block's color. */
function spawnBurst(
  juice: JuiceState,
  x: number,
  y: number,
  color: string,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    pushParticle(juice, {
      kind: "debris",
      x: x + (Math.random() - 0.5) * 0.5,
      y: y + (Math.random() - 0.5) * 0.5,
      vx: (Math.random() - 0.5) * 3,
      vy: Math.random() * 2.5 + 0.5,
      gravity: 9,
      size: 0.1 + Math.random() * 0.09,
      color,
      life: 0.45 + Math.random() * 0.3,
    });
  }
}

/** Hot pick-strike sparks: fast, bright, gone in a blink. */
function spawnSparks(
  juice: JuiceState,
  x: number,
  y: number,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    pushParticle(juice, {
      kind: "spark",
      x: x + (Math.random() - 0.5) * 0.3,
      y: y + (Math.random() - 0.5) * 0.3,
      vx: (Math.random() - 0.5) * 6,
      vy: Math.random() * 3.5 + 0.8,
      gravity: 11,
      size: 0.05 + Math.random() * 0.04,
      color: "#ffe9a8",
      life: 0.14 + Math.random() * 0.16,
    });
  }
}

/** A soft scuff of dust kicked up by treads on a plain move. */
function spawnDust(juice: JuiceState, x: number, y: number): void {
  for (let i = 0; i < 3; i++) {
    pushParticle(juice, {
      kind: "dust",
      x: x + (Math.random() - 0.5) * 0.4,
      y: y - 0.35,
      vx: (Math.random() - 0.5) * 0.7,
      vy: Math.random() * 0.6 + 0.15,
      gravity: 1.2,
      size: 0.06 + Math.random() * 0.05,
      color: "#7a6a55",
      life: 0.4 + Math.random() * 0.35,
    });
  }
}

/** Crystals jutting from an ore cell, sized and angled per cell hash. */
function OreCrystals({
  col,
  row,
  color,
  glow,
}: {
  col: number;
  row: number;
  color: string;
  glow: boolean;
}) {
  const count = 2 + Math.floor(cellHash(col, row, 7) * 2);
  const crystals = [];
  for (let i = 0; i < count; i++) {
    const a = cellHash(col, row, 11 + i);
    const b = cellHash(col, row, 23 + i);
    const s = 0.09 + cellHash(col, row, 31 + i) * 0.09;
    crystals.push(
      <mesh
        key={i}
        position={[(a - 0.5) * 0.52, (b - 0.5) * 0.52, 0.42]}
        rotation={[a * 2.2, b * 2.2, (a + b) * 1.8]}
        scale={[s, s * 1.7, s]}
      >
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={glow ? 1.1 : 0.4}
          roughness={0.25}
          metalness={0.1}
          flatShading
        />
      </mesh>,
    );
  }
  return <>{crystals}</>;
}

/** A buried supply crate: timber box with glowing gold straps. */
function CacheCrate({ col, row }: { col: number; row: number }) {
  const tilt = (cellHash(col, row, 41) - 0.5) * 0.3;
  return (
    <group rotation={[0, 0, tilt]}>
      <RoundedBox args={[0.8, 0.8, 0.8]} radius={0.06} smoothness={2}>
        <meshStandardMaterial color="#8a6b3f" roughness={0.8} flatShading />
      </RoundedBox>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.86, 0.16, 0.86]} />
        <meshStandardMaterial
          color={CACHE_COLOR}
          emissive={CACHE_COLOR}
          emissiveIntensity={0.5}
          metalness={0.4}
          roughness={0.3}
          flatShading
        />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.16, 0.86, 0.86]} />
        <meshStandardMaterial
          color={CACHE_COLOR}
          emissive={CACHE_COLOR}
          emissiveIntensity={0.5}
          metalness={0.4}
          roughness={0.3}
          flatShading
        />
      </mesh>
    </group>
  );
}

/** Crack decals on a damaged block: more and longer as hp drops. */
function CrackMarks({
  col,
  row,
  damage,
}: {
  col: number;
  row: number;
  damage: number;
}) {
  const count = Math.min(3, Math.max(1, Math.ceil(damage * 3)));
  const marks = [];
  for (let i = 0; i < count; i++) {
    const a = cellHash(col, row, 61 + i);
    const b = cellHash(col, row, 67 + i);
    marks.push(
      <mesh
        key={i}
        position={[(a - 0.5) * 0.6, (b - 0.5) * 0.6, 0.5]}
        rotation={[0, 0, a * 3.1]}
      >
        <boxGeometry args={[0.3 + damage * 0.35, 0.035, 0.02]} />
        <meshStandardMaterial color="#0d0b08" roughness={1} />
      </mesh>,
    );
  }
  return <group>{marks}</group>;
}

/**
 * The miner robot: treaded chassis, orange torso with a glowing chest
 * screen, visored head under a hard hat with a working headlamp, and a
 * pickaxe arm that swings on digs. Animated parts get refs; the outer
 * group's transform belongs to useFrame in MineScene.
 */
function MinerBot({
  bodyRef,
  armRef,
  lampRef,
  motesRef,
}: {
  bodyRef: React.RefObject<Group | null>;
  armRef: React.RefObject<Group | null>;
  lampRef: React.RefObject<PointLight | null>;
  motesRef: React.RefObject<Group | null>;
}) {
  const motes = [];
  for (let i = 0; i < 14; i++) {
    const a = cellHash(i, 211, 1);
    const b = cellHash(i, 223, 9);
    const r = 0.55 + cellHash(i, 227, 3) * 1.35;
    motes.push(
      <mesh
        key={i}
        position={[
          Math.cos(a * 6.28) * r,
          Math.sin(b * 6.28) * r * 0.8,
          0.5 + a * 0.4,
        ]}
      >
        <icosahedronGeometry args={[0.016 + b * 0.014, 0]} />
        <meshBasicMaterial color="#ffe2b0" transparent opacity={0.45} />
      </mesh>,
    );
  }
  return (
    <>
      {/* Dust motes drifting in the lamp light (hidden on the surface). */}
      <group ref={motesRef}>{motes}</group>
      <group ref={bodyRef}>
        {/* Treads */}
        <mesh position={[0, -0.27, 0]}>
          <boxGeometry args={[0.4, 0.14, 0.3]} />
          <meshStandardMaterial color="#23262f" roughness={0.9} flatShading />
        </mesh>
        <mesh position={[-0.2, -0.27, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.09, 0.09, 0.3, 10]} />
          <meshStandardMaterial color="#3a3f4d" roughness={0.7} flatShading />
        </mesh>
        <mesh position={[0.2, -0.27, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.09, 0.09, 0.3, 10]} />
          <meshStandardMaterial color="#3a3f4d" roughness={0.7} flatShading />
        </mesh>
        {/* Torso */}
        <RoundedBox
          args={[0.42, 0.34, 0.32]}
          radius={0.06}
          smoothness={2}
          position={[0, -0.03, 0]}
        >
          <meshStandardMaterial
            color="#ff9f43"
            roughness={0.5}
            metalness={0.25}
            flatShading
          />
        </RoundedBox>
        {/* Chest screen */}
        <mesh position={[0, -0.03, 0.17]}>
          <boxGeometry args={[0.18, 0.12, 0.02]} />
          <meshStandardMaterial
            color="#0d2b26"
            emissive="#54e0c7"
            emissiveIntensity={0.9}
            flatShading
          />
        </mesh>
        {/* Head */}
        <RoundedBox
          args={[0.3, 0.2, 0.26]}
          radius={0.06}
          smoothness={2}
          position={[0, 0.26, 0]}
        >
          <meshStandardMaterial
            color="#ffb066"
            roughness={0.45}
            metalness={0.25}
            flatShading
          />
        </RoundedBox>
        {/* Visor */}
        <mesh position={[0, 0.26, 0.13]}>
          <boxGeometry args={[0.22, 0.08, 0.03]} />
          <meshStandardMaterial
            color="#101820"
            emissive="#7df9ff"
            emissiveIntensity={1.2}
            flatShading
          />
        </mesh>
        {/* Hard hat */}
        <mesh position={[0, 0.39, 0]}>
          <cylinderGeometry args={[0.18, 0.2, 0.09, 12]} />
          <meshStandardMaterial
            color="#f5c542"
            roughness={0.4}
            metalness={0.2}
            flatShading
          />
        </mesh>
        {/* Headlamp housing and glow */}
        <mesh position={[0, 0.38, 0.16]}>
          <cylinderGeometry args={[0.05, 0.06, 0.07, 10]} />
          <meshStandardMaterial
            color="#fff3c4"
            emissive="#ffe9a8"
            emissiveIntensity={2.2}
            flatShading
          />
        </mesh>
        {/* Antenna */}
        <mesh position={[0.12, 0.47, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.14, 6]} />
          <meshStandardMaterial color="#3a3f4d" flatShading />
        </mesh>
        <mesh position={[0.12, 0.55, 0]}>
          <icosahedronGeometry args={[0.03, 0]} />
          <meshStandardMaterial
            color="#ff6b6b"
            emissive="#ff6b6b"
            emissiveIntensity={1.6}
            flatShading
          />
        </mesh>
        {/* Pick arm: shoulder pivot so the swing reads as a chop */}
        <group ref={armRef} position={[0.24, 0.08, 0.06]}>
          <mesh position={[0.05, -0.08, 0]} rotation={[0, 0, -0.5]}>
            <boxGeometry args={[0.08, 0.22, 0.08]} />
            <meshStandardMaterial
              color="#e08a32"
              roughness={0.55}
              flatShading
            />
          </mesh>
          <mesh position={[0.13, -0.2, 0]} rotation={[0, 0, 0.5]}>
            <cylinderGeometry args={[0.02, 0.02, 0.3, 8]} />
            <meshStandardMaterial color="#6b4a2a" roughness={0.9} flatShading />
          </mesh>
          <mesh position={[0.2, -0.31, 0]} rotation={[0, 0, 1.05]}>
            <boxGeometry args={[0.2, 0.05, 0.05]} />
            <meshStandardMaterial
              color="#aeb6c4"
              metalness={0.6}
              roughness={0.3}
              flatShading
            />
          </mesh>
        </group>
      </group>
      {/* The lamp is the scene's key light below the surface. */}
      <pointLight
        ref={lampRef}
        position={[0, 0.4, 1.1]}
        color="#ffd9a0"
        intensity={1.2}
        distance={9}
        decay={1.4}
      />
    </>
  );
}

/** A village stall building: hut, pyramid roof, door, lit sign. */
function StallBuilding({
  x,
  color,
  active,
}: {
  x: number;
  color: string;
  active: boolean;
}) {
  return (
    <group position={[x, -1.5, -0.1]}>
      <RoundedBox
        args={[1.22, 0.85, 0.85]}
        radius={0.05}
        smoothness={2}
        position={[0, 1.43, 0]}
      >
        <meshStandardMaterial color="#5a4632" roughness={0.9} flatShading />
      </RoundedBox>
      <mesh position={[0, 2.08, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[0.95, 0.55, 4]} />
        <meshStandardMaterial color="#3a2c1e" roughness={0.95} flatShading />
      </mesh>
      {/* Door */}
      <mesh position={[0, 1.25, 0.44]}>
        <boxGeometry args={[0.3, 0.48, 0.04]} />
        <meshStandardMaterial color="#241a10" roughness={1} flatShading />
      </mesh>
      {/* Sign: brightens when the miner stands at the stall */}
      <mesh position={[0, 1.72, 0.46]}>
        <boxGeometry args={[0.62, 0.18, 0.05]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={active ? 1.7 : 0.55}
          flatShading
        />
      </mesh>
    </group>
  );
}

/** All 46 stars in a single points draw call (phones count draws). */
function NightStars() {
  const positions = useMemo(() => {
    const arr = new Float32Array(46 * 3);
    for (let i = 0; i < 46; i++) {
      arr[i * 3] = (cellHash(i, 131, 1) - 0.5) * 34;
      arr[i * 3 + 1] = 2.4 + cellHash(i, 137, 9) * 9;
      arr[i * 3 + 2] = -4;
    }
    return arr;
  }, []);
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.05} color="#cfe0ff" fog={false} />
    </points>
  );
}

/**
 * Night-camp surface dressing: headframe, lanterns, grass, stalls.
 * Memoized: it re-renders only when the active stall changes, not on
 * every dig tick (per-tick reconciliation of this tree was part of the
 * surface-rows jank).
 */
const SurfaceDressing = memo(function SurfaceDressing({
  activeCol,
}: {
  activeCol: number | null;
}) {
  const tufts = [];
  for (let i = 0; i < 12; i++) {
    const h = cellHash(i, 97, 3);
    const x = (h - 0.5) * 12;
    if (Math.abs(x) < 0.9) continue;
    if (STALLS.some((stall) => Math.abs(x - cellX(stall.col)) < 0.85)) continue;
    tufts.push(
      <mesh
        key={i}
        position={[x, -0.44, (cellHash(i, 89, 7) - 0.5) * 0.5 - 0.2]}
        rotation={[0, h * 3, 0]}
      >
        <coneGeometry args={[0.07, 0.16 + h * 0.12, 5]} />
        <meshStandardMaterial color="#4f7a4a" roughness={1} flatShading />
      </mesh>,
    );
  }
  const frameX = cellX(START_COL);
  return (
    <group>
      {/* Night sky over the camp */}
      <NightStars />
      {/* Grassy lip along the ground line the miner walks on */}
      <mesh position={[0, -0.47, -0.3]}>
        <boxGeometry args={[CAMP_WIDTH, 0.07, 0.9]} />
        <meshStandardMaterial color="#3d5c3a" roughness={1} flatShading />
      </mesh>
      {tufts}
      {/* Headframe straddling the starting shaft */}
      <group position={[frameX, -1.5, 0]}>
        <mesh position={[-0.62, 1.62, 0]} rotation={[0, 0, 0.32]}>
          <boxGeometry args={[0.1, 1.5, 0.1]} />
          <meshStandardMaterial color="#4a3424" roughness={0.9} flatShading />
        </mesh>
        <mesh position={[0.62, 1.62, 0]} rotation={[0, 0, -0.32]}>
          <boxGeometry args={[0.1, 1.5, 0.1]} />
          <meshStandardMaterial color="#4a3424" roughness={0.9} flatShading />
        </mesh>
        <mesh position={[0, 2.3, 0]}>
          <torusGeometry args={[0.22, 0.05, 8, 14]} />
          <meshStandardMaterial
            color="#8a4f2d"
            metalness={0.4}
            roughness={0.5}
            flatShading
          />
        </mesh>
        <mesh position={[0, 1.66, 0]}>
          <boxGeometry args={[0.025, 1.3, 0.025]} />
          <meshStandardMaterial color="#23262f" flatShading />
        </mesh>
      </group>
      {/* The village stalls (REQ-021) */}
      {STALLS.map((stall) => (
        <StallBuilding
          key={stall.id}
          x={cellX(stall.col)}
          color={stall.color}
          active={activeCol === stall.col}
        />
      ))}
      {/* Lantern posts flanking the headframe */}
      {[-1.3, 1.3].map((x) => (
        <group key={x} position={[x, -1.5, 0.3]}>
          <mesh position={[0, 1.45, 0]}>
            <boxGeometry args={[0.07, 0.95, 0.07]} />
            <meshStandardMaterial color="#4a3424" roughness={0.9} flatShading />
          </mesh>
          <mesh position={[0, 1.95, 0]}>
            <icosahedronGeometry args={[0.12, 0]} />
            <meshStandardMaterial
              color="#ffe9a8"
              emissive="#ffd9a0"
              emissiveIntensity={1.8}
              flatShading
            />
          </mesh>
        </group>
      ))}
    </group>
  );
});

function MineScene() {
  const tick = useMineStore((s) => s.tick);
  const mine = useMineStore((s) => s.mine);
  const lastResult = useMineStore((s) => s.lastResult);
  const lastAction = useMineStore((s) => s.lastAction);
  void tick; // subscription trigger: the mine object mutates in place
  const rigRef = useRef<Group>(null);
  const minerRef = useRef<Group>(null);
  const minerBodyRef = useRef<Group>(null);
  const motesRef = useRef<Group>(null);
  const pickArmRef = useRef<Group>(null);
  const lampRef = useRef<PointLight>(null);
  const ambientRef = useRef<AmbientLight>(null);
  const hemiRef = useRef<HemisphereLight>(null);
  const dirRef = useRef<DirectionalLight>(null);
  const particlesRef = useRef<Group>(null);
  const wobbleRefs = useRef<Map<string, Mesh>>(new Map());
  const juice = useRef<JuiceState>({
    particles: [],
    nextId: 1,
    shake: 0,
    swing: 0,
    facing: 0,
    lunge: { x: 0, y: 0, t: 0 },
  });
  const minerPlaced = useRef(false);

  const minerRow = mine.miner.row;
  const firstRow = Math.max(0, minerRow - VIEW_ABOVE);
  const lastRow = minerRow + VIEW_BELOW;

  // Dig/blast feedback: bursts, shake, swing, and facing keyed to the
  // last sim result.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the event stream; the rest is read-at-fire
  useEffect(() => {
    const j = juice.current;
    if (lastAction === "left" || lastAction === "dynamite-left") j.facing = -1;
    else if (lastAction === "right" || lastAction === "dynamite-right")
      j.facing = 1;
    else if (lastAction != null) j.facing = 0;
    if (!lastResult?.ok) return;
    const miner = mine.miner;
    const at = lastResult.lost ?? { col: miner.col, row: miner.row };
    if (lastResult.cracked) {
      j.swing = 0.3;
      const dc = lastAction === "left" ? -1 : lastAction === "right" ? 1 : 0;
      const dr = lastAction === "down" ? 1 : lastAction === "up" ? -1 : 0;
      const sx = cellX(miner.col + dc);
      const sy = -(miner.row + dr);
      spawnSparks(j, sx, sy, 4);
      spawnBurst(
        j,
        sx,
        sy,
        lastResult.cracked.kind === "rock"
          ? ROCK_COLORS[0]
          : dirtColorAt(miner.row + dr),
        3,
      );
      j.shake = Math.max(j.shake, 0.02);
      j.lunge = { x: dc * 0.16, y: -dr * 0.13, t: 0.22 };
    }
    if (lastResult.dug) {
      j.swing = 0.3;
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
        lastResult.dug === "rock" ? 16 : 11,
      );
      spawnSparks(
        j,
        cellX(at.col),
        -at.row,
        lastResult.dug === "rock" ? 10 : 6,
      );
      // Every strike thumps; rock thumps harder.
      j.shake = Math.max(j.shake, lastResult.dug === "rock" ? 0.12 : 0.045);
      // Lunge the body toward the struck cell.
      const ldx = lastAction === "left" ? -1 : lastAction === "right" ? 1 : 0;
      const ldy = lastAction === "down" ? -1 : lastAction === "up" ? 1 : 0;
      j.lunge = { x: ldx * 0.16, y: ldy * 0.13, t: 0.22 };
    } else if (
      lastResult.ok &&
      (lastAction === "left" ||
        lastAction === "right" ||
        lastAction === "down" ||
        lastAction === "up")
    ) {
      // A plain step into open tunnel: treads kick a little dust.
      spawnDust(j, cellX(miner.col), -miner.row);
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
    const t = state.clock.elapsedTime;
    // Camera rig eases down the shaft after the miner, with shake.
    const targetY = -minerRow;
    const rig = rigRef.current;
    let depthT = 0;
    if (rig) {
      // Trip resets (collapse, recall, abandon) move the miner across
      // the whole map; gliding the camera through it reads as broken.
      if (Math.abs(targetY - rig.position.y) > 6) rig.position.y = targetY;
      rig.position.y += (targetY - rig.position.y) * Math.min(1, delta * 5);
      // The endless claim has no edges: the camera follows the miner
      // laterally everywhere (the old clamp framed a 9-wide world).
      const targetX = cellX(mine.miner.col);
      if (Math.abs(targetX - rig.position.x) > 6) rig.position.x = targetX;
      rig.position.x += (targetX - rig.position.x) * Math.min(1, delta * 5);
      j.shake = Math.max(0, j.shake - delta * 0.9);
      const sx = rig.position.x + (Math.random() - 0.5) * j.shake;
      const sy = (Math.random() - 0.5) * j.shake;
      state.camera.position.set(sx, rig.position.y + 1.5 + sy, 13);
      state.camera.lookAt(sx, rig.position.y + sy, 0);
      // Rendered camera pan exposed for motion QA on narrow viewports.
      state.gl.domElement.dataset.camX = rig.position.x.toFixed(2);
      depthT = Math.min(1, Math.max(0, -rig.position.y / DARK_DEPTH));
    }
    // Daylight dies with depth; the lamp takes over as the key light.
    const day = (1 - depthT) ** 1.7;
    if (ambientRef.current) ambientRef.current.intensity = 0.07 + 0.48 * day;
    if (hemiRef.current) hemiRef.current.intensity = 0.5 * day * day;
    if (dirRef.current) dirRef.current.intensity = 0.06 + 1.04 * day;
    const lamp = lampRef.current;
    if (lamp) {
      let intensity = 1.0 + 3.8 * depthT;
      // The lamp gutters when the trip is nearly out of energy.
      const energy = mine.miner.energy;
      if (minerRow > 0 && energy < 10)
        intensity *= 0.78 + 0.22 * Math.sin(t * 26) * Math.sin(t * 7.3);
      lamp.intensity = intensity;
    }
    // The miner glides between cells instead of teleporting. useFrame is
    // the only writer of this position: a JSX position prop here would be
    // re-applied by R3F on every tick re-render, snapping Y back to the
    // prop value mid-glide (the old walk-left teleport-to-surface bug).
    const miner = minerRef.current;
    if (miner) {
      const tx = cellX(mine.miner.col);
      const ty = -mine.miner.row;
      // Teleport-scale jumps (trip resets) snap; easing across them
      // would fly the bot up through solid rock for seconds.
      if (
        !minerPlaced.current ||
        Math.abs(tx - miner.position.x) > 3 ||
        Math.abs(ty - miner.position.y) > 3
      ) {
        minerPlaced.current = true;
        miner.position.set(tx, ty, 0.2);
      } else {
        const ease = Math.min(1, delta * 14);
        miner.position.x += (tx - miner.position.x) * ease;
        miner.position.y += (ty - miner.position.y) * ease;
      }
      // Rendered position exposed for motion QA (Rule 10): e2e reads these
      // to prove the glide never lifts toward the surface on lateral steps.
      const el = state.gl.domElement;
      el.dataset.minerX = miner.position.x.toFixed(2);
      el.dataset.minerY = miner.position.y.toFixed(2);
      // Last frame's draw-call count: the budget that phones live by.
      el.dataset.drawCalls = String(state.gl.info.render.calls);
    }
    // Body language: face the walk direction, idle bob, pick swings.
    const body = minerBodyRef.current;
    if (body && miner) {
      const targetYaw = j.facing * 0.85;
      body.rotation.y += (targetYaw - body.rotation.y) * Math.min(1, delta * 8);
      // Dig lunge decays over its window; bob hums underneath.
      j.lunge.t = Math.max(0, j.lunge.t - delta);
      const lk = j.lunge.t / 0.22;
      body.position.x = j.lunge.x * lk;
      // Grounded on the cell floor, with a soft idle hover bob.
      body.position.y = -0.14 + Math.sin(t * 2.4) * 0.018 + j.lunge.y * lk;
      // Lean into the glide while moving between cells.
      const vx = cellX(mine.miner.col) - miner.position.x;
      body.rotation.z = Math.max(-0.16, Math.min(0.16, -vx * 0.3));
    }
    const arm = pickArmRef.current;
    if (arm) {
      j.swing = Math.max(0, j.swing - delta);
      const k = j.swing / 0.3;
      arm.rotation.z = -2.1 * k * k;
    }
    // Lamp-lit dust drifts around the bot underground.
    const motes = motesRef.current;
    if (motes) {
      motes.visible = minerRow > 0;
      motes.rotation.z = t * 0.12;
    }
    // Wobbling boulders tremble every frame, not once per action.
    for (const mesh of wobbleRefs.current.values()) {
      mesh.position.x =
        (mesh.userData.baseX as number) +
        Math.sin(t * 30 + mesh.userData.baseY) * 0.05;
    }
    // Particles: integrate, gravity, expire; positions sync imperatively
    // (creation/removal re-renders on tick).
    for (const p of j.particles) {
      p.life -= delta;
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.vy -= p.gravity * delta;
    }
    j.particles = j.particles.filter((p) => p.life > 0);
    const group = particlesRef.current;
    if (group) {
      const byId = new Map(j.particles.map((q) => [q.id, q]));
      for (const child of group.children) {
        const p = byId.get(child.userData.id as number);
        if (p) {
          child.position.set(p.x, p.y, 0.4);
          child.scale.setScalar(Math.max(0.05, p.life));
        } else {
          child.scale.setScalar(0);
        }
      }
    }
  });

  const stratumIndex = Math.min(
    STRATA.indexOf(stratumAt(minerRow)),
    STRATA_BG.length - 1,
  );
  const bg = STRATA_BG[stratumIndex];

  wobbleRefs.current.clear();
  const blockMeshes = [];
  const tunnelMeshes = [];
  const crackMeshes = [];
  for (let row = firstRow; row <= lastRow; row++) {
    if (!isVisible(mine, row)) continue;
    for (
      let col = mine.miner.col - VIEW_COLS;
      col <= mine.miner.col + VIEW_COLS;
      col++
    ) {
      const cell = cellAt(mine, col, row);
      if (!cell) continue;
      const key = `${col}:${row}`;
      const x = cellX(col);
      const y = -row;
      // Damaged blocks wear cracks (REQ-013); the overlay rides above
      // whatever shape the kind renders.
      if (cell.hp !== undefined && cell.kind !== "empty") {
        const damage = 1 - cell.hp / hitsFor(cell.kind, mine.gear);
        crackMeshes.push(
          <group key={`crack:${key}`} position={[x, y, 0]}>
            <CrackMarks col={col} row={row} damage={damage} />
          </group>,
        );
      }
      if (cell.kind === "empty") {
        // Carved tunnels read as recessed rock, not as holes in the sky.
        if (row >= 1) {
          tunnelMeshes.push(
            <mesh key={key} position={[x, y, -0.42]}>
              <boxGeometry args={[1, 1, 0.12]} />
              <meshStandardMaterial
                color={variedColor("#15120e", col, row)}
                roughness={1}
              />
            </mesh>,
          );
        }
        // A planted ladder (REQ-020): rails and rungs against the wall.
        if (cell.ladder) {
          tunnelMeshes.push(
            <group key={`ladder:${key}`} position={[x, y, -0.28]}>
              {[-0.16, 0.16].map((rx) => (
                <mesh key={rx} position={[rx, 0, 0]}>
                  <boxGeometry args={[0.05, 1, 0.05]} />
                  <meshStandardMaterial
                    color="#a87b3e"
                    roughness={0.85}
                    flatShading
                  />
                </mesh>
              ))}
              {[-0.3, 0, 0.3].map((ry) => (
                <mesh key={ry} position={[0, ry, 0]}>
                  <boxGeometry args={[0.36, 0.05, 0.05]} />
                  <meshStandardMaterial
                    color="#c99a55"
                    roughness={0.85}
                    flatShading
                  />
                </mesh>
              ))}
            </group>,
          );
        }
        // The warp beacon (REQ-029): a humming pylon in the dark.
        if (cell.beacon) {
          tunnelMeshes.push(
            <group key={`beacon:${key}`} position={[x, y - 0.18, 0.1]}>
              <mesh>
                <cylinderGeometry args={[0.07, 0.12, 0.5, 8]} />
                <meshStandardMaterial
                  color="#5a3a78"
                  metalness={0.5}
                  roughness={0.4}
                  flatShading
                />
              </mesh>
              <mesh position={[0, 0.35, 0]}>
                <octahedronGeometry args={[0.12, 0]} />
                <meshStandardMaterial
                  color="#e08aff"
                  emissive="#e08aff"
                  emissiveIntensity={1.6}
                  flatShading
                />
              </mesh>
              <pointLight
                position={[0, 0.4, 0.4]}
                color="#e08aff"
                intensity={1.4}
                distance={4}
                decay={1.6}
              />
            </group>,
          );
        }
        // A plank bridge (REQ-022): boards spanning the cell floor.
        if (cell.plank) {
          tunnelMeshes.push(
            <group key={`plank:${key}`} position={[x, y - 0.42, 0.05]}>
              {[-0.14, 0.14].map((pz) => (
                <mesh key={pz} position={[0, 0, pz]}>
                  <boxGeometry args={[0.98, 0.07, 0.22]} />
                  <meshStandardMaterial
                    color="#b58a4a"
                    roughness={0.85}
                    flatShading
                  />
                </mesh>
              ))}
              <mesh position={[0, -0.05, 0]}>
                <boxGeometry args={[0.2, 0.06, 0.56]} />
                <meshStandardMaterial
                  color="#8a6536"
                  roughness={0.9}
                  flatShading
                />
              </mesh>
            </group>,
          );
        }
        continue;
      }
      if (cell.kind === "ore" && cell.ore) {
        const oreColor = ORE_COLORS[cell.ore];
        const glow = GLOWING_ORES.has(cell.ore);
        blockMeshes.push(
          <group key={key} position={[x, y, 0]}>
            <RoundedBox args={[0.94, 0.94, 0.94]} radius={0.07} smoothness={2}>
              <meshStandardMaterial
                color={variedColor(dirtColorAt(row), col, row)}
                roughness={0.95}
                flatShading
              />
            </RoundedBox>
            <OreCrystals col={col} row={row} color={oreColor} glow={glow} />
          </group>,
        );
        continue;
      }
      if (cell.kind === "rock") {
        const tier = Math.min((cell.rockTier ?? 1) - 1, ROCK_COLORS.length - 1);
        blockMeshes.push(
          <mesh
            key={key}
            position={[x, y, 0]}
            rotation={[
              cellHash(col, row, 13) * 3.1,
              cellHash(col, row, 17) * 3.1,
              cellHash(col, row, 19) * 3.1,
            ]}
          >
            <dodecahedronGeometry args={[0.62, 0]} />
            <meshStandardMaterial
              color={variedColor(ROCK_COLORS[tier], col, row)}
              roughness={0.6}
              metalness={0.15}
              flatShading
            />
          </mesh>,
        );
        continue;
      }
      if (cell.kind === "boulder") {
        const wobbling = !!cell.wobbling;
        blockMeshes.push(
          <mesh
            key={key}
            position={[x, y, 0]}
            rotation={[0, cellHash(col, row, 29) * 3.1, 0]}
            ref={
              wobbling
                ? (mesh: Mesh | null) => {
                    if (mesh) {
                      mesh.userData.baseX = x;
                      mesh.userData.baseY = y;
                      wobbleRefs.current.set(key, mesh);
                    } else {
                      wobbleRefs.current.delete(key);
                    }
                  }
                : undefined
            }
          >
            <icosahedronGeometry args={[0.56, 0]} />
            <meshStandardMaterial
              color={wobbling ? BOULDER_WOBBLE_COLOR : BOULDER_COLOR}
              emissive={wobbling ? BOULDER_WOBBLE_COLOR : "#000000"}
              emissiveIntensity={wobbling ? 0.45 : 0}
              roughness={0.8}
              flatShading
            />
          </mesh>,
        );
        continue;
      }
      if (cell.kind === "part-cache") {
        blockMeshes.push(
          <group key={key} position={[x, y, 0]}>
            <CacheCrate col={col} row={row} />
          </group>,
        );
        continue;
      }
      if (cell.kind === "gas") {
        blockMeshes.push(
          <RoundedBox
            key={key}
            args={[0.94, 0.94, 0.94]}
            radius={0.07}
            smoothness={2}
            position={[x, y, 0]}
          >
            <meshStandardMaterial
              color={variedColor(dirtColorAt(row), col, row).lerp(
                new Color(GAS_COLOR),
                0.45,
              )}
              emissive={GAS_COLOR}
              emissiveIntensity={0.12}
              roughness={0.7}
              flatShading
            />
          </RoundedBox>,
        );
        continue;
      }
      // Dirt: chunky beveled cube with stable per-cell tone variation.
      blockMeshes.push(
        <RoundedBox
          key={key}
          args={[0.94, 0.94, 0.94]}
          radius={0.07}
          smoothness={2}
          position={[x, y, 0]}
        >
          <meshStandardMaterial
            color={variedColor(dirtColorAt(row), col, row)}
            roughness={0.95}
            flatShading
          />
        </RoundedBox>,
      );
    }
  }

  return (
    <>
      <color attach="background" args={[bg]} />
      <fog attach="fog" args={[bg, 12, 26]} />
      <ambientLight ref={ambientRef} intensity={0.55} color="#cdd8f4" />
      <hemisphereLight ref={hemiRef} args={["#8fb4e8", "#2a2017", 0.5]} />
      <directionalLight ref={dirRef} position={[3, 6, 8]} intensity={1.1} />
      <group ref={rigRef}>
        {/* Cave backdrop tracks the camera so depth never shows raw void. */}
        <mesh position={[0, 0, -5]}>
          <planeGeometry args={[60, 44]} />
          <meshStandardMaterial color="#05060a" roughness={1} />
        </mesh>
      </group>
      {tunnelMeshes}
      {blockMeshes}
      {crackMeshes}
      {/* The elevator rail (REQ-028): guides and ties down the bored
          shaft, rendered for the visible span of the bought rail. */}
      {mine.gear.elevator > 0 &&
        (() => {
          const railTop = Math.max(1, firstRow);
          const railBottom = Math.min(mine.gear.elevator, lastRow);
          if (railBottom < railTop) return null;
          const mid = -(railTop + railBottom) / 2;
          const span = railBottom - railTop + 1;
          const ties = [];
          for (let r = railTop; r <= railBottom; r += 2) {
            ties.push(
              <mesh key={r} position={[ELEVATOR_COL, -r, -0.3]}>
                <boxGeometry args={[0.7, 0.06, 0.1]} />
                <meshStandardMaterial
                  color="#6b7baa"
                  roughness={0.6}
                  metalness={0.4}
                  flatShading
                />
              </mesh>,
            );
          }
          return (
            <group>
              {[-0.32, 0.32].map((rx) => (
                <mesh key={rx} position={[ELEVATOR_COL + rx, mid, -0.3]}>
                  <boxGeometry args={[0.07, span, 0.07]} />
                  <meshStandardMaterial
                    color="#9aa7ff"
                    roughness={0.45}
                    metalness={0.5}
                    flatShading
                  />
                </mesh>
              ))}
              {ties}
            </group>
          );
        })()}
      <group ref={particlesRef}>
        {juice.current.particles.map((p) => (
          <mesh key={p.id} position={[p.x, p.y, 0.4]} userData={{ id: p.id }}>
            <boxGeometry args={[p.size, p.size, p.size]} />
            <meshStandardMaterial
              color={p.color}
              emissive={p.color}
              emissiveIntensity={
                p.kind === "spark" ? 1.8 : p.kind === "debris" ? 0.4 : 0.05
              }
              flatShading
            />
          </mesh>
        ))}
      </group>
      {/* Night meadow backdrop behind the walk row: the bot, the
          stalls, and the grass all share one ground line now (the old
          raised shelf made the surface read as a pit). */}
      <mesh position={[0, 0, -0.42]}>
        <boxGeometry args={[CAMP_WIDTH, 1.04, 0.12]} />
        <meshStandardMaterial color="#10130d" roughness={1} />
      </mesh>
      <SurfaceDressing
        activeCol={mine.miner.row === 0 ? mine.miner.col : null}
      />
      {/* The miner bot. No position prop: useFrame owns the transform. */}
      <group ref={minerRef}>
        <MinerBot
          bodyRef={minerBodyRef}
          armRef={pickArmRef}
          lampRef={lampRef}
          motesRef={motesRef}
        />
      </group>
    </>
  );
}

export default function MineCanvas() {
  return (
    <Canvas
      camera={{ position: [0, 1.5, 13], fov: 42 }}
      dpr={[1, 2]}
      gl={createWebGPU}
    >
      <MineScene />
    </Canvas>
  );
}
