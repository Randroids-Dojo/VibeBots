"use client";

import { OrbitControls } from "@react-three/drei";
import {
  Canvas,
  type ThreeEvent,
  useFrame,
  useThree,
} from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import {
  type Group,
  type MeshStandardMaterial,
  type PerspectiveCamera,
  Vector3,
} from "three";
import {
  CATEGORY_SURFACE,
  createWebGPU,
  partGeometry,
  shapeRotation,
} from "@/components/part-visuals";
import { type PartInstance, partMergeLevel } from "@/sim/design";
import { computeLayout, type Placement } from "@/sim/layout";
import {
  PART_CATALOG,
  type PartCategory,
  type PartDef,
  type Vec3,
} from "@/sim/parts";
import {
  type PlacementSlot,
  planMergeSelectedPart,
  useWorkshopStore,
  validSlotsFor,
} from "@/state/workshop-store";
import {
  graphicsFeaturesFor,
  hasCoarsePointer,
  isWebGPUBackend,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";
import { ScenePostProcessing } from "./scene-post";
import { StudioEnvironment } from "./studio-environment";
import {
  advance,
  decay,
  MOUNT_SECONDS,
  PULSE_SECONDS,
  snapScale,
} from "./workshop-animation";
import { clientToNdc, groundFloorY, pickNearestSlot } from "./workshop-drag";

const CATEGORY_COLORS: Record<PartCategory, string> = {
  core: "#ff9f43",
  structure: "#a3b1cc",
  mobility: "#54e0c7",
  weapon: "#ff6b6b",
};

// Stable pip keys (one per merge level) so the level markers never key on
// a bare array index. Length covers MAX_PART_MERGE_LEVEL.
const MERGE_PIP_IDS = ["i", "ii", "iii"] as const;

// A place to drop the held part while dragging (N2/N3): an empty connector
// slot to place a new part, or an existing same-kind part to merge into.
type DragTarget =
  | { kind: "place"; slot: PlacementSlot; placement: Placement }
  | { kind: "merge"; iid: string; placement: Placement };

/**
 * One placed part on the bench (W5 feel polish): it pops in when first
 * placed and gives a quick scale bump when it merges up a level, so an
 * edit lands with a snap instead of appearing instantly. The scale math
 * lives in workshop-animation so it stays unit-tested.
 */
function PlacedPart({
  instance,
  def,
  placement,
  selected,
  shadows,
  onActivate,
}: {
  instance: PartInstance;
  def: PartDef;
  placement: Placement;
  selected: boolean;
  shadows: boolean;
  onActivate: () => void;
}) {
  const scaleRef = useRef<Group>(null);
  const matRef = useRef<MeshStandardMaterial>(null);
  const mountT = useRef(0);
  const pulseT = useRef(0);
  const level = partMergeLevel(instance);
  const prevLevel = useRef(level);
  const surface = CATEGORY_SURFACE[def.category];
  useFrame((_, dt) => {
    if (level > prevLevel.current) pulseT.current = 1;
    prevLevel.current = level;
    mountT.current = advance(mountT.current, dt, MOUNT_SECONDS);
    pulseT.current = decay(pulseT.current, dt, PULSE_SECONDS);
    scaleRef.current?.scale.setScalar(
      snapScale(mountT.current, pulseT.current),
    );
    // Gold flash on level-up (Slice B), fading with the same pulse the pop
    // rides, so a merge lands as a clear "leveled up" beat over the base
    // selected / idle emissive.
    const flash = pulseT.current;
    const mat = matRef.current;
    if (mat) {
      if (flash > 0.001) {
        mat.emissive.set("#ffe08a");
        mat.emissiveIntensity = 0.5 + flash * 2.5;
      } else if (selected) {
        mat.emissive.set("#ffffff");
        mat.emissiveIntensity = 0.35;
      } else {
        mat.emissive.set(CATEGORY_COLORS[def.category]);
        mat.emissiveIntensity = surface.emissiveBoost;
      }
    }
  });
  const { position, rotation } = placement;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: R3F scene graph node, not a DOM element
    <group
      position={[position.x, position.y, position.z]}
      quaternion={[rotation.x, rotation.y, rotation.z, rotation.w]}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        // Camera drags that end on a part are not activations.
        if (event.delta > 2) return;
        event.stopPropagation();
        onActivate();
      }}
    >
      <group ref={scaleRef}>
        <mesh
          rotation={shapeRotation(def.shape)}
          castShadow={shadows}
          receiveShadow={shadows}
        >
          {partGeometry(def.shape)}
          <meshStandardMaterial
            ref={matRef}
            color={CATEGORY_COLORS[def.category]}
            metalness={surface.metalness}
            roughness={surface.roughness}
            flatShading
            emissive={CATEGORY_COLORS[def.category]}
            emissiveIntensity={surface.emissiveBoost}
          />
        </mesh>
      </group>
    </group>
  );
}

/**
 * The hero part (N1 direct-manipulation build): the part currently in the
 * build carousel, shown large on a slow turntable so the player sees a
 * real 3D part instead of a menu row. It rides in front of the camera
 * (matched to the camera transform each frame, then offset into the lower
 * view band) so it stays a stable "part in hand" no matter how the bench
 * orbits. The turntable yaw is published to the canvas dataset for motion
 * checks, mirroring the holodeck showcase.
 */
const HERO_DRAG_DEPTH = 2.6;
// How close (in NDC, so screen-fraction) the finger must be to a slot's
// projected point for it to snap. Generous so a drop over the bot lands.
const DRAG_SNAP_NDC = 0.5;
// A grab only becomes a drag once the pointer travels this far in NDC, so a
// tap on the hero part never places (it has to be dragged onto a slot).
const DRAG_START_NDC = 0.06;

function HeroPart({
  def,
  dragging,
  dimmed,
  pointerNdc,
  onGrab,
}: {
  def: PartDef;
  dragging: boolean;
  dimmed: boolean;
  pointerNdc: RefObject<{ x: number; y: number }>;
  onGrab: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const gl = useThree((state) => state.gl);
  const anchorRef = useRef<Group>(null);
  const spinRef = useRef<Group>(null);
  const yaw = useRef(0);
  useFrame((_, dt) => {
    const anchor = anchorRef.current;
    if (anchor) {
      anchor.position.copy(camera.position);
      anchor.quaternion.copy(camera.quaternion);
      if (dragging) {
        // Carried: ride under the finger at a fixed depth so the part
        // reads as held. Screen NDC maps to camera-space x/y through the
        // half-extents of the frustum at that depth.
        const halfV =
          Math.tan((camera.fov * Math.PI) / 180 / 2) * HERO_DRAG_DEPTH;
        const p = pointerNdc.current;
        anchor.translateX(p.x * halfV * camera.aspect);
        anchor.translateY(p.y * halfV);
        anchor.translateZ(-HERO_DRAG_DEPTH);
      } else {
        // Docked: down into the empty lower band and back so the whole
        // part clears the bottom edge on tall portrait viewports.
        anchor.translateY(-0.5);
        anchor.translateZ(-2.75);
      }
    }
    yaw.current += dt * 0.7;
    spinRef.current?.rotation.set(0, yaw.current, 0);
    const canvas = gl.domElement as HTMLCanvasElement;
    canvas.dataset.heroYaw = (yaw.current % (Math.PI * 2)).toFixed(2);
  });
  const surface = CATEGORY_SURFACE[def.category];
  // Owned-out (P3): render the part gray and non-glowing so it reads as
  // "you have none", and swallow the grab so an unavailable part cannot be
  // dragged onto the bot.
  const color = dimmed ? "#8b93a6" : CATEGORY_COLORS[def.category];
  return (
    <group
      ref={anchorRef}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        if (!dimmed) onGrab(event);
      }}
    >
      <group ref={spinRef} scale={dragging ? 0.72 : 0.65}>
        <mesh rotation={shapeRotation(def.shape)}>
          {partGeometry(def.shape)}
          <meshStandardMaterial
            color={color}
            metalness={surface.metalness}
            roughness={dimmed ? 0.95 : surface.roughness}
            flatShading
            transparent={dimmed}
            opacity={dimmed ? 0.72 : 1}
            emissive={color}
            emissiveIntensity={
              dimmed ? 0.12 : surface.emissiveBoost + (dragging ? 0.4 : 0.18)
            }
          />
        </mesh>
      </group>
    </group>
  );
}

/**
 * A drag highlight (N2): a translucent preview of the held part at one
 * valid slot while a grab-drag is in flight. The slot nearest the finger
 * is the snap target: it turns solid and bright so the drop point is
 * unmistakable; the rest stay faint so the whole set of attach points
 * still reads as "here is where this can go".
 */
function DragGhost({
  def,
  placement,
  active,
  merge = false,
}: {
  def: PartDef;
  placement: Placement;
  active: boolean;
  merge?: boolean;
}) {
  const groupRef = useRef<Group>(null);
  const matRef = useRef<MeshStandardMaterial>(null);
  // Snap-magnet feel (N4): the target under the finger breathes its scale
  // and emissive so it reads as "this is where it lands"; the rest hold
  // still and faint.
  useFrame((state) => {
    const wobble = Math.sin(state.clock.elapsedTime * 6);
    groupRef.current?.scale.setScalar(active ? 1 + wobble * 0.05 : 1);
    if (matRef.current) {
      matRef.current.emissiveIntensity = active ? 0.7 + wobble * 0.25 : 0.4;
    }
  });
  const { position, rotation } = placement;
  const surface = CATEGORY_SURFACE[def.category];
  // Merge targets read gold (matching the W4 merge language); place targets
  // read in the part's own colour and go white-hot when they are the snap.
  const color = merge ? "#ffe08a" : CATEGORY_COLORS[def.category];
  const emissive = merge
    ? active
      ? "#fff0b0"
      : "#ffe08a"
    : active
      ? "#ffffff"
      : CATEGORY_COLORS[def.category];
  return (
    <group
      ref={groupRef}
      position={[position.x, position.y, position.z]}
      quaternion={[rotation.x, rotation.y, rotation.z, rotation.w]}
    >
      <mesh rotation={shapeRotation(def.shape)}>
        {partGeometry(def.shape)}
        <meshStandardMaterial
          ref={matRef}
          color={color}
          metalness={surface.metalness}
          roughness={surface.roughness}
          flatShading
          transparent
          opacity={active ? 0.85 : merge ? 0.32 : 0.22}
          depthWrite={active}
          emissive={emissive}
          emissiveIntensity={active ? 0.7 : 0.4}
        />
      </mesh>
    </group>
  );
}

/**
 * An idle attach marker (P2, user feedback): a soft pulsing node parked at
 * a legal slot for the part you are currently viewing, so the bot's open
 * attach points read at a glance before any drag begins. The full-part
 * drag ghosts replace these the moment a grab starts.
 */
function IdleSlotMarker({
  position,
  color,
}: {
  position: Vec3;
  color: string;
}) {
  const groupRef = useRef<Group>(null);
  const matRef = useRef<MeshStandardMaterial>(null);
  useFrame((state) => {
    const pulse = Math.sin(state.clock.elapsedTime * 3);
    groupRef.current?.scale.setScalar(1 + pulse * 0.16);
    if (matRef.current) matRef.current.emissiveIntensity = 0.7 + pulse * 0.3;
  });
  return (
    <group ref={groupRef} position={[position.x, position.y, position.z]}>
      <mesh>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial
          ref={matRef}
          color={color}
          emissive={color}
          emissiveIntensity={0.7}
          transparent
          opacity={0.7}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/**
 * The build bench (workshop glow-up slice, user-reported): the bot under
 * construction gets the arena's material language (shared
 * CATEGORY_SURFACE), a studio light rig with cool and warm accents, the
 * G1 environment, and the G3 bloom stack, all behind the same
 * tier-plus-backend gates every other canvas uses. The fallback keeps
 * the current cost with a richer light rig only.
 */
function WorkshopScene() {
  const design = useWorkshopStore((s) => s.design);
  const selectedIid = useWorkshopStore((s) => s.selectedIid);
  const select = useWorkshopStore((s) => s.select);
  const placeAtSlot = useWorkshopStore((s) => s.placeAtSlot);
  const mergePart = useWorkshopStore((s) => s.mergePart);
  const setMergePreviewLevel = useWorkshopStore((s) => s.setMergePreviewLevel);
  const toggleBrowseStats = useWorkshopStore((s) => s.toggleBrowseStats);
  const browsePartId = useWorkshopStore((s) => s.browsePartId);
  const browseOrientation = useWorkshopStore((s) => s.browseOrientation);
  const buildActive = useWorkshopStore((s) => s.buildActive);
  const browseDimmed = useWorkshopStore((s) => s.browseDimmed);
  const layout = computeLayout(design);
  // Drop the grounding disc and grid below the design's lowest part so a
  // downward stack (frame plates hung off the core's bottom) never clips
  // through the floor. A single-core bot keeps the default height.
  const groundY = useMemo(
    () => groundFloorY(Array.from(layout.values(), (p) => p.position)),
    [layout],
  );
  // The hero part rides the Build tab: the one part in hand, dragged onto
  // the bot to place or merge (tap-to-place was removed as redundant).
  const heroDef = buildActive ? PART_CATALOG[browsePartId] : null;
  const webgpuBackend = useThree((state) => isWebGPUBackend(state.gl));
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const features = graphicsFeaturesFor(
    resolveGraphicsQualityTier(readStoredGraphicsQuality(), hasCoarsePointer()),
  );
  const shadows = features.shadows && webgpuBackend;

  // Grab-and-drag placement (N2) plus drag-to-merge (N3): pick up the hero
  // part and drop it on the bot. Every valid empty slot is a place target;
  // every placed same-kind part that can still level up is a gold merge
  // target (extends W4). The nearest to the finger is the snap target, and
  // releasing there either places a new part or merges into the twin.
  const browseDef = PART_CATALOG[browsePartId];
  // `grabbing`: pointer is down on the hero. `dragging`: it has moved far
  // enough to count as a drag (promoted from a grab). A grab that never
  // promotes is a tap and places nothing.
  const [grabbing, setGrabbing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pointerNdc = useRef({ x: 0, y: 0 });
  const grabStartNdc = useRef({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(-1);
  const hoveredRef = useRef(-1);
  const dragTargets = useMemo<DragTarget[]>(() => {
    if (!dragging) return [];
    const baseLayout = computeLayout(design);
    const targets: DragTarget[] = [];
    for (const slot of validSlotsFor(
      design,
      browseDef,
      PART_CATALOG,
      browseOrientation,
    )) {
      const placement = computeLayout(slot.next).get(slot.iid);
      if (placement) targets.push({ kind: "place", slot, placement });
    }
    for (const part of design.parts) {
      if (part.partId !== browsePartId) continue;
      if (planMergeSelectedPart(design, part.iid) === null) continue;
      const placement = baseLayout.get(part.iid);
      if (placement) targets.push({ kind: "merge", iid: part.iid, placement });
    }
    return targets;
  }, [dragging, design, browseDef, browsePartId, browseOrientation]);
  const dragTargetsRef = useRef(dragTargets);
  dragTargetsRef.current = dragTargets;
  // Synchronous drag flag: the hover frame checks this rather than the
  // async `dragging` state, so the drop (which merges and clears the merge
  // banner) is not undone by one more frame running the stale closure.
  const draggingRef = useRef(false);

  // Idle attach markers (P2, user feedback): the moment you are viewing a
  // part in the carousel, show a soft node at every legal slot so the open
  // attach points read before any drag. Hidden once a drag or tap-to-place
  // takes over (their own ghosts show then), and while the part is
  // owned-out (you cannot place it).
  const idleSlots = useMemo(() => {
    if (!buildActive || dragging || browseDimmed || !browseDef) {
      return [] as { key: string; placement: Placement }[];
    }
    const slots: { key: string; placement: Placement }[] = [];
    for (const slot of validSlotsFor(
      design,
      browseDef,
      PART_CATALOG,
      browseOrientation,
    )) {
      const placement = computeLayout(slot.next).get(slot.iid);
      if (placement) {
        slots.push({
          key: `${slot.parentIid}:${slot.parentConnector}`,
          placement,
        });
      }
    }
    return slots;
  }, [
    buildActive,
    dragging,
    browseDimmed,
    browseDef,
    design,
    browseOrientation,
  ]);

  const startGrab = (event: ThreeEvent<PointerEvent>) => {
    if (!buildActive || browseDimmed) return;
    const ndc = { x: event.pointer.x, y: event.pointer.y };
    grabStartNdc.current = ndc;
    pointerNdc.current = ndc;
    hoveredRef.current = -1;
    setHovered(-1);
    draggingRef.current = false;
    setGrabbing(true);
    (gl.domElement as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  useEffect(() => {
    if (!grabbing) return;
    const el = gl.domElement as HTMLElement;
    const move = (event: PointerEvent) => {
      pointerNdc.current = clientToNdc(
        event.clientX,
        event.clientY,
        el.getBoundingClientRect(),
      );
      // Promote a grab to a real drag once it travels past the tap
      // threshold; only then does the hero ride the finger and slots light.
      if (!draggingRef.current) {
        const dx = pointerNdc.current.x - grabStartNdc.current.x;
        const dy = pointerNdc.current.y - grabStartNdc.current.y;
        if (dx * dx + dy * dy > DRAG_START_NDC * DRAG_START_NDC) {
          draggingRef.current = true;
          setDragging(true);
        }
      }
    };
    const drop = () => {
      // Stop the hover frame first (synchronously) so it cannot re-derive
      // the merge banner from the post-merge design before React re-renders.
      const wasDragging = draggingRef.current;
      draggingRef.current = false;
      // A grab that never became a drag is a tap: place nothing.
      if (wasDragging) {
        // Recompute the snap target from the live pointer at release, so the
        // commit never depends on whether a frame ran for the final move
        // (fast drags can outrun useFrame).
        const projected = dragTargetsRef.current.map((target) => {
          const p = target.placement.position;
          const v = new Vector3(p.x, p.y, p.z).project(camera);
          return { x: v.x, y: v.y, z: v.z };
        });
        const index = pickNearestSlot(
          projected,
          pointerNdc.current,
          DRAG_SNAP_NDC,
        );
        const target = dragTargetsRef.current[index];
        if (index >= 0 && target) {
          if (target.kind === "place") placeAtSlot(target.slot);
          else mergePart(target.iid);
        }
      } else {
        // A tap on the hero part reveals (or hides) its stats in the bottom
        // inspector instead of placing anything (G).
        toggleBrowseStats();
      }
      setGrabbing(false);
      setDragging(false);
      setHovered(-1);
      hoveredRef.current = -1;
      setMergePreviewLevel(null);
    };
    el.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    return () => {
      el.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
    };
  }, [
    grabbing,
    gl,
    placeAtSlot,
    mergePart,
    camera,
    setMergePreviewLevel,
    toggleBrowseStats,
  ]);

  const projScratch = useRef(new Vector3());
  useFrame(() => {
    if (!draggingRef.current) return;
    const projected = dragTargets.map((target) => {
      const p = target.placement.position;
      const v = projScratch.current.set(p.x, p.y, p.z).project(camera);
      return { x: v.x, y: v.y, z: v.z };
    });
    const next = pickNearestSlot(projected, pointerNdc.current, DRAG_SNAP_NDC);
    if (next !== hoveredRef.current) {
      hoveredRef.current = next;
      setHovered(next);
      // Surface a "release to merge" preview to the panel when the snap
      // target is a twin, so the merge intent reads in always-visible DOM
      // instead of an in-world marker the top panel can hide (Slice B).
      const target = dragTargets[next];
      if (target && target.kind === "merge") {
        const part = design.parts.find((p) => p.iid === target.iid);
        setMergePreviewLevel(part ? partMergeLevel(part) + 1 : null);
      } else {
        setMergePreviewLevel(null);
      }
    }
  });

  return (
    <>
      <color attach="background" args={["#0b0e14"]} />
      <fog attach="fog" args={["#0b0e14", 9, 22]} />
      <ambientLight intensity={0.4} color="#cdd8f4" />
      <directionalLight
        position={[4, 7, 3]}
        intensity={1.3}
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-bias={-0.0004}
      />
      {/* Cool and warm accents rake the hull so metal reads as metal
          even on the WebGL2 fallback. */}
      <pointLight
        position={[-4, 2.4, -3]}
        color="#6fa8ff"
        intensity={1.1}
        distance={14}
        decay={1.7}
      />
      <pointLight
        position={[3.4, 1.2, 4]}
        color="#ffb070"
        intensity={0.9}
        distance={12}
        decay={1.7}
      />
      <StudioEnvironment intensity={features.environmentIntensity} />
      {features.postBloom && webgpuBackend ? <ScenePostProcessing /> : null}
      <OrbitControls
        makeDefault
        enablePan={false}
        enableRotate={!grabbing}
        enableZoom={!grabbing}
        minDistance={2}
        maxDistance={10}
        // Keep the camera at or above the bot's waist so you cannot orbit
        // under the floor and see the camera-anchored hero part dip through
        // the grounding disc.
        maxPolarAngle={Math.PI * 0.56}
      />
      {/* Grounding disc under the build grid so the bot stops floating
          in the void; it also catches the key light's shadow. It tracks the
          design's lowest part so a downward stack never clips through it. */}
      <mesh
        position={[0, groundY, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <circleGeometry args={[4.4, 48]} />
        <meshStandardMaterial color="#111726" roughness={0.92} />
      </mesh>
      <gridHelper
        args={[8, 16, "#26304a", "#1a2133"]}
        position={[0, groundY + 0.03, 0]}
      />
      {heroDef && (
        <HeroPart
          def={heroDef}
          dragging={dragging}
          dimmed={browseDimmed}
          pointerNdc={pointerNdc}
          onGrab={startGrab}
        />
      )}
      {idleSlots.map((slot) => (
        <IdleSlotMarker
          key={`idle:${slot.key}`}
          position={slot.placement.position}
          color={CATEGORY_COLORS[browseDef.category]}
        />
      ))}
      {dragging &&
        dragTargets.map((target, i) =>
          target.kind === "place" ? (
            <DragGhost
              key={`place:${target.slot.parentIid}:${target.slot.parentConnector}`}
              def={browseDef}
              placement={target.placement}
              active={i === hovered}
            />
          ) : (
            <DragGhost
              key={`merge:${target.iid}`}
              def={browseDef}
              placement={target.placement}
              active={i === hovered}
              merge
            />
          ),
        )}
      {design.parts.map((instance) => {
        const def = PART_CATALOG[instance.partId];
        const placement = layout.get(instance.iid);
        if (!def || !placement) return null;
        const selected = instance.iid === selectedIid;
        return (
          <PlacedPart
            key={instance.iid}
            instance={instance}
            def={def}
            placement={placement}
            selected={selected}
            shadows={shadows}
            onActivate={() => select(selected ? null : instance.iid)}
          />
        );
      })}
      {/* Merge-level markers (W3): a merged part carries one glowing pip
          per level, floated in world-up above it so the upgrade reads at
          a glance. Mesh markers, not 3D text (mine-canvas glyph rule). */}
      {design.parts.map((instance) => {
        const def = PART_CATALOG[instance.partId];
        const placement = layout.get(instance.iid);
        if (!def || !placement) return null;
        const level = partMergeLevel(instance);
        if (level <= 1) return null;
        const { position } = placement;
        return MERGE_PIP_IDS.slice(0, level).map((pipId, i) => (
          <mesh
            key={`pip:${instance.iid}:${pipId}`}
            position={[
              position.x + (i - (level - 1) / 2) * 0.16,
              position.y + 0.62,
              position.z,
            ]}
          >
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshStandardMaterial
              color="#ffe08a"
              emissive="#ffe08a"
              emissiveIntensity={0.9}
              toneMapped={false}
            />
          </mesh>
        ));
      })}
    </>
  );
}

export default function WorkshopCanvas() {
  return (
    <Canvas
      camera={{ position: [2.6, 1.8, 3.2], fov: 45 }}
      gl={createWebGPU}
      shadows
    >
      <WorkshopScene />
    </Canvas>
  );
}
