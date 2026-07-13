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
import type { Camera, Object3D } from "three/webgpu";
import {
  BoxGeometry,
  Color,
  Euler,
  Fog,
  Group,
  InstancedMesh,
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
  FP_COLS,
  FP_DEPTH,
  FP_ROCK_UNDUG,
  FP_ROWS,
  type FpSolidGrid,
  fpCellIndex,
  fpCellInGrid,
  fpSpawnCell,
} from "./bunker-fp-grid";
import { fpInput } from "./bunker-fp-input";
import {
  FP_DT_CLAMP,
  FP_EYE_HEIGHT,
  type FpMoveInput,
  type FpMoveState,
  stepFpMovement,
} from "./bunker-fp-movement";
import { bunkerPartFpGeometry } from "./bunker-fp-part-geometry";
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
 * First-person walkable viewer for the bunker interior (7x5x5 cells).
 * Slice 4 of the fp-building arc: walking, looking, and exiting only;
 * no editing, no raycast targeting, no store writes. The canvas swaps
 * in for MineCanvas while mine-panel's fpBunkerActive flag is set.
 *
 * Frame discipline: the rig's single useFrame allocates nothing
 * (module-scope scratch Euler, per-mount input scratch object, dataset
 * writes through dataset-diagnostics). Rock instances are written at
 * mount/store cadence into one InstancedMesh whose geometry and
 * material are shared singletons.
 */

const FP_FOG_COLOR = "#0b0e14";
const FP_FOG_NEAR = 6;
const FP_FOG_FAR = 16;
const FP_TOUCH_LOOK = 0.0042;
const FP_MOUSE_LOOK = 0.0023;
const FP_PITCH_LIMIT = 1.45;
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
  onExit: () => void;
  onFirstFrame?: () => void;
}

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

/**
 * The walking rig: consumes look deltas and movement input, steps the
 * pure movement model against the solid grid, and writes the camera
 * pose plus the data-fp-* diagnostics. Returns null; one useFrame.
 */
function BunkerFpRig({
  bunker,
  entry,
  coreRef,
}: {
  bunker: BunkerState;
  entry: FpEntryCell;
  coreRef: RefObject<Mesh | null>;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const datasetCacheRef = useRef<Record<string, number | string>>({});
  const inputScratchRef = useRef<FpMoveInput>({
    forward: 0,
    strafe: 0,
    jump: false,
    yaw: 0,
  });

  // The solid grid rebuilds only when the bunker reference changes
  // (store mutations swap it); the render-phase guard keeps the grid
  // in sync before the next frame without an effect-order hazard.
  const solidRef = useRef<FpSolidGrid | null>(null);
  if (!solidRef.current) solidRef.current = createFpSolidGrid();
  const builtForRef = useRef<BunkerState | null>(null);
  if (builtForRef.current !== bunker) {
    builtForRef.current = bunker;
    buildFpSolidGrid(bunker, solidRef.current);
  }

  // Spawn once per mount: the miner's mine cell on the tunnel plane,
  // feet on the room floor, facing -z (into the rock).
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
    fpCameraEuler.set(0, 0, 0);
    camera.quaternion.setFromEuler(fpCameraEuler);
    camera.position.set(move.px, move.py + FP_EYE_HEIGHT, move.pz);
  }, [camera]);

  // Pointer lock on canvas click (desktop only); mouse look while
  // locked. Touch look arrives through fpInput from the DOM HUD zones.
  useEffect(() => {
    const canvas = gl.domElement;
    const coarse = window.matchMedia(
      "(hover: none) and (pointer: coarse)",
    ).matches;
    const onClick = () => {
      if (coarse || document.pointerLockElement === canvas) return;
      const result = canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => {});
    };
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      yawRef.current -= event.movementX * FP_MOUSE_LOOK;
      pitchRef.current = clampFpPitch(
        pitchRef.current - event.movementY * FP_MOUSE_LOOK,
      );
    };
    canvas.addEventListener("click", onClick);
    document.addEventListener("mousemove", onMouseMove);
    return () => {
      canvas.removeEventListener("click", onClick);
      document.removeEventListener("mousemove", onMouseMove);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
  }, [gl]);

  useFrame((state, delta) => {
    const move = moveRef.current;
    const solid = solidRef.current;
    if (!move || !solid) return;

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

    const cache = datasetCacheRef.current;
    const dataset = gl.domElement.dataset;
    setDatasetNumber(cache, dataset, "fpEyeX", move.px, 2);
    setDatasetNumber(cache, dataset, "fpEyeY", move.py + FP_EYE_HEIGHT, 2);
    setDatasetNumber(cache, dataset, "fpEyeZ", move.pz, 2);
    setDatasetNumber(cache, dataset, "fpYaw", yawRef.current, 2);
    setDatasetNumber(cache, dataset, "fpPitch", pitchRef.current, 2);
    setDatasetText(cache, dataset, "fpGrounded", move.grounded ? "1" : "0");
  });

  return null;
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
  onWarmed,
}: {
  bunker: BunkerState;
  entry: FpEntryCell;
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
          one warm work light over the room center, and a cool fill at
          the entry plane so the corridor mouth stays readable. */}
      <ambientLight intensity={0.4} />
      <pointLight
        position={[centerX, 3.4, -2]}
        intensity={14}
        distance={12}
        color="#ffd9a0"
      />
      <pointLight
        position={[centerX, 2.4, 1.1]}
        intensity={4}
        distance={9}
        color="#9fb4d8"
      />
      <FpRockInstances bunker={bunker} detail={detail} />
      <FpPlacedParts bunker={bunker} detail={detail} tier={tier} />
      <FpCore bunker={bunker} coreRef={coreRef} />
      <BunkerFpRig bunker={bunker} entry={entry} coreRef={coreRef} />
    </>
  );
}

export default function BunkerFpCanvas({
  bunker,
  entry,
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
      <BunkerFpScene bunker={bunker} entry={entry} onWarmed={startFrames} />
      <CanvasDrawCallProbe onFirstFrame={onFirstFrame} />
      <PerfProbeBridge source="bunker-fp" />
    </Canvas>
  );
}
