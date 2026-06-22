"use client";

import { RoundedBox } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AmbientLight,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PointLight,
} from "three/webgpu";
import { Color, Shape } from "three/webgpu";
import {
  clampMineCameraZoom,
  maxMineCameraZoom,
  mineCameraDistance,
  mineDarknessOpacity,
  mineLampDistanceForRadius,
  mineRenderWindow,
} from "@/components/mine-camera";
import { createWebGPU } from "@/components/part-visuals";
import type {
  BasePartId,
  BunkerFootprint,
  BunkerRaidSnapshot,
  BunkerState,
} from "@/sim/bunker";
import { BASE_PART_CATALOG, containsBunkerCell } from "@/sim/bunker";
import {
  biomeAt,
  type CollectTarget,
  cellAt,
  ELEVATOR_COL,
  FALL_DELAY_ACTIONS,
  findPortalBeacons,
  hitsFor,
  isSupportSalvageTarget,
  lanternDistance,
  lightRadius,
  type MineBiomeId,
  type MineCell,
  type MineCoord,
  type MineState,
  type MoveResult,
  type OreId,
  oreReserveAt,
  START_COL,
  STRATA,
  stratumAt,
} from "@/sim/mine";
import { useMineStore } from "@/state/mine-store";
import { DESTINATIONS, type DestinationDef } from "./mine-destinations";
import { minerStepSeconds } from "./mine-pacing";
import { playMineResultSfx, playMineSfxEvent } from "./mine-sfx";
import { STALLS, type StallDef } from "./mine-stalls";

type BunkerBuildMode = "place" | "remove" | "move";

const ORE_COLORS: Record<OreId, string> = {
  coal: "#33343a",
  copper: "#c77b3f",
  silver: "#cfd6e0",
  emerald: "#2ecc71",
  ruby: "#e03358",
  diamond: "#8fe9f2",
  "core-crystal": "#b04df0",
  "frozen-coal": "#3d4f66",
  "frost-copper": "#b7d2dc",
  "rime-silver": "#e4f7ff",
  "aurora-emerald": "#7fffd4",
  "glacier-ruby": "#ff7fb0",
  "blue-diamond": "#9ee7ff",
  "permafrost-core": "#d6f8ff",
  "brass-knob": "#d8a24a",
  "wire-spool": "#ff7a45",
  "logic-chip": "#5df2a4",
  "micro-monitor": "#7aa8ff",
  "keyboard-matrix": "#e6e8ee",
  "servo-motor": "#a2b0c7",
  "quantum-core": "#65ffb8",
};

/** Rare tiers glow so a glimpse at the light's edge reads as treasure. */
const GLOWING_ORES = new Set<OreId>([
  "diamond",
  "core-crystal",
  "blue-diamond",
  "permafrost-core",
  "micro-monitor",
  "quantum-core",
]);

const BASE_FLOOR_RIB_X = [-0.28, 0, 0.28] as const;
const BASE_WALL_RAIL_Y = [-0.26, 0.26] as const;
const BASE_ROOF_RAFTER_SIDES = [-1, 1] as const;
const BASE_ROOF_SHINGLE_BANDS = [
  { y: -0.17, width: 0.68 },
  { y: -0.05, width: 0.5 },
  { y: 0.07, width: 0.32 },
] as const;
const BASE_DOOR_BRACE_Y = [-0.18, 0.18] as const;
const BASE_FLOOR_SPIKE_X = [-0.32, -0.16, 0, 0.16, 0.32] as const;
const CLANKER_LEGS = [
  { x: -0.32, side: -1, phase: 0 },
  { x: -0.1, side: -1, phase: 2.1 },
  { x: 0.14, side: -1, phase: 4.2 },
  { x: 0.34, side: -1, phase: 1.05 },
  { x: -0.32, side: 1, phase: 3.15 },
  { x: -0.1, side: 1, phase: 5.25 },
  { x: 0.14, side: 1, phase: 1.05 },
  { x: 0.34, side: 1, phase: 4.2 },
] as const;
const CLANKER_MANDIBLE_SIDES = [-1, 1] as const;
const CLANKER_BURST_SHARDS = [
  { x: -0.26, y: 0.08, angle: -0.55, scale: 0.75 },
  { x: 0.28, y: -0.03, angle: 0.42, scale: 0.68 },
  { x: -0.08, y: -0.31, angle: -0.15, scale: 0.58 },
  { x: 0.1, y: 0.3, angle: 0.9, scale: 0.62 },
] as const;

const BASE_ROOF_FACE_SHAPE = new Shape();
BASE_ROOF_FACE_SHAPE.moveTo(-0.46, -0.28);
BASE_ROOF_FACE_SHAPE.lineTo(-0.46, -0.1);
BASE_ROOF_FACE_SHAPE.lineTo(0, 0.34);
BASE_ROOF_FACE_SHAPE.lineTo(0.46, -0.1);
BASE_ROOF_FACE_SHAPE.lineTo(0.46, -0.28);
BASE_ROOF_FACE_SHAPE.lineTo(-0.46, -0.28);

function dropPileStats(cell: MineCell): { count: number; ore: OreId | null } {
  let count = 0;
  let ore: OreId | null = null;
  let best = 0;
  for (const [id, n] of Object.entries(cell.drop ?? {}) as Array<
    [OreId, number]
  >) {
    count += n;
    if (n > best) {
      ore = id;
      best = n;
    }
  }
  return { count, ore };
}

const DROP_MARKER_POSITIONS = [
  [0.24, 0.13, 0.05],
  [0.36, 0.11, 0.04],
  [0.3, 0.22, 0.06],
  [0.43, 0.2, 0.05],
  [0.22, 0.25, 0.04],
] as const;

function DropPileMarkers({
  extraCount,
  color,
}: {
  extraCount: number;
  color: string;
}) {
  const markerCount = Math.min(DROP_MARKER_POSITIONS.length, extraCount);
  const markers = DROP_MARKER_POSITIONS.slice(0, markerCount).map(
    (position, i) => (
      <mesh
        key={`${position[0]}:${position[1]}:${position[2]}`}
        position={[position[0], position[1], position[2]]}
        scale={i === 0 ? 1.05 : 0.9}
      >
        <octahedronGeometry args={[0.045, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.18}
          roughness={0.52}
          flatShading
        />
      </mesh>
    ),
  );
  return <>{markers}</>;
}

function DroppedBagMarker() {
  return (
    <>
      <mesh scale={[1.08, 0.82, 0.74]}>
        <sphereGeometry args={[0.22, 12, 8]} />
        <meshStandardMaterial
          color="#8f5a2d"
          emissive="#3a2110"
          emissiveIntensity={0.18}
          roughness={0.72}
          flatShading
        />
      </mesh>
      <mesh position={[0, 0.16, 0]} scale={[0.7, 0.35, 0.38]}>
        <sphereGeometry args={[0.13, 10, 6]} />
        <meshStandardMaterial
          color="#c09046"
          emissive="#5f3515"
          emissiveIntensity={0.22}
          roughness={0.6}
          flatShading
        />
      </mesh>
      <mesh position={[0, 0.02, 0.16]}>
        <boxGeometry args={[0.12, 0.06, 0.04]} />
        <meshStandardMaterial
          color="#f5c542"
          emissive="#f5c542"
          emissiveIntensity={0.45}
          roughness={0.4}
        />
      </mesh>
      <pointLight color="#f5c542" intensity={0.45} distance={1.6} decay={1.8} />
    </>
  );
}

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
const WINTER_ROCK_COLORS = ["#9fb5c8", "#7f9fb8", "#637f9a"];
const TECH_ROCK_COLORS = ["#23483e", "#253f58", "#2b3568"];
const CACHE_COLOR = "#f5c542";
const BOULDER_COLOR = "#8a7f70";
const BOULDER_WOBBLE_COLOR = "#b59f82";
const METAL_COLOR = "#9aa4b2";
/** Warm warning glow on a rock or boulder that is about to drop. */
const TEETER_EMISSIVE = "#d9863a";
const GAS_COLOR = "#8fa32e";
const MAGMA_COLOR = "#ff5a2e";

/** Depth (in rows) at which the lighting reaches full darkness. */
const DARK_DEPTH = 14;

function dirtColorAt(row: number): string {
  const index = STRATA.indexOf(stratumAt(row));
  return STRATA_DIRT[Math.min(index, STRATA_DIRT.length - 1)];
}

function biomeDirtColorAt(col: number, row: number): string {
  const biome = biomeAt(col);
  if (biome === "winter") {
    const band = ["#dcecf3", "#c9dbe5", "#b6ccd8", "#9eb7c6"];
    return band[Math.min(Math.floor(row / 24), band.length - 1)];
  }
  if (biome === "highTech") {
    const band = ["#193a32", "#143742", "#202e4d", "#24305b"];
    return band[Math.min(Math.floor(row / 28), band.length - 1)];
  }
  return dirtColorAt(row);
}

function rockColorsForBiome(biome: MineBiomeId): readonly string[] {
  if (biome === "winter") return WINTER_ROCK_COLORS;
  if (biome === "highTech") return TECH_ROCK_COLORS;
  return ROCK_COLORS;
}

function tunnelColorForBiome(biome: MineBiomeId): string {
  if (biome === "winter") return "#152532";
  if (biome === "highTech") return "#071f1b";
  return "#15120e";
}

function surfaceColorForBiome(biome: MineBiomeId): string {
  if (biome === "winter") return "#d7edf6";
  if (biome === "highTech") return "#1f4f46";
  return "#3d5c3a";
}

function surfaceTrimColorForBiome(biome: MineBiomeId): string {
  if (biome === "winter") return "#eefbff";
  if (biome === "highTech") return "#5ff0a8";
  return "#4f7a4a";
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
  /** Seconds left in the most recent falling-rock warning cue. */
  fallWarning: number;
}

function crackSegmentCountForDamage(damage: number): number {
  const d = Math.max(0, Math.min(1, damage));
  return 3 + Math.floor(d * 6) + Math.floor(d * d * 7);
}

interface MotionTrack {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAt: number;
  duration: number;
  frames: number;
}

interface FallWindow {
  key: number;
  col: number;
  fromRow: number;
  toRow: number;
  fell: number;
}

interface FallPlayback extends FallWindow {
  kind: "fall" | "crush";
  track: MotionTrack | null;
  impacted: boolean;
  doneAt: number | null;
}

function fallPlaybackFromResult(
  result: MoveResult | null,
  key: number,
): FallPlayback | null {
  if (
    result?.ok &&
    result.collapsed &&
    result.fallFatal &&
    result.lost &&
    result.fell
  ) {
    const toRow = result.lost.row;
    return {
      key,
      kind: "fall",
      col: result.lost.col,
      fromRow: Math.max(0, toRow - result.fell),
      toRow,
      fell: result.fell,
      track: null,
      impacted: false,
      doneAt: null,
    };
  }
  if (result?.ok && result.collapsed && result.crushed && result.lost) {
    return {
      key,
      kind: "crush",
      col: result.lost.col,
      fromRow: result.lost.row,
      toRow: result.lost.row,
      fell: 0,
      track: null,
      impacted: false,
      doneAt: null,
    };
  }
  return null;
}

function fallWindowFromPlayback(playback: FallPlayback): FallWindow {
  return {
    key: playback.key,
    col: playback.col,
    fromRow: playback.fromRow,
    toRow: playback.toRow,
    fell: playback.fell,
  };
}

const PICK_SWING_SECONDS = 0.18;
const DIG_LUNGE_SECONDS = 0.16;
const CAMERA_STEP_SECONDS = 0.28;
const FATAL_FALL_HOLD_SECONDS = 0.38;
const CRUSH_HOLD_SECONDS = 3.6;
/** Length of the bounce-off animation when the pick can't cut the rock. */
const BOUNCE_SECONDS = 0.28;
const DYNAMITE_RED = "#b43b32";
const FUSE_GLOW = "#ffb347";
const DYNAMITE_WARNING = TEETER_EMISSIVE;
const EDGE_DARKNESS_COLOR = "#02040a";
const SUPPORT_SELECT_RED = "#ff3b30";

/** World coordinates ARE render coordinates in the endless mine. */
const cellX = (col: number) => col;

function ClankerMesh({
  clanker,
  raid,
}: {
  clanker: BunkerRaidSnapshot["clankers"][number];
  raid: BunkerRaidSnapshot;
}) {
  const groupRef = useRef<Group>(null);
  const bodyRef = useRef<Group>(null);
  const burstRef = useRef<Group>(null);
  const legRefs = useRef<Array<Group | null>>([]);
  const mandibleRefs = useRef<Array<Group | null>>([]);
  const sensorRef = useRef<Group>(null);
  const eyeRef = useRef<Mesh>(null);
  const localStartRef = useRef<number | null>(null);
  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const animateBody = (
      elapsedSeconds: number,
      moving: boolean,
      travelAngle: number,
    ) => {
      const phase = elapsedSeconds * (moving ? 10.5 : 5.2);
      const stride = moving ? 1 : 0.35;
      group.rotation.z = travelAngle + Math.sin(phase * 0.5) * 0.035 * stride;
      if (bodyRef.current) {
        bodyRef.current.position.z = 0.02 + Math.sin(phase) * 0.018 * stride;
        bodyRef.current.rotation.x = Math.sin(phase * 0.72) * 0.04 * stride;
        bodyRef.current.rotation.y = Math.cos(phase * 0.62) * 0.03 * stride;
      }
      legRefs.current.forEach((leg, index) => {
        if (!leg) return;
        const legSpec = CLANKER_LEGS[index];
        if (!legSpec) return;
        const step = Math.sin(phase + legSpec.phase) * stride;
        const lift = Math.max(0, step) * 0.035;
        leg.rotation.z = legSpec.side * (0.12 + step * 0.24);
        leg.position.z = -0.04 + lift;
      });
      mandibleRefs.current.forEach((mandible, index) => {
        if (!mandible) return;
        const side = CLANKER_MANDIBLE_SIDES[index] ?? 1;
        mandible.rotation.z =
          side * (0.28 + Math.max(0, Math.sin(phase * 1.35)) * 0.26);
      });
      if (sensorRef.current) {
        sensorRef.current.rotation.z = Math.sin(phase * 0.7) * 0.12;
      }
      if (eyeRef.current) {
        const pulse = 1 + Math.max(0, Math.sin(phase * 1.1)) * 0.16;
        eyeRef.current.scale.set(pulse, 1, 1);
      }
    };
    const path =
      clanker.path && clanker.path.length > 0
        ? clanker.path
        : [{ col: clanker.col, row: clanker.row }];
    if (path.length === 1) {
      group.position.set(cellX(path[0].col), -path[0].row, 0.78);
      animateBody(state.clock.elapsedTime, false, 0);
      if (bodyRef.current) bodyRef.current.visible = true;
      if (burstRef.current) burstRef.current.visible = false;
      return;
    }
    let elapsedSeconds = 0;
    if (raid.startedAtMs !== undefined) {
      elapsedSeconds = Math.max(0, (Date.now() - raid.startedAtMs) / 1000);
    } else {
      localStartRef.current ??= state.clock.elapsedTime;
      elapsedSeconds = state.clock.elapsedTime - localStartRef.current;
    }
    const travelSeconds = Math.min(
      raid.durationSeconds * 0.78,
      Math.max(3, (path.length - 1) * 0.7),
    );
    const maxStep = Math.min(
      path.length - 1,
      Math.max(0, clanker.deathStep ?? path.length - 1),
    );
    const deathSeconds =
      path.length <= 1 ? 0 : (maxStep / (path.length - 1)) * travelSeconds;
    const progress =
      travelSeconds <= 0
        ? maxStep
        : Math.min(
            maxStep,
            (elapsedSeconds / travelSeconds) * (path.length - 1),
          );
    const segment = Math.min(path.length - 2, Math.floor(progress));
    const t = progress - segment;
    const from = path[segment];
    const to = path[segment + 1];
    const x = from.col + (to.col - from.col) * t;
    const y = from.row + (to.row - from.row) * t;
    group.position.set(cellX(x), -y, 0.78);
    animateBody(
      elapsedSeconds,
      true,
      Math.atan2(-(to.row - from.row), to.col - from.col),
    );
    const dead = elapsedSeconds >= deathSeconds;
    if (bodyRef.current) bodyRef.current.visible = !dead;
    if (burstRef.current) {
      const burstActive = dead && clanker.status === "self-destructed";
      burstRef.current.visible = burstActive;
      if (burstActive) {
        const burstAge = Math.min(
          1,
          Math.max(0, elapsedSeconds - deathSeconds),
        );
        const scale = 0.6 + burstAge * 0.9;
        burstRef.current.scale.setScalar(scale);
      }
    }
  });
  return (
    <group
      ref={groupRef}
      position={[cellX(clanker.col), -clanker.row, 0.78]}
      scale={0.88}
    >
      <group ref={bodyRef}>
        {CLANKER_LEGS.map((leg, index) => (
          <group
            key={`leg:${leg.x}:${leg.side}`}
            ref={(node) => {
              legRefs.current[index] = node;
            }}
            position={[leg.x, leg.side * 0.22, -0.04]}
          >
            <mesh
              position={[0.02, leg.side * 0.16, 0]}
              rotation={[0, 0, leg.side * 0.34]}
            >
              <boxGeometry args={[0.09, 0.31, 0.055]} />
              <meshStandardMaterial
                color="#6e7c90"
                metalness={0.46}
                roughness={0.34}
                flatShading
              />
            </mesh>
            <mesh
              position={[-0.05, leg.side * 0.38, -0.01]}
              rotation={[0, 0, -leg.side * 0.22]}
            >
              <boxGeometry args={[0.075, 0.34, 0.05]} />
              <meshStandardMaterial
                color="#a9b6c8"
                metalness={0.54}
                roughness={0.3}
                flatShading
              />
            </mesh>
            <mesh position={[-0.09, leg.side * 0.56, -0.03]}>
              <boxGeometry args={[0.16, 0.06, 0.045]} />
              <meshStandardMaterial
                color="#293241"
                metalness={0.42}
                roughness={0.46}
                flatShading
              />
            </mesh>
            <mesh>
              <sphereGeometry args={[0.06, 8, 6]} />
              <meshStandardMaterial
                color="#e2b35e"
                emissive="#7a4116"
                emissiveIntensity={0.18}
                metalness={0.48}
                roughness={0.28}
                flatShading
              />
            </mesh>
          </group>
        ))}

        <mesh position={[-0.12, 0, 0.03]} scale={[1.35, 0.68, 0.38]}>
          <sphereGeometry args={[0.32, 18, 10]} />
          <meshStandardMaterial
            color="#526074"
            emissive="#111720"
            emissiveIntensity={0.2}
            metalness={0.6}
            roughness={0.28}
            flatShading
          />
        </mesh>
        <mesh position={[-0.18, 0, 0.16]} scale={[1.12, 0.5, 0.24]}>
          <sphereGeometry args={[0.28, 14, 8]} />
          <meshStandardMaterial
            color="#263241"
            emissive="#111923"
            emissiveIntensity={0.2}
            metalness={0.38}
            roughness={0.48}
            flatShading
          />
        </mesh>
        {[-0.32, -0.12, 0.1].map((x, index) => (
          <RoundedBox
            key={`armor:${x}`}
            args={[0.2, 0.48 - index * 0.05, 0.08]}
            radius={0.025}
            smoothness={2}
            position={[x, 0, 0.32]}
          >
            <meshStandardMaterial
              color={index === 1 ? "#b9c4d3" : "#8f9bad"}
              emissive="#151c27"
              emissiveIntensity={0.14}
              metalness={0.64}
              roughness={0.26}
              flatShading
            />
          </RoundedBox>
        ))}
        <RoundedBox
          args={[0.36, 0.36, 0.18]}
          radius={0.04}
          smoothness={3}
          position={[0.38, 0, 0.12]}
        >
          <meshStandardMaterial
            color="#394656"
            emissive="#151b25"
            emissiveIntensity={0.22}
            metalness={0.54}
            roughness={0.32}
            flatShading
          />
        </RoundedBox>
        <mesh ref={eyeRef} position={[0.59, 0, 0.18]}>
          <boxGeometry args={[0.04, 0.26, 0.07]} />
          <meshStandardMaterial
            color="#ff4d4d"
            emissive="#ff1d2f"
            emissiveIntensity={1.25}
            roughness={0.18}
          />
        </mesh>
        <group ref={sensorRef} position={[0.42, 0, 0.34]}>
          <mesh position={[0.08, 0, 0.05]}>
            <sphereGeometry args={[0.055, 10, 6]} />
            <meshStandardMaterial
              color="#ffcc66"
              emissive="#ff7a1f"
              emissiveIntensity={0.72}
              metalness={0.28}
              roughness={0.22}
              flatShading
            />
          </mesh>
          <mesh position={[0.02, 0, 0]} rotation={[0, 0.9, 0]}>
            <boxGeometry args={[0.2, 0.035, 0.035]} />
            <meshStandardMaterial
              color="#b7c2d4"
              metalness={0.58}
              roughness={0.28}
              flatShading
            />
          </mesh>
        </group>
        {CLANKER_MANDIBLE_SIDES.map((side, index) => (
          <group
            key={`mandible:${side}`}
            ref={(node) => {
              mandibleRefs.current[index] = node;
            }}
            position={[0.57, side * 0.11, 0.04]}
            rotation={[0, 0, side * 0.28]}
          >
            <mesh position={[0.08, side * 0.08, 0]}>
              <boxGeometry args={[0.23, 0.055, 0.055]} />
              <meshStandardMaterial
                color="#d1a04b"
                emissive="#5b2c12"
                emissiveIntensity={0.18}
                metalness={0.62}
                roughness={0.24}
                flatShading
              />
            </mesh>
            <mesh position={[0.21, side * 0.13, -0.01]}>
              <coneGeometry args={[0.055, 0.14, 4]} />
              <meshStandardMaterial
                color="#f1d18a"
                emissive="#8a3c18"
                emissiveIntensity={0.2}
                metalness={0.48}
                roughness={0.2}
                flatShading
              />
            </mesh>
          </group>
        ))}
        {[-0.18, 0.18].map((y) => (
          <mesh
            key={`vent:${y}`}
            position={[-0.48, y, 0.08]}
            rotation={[0, 0, y > 0 ? 0.18 : -0.18]}
          >
            <boxGeometry args={[0.2, 0.045, 0.055]} />
            <meshStandardMaterial
              color="#202733"
              emissive="#ff5a1f"
              emissiveIntensity={0.18}
              metalness={0.32}
              roughness={0.42}
              flatShading
            />
          </mesh>
        ))}
      </group>
      <group ref={burstRef} visible={false}>
        <mesh>
          <sphereGeometry args={[0.3, 12, 8]} />
          <meshStandardMaterial
            color="#ffb347"
            emissive="#ff6b1a"
            emissiveIntensity={1.1}
            roughness={0.35}
            flatShading
          />
        </mesh>
        <mesh>
          <ringGeometry args={[0.28, 0.43, 16]} />
          <meshBasicMaterial color="#ffd166" transparent opacity={0.72} />
        </mesh>
        {CLANKER_BURST_SHARDS.map((shard) => (
          <mesh
            key={`shard:${shard.x}:${shard.y}`}
            position={[shard.x, shard.y, 0.08]}
            rotation={[0.2, 0.1, shard.angle]}
            scale={shard.scale}
          >
            <boxGeometry args={[0.18, 0.055, 0.08]} />
            <meshStandardMaterial
              color="#c6d0df"
              emissive="#ff6b1a"
              emissiveIntensity={0.25}
              metalness={0.5}
              roughness={0.3}
              flatShading
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function BasePartVisual({
  partId,
  durability,
  footprint,
  col,
}: {
  partId: BasePartId;
  durability: number;
  footprint: BunkerFootprint;
  col: number;
}) {
  switch (partId) {
    case "floor-panel":
      return <BaseFloorPanel />;
    case "wall-panel":
      return <BaseWallPanel />;
    case "roof-panel":
      return <BaseRoofPanel />;
    case "door-panel":
      return <BaseDoorPanel side={doorSideForBunkerColumn(col, footprint)} />;
    case "floor-spikes":
      return <BaseFloorSpikes durability={durability} />;
    case "basic-turret":
      return <BaseTurret durability={durability} />;
  }
}

function doorSideForBunkerColumn(
  col: number,
  footprint: BunkerFootprint,
): -1 | 1 {
  if (col <= footprint.col) return -1;
  if (col >= footprint.col + footprint.width - 1) return 1;
  const midpoint = footprint.col + (footprint.width - 1) / 2;
  return col < midpoint ? -1 : 1;
}

function BaseFloorPanel() {
  return (
    <group>
      <RoundedBox
        args={[0.88, 0.2, 0.14]}
        radius={0.035}
        smoothness={1}
        position={[0, -0.35, 0]}
      >
        <meshStandardMaterial
          color="#71808c"
          roughness={0.68}
          metalness={0.28}
          flatShading
        />
      </RoundedBox>
      {BASE_FLOOR_RIB_X.map((x) => (
        <mesh key={x} position={[x, -0.25, 0.08]}>
          <boxGeometry args={[0.035, 0.12, 0.045]} />
          <meshStandardMaterial
            color="#9fb0bd"
            roughness={0.6}
            metalness={0.22}
            flatShading
          />
        </mesh>
      ))}
    </group>
  );
}

function BaseWallPanel() {
  return (
    <group>
      <RoundedBox args={[0.24, 0.82, 0.18]} radius={0.035} smoothness={1}>
        <meshStandardMaterial
          color="#3fbda9"
          roughness={0.64}
          metalness={0.24}
          flatShading
        />
      </RoundedBox>
      {BASE_WALL_RAIL_Y.map((y) => (
        <mesh key={y} position={[0, y, 0.11]}>
          <boxGeometry args={[0.38, 0.055, 0.055]} />
          <meshStandardMaterial
            color="#8cf0dd"
            roughness={0.55}
            metalness={0.18}
            flatShading
          />
        </mesh>
      ))}
      <mesh position={[0, 0, 0.12]}>
        <boxGeometry args={[0.055, 0.64, 0.055]} />
        <meshStandardMaterial
          color="#287f77"
          roughness={0.62}
          metalness={0.25}
          flatShading
        />
      </mesh>
    </group>
  );
}

function BaseRoofPanel() {
  return (
    <group>
      <mesh position={[0, -0.02, 0.08]}>
        <shapeGeometry args={[BASE_ROOF_FACE_SHAPE]} />
        <meshStandardMaterial
          color="#6f5e88"
          roughness={0.72}
          metalness={0.18}
          flatShading
        />
      </mesh>
      <mesh position={[0, -0.31, 0.15]}>
        <boxGeometry args={[0.98, 0.085, 0.09]} />
        <meshStandardMaterial
          color="#c49b5c"
          roughness={0.58}
          metalness={0.08}
          flatShading
        />
      </mesh>
      {BASE_ROOF_RAFTER_SIDES.map((side) => (
        <mesh
          key={side}
          position={[side * 0.22, 0.09, 0.16]}
          rotation={[0, 0, side * -0.77]}
        >
          <boxGeometry args={[0.63, 0.055, 0.075]} />
          <meshStandardMaterial
            color="#d8b36d"
            roughness={0.58}
            metalness={0.07}
            flatShading
          />
        </mesh>
      ))}
      {BASE_ROOF_SHINGLE_BANDS.map((band) => (
        <mesh key={band.y} position={[0, band.y, 0.17]}>
          <boxGeometry args={[band.width, 0.04, 0.045]} />
          <meshStandardMaterial
            color="#8a789d"
            roughness={0.7}
            metalness={0.14}
            flatShading
          />
        </mesh>
      ))}
      <mesh position={[0, 0.31, 0.18]}>
        <boxGeometry args={[0.18, 0.07, 0.09]} />
        <meshStandardMaterial
          color="#efd08a"
          roughness={0.54}
          metalness={0.08}
          flatShading
        />
      </mesh>
      <mesh position={[0, -0.29, 0.22]}>
        <boxGeometry args={[0.34, 0.055, 0.055]} />
        <meshStandardMaterial
          color="#efd08a"
          roughness={0.55}
          metalness={0.08}
          flatShading
        />
      </mesh>
      {BASE_ROOF_RAFTER_SIDES.map((side) => (
        <mesh key={`post:${side}`} position={[side * 0.42, -0.18, 0.18]}>
          <boxGeometry args={[0.065, 0.22, 0.065]} />
          <meshStandardMaterial
            color="#a67b42"
            roughness={0.62}
            metalness={0.08}
            flatShading
          />
        </mesh>
      ))}
    </group>
  );
}

function BaseDoorPanel({ side }: { side: -1 | 1 }) {
  const x = side * 0.36;
  return (
    <group>
      <RoundedBox
        args={[0.22, 0.82, 0.16]}
        radius={0.03}
        smoothness={1}
        position={[x, 0, 0]}
      >
        <meshStandardMaterial
          color="#bc8442"
          roughness={0.64}
          metalness={0.12}
          flatShading
        />
      </RoundedBox>
      {BASE_DOOR_BRACE_Y.map((y) => (
        <mesh key={y} position={[x, y, 0.1]}>
          <boxGeometry args={[0.26, 0.055, 0.045]} />
          <meshStandardMaterial
            color="#7f4c27"
            roughness={0.66}
            metalness={0.12}
            flatShading
          />
        </mesh>
      ))}
      <mesh position={[x - side * 0.065, 0, 0.12]}>
        <sphereGeometry args={[0.035, 8, 6]} />
        <meshStandardMaterial
          color="#f5d06f"
          roughness={0.42}
          metalness={0.32}
          flatShading
        />
      </mesh>
      <mesh position={[x - side * 0.15, 0, -0.01]}>
        <boxGeometry args={[0.035, 0.72, 0.09]} />
        <meshStandardMaterial
          color="#6f3d22"
          roughness={0.68}
          metalness={0.08}
          flatShading
        />
      </mesh>
    </group>
  );
}

function BaseFloorSpikes({ durability }: { durability: number }) {
  const maxDurability = BASE_PART_CATALOG["floor-spikes"].durability;
  const ratio = Math.max(0.15, Math.min(1, durability / maxDurability));
  const spikeHeight = 0.48 * ratio;
  return (
    <group>
      <BaseFloorPanel />
      {BASE_FLOOR_SPIKE_X.map((x) => (
        <mesh key={x} position={[x, -0.31 + spikeHeight * 0.5, 0.15]}>
          <coneGeometry args={[0.09 * ratio, spikeHeight, 5]} />
          <meshStandardMaterial
            color={ratio > 0.5 ? "#d4dde8" : "#7b8290"}
            emissive={ratio > 0.5 ? "#3b82f6" : "#000000"}
            emissiveIntensity={0.08 * ratio}
            roughness={0.5}
            metalness={0.35}
            flatShading
          />
        </mesh>
      ))}
    </group>
  );
}

function BaseTurret({ durability }: { durability: number }) {
  const maxDurability = BASE_PART_CATALOG["basic-turret"].durability;
  const ratio = Math.max(0.2, Math.min(1, durability / maxDurability));
  return (
    <group>
      <RoundedBox
        args={[0.58, 0.2, 0.16]}
        radius={0.035}
        smoothness={1}
        position={[0, -0.3, 0]}
      >
        <meshStandardMaterial
          color="#6674a3"
          roughness={0.62}
          metalness={0.3}
          flatShading
        />
      </RoundedBox>
      <mesh position={[0, -0.04, 0.08]} scale={[1, ratio, 1]}>
        <cylinderGeometry args={[0.18, 0.24, 0.3, 12]} />
        <meshStandardMaterial
          color="#8aa4ff"
          emissive="#5b6cff"
          emissiveIntensity={0.12 * ratio}
          roughness={0.5}
          metalness={0.35}
          flatShading
        />
      </mesh>
      <mesh position={[0, 0.18, 0.08]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.045, 0.055, 0.46, 8]} />
        <meshStandardMaterial
          color="#c6d1ff"
          roughness={0.42}
          metalness={0.38}
          flatShading
        />
      </mesh>
    </group>
  );
}

function BunkerOverlay({
  preview,
  blockedCells,
  bunker,
  activeRaid,
  selectedPartCell,
  dragTargetCell,
  targetCell,
  buildMode,
  onBunkerPartTap,
  onBunkerPartPointerDown,
  onBunkerCellHover,
  onBunkerCellTap,
  onBunkerDragTarget,
  onBunkerDragEnd,
}: {
  preview?: BunkerFootprint | null;
  blockedCells?: readonly MineCoord[];
  bunker?: BunkerState | null;
  activeRaid?: BunkerRaidSnapshot | null;
  selectedPartCell?: MineCoord | null;
  dragTargetCell?: MineCoord | null;
  targetCell?: MineCoord | null;
  buildMode?: BunkerBuildMode;
  onBunkerPartTap?: (cell: MineCoord) => void;
  onBunkerPartPointerDown?: (cell: MineCoord) => void;
  onBunkerCellHover?: (cell: MineCoord) => void;
  onBunkerCellTap?: (cell: MineCoord) => void;
  onBunkerDragTarget?: (cell: MineCoord) => void;
  onBunkerDragEnd?: (cell: MineCoord) => void;
}) {
  const footprint = bunker?.footprint ?? preview;
  if (!footprint) return null;
  const outlineColor = bunker ? "#54e0c7" : "#f5c542";
  const outlineOpacity = bunker ? 0.5 : 0.42;
  const lines = [];
  const left = footprint.col - 0.5;
  const right = footprint.col + footprint.width - 0.5;
  const top = -footprint.row + 0.5;
  const bottom = -(footprint.row + footprint.height - 1) - 0.5;
  for (let i = 0; i <= footprint.width; i++) {
    const col = footprint.col + i - 0.5;
    lines.push(
      <mesh
        key={`bunker-vline:${i}`}
        position={[cellX(col), (top + bottom) / 2, 0.78]}
      >
        <planeGeometry args={[0.035, Math.abs(top - bottom)]} />
        <meshBasicMaterial
          color={outlineColor}
          transparent
          opacity={i === 0 || i === footprint.width ? outlineOpacity : 0.16}
          depthWrite={false}
        />
      </mesh>,
    );
  }
  for (let i = 0; i <= footprint.height; i++) {
    const row = footprint.row + i - 0.5;
    lines.push(
      <mesh
        key={`bunker-hline:${i}`}
        position={[cellX((left + right) / 2), -row, 0.78]}
      >
        <planeGeometry args={[Math.abs(right - left), 0.035]} />
        <meshBasicMaterial
          color={outlineColor}
          transparent
          opacity={i === 0 || i === footprint.height ? outlineOpacity : 0.16}
          depthWrite={false}
        />
      </mesh>,
    );
  }
  const blocked =
    blockedCells?.map((cell) => (
      <group key={`bunker-blocked:${cell.col}:${cell.row}`}>
        <mesh position={[cellX(cell.col), -cell.row, 1]} renderOrder={18}>
          <planeGeometry args={[1.08, 1.08]} />
          <meshBasicMaterial
            color={SUPPORT_SELECT_RED}
            transparent
            opacity={0.24}
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
        <SelectedSupportCellOutline col={cell.col} row={cell.row} />
      </group>
    )) ?? [];
  const cellFromPoint = (event: {
    point: { x: number; y: number };
  }): MineCoord => ({
    col: Math.round(event.point.x),
    row: Math.round(-event.point.y),
  });
  const selectedKey = selectedPartCell
    ? `${selectedPartCell.col}:${selectedPartCell.row}`
    : null;
  const targetColor = buildMode === "remove" ? "#ff6b6b" : "#54e0c7";
  const validTarget =
    targetCell && containsBunkerCell(footprint, targetCell.col, targetCell.row)
      ? targetCell
      : null;
  const targetHighlight =
    validTarget && buildMode !== "move" ? (
      <group key={`bunker-target:${validTarget.col}:${validTarget.row}`}>
        <mesh
          position={[cellX(validTarget.col), -validTarget.row, 1.04]}
          renderOrder={20}
        >
          <planeGeometry args={[1.08, 1.08]} />
          <meshBasicMaterial
            color={targetColor}
            transparent
            opacity={0.18}
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
        <SelectedSupportCellOutline
          col={validTarget.col}
          row={validTarget.row}
        />
      </group>
    ) : null;
  const cellTargetPlane =
    bunker &&
    buildMode !== "move" &&
    !activeRaid &&
    onBunkerCellTap &&
    onBunkerCellHover ? (
      // biome-ignore lint/a11y/noStaticElementInteractions: React Three Fiber scene targets are not DOM controls.
      <mesh
        position={[
          cellX(footprint.col + (footprint.width - 1) / 2),
          -(footprint.row + (footprint.height - 1) / 2),
          0.44,
        ]}
        renderOrder={12}
        onPointerMove={(e) => {
          onBunkerCellHover(cellFromPoint(e));
        }}
        onClick={(e) => {
          e.stopPropagation();
          onBunkerCellTap(cellFromPoint(e));
        }}
      >
        <planeGeometry args={[footprint.width, footprint.height]} />
        <meshBasicMaterial
          color={targetColor}
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
    ) : null;
  const dragTarget =
    dragTargetCell &&
    containsBunkerCell(footprint, dragTargetCell.col, dragTargetCell.row) ? (
      <group
        key={`bunker-drag-target:${dragTargetCell.col}:${dragTargetCell.row}`}
      >
        <mesh
          position={[cellX(dragTargetCell.col), -dragTargetCell.row, 1.08]}
          renderOrder={21}
        >
          <planeGeometry args={[1.08, 1.08]} />
          <meshBasicMaterial
            color="#54e0c7"
            transparent
            opacity={0.2}
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
        <SelectedSupportCellOutline
          col={dragTargetCell.col}
          row={dragTargetCell.row}
        />
      </group>
    ) : null;
  const dragPlane =
    bunker && buildMode === "move" && onBunkerDragTarget && onBunkerDragEnd ? (
      <mesh
        position={[
          cellX(footprint.col + (footprint.width - 1) / 2),
          -(footprint.row + (footprint.height - 1) / 2),
          0.45,
        ]}
        renderOrder={13}
        onPointerDown={(e) => {
          const cell = cellFromPoint(e);
          if (
            bunker.parts.some((part) => {
              return part.col === cell.col && part.row === cell.row;
            })
          ) {
            e.stopPropagation();
            onBunkerPartPointerDown?.(cell);
          }
        }}
        onPointerMove={(e) => {
          onBunkerDragTarget(cellFromPoint(e));
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          onBunkerDragEnd(cellFromPoint(e));
        }}
        onPointerCancel={(e) => {
          e.stopPropagation();
          onBunkerDragEnd(cellFromPoint(e));
        }}
      >
        <planeGeometry args={[footprint.width, footprint.height]} />
        <meshBasicMaterial
          color="#54e0c7"
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
    ) : null;
  const parts =
    bunker?.parts.map((part) => {
      const partCell = { col: part.col, row: part.row };
      const partKey = `${part.col}:${part.row}`;
      const selected = selectedKey === partKey;
      return (
        // biome-ignore lint/a11y/noStaticElementInteractions: React Three Fiber scene targets are not DOM controls.
        <group
          key={`bunker-part:${part.col}:${part.row}`}
          position={[cellX(part.col), -part.row, 0.5]}
          onClick={(e) => {
            e.stopPropagation();
            if (buildMode === "remove" && onBunkerCellTap) {
              onBunkerCellTap(partCell);
              return;
            }
            if (buildMode === "move") onBunkerPartTap?.(partCell);
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (buildMode === "move") onBunkerPartPointerDown?.(partCell);
          }}
        >
          {selected && (
            <SelectedSupportCellOutline col={part.col} row={part.row} />
          )}
          <BasePartVisual
            col={part.col}
            durability={part.durability}
            footprint={footprint}
            partId={part.partId}
          />
        </group>
      );
    }) ?? [];
  const clankers =
    activeRaid?.clankers.map((clanker) => (
      <ClankerMesh key={clanker.id} clanker={clanker} raid={activeRaid} />
    )) ?? [];
  const xpPickups =
    (activeRaid?.xpPickups ?? [])
      .filter((pickup) => !pickup.collected)
      .map((pickup) => (
        <group
          key={pickup.id}
          position={[cellX(pickup.col), -pickup.row, 0.86]}
          scale={0.62}
        >
          <mesh>
            <octahedronGeometry args={[0.16, 0]} />
            <meshStandardMaterial
              color="#f5c542"
              emissive="#f59e0b"
              emissiveIntensity={0.85}
              roughness={0.3}
              flatShading
            />
          </mesh>
        </group>
      )) ?? [];
  return (
    <>
      {lines}
      {blocked}
      {bunker && (
        <mesh position={[cellX(bunker.core.col), -bunker.core.row, 0.62]}>
          <octahedronGeometry args={[0.28, 0]} />
          <meshStandardMaterial
            color="#c084fc"
            emissive="#8b5cf6"
            emissiveIntensity={0.7}
            roughness={0.35}
            flatShading
          />
        </mesh>
      )}
      {cellTargetPlane}
      {targetHighlight}
      {parts}
      {dragTarget}
      {dragPlane}
      {clankers}
      {xpPickups}
    </>
  );
}

/** Width of the dressed surface camp strip around the origin. */
const CAMP_WIDTH = 60;
const easeStep = (t: number) => 0.5 - Math.cos(t * Math.PI) * 0.5;

function snapMotion(
  now: number,
  targetX: number,
  targetY: number,
  duration: number,
): MotionTrack {
  return {
    fromX: targetX,
    fromY: targetY,
    toX: targetX,
    toY: targetY,
    startedAt: now,
    duration,
    frames: 0,
  };
}

function SupportSelectionOutline({
  width,
  height,
  z = 0.14,
}: {
  width: number;
  height: number;
  z?: number;
}) {
  const bar = 0.045;
  return (
    <group position={[0, 0, z]}>
      <SelectionOutlineBars
        width={width}
        height={height}
        bar={bar}
        renderOrder={0}
        depthTest
      />
    </group>
  );
}

function SelectionOutlineBars({
  width,
  height,
  bar,
  renderOrder,
  depthTest,
}: {
  width: number;
  height: number;
  bar: number;
  renderOrder: number;
  depthTest: boolean;
}) {
  const bars = [
    { position: [0, height / 2, 0], args: [width, bar, bar] },
    { position: [0, -height / 2, 0], args: [width, bar, bar] },
    { position: [-width / 2, 0, 0], args: [bar, height, bar] },
    { position: [width / 2, 0, 0], args: [bar, height, bar] },
  ] as const;
  return (
    <>
      {bars.map(({ position, args }) => (
        <mesh
          key={position.join(":")}
          position={position}
          renderOrder={renderOrder}
        >
          <boxGeometry args={args} />
          <meshBasicMaterial
            color={SUPPORT_SELECT_RED}
            toneMapped={false}
            depthWrite={false}
            depthTest={depthTest}
          />
        </mesh>
      ))}
    </>
  );
}

function SelectedSupportCellOutline({
  col,
  row,
}: {
  col: number;
  row: number;
}) {
  return (
    <group position={[cellX(col), -row, 1.02]}>
      <SelectionOutlineBars
        width={1.1}
        height={1.1}
        bar={0.065}
        renderOrder={20}
        depthTest={false}
      />
    </group>
  );
}

function SupportCellHitTarget({
  target,
  onToggleSupport,
}: {
  target: CollectTarget;
  onToggleSupport: (target: CollectTarget) => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: React Three Fiber scene targets are not DOM controls.
    <mesh
      position={[cellX(target.col), -target.row, 1.04]}
      renderOrder={19}
      onClick={(e) => {
        e.stopPropagation();
        onToggleSupport(target);
      }}
    >
      <planeGeometry args={[1.08, 1.08]} />
      <meshBasicMaterial
        color={SUPPORT_SELECT_RED}
        transparent
        opacity={0}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

function PortalBeaconModel({
  color,
  active,
}: {
  color: string;
  active: boolean;
}) {
  return (
    <group>
      <mesh position={[0, -0.12, 0]}>
        <cylinderGeometry args={[0.13, 0.2, 0.54, 8]} />
        <meshStandardMaterial
          color={active ? color : "#44505c"}
          metalness={0.55}
          roughness={0.32}
          emissive={active ? color : "#000000"}
          emissiveIntensity={active ? 0.22 : 0}
          flatShading
        />
      </mesh>
      <mesh position={[0, 0.23, 0]}>
        <torusGeometry args={[0.24, 0.035, 8, 18]} />
        <meshStandardMaterial
          color={color}
          metalness={0.35}
          roughness={0.28}
          emissive={active ? color : "#000000"}
          emissiveIntensity={active ? 0.95 : 0.18}
          flatShading
        />
      </mesh>
      <mesh position={[0, 0.23, 0]}>
        <octahedronGeometry args={[0.11, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={active ? 1.9 : 0.45}
          flatShading
        />
      </mesh>
      {active && (
        <pointLight
          position={[0, 0.28, 0.4]}
          color={color}
          intensity={1.5}
          distance={4.5}
          decay={1.7}
        />
      )}
    </group>
  );
}

function SurfaceSkin({
  firstCol,
  lastCol,
  mine,
}: {
  firstCol: number;
  lastCol: number;
  mine: MineState;
}) {
  const tiles = [];
  for (let col = firstCol - 1; col <= lastCol + 1; col++) {
    const biome = biomeAt(col);
    const x = cellX(col);
    tiles.push(
      <group key={col} position={[x, 0, -0.36]}>
        <mesh position={[0, -0.47, 0]}>
          <boxGeometry args={[1.02, 0.08, 0.9]} />
          <meshStandardMaterial
            color={variedColor(surfaceColorForBiome(biome), col, 0)}
            roughness={biome === "highTech" ? 0.45 : 1}
            metalness={biome === "highTech" ? 0.45 : 0}
            flatShading
          />
        </mesh>
        <mesh position={[0, -0.4, 0.1]}>
          <boxGeometry args={[0.94, 0.045, 0.34]} />
          <meshStandardMaterial
            color={surfaceTrimColorForBiome(biome)}
            roughness={0.9}
            metalness={biome === "highTech" ? 0.3 : 0}
            emissive={biome === "highTech" ? "#0b4a36" : "#000000"}
            emissiveIntensity={biome === "highTech" ? 0.25 : 0}
            flatShading
          />
        </mesh>
        {biome === "default" && Math.abs(col - 0.5) > 8 && (
          <mesh
            position={[
              (cellHash(col, 11, 2) - 0.5) * 0.46,
              -0.32,
              (cellHash(col, 13, 2) - 0.5) * 0.4,
            ]}
            rotation={[0, cellHash(col, 17, 2) * 3, 0]}
          >
            <coneGeometry args={[0.055, 0.16, 5]} />
            <meshStandardMaterial color="#4f7a4a" roughness={1} flatShading />
          </mesh>
        )}
      </group>,
    );
  }
  const portals = findPortalBeacons(mine).filter(
    (portal) => portal.col >= firstCol - 2 && portal.col <= lastCol + 2,
  );
  return (
    <group>
      {tiles}
      {portals.map((portal) => (
        <group key={portal.id} position={[cellX(portal.col), -0.14, 0.55]}>
          <PortalBeaconModel color={portal.color} active={portal.active} />
        </group>
      ))}
    </group>
  );
}

function retargetMotion(
  track: MotionTrack | null,
  now: number,
  currentX: number,
  currentY: number,
  targetX: number,
  targetY: number,
  duration: number,
): MotionTrack {
  if (track && track.toX === targetX && track.toY === targetY) return track;
  return {
    fromX: currentX,
    fromY: currentY,
    toX: targetX,
    toY: targetY,
    startedAt: now,
    duration,
    frames: 0,
  };
}

function motionProgress(track: MotionTrack, now: number): number {
  const raw = (now - track.startedAt) / track.duration;
  return Math.max(0, Math.min(1, raw));
}

function sampleMotion(track: MotionTrack, now: number): [number, number] {
  const t = motionProgress(track, now);
  const eased = easeStep(t);
  return [
    track.fromX + (track.toX - track.fromX) * eased,
    track.fromY + (track.toY - track.fromY) * eased,
  ];
}

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

function spawnDirtBreakBurst(
  juice: JuiceState,
  x: number,
  y: number,
  color: string,
): void {
  const dustColors = [color, "#6f5a42", "#9a7450", "#4a3527"];
  for (let i = 0; i < 24; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    pushParticle(juice, {
      kind: "debris",
      x: x + (Math.random() - 0.5) * 0.52,
      y: y + (Math.random() - 0.5) * 0.42,
      vx: side * (0.9 + Math.random() * 2.9) + (Math.random() - 0.5) * 0.8,
      vy: 0.7 + Math.random() * 3.4,
      gravity: 10.5 + Math.random() * 4,
      size: 0.09 + Math.random() * 0.16,
      color: dustColors[i % dustColors.length],
      life: 0.5 + Math.random() * 0.42,
    });
  }
  for (let i = 0; i < 18; i++) {
    pushParticle(juice, {
      kind: "dust",
      x: x + (Math.random() - 0.5) * 0.72,
      y: y - 0.22 + Math.random() * 0.22,
      vx: (Math.random() - 0.5) * 1.9,
      vy: 0.28 + Math.random() * 1.05,
      gravity: 1.6 + Math.random() * 0.8,
      size: 0.13 + Math.random() * 0.16,
      color: dustColors[(i + 1) % dustColors.length],
      life: 0.72 + Math.random() * 0.48,
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

function spawnFallWarning(juice: JuiceState, x: number, y: number): void {
  for (let i = 0; i < 12; i++) {
    pushParticle(juice, {
      kind: i % 3 === 0 ? "spark" : "dust",
      x: x + (Math.random() - 0.5) * 0.32,
      y: y + (Math.random() - 0.5) * 0.28,
      vx: (Math.random() - 0.5) * 1.2,
      vy: Math.random() * 1.6 + 0.25,
      gravity: 2.4,
      size: 0.055 + Math.random() * 0.06,
      color: i % 3 === 0 ? "#ffe08a" : TEETER_EMISSIVE,
      life: 0.34 + Math.random() * 0.2,
    });
  }
}

function spawnLadderFall(
  juice: JuiceState,
  x: number,
  fromY: number,
  toY: number,
): void {
  const distance = Math.max(1, Math.abs(toY - fromY));
  const chips = Math.min(10, 4 + Math.floor(distance * 2));
  for (let i = 0; i < chips; i++) {
    const ratio = chips <= 1 ? 1 : i / (chips - 1);
    pushParticle(juice, {
      kind: "debris",
      x: x + (Math.random() - 0.5) * 0.34,
      y: fromY + (toY - fromY) * ratio + (Math.random() - 0.5) * 0.2,
      vx: (Math.random() - 0.5) * 1.5,
      vy: Math.random() * 1.2 + 0.15,
      gravity: 7.5,
      size: 0.07 + Math.random() * 0.05,
      color: i % 3 === 0 ? "#f0c36b" : "#c88a3d",
      life: 0.28 + Math.random() * 0.22,
    });
  }
  const dust = Math.min(5, 2 + Math.floor(distance));
  for (let i = 0; i < dust; i++) {
    pushParticle(juice, {
      kind: "dust",
      x: x + (Math.random() - 0.5) * 0.46,
      y: toY - 0.34 + Math.random() * 0.12,
      vx: (Math.random() - 0.5) * 0.9,
      vy: Math.random() * 0.7 + 0.15,
      gravity: 1.1,
      size: 0.08 + Math.random() * 0.05,
      color: "#806a4e",
      life: 0.45 + Math.random() * 0.35,
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
  const d = Math.max(0.08, Math.min(1, damage));
  const count = crackSegmentCountForDamage(d);
  const marks = [];
  for (let i = 0; i < count; i++) {
    const a = cellHash(col, row, 61 + i);
    const b = cellHash(col, row, 67 + i);
    const branch = i > 2;
    const branchDepth = branch ? (i - 3) / Math.max(1, count - 3) : 0;
    const length =
      (branch ? 0.16 : 0.3) + d * (branch ? 0.18 : 0.42) + branchDepth * 0.08;
    const width = branch ? 0.018 + d * 0.012 : 0.026 + d * 0.018;
    const z = branch ? 0.515 : 0.52;
    const spread = 0.2 + d * 0.42;
    marks.push(
      <group
        key={i}
        position={[(a - 0.5) * spread, (b - 0.5) * spread, z]}
        rotation={[0, 0, a * Math.PI * 1.75 + branchDepth * 1.2]}
      >
        <mesh position={[0.018, -0.015, -0.004]}>
          <boxGeometry args={[length + 0.035, width + 0.014, 0.018]} />
          <meshBasicMaterial
            color="#5b3d29"
            transparent
            opacity={0.34 + d * 0.2}
            depthWrite={false}
          />
        </mesh>
        <mesh>
          <boxGeometry args={[length, width, 0.024]} />
          <meshBasicMaterial
            color="#110c08"
            transparent
            opacity={0.64 + d * 0.28}
            depthWrite={false}
          />
        </mesh>
        {d > 0.55 && !branch ? (
          <mesh
            position={[length * 0.24, 0.055 + b * 0.035, 0.01]}
            rotation={[0, 0, -0.72 - b * 0.58]}
          >
            <boxGeometry args={[length * 0.45, width * 0.62, 0.02]} />
            <meshBasicMaterial
              color="#0b0805"
              transparent
              opacity={0.6 + d * 0.24}
              depthWrite={false}
            />
          </mesh>
        ) : null}
      </group>,
    );
  }
  return <group scale={[1, 1, 1 + d * 0.08]}>{marks}</group>;
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

/** Hardware Store: a stone shop with columns and a gold emblem. */
function HardwareStoreModel({ color }: { color: string }) {
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
      {id === "buyer" && <HardwareStoreModel color={color} />}
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

function MineScene({
  zoom,
  collectMode,
  selectedSupportKeys,
  dynamitePreviewCells,
  bunkerPreview,
  bunkerBlockedCells,
  bunker,
  activeBunkerRaid,
  selectedBunkerPartCell,
  bunkerPartDragTargetCell,
  bunkerTargetCell,
  bunkerBuildMode,
  onToggleSupport,
  onBunkerPartTap,
  onBunkerPartPointerDown,
  onBunkerCellHover,
  onBunkerCellTap,
  onBunkerDragTarget,
  onBunkerDragEnd,
}: MineCanvasProps) {
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
  const cameraMotion = useRef<MotionTrack | null>(null);
  const minerMotion = useRef<MotionTrack | null>(null);
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
    fallWarning: 0,
  });
  const minerPlaced = useRef(false);
  // Smoothed frame time (ms), exposed for performance QA. A surface walk
  // must not spike this the way the per-step village rebuild used to.
  const frameMsRef = useRef(16);
  const fallPlayback = useRef<FallPlayback | null>(null);
  const fallClearTimeout = useRef<number | null>(null);
  const [fallWindow, setFallWindow] = useState<FallWindow | null>(null);
  const renderedCellCountRef = useRef(0);
  const renderedCrackSegmentCountRef = useRef(0);

  const displayCol = fallWindow?.col ?? mine.miner.col;
  const minerRow = fallWindow?.toRow ?? mine.miner.row;
  const renderDistance = (col: number, row: number) =>
    Math.max(Math.abs(col - displayCol), Math.max(0, row - minerRow));
  const cameraZoom = clampMineCameraZoom(zoom, mine.gear);
  const maxCameraZoom = maxMineCameraZoom(mine.gear);
  const renderWindow = mineRenderWindow(mine.gear, cameraZoom);
  const litBelow = lightRadius(mine.gear);
  const lampDistance = mineLampDistanceForRadius(litBelow);
  const renderRadius = renderWindow.below;
  const renderColRadius = Math.min(renderWindow.cols, renderRadius);
  const firstCol = displayCol - renderColRadius;
  const lastCol = displayCol + renderColRadius;
  const firstRow = Math.max(0, minerRow - renderWindow.above);
  const lastRow = minerRow + renderWindow.below;

  useEffect(() => {
    return () => {
      if (fallClearTimeout.current != null) {
        window.clearTimeout(fallClearTimeout.current);
        fallClearTimeout.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    return useMineStore.subscribe((state, prev) => {
      if (state.tick === prev.tick) return;
      const playback = fallPlaybackFromResult(state.lastResult, state.tick);
      if (playback) {
        fallPlayback.current = playback;
        setFallWindow(fallWindowFromPlayback(playback));
      } else if (!(state.lastResult?.ok && state.lastResult.collapsed)) {
        fallPlayback.current = null;
        setFallWindow(null);
      }
    });
  }, []);

  // Dig/blast feedback: bursts, shake, swing, and facing keyed to the
  // last sim result.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the event stream; the rest is read-at-fire
  useLayoutEffect(() => {
    const j = juice.current;
    if (fallClearTimeout.current != null) {
      window.clearTimeout(fallClearTimeout.current);
      fallClearTimeout.current = null;
    }
    const playback = fallPlaybackFromResult(lastResult, tick);
    if (playback) {
      const activePlayback =
        fallPlayback.current?.key === playback.key
          ? fallPlayback.current
          : playback;
      fallPlayback.current = activePlayback;
      setFallWindow(fallWindowFromPlayback(activePlayback));
      const clearMs =
        activePlayback.kind === "fall"
          ? Math.min(1600, Math.max(850, 520 + activePlayback.fell * 100))
          : 4300;
      fallClearTimeout.current = window.setTimeout(() => {
        if (fallPlayback.current?.key === activePlayback.key)
          fallPlayback.current = null;
        setFallWindow((prev) =>
          prev?.key === activePlayback.key ? null : prev,
        );
        fallClearTimeout.current = null;
      }, clearMs);
    } else if (!(lastResult?.ok && lastResult.collapsed)) {
      fallPlayback.current = null;
      setFallWindow(null);
    }
    playMineResultSfx(lastResult, lastAction);
    if (lastAction === "left") j.facing = -1;
    else if (lastAction === "right") j.facing = 1;
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
      j.lunge = { x: -dc * 0.14, y: dr * 0.12, t: DIG_LUNGE_SECONDS };
      j.shake = Math.max(j.shake, 0.14);
      // Sparks fly off the rock face back toward the miner.
      spawnClang(j, sx, sy, -dc, dr);
    }
    if (!lastResult?.ok) return;
    const miner = mine.miner;
    const at = lastResult.dugAt ??
      lastResult.lost ?? { col: miner.col, row: miner.row };
    if (lastResult.cracked) {
      j.swing = PICK_SWING_SECONDS;
      const dc = lastAction === "left" ? -1 : lastAction === "right" ? 1 : 0;
      const dr = lastAction === "down" ? 1 : lastAction === "up" ? -1 : 0;
      const targetCol = miner.col + dc;
      const targetRow = miner.row + dr;
      const targetBiome = biomeAt(targetCol);
      const sx = cellX(targetCol);
      const sy = -targetRow;
      spawnSparks(j, sx, sy, 4);
      spawnBurst(
        j,
        sx,
        sy,
        lastResult.oreHarvested
          ? ORE_COLORS[lastResult.oreHarvested.ore]
          : lastResult.cracked.kind === "rock"
            ? rockColorsForBiome(targetBiome)[0]
            : biomeDirtColorAt(targetCol, targetRow),
        3,
      );
      j.shake = Math.max(j.shake, 0.02);
      j.lunge = { x: dc * 0.16, y: -dr * 0.13, t: DIG_LUNGE_SECONDS };
    }
    if (lastResult.plankCracked) {
      j.swing = PICK_SWING_SECONDS;
      spawnSparks(j, cellX(miner.col), -miner.row - 0.42, 4);
      spawnBurst(j, cellX(miner.col), -miner.row - 0.42, "#e4ad5b", 3);
      j.shake = Math.max(j.shake, 0.02);
      j.lunge = { x: 0, y: -0.13, t: DIG_LUNGE_SECONDS };
    }
    if (lastResult.dug) {
      j.swing = PICK_SWING_SECONDS;
      const color =
        lastResult.dugOre != null
          ? ORE_COLORS[lastResult.dugOre]
          : lastResult.dug === "rock"
            ? rockColorsForBiome(biomeAt(at.col))[0]
            : lastResult.dug === "part-cache"
              ? CACHE_COLOR
              : biomeDirtColorAt(at.col, at.row);
      if (lastResult.dug === "dirt") {
        spawnDirtBreakBurst(j, cellX(at.col), -at.row, color);
      } else {
        spawnBurst(
          j,
          cellX(at.col),
          -at.row,
          color,
          lastResult.dug === "rock" ? 16 : 11,
        );
      }
      spawnSparks(
        j,
        cellX(at.col),
        -at.row,
        lastResult.dug === "rock" ? 10 : lastResult.dug === "dirt" ? 5 : 6,
      );
      // Every strike thumps; rock thumps harder.
      j.shake = Math.max(
        j.shake,
        lastResult.dug === "rock"
          ? 0.12
          : lastResult.dug === "dirt"
            ? 0.16
            : 0.045,
      );
      // Lunge the body toward the struck cell.
      const ldx = lastAction === "left" ? -1 : lastAction === "right" ? 1 : 0;
      const ldy = lastAction === "down" ? -1 : lastAction === "up" ? 1 : 0;
      j.lunge = { x: ldx * 0.16, y: ldy * 0.13, t: DIG_LUNGE_SECONDS };
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
      const biome = biomeAt(at.col);
      const ventColor =
        biome === "winter"
          ? "#9ee7ff"
          : biome === "highTech"
            ? "#65ffb8"
            : GAS_COLOR;
      spawnBurst(j, cellX(at.col), -at.row, ventColor, 16);
      j.shake = Math.max(j.shake, 0.25);
    }
    if (lastResult.fallingRockWarnings?.length) {
      for (const warning of lastResult.fallingRockWarnings.slice(0, 6)) {
        spawnFallWarning(j, cellX(warning.col), -warning.row);
      }
      j.fallWarning = 0.55;
      j.shake = Math.max(j.shake, 0.08);
    }
    if (lastResult.ladderFalls?.length) {
      const visibleFalls = lastResult.ladderFalls.slice(0, 14);
      for (const fall of visibleFalls) {
        spawnLadderFall(j, cellX(fall.to.col), -fall.from.row, -fall.to.row);
      }
      j.shake = Math.max(
        j.shake,
        Math.min(0.18, 0.055 + visibleFalls.length * 0.014),
      );
    }
    if (lastResult.crushed) j.shake = Math.max(j.shake, 0.5);
  }, [tick]);

  useFrame((state, delta) => {
    const j = juice.current;
    const t = state.clock.elapsedTime;
    const activeFall = fallPlayback.current;
    let visualTargetX = cellX(mine.miner.col);
    let visualTargetY = -mine.miner.row;
    if (activeFall) {
      if (!activeFall.track) {
        const duration =
          activeFall.kind === "crush"
            ? 0.32
            : Math.min(1.05, Math.max(0.42, activeFall.fell * 0.11));
        activeFall.track = {
          fromX: cellX(activeFall.col),
          fromY: -activeFall.fromRow,
          toX: cellX(activeFall.col),
          toY: -activeFall.toRow,
          startedAt: t,
          duration,
          frames: 0,
        };
      }
      if (motionProgress(activeFall.track, t) < 1) activeFall.track.frames += 1;
      [visualTargetX, visualTargetY] = sampleMotion(activeFall.track, t);
      if (motionProgress(activeFall.track, t) >= 1 && !activeFall.impacted) {
        activeFall.impacted = true;
        activeFall.doneAt =
          t +
          (activeFall.kind === "crush"
            ? CRUSH_HOLD_SECONDS
            : FATAL_FALL_HOLD_SECONDS);
        const impactX = cellX(activeFall.col);
        const impactY = -activeFall.toRow;
        if (activeFall.kind === "crush") {
          spawnBurst(j, impactX, impactY, "#d9863a", 32);
          spawnSparks(j, impactX, impactY + 0.12, 18);
          j.shake = Math.max(j.shake, 0.9);
          playMineSfxEvent("crush");
        } else {
          spawnBurst(j, impactX, impactY, "#ff6b6b", 24);
          spawnSparks(j, impactX, impactY, 12);
          j.shake = Math.max(j.shake, 0.72);
          playMineSfxEvent("fall-death");
        }
      }
      if (activeFall.doneAt != null && t >= activeFall.doneAt) {
        const key = activeFall.key;
        fallPlayback.current = null;
        setFallWindow((prev) => (prev?.key === key ? null : prev));
      }
    }
    const resetJump =
      (lastResult?.ok && lastResult.collapsed && !activeFall) ||
      lastAction === "abandon" ||
      lastAction === "recall" ||
      lastAction === "warp-home" ||
      lastAction?.startsWith("warp-down") ||
      lastAction?.startsWith("portal-warp");
    // Camera rig eases down the shaft after the miner, with shake.
    const targetY = visualTargetY;
    const rig = rigRef.current;
    let depthT = 0;
    if (rig) {
      // Trip resets (collapse, recall, abandon) move the miner across
      // the whole map; gliding the camera through it reads as broken.
      const targetX = visualTargetX;
      const cameraJump =
        resetJump ||
        Math.hypot(targetX - rig.position.x, targetY - rig.position.y) > 6;
      if (activeFall) {
        cameraMotion.current = activeFall.track;
        rig.position.set(targetX, targetY, 0);
      } else if (cameraJump) {
        cameraMotion.current = snapMotion(
          t,
          targetX,
          targetY,
          CAMERA_STEP_SECONDS,
        );
        rig.position.set(targetX, targetY, 0);
      } else {
        cameraMotion.current = retargetMotion(
          cameraMotion.current,
          t,
          rig.position.x,
          rig.position.y,
          targetX,
          targetY,
          CAMERA_STEP_SECONDS,
        );
        if (motionProgress(cameraMotion.current, t) < 1)
          cameraMotion.current.frames += 1;
        const [cx, cy] = sampleMotion(cameraMotion.current, t);
        rig.position.set(cx, cy, 0);
      }
      j.shake = Math.max(0, j.shake - delta * 0.9);
      const sx = rig.position.x + (Math.random() - 0.5) * j.shake;
      const sy = (Math.random() - 0.5) * j.shake;
      state.camera.position.set(
        sx,
        rig.position.y + 1.5 + sy,
        mineCameraDistance(cameraZoom),
      );
      state.camera.lookAt(sx, rig.position.y + sy, 0);
      // Rendered camera pan exposed for motion QA on narrow viewports.
      state.gl.domElement.dataset.camX = rig.position.x.toFixed(2);
      state.gl.domElement.dataset.camY = rig.position.y.toFixed(2);
      state.gl.domElement.dataset.camZoom = cameraZoom.toFixed(2);
      state.gl.domElement.dataset.renderBelow = String(renderWindow.below);
      state.gl.domElement.dataset.litBelow = String(litBelow);
      state.gl.domElement.dataset.lampDistance = lampDistance.toFixed(2);
      state.gl.domElement.dataset.renderRadius = String(renderRadius);
      state.gl.domElement.dataset.renderMinCol = String(firstCol);
      state.gl.domElement.dataset.renderMaxCol = String(lastCol);
      state.gl.domElement.dataset.renderedCellCount = String(
        renderedCellCountRef.current,
      );
      state.gl.domElement.dataset.crackSegmentCount = String(
        renderedCrackSegmentCountRef.current,
      );
      state.gl.domElement.dataset.particleCount = String(j.particles.length);
      state.gl.domElement.dataset.darknessOpacityMin = hasDarknessOverlay
        ? minDarknessOpacity.toFixed(2)
        : "0.00";
      state.gl.domElement.dataset.darknessOpacityMax = hasDarknessOverlay
        ? maxDarknessOpacity.toFixed(2)
        : "0.00";
      state.gl.domElement.dataset.cameraMotionFrames = String(
        cameraMotion.current?.frames ?? 0,
      );
      depthT = Math.min(1, Math.max(0, -rig.position.y / DARK_DEPTH));
    }
    // Daylight dies with depth; the lamp takes over as the key light.
    const day = (1 - depthT) ** 1.7;
    if (ambientRef.current) ambientRef.current.intensity = 0.07 + 0.48 * day;
    if (hemiRef.current) hemiRef.current.intensity = 0.5 * day * day;
    if (dirRef.current) dirRef.current.intensity = 0.06 + 1.04 * day;
    const lamp = lampRef.current;
    if (lamp) {
      let intensity = (1.0 + 3.8 * depthT) * (1 + (litBelow - 3) * 0.1);
      // The lamp gutters when the trip is nearly out of energy.
      const energy = mine.miner.energy;
      if (minerRow > 0 && energy < 10)
        intensity *= 0.78 + 0.22 * Math.sin(t * 26) * Math.sin(t * 7.3);
      lamp.intensity = intensity;
      lamp.distance = lampDistance;
      lamp.decay = 1.25;
    }
    // The miner glides between cells instead of teleporting. useFrame is
    // the only writer of this position: a JSX position prop here would be
    // re-applied by R3F on every tick re-render, snapping Y back to the
    // prop value mid-glide (the old walk-left teleport-to-surface bug).
    const miner = minerRef.current;
    if (miner) {
      const tx = visualTargetX;
      const ty = visualTargetY;
      const stepSeconds = minerStepSeconds(mine.gear);
      // Teleport-scale jumps (trip resets) snap; easing across them
      // would fly the bot up through solid rock for seconds.
      const minerJump =
        (resetJump && !activeFall) ||
        !minerPlaced.current ||
        Math.abs(tx - miner.position.x) > 3 ||
        Math.abs(ty - miner.position.y) > 6;
      if (activeFall) {
        minerPlaced.current = true;
        minerMotion.current = activeFall.track;
        miner.position.set(tx, ty, 0.2);
      } else if (minerJump) {
        minerPlaced.current = true;
        minerMotion.current = snapMotion(t, tx, ty, stepSeconds);
        miner.position.set(tx, ty, 0.2);
      } else {
        minerMotion.current = retargetMotion(
          minerMotion.current,
          t,
          miner.position.x,
          miner.position.y,
          tx,
          ty,
          stepSeconds,
        );
        if (motionProgress(minerMotion.current, t) < 1)
          minerMotion.current.frames += 1;
        const [mx, my] = sampleMotion(minerMotion.current, t);
        miner.position.set(mx, my, 0.2);
      }
      // Rendered position exposed for motion QA (Rule 10): e2e reads these
      // to prove the glide never lifts toward the surface on lateral steps.
      const el = state.gl.domElement;
      el.dataset.minerX = miner.position.x.toFixed(2);
      el.dataset.minerY = miner.position.y.toFixed(2);
      el.dataset.minerMotionFrames = String(minerMotion.current?.frames ?? 0);
      el.dataset.fallVisualActive = activeFall ? "true" : "false";
      el.dataset.fallVisualImpact = activeFall?.impacted ? "true" : "false";
      el.dataset.fallingRockWarning = j.fallWarning > 0 ? "true" : "false";
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
      j.fallWarning = Math.max(0, j.fallWarning - delta);
      const lk = j.lunge.t / DIG_LUNGE_SECONDS;
      body.position.x = j.lunge.x * lk;
      // Grounded on the cell floor, with a soft idle hover bob.
      body.position.y = -0.14 + Math.sin(t * 2.4) * 0.018 + j.lunge.y * lk;
      // Lean into the glide while moving between cells.
      const vx = visualTargetX - miner.position.x;
      body.rotation.z = Math.max(-0.16, Math.min(0.16, -vx * 0.3));
      if (activeFall?.kind === "crush") {
        const crushed = activeFall.impacted ? 1 : 0;
        body.scale.x = 1 + crushed * 0.26;
        body.scale.y = 1 - crushed * 0.42;
        body.scale.z = 1 + crushed * 0.18;
        body.position.y -= crushed * 0.12;
        body.rotation.z += crushed * 0.24;
      } else {
        body.scale.set(1, 1, 1);
      }
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
        const k = j.swing / PICK_SWING_SECONDS;
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
  const cargoMeshes = [];
  const crackMeshes = [];
  const darknessMeshes = [];
  const supportSelectionMeshes = [];
  let minDarknessOpacity = 1;
  let maxDarknessOpacity = 0;
  let renderedCellCount = 0;
  let renderedCrackSegmentCount = 0;
  const selectedSupportSet = new Set(selectedSupportKeys ?? []);
  const dynamitePreviewSet = new Set(
    (dynamitePreviewCells ?? []).map((coord) => `${coord.col}:${coord.row}`),
  );
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const distanceFromMiner = fallWindow
        ? renderDistance(col, row)
        : lanternDistance(mine, col, row);
      if (distanceFromMiner > renderRadius) continue;
      const cell = cellAt(mine, col, row);
      if (!cell) continue;
      renderedCellCount += 1;
      const key = `${col}:${row}`;
      const x = cellX(col);
      const y = -row;
      const biome = biomeAt(col);
      if (cell.bag) {
        const bagOnBlock = cell.kind !== "empty";
        cargoMeshes.push(
          <group
            key={`bag:${key}`}
            position={[
              x,
              y + (bagOnBlock ? 0.18 : -0.28),
              bagOnBlock ? 0.92 : 0.28,
            ]}
            rotation={[0, cellHash(col, row, 67) * 0.35 - 0.18, 0]}
          >
            <DroppedBagMarker />
          </group>,
        );
      }
      if (dynamitePreviewSet.has(key)) {
        crackMeshes.push(
          <mesh key={`dynamite-preview:${key}`} position={[x, y, 0.86]}>
            <planeGeometry args={[1.1, 1.1]} />
            <meshBasicMaterial
              color="#ffe08a"
              transparent
              opacity={0.34}
              depthWrite={false}
            />
          </mesh>,
        );
      }
      const beyondLight = Math.max(0, distanceFromMiner - litBelow);
      if (beyondLight > 0) {
        const opacity = mineDarknessOpacity(
          beyondLight,
          cameraZoom,
          maxCameraZoom,
        );
        if (opacity > 0) {
          minDarknessOpacity = Math.min(minDarknessOpacity, opacity);
          maxDarknessOpacity = Math.max(maxDarknessOpacity, opacity);
          darknessMeshes.push(
            <mesh key={`dark:${key}`} position={[x, y, 0.72]}>
              <planeGeometry args={[1.08, 1.08]} />
              <meshBasicMaterial
                color={EDGE_DARKNESS_COLOR}
                transparent
                opacity={opacity}
                depthWrite={false}
              />
            </mesh>,
          );
        }
      }
      // Damaged blocks wear cracks (REQ-013); the overlay rides above
      // whatever shape the kind renders.
      const oreDamage =
        cell.kind === "ore" && cell.ore && cell.oreRemaining !== undefined
          ? 1 - cell.oreRemaining / oreReserveAt(cell.ore, row)
          : null;
      if (
        oreDamage !== null ||
        (cell.hp !== undefined && cell.kind !== "empty")
      ) {
        const damage =
          oreDamage ??
          1 -
            (cell.hp ?? hitsFor(cell.kind, mine.gear)) /
              hitsFor(cell.kind, mine.gear);
        renderedCrackSegmentCount += crackSegmentCountForDamage(damage);
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
                color={variedColor(tunnelColorForBiome(biome), col, row)}
                roughness={1}
              />
            </mesh>,
          );
        }
        // A planted ladder (REQ-020): rails and rungs against the wall.
        if (cell.ladder) {
          const ladderCanSalvage =
            collectMode && isSupportSalvageTarget(mine, col, row);
          const ladderSelected =
            ladderCanSalvage && selectedSupportSet.has(`ladder:${col},${row}`);
          const toggleLadder =
            ladderCanSalvage && onToggleSupport ? onToggleSupport : null;
          if (toggleLadder) {
            supportSelectionMeshes.push(
              <SupportCellHitTarget
                key={`support-hit:ladder:${key}`}
                target={{ type: "ladder", col, row }}
                onToggleSupport={toggleLadder}
              />,
            );
          }
          if (ladderSelected) {
            supportSelectionMeshes.push(
              <SelectedSupportCellOutline
                key={`selected-cell:ladder:${key}`}
                col={col}
                row={row}
              />,
            );
          }
          tunnelMeshes.push(
            // biome-ignore lint/a11y/noStaticElementInteractions: React Three Fiber scene targets are not DOM controls.
            <group
              key={`ladder:${key}`}
              position={[x, y, -0.28]}
              onClick={
                toggleLadder
                  ? (e) => {
                      e.stopPropagation();
                      toggleLadder({ type: "ladder", col, row });
                    }
                  : undefined
              }
            >
              {[-0.16, 0.16].map((rx) => (
                <mesh key={rx} position={[rx, 0, 0]}>
                  <boxGeometry args={[0.05, 1, 0.05]} />
                  <meshStandardMaterial
                    color={ladderCanSalvage ? "#d9a052" : "#a87b3e"}
                    emissive={ladderCanSalvage ? "#5a3411" : "#000000"}
                    emissiveIntensity={ladderCanSalvage ? 0.16 : 0}
                    roughness={0.85}
                    flatShading
                  />
                </mesh>
              ))}
              {[-0.3, 0, 0.3].map((ry) => (
                <mesh key={ry} position={[0, ry, 0]}>
                  <boxGeometry args={[0.36, 0.05, 0.05]} />
                  <meshStandardMaterial
                    color={ladderCanSalvage ? "#ffd078" : "#c99a55"}
                    emissive={ladderCanSalvage ? "#5a3411" : "#000000"}
                    emissiveIntensity={ladderCanSalvage ? 0.18 : 0}
                    roughness={0.85}
                    flatShading
                  />
                </mesh>
              ))}
              {ladderSelected ? (
                <SupportSelectionOutline width={0.54} height={1.08} />
              ) : null}
            </group>,
          );
        }
        // The warp beacon (REQ-029): a humming pylon in the dark.
        if (cell.beacon) {
          const beaconCanSalvage =
            collectMode && isSupportSalvageTarget(mine, col, row);
          const beaconSelected =
            beaconCanSalvage && selectedSupportSet.has(`beacon:${col},${row}`);
          const toggleBeacon =
            beaconCanSalvage && onToggleSupport ? onToggleSupport : null;
          tunnelMeshes.push(
            // biome-ignore lint/a11y/noStaticElementInteractions: React Three Fiber scene targets are not DOM controls.
            <group
              key={`beacon:${key}`}
              position={[x, y - 0.18, 0.1]}
              onClick={
                toggleBeacon
                  ? (e) => {
                      e.stopPropagation();
                      toggleBeacon({ type: "beacon", col, row });
                    }
                  : undefined
              }
            >
              <mesh>
                <cylinderGeometry args={[0.07, 0.12, 0.5, 8]} />
                <meshStandardMaterial
                  color={beaconCanSalvage ? "#8d58b8" : "#5a3a78"}
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
              {beaconSelected ? (
                <SupportSelectionOutline width={0.56} height={0.86} />
              ) : null}
            </group>,
          );
        }
        const drop = dropPileStats(cell);
        if (drop.count > 0) {
          const oreColor = drop.ore ? ORE_COLORS[drop.ore] : CACHE_COLOR;
          tunnelMeshes.push(
            <group key={`drop:${key}`} position={[x, y - 0.28, 0.18]}>
              <mesh
                rotation={[
                  cellHash(col, row, 41) * 1.2,
                  cellHash(col, row, 43) * 1.8,
                  cellHash(col, row, 47) * 1.4,
                ]}
              >
                <octahedronGeometry args={[0.16, 0]} />
                <meshStandardMaterial
                  color={oreColor}
                  emissive={oreColor}
                  emissiveIntensity={0.25}
                  roughness={0.55}
                  flatShading
                />
              </mesh>
              {drop.count > 1 ? (
                <DropPileMarkers extraCount={drop.count - 1} color={oreColor} />
              ) : null}
            </group>,
          );
        }
        // A plank bridge (REQ-022): boards spanning the cell floor.
        if (cell.plank) {
          const plankCanSalvage =
            collectMode && isSupportSalvageTarget(mine, col, row);
          const plankSelected =
            plankCanSalvage && selectedSupportSet.has(`plank:${col},${row}`);
          const togglePlank =
            plankCanSalvage && onToggleSupport ? onToggleSupport : null;
          if (togglePlank) {
            supportSelectionMeshes.push(
              <SupportCellHitTarget
                key={`support-hit:plank:${key}`}
                target={{ type: "plank", col, row }}
                onToggleSupport={togglePlank}
              />,
            );
          }
          if (plankSelected) {
            supportSelectionMeshes.push(
              <SelectedSupportCellOutline
                key={`selected-cell:plank:${key}`}
                col={col}
                row={row}
              />,
            );
          }
          tunnelMeshes.push(
            // biome-ignore lint/a11y/noStaticElementInteractions: React Three Fiber scene targets are not DOM controls.
            <group
              key={`plank:${key}`}
              position={[x, y - 0.42, 0.05]}
              onClick={
                togglePlank
                  ? (e) => {
                      e.stopPropagation();
                      togglePlank({ type: "plank", col, row });
                    }
                  : undefined
              }
            >
              {[-0.14, 0.14].map((pz) => (
                <mesh key={pz} position={[0, 0, pz]}>
                  <boxGeometry args={[0.98, 0.07, 0.22]} />
                  <meshStandardMaterial
                    color={plankCanSalvage ? "#e4ad5b" : "#b58a4a"}
                    emissive={plankCanSalvage ? "#4a2d10" : "#000000"}
                    emissiveIntensity={plankCanSalvage ? 0.14 : 0}
                    roughness={0.85}
                    flatShading
                  />
                </mesh>
              ))}
              <mesh position={[0, -0.05, 0]}>
                <boxGeometry args={[0.2, 0.06, 0.56]} />
                <meshStandardMaterial
                  color={plankCanSalvage ? "#ba8240" : "#8a6536"}
                  emissive={plankCanSalvage ? "#4a2d10" : "#000000"}
                  emissiveIntensity={plankCanSalvage ? 0.12 : 0}
                  roughness={0.9}
                  flatShading
                />
              </mesh>
              {plankSelected ? (
                <SupportSelectionOutline width={1.08} height={0.44} z={0.34} />
              ) : null}
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
                color={variedColor(biomeDirtColorAt(col, row), col, row)}
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
        const rockColors = rockColorsForBiome(biome);
        const tier = Math.min((cell.rockTier ?? 1) - 1, rockColors.length - 1);
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
              color={variedColor(rockColors[tier], col, row)}
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
                biome === "winter"
                  ? teeter !== undefined
                    ? "#c8e6f0"
                    : "#9fb5c8"
                  : biome === "highTech"
                    ? teeter !== undefined
                      ? "#65ffb8"
                      : "#3d625b"
                    : teeter !== undefined
                      ? BOULDER_WOBBLE_COLOR
                      : BOULDER_COLOR
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
              color={variedColor(
                biome === "winter"
                  ? "#335568"
                  : biome === "highTech"
                    ? "#122f28"
                    : "#5a2418",
                col,
                row,
              )}
              emissive={
                biome === "winter"
                  ? "#9ee7ff"
                  : biome === "highTech"
                    ? "#65ffb8"
                    : MAGMA_COLOR
              }
              emissiveIntensity={biome === "default" ? 0.55 : 0.42}
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
              color={variedColor(biomeDirtColorAt(col, row), col, row).lerp(
                new Color(
                  biome === "winter"
                    ? "#9ee7ff"
                    : biome === "highTech"
                      ? "#65ffb8"
                      : GAS_COLOR,
                ),
                0.45,
              )}
              emissive={
                biome === "winter"
                  ? "#9ee7ff"
                  : biome === "highTech"
                    ? "#65ffb8"
                    : GAS_COLOR
              }
              emissiveIntensity={0.12}
              roughness={0.7}
              flatShading
            />
          </RoundedBox>,
        );
        continue;
      }
      if (cell.kind === "metal") {
        blockMeshes.push(
          <RoundedBox
            key={key}
            args={[0.98, 0.98, 1.02]}
            radius={0.04}
            smoothness={1}
            position={[x, y, 0]}
          >
            <meshStandardMaterial
              color={variedColor(METAL_COLOR, col, row)}
              emissive="#101820"
              emissiveIntensity={0.14}
              roughness={0.28}
              metalness={0.85}
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
            color={variedColor(biomeDirtColorAt(col, row), col, row)}
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
    (fallWindow
      ? renderDistance(charge.col, charge.row) <= lightRadius(mine.gear)
      : lanternDistance(mine, charge.col, charge.row) <=
        lightRadius(mine.gear)) &&
    charge.row >= firstRow &&
    charge.row <= lastRow &&
    charge.col >= firstCol &&
    charge.col <= lastCol
  ) {
    blockMeshes.push(
      <DynamiteCharge
        key={`dynamite:${charge.col}:${charge.row}`}
        col={charge.col}
        row={charge.row}
      />,
    );
  }
  renderedCellCountRef.current = renderedCellCount;
  renderedCrackSegmentCountRef.current = renderedCrackSegmentCount;
  const hasDarknessOverlay = maxDarknessOpacity > 0;

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
      {cargoMeshes}
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
      {darknessMeshes}
      {supportSelectionMeshes}
      <BunkerOverlay
        preview={bunkerPreview}
        blockedCells={bunkerBlockedCells}
        bunker={bunker}
        activeRaid={activeBunkerRaid}
        selectedPartCell={selectedBunkerPartCell}
        dragTargetCell={bunkerPartDragTargetCell}
        targetCell={bunkerTargetCell}
        buildMode={bunkerBuildMode}
        onBunkerPartTap={onBunkerPartTap}
        onBunkerPartPointerDown={onBunkerPartPointerDown}
        onBunkerCellHover={onBunkerCellHover}
        onBunkerCellTap={onBunkerCellTap}
        onBunkerDragTarget={onBunkerDragTarget}
        onBunkerDragEnd={onBunkerDragEnd}
      />
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
      <SurfaceSkin firstCol={firstCol} lastCol={lastCol} mine={mine} />
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

interface MineCanvasProps {
  zoom: number;
  collectMode?: boolean;
  selectedSupportKeys?: readonly string[];
  dynamitePreviewCells?: readonly MineCoord[];
  bunkerPreview?: BunkerFootprint | null;
  bunkerBlockedCells?: readonly MineCoord[];
  bunker?: BunkerState | null;
  activeBunkerRaid?: BunkerRaidSnapshot | null;
  selectedBunkerPartCell?: MineCoord | null;
  bunkerPartDragTargetCell?: MineCoord | null;
  bunkerTargetCell?: MineCoord | null;
  bunkerBuildMode?: BunkerBuildMode;
  onToggleSupport?: (target: CollectTarget) => void;
  onBunkerPartTap?: (cell: MineCoord) => void;
  onBunkerPartPointerDown?: (cell: MineCoord) => void;
  onBunkerCellHover?: (cell: MineCoord) => void;
  onBunkerCellTap?: (cell: MineCoord) => void;
  onBunkerDragTarget?: (cell: MineCoord) => void;
  onBunkerDragEnd?: (cell: MineCoord) => void;
  onBunkerBackgroundTap?: () => void;
}

export default function MineCanvas(props: MineCanvasProps) {
  return (
    <Canvas
      camera={{ position: [0, 1.5, 13], fov: 42 }}
      dpr={[1, 2]}
      gl={createWebGPU}
      onPointerMissed={props.onBunkerBackgroundTap}
    >
      <MineScene {...props} />
    </Canvas>
  );
}
