"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Camera, LineSegments, Object3D } from "three/webgpu";
import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  Euler,
  Fog,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments as LineSegmentsImpl,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from "three/webgpu";
import { CanvasDrawCallProbe } from "@/components/canvas-draw-call-probe";
import { startFramesWhenSettled } from "@/components/compile-gate";
import { createWebGPU } from "@/components/part-visuals";
import { PerfProbeBridge } from "@/components/perf-probe-bridge";
import {
  BASE_PART_CATALOG,
  BASE_PART_IDS,
  type BasePartId,
  type BunkerSkinId,
  type BunkerState,
  DEFAULT_BUNKER_SKIN,
} from "@/sim/bunker";
import {
  buildFpSolidGrid,
  createFpSolidGrid,
  FP_CELL_COUNT,
  FP_COLS,
  FP_DEPTH,
  FP_OPEN,
  FP_ROCK_UNDUG,
  FP_ROWS,
  type FpEditIntent,
  type FpSolidGrid,
  fpCellIndex,
  fpCellInGrid,
  fpGridCellFromLocal,
  fpSpawnCell,
} from "./bunker-fp-grid";
import { fpInput } from "./bunker-fp-input";
import {
  FP_DT_CLAMP,
  FP_EYE_HEIGHT,
  type FpMoveInput,
  type FpMoveState,
  fpCellIntersectsCapsule,
  stepFpMovement,
} from "./bunker-fp-movement";
import { bunkerPartFpGeometry } from "./bunker-fp-part-geometry";
import {
  createFpRayHit,
  FP_MAX_REACH,
  type FpRayHit,
  raycastFpGrid,
} from "./bunker-fp-raycast";
import { resetFpTarget, setFpTarget } from "./bunker-fp-target-state";
import { setDatasetNumber, setDatasetText } from "./dataset-diagnostics";
import {
  graphicsFeaturesFor,
  hasCoarsePointer,
  isWebGPUBackend,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";
import { DIRT_BLOCK_GEOMETRY } from "./mine-block-geometries";
import { blockDetailEnabled, rockBlockMaterial } from "./mine-block-materials";
import {
  BUNKER_TOOL_HIGHLIGHT,
  type BunkerToolAction,
  type CarriedBunkerPart,
} from "./mine-bunker-toolbelt";
import { cellHash, rockColorsForBiome } from "./mine-render-palette";
import type {
  SurfaceGeometryLayer,
  SurfaceGeometryTier,
} from "./mine-surface-geometry";
import {
  BASE_PART_EMISSIVES,
  bunkerPartMaterial,
  collectBunkerPartMaterials,
} from "./mine-surface-materials";

/**
 * First-person walkable viewer and editor for the bunker interior
 * (7x5x5 cells). Slice 5 of the fp-building arc adds the crosshair
 * raycast, tri-color target outline, ghost preview, and edit intents:
 * the canvas asks mine-panel to place, pry, or dig (onEdit); the panel
 * owns the pending/banked store split, inventory guards, and feedback.
 *
 * Frame discipline: the rig's single useFrame allocates nothing
 * (module-scope scratch Euler, per-mount input scratch object and ray
 * hit record, dataset writes through dataset-diagnostics, signature
 * caches gating every string build and React-visible update). Rock
 * instances are written at mount/store cadence into one InstancedMesh
 * whose geometry and material are shared singletons.
 */

const FP_FOG_COLOR = "#0b0e14";
const FP_FOG_NEAR = 6;
const FP_FOG_FAR = 16;
const FP_TOUCH_LOOK = 0.0042;
const FP_MOUSE_LOOK = 0.0023;
const FP_PITCH_LIMIT = 1.45;
/** Fresh corridors put rock 0.7 units from the eye; starting the view
 * tipped slightly down grounds it on the floor line, so the first
 * frame reads "a place to dig into", not a wall filling the screen. */
const FP_SPAWN_PITCH = -0.15;
/** The overhead work light over the room center. */
const FP_WORK_LIGHT_COLOR = "#ffd9a0";
/** Entry fill at the corridor mouth: warm enough that hewn stone reads
 * as a lived-in interior instead of a cold shaft. */
const FP_ENTRY_FILL_COLOR = "#d8c2a4";
/** Deep claim rock tint (the default biome's softest rock gray). */
const FP_ROCK_TINT = rockColorsForBiome("default")[0];
/** 190 boundary cells (the six face planes around the volume) plus up
 * to 140 interior undug cells. */
const FP_ROCK_BOUNDARY_COUNT =
  2 * FP_ROWS * FP_DEPTH + 2 * FP_COLS * FP_DEPTH + 2 * FP_COLS * FP_ROWS;
const FP_ROCK_CAPACITY =
  FP_ROCK_BOUNDARY_COUNT + FP_COLS * FP_ROWS * (FP_DEPTH - 1);
/** Interior diggable rock renders slightly brighter than the boundary
 * so "this one can open later" reads at a glance. */
const FP_ROCK_INTERIOR_LIFT = 1.08;

declare global {
  interface Window {
    /** One-shot test camera aim, consumed by the rig next frame. */
    __vibebotsFp?: {
      setYaw?: number | null;
      setPitch?: number | null;
    };
  }
}

interface FpEntryCell {
  col: number;
  row: number;
}

export interface BunkerFpCanvasProps {
  bunker: BunkerState;
  entry: FpEntryCell;
  /** The active tool: build places, pry lifts, dig excavates. */
  tool: BunkerToolAction;
  /** The part the build ghost previews (and a click places). */
  selectedPartId: BasePartId;
  /** A pried part being carried; placing moves it instead. */
  carried: CarriedBunkerPart | null;
  onEdit: (intent: FpEditIntent) => void;
  onExit: () => void;
  onFirstFrame?: () => void;
}

/** Target outline colors by action (build, pry, dig): one shared
 * edges geometry, three singleton line materials, mutated per frame
 * by the rig (never recreated, so no pipeline churn). */
const FP_OUTLINE_GEOMETRY = (() => {
  const box = new BoxGeometry(1.02, 1.02, 1.02);
  const edges = new EdgesGeometry(box);
  box.dispose();
  return edges;
})();
const FP_OUTLINE_MATERIALS: readonly LineBasicMaterial[] = [
  new LineBasicMaterial({ color: BUNKER_TOOL_HIGHLIGHT.build }),
  new LineBasicMaterial({ color: BUNKER_TOOL_HIGHLIGHT.pry }),
  new LineBasicMaterial({ color: BUNKER_TOOL_HIGHLIGHT.dig }),
];
const FP_OUTLINE_BUILD = 0;
const FP_OUTLINE_PRY = 1;
const FP_OUTLINE_DIG = 2;

/** Dig crumble burst: 6 pooled shards, one active burst retargeted per
 * dig, driven from the rig's frame loop for FP_BURST_SECONDS. */
const FP_BURST_SECONDS = 0.4;
const FP_BURST_SHARDS = 6;
const FP_BURST_DIRS: readonly (readonly [number, number, number])[] =
  Object.freeze([
    Object.freeze([0.62, 0.55, 0.2] as const),
    Object.freeze([-0.58, 0.62, -0.18] as const),
    Object.freeze([0.24, 0.7, -0.52] as const),
    Object.freeze([-0.3, 0.45, 0.6] as const),
    Object.freeze([0.55, 0.2, -0.6] as const),
    Object.freeze([-0.5, 0.3, 0.5] as const),
  ]);

/** One Fog and one Color live for the canvas's life (the F-075
 * no-recompile invariant: swapping the objects rekeys the node cache
 * and recompiles every pipeline mid-frame). */
function FpAtmosphere() {
  const scene = useThree((state) => state.scene);
  const fogRef = useRef<Fog | null>(null);
  const backgroundRef = useRef<Color | null>(null);
  useLayoutEffect(() => {
    fogRef.current ??= new Fog(FP_FOG_COLOR, FP_FOG_NEAR, FP_FOG_FAR);
    backgroundRef.current ??= new Color(FP_FOG_COLOR);
    scene.fog = fogRef.current;
    scene.background = backgroundRef.current;
    return () => {
      scene.fog = null;
      scene.background = null;
    };
  }, [scene]);
  return null;
}

// Scratch for instance writes (mount/store cadence, never per frame).
const rockMatrix = new Matrix4();
const rockPosition = new Vector3();
const rockQuaternion = new Quaternion();
const rockScale = new Vector3();
const rockEuler = new Euler();
const rockColor = new Color();

function writeRockInstance(
  mesh: InstancedMesh,
  index: number,
  x: number,
  y: number,
  z: number,
  lift: number,
): void {
  // Deterministic tiny jitter hashed from the cell coordinates so the
  // hewn rock never shimmers across rebuilds.
  const salt = fpCellIndex(x + 1, y + 1, z + 1);
  rockEuler.set(
    (cellHash(salt, 1, 11) - 0.5) * 0.08,
    (cellHash(salt, 2, 23) - 0.5) * 0.08,
    (cellHash(salt, 3, 37) - 0.5) * 0.08,
  );
  rockQuaternion.setFromEuler(rockEuler);
  // DIRT_BLOCK_GEOMETRY is a 0.94 rounded cube; the scale band keeps
  // every block at or past cell size so seams close.
  rockScale.setScalar(1.07 + cellHash(salt, 4, 53) * 0.05);
  rockPosition.set(x, y, -z);
  rockMatrix.compose(rockPosition, rockQuaternion, rockScale);
  mesh.setMatrixAt(index, rockMatrix);
  mesh.setColorAt(index, rockColor.setScalar(lift));
}

/**
 * The claim rock: ONE InstancedMesh over shared singletons (dirt block
 * geometry + rock material). The 190 boundary cells surrounding the
 * volume are written once at mount; the interior undug instances are
 * rebuilt whenever the bunker (its dug list) changes. Only the
 * per-mount InstancedMesh is disposed on unmount; the geometry and
 * material singletons stay alive (frame-loop-performance rule).
 */
function FpRockInstances({
  bunker,
  detail,
}: {
  bunker: BunkerState;
  detail: boolean;
}) {
  const groupRef = useRef<Group | null>(null);
  const meshRef = useRef<InstancedMesh | null>(null);
  const gridRef = useRef<FpSolidGrid | null>(null);
  if (!gridRef.current) gridRef.current = createFpSolidGrid();

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const mesh = new InstancedMesh(
      DIRT_BLOCK_GEOMETRY,
      rockBlockMaterial(FP_ROCK_TINT, detail),
      FP_ROCK_CAPACITY,
    );
    mesh.frustumCulled = false;
    let index = 0;
    for (let y = 0; y < FP_ROWS; y++) {
      for (let z = 0; z < FP_DEPTH; z++) {
        writeRockInstance(mesh, index++, -1, y, z, 1);
        writeRockInstance(mesh, index++, FP_COLS, y, z, 1);
      }
    }
    for (let x = 0; x < FP_COLS; x++) {
      for (let z = 0; z < FP_DEPTH; z++) {
        writeRockInstance(mesh, index++, x, -1, z, 1);
        writeRockInstance(mesh, index++, x, FP_ROWS, z, 1);
      }
    }
    for (let x = 0; x < FP_COLS; x++) {
      for (let y = 0; y < FP_ROWS; y++) {
        writeRockInstance(mesh, index++, x, y, -1, 1);
        writeRockInstance(mesh, index++, x, y, FP_DEPTH, 1);
      }
    }
    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    meshRef.current = mesh;
    return () => {
      group.remove(mesh);
      mesh.dispose();
      meshRef.current = null;
    };
  }, [detail]);

  // biome-ignore lint/correctness/useExhaustiveDependencies(detail): a detail flip recreates the InstancedMesh above, so the interior instances must rewrite onto the new mesh even though the body never reads detail.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    const grid = gridRef.current;
    if (!mesh || !grid) return;
    buildFpSolidGrid(bunker, grid);
    let index = FP_ROCK_BOUNDARY_COUNT;
    for (let z = 1; z < FP_DEPTH; z++) {
      for (let y = 0; y < FP_ROWS; y++) {
        for (let x = 0; x < FP_COLS; x++) {
          if (grid[fpCellIndex(x, y, z)] !== FP_ROCK_UNDUG) continue;
          writeRockInstance(mesh, index++, x, y, z, FP_ROCK_INTERIOR_LIFT);
        }
      }
    }
    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [bunker, detail]);

  return <group ref={groupRef} />;
}

/** Damage never scales below this, so wilted parts stay visible. */
const FP_PART_MIN_WILT = 0.15;

function fpPartLayerMeshes(
  layers: readonly SurfaceGeometryLayer[],
  emissiveHex: string,
  detail: boolean,
  skin: BunkerSkinId,
) {
  return layers.map((layer, index) => (
    <mesh
      // biome-ignore lint/suspicious/noArrayIndexKey: cached layer lists are immutable per (part, tier).
      key={`${layer.role}:${index}`}
      geometry={layer.geometry}
      material={bunkerPartMaterial(layer.role, emissiveHex, detail, skin)}
      dispose={null}
    />
  ));
}

/** One placed part at its room cell: cached fp geometry layers over
 * the shared material singletons, durability wilt on motion layers
 * (the BasePartVisual pattern from the 2D overlay). */
function FpPartVisual({
  partId,
  durability,
  tier,
  detail,
  skin = DEFAULT_BUNKER_SKIN,
}: {
  partId: BasePartId;
  durability: number;
  tier: SurfaceGeometryTier;
  detail: boolean;
  skin?: BunkerSkinId;
}) {
  const model = bunkerPartFpGeometry(partId, tier);
  const emissiveHex = BASE_PART_EMISSIVES[partId];
  return (
    <group>
      {fpPartLayerMeshes(model.layers, emissiveHex, detail, skin)}
      {model.motionLayers.length > 0 && (
        <group
          position={model.motionAnchor}
          scale={[
            1,
            Math.max(
              FP_PART_MIN_WILT,
              Math.min(1, durability / BASE_PART_CATALOG[partId].durability),
            ),
            1,
          ]}
        >
          {fpPartLayerMeshes(model.motionLayers, emissiveHex, detail, skin)}
        </group>
      )}
    </group>
  );
}

function FpPlacedParts({
  bunker,
  carried,
  detail,
  tier,
}: {
  bunker: BunkerState;
  carried: CarriedBunkerPart | null;
  detail: boolean;
  tier: SurfaceGeometryTier;
}) {
  const footprint = bunker.footprint;
  const bottomRow = footprint.row + footprint.height - 1;
  // The pried part still occupies its cell until moved or stowed, but
  // renders hidden while carried (the 2D overlay's visible={!carried}).
  const carriedCol = carried?.source.col ?? -1;
  const carriedRow = carried?.source.row ?? -1;
  const carriedDepth = carried ? (carried.part.depth ?? 0) : -1;
  return (
    <group>
      {bunker.parts.map((part) => {
        const x = part.col - footprint.col;
        const y = bottomRow - part.row;
        const z = part.depth ?? 0;
        if (!fpCellInGrid(x, y, z)) return null;
        const isCarried =
          part.col === carriedCol &&
          part.row === carriedRow &&
          z === carriedDepth;
        return (
          <group
            key={`fp-part:${x}:${y}:${z}`}
            position={[x, y, -z]}
            visible={!isCarried}
          >
            <FpPartVisual
              detail={detail}
              durability={part.durability}
              partId={part.partId}
              skin={bunker.skin}
              tier={tier}
            />
          </group>
        );
      })}
    </group>
  );
}

/** The bunker core as a slowly spinning octahedron; the rig's frame
 * loop owns the spin so the scene adds no extra useFrame. */
function FpCore({
  bunker,
  coreRef,
}: {
  bunker: BunkerState;
  coreRef: RefObject<Mesh | null>;
}) {
  const footprint = bunker.footprint;
  const x = bunker.core.col - footprint.col;
  const y = footprint.row + footprint.height - 1 - bunker.core.row;
  const z = bunker.core.depth ?? 0;
  return (
    <mesh ref={coreRef} position={[x, y, -z]}>
      <octahedronGeometry args={[0.42, 0]} />
      <meshStandardMaterial
        color="#c084fc"
        emissive="#8b5cf6"
        emissiveIntensity={0.85}
        metalness={0.35}
        roughness={0.3}
        flatShading
      />
    </mesh>
  );
}

// Module-scope scratch for the camera orientation (frame loop).
const fpCameraEuler = new Euler(0, 0, 0, "YXZ");

function clampFpPitch(pitch: number): number {
  return Math.min(FP_PITCH_LIMIT, Math.max(-FP_PITCH_LIMIT, pitch));
}

/** Stable small codes per hit kind for the target-change signature. */
function fpKindCode(kind: FpRayHit["kind"]): number {
  switch (kind) {
    case "part":
      return 1;
    case "core":
      return 2;
    case "spikes":
      return 3;
    case "door":
      return 4;
    case "rock-diggable":
      return 5;
    default:
      return 6;
  }
}

function countFpOpenCells(solid: FpSolidGrid): number {
  let open = 0;
  for (let i = 0; i < FP_CELL_COUNT; i++) {
    if (solid[i] === FP_OPEN) open += 1;
  }
  return open;
}

/**
 * The walking rig: consumes look deltas and movement input, steps the
 * pure movement model against the solid grid, runs the crosshair
 * raycast, drives the target outline, ghost preview, and dig burst,
 * emits edit intents, and writes the camera pose plus the data-fp-*
 * diagnostics. One useFrame; steady-state frames allocate nothing.
 */
function BunkerFpRig({
  bunker,
  entry,
  coreRef,
  tool,
  onEdit,
  outlineRef,
  ghostRef,
  detail,
}: {
  bunker: BunkerState;
  entry: FpEntryCell;
  coreRef: RefObject<Mesh | null>;
  tool: BunkerToolAction;
  onEdit: (intent: FpEditIntent) => void;
  outlineRef: RefObject<LineSegments | null>;
  ghostRef: RefObject<Group | null>;
  detail: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const yawRef = useRef(0);
  const pitchRef = useRef(FP_SPAWN_PITCH);
  const datasetCacheRef = useRef<Record<string, number | string>>({});
  const inputScratchRef = useRef<FpMoveInput>({
    forward: 0,
    strafe: 0,
    jump: false,
    autoJump: false,
    yaw: 0,
  });

  // The solid grid rebuilds only when the bunker reference changes
  // (store mutations swap it). Rebuild in a layout effect so a
  // speculative or discarded render can never mutate the grid the
  // frame loop reads; the lazy init covers the first frame. The
  // previous grid sticks around so a rebuild can spot the one
  // rock-to-open transition a dig makes and aim the crumble burst.
  const solidRef = useRef<FpSolidGrid | null>(null);
  const prevSolidRef = useRef<FpSolidGrid | null>(null);
  const builtForRef = useRef<BunkerState | null>(null);
  const gridRevisionRef = useRef(0);
  const openCellsRef = useRef(0);
  const burstRemainingRef = useRef(0);
  const burstCellRef = useRef({ x: 0, y: 0, z: 0 });
  if (!solidRef.current || !prevSolidRef.current) {
    solidRef.current = createFpSolidGrid();
    prevSolidRef.current = createFpSolidGrid();
    builtForRef.current = bunker;
    buildFpSolidGrid(bunker, solidRef.current);
    prevSolidRef.current.set(solidRef.current);
    openCellsRef.current = countFpOpenCells(solidRef.current);
  }
  useLayoutEffect(() => {
    const solid = solidRef.current;
    const prev = prevSolidRef.current;
    if (builtForRef.current === bunker || !solid || !prev) return;
    builtForRef.current = bunker;
    prev.set(solid);
    buildFpSolidGrid(bunker, solid);
    gridRevisionRef.current += 1;
    openCellsRef.current = countFpOpenCells(solid);
    for (let i = 0; i < FP_CELL_COUNT; i++) {
      if (prev[i] !== FP_ROCK_UNDUG || solid[i] !== FP_OPEN) continue;
      const cell = burstCellRef.current;
      cell.x = i % FP_COLS;
      cell.y = Math.floor(i / FP_COLS) % FP_ROWS;
      cell.z = Math.floor(i / (FP_COLS * FP_ROWS));
      burstRemainingRef.current = FP_BURST_SECONDS;
    }
  }, [bunker]);

  // Spawn once per mount: the miner's mine cell on the tunnel plane,
  // feet on the room floor, facing -z (into the rock) with the view
  // tipped slightly down (FP_SPAWN_PITCH) so the floor grounds it.
  const moveRef = useRef<FpMoveState | null>(null);
  if (!moveRef.current) {
    const cell = fpSpawnCell(bunker.footprint, entry.col, entry.row);
    moveRef.current = {
      px: cell.x,
      py: -0.5,
      pz: -cell.z,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
    };
  }

  // Aim the camera before the first frame so the compile-gated first
  // paint already shows the room, not the R3F default pose.
  useLayoutEffect(() => {
    const move = moveRef.current;
    if (!move) return;
    fpCameraEuler.set(FP_SPAWN_PITCH, 0, 0);
    camera.quaternion.setFromEuler(fpCameraEuler);
    camera.position.set(move.px, move.py + FP_EYE_HEIGHT, move.pz);
  }, [camera]);

  // Pointer lock on canvas click (desktop only); mouse look while
  // locked. Touch look arrives through fpInput from the DOM HUD zones.
  // Mouse acts (left = tool, right = quick pry) only fire while the
  // lock is held, so the click that acquires it is swallowed. When the
  // environment cannot grant pointer lock at all (the request
  // rejects), acts fire unlocked instead of never. data-fp-lock
  // publishes which regime the canvas is in.
  const lockUnavailableRef = useRef(false);
  useEffect(() => {
    const canvas = gl.domElement;
    const coarse = window.matchMedia(
      "(hover: none) and (pointer: coarse)",
    ).matches;
    // Touch sessions auto-jump one-block steps instead of showing a
    // jump button (F-094); desktop keeps Space and no auto-jump.
    inputScratchRef.current.autoJump = coarse;
    const publishLock = () => {
      canvas.dataset.fpLock =
        document.pointerLockElement === canvas
          ? "locked"
          : lockUnavailableRef.current
            ? "unavailable"
            : "unlocked";
    };
    publishLock();
    const onClick = () => {
      if (coarse || document.pointerLockElement === canvas) return;
      const result = canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) {
        result.catch(() => {
          lockUnavailableRef.current = true;
          publishLock();
        });
      }
    };
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      yawRef.current -= event.movementX * FP_MOUSE_LOOK;
      pitchRef.current = clampFpPitch(
        pitchRef.current - event.movementY * FP_MOUSE_LOOK,
      );
    };
    const onMouseDown = (event: MouseEvent) => {
      if (coarse) return;
      const locked = document.pointerLockElement === canvas;
      if (!locked && !lockUnavailableRef.current) return;
      if (event.button === 0) fpInput.act = true;
      else if (event.button === 2) fpInput.pryAct = true;
    };
    const onContextMenu = (event: Event) => {
      event.preventDefault();
    };
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", publishLock);
    return () => {
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", publishLock);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
  }, [gl]);

  // The DOM target label empties when the viewer unmounts.
  useEffect(() => resetFpTarget, []);

  // Crosshair state: a per-mount ray hit record the frame loop reuses,
  // plus change signatures so probe strings, the target label, and
  // material swaps only happen when the target actually moved.
  const rayHitRef = useRef<FpRayHit | null>(null);
  if (!rayHitRef.current) rayHitRef.current = createFpRayHit();
  const targetSigRef = useRef(Number.NaN);
  const placeSigRef = useRef(Number.NaN);
  const outlineKindRef = useRef(-1);

  // Dig crumble burst: one pooled InstancedMesh over the shared dirt
  // block geometry and rock material (both compiled by the warm pass),
  // retargeted per dig. Only the per-mount mesh is disposed on
  // unmount; the geometry and material singletons stay alive.
  const burstGroupRef = useRef<Group | null>(null);
  const burstMeshRef = useRef<InstancedMesh | null>(null);
  useLayoutEffect(() => {
    const group = burstGroupRef.current;
    if (!group) return;
    const mesh = new InstancedMesh(
      DIRT_BLOCK_GEOMETRY,
      rockBlockMaterial(FP_ROCK_TINT, detail),
      FP_BURST_SHARDS,
    );
    mesh.frustumCulled = false;
    for (let i = 0; i < FP_BURST_SHARDS; i++) {
      mesh.setColorAt(i, rockColor.setScalar(FP_ROCK_INTERIOR_LIFT));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = 0;
    group.add(mesh);
    burstMeshRef.current = mesh;
    return () => {
      group.remove(mesh);
      mesh.dispose();
      burstMeshRef.current = null;
    };
  }, [detail]);

  useFrame((state, delta) => {
    const move = moveRef.current;
    const solid = solidRef.current;
    const rayHit = rayHitRef.current;
    if (!move || !solid || !rayHit) return;

    // Test-only one-shot camera aim (no-op in normal play).
    const hook = window.__vibebotsFp;
    if (hook) {
      if (typeof hook.setYaw === "number") {
        yawRef.current = hook.setYaw;
        hook.setYaw = null;
      }
      if (typeof hook.setPitch === "number") {
        pitchRef.current = clampFpPitch(hook.setPitch);
        hook.setPitch = null;
      }
    }

    // Touch look deltas accumulate between frames; consume and zero.
    yawRef.current -= fpInput.lookX * FP_TOUCH_LOOK;
    pitchRef.current = clampFpPitch(
      pitchRef.current - fpInput.lookY * FP_TOUCH_LOOK,
    );
    fpInput.lookX = 0;
    fpInput.lookY = 0;

    const input = inputScratchRef.current;
    input.forward = fpInput.forward;
    input.strafe = fpInput.strafe;
    input.jump = fpInput.jump;
    fpInput.jump = false;
    input.yaw = yawRef.current;
    stepFpMovement(move, input, solid, Math.min(delta, FP_DT_CLAMP));

    fpCameraEuler.set(pitchRef.current, yawRef.current, 0);
    camera.quaternion.setFromEuler(fpCameraEuler);
    camera.position.set(move.px, move.py + FP_EYE_HEIGHT, move.pz);

    const core = coreRef.current;
    if (core) {
      core.rotation.y = state.clock.elapsedTime * 0.7;
      core.rotation.x = Math.sin(state.clock.elapsedTime * 0.9) * 0.12;
    }

    // Crosshair raycast from the eye along the camera forward (scalar
    // yaw/pitch basis, no vector allocations).
    const eyeY = move.py + FP_EYE_HEIGHT;
    const cosPitch = Math.cos(pitchRef.current);
    raycastFpGrid(
      move.px,
      eyeY,
      move.pz,
      -Math.sin(yawRef.current) * cosPitch,
      Math.sin(pitchRef.current),
      -Math.cos(yawRef.current) * cosPitch,
      solid,
      FP_MAX_REACH,
      rayHit,
    );

    // Placement validity: the ray crossed an open cell that is still
    // open and would not entomb the player's capsule.
    const placeOk =
      rayHit.hit &&
      rayHit.placeX >= 0 &&
      solid[fpCellIndex(rayHit.placeX, rayHit.placeY, rayHit.placeZ)] ===
        FP_OPEN &&
      !fpCellIntersectsCapsule(
        rayHit.placeX,
        rayHit.placeY,
        rayHit.placeZ,
        move.px,
        move.py,
        move.pz,
      );
    const targetPryable =
      rayHit.hit &&
      (rayHit.kind === "part" ||
        rayHit.kind === "door" ||
        rayHit.kind === "spikes");
    const targetDiggable = rayHit.hit && rayHit.kind === "rock-diggable";

    // Tri-color target outline: visible when the current tool can act
    // on what the crosshair sees, tinted per action.
    const outline = outlineRef.current;
    if (outline) {
      let outlineKind = -1;
      if (tool === "pry") {
        if (targetPryable) outlineKind = FP_OUTLINE_PRY;
      } else if (tool === "dig") {
        if (targetDiggable) outlineKind = FP_OUTLINE_DIG;
      } else if (placeOk) {
        outlineKind = FP_OUTLINE_BUILD;
      }
      outline.visible = outlineKind >= 0;
      if (outlineKind >= 0) {
        outline.position.set(rayHit.x, rayHit.y, -rayHit.z);
        if (outlineKindRef.current !== outlineKind) {
          outlineKindRef.current = outlineKind;
          outline.material = FP_OUTLINE_MATERIALS[outlineKind];
        }
      }
    }

    // Ghost preview at the place cell (build mode only).
    const ghost = ghostRef.current;
    if (ghost) {
      const ghostVisible = tool === "build" && placeOk;
      ghost.visible = ghostVisible;
      if (ghostVisible) {
        ghost.position.set(rayHit.placeX, rayHit.placeY, -rayHit.placeZ);
      }
    }

    const cache = datasetCacheRef.current;
    const dataset = gl.domElement.dataset;

    // Target and place probes plus the DOM label, gated by change
    // signatures so strings only build when the target moved.
    const targetSig = rayHit.hit
      ? gridRevisionRef.current * 100_000 +
        ((rayHit.z + 1) * 100 + (rayHit.y + 1) * 10 + (rayHit.x + 1)) * 10 +
        fpKindCode(rayHit.kind)
      : gridRevisionRef.current * 100_000 - 1;
    if (targetSigRef.current !== targetSig) {
      targetSigRef.current = targetSig;
      if (!rayHit.hit) {
        setDatasetText(cache, dataset, "fpTarget", "none");
        setFpTarget("none", null, 0);
      } else {
        setDatasetText(
          cache,
          dataset,
          "fpTarget",
          `${rayHit.x}:${rayHit.y}:${rayHit.z}:${rayHit.kind}`,
        );
        if (targetPryable) {
          const footprint = bunker.footprint;
          const bottomRow = footprint.row + footprint.height - 1;
          let targetPart: BunkerState["parts"][number] | null = null;
          for (let i = 0; i < bunker.parts.length; i++) {
            const part = bunker.parts[i];
            if (
              part.col - footprint.col === rayHit.x &&
              bottomRow - part.row === rayHit.y &&
              (part.depth ?? 0) === rayHit.z
            ) {
              targetPart = part;
              break;
            }
          }
          setFpTarget(
            rayHit.kind,
            targetPart?.partId ?? null,
            targetPart?.durability ?? 0,
          );
        } else {
          setFpTarget(rayHit.kind, null, 0);
        }
      }
    }
    const placeSig = placeOk
      ? fpCellIndex(rayHit.placeX, rayHit.placeY, rayHit.placeZ)
      : -1;
    if (placeSigRef.current !== placeSig) {
      placeSigRef.current = placeSig;
      setDatasetText(
        cache,
        dataset,
        "fpPlace",
        placeSig >= 0
          ? `${rayHit.placeX}:${rayHit.placeY}:${rayHit.placeZ}`
          : "none",
      );
    }

    // Edit intents (input cadence; the intent object is the only
    // allocation and only on an accepted act).
    if (fpInput.act || fpInput.pryAct) {
      const quickPry = fpInput.pryAct;
      fpInput.act = false;
      fpInput.pryAct = false;
      const action = quickPry ? "pry" : tool;
      if (action === "pry") {
        if (targetPryable) {
          onEdit({
            kind: "pry",
            cell: fpGridCellFromLocal(
              bunker.footprint,
              rayHit.x,
              rayHit.y,
              rayHit.z,
            ),
          });
        }
      } else if (action === "dig") {
        if (targetDiggable) {
          onEdit({
            kind: "dig",
            cell: fpGridCellFromLocal(
              bunker.footprint,
              rayHit.x,
              rayHit.y,
              rayHit.z,
            ),
          });
        }
      } else if (placeOk) {
        onEdit({
          kind: "place",
          cell: fpGridCellFromLocal(
            bunker.footprint,
            rayHit.placeX,
            rayHit.placeY,
            rayHit.placeZ,
          ),
        });
      }
    }

    // Dig crumble burst: shards fly out of the dug cell and settle.
    const burstMesh = burstMeshRef.current;
    if (burstMesh) {
      if (burstRemainingRef.current > 0) {
        burstRemainingRef.current -= delta;
        const p = Math.min(1, 1 - burstRemainingRef.current / FP_BURST_SECONDS);
        const cell = burstCellRef.current;
        const reach = 0.12 + p * 0.55;
        const size = 0.16 * (1 - p * 0.85);
        for (let i = 0; i < FP_BURST_SHARDS; i++) {
          const dir = FP_BURST_DIRS[i];
          rockPosition.set(
            cell.x + dir[0] * reach,
            cell.y + dir[1] * reach - p * p * 0.5,
            -cell.z + dir[2] * reach,
          );
          rockEuler.set(p * 2 + i, p * 3, i * 0.7);
          rockQuaternion.setFromEuler(rockEuler);
          rockScale.setScalar(Math.max(0.01, size));
          rockMatrix.compose(rockPosition, rockQuaternion, rockScale);
          burstMesh.setMatrixAt(i, rockMatrix);
        }
        burstMesh.count = FP_BURST_SHARDS;
        burstMesh.instanceMatrix.needsUpdate = true;
      } else if (burstMesh.count !== 0) {
        burstMesh.count = 0;
      }
    }

    setDatasetNumber(cache, dataset, "fpEyeX", move.px, 2);
    setDatasetNumber(cache, dataset, "fpEyeY", eyeY, 2);
    setDatasetNumber(cache, dataset, "fpEyeZ", move.pz, 2);
    setDatasetNumber(cache, dataset, "fpYaw", yawRef.current, 2);
    setDatasetNumber(cache, dataset, "fpPitch", pitchRef.current, 2);
    setDatasetNumber(cache, dataset, "fpOpenCells", openCellsRef.current, 0);
    setDatasetText(cache, dataset, "fpGrounded", move.grounded ? "1" : "0");
  });

  return <group ref={burstGroupRef} />;
}

// Shared warm-up mesh geometry (compiles each program once at load).
const FP_WARMUP_GEOMETRY = new BoxGeometry(0.001, 0.001, 0.001);

/** Compile every material this scene can draw before frames start:
 * the bunker part set, and the rock material on an InstancedMesh WITH
 * instanceColor (a distinct program from the mine's plain instanced
 * warm). Touching the fp geometry cache here also moves the merge
 * cost off the enter transition. */
function warmBunkerFpMaterials(
  gl: { compileAsync?: (scene: Object3D, camera: Camera) => Promise<unknown> },
  scene: Object3D,
  camera: Camera,
  detail: boolean,
  tier: SurfaceGeometryTier,
): { dispose: () => void; compiled: Promise<unknown> | null } {
  const group = new Group();
  group.position.set(0, 0, -500);
  for (const material of collectBunkerPartMaterials(detail)) {
    group.add(new Mesh(FP_WARMUP_GEOMETRY, material));
  }
  // The crosshair outline's line pipeline (three materials, one
  // program family) compiles here instead of on first target.
  for (const material of FP_OUTLINE_MATERIALS) {
    group.add(new LineSegmentsImpl(FP_OUTLINE_GEOMETRY, material));
  }
  const rockWarm = new InstancedMesh(
    FP_WARMUP_GEOMETRY,
    rockBlockMaterial(FP_ROCK_TINT, detail),
    1,
  );
  rockWarm.setColorAt(0, rockColor.setScalar(1));
  group.add(rockWarm);
  for (const id of BASE_PART_IDS) bunkerPartFpGeometry(id, tier);
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

function BunkerFpScene({
  bunker,
  entry,
  tool,
  selectedPartId,
  carried,
  onEdit,
  onWarmed,
}: {
  bunker: BunkerState;
  entry: FpEntryCell;
  tool: BunkerToolAction;
  selectedPartId: BasePartId;
  carried: CarriedBunkerPart | null;
  onEdit: (intent: FpEditIntent) => void;
  onWarmed: () => void;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const detail = useThree((state) =>
    blockDetailEnabled(isWebGPUBackend(state.gl)),
  );
  // Resolved once per mount, like the mine canvas: the tier only
  // changes with the device or a stored setting.
  const tierRef = useRef<SurfaceGeometryTier | null>(null);
  if (!tierRef.current) {
    tierRef.current = resolveGraphicsQualityTier(
      readStoredGraphicsQuality(),
      hasCoarsePointer(),
    );
  }
  const tier = tierRef.current;
  const coreRef = useRef<Mesh | null>(null);
  const outlineRef = useRef<LineSegments | null>(null);
  const ghostRef = useRef<Group | null>(null);
  const ghostPartId = carried?.part.partId ?? selectedPartId;

  useEffect(() => {
    const warm = warmBunkerFpMaterials(gl, scene, camera, detail, tier);
    const cancel = startFramesWhenSettled(warm.compiled, onWarmed);
    return () => {
      cancel();
      warm.dispose();
    };
  }, [gl, scene, camera, detail, tier, onWarmed]);

  const centerX = (FP_COLS - 1) / 2;
  return (
    <>
      <FpAtmosphere />
      {/* Fixed light set (constant count, no recompiles): dim ambient,
          one warm work light over the room center, and a warm fill at
          the entry plane so the corridor mouth reads as a lived-in
          interior rather than cold rock. */}
      <ambientLight intensity={0.4} />
      <pointLight
        position={[centerX, 3.4, -2]}
        intensity={14}
        distance={12}
        color={FP_WORK_LIGHT_COLOR}
      />
      <pointLight
        position={[centerX, 2.4, 1.1]}
        intensity={4}
        distance={9}
        color={FP_ENTRY_FILL_COLOR}
      />
      <FpRockInstances bunker={bunker} detail={detail} />
      <FpPlacedParts
        bunker={bunker}
        carried={carried}
        detail={detail}
        tier={tier}
      />
      <FpCore bunker={bunker} coreRef={coreRef} />
      {/* Target outline and ghost preview: mounted once over shared
          singletons, positioned and shown imperatively by the rig. */}
      <lineSegments
        ref={outlineRef}
        geometry={FP_OUTLINE_GEOMETRY}
        material={FP_OUTLINE_MATERIALS[FP_OUTLINE_BUILD]}
        visible={false}
        dispose={null}
      />
      <group ref={ghostRef} visible={false} scale={0.92}>
        <FpPartVisual
          detail={detail}
          durability={BASE_PART_CATALOG[ghostPartId].durability}
          partId={ghostPartId}
          skin={bunker.skin}
          tier={tier}
        />
      </group>
      <BunkerFpRig
        bunker={bunker}
        entry={entry}
        coreRef={coreRef}
        tool={tool}
        onEdit={onEdit}
        outlineRef={outlineRef}
        ghostRef={ghostRef}
        detail={detail}
      />
    </>
  );
}

export default function BunkerFpCanvas({
  bunker,
  entry,
  tool,
  selectedPartId,
  carried,
  onEdit,
  onFirstFrame,
}: BunkerFpCanvasProps) {
  const features = graphicsFeaturesFor(
    resolveGraphicsQualityTier(readStoredGraphicsQuality(), hasCoarsePointer()),
  );
  // Frames start once the warm pass has compiled (or at the gate
  // deadline); the prop must change through React state (see
  // compile-gate.tsx for the reconciliation trap).
  const [frameloop, setFrameloop] = useState<"never" | "always">("never");
  const startFrames = useCallback(() => setFrameloop("always"), []);
  return (
    <Canvas
      camera={{ position: [3, 0.22, 0], fov: 75, near: 0.05, far: 30 }}
      dpr={[1, features.maxDpr]}
      frameloop={frameloop}
      gl={createWebGPU}
      shadows={false}
    >
      <BunkerFpScene
        bunker={bunker}
        entry={entry}
        tool={tool}
        selectedPartId={selectedPartId}
        carried={carried}
        onEdit={onEdit}
        onWarmed={startFrames}
      />
      <CanvasDrawCallProbe onFirstFrame={onFirstFrame} />
      <PerfProbeBridge source="bunker-fp" />
    </Canvas>
  );
}
