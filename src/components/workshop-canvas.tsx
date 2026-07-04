"use client";

import { OrbitControls } from "@react-three/drei";
import {
  Canvas,
  type ThreeEvent,
  useFrame,
  useThree,
} from "@react-three/fiber";
import { useRef } from "react";
import type { Group, MeshStandardMaterial } from "three";
import {
  CATEGORY_SURFACE,
  createWebGPU,
  partGeometry,
  shapeRotation,
} from "@/components/part-visuals";
import { type PartInstance, partMergeLevel } from "@/sim/design";
import { computeLayout, type Placement } from "@/sim/layout";
import { PART_CATALOG, type PartCategory, type PartDef } from "@/sim/parts";
import {
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
  ghostOpacity,
  MOUNT_SECONDS,
  PULSE_SECONDS,
  snapScale,
} from "./workshop-animation";

const CATEGORY_COLORS: Record<PartCategory, string> = {
  core: "#ff9f43",
  structure: "#a3b1cc",
  mobility: "#54e0c7",
  weapon: "#ff6b6b",
};

// Stable pip keys (one per merge level) so the level markers never key on
// a bare array index. Length covers MAX_PART_MERGE_LEVEL.
const MERGE_PIP_IDS = ["i", "ii", "iii"] as const;

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
  mergeTarget,
  shadows,
  onActivate,
}: {
  instance: PartInstance;
  def: PartDef;
  placement: Placement;
  selected: boolean;
  mergeTarget: boolean;
  shadows: boolean;
  onActivate: () => void;
}) {
  const groupRef = useRef<Group>(null);
  const mountT = useRef(0);
  const pulseT = useRef(0);
  const level = partMergeLevel(instance);
  const prevLevel = useRef(level);
  useFrame((_, dt) => {
    if (level > prevLevel.current) pulseT.current = 1;
    prevLevel.current = level;
    mountT.current = advance(mountT.current, dt, MOUNT_SECONDS);
    pulseT.current = decay(pulseT.current, dt, PULSE_SECONDS);
    groupRef.current?.scale.setScalar(
      snapScale(mountT.current, pulseT.current),
    );
  });
  const { position, rotation } = placement;
  const surface = CATEGORY_SURFACE[def.category];
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: R3F scene graph node, not a DOM element
    <group
      ref={groupRef}
      position={[position.x, position.y, position.z]}
      quaternion={[rotation.x, rotation.y, rotation.z, rotation.w]}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        // Camera drags that end on a part are not activations.
        if (event.delta > 2) return;
        event.stopPropagation();
        onActivate();
      }}
    >
      <mesh
        rotation={shapeRotation(def.shape)}
        castShadow={shadows}
        receiveShadow={shadows}
      >
        {partGeometry(def.shape)}
        <meshStandardMaterial
          color={CATEGORY_COLORS[def.category]}
          metalness={surface.metalness}
          roughness={surface.roughness}
          flatShading
          emissive={
            mergeTarget
              ? "#ffe08a"
              : selected
                ? "#ffffff"
                : CATEGORY_COLORS[def.category]
          }
          emissiveIntensity={
            mergeTarget ? 0.7 : selected ? 0.35 : surface.emissiveBoost
          }
        />
      </mesh>
    </group>
  );
}

/**
 * A translucent placement ghost (W5 feel polish): it breathes its opacity
 * so a valid slot reads as interactive, and carries an invisible larger
 * hit sphere so the placement tap is thumb-sized on phones.
 */
function GhostSlot({
  def,
  placement,
  onPlace,
}: {
  def: PartDef;
  placement: Placement;
  onPlace: () => void;
}) {
  const matRef = useRef<MeshStandardMaterial>(null);
  useFrame((state) => {
    if (matRef.current) {
      matRef.current.opacity = ghostOpacity(state.clock.elapsedTime);
    }
  });
  const { position, rotation } = placement;
  const surface = CATEGORY_SURFACE[def.category];
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: R3F scene graph node, not a DOM element
    <group
      position={[position.x, position.y, position.z]}
      quaternion={[rotation.x, rotation.y, rotation.z, rotation.w]}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        if (event.delta > 2) return;
        event.stopPropagation();
        onPlace();
      }}
    >
      <mesh rotation={shapeRotation(def.shape)}>
        {partGeometry(def.shape)}
        <meshStandardMaterial
          ref={matRef}
          color={CATEGORY_COLORS[def.category]}
          metalness={surface.metalness}
          roughness={surface.roughness}
          flatShading
          transparent
          opacity={0.34}
          depthWrite={false}
          emissive={CATEGORY_COLORS[def.category]}
          emissiveIntensity={0.55}
        />
      </mesh>
      {/* Thumb-sized tap target: invisible but still raycast. */}
      <mesh>
        <sphereGeometry args={[0.6, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
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
function HeroPart({ def }: { def: PartDef }) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const anchorRef = useRef<Group>(null);
  const spinRef = useRef<Group>(null);
  const yaw = useRef(0);
  useFrame((_, dt) => {
    const anchor = anchorRef.current;
    if (anchor) {
      anchor.position.copy(camera.position);
      anchor.quaternion.copy(camera.quaternion);
      // Move into camera-local space: down into the empty lower band and
      // back so the whole part stays clear of the bottom edge on tall
      // portrait viewports while reading as a "part in hand".
      anchor.translateY(-0.5);
      anchor.translateZ(-2.75);
    }
    yaw.current += dt * 0.7;
    spinRef.current?.rotation.set(0, yaw.current, 0);
    const canvas = gl.domElement as HTMLCanvasElement;
    canvas.dataset.heroYaw = (yaw.current % (Math.PI * 2)).toFixed(2);
  });
  const surface = CATEGORY_SURFACE[def.category];
  return (
    <group ref={anchorRef}>
      <group ref={spinRef} scale={0.65}>
        <mesh rotation={shapeRotation(def.shape)}>
          {partGeometry(def.shape)}
          <meshStandardMaterial
            color={CATEGORY_COLORS[def.category]}
            metalness={surface.metalness}
            roughness={surface.roughness}
            flatShading
            emissive={CATEGORY_COLORS[def.category]}
            emissiveIntensity={surface.emissiveBoost + 0.18}
          />
        </mesh>
      </group>
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
  const armedPartId = useWorkshopStore((s) => s.armedPartId);
  const placeAtSlot = useWorkshopStore((s) => s.placeAtSlot);
  const mergePart = useWorkshopStore((s) => s.mergePart);
  const browsePartId = useWorkshopStore((s) => s.browsePartId);
  const buildActive = useWorkshopStore((s) => s.buildActive);
  const layout = computeLayout(design);
  // The hero part rides the Build tab only, and gives way to the ghost
  // preview while a part is armed for placement so the bench reads clean.
  const heroDef =
    buildActive && !armedPartId ? PART_CATALOG[browsePartId] : null;
  // Placement ghosts: one translucent preview at each legal slot for the
  // armed part, tappable to commit that exact connection (W2).
  const armedDef = armedPartId ? PART_CATALOG[armedPartId] : null;
  const ghostSlots = armedDef ? validSlotsFor(design, armedDef) : [];
  const webgpuBackend = useThree((state) => isWebGPUBackend(state.gl));
  const features = graphicsFeaturesFor(
    resolveGraphicsQualityTier(readStoredGraphicsQuality(), hasCoarsePointer()),
  );
  const shadows = features.shadows && webgpuBackend;

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
        minDistance={2}
        maxDistance={10}
      />
      {/* Grounding disc under the build grid so the bot stops floating
          in the void; it also catches the key light's shadow. */}
      <mesh
        position={[0, -0.78, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <circleGeometry args={[4.4, 48]} />
        <meshStandardMaterial color="#111726" roughness={0.92} />
      </mesh>
      <gridHelper
        args={[8, 16, "#26304a", "#1a2133"]}
        position={[0, -0.75, 0]}
      />
      {heroDef && <HeroPart def={heroDef} />}
      {design.parts.map((instance) => {
        const def = PART_CATALOG[instance.partId];
        const placement = layout.get(instance.iid);
        if (!def || !placement) return null;
        const selected = instance.iid === selectedIid;
        // While armed, a placed part of the same kind that can still level
        // up is a merge target: tapping it merges instead of placing (W4).
        const mergeTarget =
          armedDef !== null &&
          instance.partId === armedPartId &&
          planMergeSelectedPart(design, instance.iid) !== null;
        return (
          <PlacedPart
            key={instance.iid}
            instance={instance}
            def={def}
            placement={placement}
            selected={selected}
            mergeTarget={mergeTarget}
            shadows={shadows}
            onActivate={() => {
              if (mergeTarget) {
                mergePart(instance.iid);
                return;
              }
              select(selected ? null : instance.iid);
            }}
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
      {armedDef &&
        ghostSlots.map((slot) => {
          const placement = computeLayout(slot.next).get(slot.iid);
          if (!placement) return null;
          return (
            <GhostSlot
              key={`ghost:${slot.parentIid}:${slot.parentConnector}`}
              def={armedDef}
              placement={placement}
              onPlace={() => placeAtSlot(slot)}
            />
          );
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
