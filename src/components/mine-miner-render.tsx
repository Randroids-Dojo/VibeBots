import { RoundedBox } from "@react-three/drei";
import type { RefObject } from "react";
import type { Group, PointLight } from "three/webgpu";
import { cellHash } from "./mine-render-palette";

/**
 * The miner robot: treaded chassis, orange torso with a glowing chest
 * screen, visored head under a hard hat with a working headlamp, and a
 * pickaxe arm that swings on digs. Animated parts get refs; the outer
 * group's transform belongs to useFrame in MineScene.
 */
/** One articulated leg: a hip pivot (ref'd, swung by useFrame) holding
 * a thigh, a shin, and a chunky foot. Mirror with `side` = -1 or 1. */
function MinerLeg({
  side,
  legRef,
}: {
  side: number;
  legRef: RefObject<Group | null>;
}) {
  return (
    // Hip pivot. useFrame swings this group's X rotation for the stride;
    // the foot bottoms at child-space y ~ -0.36, the old tread floor.
    <group ref={legRef} position={[0.12 * side, -0.14, 0]}>
      {/* Hip servo */}
      <mesh>
        <cylinderGeometry args={[0.055, 0.055, 0.12, 8]} />
        <meshStandardMaterial
          color="#3a3f4d"
          metalness={0.4}
          roughness={0.6}
          flatShading
        />
      </mesh>
      {/* Thigh */}
      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[0.08, 0.11, 0.09]} />
        <meshStandardMaterial color="#2b2f3a" roughness={0.8} flatShading />
      </mesh>
      {/* Knee */}
      <mesh position={[0, -0.115, 0]}>
        <icosahedronGeometry args={[0.04, 0]} />
        <meshStandardMaterial
          color="#54e0c7"
          emissive="#1a4f47"
          roughness={0.5}
          flatShading
        />
      </mesh>
      {/* Shin */}
      <mesh position={[0, -0.15, 0.005]}>
        <boxGeometry args={[0.07, 0.1, 0.08]} />
        <meshStandardMaterial color="#3a3f4d" roughness={0.8} flatShading />
      </mesh>
      {/* Foot */}
      <mesh position={[0, -0.195, 0.03]}>
        <boxGeometry args={[0.12, 0.05, 0.16]} />
        <meshStandardMaterial color="#23262f" roughness={0.9} flatShading />
      </mesh>
    </group>
  );
}

export function MinerBot({
  bodyRef,
  armRef,
  lampRef,
  motesRef,
  legLRef,
  legRRef,
}: {
  bodyRef: RefObject<Group | null>;
  armRef: RefObject<Group | null>;
  lampRef: RefObject<PointLight | null>;
  motesRef: RefObject<Group | null>;
  legLRef: RefObject<Group | null>;
  legRRef: RefObject<Group | null>;
}) {
  const motes = [];
  for (let i = 0; i < 14; i++) {
    const a = cellHash(i, 211, 1);
    const b = cellHash(i, 223, 9);
    const r = 0.55 + cellHash(i, 227, 3) * 1.35;
    motes.push(
      <mesh
        key={i}
        position={[
          Math.cos(a * 6.28) * r,
          Math.sin(b * 6.28) * r * 0.8,
          0.5 + a * 0.4,
        ]}
      >
        <icosahedronGeometry args={[0.016 + b * 0.014, 0]} />
        <meshBasicMaterial color="#ffe2b0" transparent opacity={0.45} />
      </mesh>,
    );
  }
  return (
    <>
      {/* Dust motes drifting in the lamp light (hidden on the surface). */}
      <group ref={motesRef}>{motes}</group>
      <group ref={bodyRef}>
        {/* Pelvis the legs hang from (replaces the old tread chassis) */}
        <mesh position={[0, -0.13, 0]}>
          <boxGeometry args={[0.34, 0.12, 0.26]} />
          <meshStandardMaterial color="#2b2f3a" roughness={0.85} flatShading />
        </mesh>
        <MinerLeg side={-1} legRef={legLRef} />
        <MinerLeg side={1} legRef={legRRef} />
        {/* Torso */}
        <RoundedBox
          args={[0.42, 0.34, 0.32]}
          radius={0.06}
          smoothness={2}
          position={[0, -0.03, 0]}
        >
          <meshStandardMaterial
            color="#ff9f43"
            roughness={0.5}
            metalness={0.25}
            flatShading
          />
        </RoundedBox>
        {/* Chest screen */}
        <mesh position={[0, -0.03, 0.17]}>
          <boxGeometry args={[0.18, 0.12, 0.02]} />
          <meshStandardMaterial
            color="#0d2b26"
            emissive="#54e0c7"
            emissiveIntensity={0.9}
            flatShading
          />
        </mesh>
        {/* Head */}
        <RoundedBox
          args={[0.3, 0.2, 0.26]}
          radius={0.06}
          smoothness={2}
          position={[0, 0.26, 0]}
        >
          <meshStandardMaterial
            color="#ffb066"
            roughness={0.45}
            metalness={0.25}
            flatShading
          />
        </RoundedBox>
        {/* Visor */}
        <mesh position={[0, 0.26, 0.13]}>
          <boxGeometry args={[0.22, 0.08, 0.03]} />
          <meshStandardMaterial
            color="#101820"
            emissive="#7df9ff"
            emissiveIntensity={1.2}
            flatShading
          />
        </mesh>
        {/* Hard hat */}
        <mesh position={[0, 0.39, 0]}>
          <cylinderGeometry args={[0.18, 0.2, 0.09, 12]} />
          <meshStandardMaterial
            color="#f5c542"
            roughness={0.4}
            metalness={0.2}
            flatShading
          />
        </mesh>
        {/* Headlamp housing and glow */}
        <mesh position={[0, 0.38, 0.16]}>
          <cylinderGeometry args={[0.05, 0.06, 0.07, 10]} />
          <meshStandardMaterial
            color="#fff3c4"
            emissive="#ffe9a8"
            emissiveIntensity={2.2}
            flatShading
          />
        </mesh>
        {/* Antenna */}
        <mesh position={[0.12, 0.47, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.14, 6]} />
          <meshStandardMaterial color="#3a3f4d" flatShading />
        </mesh>
        <mesh position={[0.12, 0.55, 0]}>
          <icosahedronGeometry args={[0.03, 0]} />
          <meshStandardMaterial
            color="#ff6b6b"
            emissive="#ff6b6b"
            emissiveIntensity={1.6}
            flatShading
          />
        </mesh>
        {/* Pick arm: shoulder pivot so the swing reads as a chop */}
        <group ref={armRef} position={[0.24, 0.08, 0.06]}>
          <mesh position={[0.05, -0.08, 0]} rotation={[0, 0, -0.5]}>
            <boxGeometry args={[0.08, 0.22, 0.08]} />
            <meshStandardMaterial
              color="#e08a32"
              roughness={0.55}
              flatShading
            />
          </mesh>
          <mesh position={[0.13, -0.2, 0]} rotation={[0, 0, 0.5]}>
            <cylinderGeometry args={[0.02, 0.02, 0.3, 8]} />
            <meshStandardMaterial color="#6b4a2a" roughness={0.9} flatShading />
          </mesh>
          <mesh position={[0.2, -0.31, 0]} rotation={[0, 0, 1.05]}>
            <boxGeometry args={[0.2, 0.05, 0.05]} />
            <meshStandardMaterial
              color="#aeb6c4"
              metalness={0.6}
              roughness={0.3}
              flatShading
            />
          </mesh>
        </group>
      </group>
      {/* The lamp is the scene's key light below the surface. */}
      <pointLight
        ref={lampRef}
        position={[0, 0.4, 1.1]}
        color="#ffd9a0"
        intensity={1.2}
        distance={9}
        decay={1.4}
      />
    </>
  );
}
