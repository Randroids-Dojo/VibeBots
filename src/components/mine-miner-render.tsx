import { RoundedBox } from "@react-three/drei";
import type { RefObject } from "react";
import type { Group, PointLight } from "three/webgpu";
import { cellHash } from "./mine-render-palette";
import {
  MINER_BATTERY,
  MINER_BEACON,
  MINER_CHASSIS,
  MINER_HANDLE,
  MINER_HAT,
  MINER_HULL,
  MINER_HULL_LIGHT,
  MINER_JOINT,
  MINER_KNEE_GLOW,
  MINER_LAMP_LENS,
  MINER_PICK_STEEL,
  MINER_RUBBER,
  MINER_SCREEN,
  MINER_VISOR,
} from "./miner-materials";

/**
 * The miner robot, model v2 (character pipeline slice 2): armored orange
 * hull over a gunmetal chassis, a glowing chest screen and visor, a
 * working headlamp under the hard hat, a backpack battery with charge
 * bars, and two arms: the pick arm that swings on digs plus an off arm
 * that braces. Materials are shared TSL node materials
 * (miner-materials.ts): fresnel rims for silhouette readability in the
 * dark, animated emissives for life. Animated parts get refs; the outer
 * group's transform belongs to useFrame in the owning scene, driven by
 * the shared rig (miner-rig.ts).
 *
 * Every mesh attaches a shared material via `material={...}` so programs
 * are reused across the model and across canvases.
 */

/** One articulated leg: a hip pivot (ref'd, swung by useFrame) holding
 * armored thigh, glowing knee, piston shin, and a toe-capped foot.
 * Mirror with `side` = -1 or 1. The foot bottoms at child-space
 * y ~ -0.36, the old tread floor. */
function MinerLeg({
  side,
  legRef,
}: {
  side: number;
  legRef: RefObject<Group | null>;
}) {
  return (
    <group ref={legRef} position={[0.12 * side, -0.14, 0]}>
      {/* Hip servo */}
      <mesh material={MINER_JOINT} dispose={null}>
        <cylinderGeometry args={[0.055, 0.055, 0.12, 8]} />
      </mesh>
      {/* Thigh armor plate over the dark thigh */}
      <mesh position={[0, -0.06, 0]} material={MINER_CHASSIS} dispose={null}>
        <boxGeometry args={[0.08, 0.11, 0.09]} />
      </mesh>
      <mesh position={[0, -0.055, 0.01]} material={MINER_HULL} dispose={null}>
        <boxGeometry args={[0.095, 0.07, 0.1]} />
      </mesh>
      {/* Knee lens */}
      <mesh position={[0, -0.115, 0]} material={MINER_KNEE_GLOW} dispose={null}>
        <icosahedronGeometry args={[0.04, 0]} />
      </mesh>
      {/* Shin piston */}
      <mesh position={[0, -0.15, 0.005]} material={MINER_JOINT} dispose={null}>
        <boxGeometry args={[0.07, 0.1, 0.08]} />
      </mesh>
      {/* Ankle strut */}
      <mesh position={[0, -0.185, 0.02]} material={MINER_JOINT} dispose={null}>
        <cylinderGeometry args={[0.02, 0.02, 0.05, 6]} />
      </mesh>
      {/* Foot with a toe cap */}
      <mesh position={[0, -0.195, 0.03]} material={MINER_RUBBER} dispose={null}>
        <boxGeometry args={[0.12, 0.05, 0.16]} />
      </mesh>
      <mesh position={[0, -0.19, 0.1]} material={MINER_HULL} dispose={null}>
        <boxGeometry args={[0.11, 0.045, 0.05]} />
      </mesh>
    </group>
  );
}

/** The braced off arm: shoulder, angled upper arm, forearm, fist. */
function MinerOffArm() {
  return (
    <group position={[-0.24, 0.08, 0.02]}>
      <mesh material={MINER_HULL} dispose={null}>
        <icosahedronGeometry args={[0.07, 0]} />
      </mesh>
      <mesh
        position={[-0.045, -0.09, 0]}
        rotation={[0, 0, 0.42]}
        material={MINER_CHASSIS}
        dispose={null}
      >
        <boxGeometry args={[0.07, 0.18, 0.07]} />
      </mesh>
      <mesh
        position={[-0.085, -0.175, 0]}
        material={MINER_JOINT}
        dispose={null}
      >
        <icosahedronGeometry args={[0.035, 0]} />
      </mesh>
      <mesh
        position={[-0.1, -0.24, 0.02]}
        rotation={[0.25, 0, 0.15]}
        material={MINER_JOINT}
        dispose={null}
      >
        <boxGeometry args={[0.06, 0.13, 0.06]} />
      </mesh>
      <mesh
        position={[-0.105, -0.31, 0.04]}
        material={MINER_RUBBER}
        dispose={null}
      >
        <icosahedronGeometry args={[0.045, 0]} />
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
  boosterRef,
}: {
  bodyRef: RefObject<Group | null>;
  armRef: RefObject<Group | null>;
  lampRef: RefObject<PointLight | null>;
  motesRef: RefObject<Group | null>;
  legLRef: RefObject<Group | null>;
  legRRef: RefObject<Group | null>;
  boosterRef: RefObject<Group | null>;
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
      <group
        ref={bodyRef}
        onUpdate={(group) => {
          // The character is the primary shadow caster; motes and the
          // lamp lens stay out of the shadow pass.
          group.traverse((child) => {
            child.castShadow = true;
          });
        }}
      >
        {/* Pelvis the legs hang from, with hip guard flares */}
        <mesh position={[0, -0.13, 0]} material={MINER_CHASSIS} dispose={null}>
          <boxGeometry args={[0.34, 0.12, 0.26]} />
        </mesh>
        <mesh position={[0, -0.1, 0]} material={MINER_HULL} dispose={null}>
          <boxGeometry args={[0.4, 0.05, 0.28]} />
        </mesh>
        <MinerLeg side={-1} legRef={legLRef} />
        <MinerLeg side={1} legRef={legRRef} />
        {/* Rocket booster flame under the feet and twin pack thrusters,
            shown while the jump jets fire and hover (F-056). Hidden and
            animated by the owning scene's frame loop. */}
        {/* Inline (non-singleton) geometry and materials, so no
            dispose={null}: R3F must dispose these on mine exit or they leak
            GPU buffers (frame-loop-performance rule). */}
        <group ref={boosterRef} position={[0, -0.36, 0.02]} visible={false}>
          <mesh rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.14, 0.42, 12]} />
            <meshBasicMaterial
              color="#ff9a3c"
              transparent
              opacity={0.7}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, -0.02, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.08, 0.3, 10]} />
            <meshBasicMaterial
              color="#fff2c0"
              transparent
              opacity={0.9}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0.12, 0.05, -0.2]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.05, 0.22, 8]} />
            <meshBasicMaterial
              color="#ffce88"
              transparent
              opacity={0.8}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[-0.12, 0.05, -0.2]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.05, 0.22, 8]} />
            <meshBasicMaterial
              color="#ffce88"
              transparent
              opacity={0.8}
              toneMapped={false}
            />
          </mesh>
        </group>
        {/* Torso hull */}
        <RoundedBox
          args={[0.42, 0.34, 0.32]}
          radius={0.06}
          smoothness={2}
          position={[0, -0.03, 0]}
          material={MINER_HULL}
          dispose={null}
        />
        {/* Collar ring under the head */}
        <mesh position={[0, 0.15, 0]} material={MINER_JOINT} dispose={null}>
          <cylinderGeometry args={[0.11, 0.13, 0.05, 10]} />
        </mesh>
        {/* Shoulder pads */}
        <mesh
          position={[0.235, 0.1, 0]}
          material={MINER_HULL_LIGHT}
          dispose={null}
        >
          <boxGeometry args={[0.1, 0.09, 0.2]} />
        </mesh>
        <mesh
          position={[-0.235, 0.1, 0]}
          material={MINER_HULL_LIGHT}
          dispose={null}
        >
          <boxGeometry args={[0.1, 0.09, 0.2]} />
        </mesh>
        {/* Chest screen with its animated scanline */}
        <mesh
          position={[0, -0.03, 0.17]}
          material={MINER_SCREEN}
          dispose={null}
        >
          <boxGeometry args={[0.18, 0.12, 0.02]} />
        </mesh>
        {/* Chest vent slats */}
        <mesh
          position={[0, -0.14, 0.165]}
          material={MINER_CHASSIS}
          dispose={null}
        >
          <boxGeometry args={[0.2, 0.045, 0.015]} />
        </mesh>
        {/* Backpack: power unit with glowing charge bars */}
        <mesh position={[0, 0.0, -0.2]} material={MINER_CHASSIS} dispose={null}>
          <boxGeometry args={[0.26, 0.24, 0.09]} />
        </mesh>
        <mesh
          position={[0, 0.0, -0.25]}
          material={MINER_BATTERY}
          dispose={null}
        >
          <boxGeometry args={[0.14, 0.18, 0.03]} />
        </mesh>
        {/* Head */}
        <RoundedBox
          args={[0.3, 0.2, 0.26]}
          radius={0.06}
          smoothness={2}
          position={[0, 0.26, 0]}
          material={MINER_HULL_LIGHT}
          dispose={null}
        />
        {/* Visor */}
        <mesh position={[0, 0.26, 0.13]} material={MINER_VISOR} dispose={null}>
          <boxGeometry args={[0.22, 0.08, 0.03]} />
        </mesh>
        {/* Cheek intakes */}
        <mesh
          position={[0.15, 0.24, -0.02]}
          material={MINER_JOINT}
          dispose={null}
        >
          <boxGeometry args={[0.03, 0.07, 0.08]} />
        </mesh>
        <mesh
          position={[-0.15, 0.24, -0.02]}
          material={MINER_JOINT}
          dispose={null}
        >
          <boxGeometry args={[0.03, 0.07, 0.08]} />
        </mesh>
        {/* Hard hat with a brim */}
        <mesh position={[0, 0.39, 0]} material={MINER_HAT} dispose={null}>
          <cylinderGeometry args={[0.18, 0.2, 0.09, 12]} />
        </mesh>
        <mesh position={[0, 0.35, 0.14]} material={MINER_HAT} dispose={null}>
          <boxGeometry args={[0.3, 0.02, 0.12]} />
        </mesh>
        {/* Headlamp housing and lens */}
        <mesh position={[0, 0.4, 0.15]} material={MINER_JOINT} dispose={null}>
          <cylinderGeometry args={[0.05, 0.06, 0.06, 10]} />
        </mesh>
        <mesh
          position={[0, 0.4, 0.19]}
          rotation={[Math.PI / 2, 0, 0]}
          material={MINER_LAMP_LENS}
          dispose={null}
        >
          <cylinderGeometry args={[0.05, 0.05, 0.03, 12]} />
        </mesh>
        {/* Beacon antenna on the pack */}
        <mesh
          position={[0.12, 0.2, -0.22]}
          material={MINER_JOINT}
          dispose={null}
        >
          <cylinderGeometry args={[0.012, 0.012, 0.16, 6]} />
        </mesh>
        <mesh
          position={[0.12, 0.3, -0.22]}
          material={MINER_BEACON}
          dispose={null}
        >
          <icosahedronGeometry args={[0.03, 0]} />
        </mesh>
        {/* Off arm bracing the walk */}
        <MinerOffArm />
        {/* Pick arm: shoulder pivot so the swing reads as a chop */}
        <group ref={armRef} position={[0.24, 0.08, 0.06]}>
          <mesh material={MINER_HULL} dispose={null}>
            <icosahedronGeometry args={[0.07, 0]} />
          </mesh>
          <mesh
            position={[0.05, -0.08, 0]}
            rotation={[0, 0, -0.5]}
            material={MINER_HULL}
            dispose={null}
          >
            <boxGeometry args={[0.08, 0.22, 0.08]} />
          </mesh>
          {/* Elbow */}
          <mesh
            position={[0.11, -0.16, 0]}
            material={MINER_JOINT}
            dispose={null}
          >
            <icosahedronGeometry args={[0.04, 0]} />
          </mesh>
          {/* Grip hand on the handle */}
          <mesh
            position={[0.14, -0.21, 0]}
            material={MINER_RUBBER}
            dispose={null}
          >
            <icosahedronGeometry args={[0.042, 0]} />
          </mesh>
          <mesh
            position={[0.13, -0.2, 0]}
            rotation={[0, 0, 0.5]}
            material={MINER_HANDLE}
            dispose={null}
          >
            <cylinderGeometry args={[0.02, 0.02, 0.3, 8]} />
          </mesh>
          {/* Twin-blade pick head with a steel rim */}
          <mesh
            position={[0.2, -0.31, 0]}
            rotation={[0, 0, 1.05]}
            material={MINER_PICK_STEEL}
            dispose={null}
          >
            <boxGeometry args={[0.24, 0.05, 0.05]} />
          </mesh>
          <mesh
            position={[0.3, -0.27, 0]}
            rotation={[0, 0, 1.45]}
            material={MINER_PICK_STEEL}
            dispose={null}
          >
            <boxGeometry args={[0.1, 0.035, 0.04]} />
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
