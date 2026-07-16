"use client";

import { RoundedBox } from "@react-three/drei";
import type { RefObject } from "react";
import type { Group, Material, Mesh } from "three/webgpu";
import type { ClankerKind } from "@/sim/bunker";

/**
 * Shared Clanker body: the render-only geometry, the per-frame body
 * animator, and the specialist tints, extracted so both the flat-mine
 * raid overlay and the first-person bunker raid draw the identical
 * Clanker. The parent owns the outer transform group (it decides where
 * the Clanker stands and how it travels, which differs between the 2D
 * path playback and the live 3D sim) and drives {@link animateClankerBody}
 * and the burst from its own frame loop.
 */

const CLANKER_LEGS = [
  { x: -0.32, side: -1, phase: 0 },
  { x: -0.1, side: -1, phase: 2.1 },
  { x: 0.14, side: -1, phase: 4.2 },
  { x: 0.34, side: -1, phase: 1.05 },
  { x: -0.32, side: 1, phase: 3.15 },
  { x: -0.1, side: 1, phase: 5.25 },
  { x: 0.14, side: 1, phase: 1.05 },
  { x: 0.34, side: 1, phase: 4.2 },
] as const;
const CLANKER_MANDIBLE_SIDES = [-1, 1] as const;
const CLANKER_BURST_SHARDS = [
  { x: -0.26, y: 0.08, angle: -0.55, scale: 0.75 },
  { x: 0.28, y: -0.03, angle: 0.42, scale: 0.68 },
  { x: -0.08, y: -0.31, angle: -0.15, scale: 0.58 },
  { x: 0.1, y: 0.3, angle: 0.9, scale: 0.62 },
] as const;

/** Specialist carapace tints (F-085), render-only: breachers read hot
 * rust (they chew blockers twice as hard), tanks read armored green and
 * carry a bulkier shell (they soak two turret shots). */
export const CLANKER_KIND_CARAPACE: Record<string, string> = {
  standard: "#526074",
  breacher: "#8a4f32",
  tank: "#46604e",
};

function applyMaterialOpacity(item: Material, opacity: number) {
  item.transparent = true;
  item.opacity = opacity;
  item.depthWrite = opacity >= 0.95;
}

// Allocation-free even on the active burst frame: the single-material
// case skips the array wrap, and the group traversal reuses one
// module-level visitor with the opacity parked in a scratch (traverse is
// synchronous, so sequential calls in one frame never interleave). The
// burst path runs inside useFrame, so per .claude/rules/frame-loop-performance.md
// neither helper may allocate.
export function setMaterialOpacity(
  material: Material | Material[],
  opacity: number,
) {
  if (Array.isArray(material)) {
    for (let index = 0; index < material.length; index += 1) {
      applyMaterialOpacity(material[index], opacity);
    }
    return;
  }
  applyMaterialOpacity(material, opacity);
}

let groupTraversalOpacity = 1;
function applyGroupChildOpacity(child: object) {
  const mesh = child as Mesh;
  if (mesh.material) setMaterialOpacity(mesh.material, groupTraversalOpacity);
}

export function setGroupMaterialOpacity(group: Group, opacity: number) {
  groupTraversalOpacity = opacity;
  group.traverse(applyGroupChildOpacity);
}

/** The animated part refs of one clanker, grouped so the per-frame
 * animator takes named fields instead of six adjacent same-typed
 * positional arguments. Built once per host (the RefObjects are stable),
 * so passing it allocates nothing per frame. */
export interface ClankerParts {
  body: RefObject<Group | null>;
  legs: RefObject<Array<Group | null>>;
  mandibles: RefObject<Array<Group | null>>;
  sensor: RefObject<Group | null>;
  eye: RefObject<Mesh | null>;
}

/** Per-frame clanker body language. A module-level function (not a
 * closure rebuilt inside useFrame) with indexed loops: raids animate
 * every clanker every frame, so this path must not allocate. */
export function animateClankerBody(
  group: Group,
  parts: ClankerParts,
  elapsedSeconds: number,
  moving: boolean,
  travelAngle: number,
): void {
  const phase = elapsedSeconds * (moving ? 10.5 : 5.2);
  const stride = moving ? 1 : 0.35;
  group.rotation.z = travelAngle + Math.sin(phase * 0.5) * 0.035 * stride;
  const body = parts.body.current;
  if (body) {
    body.position.z = 0.02 + Math.sin(phase) * 0.018 * stride;
    body.rotation.x = Math.sin(phase * 0.72) * 0.04 * stride;
    body.rotation.y = Math.cos(phase * 0.62) * 0.03 * stride;
  }
  const legs = parts.legs.current;
  for (let index = 0; index < legs.length; index += 1) {
    const leg = legs[index];
    if (!leg) continue;
    const legSpec = CLANKER_LEGS[index];
    if (!legSpec) continue;
    const step = Math.sin(phase + legSpec.phase) * stride;
    const lift = Math.max(0, step) * 0.035;
    leg.rotation.z = legSpec.side * (0.12 + step * 0.24);
    leg.position.z = -0.04 + lift;
  }
  const mandibles = parts.mandibles.current;
  for (let index = 0; index < mandibles.length; index += 1) {
    const mandible = mandibles[index];
    if (!mandible) continue;
    const side = CLANKER_MANDIBLE_SIDES[index] ?? 1;
    mandible.rotation.z =
      side * (0.28 + Math.max(0, Math.sin(phase * 1.35)) * 0.26);
  }
  const sensor = parts.sensor.current;
  if (sensor) {
    sensor.rotation.z = Math.sin(phase * 0.7) * 0.12;
  }
  const eye = parts.eye.current;
  if (eye) {
    const pulse = 1 + Math.max(0, Math.sin(phase * 1.1)) * 0.16;
    eye.scale.set(pulse, 1, 1);
  }
}

/**
 * The Clanker geometry: the animated body group (legs, carapace, armor,
 * head, eye, sensor, mandibles, vents) and the self-destruct burst
 * group. Rendered at the host group's local origin; the host positions,
 * scales, and animates the outer transform. `parts` and `burstRef` are
 * the stable refs the host's frame loop drives.
 */
export function ClankerBody({
  kind,
  parts,
  burstRef,
}: {
  kind: ClankerKind | undefined;
  parts: ClankerParts;
  burstRef: RefObject<Group | null>;
}) {
  return (
    <>
      <group ref={parts.body}>
        {CLANKER_LEGS.map((leg, index) => (
          <group
            key={`leg:${leg.x}:${leg.side}`}
            ref={(node) => {
              parts.legs.current[index] = node;
            }}
            position={[leg.x, leg.side * 0.22, -0.04]}
          >
            <mesh
              position={[0.02, leg.side * 0.16, 0]}
              rotation={[0, 0, leg.side * 0.34]}
            >
              <boxGeometry args={[0.09, 0.31, 0.055]} />
              <meshStandardMaterial
                color="#6e7c90"
                metalness={0.46}
                roughness={0.34}
                flatShading
              />
            </mesh>
            <mesh
              position={[-0.05, leg.side * 0.38, -0.01]}
              rotation={[0, 0, -leg.side * 0.22]}
            >
              <boxGeometry args={[0.075, 0.34, 0.05]} />
              <meshStandardMaterial
                color="#a9b6c8"
                metalness={0.54}
                roughness={0.3}
                flatShading
              />
            </mesh>
            <mesh position={[-0.09, leg.side * 0.56, -0.03]}>
              <boxGeometry args={[0.16, 0.06, 0.045]} />
              <meshStandardMaterial
                color="#293241"
                metalness={0.42}
                roughness={0.46}
                flatShading
              />
            </mesh>
            <mesh>
              <sphereGeometry args={[0.06, 8, 6]} />
              <meshStandardMaterial
                color="#e2b35e"
                emissive="#7a4116"
                emissiveIntensity={0.18}
                metalness={0.48}
                roughness={0.28}
                flatShading
              />
            </mesh>
          </group>
        ))}

        <mesh
          position={[-0.12, 0, 0.03]}
          scale={kind === "tank" ? [1.55, 0.8, 0.46] : [1.35, 0.68, 0.38]}
        >
          <sphereGeometry args={[0.32, 18, 10]} />
          <meshStandardMaterial
            color={CLANKER_KIND_CARAPACE[kind ?? "standard"]}
            emissive="#111720"
            emissiveIntensity={0.2}
            metalness={0.6}
            roughness={0.28}
            flatShading
          />
        </mesh>
        <mesh position={[-0.18, 0, 0.16]} scale={[1.12, 0.5, 0.24]}>
          <sphereGeometry args={[0.28, 14, 8]} />
          <meshStandardMaterial
            color="#263241"
            emissive="#111923"
            emissiveIntensity={0.2}
            metalness={0.38}
            roughness={0.48}
            flatShading
          />
        </mesh>
        {[-0.32, -0.12, 0.1].map((x, index) => (
          <RoundedBox
            key={`armor:${x}`}
            args={[0.2, 0.48 - index * 0.05, 0.08]}
            radius={0.025}
            smoothness={2}
            position={[x, 0, 0.32]}
          >
            <meshStandardMaterial
              color={index === 1 ? "#b9c4d3" : "#8f9bad"}
              emissive="#151c27"
              emissiveIntensity={0.14}
              metalness={0.64}
              roughness={0.26}
              flatShading
            />
          </RoundedBox>
        ))}
        <RoundedBox
          args={[0.36, 0.36, 0.18]}
          radius={0.04}
          smoothness={3}
          position={[0.38, 0, 0.12]}
        >
          <meshStandardMaterial
            color="#394656"
            emissive="#151b25"
            emissiveIntensity={0.22}
            metalness={0.54}
            roughness={0.32}
            flatShading
          />
        </RoundedBox>
        <mesh ref={parts.eye} position={[0.59, 0, 0.18]}>
          <boxGeometry args={[0.04, 0.26, 0.07]} />
          <meshStandardMaterial
            color="#ff4d4d"
            emissive="#ff1d2f"
            emissiveIntensity={1.25}
            roughness={0.18}
          />
        </mesh>
        <group ref={parts.sensor} position={[0.42, 0, 0.34]}>
          <mesh position={[0.08, 0, 0.05]}>
            <sphereGeometry args={[0.055, 10, 6]} />
            <meshStandardMaterial
              color="#ffcc66"
              emissive="#ff7a1f"
              emissiveIntensity={0.72}
              metalness={0.28}
              roughness={0.22}
              flatShading
            />
          </mesh>
          <mesh position={[0.02, 0, 0]} rotation={[0, 0.9, 0]}>
            <boxGeometry args={[0.2, 0.035, 0.035]} />
            <meshStandardMaterial
              color="#b7c2d4"
              metalness={0.58}
              roughness={0.28}
              flatShading
            />
          </mesh>
        </group>
        {CLANKER_MANDIBLE_SIDES.map((side, index) => (
          <group
            key={`mandible:${side}`}
            ref={(node) => {
              parts.mandibles.current[index] = node;
            }}
            position={[0.57, side * 0.11, 0.04]}
            rotation={[0, 0, side * 0.28]}
          >
            <mesh position={[0.08, side * 0.08, 0]}>
              <boxGeometry args={[0.23, 0.055, 0.055]} />
              <meshStandardMaterial
                color="#d1a04b"
                emissive="#5b2c12"
                emissiveIntensity={0.18}
                metalness={0.62}
                roughness={0.24}
                flatShading
              />
            </mesh>
            <mesh position={[0.21, side * 0.13, -0.01]}>
              <coneGeometry args={[0.055, 0.14, 4]} />
              <meshStandardMaterial
                color="#f1d18a"
                emissive="#8a3c18"
                emissiveIntensity={0.2}
                metalness={0.48}
                roughness={0.2}
                flatShading
              />
            </mesh>
          </group>
        ))}
        {[-0.18, 0.18].map((y) => (
          <mesh
            key={`vent:${y}`}
            position={[-0.48, y, 0.08]}
            rotation={[0, 0, y > 0 ? 0.18 : -0.18]}
          >
            <boxGeometry args={[0.2, 0.045, 0.055]} />
            <meshStandardMaterial
              color="#202733"
              emissive="#ff5a1f"
              emissiveIntensity={0.18}
              metalness={0.32}
              roughness={0.42}
              flatShading
            />
          </mesh>
        ))}
      </group>
      <group ref={burstRef} visible={false}>
        <mesh>
          <sphereGeometry args={[0.3, 12, 8]} />
          <meshStandardMaterial
            color="#ffb347"
            emissive="#ff6b1a"
            emissiveIntensity={1.1}
            roughness={0.35}
            flatShading
          />
        </mesh>
        <mesh>
          <ringGeometry args={[0.28, 0.43, 16]} />
          <meshBasicMaterial color="#ffd166" transparent opacity={0.72} />
        </mesh>
        {CLANKER_BURST_SHARDS.map((shard) => (
          <mesh
            key={`shard:${shard.x}:${shard.y}`}
            position={[shard.x, shard.y, 0.08]}
            rotation={[0.2, 0.1, shard.angle]}
            scale={shard.scale}
          >
            <boxGeometry args={[0.18, 0.055, 0.08]} />
            <meshStandardMaterial
              color="#c6d0df"
              emissive="#ff6b1a"
              emissiveIntensity={0.25}
              metalness={0.5}
              roughness={0.3}
              flatShading
            />
          </mesh>
        ))}
      </group>
    </>
  );
}
