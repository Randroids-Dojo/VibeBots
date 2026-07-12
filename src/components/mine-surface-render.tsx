import { useFrame } from "@react-three/fiber";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  type Group,
  type InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PointsMaterial,
  Quaternion,
  Vector3,
} from "three/webgpu";
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
  surfaceBackdropGeometry,
  surfaceBackdropLayerX,
} from "./mine-surface-backdrop";
import {
  applySurfaceBackdropGrade,
  surfaceBackdropMaterial,
} from "./mine-surface-backdrop-materials";
import {
  SURFACE_PALETTE,
  SURFACE_WARP_POSITION,
  type SurfaceGeometryTier,
  surfaceBuildingGeometry,
  surfaceVillageGeometry,
} from "./mine-surface-geometry";
import {
  surfaceMaterial,
  surfaceVillageMaterial,
} from "./mine-surface-materials";
import type { DaylightGrade } from "./time-of-day";

export const CAMP_WIDTH = 60;

const SURFACE_SOIL_GEOMETRY = new BoxGeometry(1.02, 0.08, 0.9);
const SURFACE_TRIM_GEOMETRY = new BoxGeometry(0.94, 0.045, 0.34);
const SURFACE_GRASS_GEOMETRY = new ConeGeometry(0.055, 0.16, 5);
const SURFACE_SOIL_MATERIAL = new MeshStandardMaterial({
  color: "#ffffff",
  roughness: 1,
  metalness: 0,
  vertexColors: true,
  flatShading: true,
});
const SURFACE_TECH_SOIL_MATERIAL = new MeshStandardMaterial({
  color: "#ffffff",
  roughness: 0.45,
  metalness: 0.45,
  vertexColors: true,
  flatShading: true,
});
const SURFACE_TRIM_MATERIAL = new MeshStandardMaterial({
  color: "#ffffff",
  roughness: 0.9,
  metalness: 0,
  vertexColors: true,
  flatShading: true,
});
const SURFACE_TECH_TRIM_MATERIAL = new MeshStandardMaterial({
  color: "#ffffff",
  roughness: 0.9,
  metalness: 0.3,
  emissive: "#0b4a36",
  emissiveIntensity: 0.25,
  vertexColors: true,
  flatShading: true,
});
const SURFACE_GRASS_MATERIAL = new MeshStandardMaterial({
  color: "#4f7a4a",
  roughness: 1,
  flatShading: true,
});
const SURFACE_STAR_MATERIAL = new PointsMaterial({
  size: 0.05,
  color: "#cfe0ff",
  fog: false,
  transparent: true,
  opacity: 1,
  depthWrite: false,
  toneMapped: false,
});
let lastSurfaceStarOpacity = 1;
const surfaceInstanceMatrix = new Matrix4();
const surfaceInstancePosition = new Vector3();
const surfaceInstanceRotation = new Quaternion();
const surfaceInstanceScale = new Vector3(1, 1, 1);
const surfaceInstanceColor = new Color();
const surfaceUpAxis = new Vector3(0, 1, 0);

interface SurfaceInstance {
  x: number;
  y: number;
  z: number;
  color: string | Color;
  rotationY?: number;
}

function writeSurfaceInstances(
  mesh: InstancedMesh | null,
  instances: readonly SurfaceInstance[],
): void {
  if (!mesh) return;
  mesh.count = instances.length;
  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i];
    surfaceInstancePosition.set(instance.x, instance.y, instance.z);
    surfaceInstanceRotation.setFromAxisAngle(
      surfaceUpAxis,
      instance.rotationY ?? 0,
    );
    surfaceInstanceMatrix.compose(
      surfaceInstancePosition,
      surfaceInstanceRotation,
      surfaceInstanceScale,
    );
    mesh.setMatrixAt(i, surfaceInstanceMatrix);
    mesh.setColorAt(i, surfaceInstanceColor.set(instance.color));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

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
  const soilRef = useRef<InstancedMesh>(null);
  const techSoilRef = useRef<InstancedMesh>(null);
  const trimRef = useRef<InstancedMesh>(null);
  const techTrimRef = useRef<InstancedMesh>(null);
  const grassRef = useRef<InstancedMesh>(null);
  const instances = useMemo(() => {
    const soil: SurfaceInstance[] = [];
    const techSoil: SurfaceInstance[] = [];
    const trim: SurfaceInstance[] = [];
    const techTrim: SurfaceInstance[] = [];
    const grass: SurfaceInstance[] = [];
    for (let col = firstCol - 1; col <= lastCol + 1; col++) {
      const biome = biomeAt(col);
      const x = cellX(col);
      const isTech = biome === "highTech";
      (isTech ? techSoil : soil).push({
        x,
        y: -0.47,
        z: -0.36,
        color: variedColor(surfaceColorForBiome(biome), col, 0),
      });
      (isTech ? techTrim : trim).push({
        x,
        y: -0.4,
        z: -0.26,
        color: surfaceTrimColorForBiome(biome),
      });
      if (biome === "default" && Math.abs(col - 0.5) > 8) {
        grass.push({
          x: x + (cellHash(col, 11, 2) - 0.5) * 0.46,
          y: -0.32,
          z: -0.36 + (cellHash(col, 13, 2) - 0.5) * 0.4,
          color: "#4f7a4a",
          rotationY: cellHash(col, 17, 2) * 3,
        });
      }
    }
    return { soil, techSoil, trim, techTrim, grass };
  }, [firstCol, lastCol]);

  useLayoutEffect(() => {
    writeSurfaceInstances(soilRef.current, instances.soil);
    writeSurfaceInstances(techSoilRef.current, instances.techSoil);
    writeSurfaceInstances(trimRef.current, instances.trim);
    writeSurfaceInstances(techTrimRef.current, instances.techTrim);
    writeSurfaceInstances(grassRef.current, instances.grass);
  }, [instances]);

  const portals = findPortalBeacons(mine).filter(
    (portal) => portal.col >= firstCol - 2 && portal.col <= lastCol + 2,
  );
  return (
    <group>
      {instances.soil.length > 0 ? (
        <instancedMesh
          ref={soilRef}
          args={[
            SURFACE_SOIL_GEOMETRY,
            SURFACE_SOIL_MATERIAL,
            instances.soil.length,
          ]}
          dispose={null}
        />
      ) : null}
      {instances.techSoil.length > 0 ? (
        <instancedMesh
          ref={techSoilRef}
          args={[
            SURFACE_SOIL_GEOMETRY,
            SURFACE_TECH_SOIL_MATERIAL,
            instances.techSoil.length,
          ]}
          dispose={null}
        />
      ) : null}
      {instances.trim.length > 0 ? (
        <instancedMesh
          ref={trimRef}
          args={[
            SURFACE_TRIM_GEOMETRY,
            SURFACE_TRIM_MATERIAL,
            instances.trim.length,
          ]}
          dispose={null}
        />
      ) : null}
      {instances.techTrim.length > 0 ? (
        <instancedMesh
          ref={techTrimRef}
          args={[
            SURFACE_TRIM_GEOMETRY,
            SURFACE_TECH_TRIM_MATERIAL,
            instances.techTrim.length,
          ]}
          dispose={null}
        />
      ) : null}
      {instances.grass.length > 0 ? (
        <instancedMesh
          ref={grassRef}
          args={[
            SURFACE_GRASS_GEOMETRY,
            SURFACE_GRASS_MATERIAL,
            instances.grass.length,
          ]}
          dispose={null}
        />
      ) : null}
      {portals.map((portal) => (
        <group key={portal.id} position={[cellX(portal.col), -0.14, 0.55]}>
          <PortalBeaconModel color={portal.color} active={portal.active} />
        </group>
      ))}
    </group>
  );
}

export function usePrefersReducedMotion(): boolean {
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

/**
 * Mutates the shared surface-atmosphere materials without touching React.
 * The star field stays one points draw and every landscape layer keeps one
 * fixed unlit material recipe through the complete shift cycle.
 */
export function applySurfaceAtmosphereVisuals(
  starOpacity: number,
  grade: DaylightGrade,
): void {
  const nextOpacity = Math.max(0, Math.min(1, starOpacity));
  if (Math.abs(nextOpacity - lastSurfaceStarOpacity) > 0.002) {
    SURFACE_STAR_MATERIAL.opacity = nextOpacity;
    lastSurfaceStarOpacity = nextOpacity;
  }
  applySurfaceBackdropGrade(grade);
}

function SurfaceBackdrop() {
  const reduced = usePrefersReducedMotion();
  const tier: SurfaceGeometryTier = resolveGraphicsQualityTier(
    readStoredGraphicsQuality(),
    hasCoarsePointer(),
  );
  const layers = surfaceBackdropGeometry(tier).layers;
  const groups = useRef<Array<Group | null>>([]);
  useFrame(({ camera }) => {
    const refs = groups.current;
    for (let i = 0; i < layers.length; i++) {
      const group = refs[i];
      if (!group) continue;
      group.position.x = surfaceBackdropLayerX(
        camera.position.x,
        layers[i].parallax,
        reduced,
      );
    }
  });
  return (
    <>
      {layers.map((layer, index) => (
        <group
          key={layer.role}
          ref={(group) => {
            groups.current[index] = group;
          }}
        >
          <mesh geometry={layer.geometry} frustumCulled={false} dispose={null}>
            <primitive
              object={surfaceBackdropMaterial(layer.role)}
              attach="material"
            />
          </mesh>
        </group>
      ))}
    </>
  );
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
      <group position={SURFACE_WARP_POSITION}>
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
    <points dispose={null}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <primitive object={SURFACE_STAR_MATERIAL} attach="material" />
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
    <>
      <SurfaceBackdrop />
      {/* One batched star field, faded by the shared lighting controller. */}
      <NightStars />
      <group
        onUpdate={(group) => {
          // The village both throws and catches the sun's shadows (G1).
          // The unlit backdrop stays outside this traversal so it never enters
          // the shadow pass or changes the scene's light-sensitive programs.
          group.traverse((child) => {
            child.castShadow = true;
            child.receiveShadow = true;
          });
        }}
      >
        <SurfaceVillageModel />
      </group>
    </>
  );
});
