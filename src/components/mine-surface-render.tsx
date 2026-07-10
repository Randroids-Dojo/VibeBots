import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three/webgpu";
import { biomeAt, findPortalBeacons, type MineState } from "@/sim/mine";
import { setDatasetNumber, setDatasetText } from "./dataset-diagnostics";
import {
  hasCoarsePointer,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";
import { useBlockDetail } from "./mine-block-render";
import {
  cellHash,
  cellX,
  surfaceColorForBiome,
  surfaceTrimColorForBiome,
  variedColor,
} from "./mine-render-palette";
import {
  SURFACE_PALETTE,
  type SurfaceGeometryTier,
  surfaceBuildingGeometry,
  surfaceVillageGeometry,
} from "./mine-surface-geometry";
import {
  surfaceMaterial,
  surfaceVillageMaterial,
} from "./mine-surface-materials";

export const CAMP_WIDTH = 60;

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
    </group>
  );
}

export function SurfaceSkin({
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

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function WarpMotionLayers({
  tier,
  color,
  detail,
}: {
  tier: SurfaceGeometryTier;
  color: string;
  detail: boolean;
}) {
  const groupRef = useRef<Group>(null);
  const reduced = usePrefersReducedMotion();
  const datasetCache = useRef<Record<string, number | string>>({});
  const motionLayers = surfaceBuildingGeometry("warp", tier).motionLayers;
  useFrame(({ clock, gl }) => {
    const t = clock.elapsedTime;
    const angle = reduced ? 0 : t * 0.12;
    const pulse = reduced ? 1 : 1 + Math.sin(t * 1.25) * 0.025;
    const group = groupRef.current;
    if (group) {
      group.rotation.z = angle;
      group.scale.setScalar(pulse);
    }
    const cache = datasetCache.current;
    setDatasetNumber(
      cache,
      gl.domElement.dataset,
      "surfaceWarpAngle",
      angle,
      2,
    );
    setDatasetText(
      cache,
      gl.domElement.dataset,
      "surfaceWarpReduced",
      reduced ? "1" : "0",
    );
  });
  return (
    <group ref={groupRef} position={[0, 2.02, 0]}>
      {motionLayers.map((layer) => (
        <mesh
          key={`warp-motion:${layer.role}`}
          geometry={layer.geometry}
          position={[0, -2.02, 0]}
          dispose={null}
        >
          <primitive
            object={surfaceMaterial(
              layer.role,
              color,
              SURFACE_PALETTE.energyCyan,
              detail,
            )}
            attach="material"
          />
        </mesh>
      ))}
    </group>
  );
}

function SurfaceVillageModel() {
  const detail = useBlockDetail();
  const tier: SurfaceGeometryTier = resolveGraphicsQualityTier(
    readStoredGraphicsQuality(),
    hasCoarsePointer(),
  );
  const layers = surfaceVillageGeometry(tier);
  return (
    <>
      {layers.map((layer) => (
        <mesh key={layer.role} geometry={layer.geometry} dispose={null}>
          <primitive
            object={surfaceVillageMaterial(layer.role, detail)}
            attach="material"
          />
        </mesh>
      ))}
      <group position={[6, -1.5, -0.85]}>
        <WarpMotionLayers tier={tier} color="#E08AFF" detail={detail} />
      </group>
    </>
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
 * Static industrial surface village. It is prop-free and memoized so a
 * walk tick never reconciles the hard-surface model tree. The Warp ring
 * owns the settlement's only ambient animation.
 */
export const SurfaceDressing = memo(function SurfaceDressing() {
  return (
    <group
      onUpdate={(group) => {
        // The village both throws and catches the sun's shadows (G1).
        // Applied by traversal: the dressing is a memoized static tree,
        // so this runs once instead of prop-plumbing every mesh.
        group.traverse((child) => {
          child.castShadow = true;
          child.receiveShadow = true;
        });
      }}
    >
      {/* Night sky over the camp */}
      <NightStars />
      <SurfaceVillageModel />
    </group>
  );
});
