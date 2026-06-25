import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, Mesh, PointLight } from "three/webgpu";
import type { MineCell, OreId } from "@/sim/mine";
import {
  CACHE_COLOR,
  cellHash,
  cellX,
  TEETER_EMISSIVE,
} from "./mine-render-palette";

export function dropPileStats(cell: MineCell): {
  count: number;
  ore: OreId | null;
} {
  let count = 0;
  let ore: OreId | null = null;
  let best = 0;
  for (const [id, n] of Object.entries(cell.drop ?? {}) as Array<
    [OreId, number]
  >) {
    count += n;
    if (n > best) {
      ore = id;
      best = n;
    }
  }
  return { count, ore };
}

const DROP_MARKER_POSITIONS = [
  [0.24, 0.13, 0.05],
  [0.36, 0.11, 0.04],
  [0.3, 0.22, 0.06],
  [0.43, 0.2, 0.05],
  [0.22, 0.25, 0.04],
] as const;

export function DropPileMarkers({
  extraCount,
  color,
}: {
  extraCount: number;
  color: string;
}) {
  const markerCount = Math.min(DROP_MARKER_POSITIONS.length, extraCount);
  const markers = DROP_MARKER_POSITIONS.slice(0, markerCount).map(
    (position, i) => (
      <mesh
        key={`${position[0]}:${position[1]}:${position[2]}`}
        position={[position[0], position[1], position[2]]}
        scale={i === 0 ? 1.05 : 0.9}
      >
        <octahedronGeometry args={[0.045, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.18}
          roughness={0.52}
          flatShading
        />
      </mesh>
    ),
  );
  return <>{markers}</>;
}

export function DroppedBagMarker() {
  return (
    <>
      <mesh scale={[1.08, 0.82, 0.74]}>
        <sphereGeometry args={[0.22, 12, 8]} />
        <meshStandardMaterial
          color="#8f5a2d"
          emissive="#3a2110"
          emissiveIntensity={0.18}
          roughness={0.72}
          flatShading
        />
      </mesh>
      <mesh position={[0, 0.16, 0]} scale={[0.7, 0.35, 0.38]}>
        <sphereGeometry args={[0.13, 10, 6]} />
        <meshStandardMaterial
          color="#c09046"
          emissive="#5f3515"
          emissiveIntensity={0.22}
          roughness={0.6}
          flatShading
        />
      </mesh>
      <mesh position={[0, 0.02, 0.16]}>
        <boxGeometry args={[0.12, 0.06, 0.04]} />
        <meshStandardMaterial
          color="#f5c542"
          emissive="#f5c542"
          emissiveIntensity={0.45}
          roughness={0.4}
        />
      </mesh>
      <pointLight color="#f5c542" intensity={0.45} distance={1.6} decay={1.8} />
    </>
  );
}

const DYNAMITE_RED = "#b43b32";
const FUSE_GLOW = "#ffb347";
const DYNAMITE_WARNING = TEETER_EMISSIVE;
export function DynamiteCharge({ col, row }: { col: number; row: number }) {
  const bodyRef = useRef<Group>(null);
  const warningRef = useRef<Mesh>(null);
  const sparkRef = useRef<Mesh>(null);
  const lightRef = useRef<PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const pulse = 0.5 + 0.5 * Math.sin(t * 12);
    if (bodyRef.current) {
      const scale = 1 + pulse * 0.08;
      bodyRef.current.scale.setScalar(scale);
      bodyRef.current.rotation.z = Math.sin(t * 18) * 0.035;
    }
    if (warningRef.current) {
      warningRef.current.scale.setScalar(0.7 + pulse * 0.45);
      warningRef.current.rotation.z = t * 1.8;
    }
    if (sparkRef.current) {
      const spark = 0.75 + 0.45 * Math.sin(t * 31);
      sparkRef.current.position.x = 0.2 + Math.sin(t * 9) * 0.035;
      sparkRef.current.position.y = 0.18 + Math.abs(Math.sin(t * 14)) * 0.08;
      sparkRef.current.scale.setScalar(spark);
    }
    if (lightRef.current) lightRef.current.intensity = 0.8 + pulse * 1.4;
  });
  return (
    <group position={[cellX(col), -row, 0.78]}>
      <mesh ref={warningRef} position={[0, 0, -0.05]}>
        <circleGeometry args={[0.44, 18]} />
        <meshBasicMaterial
          color={DYNAMITE_WARNING}
          transparent
          opacity={0.24}
          depthWrite={false}
        />
      </mesh>
      <group ref={bodyRef}>
        {[-0.07, 0.07].map((dy) => (
          <mesh key={dy} position={[0, dy, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.055, 0.055, 0.48, 8]} />
            <meshStandardMaterial
              color={DYNAMITE_RED}
              emissive={DYNAMITE_RED}
              emissiveIntensity={0.15}
              roughness={0.55}
              flatShading
            />
          </mesh>
        ))}
        <mesh position={[-0.2, 0, 0.02]}>
          <boxGeometry args={[0.05, 0.28, 0.05]} />
          <meshStandardMaterial color="#3a2520" roughness={0.8} flatShading />
        </mesh>
        <mesh position={[0.16, 0.14, 0.04]} rotation={[0, 0, 0.45]}>
          <boxGeometry args={[0.28, 0.03, 0.03]} />
          <meshStandardMaterial color="#1f1712" roughness={0.9} flatShading />
        </mesh>
        <mesh ref={sparkRef} position={[0.22, 0.24, 0.08]}>
          <octahedronGeometry args={[0.085, 0]} />
          <meshStandardMaterial
            color={FUSE_GLOW}
            emissive={FUSE_GLOW}
            emissiveIntensity={2.4}
            flatShading
          />
        </mesh>
      </group>
      <pointLight
        ref={lightRef}
        position={[0.2, 0.2, 0.3]}
        color={FUSE_GLOW}
        intensity={1.2}
        distance={3}
        decay={1.7}
      />
    </group>
  );
}

export function crackSegmentCountForDamage(damage: number): number {
  const d = Math.max(0, Math.min(1, damage));
  return 3 + Math.floor(d * 6) + Math.floor(d * d * 7);
}

/** Crystals jutting from an ore cell, sized and angled per cell hash. */
export function OreCrystals({
  col,
  row,
  color,
  glow,
}: {
  col: number;
  row: number;
  color: string;
  glow: boolean;
}) {
  const count = 2 + Math.floor(cellHash(col, row, 7) * 2);
  const crystals = [];
  for (let i = 0; i < count; i++) {
    const a = cellHash(col, row, 11 + i);
    const b = cellHash(col, row, 23 + i);
    const s = 0.09 + cellHash(col, row, 31 + i) * 0.09;
    crystals.push(
      <mesh
        key={i}
        position={[(a - 0.5) * 0.52, (b - 0.5) * 0.52, 0.42]}
        rotation={[a * 2.2, b * 2.2, (a + b) * 1.8]}
        scale={[s, s * 1.7, s]}
      >
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={glow ? 1.1 : 0.4}
          roughness={0.25}
          metalness={0.1}
          flatShading
        />
      </mesh>,
    );
  }
  return <>{crystals}</>;
}

export function FallingRockShard({
  col,
  row,
  urgency,
}: {
  col: number;
  row: number;
  urgency: number;
}) {
  const tilt = (cellHash(col, row, 83) - 0.5) * 0.7;
  const glow = urgency > 0 ? 0.2 + 0.55 * urgency : 0.05;
  return (
    <group rotation={[0.15, 0, tilt]}>
      <mesh position={[0, -0.02, 0]} scale={[0.9, 1.08, 0.72]}>
        <coneGeometry args={[0.48, 0.92, 5]} />
        <meshStandardMaterial
          color="#7d4a3c"
          emissive={TEETER_EMISSIVE}
          emissiveIntensity={glow}
          roughness={0.72}
          metalness={0.08}
          flatShading
        />
      </mesh>
      <mesh position={[-0.2, 0.2, 0.2]} rotation={[0.7, 0.4, -0.2]}>
        <coneGeometry args={[0.18, 0.45, 4]} />
        <meshStandardMaterial
          color="#a45f43"
          emissive={TEETER_EMISSIVE}
          emissiveIntensity={glow * 0.7}
          roughness={0.7}
          flatShading
        />
      </mesh>
      <mesh position={[0.22, -0.18, 0.24]} rotation={[-0.5, 0.2, 0.6]}>
        <boxGeometry args={[0.18, 0.52, 0.2]} />
        <meshStandardMaterial color="#4d3637" roughness={0.86} flatShading />
      </mesh>
    </group>
  );
}

/** A buried supply crate: timber box with glowing gold straps. */
export function CacheCrate({ col, row }: { col: number; row: number }) {
  const tilt = (cellHash(col, row, 41) - 0.5) * 0.3;
  return (
    <group rotation={[0, 0, tilt]}>
      <RoundedBox args={[0.8, 0.8, 0.8]} radius={0.06} smoothness={2}>
        <meshStandardMaterial color="#8a6b3f" roughness={0.8} flatShading />
      </RoundedBox>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.86, 0.16, 0.86]} />
        <meshStandardMaterial
          color={CACHE_COLOR}
          emissive={CACHE_COLOR}
          emissiveIntensity={0.5}
          metalness={0.4}
          roughness={0.3}
          flatShading
        />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.16, 0.86, 0.86]} />
        <meshStandardMaterial
          color={CACHE_COLOR}
          emissive={CACHE_COLOR}
          emissiveIntensity={0.5}
          metalness={0.4}
          roughness={0.3}
          flatShading
        />
      </mesh>
    </group>
  );
}

/** Crack decals on a damaged block: more and longer as hp drops. */
export function CrackMarks({
  col,
  row,
  damage,
}: {
  col: number;
  row: number;
  damage: number;
}) {
  const d = Math.max(0.08, Math.min(1, damage));
  const count = crackSegmentCountForDamage(d);
  const marks = [];
  for (let i = 0; i < count; i++) {
    const a = cellHash(col, row, 61 + i);
    const b = cellHash(col, row, 67 + i);
    const branch = i > 2;
    const branchDepth = branch ? (i - 3) / Math.max(1, count - 3) : 0;
    const length =
      (branch ? 0.16 : 0.3) + d * (branch ? 0.18 : 0.42) + branchDepth * 0.08;
    const width = branch ? 0.018 + d * 0.012 : 0.026 + d * 0.018;
    const z = branch ? 0.515 : 0.52;
    const spread = 0.2 + d * 0.42;
    marks.push(
      <group
        key={i}
        position={[(a - 0.5) * spread, (b - 0.5) * spread, z]}
        rotation={[0, 0, a * Math.PI * 1.75 + branchDepth * 1.2]}
      >
        <mesh position={[0.018, -0.015, -0.004]}>
          <boxGeometry args={[length + 0.035, width + 0.014, 0.018]} />
          <meshBasicMaterial
            color="#5b3d29"
            transparent
            opacity={0.34 + d * 0.2}
            depthWrite={false}
          />
        </mesh>
        <mesh>
          <boxGeometry args={[length, width, 0.024]} />
          <meshBasicMaterial
            color="#110c08"
            transparent
            opacity={0.64 + d * 0.28}
            depthWrite={false}
          />
        </mesh>
        {d > 0.55 && !branch ? (
          <mesh
            position={[length * 0.24, 0.055 + b * 0.035, 0.01]}
            rotation={[0, 0, -0.72 - b * 0.58]}
          >
            <boxGeometry args={[length * 0.45, width * 0.62, 0.02]} />
            <meshBasicMaterial
              color="#0b0805"
              transparent
              opacity={0.6 + d * 0.24}
              depthWrite={false}
            />
          </mesh>
        ) : null}
      </group>,
    );
  }
  return <group scale={[1, 1, 1 + d * 0.08]}>{marks}</group>;
}
