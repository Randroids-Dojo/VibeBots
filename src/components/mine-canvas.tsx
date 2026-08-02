"use client";

import { RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  AmbientLight,
  Camera,
  DirectionalLight,
  HemisphereLight,
  Material,
  Object3D,
  PointLight,
} from "three/webgpu";
import {
  BoxGeometry,
  Color,
  Fog,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
} from "three/webgpu";
import { CanvasDrawCallProbe } from "@/components/canvas-draw-call-probe";
import { startFramesWhenSettled } from "@/components/compile-gate";
import {
  clampMineCameraZoom,
  mineCameraDistance,
  mineLampDistanceForRadius,
  mineProjectedVisibilityRadius,
  mineRenderWindow,
  mineVisibilityOpacity,
} from "@/components/mine-camera";
import { createWebGPU } from "@/components/part-visuals";
import { PerfProbeBridge } from "@/components/perf-probe-bridge";
import type { BunkerFootprint, BunkerState } from "@/sim/bunker";
import {
  biomeAt,
  type CollectTarget,
  cellAt,
  elevatorColumn,
  findPortalBeacons,
  hitsForCell,
  isSupportSalvageTarget,
  lanternDistance,
  lightRadius,
  type MineBiomeId,
  type MineCell,
  type MineCoord,
  type OreId,
  oreReserveAt,
  STRATA,
  stratumAt,
} from "@/sim/mine";
import { useMineStore } from "@/state/mine-store";
import { setDatasetNumber, setDatasetText } from "./dataset-diagnostics";
import { FallbackDprCap } from "./fallback-dpr-cap";
import {
  type GraphicsFeatures,
  graphicsFeaturesFor,
  hasCoarsePointer,
  isWebGPUBackend,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";
import {
  ACCENT_LIGHT_COUNT,
  ACCENT_SLOTS,
  accentEmitterCount,
  pushAccentEmitter,
  resetAccentEmitters,
} from "./mine-accent-lights";
import {
  blockDetailEnabled,
  tunnelFloorMaterial,
} from "./mine-block-materials";
import {
  type BlockInstancePlan,
  beginBlockPlan,
  createBlockInstancePlan,
  instancedBlockDraw,
  pushBlockInstance,
} from "./mine-block-plan";
import {
  CacheCrate,
  CrackMarks,
  cellRenderSignature,
  collectShardMaterials,
  crackSegmentCountForDamage,
  DropPileMarkers,
  DroppedBagMarker,
  DynamiteCharge,
  dropPileStats,
  FallingRockShard,
  FUSE_GLOW,
  type InstancedBlockBody,
  instancedBlockBody,
  MineBlockBody,
  OreCrystals,
  teeterUrgency,
} from "./mine-block-render";
import { BunkerOverlay } from "./mine-bunker-overlay";
import {
  CRUSH_HOLD_SECONDS,
  FATAL_FALL_HOLD_SECONDS,
  fatalFallPlaybackSeconds,
  POWER_DOWN_BEAT_SECONDS,
  POWER_DOWN_HOLD_SECONDS,
  useMineDeathPlaybackBridge,
} from "./mine-death-playback";
import {
  ELEVATOR_BOARD_SECONDS,
  ELEVATOR_CALL_SECONDS,
  type ElevatorPresentation,
  type ElevatorPresentationStage,
} from "./mine-elevator-presentation";
import { InstancedBlockGrid } from "./mine-instanced-grid";
import {
  collectBlockNodeMaterials,
  collectInstancedGridMaterials,
} from "./mine-material-warmup";
import { MinerBot } from "./mine-miner-render";
import {
  type MotionTrack,
  motionProgress,
  retargetMotion,
  sampleMotion,
  snapMotion,
} from "./mine-motion";
import { minerChainStepSeconds, minerStepSeconds } from "./mine-pacing";
import {
  type JuiceState,
  PARTICLE_KINDS,
  spawnBoosterThrust,
  spawnBurst,
  spawnClang,
  spawnDirtBreakBurst,
  spawnDust,
  spawnFallWarning,
  spawnGasHiss,
  spawnLadderFall,
  spawnOreGlitter,
  spawnSparks,
} from "./mine-particles";
import {
  BOULDER_COLOR,
  BOULDER_WOBBLE_COLOR,
  biomeDirtColorAt,
  CACHE_COLOR,
  cellHash,
  cellX,
  DARK_DEPTH,
  GAS_COLOR,
  GLOWING_ORES,
  MAGMA_COLOR,
  ORE_COLORS,
  rockColorsForBiome,
  STRATA_BG,
  TEETER_EMISSIVE,
  tunnelColorForBiome,
  variedColor,
} from "./mine-render-palette";
import { playMineResultSfx, playMineSfxEvent } from "./mine-sfx";
import {
  SelectedSupportCellOutline,
  SupportCellHitTarget,
} from "./mine-support-selection";
import { collectBunkerPartMaterials } from "./mine-surface-materials";
import {
  applySurfaceAtmosphereVisuals,
  SurfaceDressing,
  SurfaceSkin,
  usePrefersReducedMotion,
} from "./mine-surface-render";
import {
  MINE_CAVE_BACKDROP,
  MINE_VISIBILITY_VEIL,
  updateMineVisibilityVeil,
} from "./mine-visibility-material";
import {
  advanceCrushTumble,
  type CrushTumbleState,
  createCrushTumble,
} from "./miner-crush-tumble";
import {
  advanceMinerRig,
  BOUNCE_SECONDS,
  createMinerPose,
  createMinerRigState,
  DIG_LUNGE_SECONDS,
  LAND_SQUASH_SECONDS,
  type MinerPose,
  minerRigRestInputs,
  PICK_SWING_SECONDS,
} from "./miner-rig";
import { ScenePostProcessing } from "./scene-post";
import { StudioEnvironment } from "./studio-environment";
import {
  celestialPositionFor,
  daylightGradeFor,
  fogRangeForStratum,
  localClockHour,
  SURFACE_LIGHTING_STEP_SECONDS,
  surfaceHourFor,
} from "./time-of-day";

const CAMERA_STEP_SECONDS = 0.28;
/**
 * Desktop light trim (F-064). The WebGPU high tier stacks IBL reflections
 * and additive bloom on top of the same lamp and ambient the phone path
 * uses, which washed the mine out. Trim the fill and environment there so
 * the lit area reads without glare; the WebGL2/mobile path has no IBL or
 * bloom and keeps full strength for readability.
 */
const DESKTOP_LIGHT_TRIM = 0.82;
const DESKTOP_ENV_TRIM = 0.7;
/** How long the ordinary-fall pose window stays open after a drop (F-057).
 * Covers the glide down plus the ease-out back to the grounded stance. */
const FALL_ANIM_SECONDS = 0.45;
/** Instance pool sizes per particle kind; spawners cap the live pool at
 * 260 total, so these bound the per-kind bursts. */
const PARTICLE_CAPACITY = { spark: 96, debris: 192, dust: 96 } as const;
/* ---- Village building kit (REQ-021): one distinct model per stall.
 * Shared frame: every group sits at z -0.85 so the boardwalk and the
 * miner's walk row (z 0) stay clearly in front of every facade; the
 * ground line is at local y ~1.06. ---- */

/** Cached scene elements for one mine cell (F-075). `sig` fingerprints
 * every input the cell's JSX reads; while it matches, the tick re-render
 * hands React the identical element references and reconciliation bails
 * out on the whole cell subtree. The mine world mutates in place, so
 * cell object identity can never stand in for this signature. */
interface MineCellEntry {
  sig: string;
  /** Last render generation that visited this cell; eviction drops the
   * cells that left the window without touching the live ones. */
  gen: number;
  block: ReactElement[];
  cargo: ReactElement[];
  tunnel: ReactElement[];
  crack: ReactElement[];
  support: ReactElement[];
}

/** Cached-cell count that triggers an eviction sweep. A long trip visits
 * far more cells than one render window shows; past this, entries not
 * visited on the previous render are dropped (never the live window). */
const CELL_CACHE_LIMIT = 4000;

/** View-layer inputs to one cell's element build: everything the
 * cell's JSX reads that is not a MineCell field. Mirrored, quantized,
 * into the cache signature by the render loop. */
interface MineCellViewInputs {
  dynamitePreview: boolean;
  damage: number | null;
  canSalvage: boolean;
  drop: { count: number; ore: OreId | null } | null;
  supportToggle: ((target: CollectTarget) => void) | null;
  teeterMeshRef: (
    key: string,
    x: number,
  ) => (mesh: Group | Mesh | null) => void;
}

/** Module scratch the render loop fills per instanced cell before copying
 * into the block plan, so classifying a cell allocates nothing. Every
 * field is written by instancedBlockBody before any read, so the geometry
 * and material start undefined rather than seeding a throwaway material. */
const instanceBodyScratch: InstancedBlockBody = {
  geometry: undefined as unknown as InstancedBlockBody["geometry"],
  material: undefined as unknown as InstancedBlockBody["material"],
  rotX: 0,
  rotY: 0,
  rotZ: 0,
};

// Shared geometry and materials for the planted ladder and plank supports
// so a support cell mounts allocation-free (dispose={null} safe). Each
// material pair is [normal, salvageable], indexed by `canSalvage ? 1 : 0`.
function supportMaterial(
  color: string,
  emissive: string,
  emissiveIntensity: number,
  roughness: number,
): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    roughness,
    flatShading: true,
  });
}
const LADDER_RAIL_GEOMETRY = new BoxGeometry(0.05, 1, 0.05);
const LADDER_RUNG_GEOMETRY = new BoxGeometry(0.36, 0.05, 0.05);
const PLANK_BOARD_GEOMETRY = new BoxGeometry(0.98, 0.07, 0.22);
const PLANK_BEAM_GEOMETRY = new BoxGeometry(0.2, 0.06, 0.56);
const ELEVATOR_GUIDE_GEOMETRY = new BoxGeometry(0.07, 1, 0.07);
const ELEVATOR_TIE_GEOMETRY = new BoxGeometry(0.7, 0.06, 0.1);
const ELEVATOR_CAR_FLOOR_GEOMETRY = new BoxGeometry(0.9, 0.12, 0.72);
const ELEVATOR_CAR_BACK_GEOMETRY = new BoxGeometry(0.82, 0.72, 0.08);
const ELEVATOR_CAR_POST_GEOMETRY = new BoxGeometry(0.07, 0.9, 0.07);
const ELEVATOR_CAR_ROOF_GEOMETRY = new BoxGeometry(0.9, 0.08, 0.5);
const ELEVATOR_CAR_GATE_GEOMETRY = new BoxGeometry(0.055, 0.72, 0.055);
const ELEVATOR_CAR_LAMP_GEOMETRY = new BoxGeometry(0.18, 0.1, 0.08);
const ELEVATOR_REDUCED_MOTION_SECONDS = 0.12;
const ELEVATOR_GUIDE_MATERIAL = new MeshStandardMaterial({
  color: "#9aa7ff",
  roughness: 0.45,
  metalness: 0.5,
  flatShading: true,
});
const ELEVATOR_TIE_MATERIAL = new MeshStandardMaterial({
  color: "#6b7baa",
  roughness: 0.6,
  metalness: 0.4,
  flatShading: true,
});
const ELEVATOR_CAR_MATERIAL = new MeshStandardMaterial({
  color: "#6978bd",
  emissive: "#171d48",
  emissiveIntensity: 0.16,
  roughness: 0.38,
  metalness: 0.62,
  flatShading: true,
});
const ELEVATOR_CAR_EDGE_MATERIAL = new MeshStandardMaterial({
  color: "#b7c0ff",
  emissive: "#303b92",
  emissiveIntensity: 0.24,
  roughness: 0.3,
  metalness: 0.7,
  flatShading: true,
});
const ELEVATOR_CAR_LAMP_MATERIAL = new MeshStandardMaterial({
  color: "#fff2ad",
  emissive: "#ffd85d",
  emissiveIntensity: 1.6,
  roughness: 0.32,
  metalness: 0.12,
  flatShading: true,
});
const ELEVATOR_GUIDE_OFFSETS = [-0.32, 0.32] as const;
const LADDER_RAIL_MATERIALS = [
  supportMaterial("#a87b3e", "#000000", 0, 0.85),
  supportMaterial("#d9a052", "#5a3411", 0.16, 0.85),
];
const LADDER_RUNG_MATERIALS = [
  supportMaterial("#c99a55", "#000000", 0, 0.85),
  supportMaterial("#ffd078", "#5a3411", 0.18, 0.85),
];
const PLANK_BOARD_MATERIALS = [
  supportMaterial("#b58a4a", "#000000", 0, 0.85),
  supportMaterial("#e4ad5b", "#4a2d10", 0.14, 0.85),
];
const PLANK_BEAM_MATERIALS = [
  supportMaterial("#8a6536", "#000000", 0, 0.9),
  supportMaterial("#ba8240", "#4a2d10", 0.12, 0.9),
];

// Shared geometry and materials for the carved-cell overlays (recessed
// tunnel floor, darkness plane) so a reveal burst mounts them without
// building geometry/materials per cell (dispose={null} safe). The floor
// tint jitter rides the shared node shader; one floor material per biome
// is precomputed. Darkness opacity is bucketed to 0.02 (it only shows at
// max zoom over a narrow ramp) so the cache stays bounded.
// Each class's constant depth offset is baked into its shared geometry
// (the old per-mesh position z), so the instanced path needs no per-
// instance z: positionWorld includes the geometry translation, keeping
// the tint jitter and the rendered output identical to the mesh path.
const TUNNEL_FLOOR_GEOMETRY = new BoxGeometry(1, 1, 0.12).translate(
  0,
  0,
  -0.42,
);
const CAVE_BACKDROP_WIDTH = 60;
const CAVE_BACKDROP_HEIGHT = 44;
const CAVE_BACKDROP_SURFACE_TOP = -0.5;
const CAVE_BACKDROP_SURFACE_CENTER =
  CAVE_BACKDROP_SURFACE_TOP - CAVE_BACKDROP_HEIGHT / 2;
const TUNNEL_FLOOR_MATERIALS: Record<
  MineBiomeId,
  ReturnType<typeof tunnelFloorMaterial>
> = {
  default: tunnelFloorMaterial(tunnelColorForBiome("default")),
  winter: tunnelFloorMaterial(tunnelColorForBiome("winter")),
  highTech: tunnelFloorMaterial(tunnelColorForBiome("highTech")),
};

// Tiny offscreen warm-up mesh geometry, shared across every warm mesh so
// the renderer compiles each material's program once at load, not on first
// draw mid-play.
const ACCENT_LIGHT_INDICES = [0, 1, 2] as const;

const WARMUP_GEOMETRY = new BoxGeometry(0.001, 0.001, 0.001);

// Camera for background-compiling new grid buckets (F-078). It enables
// every layer so a bucket parked on the grid's pending layer is still
// projected by compileAsync; the compiled program does not depend on the
// camera, only on material, lights, and scene state, so the real camera
// picks the program up when the bucket goes live on layer 0.
const BUCKET_PRECOMPILE_CAMERA = new PerspectiveCamera();
BUCKET_PRECOMPILE_CAMERA.layers.enableAll();

/** Build one offscreen warm mesh per material and compile them all in one
 * pass, so first-use shader compilation is paid at load, not per action.
 * Instanced-body materials warm on an InstancedMesh (a distinct program);
 * everything else on a plain mesh. Returns the temp group's disposer plus
 * the compile promise, so the canvas can hold frames until it settles
 * (F-081). */
function warmMineMaterials(
  gl: { compileAsync?: (scene: Object3D, camera: Camera) => Promise<unknown> },
  scene: Object3D,
  camera: Camera,
  detail: boolean,
): { dispose: () => void; compiled: Promise<unknown> | null } {
  const group = new Group();
  group.position.set(0, 0, -500);
  const addWarm = (material: Material) => {
    group.add(new Mesh(WARMUP_GEOMETRY, material));
  };
  const addWarmInstanced = (material: Material) => {
    group.add(new InstancedMesh(WARMUP_GEOMETRY, material, 1));
  };
  for (const material of collectInstancedGridMaterials(detail)) {
    addWarmInstanced(material);
  }
  for (const material of collectBlockNodeMaterials(detail)) addWarm(material);
  for (const material of collectShardMaterials()) addWarm(material);
  for (const material of collectBunkerPartMaterials(detail)) addWarm(material);
  for (const materials of [
    LADDER_RAIL_MATERIALS,
    LADDER_RUNG_MATERIALS,
    PLANK_BOARD_MATERIALS,
    PLANK_BEAM_MATERIALS,
  ]) {
    for (const material of materials) addWarm(material);
  }
  addWarm(ELEVATOR_GUIDE_MATERIAL);
  addWarm(ELEVATOR_TIE_MATERIAL);
  addWarm(ELEVATOR_CAR_MATERIAL);
  addWarm(ELEVATOR_CAR_EDGE_MATERIAL);
  addWarm(ELEVATOR_CAR_LAMP_MATERIAL);
  addWarm(MINE_VISIBILITY_VEIL);
  scene.add(group);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    scene.remove(group);
    for (const child of group.children) {
      if ((child as InstancedMesh).isInstancedMesh) {
        (child as InstancedMesh).dispose();
      }
    }
    group.clear();
  };
  let compiled: Promise<unknown> | null = null;
  try {
    compiled = gl.compileAsync?.(scene, camera) ?? null;
    if (compiled) compiled.then(dispose, dispose);
    else dispose();
  } catch {
    dispose();
  }
  return { dispose, compiled };
}

/**
 * Scene background and fog for the current stratum, mutated in place.
 * Swapping the Fog/Color OBJECTS (what declarative
 * `<fog args={...}>` / `<color attach="background" args={...}>` do
 * whenever stratumIndex changes) rekeys the scene's node cache in
 * three/webgpu, and the renderer synchronously rebuilds and recompiles
 * every visible material's pipeline inside the frame. Real-device
 * telemetry (session f33f75, build 275150) measured that as a 2.3-2.9 s
 * frame at every stratum boundary and surface return, recurring on every
 * crossing. One Fog and one Color live for the canvas's life; only
 * their values change, which never rekeys anything.
 */
function StratumAtmosphere({
  color,
  near,
  far,
}: {
  color: string;
  near: number;
  far: number;
}) {
  const scene = useThree((state) => state.scene);
  const fogRef = useRef<Fog | null>(null);
  const backgroundRef = useRef<Color | null>(null);
  useLayoutEffect(() => {
    fogRef.current ??= new Fog(color, near, far);
    backgroundRef.current ??= new Color(color);
    const fog = fogRef.current;
    fog.color.set(color);
    fog.near = near;
    fog.far = far;
    backgroundRef.current.set(color);
    scene.fog = fog;
    scene.background = backgroundRef.current;
  }, [scene, color, near, far]);
  useEffect(() => {
    return () => {
      scene.fog = null;
      scene.background = null;
    };
  }, [scene]);
  return null;
}

/** Build one cell's elements. Module-scope on purpose: the closures
 * baked into cached elements (onClick, teeter refs) must not chain to
 * a render activation scope, or every cached cell would pin the whole
 * tick that built it. */
function buildCellEntry(
  sig: string,
  gen: number,
  cell: MineCell,
  col: number,
  row: number,
  view: MineCellViewInputs,
): MineCellEntry {
  const {
    dynamitePreview,
    damage,
    canSalvage,
    drop,
    supportToggle,
    teeterMeshRef,
  } = view;
  const key = `${col}:${row}`;
  const x = cellX(col);
  const y = -row;
  const biome = biomeAt(col);
  const entry: MineCellEntry = {
    sig,
    gen,
    block: [],
    cargo: [],
    tunnel: [],
    crack: [],
    support: [],
  };
  if (cell.bag) {
    const bagOnBlock = cell.kind !== "empty";
    entry.cargo.push(
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
  if (dynamitePreview) {
    entry.crack.push(
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
  // Damaged blocks wear cracks (REQ-013); the overlay rides above
  // whatever shape the kind renders.
  if (damage !== null) {
    entry.crack.push(
      <group key={`crack:${key}`} position={[x, y, 0]}>
        <CrackMarks col={col} row={row} damage={damage} />
      </group>,
    );
  }
  if (cell.kind === "empty") {
    // The recessed tunnel floor itself is streamed by the instanced grid
    // (the render loop pushes it into the block plan); only the sparse
    // decorations below stay React-reconciled.
    // A planted ladder (REQ-020): rails and rungs against the wall.
    if (cell.ladder) {
      const toggleLadder = canSalvage ? supportToggle : null;
      if (toggleLadder) {
        entry.support.push(
          <SupportCellHitTarget
            key={`support-hit:ladder:${key}`}
            target={{ type: "ladder", col, row }}
            onToggleSupport={toggleLadder}
          />,
        );
      }
      entry.tunnel.push(
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
            <mesh
              key={rx}
              position={[rx, 0, 0]}
              geometry={LADDER_RAIL_GEOMETRY}
              material={LADDER_RAIL_MATERIALS[canSalvage ? 1 : 0]}
              dispose={null}
            />
          ))}
          {[-0.3, 0, 0.3].map((ry) => (
            <mesh
              key={ry}
              position={[0, ry, 0]}
              geometry={LADDER_RUNG_GEOMETRY}
              material={LADDER_RUNG_MATERIALS[canSalvage ? 1 : 0]}
              dispose={null}
            />
          ))}
        </group>,
      );
    }
    // The warp beacon (REQ-029): a humming pylon in the dark.
    if (cell.beacon) {
      const toggleBeacon = canSalvage ? supportToggle : null;
      entry.tunnel.push(
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
              color={canSalvage ? "#8d58b8" : "#5a3a78"}
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
              emissiveIntensity={1.9}
              flatShading
            />
          </mesh>
        </group>,
      );
    }
    if (drop && drop.count > 0) {
      const oreColor = drop.ore ? ORE_COLORS[drop.ore] : CACHE_COLOR;
      entry.tunnel.push(
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
      const togglePlank = canSalvage ? supportToggle : null;
      if (togglePlank) {
        entry.support.push(
          <SupportCellHitTarget
            key={`support-hit:plank:${key}`}
            target={{ type: "plank", col, row }}
            onToggleSupport={togglePlank}
          />,
        );
      }
      entry.tunnel.push(
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
            <mesh
              key={pz}
              position={[0, 0, pz]}
              geometry={PLANK_BOARD_GEOMETRY}
              material={PLANK_BOARD_MATERIALS[canSalvage ? 1 : 0]}
              dispose={null}
            />
          ))}
          <mesh
            position={[0, -0.05, 0]}
            geometry={PLANK_BEAM_GEOMETRY}
            material={PLANK_BEAM_MATERIALS[canSalvage ? 1 : 0]}
            dispose={null}
          />
        </group>,
      );
    }
    return entry;
  }
  // Static solid bodies (dirt, ore, non-fallen rock, metal) are streamed
  // by the instanced grid, not reconciled per cell. The ore cell still
  // overlays its crystals through React; the dirt base is instanced.
  if (instancedBlockDraw(cell)) {
    if (cell.kind === "ore" && cell.ore) {
      entry.block.push(
        <group key={key} position={[x, y, 0]}>
          <OreCrystals
            col={col}
            row={row}
            color={ORE_COLORS[cell.ore]}
            glow={GLOWING_ORES.has(cell.ore)}
          />
        </group>,
      );
    }
    return entry;
  }
  if (cell.kind === "ore" && cell.ore) {
    // Reached only for a teetering ore ceiling: React owns the wobble.
    entry.block.push(
      <group key={key} position={[x, y, 0]} ref={teeterMeshRef(key, x)}>
        <MineBlockBody cell={cell} col={col} row={row} biome={biome} />
      </group>,
    );
    return entry;
  }
  if (cell.kind === "rock") {
    // Reached only for a teetering or fallen rock (static rock is instanced).
    const teeter = cell.fallIn;
    const urgency = teeter !== undefined ? teeterUrgency(teeter) : 0;
    entry.block.push(
      <group
        key={key}
        position={[x, y, 0]}
        ref={teeter !== undefined ? teeterMeshRef(key, x) : undefined}
      >
        <FallingRockShard col={col} row={row} urgency={urgency} />
      </group>,
    );
    return entry;
  }
  if (cell.kind === "boulder") {
    const teeter = cell.fallIn;
    const urgency = teeter !== undefined ? teeterUrgency(teeter) : 0;
    entry.block.push(
      <mesh
        key={key}
        position={[x, y, 0]}
        rotation={[0, cellHash(col, row, 29) * 3.1, 0]}
        ref={teeter !== undefined ? teeterMeshRef(key, x) : undefined}
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
    return entry;
  }
  if (cell.kind === "part-cache") {
    entry.block.push(
      <group key={key} position={[x, y, 0]}>
        <CacheCrate col={col} row={row} />
      </group>,
    );
    return entry;
  }
  if (cell.kind === "magma") {
    entry.block.push(
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
    return entry;
  }
  if (cell.kind === "gas") {
    // A seeped wisp reads as haze, not rock: translucent, smaller,
    // glowing brighter so a leak stands out from the pocket it left.
    if (cell.gasSeeped) {
      entry.block.push(
        <mesh key={key} position={[x, y, 0]}>
          <sphereGeometry args={[0.42, 10, 8]} />
          <meshStandardMaterial
            color={
              biome === "winter"
                ? "#9ee7ff"
                : biome === "highTech"
                  ? "#65ffb8"
                  : GAS_COLOR
            }
            emissive={
              biome === "winter"
                ? "#9ee7ff"
                : biome === "highTech"
                  ? "#65ffb8"
                  : GAS_COLOR
            }
            emissiveIntensity={0.4}
            transparent
            opacity={0.42}
            depthWrite={false}
            roughness={0.9}
          />
        </mesh>,
      );
      return entry;
    }
    entry.block.push(
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
    return entry;
  }
  // Dirt and anything else (including a teetering metal, which never
  // reaches instancing): the shared body. A wide-span ceiling cell
  // teeters like a rock: the tremble is the collapse warning.
  entry.block.push(
    <group
      key={key}
      position={[x, y, 0]}
      ref={cell.fallIn !== undefined ? teeterMeshRef(key, x) : undefined}
    >
      <MineBlockBody cell={cell} col={col} row={row} biome={biome} />
    </group>,
  );
  return entry;
}

function MineScene({
  zoom,
  elevatorPresentation,
  collectMode,
  selectedSupportKeys,
  dynamitePreviewCells,
  bunkerPreview,
  bunkerBlockedCells,
  bunker,
  onToggleSupport,
  onElevatorStageComplete,
  graphicsFeatures,
  onWarmed,
}: MineCanvasProps & {
  graphicsFeatures: GraphicsFeatures;
  /** Fires once the warm compile settles (or the gate deadline passes);
   * the canvas owner flips frameloop to "always" on it (F-081). */
  onWarmed: () => void;
}) {
  const tick = useMineStore((s) => s.tick);
  const mine = useMineStore((s) => s.mine);
  const lastResult = useMineStore((s) => s.lastResult);
  const lastAction = useMineStore((s) => s.lastAction);
  void tick; // subscription trigger: the mine object mutates in place
  const rigRef = useRef<Group>(null);
  const caveBackdropRef = useRef<Mesh>(null);
  const minerRef = useRef<Group>(null);
  const elevatorCarRef = useRef<Group>(null);
  const elevatorGateRef = useRef<Group>(null);
  const minerBodyRef = useRef<Group>(null);
  const motesRef = useRef<Group>(null);
  const pickArmRef = useRef<Group>(null);
  const legLRef = useRef<Group>(null);
  const legRRef = useRef<Group>(null);
  const boosterRef = useRef<Group>(null);
  // Tracks whether the miner was falling last frame, to fire the landing
  // squash on the fall-to-ground transition (F-057).
  const wasFallingRef = useRef(false);
  // Walk cadence: advanced by distance actually travelled so the stride
  // is foot-locked to the glide, plus the prior frame's position to
  // measure that distance.
  const minerRig = useRef(createMinerRigState());
  const prevMinerPos = useRef<{ x: number; y: number } | null>(null);
  const cameraMotion = useRef<MotionTrack | null>(null);
  const minerMotion = useRef<MotionTrack | null>(null);
  const lampRef = useRef<PointLight>(null);
  const accentLightRefs = useRef<(PointLight | null)[]>([null, null, null]);
  const visibilityVeilRef = useRef<Mesh>(null);
  const ambientRef = useRef<AmbientLight>(null);
  const hemiRef = useRef<HemisphereLight>(null);
  const dirRef = useRef<DirectionalLight>(null);
  const stratumColorRef = useRef(new Color());
  const sparkInstRef = useRef<InstancedMesh>(null);
  const debrisInstRef = useRef<InstancedMesh>(null);
  const dustInstRef = useRef<InstancedMesh>(null);
  const particleMatrix = useRef(new Matrix4());
  const particleColor = useRef(new Color());
  const wobbleRefs = useRef<Map<string, Group | Mesh>>(new Map());
  const wobbleTargets = useRef<
    Map<string, { x: number; y: number; urgency: number }>
  >(new Map());
  // Imperative instanced block grid (F-075 escalation): the static solid
  // bodies stream through InstancedMeshes on this group instead of one
  // React-reconciled mesh per cell. The render loop refills `blockPlan`;
  // a layout effect applies it after render, off the frame path.
  const instancedGridGroupRef = useRef<Group>(null);
  const instancedGridRef = useRef<InstancedBlockGrid | null>(null);
  const blockPlan = useRef<BlockInstancePlan>(createBlockInstancePlan());
  // F-075 cell element cache: keyed `${col}:${row}`, dropped wholesale
  // when the world object changes identity (new trip, restored save).
  const cellElementCache = useRef<Map<string, MineCellEntry>>(new Map());
  const cellCacheWorld = useRef<object | null>(null);
  const cellCacheGen = useRef(0);
  // Cached cell elements bake their click handlers in, so the handlers
  // dispatch through a ref that always sees the latest prop.
  const onToggleSupportRef = useRef(onToggleSupport);
  onToggleSupportRef.current = onToggleSupport;
  const dispatchToggleSupport = useCallback((target: CollectTarget) => {
    onToggleSupportRef.current?.(target);
  }, []);
  // Stable factory for the teeter mount refs baked into cached elements;
  // its only free variable is the wobbleRefs ref itself.
  const teeterMeshRef = useCallback(
    (key: string, x: number) => (mesh: Group | Mesh | null) => {
      if (mesh) {
        mesh.userData.baseX = x;
        wobbleRefs.current.set(key, mesh);
      } else {
        wobbleRefs.current.delete(key);
      }
    },
    [],
  );
  const teeterMotionFrames = useRef(0);
  const crushTumble = useRef<{ key: number; state: CrushTumbleState } | null>(
    null,
  );
  const crushTumbleFrames = useRef(0);
  const timeOfDay = useRef({
    grade: daylightGradeFor(12),
    hour: 12,
    nextCheck: 0,
  });
  const juice = useRef<JuiceState>({
    particles: [],
    nextId: 1,
    shake: 0,
    swing: 0,
    bounce: 0,
    facing: 0,
    lunge: { x: 0, y: 0, t: 0 },
    fallWarning: 0,
    fallAnim: 0,
    land: 0,
    boosterSpawn: 0,
  });
  const minerPlaced = useRef(false);
  // Smoothed frame time (ms), exposed for performance QA. A surface walk
  // must not spike this the way the per-step village rebuild used to.
  const frameMsRef = useRef(16);
  // Frame-loop scratch: reused across frames so posing the miner,
  // sampling glides, and writing diagnostics allocate nothing per frame.
  const datasetCache = useRef<Record<string, number | string>>({});
  const motionSample = useRef<[number, number]>([0, 0]);
  const elevatorCarSample = useRef<[number, number]>([0, 0]);
  const elevatorCarMotion = useRef<MotionTrack>({
    fromX: 0,
    fromY: 0,
    toX: 0,
    toY: 0,
    startedAt: 0,
    duration: ELEVATOR_CALL_SECONDS,
    easeWeight: 1,
    frames: 0,
  });
  const elevatorVisual = useRef<{
    sequence: number;
    stage: ElevatorPresentationStage;
    startedAt: number;
    completedSequence: number;
    completedStage: ElevatorPresentationStage;
    carPlaced: boolean;
  }>({
    sequence: -1,
    stage: "idle",
    startedAt: 0,
    completedSequence: -1,
    completedStage: "idle",
    carPlaced: false,
  });
  const minerPoseScratch = useRef(createMinerPose());
  const rigInputs = useRef(minerRigRestInputs());
  const particleCounts = useRef({ spark: 0, debris: 0, dust: 0 });
  const particleInstFor = useRef<
    Record<(typeof PARTICLE_KINDS)[number], InstancedMesh | null>
  >({ spark: null, debris: null, dust: null });
  // Capability gate: shadow passes only when the real WebGPU backend is
  // driving; the WebGL2 fallback (headless CI, software GL, weak GPUs)
  // cannot afford them regardless of the pointer-derived tier.
  const webgpuBackend = useThree((state) => isWebGPUBackend(state.gl));
  const reducedMotion = usePrefersReducedMotion();
  // Shader-detail tier for the instanced block materials (matches
  // useBlockDetail: high quality AND the live WebGPU backend).
  const detail = blockDetailEnabled(webgpuBackend);
  // Renderer/scene/camera for the one-time material warm-up below.
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const { fallPlayback, fallWindow, clearFallPlayback, advanceFallAnchor } =
    useMineDeathPlaybackBridge(lastResult, tick);
  const renderedCellCountRef = useRef(0);
  const renderedCrackSegmentCountRef = useRef(0);
  const renderedTeeterCountRef = useRef(0);
  const renderedGasWispCountRef = useRef(0);

  const displayCol = fallWindow?.col ?? mine.miner.col;
  // The anchor walks down with the playback rather than sitting on the
  // death row, so a fall longer than the window is tall streams the shaft
  // past the bot instead of culling everything above `toRow - above`.
  const minerRow = fallWindow?.anchorRow ?? mine.miner.row;
  const renderDistance = (col: number, row: number) =>
    Math.max(Math.abs(col - displayCol), Math.max(0, row - minerRow));
  const cameraZoom = clampMineCameraZoom(zoom, mine.gear);
  const renderWindow = mineRenderWindow(mine.gear, cameraZoom);
  const litBelow = lightRadius(mine.gear);
  const projectedVisibilityRadius = mineProjectedVisibilityRadius(
    litBelow,
    cameraZoom,
  );
  const lampDistance = mineLampDistanceForRadius(litBelow);
  const renderRadius = renderWindow.below;
  const renderColRadius = Math.min(renderWindow.cols, renderRadius);
  const firstCol = displayCol - renderColRadius;
  const lastCol = displayCol + renderColRadius;
  const firstRow = Math.max(0, minerRow - renderWindow.above);
  const lastRow = minerRow + renderWindow.below;

  // Dig/blast feedback: bursts, shake, swing, and facing keyed to the
  // last sim result.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the event stream; the rest is read-at-fire
  useLayoutEffect(() => {
    const j = juice.current;
    playMineResultSfx(lastResult, lastAction);
    if (lastAction === "left") j.facing = -1;
    else if (lastAction === "right") j.facing = 1;
    else if (lastAction != null) j.facing = 0;
    // An ordinary (survived) drop opens the fall-pose window so the miner
    // reads as falling, not floating (F-057). Fatal falls and crushes run
    // their own playback and must not also trip this.
    if (
      lastResult?.ok &&
      !lastResult.collapsed &&
      lastResult.fell !== undefined &&
      lastResult.fell > 0
    ) {
      j.fallAnim = FALL_ANIM_SECONDS;
    }
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
      if (lastResult.dugOre != null) {
        spawnOreGlitter(
          j,
          cellX(at.col),
          -at.row,
          ORE_COLORS[lastResult.dugOre],
          GLOWING_ORES.has(lastResult.dugOre),
        );
      }
      if (lastResult.dug === "gas") {
        spawnGasHiss(j, cellX(at.col), -at.row);
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
    const presentationStage = elevatorPresentation.stage;
    const elevatorPassenger =
      mine.elevatorPhase !== "idle" &&
      presentationStage !== "idle" &&
      presentationStage !== "calling";
    // One alias pair for the whole frame: every diagnostics write below
    // goes through the same quantize-and-cache pair.
    const dataset = state.gl.domElement.dataset;
    const cache = datasetCache.current;
    const activeFall = fallPlayback.current;
    let visualTargetX = cellX(mine.miner.col);
    let visualTargetY = -mine.miner.row;
    // One step-timing pair per frame: the camera and the miner glide on
    // identical durations so they arrive together.
    const reducedBoardingMotion =
      reducedMotion && presentationStage === "boarding";
    const stepSeconds = reducedBoardingMotion
      ? ELEVATOR_REDUCED_MOTION_SECONDS
      : minerStepSeconds(mine.gear);
    const chainSeconds = reducedBoardingMotion
      ? ELEVATOR_REDUCED_MOTION_SECONDS
      : minerChainStepSeconds(mine.gear);
    // The surface ground visual sits higher than an underground cell
    // floor, so lift the bot at the ground line to keep feet on the
    // grass instead of shin-deep in the first block row. The camera
    // glide eases the step when entering the shaft.
    if (mine.miner.row <= 0 && !activeFall) {
      visualTargetY += elevatorPassenger ? -0.08 : 0.06;
    }
    if (activeFall) {
      if (!activeFall.track) {
        const duration =
          activeFall.kind === "crush"
            ? 0.32
            : activeFall.kind === "powerdown"
              ? POWER_DOWN_BEAT_SECONDS
              : fatalFallPlaybackSeconds(activeFall.fell);
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
      [visualTargetX, visualTargetY] = sampleMotion(
        activeFall.track,
        t,
        motionSample.current,
      );
      advanceFallAnchor(Math.round(-visualTargetY));
      if (motionProgress(activeFall.track, t) >= 1 && !activeFall.impacted) {
        activeFall.impacted = true;
        // Signal the panel that the impact frame has rendered; the trip
        // report waits on this instead of racing the visuals wall-clock.
        useMineStore.getState().markFallVisualImpact(activeFall.key);
        activeFall.doneAt =
          t +
          (activeFall.kind === "crush"
            ? CRUSH_HOLD_SECONDS
            : activeFall.kind === "powerdown"
              ? POWER_DOWN_HOLD_SECONDS
              : FATAL_FALL_HOLD_SECONDS);
        const impactX = cellX(activeFall.col);
        const impactY = -activeFall.toRow;
        if (activeFall.kind === "crush") {
          spawnBurst(j, impactX, impactY, "#d9863a", 32);
          spawnSparks(j, impactX, impactY + 0.12, 18);
          j.shake = Math.max(j.shake, 0.9);
          playMineSfxEvent("crush");
        } else if (activeFall.kind === "powerdown") {
          // The lamp dies: a few cold fizzling sparks, no crash.
          spawnSparks(j, impactX, impactY + 0.2, 8);
          j.shake = Math.max(j.shake, 0.28);
        } else {
          spawnBurst(j, impactX, impactY, "#ff6b6b", 24);
          spawnSparks(j, impactX, impactY, 12);
          j.shake = Math.max(j.shake, 0.72);
          playMineSfxEvent("fall-death");
        }
      }
      if (activeFall.doneAt != null && t >= activeFall.doneAt) {
        const key = activeFall.key;
        clearFallPlayback(key);
      }
    }
    // The sim mutates mine before React refreshes this frame callback's
    // result and action closures. Read the existing store snapshot so the
    // first frame after a large elevator step does not take the jump path.
    const liveMineState = useMineStore.getState();
    const liveLastResult = liveMineState.lastResult;
    const liveLastAction = liveMineState.lastAction;
    const resetJump =
      (liveLastResult?.ok && liveLastResult.collapsed && !activeFall) ||
      liveLastAction === "abandon" ||
      liveLastAction === "recall" ||
      liveLastAction === "warp-home" ||
      liveLastAction?.startsWith("warp-down") ||
      liveLastAction?.startsWith("portal-warp");
    const elevatorMotion =
      liveLastResult?.ok === true &&
      (liveLastResult.elevatorEntered ||
        liveLastAction === "ride-down" ||
        liveLastAction === "ride-up");
    // Camera rig eases down the shaft after the miner, with shake.
    const targetY = visualTargetY;
    const rig = rigRef.current;
    let depthT = 0;
    if (rig) {
      // Trip resets (collapse, recall, abandon) move the miner across
      // the whole map; gliding the camera through it reads as broken.
      const targetX = visualTargetX;
      if (elevatorMotion) {
        const verticalLimit = Math.max(
          1,
          (targetY < rig.position.y ? renderWindow.above : renderWindow.below) -
            1,
        );
        if (Math.abs(targetY - rig.position.y) > verticalLimit) {
          // Large speed upgrades can skip hundreds of rows. Stage the
          // visible part inside the target render window, then animate
          // that final span instead of flying through unloaded cells.
          rig.position.y =
            targetY < rig.position.y
              ? targetY + verticalLimit
              : targetY - verticalLimit;
        }
      }
      const cameraJump =
        resetJump ||
        (!elevatorMotion &&
          Math.hypot(targetX - rig.position.x, targetY - rig.position.y) > 6);
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
        // The camera rides the miner's own step timing (F-movement): a
        // fixed faster tween used to arrive first and sit waiting at the
        // destination cell for the rest of every single step.
        cameraMotion.current = retargetMotion(
          cameraMotion.current,
          t,
          rig.position.x,
          rig.position.y,
          targetX,
          targetY,
          stepSeconds,
          chainSeconds,
        );
        if (motionProgress(cameraMotion.current, t) < 1)
          cameraMotion.current.frames += 1;
        const [cx, cy] = sampleMotion(
          cameraMotion.current,
          t,
          motionSample.current,
        );
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
      const caveBackdrop = caveBackdropRef.current;
      if (caveBackdrop) {
        caveBackdrop.position.x = rig.position.x;
        caveBackdrop.position.y = Math.min(
          CAVE_BACKDROP_SURFACE_CENTER,
          rig.position.y,
        );
      }
      // Rendered camera pan exposed for motion QA on narrow viewports.
      setDatasetNumber(cache, dataset, "camX", rig.position.x, 2);
      setDatasetNumber(cache, dataset, "camY", rig.position.y, 2);
      setDatasetNumber(cache, dataset, "camZoom", cameraZoom, 2);
      setDatasetNumber(cache, dataset, "renderBelow", renderWindow.below, 0);
      setDatasetNumber(cache, dataset, "litBelow", litBelow, 0);
      setDatasetNumber(cache, dataset, "lampDistance", lampDistance, 2);
      setDatasetNumber(cache, dataset, "renderRadius", renderRadius, 0);
      setDatasetNumber(cache, dataset, "renderMinCol", firstCol, 0);
      setDatasetNumber(cache, dataset, "renderMaxCol", lastCol, 0);
      setDatasetNumber(
        cache,
        dataset,
        "renderedCellCount",
        renderedCellCountRef.current,
        0,
      );
      setDatasetNumber(
        cache,
        dataset,
        "crackSegmentCount",
        renderedCrackSegmentCountRef.current,
        0,
      );
      // Live teetering blocks (undercut or span-condemned) plus proof the
      // tremble is really displacing meshes, for QA on collapse warnings
      // and plank rescues (Rule 10: pixels must move, not just flags).
      setDatasetNumber(
        cache,
        dataset,
        "teeterCount",
        renderedTeeterCountRef.current,
        0,
      );
      setDatasetNumber(
        cache,
        dataset,
        "teeterMotionFrames",
        teeterMotionFrames.current,
        0,
      );
      setDatasetNumber(
        cache,
        dataset,
        "gasWispCount",
        renderedGasWispCountRef.current,
        0,
      );
      setDatasetNumber(
        cache,
        dataset,
        "crushTumbleFrames",
        crushTumbleFrames.current,
        0,
      );
      setDatasetNumber(cache, dataset, "particleCount", j.particles.length, 0);
      setDatasetNumber(
        cache,
        dataset,
        "darknessOpacityMin",
        hasDarknessOverlay ? minDarknessOpacity : 0,
        2,
      );
      setDatasetNumber(
        cache,
        dataset,
        "darknessOpacityMax",
        hasDarknessOverlay ? maxDarknessOpacity : 0,
        2,
      );
      setDatasetText(cache, dataset, "visibilityMask", "continuous-radial");
      setDatasetText(cache, dataset, "cellSeams", "occluded");
      setDatasetNumber(
        cache,
        dataset,
        "cameraMotionFrames",
        cameraMotion.current?.frames ?? 0,
        0,
      );
      depthT = Math.min(1, Math.max(0, -rig.position.y / DARK_DEPTH));
    }
    // Daylight dies with depth; the lamp takes over as the key light. The
    // surface runs one persistent eight-minute shift cycle. Reduced motion
    // follows local time, and the QA override freezes any exact review hour.
    // Grade and orbit math run at 4 Hz while light intensity and depth blends
    // stay frame-smooth with reused Color instances.
    if (t >= timeOfDay.current.nextCheck) {
      const nowMs = Date.now();
      const now = new Date(nowMs);
      const override = (
        window as unknown as { __vibebotsTimeOfDayHour?: number }
      ).__vibebotsTimeOfDayHour;
      const hour = surfaceHourFor(
        nowMs,
        reducedMotion,
        localClockHour(now),
        override,
      );
      timeOfDay.current.hour = hour;
      timeOfDay.current.grade = daylightGradeFor(hour);
      const celestial = celestialPositionFor(hour);
      dirRef.current?.position.set(celestial[0], celestial[1], celestial[2]);
      timeOfDay.current.nextCheck = t + SURFACE_LIGHTING_STEP_SECONDS;
    }
    const grade = timeOfDay.current.grade;
    const veil = visibilityVeilRef.current;
    if (veil) {
      veil.position.set(visualTargetX, visualTargetY, 4.5);
      updateMineVisibilityVeil(
        visualTargetX,
        visualTargetY,
        projectedVisibilityRadius,
        grade.starOpacity,
      );
    }
    const day = (1 - depthT) ** 1.7;
    // The IBL + bloom high tier is the washed-out one (F-064); trim its
    // fill and environment, leave the mobile/WebGL2 path at full strength.
    const brightTier = webgpuBackend && graphicsFeatures.postBloom;
    const lightTrim = brightTier ? DESKTOP_LIGHT_TRIM : 1;
    const envTrim = brightTier ? DESKTOP_ENV_TRIM : 1;
    if (ambientRef.current) {
      ambientRef.current.intensity =
        (0.07 + grade.ambientStrength * day) * lightTrim;
      ambientRef.current.color.set(grade.ambientColor);
    }
    if (hemiRef.current) {
      hemiRef.current.intensity =
        grade.hemisphereStrength * day * day * lightTrim;
      hemiRef.current.color.set(grade.skyColor);
      hemiRef.current.groundColor.set(grade.groundLightColor);
    }
    if (dirRef.current) {
      dirRef.current.intensity =
        (0.04 + 1.06 * day) * grade.sunStrength * lightTrim;
      dirRef.current.color.set(grade.sunColor);
    }
    setDatasetText(cache, dataset, "timeOfDay", grade.phase);
    setDatasetText(cache, dataset, "surfacePhase", grade.phase);
    setDatasetNumber(
      cache,
      dataset,
      "surfaceCycleHour",
      timeOfDay.current.hour,
      2,
    );
    setDatasetNumber(
      cache,
      dataset,
      "surfaceStarOpacity",
      grade.starOpacity * day,
      2,
    );
    applySurfaceAtmosphereVisuals(grade.starOpacity * day, grade);
    const depthColorBlend = Math.min(1, depthT * 1.65);
    const stratumColor = stratumColorRef.current.set(bg);
    if (state.scene.background instanceof Color) {
      state.scene.background
        .set(grade.skyColor)
        .lerp(stratumColor, depthColorBlend);
    }
    state.scene.fog?.color
      .set(grade.fogColor)
      .lerp(stratumColor, depthColorBlend);
    // The studio environment is a surface phenomenon: it fades with the
    // daylight so the underground keeps its lamp-lit darkness.
    state.scene.environmentIntensity =
      graphicsFeatures.environmentIntensity *
      (0.12 + (grade.environmentStrength - 0.12) * day) *
      envTrim;
    const lamp = lampRef.current;
    if (lamp) {
      let intensity =
        (1.0 + 3.8 * depthT) * (1 + (litBelow - 3) * 0.1) * lightTrim;
      if (minerRow === 0) intensity *= grade.starOpacity;
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

      if (elevatorMotion && minerPlaced.current) {
        const verticalLimit = Math.max(
          1,
          (ty < miner.position.y ? renderWindow.above : renderWindow.below) - 1,
        );
        if (Math.abs(ty - miner.position.y) > verticalLimit) {
          miner.position.y =
            ty < miner.position.y ? ty + verticalLimit : ty - verticalLimit;
        }
      }

      // Teleport-scale jumps (trip resets) snap; easing across them
      // would fly the bot up through solid rock for seconds.
      const minerJump =
        (resetJump && !activeFall) ||
        !minerPlaced.current ||
        (!elevatorMotion &&
          (Math.abs(tx - miner.position.x) > 3 ||
            Math.abs(ty - miner.position.y) > 6));
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
          chainSeconds,
        );
        if (motionProgress(minerMotion.current, t) < 1)
          minerMotion.current.frames += 1;
        const [mx, my] = sampleMotion(
          minerMotion.current,
          t,
          motionSample.current,
        );
        miner.position.set(mx, my, 0.2);
      }
      // Rendered position exposed for motion QA (Rule 10): e2e reads these
      // to prove the glide never lifts toward the surface on lateral steps.
      setDatasetNumber(cache, dataset, "minerX", miner.position.x, 2);
      setDatasetNumber(cache, dataset, "minerY", miner.position.y, 2);
      setDatasetNumber(
        cache,
        dataset,
        "minerMotionFrames",
        minerMotion.current?.frames ?? 0,
        0,
      );
      setDatasetText(
        cache,
        dataset,
        "fallVisualActive",
        activeFall ? "true" : "false",
      );
      setDatasetText(
        cache,
        dataset,
        "fallVisualImpact",
        activeFall?.impacted ? "true" : "false",
      );
      setDatasetText(
        cache,
        dataset,
        "fallingRockWarning",
        j.fallWarning > 0 ? "true" : "false",
      );
      // Smoothed frame time: a steady low value means no per-step hitches.
      frameMsRef.current += (delta * 1000 - frameMsRef.current) * 0.1;
      setDatasetNumber(cache, dataset, "frameMs", frameMsRef.current, 1);
    }
    const elevatorCar = elevatorCarRef.current;
    const elevatorGate = elevatorGateRef.current;
    const railColumn = elevatorColumn(mine.gear);
    if (elevatorCar && elevatorGate && railColumn !== null) {
      const visual = elevatorVisual.current;
      const carMotion = elevatorCarMotion.current;
      const stage = presentationStage;
      const targetY = -elevatorPresentation.carRow;
      const railBottom = Math.max(0, mine.gear.elevator);
      if (!visual.carPlaced) {
        visual.carPlaced = true;
        elevatorCar.position.set(railColumn, -railBottom, 0);
        elevatorGate.position.y = 0.55;
      }
      if (
        visual.sequence !== elevatorPresentation.sequence ||
        visual.stage !== stage
      ) {
        visual.sequence = elevatorPresentation.sequence;
        visual.stage = stage;
        visual.startedAt = t;
        if (stage === "calling") {
          const visibleLimit = Math.max(
            1,
            (elevatorCar.position.y < targetY
              ? renderWindow.below
              : renderWindow.above) - 1,
          );
          if (Math.abs(elevatorCar.position.y - targetY) > visibleLimit) {
            elevatorCar.position.y =
              elevatorCar.position.y < targetY
                ? targetY - visibleLimit
                : targetY + visibleLimit;
          }
          if (Math.abs(elevatorCar.position.y - targetY) < 0.12) {
            const approachRow =
              elevatorPresentation.carRow < railBottom
                ? elevatorPresentation.carRow + 1
                : Math.max(0, elevatorPresentation.carRow - 1);
            elevatorCar.position.y = -approachRow;
          }
          carMotion.fromX = railColumn;
          carMotion.fromY = elevatorCar.position.y;
          carMotion.toX = railColumn;
          carMotion.toY = targetY;
          carMotion.startedAt = t;
          carMotion.duration = reducedMotion
            ? ELEVATOR_REDUCED_MOTION_SECONDS
            : ELEVATOR_CALL_SECONDS;
          carMotion.easeWeight = 1;
          carMotion.frames = 0;
          elevatorGate.position.y = 0.55;
        } else if (stage === "boarding") {
          elevatorCar.position.set(railColumn, targetY, 0);
          elevatorGate.position.y = 0.55;
        } else if (stage === "choosing") {
          elevatorCar.position.set(railColumn, targetY, 0);
          elevatorGate.position.y = 0;
        }
      }
      if (stage === "calling") {
        if (motionProgress(carMotion, t) < 1) carMotion.frames += 1;
        const carPoint = sampleMotion(carMotion, t, elevatorCarSample.current);
        elevatorCar.position.set(carPoint[0], carPoint[1], 0);
        if (
          motionProgress(carMotion, t) >= 1 &&
          (visual.completedSequence !== visual.sequence ||
            visual.completedStage !== stage)
        ) {
          visual.completedSequence = visual.sequence;
          visual.completedStage = stage;
          onElevatorStageComplete?.(visual.sequence, stage);
        }
      } else if (stage === "boarding") {
        const boardingDuration = reducedMotion
          ? ELEVATOR_REDUCED_MOTION_SECONDS
          : ELEVATOR_BOARD_SECONDS;
        const boardingProgress = Math.max(
          0,
          Math.min(1, (t - visual.startedAt) / boardingDuration),
        );
        elevatorCar.position.set(railColumn, targetY, 0);
        elevatorGate.position.y = 0.55 * (1 - boardingProgress);
        const minerReady =
          minerMotion.current === null ||
          motionProgress(minerMotion.current, t) >= 1;
        if (
          boardingProgress >= 1 &&
          minerReady &&
          (visual.completedSequence !== visual.sequence ||
            visual.completedStage !== stage)
        ) {
          visual.completedSequence = visual.sequence;
          visual.completedStage = stage;
          onElevatorStageComplete?.(visual.sequence, stage);
        }
      } else if (stage === "riding") {
        elevatorCar.position.set(
          railColumn,
          miner?.position.y ?? -mine.miner.row,
          0,
        );
        elevatorGate.position.y = 0;
        const minerReady =
          minerMotion.current === null ||
          motionProgress(minerMotion.current, t) >= 1;
        if (
          mine.elevatorPhase === "boarded" &&
          minerReady &&
          (visual.completedSequence !== visual.sequence ||
            visual.completedStage !== stage)
        ) {
          visual.completedSequence = visual.sequence;
          visual.completedStage = stage;
          onElevatorStageComplete?.(visual.sequence, stage);
        }
      } else if (stage === "choosing") {
        elevatorCar.position.set(railColumn, targetY, 0);
        elevatorGate.position.y = 0;
      } else {
        elevatorCar.position.x = railColumn;
        elevatorGate.position.y = 0.55;
      }
      setDatasetText(cache, dataset, "elevatorStage", stage);
      setDatasetNumber(
        cache,
        dataset,
        "elevatorCarY",
        elevatorCar.position.y,
        2,
      );
      setDatasetNumber(
        cache,
        dataset,
        "elevatorCarMotionFrames",
        carMotion.frames,
        0,
      );
    }
    // Body language, foot-locked stride, and the pick arm all come from
    // the shared rig (miner-rig.ts): the canvas owns the timers and the
    // refs, the rig owns how inputs become joint transforms.
    j.lunge.t = Math.max(0, j.lunge.t - delta);
    j.fallWarning = Math.max(0, j.fallWarning - delta);
    j.swing = Math.max(0, j.swing - delta);
    j.bounce = Math.max(0, j.bounce - delta);
    j.fallAnim = Math.max(0, j.fallAnim - delta);
    j.land = Math.max(0, j.land - delta);
    const body = minerBodyRef.current;
    const legL = legLRef.current;
    const legR = legRRef.current;
    const arm = pickArmRef.current;
    if (miner && body && legL && legR && arm) {
      const prev = prevMinerPos.current;
      const dx = prev ? miner.position.x - prev.x : 0;
      const dy = prev ? miner.position.y - prev.y : 0;
      if (prev) {
        prev.x = miner.position.x;
        prev.y = miner.position.y;
      } else {
        prevMinerPos.current = { x: miner.position.x, y: miner.position.y };
      }
      // A landed crush plays the physically integrated tumble instead of
      // the static crumple: the block's hit launches the wreck, it
      // bounces out its energy, and the pose settles into the designed
      // crumple the trip report has always framed.
      const crushLanded =
        activeFall?.kind === "crush" ? activeFall.impacted : false;
      let pose: MinerPose;
      if (crushLanded && activeFall) {
        if (crushTumble.current?.key !== activeFall.key) {
          crushTumble.current = {
            key: activeFall.key,
            state: createCrushTumble(
              cellHash(activeFall.col, activeFall.toRow, 83),
            ),
          };
        }
        const beforeY = crushTumble.current.state.y;
        pose = advanceCrushTumble(
          crushTumble.current.state,
          delta,
          minerPoseScratch.current,
        );
        if (Math.abs(crushTumble.current.state.y - beforeY) > 0.0004) {
          crushTumbleFrames.current += 1;
        }
      } else {
        if (!activeFall) crushTumble.current = null;
        // Falling reads from real downward motion: an ordinary drop opens
        // the fallAnim window, and a fatal free fall poses until it lands
        // (F-057). The landing squash fires on the fall-to-ground edge.
        const inFatalFall = activeFall?.kind === "fall" && !activeFall.impacted;
        const falling = (j.fallAnim > 0 || inFatalFall) && dy < -0.002;
        if (wasFallingRef.current && !falling && j.fallAnim > 0) {
          j.land = LAND_SQUASH_SECONDS;
          spawnDust(j, miner.position.x, miner.position.y);
        }
        wasFallingRef.current = falling;
        const fallSpeed = falling ? -dy / Math.max(delta, 1e-4) : 0;
        // The out-of-battery power-down slump rides its playback beat's
        // progress (F-058).
        const powerDown =
          activeFall?.kind === "powerdown" && activeFall.track
            ? motionProgress(activeFall.track, t)
            : 0;
        const inputs = rigInputs.current;
        inputs.t = t;
        inputs.delta = delta;
        inputs.facing = j.facing;
        // Vertical motion must not spin the walk stride during a fall.
        inputs.stepDistance = elevatorPassenger
          ? 0
          : falling
            ? Math.abs(dx)
            : Math.sqrt(dx * dx + dy * dy);
        inputs.leanVx = elevatorPassenger
          ? 0
          : visualTargetX - miner.position.x;
        inputs.swing = j.swing;
        inputs.bounce = j.bounce;
        inputs.lunge = j.lunge;
        inputs.crushed = false;
        inputs.fall = fallSpeed;
        inputs.land = j.land;
        inputs.powerDown = powerDown;
        inputs.still = false;
        pose = advanceMinerRig(
          minerRig.current,
          inputs,
          minerPoseScratch.current,
        );
      }
      body.position.x = pose.body.posX;
      body.position.y = pose.body.posY;
      body.rotation.y = pose.body.rotY;
      body.rotation.z = pose.body.rotZ;
      body.scale.set(pose.body.scaleX, pose.body.scaleY, pose.body.scaleZ);
      legL.rotation.x = pose.legL.rotX;
      legL.position.y = pose.legL.posY;
      legR.rotation.x = pose.legR.rotX;
      legR.position.y = pose.legR.posY;
      arm.rotation.z = pose.arm.rotZ;
    }
    // Rocket booster (F-056): the jump jets hold the miner one row up until
    // the next action (mine.jumpHover), so the flame and downward thrust
    // read the hover as powered lift, not a float.
    const booster = boosterRef.current;
    if (booster) {
      if (mine.jumpHover) {
        booster.visible = true;
        const flick = 0.8 + 0.35 * Math.abs(Math.sin(t * 40));
        booster.scale.set(
          0.9 + 0.14 * Math.sin(t * 33),
          flick,
          0.9 + 0.14 * Math.sin(t * 27),
        );
        j.boosterSpawn -= delta;
        if (j.boosterSpawn <= 0 && miner) {
          j.boosterSpawn = 0.045;
          spawnBoosterThrust(j, miner.position.x, miner.position.y);
        }
      } else {
        booster.visible = false;
        j.boosterSpawn = 0;
      }
    }
    // Lamp-lit dust drifts around the bot underground.
    const motes = motesRef.current;
    if (motes) {
      motes.visible = minerRow > 0;
      motes.rotation.z = t * 0.12;
      // G4: the dust drifts instead of only spinning, so the lamp-lit
      // air reads as air.
      motes.position.x = Math.sin(t * 0.21) * 0.4;
      motes.position.y = Math.sin(t * 0.35) * 0.3;
    }
    // Teetering blocks tremble every frame, harder and faster the closer
    // they are to dropping (the escalating tell). Rescued or dropped
    // blocks leave the targets map: their mesh snaps back to rest.
    let teeterMoved = false;
    // Map.forEach: entry-tuple iteration allocates a [key, value] array
    // per teetering block per frame; the callback form does not.
    wobbleRefs.current.forEach((mesh, wobbleKey) => {
      const target = wobbleTargets.current.get(wobbleKey);
      if (!target) {
        mesh.position.x = (mesh.userData.baseX as number) ?? mesh.position.x;
        wobbleRefs.current.delete(wobbleKey);
        return;
      }
      const prevX = mesh.position.x;
      mesh.position.x =
        target.x +
        Math.sin(t * (22 + 16 * target.urgency) + target.y) *
          (0.015 + 0.05 * target.urgency);
      if (Math.abs(mesh.position.x - prevX) > 0.0005) teeterMoved = true;
    });
    if (teeterMoved) teeterMotionFrames.current += 1;
    // Particles: integrate, gravity, expire; positions sync imperatively
    // (creation/removal re-renders on tick).
    const particles = j.particles;
    let alive = 0;
    for (const p of particles) {
      p.life -= delta;
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.vy -= p.gravity * delta;
      // Compact in place: survivors slide down over the expired, so the
      // array (and its backing store) is reused instead of refiltered.
      if (p.life > 0) particles[alive++] = p;
    }
    particles.length = alive;
    // Instanced particle write-out: one draw per kind, no React
    // reconciliation on spawn or expiry (W3).
    const instFor = particleInstFor.current;
    instFor.spark = sparkInstRef.current;
    instFor.debris = debrisInstRef.current;
    instFor.dust = dustInstRef.current;
    const counts = particleCounts.current;
    counts.spark = 0;
    counts.debris = 0;
    counts.dust = 0;
    const matrix = particleMatrix.current;
    const colorScratch = particleColor.current;
    for (const p of particles) {
      const inst = instFor[p.kind];
      if (!inst) continue;
      const index = counts[p.kind];
      if (index >= PARTICLE_CAPACITY[p.kind]) continue;
      counts[p.kind] = index + 1;
      const scale = p.size * Math.max(0.05, Math.min(1, p.life * 2.2));
      matrix.makeScale(scale, scale, scale);
      matrix.setPosition(p.x, p.y, 0.4);
      inst.setMatrixAt(index, matrix);
      inst.setColorAt(index, colorScratch.set(p.color));
    }
    for (const kind of PARTICLE_KINDS) {
      const inst = instFor[kind];
      if (!inst) continue;
      inst.count = counts[kind];
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }
  });

  // Stream the block-instance plan (filled by the render loop below) into
  // the grid after every render. Runs at input cadence, off the frame
  // path; the grid is created lazily over its group on first commit.
  useLayoutEffect(() => {
    const group = instancedGridGroupRef.current;
    if (!group) return;
    let grid = instancedGridRef.current;
    if (!grid) {
      // A new bucket's program compiles in the background against the live
      // scene; warm lists cannot cover it because each InstancedMesh gets
      // unique shader source (see PENDING_COMPILE_LAYER in the grid).
      grid = new InstancedBlockGrid(group, (mesh) =>
        gl.compileAsync?.(mesh, BUCKET_PRECOMPILE_CAMERA, scene),
      );
      instancedGridRef.current = grid;
    }
    grid.apply(blockPlan.current);
  });

  // Assign the accent pool to the emitters this render gathered (F-077).
  // Runs at input cadence like the grid stream above; parked slots hold
  // intensity 0 so the scene's light count never changes.
  useLayoutEffect(() => {
    const active = graphicsFeatures.accentLights ? accentEmitterCount() : 0;
    for (let i = 0; i < ACCENT_LIGHT_COUNT; i++) {
      const light = accentLightRefs.current[i];
      if (!light) continue;
      if (i < active) {
        const slot = ACCENT_SLOTS[i];
        light.position.set(slot.x, slot.y, slot.z);
        light.color.set(slot.color);
        light.intensity = slot.intensity;
        light.distance = slot.lightDistance;
        light.decay = slot.decay;
      } else if (light.intensity !== 0) {
        light.intensity = 0;
      }
    }
    // Active slot count exposed for the accent-light smoke.
    setDatasetNumber(
      datasetCache.current,
      gl.domElement.dataset,
      "accentLights",
      active,
      0,
    );
  });

  // Free the instance buffers when the canvas unmounts (the shared
  // geometry/material singletons are left alive).
  useLayoutEffect(() => {
    return () => {
      instancedGridRef.current?.dispose();
      instancedGridRef.current = null;
    };
  }, []);

  // Pre-compile every mine material once at load so first-use shader
  // compilation stops hitching a frame mid-play (the residual fall/crush/
  // descent stall real-device telemetry pinned to FrameRequestCallback,
  // present on desktop too, i.e. compilation, not GC). Best-effort: if the
  // renderer lacks compileAsync or it throws, materials just compile lazily
  // as before. Re-runs only if the detail tier flips (a quality change).
  // The canvas mounts at frameloop="never" and onWarmed flips it through
  // React state once this compile settles (or at the gate deadline), so
  // the phone's 3-12s session-start freeze becomes a backdrop beat with a
  // responsive page (F-081; the frameloop/clock traps live in
  // compile-gate.tsx). onWarmed is idempotent, so a detail flip re-warms
  // without re-gating.
  useEffect(() => {
    const warm = warmMineMaterials(gl, scene, camera, detail);
    const cancel = startFramesWhenSettled(warm.compiled, onWarmed);
    return () => {
      cancel();
      warm.dispose();
    };
  }, [gl, scene, camera, detail, onWarmed]);

  const stratumIndex = Math.min(
    STRATA.indexOf(stratumAt(minerRow)),
    STRATA_BG.length - 1,
  );
  const bg = STRATA_BG[stratumIndex];

  // The teeter tremble reads mesh handles from wobbleRefs (registered by
  // the stable teeterMeshRef mount callbacks baked into cached elements;
  // React 19 does not re-invoke a callback ref just because its closure
  // identity changed) and live urgency from wobbleTargets, which the
  // cell loop refreshes every render.
  wobbleTargets.current.clear();
  // Fresh block-instance plan for this tick; the loop below fills it for
  // every static solid cell, and a layout effect streams it to the grid.
  const plan = beginBlockPlan(blockPlan.current);
  // Accent emitters regather with the same pass (F-077).
  resetAccentEmitters();
  const blockMeshes = [];
  const tunnelMeshes = [];
  const cargoMeshes = [];
  const crackMeshes = [];
  const supportSelectionMeshes = [];
  let minDarknessOpacity = 1;
  let maxDarknessOpacity = 0;
  let renderedCellCount = 0;
  let renderedTeeterCount = 0;
  let renderedGasWispCount = 0;
  let renderedCrackSegmentCount = 0;
  const selectedSupportSet = new Set(selectedSupportKeys ?? []);
  const dynamitePreviewSet = new Set(
    (dynamitePreviewCells ?? []).map((coord) => `${coord.col}:${coord.row}`),
  );
  // F-075: rebuilding every visible cell's elements on every store tick
  // made React reconcile the whole grid per action (and per row during a
  // fall), the per-tick churn behind the fall hitches. Cells now build
  // through a signature-keyed cache; the loop below serves unchanged
  // cells the previous element references and React bails out on them.
  const cellCache = cellElementCache.current;
  if (cellCacheWorld.current !== mine) {
    cellCache.clear();
    cellCacheWorld.current = mine;
  }
  cellCacheGen.current += 1;
  const cacheGen = cellCacheGen.current;
  if (cellCache.size > CELL_CACHE_LIMIT) {
    // Sweep cells that left the window (not visited on the previous
    // render); the live window itself is never dumped, so no rebuild
    // spike lands when a long trip crosses the limit.
    cellCache.forEach((cached, cachedKey) => {
      if (cached.gen < cacheGen - 1) cellCache.delete(cachedKey);
    });
  }
  const supportToggle = onToggleSupport ? dispatchToggleSupport : null;
  const toggleBit = supportToggle ? 1 : 0;
  // biomeAt is column-pure; resolve each visible column once per pass
  // instead of once per cell (the loop below revisits every column per row).
  const columnBiomes: MineBiomeId[] = [];
  for (let col = firstCol; col <= lastCol; col++) {
    columnBiomes.push(biomeAt(col));
  }
  const supportSelected = (type: string, col: number, row: number) =>
    selectedSupportSet.has(`${type}:${col},${row}`);
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
      // Per-render bookkeeping that cache hits must still produce: the
      // wobble targets map was cleared above and carries the live
      // urgency to the frame loop.
      if (cell.fallIn !== undefined) {
        renderedTeeterCount += 1;
        wobbleTargets.current.set(key, {
          x,
          y,
          urgency: teeterUrgency(cell.fallIn),
        });
      }
      // Static solid body: record it in the instanced plan instead of a
      // React element. Runs on hit and miss alike (the plan is not cached),
      // so scrolling the window only rewrites instance matrices.
      if (instancedBlockDraw(cell)) {
        instancedBlockBody(
          cell,
          col,
          row,
          columnBiomes[col - firstCol],
          detail,
          instanceBodyScratch,
        );
        pushBlockInstance(
          plan,
          instanceBodyScratch.geometry,
          instanceBodyScratch.material,
          x,
          y,
          instanceBodyScratch.rotX,
          instanceBodyScratch.rotY,
          instanceBodyScratch.rotZ,
        );
      } else if (cell.kind === "empty" && row >= 1) {
        // Carved tunnel floor: the highest-count overlay in dug-out areas.
        // Instanced so a warp or a long fall rewrites matrices instead of
        // remounting a window's worth of floor meshes in one commit.
        pushBlockInstance(
          plan,
          TUNNEL_FLOOR_GEOMETRY,
          TUNNEL_FLOOR_MATERIALS[columnBiomes[col - firstCol]],
          x,
          y,
          0,
          0,
          0,
        );
      }
      // Signature inputs: everything the cell's JSX reads that can
      // change while the cell stays on screen.
      const dynamitePreview = dynamitePreviewSet.has(key);
      // Fog of war uses a radial distance so the lantern-lit area reads as
      // a circle (F-065), independent of the square lanternDistance the
      // render window culls by.
      const rdx = col - displayCol;
      const rdy = row - minerRow;
      const radialDistance = fallWindow
        ? distanceFromMiner
        : Math.sqrt(rdx * rdx + rdy * rdy);
      // Accent glow candidates (F-077): the beacon crystal and the bag's
      // brass clasp, at the offsets their models place those features.
      const emitterD2 = rdx * rdx + rdy * rdy;
      if (cell.beacon) {
        pushAccentEmitter(x, y + 0.22, 0.5, "#e08aff", 1.4, 4, 1.6, emitterD2);
      }
      if (cell.bag) {
        const bagOnBlock = cell.kind !== "empty";
        pushAccentEmitter(
          x,
          y + (bagOnBlock ? 0.18 : -0.28),
          bagOnBlock ? 0.92 : 0.28,
          "#f5c542",
          0.45,
          1.6,
          1.8,
          emitterD2,
        );
      }
      const beyondLight = Math.max(
        0,
        radialDistance - projectedVisibilityRadius,
      );
      const darknessOpacity = mineVisibilityOpacity(beyondLight, row, 1);
      // Diagnostics retain the exact cell opacity range while one continuous
      // shader veil handles the pixels without exposing cell borders.
      if (darknessOpacity > 0) {
        minDarknessOpacity = Math.min(minDarknessOpacity, darknessOpacity);
        maxDarknessOpacity = Math.max(maxDarknessOpacity, darknessOpacity);
      }
      const oreDamage =
        cell.kind === "ore" && cell.ore && cell.oreRemaining !== undefined
          ? 1 - cell.oreRemaining / oreReserveAt(cell.ore, row)
          : null;
      let damage = oreDamage;
      if (damage === null && cell.hp !== undefined && cell.kind !== "empty") {
        damage = 1 - cell.hp / hitsForCell(cell, mine.gear);
      }
      const canSalvage =
        collectMode && (cell.ladder || cell.plank || cell.beacon)
          ? isSupportSalvageTarget(mine, col, row)
          : false;
      // One red box per selected cell, whatever mix of supports stands in
      // it. The outline places itself from (col, row) rather than nesting
      // in a support group, so it lives outside the cell cache: toggling a
      // selection then costs one element instead of rebuilding the cell.
      if (
        canSalvage &&
        ((cell.ladder === true && supportSelected("ladder", col, row)) ||
          (cell.beacon === true && supportSelected("beacon", col, row)) ||
          (cell.plank === true && supportSelected("plank", col, row)))
      ) {
        supportSelectionMeshes.push(
          <SelectedSupportCellOutline
            key={`selected-cell:${key}`}
            col={col}
            row={row}
          />,
        );
      }
      const drop = cell.kind === "empty" ? dropPileStats(cell) : null;
      // Bookkeeping the old inline build produced as a side effect, now
      // computed from the same loop-local inputs on hit and miss alike.
      if (damage !== null) {
        renderedCrackSegmentCount += crackSegmentCountForDamage(damage);
      }
      if (cell.kind === "gas" && cell.gasSeeped) renderedGasWispCount += 1;
      // Sub-0.001 damage drift is invisible; quantizing it keeps repeated
      // chip hits from rebuilding a cell whose cracks did not change.
      const sig =
        `${cellRenderSignature(cell)}|` +
        `${drop ? drop.count : 0}:${drop?.ore ?? ""}|` +
        `${dynamitePreview ? 1 : 0}|` +
        `${damage === null ? "" : Math.round(damage * 1000)}|` +
        `${canSalvage ? 1 : 0}${toggleBit}${detail ? 1 : 0}`;
      let entry = cellCache.get(key);
      if (entry === undefined || entry.sig !== sig) {
        entry = buildCellEntry(sig, cacheGen, cell, col, row, {
          dynamitePreview,
          damage,
          canSalvage,
          drop,
          supportToggle,
          teeterMeshRef,
        });
        cellCache.set(key, entry);
      } else {
        entry.gen = cacheGen;
      }
      const { cargo, crack, tunnel, block, support } = entry;
      for (let i = 0; i < cargo.length; i++) cargoMeshes.push(cargo[i]);
      for (let i = 0; i < crack.length; i++) crackMeshes.push(crack[i]);
      for (let i = 0; i < tunnel.length; i++) tunnelMeshes.push(tunnel[i]);
      for (let i = 0; i < block.length; i++) blockMeshes.push(block[i]);
      for (let i = 0; i < support.length; i++) {
        supportSelectionMeshes.push(support[i]);
      }
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
    // The fuse glow rides the accent pool (F-077), matching the light the
    // charge model carried before the constant-light-count fix.
    const chargeDx = charge.col - displayCol;
    const chargeDy = charge.row - minerRow;
    pushAccentEmitter(
      cellX(charge.col) + 0.2,
      -charge.row + 0.2,
      1.08,
      FUSE_GLOW,
      1.2,
      3,
      1.7,
      chargeDx * chargeDx + chargeDy * chargeDy,
    );
  }
  // Active biome portals glow from the surface row (F-077); inactive
  // pylons stay dark, matching PortalBeaconModel's emissive gate.
  if (firstRow <= 0) {
    for (const portal of findPortalBeacons(mine)) {
      if (!portal.active || portal.col < firstCol || portal.col > lastCol) {
        continue;
      }
      const portalDx = portal.col - displayCol;
      pushAccentEmitter(
        cellX(portal.col),
        0.14,
        0.95,
        portal.color,
        1.5,
        4.5,
        1.7,
        portalDx * portalDx + minerRow * minerRow,
      );
    }
  }
  renderedCellCountRef.current = renderedCellCount;
  renderedCrackSegmentCountRef.current = renderedCrackSegmentCount;
  renderedTeeterCountRef.current = renderedTeeterCount;
  renderedGasWispCountRef.current = renderedGasWispCount;
  const hasDarknessOverlay = maxDarknessOpacity > 0;
  // G4: the deep strata press the fog in close; the surface breathes.
  const fogRange = fogRangeForStratum(stratumIndex, cameraZoom);

  return (
    <>
      <StratumAtmosphere color={bg} near={fogRange.near} far={fogRange.far} />
      <ambientLight ref={ambientRef} intensity={0.55} color="#cdd8f4" />
      <hemisphereLight ref={hemiRef} args={["#8fb4e8", "#2a2017", 0.5]} />
      <directionalLight
        ref={dirRef}
        position={[3, 6, 8]}
        intensity={1.1}
        castShadow={graphicsFeatures.shadows && webgpuBackend}
        shadow-mapSize={[
          graphicsFeatures.sunShadowMapSize,
          graphicsFeatures.sunShadowMapSize,
        ]}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={10}
        shadow-camera-bottom={-8}
        shadow-camera-near={0.5}
        shadow-camera-far={40}
        shadow-bias={-0.0004}
      />
      {/* Accent pool (F-077): three always-mounted point lights, assigned
          per render to the nearest beacon/bag/dynamite/portal emitters.
          Constant count by construction; see pushAccentEmitter. Tier
          gated: the low tier's frame budget cannot afford the extra
          lights (see GraphicsFeatures.accentLights), and the flag is
          fixed per session so the count never changes mid-play. */}
      {graphicsFeatures.accentLights
        ? ACCENT_LIGHT_INDICES.map((slot) => (
            <pointLight
              key={`accent:${slot}`}
              ref={(light) => {
                accentLightRefs.current[slot] = light;
              }}
              intensity={0}
              distance={1}
              decay={1.6}
            />
          ))
        : null}
      {/* Studio IBL: ambient response and reflections for every PBR
          surface; the frame loop scales it with daylight so descending
          into the dark still reads dark. */}
      <StudioEnvironment intensity={graphicsFeatures.environmentIntensity} />
      {/* G3 post stack: only where the real WebGPU backend pays for it. */}
      {graphicsFeatures.postBloom && webgpuBackend ? (
        <ScenePostProcessing />
      ) : null}
      <group ref={rigRef} />
      {/* Opaque backing ends at the ground line while its center follows a
          deep camera. This avoids both fog-colored cell gaps and a shader
          transparency dependency on the phone WebGL2 path. */}
      <mesh
        ref={caveBackdropRef}
        position={[0, CAVE_BACKDROP_SURFACE_CENTER, -5]}
      >
        <planeGeometry args={[CAVE_BACKDROP_WIDTH, CAVE_BACKDROP_HEIGHT]} />
        <primitive object={MINE_CAVE_BACKDROP} attach="material" />
      </mesh>
      {tunnelMeshes}
      {/* Imperative instanced block grid: the static solid bodies stream
          here as InstancedMeshes (identity transform, world-positioned
          instances), a sibling of the React decoration meshes below. */}
      <group ref={instancedGridGroupRef} />
      {blockMeshes}
      {crackMeshes}
      {cargoMeshes}
      {/* The elevator rail (REQ-028): guides and ties down the bored
          shaft, rendered for the visible span of the bought rail. */}
      {mine.gear.elevator > 0 &&
        (() => {
          const railColumn = elevatorColumn(mine.gear);
          if (railColumn === null) return null;
          const railTop = Math.max(0, firstRow);
          const railBottom = Math.min(mine.gear.elevator, lastRow);
          if (railBottom < railTop) return null;
          const mid = -(railTop + railBottom) / 2;
          const span = railBottom - railTop + 1;
          const ties: ReactElement[] = [];
          for (let r = railTop; r <= railBottom; r += 2) {
            ties.push(
              <mesh
                key={r}
                position={[railColumn, -r, -0.3]}
                geometry={ELEVATOR_TIE_GEOMETRY}
                material={ELEVATOR_TIE_MATERIAL}
                dispose={null}
              />,
            );
          }
          return (
            <group>
              {ELEVATOR_GUIDE_OFFSETS.map((offset) => (
                <mesh
                  key={offset}
                  position={[railColumn + offset, mid, -0.3]}
                  scale={[1, span, 1]}
                  geometry={ELEVATOR_GUIDE_GEOMETRY}
                  material={ELEVATOR_GUIDE_MATERIAL}
                  dispose={null}
                />
              ))}
              {ties}
            </group>
          );
        })()}
      {mine.gear.elevator > 0 && elevatorColumn(mine.gear) !== null && (
        <group ref={elevatorCarRef}>
          <mesh
            position={[0, -0.43, 0.03]}
            geometry={ELEVATOR_CAR_FLOOR_GEOMETRY}
            material={ELEVATOR_CAR_EDGE_MATERIAL}
            dispose={null}
          />
          <mesh
            position={[0, 0.02, -0.31]}
            geometry={ELEVATOR_CAR_BACK_GEOMETRY}
            material={ELEVATOR_CAR_MATERIAL}
            dispose={null}
          />
          <mesh
            position={[-0.4, 0.02, 0]}
            geometry={ELEVATOR_CAR_POST_GEOMETRY}
            material={ELEVATOR_CAR_EDGE_MATERIAL}
            dispose={null}
          />
          <mesh
            position={[0.4, 0.02, 0]}
            geometry={ELEVATOR_CAR_POST_GEOMETRY}
            material={ELEVATOR_CAR_EDGE_MATERIAL}
            dispose={null}
          />
          <mesh
            position={[0, 0.49, -0.06]}
            geometry={ELEVATOR_CAR_ROOF_GEOMETRY}
            material={ELEVATOR_CAR_EDGE_MATERIAL}
            dispose={null}
          />
          <mesh
            position={[0, 0.31, -0.26]}
            geometry={ELEVATOR_CAR_LAMP_GEOMETRY}
            material={ELEVATOR_CAR_LAMP_MATERIAL}
            dispose={null}
          />
          <group ref={elevatorGateRef} position={[0, 0.55, 0.34]}>
            <mesh
              position={[-0.24, 0, 0]}
              geometry={ELEVATOR_CAR_GATE_GEOMETRY}
              material={ELEVATOR_CAR_EDGE_MATERIAL}
              dispose={null}
            />
            <mesh
              geometry={ELEVATOR_CAR_GATE_GEOMETRY}
              material={ELEVATOR_CAR_EDGE_MATERIAL}
              dispose={null}
            />
            <mesh
              position={[0.24, 0, 0]}
              geometry={ELEVATOR_CAR_GATE_GEOMETRY}
              material={ELEVATOR_CAR_EDGE_MATERIAL}
              dispose={null}
            />
          </group>
        </group>
      )}
      {supportSelectionMeshes}
      <BunkerOverlay
        preview={bunkerPreview}
        blockedCells={bunkerBlockedCells}
        bunker={bunker}
      />
      {/* Instanced particles: sparks render fullbright, debris and dust
          take the scene light. Unit cube scaled per instance (W3). */}
      <instancedMesh
        ref={sparkInstRef}
        args={[undefined, undefined, PARTICLE_CAPACITY.spark]}
        count={0}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        ref={debrisInstRef}
        args={[undefined, undefined, PARTICLE_CAPACITY.debris]}
        count={0}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial flatShading roughness={0.7} />
      </instancedMesh>
      <instancedMesh
        ref={dustInstRef}
        args={[undefined, undefined, PARTICLE_CAPACITY.dust]}
        count={0}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial flatShading roughness={1} />
      </instancedMesh>
      <SurfaceSkin firstCol={firstCol} lastCol={lastCol} mine={mine} />
      <SurfaceDressing />
      <mesh
        ref={visibilityVeilRef}
        position={[displayCol, -minerRow, 4.5]}
        renderOrder={100}
        frustumCulled={false}
        material={MINE_VISIBILITY_VEIL}
        dispose={null}
      >
        <planeGeometry args={[90, 70]} />
      </mesh>
      {/* The miner bot. No position prop: useFrame owns the transform. */}
      <group ref={minerRef}>
        <MinerBot
          bodyRef={minerBodyRef}
          armRef={pickArmRef}
          lampRef={lampRef}
          motesRef={motesRef}
          legLRef={legLRef}
          legRRef={legRRef}
          boosterRef={boosterRef}
        />
      </group>
    </>
  );
}

interface MineCanvasProps {
  zoom: number;
  elevatorPresentation: ElevatorPresentation;
  collectMode?: boolean;
  selectedSupportKeys?: readonly string[];
  dynamitePreviewCells?: readonly MineCoord[];
  bunkerPreview?: BunkerFootprint | null;
  bunkerBlockedCells?: readonly MineCoord[];
  bunker?: BunkerState | null;
  onToggleSupport?: (target: CollectTarget) => void;
  onElevatorStageComplete?: (
    sequence: number,
    stage: ElevatorPresentationStage,
  ) => void;
  /** Fires once, after the first frame has actually rendered. */
  onFirstFrame?: () => void;
}

export default function MineCanvas(props: MineCanvasProps) {
  // Resolved once per mount: the tier only changes with the device or a
  // stored setting, and flipping renderer shadow support live is not
  // worth the misconfiguration risk.
  const features = graphicsFeaturesFor(
    resolveGraphicsQualityTier(readStoredGraphicsQuality(), hasCoarsePointer()),
  );
  // Frames start once the material warm pass has compiled (F-081): the
  // first rendered frame otherwise compiles the whole warm set in one
  // main-thread stall on phones. The prop must change through React
  // state (see compile-gate.tsx for the reconciliation and clock traps).
  const [frameloop, setFrameloop] = useState<"never" | "always">("never");
  const startFrames = useCallback(() => setFrameloop("always"), []);
  return (
    <Canvas
      camera={{ position: [0, 1.5, 13], fov: 42 }}
      dpr={[1, features.maxDpr]}
      frameloop={frameloop}
      gl={createWebGPU}
      shadows={features.shadows ? "soft" : false}
    >
      <FallbackDprCap />
      <MineScene
        {...props}
        graphicsFeatures={features}
        onWarmed={startFrames}
      />
      <CanvasDrawCallProbe onFirstFrame={props.onFirstFrame} />
      <PerfProbeBridge source="mine" />
    </Canvas>
  );
}
