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
  PointLight,
} from "three/webgpu";
import { Color } from "three/webgpu";
import { createWebGPU } from "@/components/part-visuals";
import {
  cellAt,
  ELEVATOR_COL,
  FALL_DELAY_ACTIONS,
  hitsFor,
  isVisible,
  type OreId,
  START_COL,
  STRATA,
  stratumAt,
} from "@/sim/mine";
import { useMineStore } from "@/state/mine-store";
import { DESTINATIONS, type DestinationDef } from "./mine-destinations";
import { playMineResultSfx } from "./mine-sfx";
import { STALLS, type StallDef } from "./mine-stalls";

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
const STRATA_DIRT = [
  "#7a5a3a",
  "#8c5a45",
  "#6e6862",
  "#4f5d6e",
  "#5a3a35",
  "#4a4448",
  "#2f2c33",
  "#3a4452",
  "#52303f",
];
/** Background deepens with the strata so descent reads at the edges. */
const STRATA_BG = [
  "#0b0e14",
  "#0d0c12",
  "#0a0a10",
  "#070a12",
  "#100809",
  "#0c0a0e",
  "#060608",
  "#05080d",
  "#120608",
];

/** Rock darkens by tier so the hard gates read at a glance. */
const ROCK_COLORS = ["#555e6e", "#46506a", "#3b3550"];
const CACHE_COLOR = "#f5c542";
const BOULDER_COLOR = "#8a7f70";
const BOULDER_WOBBLE_COLOR = "#b59f82";
/** Warm warning glow on a rock or boulder that is about to drop. */
const TEETER_EMISSIVE = "#d9863a";
const GAS_COLOR = "#8fa32e";
const MAGMA_COLOR = "#ff5a2e";

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
  /** Seconds left in the too-hard pick bounce (overrides swing). */
  bounce: number;
  /** Lateral facing: -1 left, 1 right, 0 camera-facing. */
  facing: number;
  /** Dig lunge: body offset toward the struck cell, decaying. */
  lunge: { x: number; y: number; t: number };
}

/** Length of the bounce-off animation when the pick can't cut the rock. */
const BOUNCE_SECONDS = 0.42;
const DYNAMITE_RED = "#b43b32";
const FUSE_GLOW = "#ffb347";
const DYNAMITE_WARNING = TEETER_EMISSIVE;

/** World coordinates ARE render coordinates in the endless mine. */
const cellX = (col: number) => col;
/** Columns rendered to either side of the miner: the widest desktop
 * frustum sees ~8.2, so 9 covers every aspect with glide margin while
 * keeping the mesh count near the old fixed-width world. */
const VIEW_COLS = 9;
/** Width of the dressed surface camp strip around the origin. */
const CAMP_WIDTH = 60;

function DynamiteCharge({ col, row }: { col: number; row: number }) {
  const bodyRef = useRef<Group>(null);
  const warningRef = useRef<Mesh>(null);
  const sparkRef = useRef<Mesh>(null);
  const lightRef = useRef<PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const pulse = 0.5 + 0.5 * Math.sin(t * 12);
    if (bodyRef.current) {
      const scale = 1 + pulse * 0.08;
      bodyRef.current.scale.setScalar(scale);
      bodyRef.current.rotation.z = Math.sin(t * 18) * 0.035;
    }
    if (warningRef.current) {
      warningRef.current.scale.setScalar(0.7 + pulse * 0.45);
      warningRef.current.rotation.z = t * 1.8;
    }
    if (sparkRef.current) {
      const spark = 0.75 + 0.45 * Math.sin(t * 31);
      sparkRef.current.position.x = 0.2 + Math.sin(t * 9) * 0.035;
      sparkRef.current.position.y = 0.18 + Math.abs(Math.sin(t * 14)) * 0.08;
      sparkRef.current.scale.setScalar(spark);
    }
    if (lightRef.current) lightRef.current.intensity = 0.8 + pulse * 1.4;
  });
  return (
    <group position={[cellX(col), -row, 0.78]}>
      <mesh ref={warningRef} position={[0, 0, -0.05]}>
        <circleGeometry args={[0.44, 18]} />
        <meshBasicMaterial
          color={DYNAMITE_WARNING}
          transparent
          opacity={0.24}
          depthWrite={false}
        />
      </mesh>
      <group ref={bodyRef}>
        {[-0.07, 0.07].map((dy) => (
          <mesh key={dy} position={[0, dy, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.055, 0.055, 0.48, 8]} />
            <meshStandardMaterial
              color={DYNAMITE_RED}
              emissive={DYNAMITE_RED}
              emissiveIntensity={0.15}
              roughness={0.55}
              flatShading
            />
          </mesh>
        ))}
        <mesh position={[-0.2, 0, 0.02]}>
          <boxGeometry args={[0.05, 0.28, 0.05]} />
          <meshStandardMaterial color="#3a2520" roughness={0.8} flatShading />
        </mesh>
        <mesh position={[0.16, 0.14, 0.04]} rotation={[0, 0, 0.45]}>
          <boxGeometry args={[0.28, 0.03, 0.03]} />
          <meshStandardMaterial color="#1f1712" roughness={0.9} flatShading />
        </mesh>
        <mesh ref={sparkRef} position={[0.22, 0.24, 0.08]}>
          <octahedronGeometry args={[0.085, 0]} />
          <meshStandardMaterial
            color={FUSE_GLOW}
            emissive={FUSE_GLOW}
            emissiveIntensity={2.4}
            flatShading
          />
        </mesh>
      </group>
      <pointLight
        ref={lightRef}
        position={[0.2, 0.2, 0.3]}
        color={FUSE_GLOW}
        intensity={1.2}
        distance={3}
        decay={1.7}
      />
    </group>
  );
}

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

/**
 * A cold metallic shower when the pick glances off rock too hard to cut:
 * steel-white sparks spraying back toward the miner (no rock chips fly,
 * nothing breaks), keyed cool to read apart from a hot, successful hit.
 */
function spawnClang(
  juice: JuiceState,
  x: number,
  y: number,
  awayX: number,
  awayY: number,
): void {
  for (let i = 0; i < 10; i++) {
    pushParticle(juice, {
      kind: "spark",
      x: x + (Math.random() - 0.5) * 0.3,
      y: y + (Math.random() - 0.5) * 0.3,
      vx: awayX * (2 + Math.random() * 3.5) + (Math.random() - 0.5) * 2.4,
      vy: awayY * (2 + Math.random() * 3.5) + (Math.random() - 0.5) * 2.4 + 0.6,
      gravity: 13,
      size: 0.045 + Math.random() * 0.05,
      color: i % 3 === 0 ? "#fff4cc" : "#cfe1ff",
      life: 0.12 + Math.random() * 0.16,
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

function FallingRockShard({
  col,
  row,
  urgency,
}: {
  col: number;
  row: number;
  urgency: number;
}) {
  const tilt = (cellHash(col, row, 83) - 0.5) * 0.7;
  const glow = urgency > 0 ? 0.2 + 0.55 * urgency : 0.05;
  return (
    <group rotation={[0.15, 0, tilt]}>
      <mesh position={[0, -0.02, 0]} scale={[0.9, 1.08, 0.72]}>
        <coneGeometry args={[0.48, 0.92, 5]} />
        <meshStandardMaterial
          color="#7d4a3c"
          emissive={TEETER_EMISSIVE}
          emissiveIntensity={glow}
          roughness={0.72}
          metalness={0.08}
          flatShading
        />
      </mesh>
      <mesh position={[-0.2, 0.2, 0.2]} rotation={[0.7, 0.4, -0.2]}>
        <coneGeometry args={[0.18, 0.45, 4]} />
        <meshStandardMaterial
          color="#a45f43"
          emissive={TEETER_EMISSIVE}
          emissiveIntensity={glow * 0.7}
          roughness={0.7}
          flatShading
        />
      </mesh>
      <mesh position={[0.22, -0.18, 0.24]} rotation={[-0.5, 0.2, 0.6]}>
        <boxGeometry args={[0.18, 0.52, 0.2]} />
        <meshStandardMaterial color="#4d3637" roughness={0.86} flatShading />
      </mesh>
    </group>
  );
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
/** One articulated leg: a hip pivot (ref'd, swung by useFrame) holding
 * a thigh, a shin, and a chunky foot. Mirror with `side` = -1 or 1. */
function MinerLeg({
  side,
  legRef,
}: {
  side: number;
  legRef: React.RefObject<Group | null>;
}) {
  return (
    // Hip pivot. useFrame swings this group's X rotation for the stride;
    // the foot bottoms at child-space y ~ -0.36, the old tread floor.
    <group ref={legRef} position={[0.12 * side, -0.14, 0]}>
      {/* Hip servo */}
      <mesh>
        <cylinderGeometry args={[0.055, 0.055, 0.12, 8]} />
        <meshStandardMaterial
          color="#3a3f4d"
          metalness={0.4}
          roughness={0.6}
          flatShading
        />
      </mesh>
      {/* Thigh */}
      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[0.08, 0.11, 0.09]} />
        <meshStandardMaterial color="#2b2f3a" roughness={0.8} flatShading />
      </mesh>
      {/* Knee */}
      <mesh position={[0, -0.115, 0]}>
        <icosahedronGeometry args={[0.04, 0]} />
        <meshStandardMaterial
          color="#54e0c7"
          emissive="#1a4f47"
          roughness={0.5}
          flatShading
        />
      </mesh>
      {/* Shin */}
      <mesh position={[0, -0.15, 0.005]}>
        <boxGeometry args={[0.07, 0.1, 0.08]} />
        <meshStandardMaterial color="#3a3f4d" roughness={0.8} flatShading />
      </mesh>
      {/* Foot */}
      <mesh position={[0, -0.195, 0.03]}>
        <boxGeometry args={[0.12, 0.05, 0.16]} />
        <meshStandardMaterial color="#23262f" roughness={0.9} flatShading />
      </mesh>
    </group>
  );
}

function MinerBot({
  bodyRef,
  armRef,
  lampRef,
  motesRef,
  legLRef,
  legRRef,
}: {
  bodyRef: React.RefObject<Group | null>;
  armRef: React.RefObject<Group | null>;
  lampRef: React.RefObject<PointLight | null>;
  motesRef: React.RefObject<Group | null>;
  legLRef: React.RefObject<Group | null>;
  legRRef: React.RefObject<Group | null>;
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
        {/* Pelvis the legs hang from (replaces the old tread chassis) */}
        <mesh position={[0, -0.13, 0]}>
          <boxGeometry args={[0.34, 0.12, 0.26]} />
          <meshStandardMaterial color="#2b2f3a" roughness={0.85} flatShading />
        </mesh>
        <MinerLeg side={-1} legRef={legLRef} />
        <MinerLeg side={1} legRef={legRRef} />
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

/* ---- Village building kit (REQ-021): one distinct model per stall.
 * Shared frame: every group sits at z -0.85 so the boardwalk and the
 * miner's walk row (z 0) stay clearly in front of every facade; the
 * ground line is at local y ~1.06. ---- */

const TIMBER = "#5a4632";
const TIMBER_DARK = "#3a2c1e";
const WOOD_POST = "#4a3424";
const STONE = "#6e7078";
const STONE_LIGHT = "#9a9dab";
const METAL = "#8a8f9c";

/** Emissive name board; brightens while the stall menu is open. */
function SignBoard({
  color,
  position,
  width = 0.78,
}: {
  color: string;
  position: [number, number, number];
  width?: number;
}) {
  return (
    <mesh position={position}>
      <boxGeometry args={[width, 0.2, 0.06]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.95}
        flatShading
      />
    </mesh>
  );
}

/** Doorway recess with a warm glow while the shop is open. */
function DoorGlow({
  position,
  size = [0.4, 0.62],
}: {
  position: [number, number, number];
  size?: [number, number];
}) {
  return (
    <mesh position={position}>
      <boxGeometry args={[size[0], size[1], 0.05]} />
      <meshStandardMaterial
        color="#2e2410"
        emissive="#ffd9a0"
        emissiveIntensity={0.3}
        roughness={1}
        flatShading
      />
    </mesh>
  );
}

/** Warm porch lamp marking a doorway at night. */
function PorchLamp({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position}>
      <icosahedronGeometry args={[0.07, 0]} />
      <meshStandardMaterial
        color="#ffe9a8"
        emissive="#ffd9a0"
        emissiveIntensity={1.8}
        flatShading
      />
    </mesh>
  );
}

/** Elevator: timber derrick with a sheave wheel over a drum cabin. */
function ElevatorModel({ color }: { color: string }) {
  return (
    <>
      <RoundedBox
        args={[1.3, 0.85, 0.85]}
        radius={0.05}
        smoothness={2}
        position={[0, 1.48, 0]}
      >
        <meshStandardMaterial color={TIMBER} roughness={0.9} flatShading />
      </RoundedBox>
      <DoorGlow position={[0.3, 1.4, 0.41]} />
      <PorchLamp position={[0.62, 1.78, 0.4]} />
      {/* Derrick legs and cross-braces rising off the cabin roof */}
      <mesh position={[-0.46, 2.55, 0]} rotation={[0, 0, 0.16]}>
        <boxGeometry args={[0.12, 1.6, 0.12]} />
        <meshStandardMaterial color={WOOD_POST} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0.46, 2.55, 0]} rotation={[0, 0, -0.16]}>
        <boxGeometry args={[0.12, 1.6, 0.12]} />
        <meshStandardMaterial color={WOOD_POST} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0, 2.32, 0]} rotation={[0, 0, 0.55]}>
        <boxGeometry args={[0.95, 0.07, 0.07]} />
        <meshStandardMaterial color={TIMBER_DARK} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0, 2.32, 0]} rotation={[0, 0, -0.55]}>
        <boxGeometry args={[0.95, 0.07, 0.07]} />
        <meshStandardMaterial color={TIMBER_DARK} roughness={0.9} flatShading />
      </mesh>
      {/* Crown platform, pulley wheel, cable, and the cable drum */}
      <mesh position={[0, 3.36, 0]}>
        <boxGeometry args={[0.74, 0.1, 0.4]} />
        <meshStandardMaterial color={TIMBER_DARK} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0, 3.6, 0]}>
        <torusGeometry args={[0.26, 0.05, 8, 18]} />
        <meshStandardMaterial
          color={METAL}
          metalness={0.5}
          roughness={0.4}
          flatShading
        />
      </mesh>
      <mesh position={[0, 3.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.14, 8]} />
        <meshStandardMaterial color="#3a3f4d" flatShading />
      </mesh>
      <mesh position={[0, 2.8, 0]}>
        <boxGeometry args={[0.03, 1.6, 0.03]} />
        <meshStandardMaterial color="#23262f" flatShading />
      </mesh>
      <mesh position={[0, 2.0, 0.18]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.16, 0.16, 0.5, 10]} />
        <meshStandardMaterial color="#6b4a2a" roughness={0.7} flatShading />
      </mesh>
      {/* Beacon lamp so the tallest silhouette reads at night */}
      <mesh position={[0, 3.78, 0]}>
        <icosahedronGeometry args={[0.06, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.8}
          flatShading
        />
      </mesh>
      <SignBoard color={color} position={[-0.3, 1.78, 0.44]} width={0.6} />
    </>
  );
}

/** Buyer: a stone bank with columns and a gold emblem. */
function BuyerModel({ color }: { color: string }) {
  return (
    <>
      <RoundedBox
        args={[1.5, 1.15, 0.9]}
        radius={0.04}
        smoothness={2}
        position={[0, 1.62, 0]}
      >
        <meshStandardMaterial color={STONE} roughness={0.85} flatShading />
      </RoundedBox>
      {/* Cornice and pediment */}
      <mesh position={[0, 2.26, 0]}>
        <boxGeometry args={[1.66, 0.14, 1.0]} />
        <meshStandardMaterial color={STONE_LIGHT} roughness={0.8} flatShading />
      </mesh>
      <mesh
        position={[0, 2.45, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[1, 1, 0.55]}
      >
        <cylinderGeometry args={[0.62, 0.62, 0.7, 3, 1, false, Math.PI]} />
        <meshStandardMaterial color={STONE_LIGHT} roughness={0.8} flatShading />
      </mesh>
      {/* Gold emblem on the pediment face */}
      <mesh position={[0, 2.45, 0.4]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 0.05, 12]} />
        <meshStandardMaterial
          color="#f5c542"
          emissive="#f5c542"
          emissiveIntensity={0.7}
          metalness={0.5}
          roughness={0.3}
          flatShading
        />
      </mesh>
      {/* Portico: columns and architrave around the door */}
      <mesh position={[-0.4, 1.56, 0.42]}>
        <cylinderGeometry args={[0.085, 0.1, 0.92, 8]} />
        <meshStandardMaterial color={STONE_LIGHT} roughness={0.7} flatShading />
      </mesh>
      <mesh position={[0.4, 1.56, 0.42]}>
        <cylinderGeometry args={[0.085, 0.1, 0.92, 8]} />
        <meshStandardMaterial color={STONE_LIGHT} roughness={0.7} flatShading />
      </mesh>
      <mesh position={[0, 2.08, 0.42]}>
        <boxGeometry args={[1.06, 0.12, 0.2]} />
        <meshStandardMaterial color={STONE_LIGHT} roughness={0.7} flatShading />
      </mesh>
      <DoorGlow position={[0, 1.42, 0.47]} size={[0.44, 0.68]} />
      <PorchLamp position={[0, 1.9, 0.52]} />
      {/* Lit side windows */}
      <mesh position={[-0.58, 1.75, 0.46]}>
        <boxGeometry args={[0.22, 0.28, 0.04]} />
        <meshStandardMaterial
          color="#2a1c0c"
          emissive="#ffd9a0"
          emissiveIntensity={0.4}
          flatShading
        />
      </mesh>
      <mesh position={[0.58, 1.75, 0.46]}>
        <boxGeometry args={[0.22, 0.28, 0.04]} />
        <meshStandardMaterial
          color="#2a1c0c"
          emissive="#ffd9a0"
          emissiveIntensity={0.4}
          flatShading
        />
      </mesh>
      {/* Entry steps down to the boardwalk */}
      <mesh position={[0, 1.1, 0.6]}>
        <boxGeometry args={[0.86, 0.09, 0.46]} />
        <meshStandardMaterial color={STONE} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0, 1.19, 0.52]}>
        <boxGeometry args={[0.64, 0.09, 0.3]} />
        <meshStandardMaterial color={STONE} roughness={0.9} flatShading />
      </mesh>
      <SignBoard color={color} position={[0, 2.26, 0.55]} width={0.8} />
    </>
  );
}

/** Supply Depot: open-front trade post with goods on the counter. */
function SupplyDepotModel({ color }: { color: string }) {
  return (
    <>
      <RoundedBox
        args={[1.55, 1.0, 0.9]}
        radius={0.05}
        smoothness={2}
        position={[0, 1.55, 0]}
      >
        <meshStandardMaterial color={TIMBER} roughness={0.9} flatShading />
      </RoundedBox>
      <mesh position={[0, 2.1, 0]} rotation={[0, 0, 0.05]}>
        <boxGeometry args={[1.75, 0.08, 1.0]} />
        <meshStandardMaterial
          color={TIMBER_DARK}
          roughness={0.95}
          flatShading
        />
      </mesh>
      {/* Open shopfront: dark interior warmed by lamplight when open */}
      <mesh position={[0, 1.5, 0.43]}>
        <boxGeometry args={[1.05, 0.58, 0.05]} />
        <meshStandardMaterial
          color="#171209"
          emissive="#ffd9a0"
          emissiveIntensity={0.22}
          roughness={1}
          flatShading
        />
      </mesh>
      <mesh position={[0, 1.24, 0.5]}>
        <boxGeometry args={[1.05, 0.08, 0.18]} />
        <meshStandardMaterial color={WOOD_POST} roughness={0.9} flatShading />
      </mesh>
      {/* Counter goods: dynamite, rope coil, crate */}
      <mesh position={[-0.3, 1.37, 0.48]}>
        <cylinderGeometry args={[0.045, 0.045, 0.16, 6]} />
        <meshStandardMaterial color="#ff6b6b" roughness={0.6} flatShading />
      </mesh>
      <mesh position={[0, 1.31, 0.48]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.07, 0.03, 6, 10]} />
        <meshStandardMaterial color="#c9a86a" roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0.3, 1.35, 0.48]}>
        <boxGeometry args={[0.16, 0.12, 0.12]} />
        <meshStandardMaterial color="#f5c542" roughness={0.7} flatShading />
      </mesh>
      {/* Canvas awning over the counter */}
      <mesh position={[0, 1.95, 0.58]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[1.45, 0.05, 0.5]} />
        <meshStandardMaterial color="#d97f2e" roughness={0.95} flatShading />
      </mesh>
      <PorchLamp position={[0, 1.74, 0.62]} />
      <mesh position={[-0.62, 1.42, 0.66]}>
        <cylinderGeometry args={[0.03, 0.03, 0.75, 6]} />
        <meshStandardMaterial color={WOOD_POST} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0.62, 1.42, 0.66]}>
        <cylinderGeometry args={[0.03, 0.03, 0.75, 6]} />
        <meshStandardMaterial color={WOOD_POST} roughness={0.9} flatShading />
      </mesh>
      {/* Stock spilling out beside the shopfront */}
      <RoundedBox
        args={[0.3, 0.3, 0.3]}
        radius={0.03}
        smoothness={2}
        position={[-0.95, 1.2, 0.25]}
      >
        <meshStandardMaterial color={TIMBER} roughness={0.85} flatShading />
      </RoundedBox>
      <mesh position={[0.95, 1.2, 0.25]}>
        <cylinderGeometry args={[0.14, 0.17, 0.3, 9]} />
        <meshStandardMaterial color="#7a5230" roughness={0.85} flatShading />
      </mesh>
      <SignBoard color={color} position={[0, 2.28, 0.2]} width={0.9} />
    </>
  );
}

/** Upgrades: a smithy with a glowing forge window and chimney. */
function UpgradesModel({ color }: { color: string }) {
  return (
    <>
      <RoundedBox
        args={[1.35, 0.95, 0.9]}
        radius={0.05}
        smoothness={2}
        position={[0, 1.5, 0]}
      >
        <meshStandardMaterial color="#5c5045" roughness={0.9} flatShading />
      </RoundedBox>
      <mesh position={[0, 2.1, 0]} rotation={[0, 0, 0.18]}>
        <boxGeometry args={[1.6, 0.08, 1.0]} />
        <meshStandardMaterial color="#2f2620" roughness={0.95} flatShading />
      </mesh>
      {/* Chimney with embers on the high side of the shed roof */}
      <mesh position={[-0.42, 2.5, -0.05]}>
        <boxGeometry args={[0.22, 0.8, 0.22]} />
        <meshStandardMaterial color={STONE} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[-0.42, 2.92, -0.05]}>
        <boxGeometry args={[0.15, 0.05, 0.15]} />
        <meshStandardMaterial
          color="#33150a"
          emissive="#ff7a3c"
          emissiveIntensity={1.5}
          flatShading
        />
      </mesh>
      <DoorGlow position={[0.28, 1.36, 0.44]} />
      <PorchLamp position={[0.55, 1.7, 0.46]} />
      {/* Forge window: always glowing, the smith never sleeps */}
      <mesh position={[-0.32, 1.6, 0.46]}>
        <boxGeometry args={[0.32, 0.28, 0.04]} />
        <meshStandardMaterial
          color="#331b08"
          emissive="#ffb066"
          emissiveIntensity={0.9}
          flatShading
        />
      </mesh>
      {/* Anvil out front */}
      <mesh position={[0.82, 1.13, 0.28]}>
        <boxGeometry args={[0.16, 0.14, 0.14]} />
        <meshStandardMaterial color="#3a3f4d" roughness={0.6} flatShading />
      </mesh>
      <mesh position={[0.82, 1.25, 0.28]}>
        <boxGeometry args={[0.3, 0.09, 0.11]} />
        <meshStandardMaterial
          color={METAL}
          metalness={0.6}
          roughness={0.3}
          flatShading
        />
      </mesh>
      {/* Pick leaning on the wall */}
      <mesh position={[-0.78, 1.27, 0.3]} rotation={[0, 0, 0.35]}>
        <cylinderGeometry args={[0.018, 0.018, 0.42, 6]} />
        <meshStandardMaterial color="#6b4a2a" roughness={0.9} flatShading />
      </mesh>
      <mesh position={[-0.84, 1.47, 0.3]} rotation={[0, 0, 0.85]}>
        <boxGeometry args={[0.16, 0.04, 0.04]} />
        <meshStandardMaterial
          color={METAL}
          metalness={0.6}
          roughness={0.3}
          flatShading
        />
      </mesh>
      <SignBoard color={color} position={[0, 1.92, 0.5]} width={0.7} />
    </>
  );
}

/** Warp Pad: a humming arch and crystal, nothing like the timber row. */
function WarpPadModel({ color }: { color: string }) {
  return (
    <>
      <mesh position={[0, 1.12, 0]} scale={[1, 1, 0.62]}>
        <cylinderGeometry args={[0.8, 0.9, 0.18, 10]} />
        <meshStandardMaterial
          color="#3a3050"
          metalness={0.3}
          roughness={0.6}
          flatShading
        />
      </mesh>
      <mesh position={[0, 2.0, 0]}>
        <torusGeometry args={[0.55, 0.055, 10, 28]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.7}
          metalness={0.3}
          roughness={0.4}
          flatShading
        />
      </mesh>
      <mesh position={[0, 2.0, 0]} scale={[1, 1.5, 1]}>
        <octahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={2.0}
          flatShading
        />
      </mesh>
      {/* Emitter pylons flanking the arch */}
      <mesh position={[-0.85, 1.55, 0]}>
        <boxGeometry args={[0.15, 0.85, 0.15]} />
        <meshStandardMaterial color="#473a5e" roughness={0.7} flatShading />
      </mesh>
      <mesh position={[0.85, 1.55, 0]}>
        <boxGeometry args={[0.15, 0.85, 0.15]} />
        <meshStandardMaterial color="#473a5e" roughness={0.7} flatShading />
      </mesh>
      <mesh position={[-0.85, 2.02, 0]}>
        <icosahedronGeometry args={[0.07, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.8}
          flatShading
        />
      </mesh>
      <mesh position={[0.85, 2.02, 0]}>
        <icosahedronGeometry args={[0.07, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.8}
          flatShading
        />
      </mesh>
      {/* Power conduit and control console */}
      <mesh position={[0, 1.2, 0.12]}>
        <boxGeometry args={[1.55, 0.05, 0.05]} />
        <meshStandardMaterial
          color="#1c1626"
          emissive={color}
          emissiveIntensity={0.5}
          flatShading
        />
      </mesh>
      <mesh position={[0.55, 1.32, 0.3]}>
        <boxGeometry args={[0.2, 0.32, 0.16]} />
        <meshStandardMaterial color="#23262f" roughness={0.6} flatShading />
      </mesh>
      <mesh position={[0.55, 1.42, 0.39]}>
        <boxGeometry args={[0.14, 0.1, 0.02]} />
        <meshStandardMaterial
          color="#0d2b26"
          emissive="#7df9ff"
          emissiveIntensity={1.2}
          flatShading
        />
      </mesh>
    </>
  );
}

/** A village stall: each shop gets its own distinct structure. The
 * village is static (the tap-to-open prompt signals the active shop),
 * so the memoized SurfaceDressing never reconciles while walking. */
function StallBuilding({
  id,
  x,
  color,
}: {
  id: StallDef["id"];
  x: number;
  color: string;
}) {
  return (
    <group position={[x, -1.5, -0.85]}>
      {id === "elevator" && <ElevatorModel color={color} />}
      {id === "buyer" && <BuyerModel color={color} />}
      {id === "supply" && <SupplyDepotModel color={color} />}
      {id === "upgrades" && <UpgradesModel color={color} />}
      {id === "warp" && <WarpPadModel color={color} />}
      {/* Doorstep mat on the boardwalk marks the standing spot */}
      <mesh position={[0, 1.1, 0.9]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.8, 0.5]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.26}
          transparent
          opacity={0.55}
        />
      </mesh>
    </group>
  );
}

/** Workshop: a tin-roofed garage with a roll-up door and a lit bench. */
function WorkshopModel({ color }: { color: string }) {
  return (
    <>
      <RoundedBox
        args={[1.6, 1.2, 0.95]}
        radius={0.05}
        smoothness={2}
        position={[0, 1.6, 0]}
      >
        <meshStandardMaterial
          color={METAL}
          roughness={0.7}
          metalness={0.3}
          flatShading
        />
      </RoundedBox>
      {/* Corrugated roof cap */}
      <mesh position={[0, 2.28, 0]}>
        <boxGeometry args={[1.78, 0.12, 1.05]} />
        <meshStandardMaterial
          color={STONE}
          roughness={0.6}
          metalness={0.4}
          flatShading
        />
      </mesh>
      {/* Roll-up door with a warm interior glow */}
      <mesh position={[0, 1.34, 0.49]}>
        <boxGeometry args={[1.0, 0.86, 0.05]} />
        <meshStandardMaterial
          color="#2a2f3a"
          emissive="#7df9ff"
          emissiveIntensity={0.18}
          roughness={0.8}
          flatShading
        />
      </mesh>
      {[-0.24, -0.04, 0.16].map((dy) => (
        <mesh key={dy} position={[0, 1.34 + dy, 0.52]}>
          <boxGeometry args={[1.0, 0.03, 0.02]} />
          <meshStandardMaterial color="#1a1e27" flatShading />
        </mesh>
      ))}
      {/* Lit side window */}
      <mesh position={[0.62, 1.72, 0.4]}>
        <boxGeometry args={[0.26, 0.24, 0.04]} />
        <meshStandardMaterial
          color="#0d2b26"
          emissive="#7df9ff"
          emissiveIntensity={1.1}
          flatShading
        />
      </mesh>
      {/* A big gear bolted to the facade */}
      <mesh position={[-0.6, 1.8, 0.46]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.16, 0.05, 6, 10]} />
        <meshStandardMaterial
          color={color}
          metalness={0.5}
          roughness={0.5}
          flatShading
        />
      </mesh>
      <PorchLamp position={[0, 1.86, 0.6]} />
      <SignBoard color={color} position={[0, 2.5, 0.3]} width={0.95} />
    </>
  );
}

/** Battles: a small colosseum drum with banners over a lit floor. */
function BattlesModel({ color }: { color: string }) {
  return (
    <>
      <mesh position={[0, 1.5, 0]}>
        <cylinderGeometry args={[0.85, 0.92, 1.0, 16]} />
        <meshStandardMaterial color={STONE} roughness={0.9} flatShading />
      </mesh>
      {/* Rim */}
      <mesh position={[0, 2.02, 0]}>
        <torusGeometry args={[0.86, 0.08, 8, 18]} />
        <meshStandardMaterial color={STONE_LIGHT} roughness={0.8} flatShading />
      </mesh>
      {/* Glowing arched entrance */}
      <mesh position={[0, 1.34, 0.88]}>
        <boxGeometry args={[0.44, 0.62, 0.1]} />
        <meshStandardMaterial
          color="#160b06"
          emissive="#ff8f3a"
          emissiveIntensity={0.5}
          roughness={1}
          flatShading
        />
      </mesh>
      {/* Crossed swords over the door */}
      {[0.6, -0.6].map((r) => (
        <mesh key={r} position={[0, 1.96, 0.9]} rotation={[0, 0, r]}>
          <boxGeometry args={[0.05, 0.4, 0.03]} />
          <meshStandardMaterial
            color={STONE_LIGHT}
            metalness={0.6}
            roughness={0.4}
            flatShading
          />
        </mesh>
      ))}
      {/* Banner flags */}
      {[-0.72, 0.72].map((x) => (
        <group key={x} position={[x, 2.0, 0.25]}>
          <mesh position={[0, 0.28, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.8, 6]} />
            <meshStandardMaterial
              color={WOOD_POST}
              roughness={0.9}
              flatShading
            />
          </mesh>
          <mesh position={[x < 0 ? 0.13 : -0.13, 0.5, 0]}>
            <boxGeometry args={[0.24, 0.16, 0.02]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.6}
              flatShading
            />
          </mesh>
        </group>
      ))}
      <PorchLamp position={[0, 1.6, 0.95]} />
      <SignBoard color={color} position={[0, 2.52, 0.4]} width={0.95} />
    </>
  );
}

/** A destination building: walking onto its column shows an Enter prompt
 * that routes to another screen, instead of opening a stall sheet. */
function DestinationBuilding({
  id,
  x,
  color,
}: {
  id: DestinationDef["id"];
  x: number;
  color: string;
}) {
  return (
    <group position={[x, -1.5, -0.85]}>
      {id === "workshop" && <WorkshopModel color={color} />}
      {id === "battles" && <BattlesModel color={color} />}
      {/* Doorstep mat on the boardwalk marks the standing spot */}
      <mesh position={[0, 1.1, 0.9]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.8, 0.5]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.26}
          transparent
          opacity={0.55}
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
 * Memoized with no props, so it renders once and never reconciles on a
 * move tick. The per-step rebuild of this tree (heavier since the
 * detailed buildings landed) was the surface walk-by stutter.
 */
const SurfaceDressing = memo(function SurfaceDressing() {
  const tufts = [];
  for (let i = 0; i < 14; i++) {
    const h = cellHash(i, 97, 3);
    const x = (h - 0.5) * 30;
    // Keep grass off the boardwalk and the village frontage.
    if (Math.abs(x - 0.5) < 7.6) continue;
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
      {/* Boardwalk fronting the shop row, split around the shaft mouth.
          Each plank reaches the edge-of-town destination buildings. */}
      <mesh position={[-4.1, -0.44, -0.05]}>
        <boxGeometry args={[7.0, 0.05, 0.7]} />
        <meshStandardMaterial color="#6b5638" roughness={0.95} flatShading />
      </mesh>
      <mesh position={[4.6, -0.44, -0.05]}>
        <boxGeometry args={[8.0, 0.05, 0.7]} />
        <meshStandardMaterial color="#6b5638" roughness={0.95} flatShading />
      </mesh>
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
          id={stall.id}
          x={cellX(stall.col)}
          color={stall.color}
        />
      ))}
      {/* Enter-a-screen destination buildings (Workshop, Battles) */}
      {DESTINATIONS.map((dest) => (
        <DestinationBuilding
          key={dest.id}
          id={dest.id}
          x={cellX(dest.col)}
          color={dest.color}
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
  const legLRef = useRef<Group>(null);
  const legRRef = useRef<Group>(null);
  // Walk cadence: advanced by distance actually travelled so the stride
  // is foot-locked to the glide, plus the prior frame's position to
  // measure that distance.
  const walkPhase = useRef(0);
  const prevMinerPos = useRef<{ x: number; y: number } | null>(null);
  const lampRef = useRef<PointLight>(null);
  const ambientRef = useRef<AmbientLight>(null);
  const hemiRef = useRef<HemisphereLight>(null);
  const dirRef = useRef<DirectionalLight>(null);
  const particlesRef = useRef<Group>(null);
  const wobbleRefs = useRef<Map<string, Group | Mesh>>(new Map());
  const juice = useRef<JuiceState>({
    particles: [],
    nextId: 1,
    shake: 0,
    swing: 0,
    bounce: 0,
    facing: 0,
    lunge: { x: 0, y: 0, t: 0 },
  });
  const minerPlaced = useRef(false);
  // Smoothed frame time (ms), exposed for performance QA. A surface walk
  // must not spike this the way the per-step village rebuild used to.
  const frameMsRef = useRef(16);

  const minerRow = mine.miner.row;
  const firstRow = Math.max(0, minerRow - VIEW_ABOVE);
  const lastRow = minerRow + VIEW_BELOW;

  // Dig/blast feedback: bursts, shake, swing, and facing keyed to the
  // last sim result.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the event stream; the rest is read-at-fire
  useEffect(() => {
    const j = juice.current;
    playMineResultSfx(lastResult, lastAction);
    if (lastAction === "left" || lastAction === "dynamite-left") j.facing = -1;
    else if (lastAction === "right" || lastAction === "dynamite-right")
      j.facing = 1;
    else if (lastAction != null) j.facing = 0;
    // The starter pick glancing off rock it can't cut (REQ "too hard"):
    // a real swing that bounces back, a thud, a body recoil, and a cold
    // spark shower, so the wall reads as physically immovable, not just
    // as a toast. Nothing chips: no debris, no progress.
    if (lastResult && !lastResult.ok && lastResult.reason === "rock") {
      const miner = mine.miner;
      const dc = lastAction === "left" ? -1 : lastAction === "right" ? 1 : 0;
      const dr = lastAction === "down" ? 1 : lastAction === "up" ? -1 : 0;
      const sx = cellX(miner.col + dc);
      const sy = -(miner.row + dr);
      j.bounce = BOUNCE_SECONDS;
      // Recoil the body AWAY from the rock: the swing rebounds off it.
      j.lunge = { x: -dc * 0.14, y: dr * 0.12, t: 0.26 };
      j.shake = Math.max(j.shake, 0.14);
      // Sparks fly off the rock face back toward the miner.
      spawnClang(j, sx, sy, -dc, dr);
    }
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
    if (lastResult.exploded) {
      spawnBurst(
        j,
        cellX(lastResult.exploded.col),
        -lastResult.exploded.row,
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
      // The endless mine has no edges: the camera follows the miner
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
        // Gentler glide than before: with the halved move cadence the
        // bot has time to walk between cells instead of snapping.
        const ease = Math.min(1, delta * 9);
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
      // Smoothed frame time: a steady low value means no per-step hitches.
      frameMsRef.current += (delta * 1000 - frameMsRef.current) * 0.1;
      el.dataset.frameMs = frameMsRef.current.toFixed(1);
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
    // Legs: a foot-locked walk cycle. The stride advances by the
    // distance actually travelled this frame (no skating), and the legs
    // ease back to a neutral stance when the bot stands still or digs.
    const legL = legLRef.current;
    const legR = legRRef.current;
    if (legL && legR && miner) {
      const prev = prevMinerPos.current;
      const dx = prev ? miner.position.x - prev.x : 0;
      const dy = prev ? miner.position.y - prev.y : 0;
      prevMinerPos.current = { x: miner.position.x, y: miner.position.y };
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Teleport-scale jumps (trip resets) must not spin the stride.
      const stepping = dist > 0.0006 && dist < 1;
      if (stepping) walkPhase.current += dist * 10;
      const ph = walkPhase.current;
      const amp = stepping ? 0.6 : 0;
      const k = Math.min(1, delta * 12);
      legL.rotation.x += (Math.sin(ph) * amp - legL.rotation.x) * k;
      legR.rotation.x += (Math.sin(ph + Math.PI) * amp - legR.rotation.x) * k;
      // The leg swinging forward lifts a touch off the cell floor.
      const lift = stepping ? 0.02 : 0;
      legL.position.y = -0.14 + Math.max(0, Math.sin(ph)) * lift;
      legR.position.y = -0.14 + Math.max(0, Math.sin(ph + Math.PI)) * lift;
    }
    const arm = pickArmRef.current;
    if (arm) {
      j.swing = Math.max(0, j.swing - delta);
      j.bounce = Math.max(0, j.bounce - delta);
      if (j.bounce > 0) {
        // Too-hard rock: the pick slams down then judders back up instead
        // of biting in. Two phases: a quick slam to impact, then a damped
        // rebound that kicks past rest and settles.
        const e = 1 - j.bounce / BOUNCE_SECONDS; // 0 -> 1 elapsed
        if (e < 0.32) {
          const p = e / 0.32; // raised to impact
          arm.rotation.z = -2 * (1 - p) * (1 - p);
        } else {
          const p = (e - 0.32) / 0.68; // rebound and settle
          arm.rotation.z = Math.sin(p * Math.PI) * 0.85 * (1 - p * 0.6);
        }
      } else {
        const k = j.swing / 0.3;
        arm.rotation.z = -2.1 * k * k;
      }
    }
    // Lamp-lit dust drifts around the bot underground.
    const motes = motesRef.current;
    if (motes) {
      motes.visible = minerRow > 0;
      motes.rotation.z = t * 0.12;
    }
    // Teetering rock and boulders tremble every frame, harder and faster
    // the closer they are to dropping (the escalating tell).
    for (const mesh of wobbleRefs.current.values()) {
      const urgency = (mesh.userData.urgency as number) ?? 1;
      mesh.position.x =
        (mesh.userData.baseX as number) +
        Math.sin(t * (22 + 16 * urgency) + (mesh.userData.baseY as number)) *
          (0.015 + 0.05 * urgency);
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
  // Register a teetering block's mesh so useFrame can tremble it; the
  // urgency (0..1, rising as the countdown nears zero) drives the shake.
  const teeterRef =
    (key: string, x: number, y: number, urgency: number) =>
    (mesh: Group | Mesh | null) => {
      if (mesh) {
        mesh.userData.baseX = x;
        mesh.userData.baseY = y;
        mesh.userData.urgency = urgency;
        wobbleRefs.current.set(key, mesh);
      } else {
        wobbleRefs.current.delete(key);
      }
    };
  const teeterUrgency = (fallIn: number) =>
    (FALL_DELAY_ACTIONS - fallIn + 1) / FALL_DELAY_ACTIONS;
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
        const teeter = cell.fallIn;
        const urgency = teeter !== undefined ? teeterUrgency(teeter) : 0;
        if (teeter !== undefined || cell.fallen) {
          blockMeshes.push(
            <group
              key={key}
              position={[x, y, 0]}
              ref={
                teeter !== undefined ? teeterRef(key, x, y, urgency) : undefined
              }
            >
              <FallingRockShard col={col} row={row} urgency={urgency} />
            </group>,
          );
          continue;
        }
        blockMeshes.push(
          <mesh
            key={key}
            position={[x, y, 0]}
            rotation={[
              cellHash(col, row, 13) * 3.1,
              cellHash(col, row, 17) * 3.1,
              cellHash(col, row, 19) * 3.1,
            ]}
            ref={
              teeter !== undefined ? teeterRef(key, x, y, urgency) : undefined
            }
          >
            <dodecahedronGeometry args={[0.62, 0]} />
            <meshStandardMaterial
              color={variedColor(ROCK_COLORS[tier], col, row)}
              emissive={teeter !== undefined ? TEETER_EMISSIVE : "#000000"}
              emissiveIntensity={
                teeter !== undefined ? 0.15 + 0.5 * urgency : 0
              }
              roughness={0.6}
              metalness={0.15}
              flatShading
            />
          </mesh>,
        );
        continue;
      }
      if (cell.kind === "boulder") {
        const teeter = cell.fallIn;
        const urgency = teeter !== undefined ? teeterUrgency(teeter) : 0;
        blockMeshes.push(
          <mesh
            key={key}
            position={[x, y, 0]}
            rotation={[0, cellHash(col, row, 29) * 3.1, 0]}
            ref={
              teeter !== undefined ? teeterRef(key, x, y, urgency) : undefined
            }
          >
            <icosahedronGeometry args={[0.56, 0]} />
            <meshStandardMaterial
              color={
                teeter !== undefined ? BOULDER_WOBBLE_COLOR : BOULDER_COLOR
              }
              emissive={teeter !== undefined ? TEETER_EMISSIVE : "#000000"}
              emissiveIntensity={teeter !== undefined ? 0.2 + 0.5 * urgency : 0}
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
      if (cell.kind === "magma") {
        blockMeshes.push(
          <RoundedBox
            key={key}
            args={[0.94, 0.94, 0.94]}
            radius={0.07}
            smoothness={2}
            position={[x, y, 0]}
          >
            <meshStandardMaterial
              color={variedColor("#5a2418", col, row)}
              emissive={MAGMA_COLOR}
              emissiveIntensity={0.55}
              roughness={0.6}
              flatShading
            />
          </RoundedBox>,
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
  const charge = mine.pendingDynamite;
  if (
    charge &&
    isVisible(mine, charge.row) &&
    charge.row >= firstRow &&
    charge.row <= lastRow &&
    charge.col >= mine.miner.col - VIEW_COLS &&
    charge.col <= mine.miner.col + VIEW_COLS
  ) {
    blockMeshes.push(
      <DynamiteCharge
        key={`dynamite:${charge.col}:${charge.row}`}
        col={charge.col}
        row={charge.row}
      />,
    );
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
      {/* Night meadow backdrop behind the village row: the bot, the
          stalls, and the grass all share one ground line now (the old
          raised shelf made the surface read as a pit). Sits behind the
          deepest building footprint so no facade gets occluded. */}
      <mesh position={[0, 0, -1.55]}>
        <boxGeometry args={[CAMP_WIDTH, 1.04, 0.12]} />
        <meshStandardMaterial color="#10130d" roughness={1} />
      </mesh>
      <SurfaceDressing />
      {/* The miner bot. No position prop: useFrame owns the transform. */}
      <group ref={minerRef}>
        <MinerBot
          bodyRef={minerBodyRef}
          armRef={pickArmRef}
          lampRef={lampRef}
          motesRef={motesRef}
          legLRef={legLRef}
          legRRef={legRRef}
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
