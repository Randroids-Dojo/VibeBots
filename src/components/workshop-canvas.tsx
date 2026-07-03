"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import {
  CATEGORY_SURFACE,
  createWebGPU,
  partGeometry,
  shapeRotation,
} from "@/components/part-visuals";
import { computeLayout } from "@/sim/layout";
import { PART_CATALOG, type PartCategory } from "@/sim/parts";
import { useWorkshopStore, validSlotsFor } from "@/state/workshop-store";
import {
  graphicsFeaturesFor,
  hasCoarsePointer,
  isWebGPUBackend,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";
import { ScenePostProcessing } from "./scene-post";
import { StudioEnvironment } from "./studio-environment";

const CATEGORY_COLORS: Record<PartCategory, string> = {
  core: "#ff9f43",
  structure: "#a3b1cc",
  mobility: "#54e0c7",
  weapon: "#ff6b6b",
};

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
  const layout = computeLayout(design);
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
      {design.parts.map((instance) => {
        const def = PART_CATALOG[instance.partId];
        const placement = layout.get(instance.iid);
        if (!def || !placement) return null;
        const { position, rotation } = placement;
        const selected = instance.iid === selectedIid;
        const surface = CATEGORY_SURFACE[def.category];
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: R3F scene graph node, not a DOM element
          <group
            key={instance.iid}
            position={[position.x, position.y, position.z]}
            quaternion={[rotation.x, rotation.y, rotation.z, rotation.w]}
            onClick={(event) => {
              // Camera drags that end on a part are not selections.
              if (event.delta > 2) return;
              event.stopPropagation();
              select(selected ? null : instance.iid);
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
                emissive={selected ? "#ffffff" : CATEGORY_COLORS[def.category]}
                emissiveIntensity={selected ? 0.35 : surface.emissiveBoost}
              />
            </mesh>
          </group>
        );
      })}
      {armedDef &&
        ghostSlots.map((slot) => {
          const placement = computeLayout(slot.next).get(slot.iid);
          if (!placement) return null;
          const { position, rotation } = placement;
          const surface = CATEGORY_SURFACE[armedDef.category];
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: R3F scene graph node, not a DOM element
            <group
              key={`ghost:${slot.parentIid}:${slot.parentConnector}`}
              position={[position.x, position.y, position.z]}
              quaternion={[rotation.x, rotation.y, rotation.z, rotation.w]}
              onClick={(event) => {
                if (event.delta > 2) return;
                event.stopPropagation();
                placeAtSlot(slot);
              }}
            >
              <mesh rotation={shapeRotation(armedDef.shape)}>
                {partGeometry(armedDef.shape)}
                <meshStandardMaterial
                  color={CATEGORY_COLORS[armedDef.category]}
                  metalness={surface.metalness}
                  roughness={surface.roughness}
                  flatShading
                  transparent
                  opacity={0.34}
                  depthWrite={false}
                  emissive={CATEGORY_COLORS[armedDef.category]}
                  emissiveIntensity={0.55}
                />
              </mesh>
            </group>
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
