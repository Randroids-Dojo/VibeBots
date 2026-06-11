"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import {
  createWebGPU,
  partGeometry,
  shapeRotation,
} from "@/components/part-visuals";
import { computeLayout } from "@/sim/layout";
import { PART_CATALOG, type PartCategory } from "@/sim/parts";
import { useWorkshopStore } from "@/state/workshop-store";

const CATEGORY_COLORS: Record<PartCategory, string> = {
  core: "#ff9f43",
  structure: "#a3b1cc",
  mobility: "#54e0c7",
  weapon: "#ff6b6b",
};

export default function WorkshopCanvas() {
  const design = useWorkshopStore((s) => s.design);
  const selectedIid = useWorkshopStore((s) => s.selectedIid);
  const select = useWorkshopStore((s) => s.select);
  const layout = computeLayout(design);

  return (
    <Canvas camera={{ position: [2.6, 1.8, 3.2], fov: 45 }} gl={createWebGPU}>
      <color attach="background" args={["#0b0e14"]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 7, 3]} intensity={1.4} />
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={2}
        maxDistance={10}
      />
      <gridHelper
        args={[8, 16, "#26304a", "#1a2133"]}
        position={[0, -0.75, 0]}
      />
      {design.parts.map((instance) => {
        const def = PART_CATALOG[instance.partId];
        const position = layout.get(instance.iid);
        if (!def || !position) return null;
        const selected = instance.iid === selectedIid;
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: R3F scene graph node, not a DOM element
          <group
            key={instance.iid}
            position={[position.x, position.y, position.z]}
            onClick={(event) => {
              // Camera drags that end on a part are not selections.
              if (event.delta > 2) return;
              event.stopPropagation();
              select(selected ? null : instance.iid);
            }}
          >
            <mesh rotation={shapeRotation(def.shape)}>
              {partGeometry(def.shape)}
              <meshStandardMaterial
                color={CATEGORY_COLORS[def.category]}
                flatShading
                emissive={selected ? "#ffffff" : "#000000"}
                emissiveIntensity={selected ? 0.35 : 0}
              />
            </mesh>
          </group>
        );
      })}
    </Canvas>
  );
}
