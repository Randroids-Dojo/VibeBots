"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from "three/webgpu";
import { CanvasDrawCallProbe } from "@/components/canvas-draw-call-probe";
import { startFramesWhenSettled } from "@/components/compile-gate";
import { createWebGPU } from "@/components/part-visuals";
import { PerfProbeBridge } from "@/components/perf-probe-bridge";
import type { LiveRaidActiveView } from "@/lib/bunker-api-types";
import {
  BASE_PART_CATALOG,
  BASE_PART_IDS,
  type BasePartId,
  type BunkerSkinId,
  type BunkerState,
  DEFAULT_BUNKER_SKIN,
} from "@/sim/bunker";
import { bunkerCellBlock, bunkerCellGenCoords } from "@/sim/bunker-blocks";
import {
  LIVE_RAID_TICKS_PER_SECOND,
  type LiveRaidOutcomeReport,
} from "@/sim/bunker-raid-live";
import type { OreId } from "@/sim/mine/ores";
import { FpClankerLayer } from "./bunker-fp-clankers";
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
  fpCellBoxedIn,
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
  advanceFpRaid,
  collectFpRaidPickup,
  createFpRaidRuntime,
  type FpRaidRuntime,
  fpRaidEnded,
  fpRaidReport,
} from "./bunker-fp-raid";
import { resetFpRaidHud, setFpRaidHud } from "./bunker-fp-raid-hud";
import {
  createFpRayHit,
  FP_MAX_REACH,
  type FpRayHit,
  raycastFpGrid,
} from "./bunker-fp-raycast";
import {
  advanceFpSwing,
  createFpSwingState,
  type FpSwingState,
  fpSwingThrow,
  startFpSwing,
} from "./bunker-fp-swing";
import {
  resetFpBoxedIn,
  resetFpTarget,
  setFpBoxedIn,
  setFpTarget,
} from "./bunker-fp-target-state";
import { updateFpTutorial } from "./bunker-fp-tutorial";
import {
  BUNKER_TOOL_HIGHLIGHT,
  type BunkerToolAction,
} from "./bunker-tool-types";
import { setDatasetNumber, setDatasetText } from "./dataset-diagnostics";
import {
  graphicsFeaturesFor,
  hasCoarsePointer,
  isWebGPUBackend,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";
import {
  DIRT_BLOCK_GEOMETRY,
  ROCK_BLOCK_GEOMETRY,
} from "./mine-block-geometries";
import {
  blockDetailEnabled,
  dirtBlockMaterial,
  rockBlockMaterial,
} from "./mine-block-materials";
import { OreCrystals } from "./mine-block-render";
import {
  biomeDirtColorAt,
  cellHash,
  GLOWING_ORES,
  ORE_COLORS,
  rockColorsForBiome,
} from "./mine-render-palette";
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
/** A representative shallow-bunker dirt color for the warm pass so the
 * dirt program compiles before a fresh room's first paint. */
const FP_WARM_DIRT_HEX = biomeDirtColorAt(4, 5);
/** 190 boundary cells (the six face planes around the volume) plus up
 * to one interior undug cell per volume cell. Every cell, including the
 * depth-0 floor plane, starts as solid claim rock (F-115). */
const FP_ROCK_BOUNDARY_COUNT =
  2 * FP_ROWS * FP_DEPTH + 2 * FP_COLS * FP_DEPTH + 2 * FP_COLS * FP_ROWS;
const FP_ROCK_CAPACITY = FP_ROCK_BOUNDARY_COUNT + FP_COLS * FP_ROWS * FP_DEPTH;
/** The dirt/ore-base mesh only ever holds interior cells (the boundary
 * shell is all claim rock), so it caps at one per volume cell. */
const FP_DIRT_CAPACITY = FP_COLS * FP_ROWS * FP_DEPTH;
/** Interior diggable rock renders slightly brighter than the boundary
 * so "this one can open later" reads at a glance. */
const FP_ROCK_INTERIOR_LIFT = 1.08;
/** One loot glint per dug cell that still holds uncollected ore. */
const FP_LOOT_CAPACITY = FP_CELL_COUNT;

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
  /** The active tool: build places, pry refunds, dig excavates. */
  tool: BunkerToolAction;
  /** The part the build ghost previews (and a click places). */
  selectedPartId: BasePartId;
  onEdit: (intent: FpEditIntent) => void;
  onExit: () => void;
  onFirstFrame?: () => void;
  /** The live raid to fight in first person, or null when none is
   * active. Set by an in-bunker Start control; cleared once resolved. */
  liveRaid?: LiveRaidActiveView | null;
  /** Submit the fought raid's bounded outcome to settle it. */
  onResolveRaid?: (report: LiveRaidOutcomeReport) => void;
  /** Forfeit an unresolved raid when the player leaves first person
   * mid-fight, so it settles now and cannot be re-rolled by re-entering. */
  onForfeitRaid?: () => void;
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

/** Skip re-issuing a dig for the same cell within this window so a
 * banked round-trip still in flight cannot be struck twice before the
 * grid rebuild flips the cell out of the diggable set. */
const FP_DIG_REPEAT_GUARD = 0.55;

/**
 * First-person pickaxe view-model (F-114). Rigged to the camera so it
 * rides in view space and swung on every dig strike, so mining reads
 * like Minecraft: the pick chops forward, connects with the rock at
 * FP_SWING_IMPACT, then eases back. Geometry and materials are shared
 * module singletons (the warm pass compiles the program); the rig only
 * mutates the group transform, so steady-state frames never allocate.
 * Swing timing and the throw curve live in bunker-fp-swing.ts.
 *
 * Resting pose and swing throw are in the camera's view space (+x
 * right, +y up, -z forward). At rest the head is raised up-left; the
 * swing rotates it forward-down into the rock ahead.
 */
const FP_PICK_POS_X = 0.4;
const FP_PICK_POS_Y = -0.42;
const FP_PICK_POS_Z = -0.72;
const FP_PICK_REST_X = -0.55;
const FP_PICK_REST_Y = 0.6;
const FP_PICK_REST_Z = 0.28;
const FP_PICK_SWING_X = 1.5;
const FP_PICK_SWING_Z = -0.5;

// depthTest/Write off + a high render order draw the view-model over
// the world, so the pick never clips into a wall directly ahead.
const FP_PICK_HANDLE_MATERIAL = new MeshStandardMaterial({
  color: 0x6b4a2f,
  roughness: 0.85,
  metalness: 0.05,
  depthTest: false,
  depthWrite: false,
});
const FP_PICK_HEAD_MATERIAL = new MeshStandardMaterial({
  color: 0x9aa3ad,
  roughness: 0.35,
  metalness: 0.65,
  depthTest: false,
  depthWrite: false,
});
// Handle runs up +y from the grip (group origin); the head crossbar and
// two flared tips sit at its top so the silhouette reads as a pickaxe.
const FP_PICK_HANDLE_GEOMETRY = new BoxGeometry(0.05, 0.52, 0.05).translate(
  0,
  0.26,
  0,
);
const FP_PICK_HEAD_BAR_GEOMETRY = new BoxGeometry(0.34, 0.07, 0.08).translate(
  0,
  0.52,
  0,
);
const FP_PICK_HEAD_TIP_GEOMETRY = new BoxGeometry(0.07, 0.07, 0.09);

function createFpPickaxe(): Group {
  const group = new Group();
  const handle = new Mesh(FP_PICK_HANDLE_GEOMETRY, FP_PICK_HANDLE_MATERIAL);
  const bar = new Mesh(FP_PICK_HEAD_BAR_GEOMETRY, FP_PICK_HEAD_MATERIAL);
  const leftTip = new Mesh(FP_PICK_HEAD_TIP_GEOMETRY, FP_PICK_HEAD_MATERIAL);
  leftTip.position.set(-0.2, 0.47, 0.02);
  const rightTip = new Mesh(FP_PICK_HEAD_TIP_GEOMETRY, FP_PICK_HEAD_MATERIAL);
  rightTip.position.set(0.2, 0.47, 0.02);
  for (const mesh of [handle, bar, leftTip, rightTip]) {
    mesh.frustumCulled = false;
    mesh.renderOrder = 999;
    group.add(mesh);
  }
  return group;
}

// Scratch for the pickaxe world transform (per frame, no allocation).
const fpPickOffset = new Vector3();
const fpPickEuler = new Euler();
const fpPickQuat = new Quaternion();

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

/** A faceted rock body (the mine's dodecahedron): full per-cell rotation
 * so no two blocks repeat, scaled just past the cell so seams close. */
function writeRockBody(
  mesh: InstancedMesh,
  index: number,
  x: number,
  y: number,
  z: number,
): void {
  const salt = fpCellIndex(x + 1, y + 1, z + 1);
  rockEuler.set(
    cellHash(salt, 1, 13) * 3.1,
    cellHash(salt, 2, 17) * 3.1,
    cellHash(salt, 3, 19) * 3.1,
  );
  rockQuaternion.setFromEuler(rockEuler);
  // ROCK_BLOCK_GEOMETRY is a 0.62 dodecahedron; ~1.06 fills the cell and
  // pushes vertices past the boundary so adjacent rock closes its seams.
  rockScale.setScalar(1.06 + cellHash(salt, 4, 53) * 0.05);
  rockPosition.set(x, y, -z);
  rockMatrix.compose(rockPosition, rockQuaternion, rockScale);
  mesh.setMatrixAt(index, rockMatrix);
}

/** A soft dirt/ore-base body (the mine's rounded cube): tiny jitter only,
 * scaled to fill the cell. */
function writeDirtBody(
  mesh: InstancedMesh,
  index: number,
  x: number,
  y: number,
  z: number,
): void {
  const salt = fpCellIndex(x + 1, y + 1, z + 1);
  rockEuler.set(
    (cellHash(salt, 1, 11) - 0.5) * 0.08,
    (cellHash(salt, 2, 23) - 0.5) * 0.08,
    (cellHash(salt, 3, 37) - 0.5) * 0.08,
  );
  rockQuaternion.setFromEuler(rockEuler);
  // DIRT_BLOCK_GEOMETRY is a 0.94 rounded cube; the scale band keeps every
  // block at or past cell size so seams close.
  rockScale.setScalar(1.07 + cellHash(salt, 4, 53) * 0.05);
  rockPosition.set(x, y, -z);
  rockMatrix.compose(rockPosition, rockQuaternion, rockScale);
  mesh.setMatrixAt(index, rockMatrix);
}

/** Face neighbors paired with the rotation that turns OreCrystals' local
 * +Z cluster to point out that face. Grid z maps to world -z (worldZ =
 * -depth), so a shallower open neighbor (dz -1) faces world +Z (identity).
 * Ordered by how visible the face usually is from the dug-in side: the
 * pocket-facing shallow face first, then the side walls, then floor and
 * ceiling, then the deep back face last. */
const FP_ORE_FACES: readonly {
  d: readonly [number, number, number];
  rot: readonly [number, number, number];
}[] = [
  { d: [0, 0, -1], rot: [0, 0, 0] },
  { d: [1, 0, 0], rot: [0, Math.PI / 2, 0] },
  { d: [-1, 0, 0], rot: [0, -Math.PI / 2, 0] },
  { d: [0, 1, 0], rot: [-Math.PI / 2, 0, 0] },
  { d: [0, -1, 0], rot: [Math.PI / 2, 0, 0] },
  { d: [0, 0, 1], rot: [0, Math.PI, 0] },
];

/** The rotation that orients an undug ore cell's crystals out its first
 * open face, or null when the cell touches no open space (fully buried, so
 * no crystals render). Prefers the pocket-facing shallow face so a vein
 * exposed from a side, floor, ceiling, or back still points into the gap
 * instead of poking into solid rock. */
function fpExposedOreRotation(
  grid: FpSolidGrid,
  x: number,
  y: number,
  z: number,
): readonly [number, number, number] | null {
  for (const face of FP_ORE_FACES) {
    const nx = x + face.d[0];
    const ny = y + face.d[1];
    const nz = z + face.d[2];
    if (nx < 0 || nx >= FP_COLS || ny < 0 || ny >= FP_ROWS) continue;
    if (nz < 0 || nz >= FP_DEPTH) continue;
    if (grid[fpCellIndex(nx, ny, nz)] === FP_OPEN) return face.rot;
  }
  return null;
}

/** An exposed ore cell that gets crystal art overlaid on its open face. */
interface FpOreCell {
  key: number;
  x: number;
  y: number;
  z: number;
  hashCol: number;
  hashRow: number;
  ore: OreId;
  rot: readonly [number, number, number];
}

/** Cheap equality so the ore-crystal list only triggers a React update
 * when the exposed ore veins actually change (a dig, not every rebuild).
 * The open face (rot) is part of identity: digging a neighbor can turn a
 * cell's crystals to a new face without changing the exposed set. So are
 * the generator coords (hashCol/hashRow): the local key is footprint
 * independent, so a footprint change would otherwise keep a stale crystal
 * layout when key, ore, and rotation happen to match. */
function sameFpOreCells(a: FpOreCell[], b: FpOreCell[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].key !== b[i].key || a[i].ore !== b[i].ore) return false;
    if (a[i].hashCol !== b[i].hashCol || a[i].hashRow !== b[i].hashRow) {
      return false;
    }
    if (
      a[i].rot[0] !== b[i].rot[0] ||
      a[i].rot[1] !== b[i].rot[1] ||
      a[i].rot[2] !== b[i].rot[2]
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The claim rock, rendered like the mine at this depth (F-116): rock
 * cells use the faceted rock dodecahedron and rock material, dirt and ore
 * bases use the rounded dirt cube and the depth's dirt material, and
 * exposed ore veins get the mine's crystal cluster on their open face.
 * Two InstancedMeshes (rock + dirt) plus a handful of crystal groups; the
 * boundary shell writes once at mount, the interior rebuilds only when the
 * dug list changes. The geometry and material singletons stay alive; only
 * the per-mount meshes dispose on unmount (frame-loop-performance rule).
 */
function FpRockInstances({
  bunker,
  detail,
}: {
  bunker: BunkerState;
  detail: boolean;
}) {
  const groupRef = useRef<Group | null>(null);
  const rockMeshRef = useRef<InstancedMesh | null>(null);
  const dirtMeshRef = useRef<InstancedMesh | null>(null);
  const gridRef = useRef<FpSolidGrid | null>(null);
  if (!gridRef.current) gridRef.current = createFpSolidGrid();
  const [oreCells, setOreCells] = useState<FpOreCell[]>([]);
  const glDomElement = useThree((state) => state.gl.domElement);

  // The bunker spans five rows, so one depth-appropriate dirt color reads
  // as "the dirt you'd see at this depth" without a per-row material.
  const footprint = bunker.footprint;
  const dirtHex = useMemo(() => {
    const centerRow = footprint.row + Math.floor(FP_ROWS / 2);
    const centerCol = footprint.col + Math.floor(FP_COLS / 2);
    return biomeDirtColorAt(centerCol, centerRow);
  }, [footprint.row, footprint.col]);

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const rockMesh = new InstancedMesh(
      ROCK_BLOCK_GEOMETRY,
      rockBlockMaterial(FP_ROCK_TINT, detail),
      FP_ROCK_CAPACITY,
    );
    const dirtMesh = new InstancedMesh(
      DIRT_BLOCK_GEOMETRY,
      dirtBlockMaterial(dirtHex, detail),
      FP_DIRT_CAPACITY,
    );
    rockMesh.frustumCulled = false;
    dirtMesh.frustumCulled = false;
    // The six boundary face planes are all solid claim rock.
    let index = 0;
    for (let y = 0; y < FP_ROWS; y++) {
      for (let z = 0; z < FP_DEPTH; z++) {
        writeRockBody(rockMesh, index++, -1, y, z);
        writeRockBody(rockMesh, index++, FP_COLS, y, z);
      }
    }
    for (let x = 0; x < FP_COLS; x++) {
      for (let z = 0; z < FP_DEPTH; z++) {
        writeRockBody(rockMesh, index++, x, -1, z);
        writeRockBody(rockMesh, index++, x, FP_ROWS, z);
      }
    }
    for (let x = 0; x < FP_COLS; x++) {
      for (let y = 0; y < FP_ROWS; y++) {
        writeRockBody(rockMesh, index++, x, y, -1);
        writeRockBody(rockMesh, index++, x, y, FP_DEPTH);
      }
    }
    rockMesh.count = index;
    rockMesh.instanceMatrix.needsUpdate = true;
    dirtMesh.count = 0;
    group.add(rockMesh);
    group.add(dirtMesh);
    rockMeshRef.current = rockMesh;
    dirtMeshRef.current = dirtMesh;
    return () => {
      group.remove(rockMesh);
      group.remove(dirtMesh);
      rockMesh.dispose();
      dirtMesh.dispose();
      rockMeshRef.current = null;
      dirtMeshRef.current = null;
    };
  }, [detail, dirtHex]);

  // biome-ignore lint/correctness/useExhaustiveDependencies(detail): a detail flip recreates the meshes above, so the interior instances must rewrite onto the new meshes even though the body never reads detail.
  useLayoutEffect(() => {
    const rockMesh = rockMeshRef.current;
    const dirtMesh = dirtMeshRef.current;
    const grid = gridRef.current;
    if (!rockMesh || !dirtMesh || !grid) return;
    buildFpSolidGrid(bunker, grid);
    const blockSeed = bunker.blockSeed;
    // Depth 0 (the floor plane) is solid claim rock too now (F-115), so it
    // is part of the diggable interior rather than an open plane. Each
    // undug cell renders as its generated block kind at that depth (F-116).
    let rockIndex = FP_ROCK_BOUNDARY_COUNT;
    let dirtIndex = 0;
    const ores: FpOreCell[] = [];
    for (let z = 0; z < FP_DEPTH; z++) {
      for (let y = 0; y < FP_ROWS; y++) {
        for (let x = 0; x < FP_COLS; x++) {
          if (grid[fpCellIndex(x, y, z)] !== FP_ROCK_UNDUG) continue;
          const block =
            blockSeed === undefined
              ? null
              : bunkerCellBlock(blockSeed, bunker.footprint, x, y, z);
          if (block?.kind === "rock") {
            writeRockBody(rockMesh, rockIndex++, x, y, z);
            continue;
          }
          // Dirt and ore share the rounded dirt body (ore overlays crystals).
          writeDirtBody(dirtMesh, dirtIndex++, x, y, z);
          if (block?.kind === "ore" && block.ore) {
            const rot = fpExposedOreRotation(grid, x, y, z);
            if (rot) {
              const art = bunkerCellGenCoords(bunker.footprint, x, y, z);
              ores.push({
                key: fpCellIndex(x, y, z),
                x,
                y,
                z,
                hashCol: art.col,
                hashRow: art.row,
                ore: block.ore,
                rot,
              });
            }
          }
        }
      }
    }
    rockMesh.count = rockIndex;
    dirtMesh.count = dirtIndex;
    rockMesh.instanceMatrix.needsUpdate = true;
    dirtMesh.instanceMatrix.needsUpdate = true;
    setOreCells((prev) => (sameFpOreCells(prev, ores) ? prev : ores));
    // Probe the exposed-ore-vein count (rebuild cadence, not per-frame) so a
    // test can assert ore actually renders, not just that dirt and rock do.
    glDomElement.dataset.fpOreCells = String(ores.length);
  }, [bunker, detail, glDomElement]);

  return (
    <group ref={groupRef}>
      {oreCells.map((cell) => (
        <group
          key={cell.key}
          position={[cell.x, cell.y, -cell.z]}
          rotation={[cell.rot[0], cell.rot[1], cell.rot[2]]}
        >
          <OreCrystals
            col={cell.hashCol}
            row={cell.hashRow}
            color={ORE_COLORS[cell.ore]}
            glow={GLOWING_ORES.has(cell.ore)}
          />
        </group>
      ))}
    </group>
  );
}

// Shared singletons for the overflow-loot glints (never disposed).
const LOOT_GLINT_GEOMETRY = new OctahedronGeometry(0.17, 0);
const LOOT_GLINT_MATERIAL = new MeshStandardMaterial({
  color: "#ffd76a",
  emissive: new Color("#ffb020"),
  emissiveIntensity: 0.9,
  roughness: 0.3,
  metalness: 0.1,
});
const lootMatrix = new Matrix4();
const lootPosition = new Vector3();
const lootQuaternion = new Quaternion();
const lootScale = new Vector3(1, 1, 1);

/**
 * Glints marking uncollected overflow loot (F-116): a small emissive gem
 * hovering at each loot cell so the player can find and walk over it. One
 * InstancedMesh rebuilt only when the loot list changes; the octahedron
 * geometry and material are shared singletons (frame-loop rule).
 */
function FpLootGlints({ bunker }: { bunker: BunkerState }) {
  const groupRef = useRef<Group | null>(null);
  const meshRef = useRef<InstancedMesh | null>(null);

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const mesh = new InstancedMesh(
      LOOT_GLINT_GEOMETRY,
      LOOT_GLINT_MATERIAL,
      FP_LOOT_CAPACITY,
    );
    mesh.frustumCulled = false;
    mesh.count = 0;
    group.add(mesh);
    meshRef.current = mesh;
    return () => {
      group.remove(mesh);
      mesh.dispose();
      meshRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const loot = bunker.loot ?? [];
    const bottomRow = bunker.footprint.row + FP_ROWS - 1;
    let index = 0;
    for (const pile of loot) {
      const lx = pile.col - bunker.footprint.col;
      const ly = bottomRow - pile.row;
      if (!fpCellInGrid(lx, ly, pile.depth)) continue;
      lootPosition.set(lx, ly - 0.28, -pile.depth);
      lootQuaternion.setFromEuler(
        rockEuler.set(0.4, cellHash(lx + 1, ly + 1, pile.depth + 1) * 6.28, 0),
      );
      lootMatrix.compose(lootPosition, lootQuaternion, lootScale);
      mesh.setMatrixAt(index++, lootMatrix);
    }
    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
  }, [bunker]);

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
  detail,
  tier,
}: {
  bunker: BunkerState;
  detail: boolean;
  tier: SurfaceGeometryTier;
}) {
  const footprint = bunker.footprint;
  const bottomRow = footprint.row + footprint.height - 1;
  return (
    <group>
      {bunker.parts.map((part) => {
        const x = part.col - footprint.col;
        const y = bottomRow - part.row;
        const z = part.depth ?? 0;
        if (!fpCellInGrid(x, y, z)) return null;
        return (
          <group key={`fp-part:${x}:${y}:${z}`} position={[x, y, -z]}>
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

// Module-scope scratch for the camera orientation (frame loop).
const fpCameraEuler = new Euler(0, 0, 0, "YXZ");
// Reused scratch for the player's sim cell fed to the raid each frame.
const fpRaidPlayerCell = { col: 0, row: 0, depth: 0 };

function clampFpPitch(pitch: number): number {
  return Math.min(FP_PITCH_LIMIT, Math.max(-FP_PITCH_LIMIT, pitch));
}

/** Stable small codes per hit kind for the target-change signature. */
function fpKindCode(kind: FpRayHit["kind"]): number {
  switch (kind) {
    case "part":
      return 1;
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
  tool,
  onEdit,
  outlineRef,
  ghostRef,
  detail,
  liveRaid,
  onResolveRaid,
  raidRuntimeRef,
}: {
  bunker: BunkerState;
  entry: FpEntryCell;
  tool: BunkerToolAction;
  onEdit: (intent: FpEditIntent) => void;
  outlineRef: RefObject<LineSegments | null>;
  ghostRef: RefObject<Group | null>;
  detail: boolean;
  liveRaid: LiveRaidActiveView | null;
  onResolveRaid?: (report: LiveRaidOutcomeReport) => void;
  raidRuntimeRef: RefObject<FpRaidRuntime | null>;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
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
  // Boxed-in escape hint (the sealed-legacy-base case): recomputed on
  // grid rebuilds and occupied-cell changes only, four grid reads each
  // time, never every frame.
  const occupiedCellRef = useRef(-1);
  if (!solidRef.current || !prevSolidRef.current) {
    solidRef.current = createFpSolidGrid();
    prevSolidRef.current = createFpSolidGrid();
    builtForRef.current = bunker;
    buildFpSolidGrid(bunker, solidRef.current);
    prevSolidRef.current.set(solidRef.current);
    openCellsRef.current = countFpOpenCells(solidRef.current);
  }
  const refreshBoxedIn = useCallback(() => {
    const solid = solidRef.current;
    const cellIndex = occupiedCellRef.current;
    if (!solid || cellIndex < 0) {
      setFpBoxedIn(false);
      return;
    }
    setFpBoxedIn(
      fpCellBoxedIn(
        solid,
        cellIndex % FP_COLS,
        Math.floor(cellIndex / FP_COLS) % FP_ROWS,
        Math.floor(cellIndex / (FP_COLS * FP_ROWS)),
      ),
    );
  }, []);
  useLayoutEffect(() => {
    const solid = solidRef.current;
    const prev = prevSolidRef.current;
    if (builtForRef.current === bunker || !solid || !prev) return;
    builtForRef.current = bunker;
    prev.set(solid);
    buildFpSolidGrid(bunker, solid);
    gridRevisionRef.current += 1;
    openCellsRef.current = countFpOpenCells(solid);
    refreshBoxedIn();
    for (let i = 0; i < FP_CELL_COUNT; i++) {
      if (prev[i] !== FP_ROCK_UNDUG || solid[i] !== FP_OPEN) continue;
      const cell = burstCellRef.current;
      cell.x = i % FP_COLS;
      cell.y = Math.floor(i / FP_COLS) % FP_ROWS;
      cell.z = Math.floor(i / (FP_COLS * FP_ROWS));
      burstRemainingRef.current = FP_BURST_SECONDS;
    }
  }, [bunker, refreshBoxedIn]);

  // Live raid lifecycle: build the client runtime from the frozen start
  // snapshot when a raid begins (so the fight and the server's later
  // validation agree), and drop it plus the HUD when the raid clears.
  const raidResolvedRef = useRef(false);
  useEffect(() => {
    if (liveRaid) {
      raidRuntimeRef.current = createFpRaidRuntime(
        liveRaid.bunker,
        liveRaid.tier,
        liveRaid.raidId,
      );
      raidResolvedRef.current = false;
    } else {
      raidRuntimeRef.current = null;
      raidResolvedRef.current = false;
      resetFpRaidHud();
    }
    return () => {
      resetFpRaidHud();
    };
  }, [liveRaid, raidRuntimeRef]);

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
    // Feet start on the room floor (py -0.5 is cell y 0) regardless of
    // the miner's row; the frame loop keeps this in sync afterwards.
    occupiedCellRef.current = fpCellIndex(cell.x, 0, cell.z);
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
      // Losing the lock (Escape) must not leave the pick mining.
      if (document.pointerLockElement !== canvas) fpInput.actHeld = false;
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
      if (event.button === 0) {
        // Edge act guarantees a strike on the fastest click; actHeld
        // keeps the pick swinging while the button stays down.
        fpInput.act = true;
        fpInput.actHeld = true;
      } else if (event.button === 2) {
        fpInput.pryAct = true;
      }
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 0) fpInput.actHeld = false;
    };
    const onContextMenu = (event: Event) => {
      event.preventDefault();
    };
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("pointerlockchange", publishLock);
    return () => {
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("pointerlockchange", publishLock);
      fpInput.actHeld = false;
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
  }, [gl]);

  // The DOM target label and the boxed-in hint empty when the viewer
  // unmounts.
  useEffect(
    () => () => {
      resetFpTarget();
      resetFpBoxedIn();
    },
    [],
  );

  // The spawn cell can already be boxed in (a sealed legacy base):
  // publish once on mount; later refreshes ride grid and cell changes.
  useEffect(() => {
    refreshBoxedIn();
  }, [refreshBoxedIn]);

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

  // Pickaxe view-model: a scene child whose world transform the frame
  // loop derives from the camera (view-space offset + swing), so it
  // rides in front of the eye without depending on the camera being in
  // the scene graph. Shared geometry and materials (warmed by
  // warmBunkerFpMaterials) mean the mount only creates the meshes, and
  // nothing here allocates.
  const pickaxeRef = useRef<Group | null>(null);
  useLayoutEffect(() => {
    const pick = createFpPickaxe();
    pick.visible = false;
    scene.add(pick);
    pickaxeRef.current = pick;
    return () => {
      scene.remove(pick);
      pickaxeRef.current = null;
    };
  }, [scene]);

  // Dig swing state: a single active swing at a time, its strike landing
  // once at FP_SWING_IMPACT. The same-cell guard rate-limits repeated
  // digs while a banked round-trip is still settling.
  const swingRef = useRef<FpSwingState | null>(null);
  if (!swingRef.current) swingRef.current = createFpSwingState();
  const lastDigCellRef = useRef(-1);
  const lastDigAtRef = useRef(-1);
  const lastCollectCellRef = useRef(-1);

  useFrame((state, delta) => {
    const move = moveRef.current;
    const solid = solidRef.current;
    const rayHit = rayHitRef.current;
    const swing = swingRef.current;
    if (!move || !solid || !rayHit || !swing) return;
    const isDig = tool === "dig";

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

    // Occupied-cell tracking for the boxed-in hint: scalar compare per
    // frame, the four-neighbor check only when the cell changes.
    const feetX = Math.round(move.px);
    const feetY = Math.round(move.py);
    const feetZ = Math.round(-move.pz);
    const occupied = fpCellInGrid(feetX, feetY, feetZ)
      ? fpCellIndex(feetX, feetY, feetZ)
      : -1;
    if (occupied !== occupiedCellRef.current) {
      occupiedCellRef.current = occupied;
      refreshBoxedIn();
      // Walk-over loot pickup (F-116): entering a cell that holds overflow
      // loot emits one collect intent; the panel credits a banked bunker's
      // loot and the updated state drops the pile so it never re-fires.
      // Scalar compare against the loot list, no per-frame allocation.
      if (occupied !== lastCollectCellRef.current) {
        lastCollectCellRef.current = occupied;
        const loot = bunker.loot;
        if (occupied >= 0 && loot && loot.length > 0) {
          const bottomRow = bunker.footprint.row + FP_ROWS - 1;
          for (const pile of loot) {
            const lx = pile.col - bunker.footprint.col;
            const ly = bottomRow - pile.row;
            if (
              fpCellInGrid(lx, ly, pile.depth) &&
              fpCellIndex(lx, ly, pile.depth) === occupied
            ) {
              onEdit({
                kind: "collect",
                cell: { col: pile.col, row: pile.row, depth: pile.depth },
              });
              break;
            }
          }
        }
      }
    }

    // Live raid: step the sim against the player's current cell, collect
    // any walked-over XP, publish the HUD, and resolve once on the end.
    // While a raid runs the player only moves (edits stay frozen), so
    // any queued act input is dropped here before the tool block below.
    const raid = raidRuntimeRef.current;
    const raidActive = raid !== null;
    if (raid) {
      fpRaidPlayerCell.col = bunker.footprint.col + feetX;
      fpRaidPlayerCell.row =
        bunker.footprint.row + bunker.footprint.height - 1 - feetY;
      fpRaidPlayerCell.depth = feetZ;
      if (!fpRaidEnded(raid)) {
        advanceFpRaid(raid, fpRaidPlayerCell, Math.min(delta, FP_DT_CLAMP));
        collectFpRaidPickup(raid, fpRaidPlayerCell);
      }
      let aliveClankers = 0;
      const raidClankers = raid.state.clankers;
      for (let ci = 0; ci < raidClankers.length; ci += 1) {
        if (raidClankers[ci].alive) aliveClankers += 1;
      }
      const secondsLeft = Math.max(
        0,
        Math.ceil(
          (raid.state.durationTicks - raid.state.tick) /
            LIVE_RAID_TICKS_PER_SECOND,
        ),
      );
      setFpRaidHud(
        true,
        secondsLeft,
        aliveClankers,
        raid.state.clankers.length,
        raid.state.breached,
        raid.state.outcome,
      );
      if (fpRaidEnded(raid) && !raidResolvedRef.current) {
        raidResolvedRef.current = true;
        onResolveRaid?.(fpRaidReport(raid));
      }
      fpInput.act = false;
      fpInput.actHeld = false;
      fpInput.pryAct = false;
    }

    fpCameraEuler.set(pitchRef.current, yawRef.current, 0);
    camera.quaternion.setFromEuler(fpCameraEuler);
    camera.position.set(move.px, move.py + FP_EYE_HEIGHT, move.pz);

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
      outline.visible = outlineKind >= 0 && !raidActive;
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
      const ghostVisible = !raidActive && tool === "build" && placeOk;
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
    // allocation and only on an accepted act). Quick pry (right-click or
    // touch long-press) and a pry-tool tap both pry the crosshair part.
    // A build tap places. Digging instead drives the pickaxe swing
    // below: the strike lands mid-swing and holding keeps it swinging,
    // so dragging the aim across cells mines each one (F-114).
    const wantPry = fpInput.pryAct || (fpInput.act && tool === "pry");
    fpInput.pryAct = false;
    if (isDig) {
      // The swing owns digging; consume the press edge so it does not
      // also fall through to a build/pry act.
      if (fpInput.act || fpInput.actHeld) startFpSwing(swing);
      fpInput.act = false;
    } else if (fpInput.act) {
      fpInput.act = false;
      if (!wantPry && placeOk) {
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
    if (wantPry && targetPryable) {
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

    // Advance the active swing and land the dig at impact. The swing
    // auto-restarts while the input stays held in dig mode, so a held
    // press mines block after block at the swing cadence.
    if (advanceFpSwing(swing, delta, isDig && fpInput.actHeld)) {
      if (isDig && targetDiggable) {
        const digCell = fpCellIndex(rayHit.x, rayHit.y, rayHit.z);
        const nowSec = state.clock.elapsedTime;
        if (
          digCell !== lastDigCellRef.current ||
          nowSec - lastDigAtRef.current >= FP_DIG_REPEAT_GUARD
        ) {
          lastDigCellRef.current = digCell;
          lastDigAtRef.current = nowSec;
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
      }
    }

    // Pickaxe pose: shown only with the dig tool; a small idle bob at
    // rest, the swing arc overriding it mid-strike (peaks fully forward
    // exactly at FP_SWING_IMPACT, where the dig lands). The view-space
    // offset and swing rotation ride the camera basis into world space.
    const pickaxe = pickaxeRef.current;
    if (pickaxe) {
      pickaxe.visible = isDig && !raidActive;
      if (isDig && !raidActive) {
        const throwAmt = fpSwingThrow(swing);
        const bob = Math.sin(state.clock.elapsedTime * 2.1) * 0.006;
        fpPickOffset
          .set(FP_PICK_POS_X, FP_PICK_POS_Y + bob, FP_PICK_POS_Z)
          .applyQuaternion(camera.quaternion);
        pickaxe.position.copy(camera.position).add(fpPickOffset);
        fpPickEuler.set(
          FP_PICK_REST_X + throwAmt * FP_PICK_SWING_X,
          FP_PICK_REST_Y,
          FP_PICK_REST_Z + throwAmt * FP_PICK_SWING_Z,
        );
        fpPickQuat.setFromEuler(fpPickEuler);
        pickaxe.quaternion.copy(camera.quaternion).multiply(fpPickQuat);
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
    setDatasetText(cache, dataset, "fpSwinging", swing.active ? "1" : "0");

    // Tutorial observations (F-097): cheap scalars every frame; the
    // machine early-returns when idle or complete and notifies its
    // React card only when the visible step changes.
    updateFpTutorial(
      performance.now(),
      yawRef.current,
      pitchRef.current,
      move.px,
      move.pz,
      openCellsRef.current,
      bunker.parts.length,
    );
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
  // The interior dirt/ore-base blocks compile their own program here so a
  // fresh room paints without a first-frame material stall (F-116).
  group.add(
    new InstancedMesh(
      FP_WARMUP_GEOMETRY,
      dirtBlockMaterial(FP_WARM_DIRT_HEX, detail),
      1,
    ),
  );
  // Compile the pickaxe view-model's wood + metal programs here so the
  // first dig swing never stalls on a pipeline build.
  group.add(createFpPickaxe());
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
  onEdit,
  onWarmed,
  liveRaid,
  onResolveRaid,
}: {
  bunker: BunkerState;
  entry: FpEntryCell;
  tool: BunkerToolAction;
  selectedPartId: BasePartId;
  onEdit: (intent: FpEditIntent) => void;
  onWarmed: () => void;
  liveRaid: LiveRaidActiveView | null;
  onResolveRaid?: (report: LiveRaidOutcomeReport) => void;
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
  const outlineRef = useRef<LineSegments | null>(null);
  const ghostRef = useRef<Group | null>(null);
  // The live-raid runtime, shared: the rig steps it against the player
  // cell, the Clanker layer reads it to render. Null when no raid runs.
  const raidRuntimeRef = useRef<FpRaidRuntime | null>(null);

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
      <FpLootGlints bunker={bunker} />
      <FpPlacedParts bunker={bunker} detail={detail} tier={tier} />
      <FpClankerLayer
        runtimeRef={raidRuntimeRef}
        footprint={bunker.footprint}
      />
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
          durability={BASE_PART_CATALOG[selectedPartId].durability}
          partId={selectedPartId}
          skin={bunker.skin}
          tier={tier}
        />
      </group>
      <BunkerFpRig
        bunker={bunker}
        entry={entry}
        tool={tool}
        onEdit={onEdit}
        outlineRef={outlineRef}
        ghostRef={ghostRef}
        detail={detail}
        liveRaid={liveRaid}
        onResolveRaid={onResolveRaid}
        raidRuntimeRef={raidRuntimeRef}
      />
    </>
  );
}

export default function BunkerFpCanvas({
  bunker,
  entry,
  tool,
  selectedPartId,
  onEdit,
  onFirstFrame,
  liveRaid,
  onResolveRaid,
  onForfeitRaid,
}: BunkerFpCanvasProps) {
  const features = graphicsFeaturesFor(
    resolveGraphicsQualityTier(readStoredGraphicsQuality(), hasCoarsePointer()),
  );
  // Frames start once the warm pass has compiled (or at the gate
  // deadline); the prop must change through React state (see
  // compile-gate.tsx for the reconciliation trap).
  const [frameloop, setFrameloop] = useState<"never" | "always">("never");
  const startFrames = useCallback(() => setFrameloop("always"), []);

  // Forfeit an abandoned raid on the way out (F-160). Leaving first person
  // while a raid is still unresolved (the player did not fight it to a
  // natural win or loss) settles it as a forfeit now, so re-entering cannot
  // spin up a fresh runtime against the same row and re-roll the outcome.
  // This lives on the outer (plain DOM) canvas component, not inside the
  // R3F scene: its unmount cleanup is a normal React DOM teardown that runs
  // reliably when the fp view is torn down, and it keys off the `liveRaid`
  // prop (still the active raid at unmount, since exiting fp does not clear
  // the store) rather than the scene's runtime ref, so it fires even when
  // the player leaves before the scene's runtime effect has committed.
  const liveRaidRef = useRef<LiveRaidActiveView | null>(liveRaid ?? null);
  liveRaidRef.current = liveRaid ?? null;
  // The raid id the scene reported a natural win or loss for. Tracking the id
  // (rather than a boolean flag reset between raids) means a fresh raid is
  // unresolved by construction, so no prior raid's resolution can suppress
  // this one's forfeit.
  const resolvedRaidIdRef = useRef<string | null>(null);
  const handleResolveRaid = useCallback(
    (report: LiveRaidOutcomeReport) => {
      resolvedRaidIdRef.current = liveRaidRef.current?.raidId ?? null;
      onResolveRaid?.(report);
    },
    [onResolveRaid],
  );
  const onForfeitRaidRef = useRef(onForfeitRaid);
  onForfeitRaidRef.current = onForfeitRaid;
  useEffect(() => {
    return () => {
      const active = liveRaidRef.current;
      if (active && resolvedRaidIdRef.current !== active.raidId) {
        onForfeitRaidRef.current?.();
      }
    };
  }, []);

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
        onEdit={onEdit}
        onWarmed={startFrames}
        liveRaid={liveRaid ?? null}
        onResolveRaid={handleResolveRaid}
      />
      <CanvasDrawCallProbe onFirstFrame={onFirstFrame} />
      <PerfProbeBridge source="bunker-fp" />
    </Canvas>
  );
}
