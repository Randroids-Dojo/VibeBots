"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useRef } from "react";
import type { Group, PointLight } from "three/webgpu";
import type { MineCell } from "@/sim/mine";
import { DEFAULT_GEAR, hitsFor, oreReserveAt } from "@/sim/mine";
import { useHolodeckStore } from "@/state/holodeck-store";
import {
  type GraphicsFeatures,
  graphicsFeaturesFor,
  hasCoarsePointer,
  isWebGPUBackend,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";
import { CrackMarks, MineBlockBody } from "./mine-block-render";
import { MinerBot } from "./mine-miner-render";
import { cellX } from "./mine-render-palette";
import {
  advanceCrushTumble,
  type CrushTumbleState,
  createCrushTumble,
  crushTumbleSettled,
} from "./miner-crush-tumble";
import {
  advanceMinerRig,
  createMinerRigState,
  minerClipId,
  minerClipInputs,
} from "./miner-rig";
import { createWebGPU } from "./part-visuals";
import { PerfProbeBridge } from "./perf-probe-bridge";
import { ScenePostProcessing } from "./scene-post";
import { StudioEnvironment } from "./studio-environment";

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
    <group
      position={[x, y, 0]}
      onUpdate={(group) => {
        // Stage blocks catch the bench shadows so the model grounds.
        group.traverse((child) => {
          child.receiveShadow = true;
          child.castShadow = true;
        });
      }}
    >
      <MineBlockBody cell={cell} col={col} row={row} />
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

function HolodeckScene({
  features,
  view,
}: {
  features: GraphicsFeatures;
  view: RefObject<HolodeckView>;
}) {
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
  const webgpuBackend = useThree((state) => isWebGPUBackend(state.gl));
  const rig = useRef(createMinerRigState());
  const crushTumble = useRef<CrushTumbleState | null>(null);
  const crushLoopHold = useRef(0);
  const turntableYaw = useRef(0);
  const lastDrawTotal = useRef(0);

  const miner = scene.state.miner;
  const showcase = scenarioId === "miner-showcase";
  const gallery = scenarioId === "block-gallery";
  const clip = minerClipId(settings.clip);
  const spinning = showcase && settings.turntable === "spin" && !paused;
  const targetSolid =
    scene.state.cells.get(`${scene.target.col},${scene.target.row}`)?.kind !==
    "empty";

  useFrame(({ camera, clock, gl }, delta) => {
    const t = clock.elapsedTime;
    const minerGroup = minerRef.current;
    if (minerGroup) {
      minerGroup.position.set(cellX(miner.col), -miner.row, 0.2);
      // Turntable: rotate the whole model for an all-around inspection.
      if (spinning) turntableYaw.current += delta * 0.7;
      minerGroup.rotation.y = showcase ? turntableYaw.current : 0;
    }
    // The showcase is an inspection bench: dolly in on the character.
    // The scene group sits at y + 4.5, so world y = 4.5 - minerRow.
    const focusX = cellX(miner.col);
    const focusY = 4.5 - miner.row + 0.1;
    // Narrow phone viewports need a longer dolly to keep the model framed.
    const aspect = gl.domElement.clientWidth / gl.domElement.clientHeight;
    const showcaseZ = aspect >= 1 ? 3.4 : 5.4;
    // The gallery frames the whole block row from a step further back.
    const camTarget = showcase
      ? { x: focusX, y: focusY + 0.35, z: showcaseZ }
      : gallery
        ? { x: 0, y: focusY + 0.4, z: aspect >= 1 ? 8.5 : 13 }
        : { x: 0, y: 0, z: 11 };
    // User gestures ride on top of the scenario framing: pan offsets
    // the target, zoom divides the dolly distance.
    const v = view.current;
    const targetX = camTarget.x + v.panX;
    const targetY = camTarget.y + v.panY;
    const targetZ = camTarget.z / v.zoom;
    const ease = Math.min(1, delta * 5);
    camera.position.x += (targetX - camera.position.x) * ease;
    camera.position.y += (targetY - camera.position.y) * ease;
    camera.position.z += (targetZ - camera.position.z) * ease;
    camera.lookAt(
      (showcase ? focusX : 0) + v.panX,
      (showcase || gallery ? focusY : 0) + v.panY,
      0,
    );
    v.camZ = camera.position.z;
    gl.domElement.dataset.holodeckZoom = v.zoom.toFixed(2);
    gl.domElement.dataset.holodeckPanX = v.panX.toFixed(2);
    gl.domElement.dataset.holodeckPanY = v.panY.toFixed(2);
    // The shared rig drives every joint: the single-block scenario plays
    // the real dig clip while its target block survives, the showcase
    // plays whichever clip is selected, and pause is a full still frame.
    const inputs = showcase
      ? minerClipInputs(clip, t, delta, paused)
      : minerClipInputs(targetSolid ? "dig" : "idle", t, delta, paused);
    let pose = advanceMinerRig(rig.current, inputs);
    // The crush clip plays the physically integrated tumble on a loop so
    // the death animation is reviewable on the art-QA bench like every
    // other clip. Pause holds whatever frame the tumble reached.
    if (showcase && clip === "crush") {
      if (!crushTumble.current) {
        crushTumble.current = createCrushTumble(0.37);
      }
      if (!paused) {
        pose = advanceCrushTumble(crushTumble.current, delta);
        if (crushTumbleSettled(crushTumble.current)) {
          crushLoopHold.current += delta;
          if (crushLoopHold.current > 1.2) {
            crushTumble.current = createCrushTumble(
              crushTumble.current.seed + 0.31,
            );
            crushLoopHold.current = 0;
          }
        }
      } else {
        pose = advanceCrushTumble(crushTumble.current, 0);
      }
    } else if (crushTumble.current) {
      crushTumble.current = null;
      crushLoopHold.current = 0;
    }
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
    }
    // Expose live motion for QA (Rule 10), independent of any one ref.
    const el = gl.domElement;
    el.dataset.holodeckArm = pose.arm.rotZ.toFixed(3);
    el.dataset.holodeckTargetSolid = targetSolid ? "1" : "0";
    el.dataset.holodeckLoops = String(loops);
    el.dataset.holodeckClip = showcase ? clip : "";
    el.dataset.holodeckYaw = (minerGroup?.rotation.y ?? 0).toFixed(3);
    el.dataset.holodeckCamZ = camera.position.z.toFixed(2);
    el.dataset.holodeckBodyY = pose.body.posY.toFixed(4);
    // Per-frame draw calls: the phone budget the model must respect. The
    // WebGPU backend's counter can accumulate, so expose the delta.
    const totalDraws = gl.info.render.calls;
    const frameDraws = totalDraws - lastDrawTotal.current;
    lastDrawTotal.current = totalDraws;
    el.dataset.holodeckDrawCalls = String(
      frameDraws > 0 ? frameDraws : totalDraws,
    );
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
      <directionalLight
        position={[3, 6, 8]}
        intensity={1.1}
        castShadow={features.shadows && webgpuBackend}
        shadow-mapSize={[features.sunShadowMapSize, features.sunShadowMapSize]}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={8}
        shadow-camera-bottom={-10}
        shadow-camera-near={0.5}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
      />
      <StudioEnvironment intensity={features.environmentIntensity} />
      {features.postBloom && webgpuBackend ? <ScenePostProcessing /> : null}
      {gallery ? (
        // The gallery is a review bench: a soft even fill across the
        // whole row so materials are judged fairly, not by lamp falloff.
        <pointLight
          position={[0, 4.5 - miner.row + 1.2, 4.5]}
          color="#f4ede2"
          intensity={2.2}
          distance={22}
          decay={1.1}
        />
      ) : null}
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

/** User camera offsets over the scenario framing: swipe pans, pinch or
 * wheel zooms, double-tap recenters. Mutated by the viewport's pointer
 * handlers and consumed by the scene's frame loop. */
interface HolodeckView {
  panX: number;
  panY: number;
  zoom: number;
  /** Live camera distance, written by the frame loop so pan speed can
   * match what a pixel covers at the current zoom. */
  camZ: number;
}

const HOLODECK_ZOOM_MIN = 0.45;
const HOLODECK_ZOOM_MAX = 3;
const HOLODECK_PAN_LIMIT_X = 10;
const HOLODECK_PAN_LIMIT_Y = 8;
/** World height covered by the viewport per camera unit (fov 42). */
const HOLODECK_FOV_FACTOR = 2 * Math.tan((42 * Math.PI) / 360);

export default function HolodeckCanvas() {
  const features = graphicsFeaturesFor(
    resolveGraphicsQualityTier(readStoredGraphicsQuality(), hasCoarsePointer()),
  );
  const scenarioId = useHolodeckStore((s) => s.scenarioId);
  const view = useRef<HolodeckView>({ panX: 0, panY: 0, zoom: 1, camZ: 11 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastTapAt = useRef(0);
  const pinchDist = useRef(0);

  // A new scenario gets a fresh framing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scenarioId is the reset trigger; the view ref is stable.
  useEffect(() => {
    view.current.panX = 0;
    view.current.panY = 0;
    view.current.zoom = 1;
  }, [scenarioId]);

  const resetView = () => {
    view.current.panX = 0;
    view.current.panY = 0;
    view.current.zoom = 1;
  };

  const clampView = () => {
    const v = view.current;
    v.zoom = Math.min(HOLODECK_ZOOM_MAX, Math.max(HOLODECK_ZOOM_MIN, v.zoom));
    v.panX = Math.min(
      HOLODECK_PAN_LIMIT_X,
      Math.max(-HOLODECK_PAN_LIMIT_X, v.panX),
    );
    v.panY = Math.min(
      HOLODECK_PAN_LIMIT_Y,
      Math.max(-HOLODECK_PAN_LIMIT_Y, v.panY),
    );
  };

  const pinchDistance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  return (
    <div
      data-testid="holodeck-viewport"
      style={{ width: "100%", height: "100%", touchAction: "none" }}
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Capture keeps drags alive outside the viewport but is not
          // required; synthetic pointers (tests, some stylus drivers)
          // reject it.
        }
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) pinchDist.current = pinchDistance();
        if (pointers.current.size === 1) {
          const now = performance.now();
          if (now - lastTapAt.current < 300) resetView();
          lastTapAt.current = now;
        }
      }}
      onPointerMove={(e) => {
        const prev = pointers.current.get(e.pointerId);
        if (!prev) return;
        const height = e.currentTarget.clientHeight || 1;
        const worldPerPixel =
          (view.current.camZ * HOLODECK_FOV_FACTOR) / height;
        if (pointers.current.size === 1) {
          view.current.panX -= (e.clientX - prev.x) * worldPerPixel;
          view.current.panY += (e.clientY - prev.y) * worldPerPixel;
        }
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) {
          const dist = pinchDistance();
          if (pinchDist.current > 0) {
            view.current.zoom *= dist / pinchDist.current;
          }
          pinchDist.current = dist;
        }
        clampView();
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        pinchDist.current = 0;
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        pinchDist.current = 0;
      }}
      onWheel={(e) => {
        view.current.zoom *= Math.exp(-e.deltaY * 0.0012);
        clampView();
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 11], fov: 42 }}
        dpr={[1, 2]}
        gl={createWebGPU}
        shadows={features.shadows ? "soft" : false}
      >
        <HolodeckScene features={features} view={view} />
        <PerfProbeBridge source="holodeck" />
      </Canvas>
    </div>
  );
}
