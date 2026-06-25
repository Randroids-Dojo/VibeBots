import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, Mesh } from "three/webgpu";
import { Shape } from "three/webgpu";
import type {
  BasePartId,
  BunkerFootprint,
  BunkerRaidSnapshot,
  BunkerState,
} from "@/sim/bunker";
import { BASE_PART_CATALOG, containsBunkerCell } from "@/sim/bunker";
import type { MineCoord } from "@/sim/mine";
import { cellX } from "./mine-render-palette";
import {
  SelectedSupportCellOutline,
  SUPPORT_SELECT_RED,
} from "./mine-support-selection";

export type BunkerBuildMode = "place" | "remove" | "move";

const BASE_FLOOR_RIB_X = [-0.28, 0, 0.28] as const;
const BASE_WALL_RAIL_Y = [-0.26, 0.26] as const;
const BASE_ROOF_RAFTER_SIDES = [-1, 1] as const;
const BASE_ROOF_SHINGLE_BANDS = [
  { y: -0.17, width: 0.68 },
  { y: -0.05, width: 0.5 },
  { y: 0.07, width: 0.32 },
] as const;
const BASE_DOOR_BRACE_Y = [-0.18, 0.18] as const;
const BASE_FLOOR_SPIKE_X = [-0.32, -0.16, 0, 0.16, 0.32] as const;
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

const BASE_ROOF_FACE_SHAPE = new Shape();
BASE_ROOF_FACE_SHAPE.moveTo(-0.46, -0.28);
BASE_ROOF_FACE_SHAPE.lineTo(-0.46, -0.1);
BASE_ROOF_FACE_SHAPE.lineTo(0, 0.34);
BASE_ROOF_FACE_SHAPE.lineTo(0.46, -0.1);
BASE_ROOF_FACE_SHAPE.lineTo(0.46, -0.28);
BASE_ROOF_FACE_SHAPE.lineTo(-0.46, -0.28);

function ClankerMesh({
  clanker,
  raid,
}: {
  clanker: BunkerRaidSnapshot["clankers"][number];
  raid: BunkerRaidSnapshot;
}) {
  const groupRef = useRef<Group>(null);
  const bodyRef = useRef<Group>(null);
  const burstRef = useRef<Group>(null);
  const legRefs = useRef<Array<Group | null>>([]);
  const mandibleRefs = useRef<Array<Group | null>>([]);
  const sensorRef = useRef<Group>(null);
  const eyeRef = useRef<Mesh>(null);
  const localStartRef = useRef<number | null>(null);
  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const animateBody = (
      elapsedSeconds: number,
      moving: boolean,
      travelAngle: number,
    ) => {
      const phase = elapsedSeconds * (moving ? 10.5 : 5.2);
      const stride = moving ? 1 : 0.35;
      group.rotation.z = travelAngle + Math.sin(phase * 0.5) * 0.035 * stride;
      if (bodyRef.current) {
        bodyRef.current.position.z = 0.02 + Math.sin(phase) * 0.018 * stride;
        bodyRef.current.rotation.x = Math.sin(phase * 0.72) * 0.04 * stride;
        bodyRef.current.rotation.y = Math.cos(phase * 0.62) * 0.03 * stride;
      }
      legRefs.current.forEach((leg, index) => {
        if (!leg) return;
        const legSpec = CLANKER_LEGS[index];
        if (!legSpec) return;
        const step = Math.sin(phase + legSpec.phase) * stride;
        const lift = Math.max(0, step) * 0.035;
        leg.rotation.z = legSpec.side * (0.12 + step * 0.24);
        leg.position.z = -0.04 + lift;
      });
      mandibleRefs.current.forEach((mandible, index) => {
        if (!mandible) return;
        const side = CLANKER_MANDIBLE_SIDES[index] ?? 1;
        mandible.rotation.z =
          side * (0.28 + Math.max(0, Math.sin(phase * 1.35)) * 0.26);
      });
      if (sensorRef.current) {
        sensorRef.current.rotation.z = Math.sin(phase * 0.7) * 0.12;
      }
      if (eyeRef.current) {
        const pulse = 1 + Math.max(0, Math.sin(phase * 1.1)) * 0.16;
        eyeRef.current.scale.set(pulse, 1, 1);
      }
    };
    const path =
      clanker.path && clanker.path.length > 0
        ? clanker.path
        : [{ col: clanker.col, row: clanker.row }];
    if (path.length === 1) {
      group.position.set(cellX(path[0].col), -path[0].row, 0.78);
      animateBody(state.clock.elapsedTime, false, 0);
      if (bodyRef.current) bodyRef.current.visible = true;
      if (burstRef.current) burstRef.current.visible = false;
      return;
    }
    let elapsedSeconds = 0;
    if (raid.startedAtMs !== undefined) {
      elapsedSeconds = Math.max(0, (Date.now() - raid.startedAtMs) / 1000);
    } else {
      localStartRef.current ??= state.clock.elapsedTime;
      elapsedSeconds = state.clock.elapsedTime - localStartRef.current;
    }
    const travelSeconds = Math.min(
      raid.durationSeconds * 0.78,
      Math.max(3, (path.length - 1) * 0.7),
    );
    const maxStep = Math.min(
      path.length - 1,
      Math.max(0, clanker.deathStep ?? path.length - 1),
    );
    const deathSeconds =
      path.length <= 1 ? 0 : (maxStep / (path.length - 1)) * travelSeconds;
    const progress =
      travelSeconds <= 0
        ? maxStep
        : Math.min(
            maxStep,
            (elapsedSeconds / travelSeconds) * (path.length - 1),
          );
    const segment = Math.min(path.length - 2, Math.floor(progress));
    const t = progress - segment;
    const from = path[segment];
    const to = path[segment + 1];
    const x = from.col + (to.col - from.col) * t;
    const y = from.row + (to.row - from.row) * t;
    group.position.set(cellX(x), -y, 0.78);
    animateBody(
      elapsedSeconds,
      true,
      Math.atan2(-(to.row - from.row), to.col - from.col),
    );
    const dead = elapsedSeconds >= deathSeconds;
    if (bodyRef.current) bodyRef.current.visible = !dead;
    if (burstRef.current) {
      const burstActive = dead && clanker.status === "self-destructed";
      burstRef.current.visible = burstActive;
      if (burstActive) {
        const burstAge = Math.min(
          1,
          Math.max(0, elapsedSeconds - deathSeconds),
        );
        const scale = 0.6 + burstAge * 0.9;
        burstRef.current.scale.setScalar(scale);
      }
    }
  });
  return (
    <group
      ref={groupRef}
      position={[cellX(clanker.col), -clanker.row, 0.78]}
      scale={0.88}
    >
      <group ref={bodyRef}>
        {CLANKER_LEGS.map((leg, index) => (
          <group
            key={`leg:${leg.x}:${leg.side}`}
            ref={(node) => {
              legRefs.current[index] = node;
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

        <mesh position={[-0.12, 0, 0.03]} scale={[1.35, 0.68, 0.38]}>
          <sphereGeometry args={[0.32, 18, 10]} />
          <meshStandardMaterial
            color="#526074"
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
        <mesh ref={eyeRef} position={[0.59, 0, 0.18]}>
          <boxGeometry args={[0.04, 0.26, 0.07]} />
          <meshStandardMaterial
            color="#ff4d4d"
            emissive="#ff1d2f"
            emissiveIntensity={1.25}
            roughness={0.18}
          />
        </mesh>
        <group ref={sensorRef} position={[0.42, 0, 0.34]}>
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
              mandibleRefs.current[index] = node;
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
    </group>
  );
}

function RaidXpPickupVisual() {
  return (
    <group scale={0.34}>
      <mesh>
        <octahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial
          color="#a3e635"
          emissive="#84cc16"
          emissiveIntensity={0.9}
          roughness={0.28}
          flatShading
        />
      </mesh>
      {[0, 1, 2, 3].map((index) => {
        const angle = (index * Math.PI) / 2;
        return (
          <mesh
            key={index}
            position={[Math.cos(angle) * 0.23, Math.sin(angle) * 0.23, 0]}
            rotation={[0, 0, angle]}
          >
            <boxGeometry args={[0.18, 0.045, 0.035]} />
            <meshStandardMaterial
              color="#facc15"
              emissive="#f59e0b"
              emissiveIntensity={0.65}
              roughness={0.32}
              flatShading
            />
          </mesh>
        );
      })}
      <mesh position={[0, 0, -0.035]}>
        <torusGeometry args={[0.26, 0.018, 6, 16]} />
        <meshStandardMaterial
          color="#38bdf8"
          emissive="#0ea5e9"
          emissiveIntensity={0.48}
          roughness={0.42}
          flatShading
        />
      </mesh>
    </group>
  );
}

function BasePartVisual({
  partId,
  durability,
  footprint,
  col,
}: {
  partId: BasePartId;
  durability: number;
  footprint: BunkerFootprint;
  col: number;
}) {
  switch (partId) {
    case "floor-panel":
      return <BaseFloorPanel />;
    case "wall-panel":
      return <BaseWallPanel />;
    case "roof-panel":
      return <BaseRoofPanel />;
    case "door-panel":
      return <BaseDoorPanel side={doorSideForBunkerColumn(col, footprint)} />;
    case "floor-spikes":
      return <BaseFloorSpikes durability={durability} />;
    case "basic-turret":
      return <BaseTurret durability={durability} />;
  }
}

function doorSideForBunkerColumn(
  col: number,
  footprint: BunkerFootprint,
): -1 | 1 {
  if (col <= footprint.col) return -1;
  if (col >= footprint.col + footprint.width - 1) return 1;
  const midpoint = footprint.col + (footprint.width - 1) / 2;
  return col < midpoint ? -1 : 1;
}

function BaseFloorPanel() {
  return (
    <group>
      <RoundedBox
        args={[0.88, 0.2, 0.14]}
        radius={0.035}
        smoothness={1}
        position={[0, -0.35, 0]}
      >
        <meshStandardMaterial
          color="#71808c"
          roughness={0.68}
          metalness={0.28}
          flatShading
        />
      </RoundedBox>
      {BASE_FLOOR_RIB_X.map((x) => (
        <mesh key={x} position={[x, -0.25, 0.08]}>
          <boxGeometry args={[0.035, 0.12, 0.045]} />
          <meshStandardMaterial
            color="#9fb0bd"
            roughness={0.6}
            metalness={0.22}
            flatShading
          />
        </mesh>
      ))}
    </group>
  );
}

function BaseWallPanel() {
  return (
    <group>
      <RoundedBox args={[0.24, 0.82, 0.18]} radius={0.035} smoothness={1}>
        <meshStandardMaterial
          color="#3fbda9"
          roughness={0.64}
          metalness={0.24}
          flatShading
        />
      </RoundedBox>
      {BASE_WALL_RAIL_Y.map((y) => (
        <mesh key={y} position={[0, y, 0.11]}>
          <boxGeometry args={[0.38, 0.055, 0.055]} />
          <meshStandardMaterial
            color="#8cf0dd"
            roughness={0.55}
            metalness={0.18}
            flatShading
          />
        </mesh>
      ))}
      <mesh position={[0, 0, 0.12]}>
        <boxGeometry args={[0.055, 0.64, 0.055]} />
        <meshStandardMaterial
          color="#287f77"
          roughness={0.62}
          metalness={0.25}
          flatShading
        />
      </mesh>
    </group>
  );
}

function BaseRoofPanel() {
  return (
    <group>
      <mesh position={[0, -0.02, 0.08]}>
        <shapeGeometry args={[BASE_ROOF_FACE_SHAPE]} />
        <meshStandardMaterial
          color="#6f5e88"
          roughness={0.72}
          metalness={0.18}
          flatShading
        />
      </mesh>
      <mesh position={[0, -0.31, 0.15]}>
        <boxGeometry args={[0.98, 0.085, 0.09]} />
        <meshStandardMaterial
          color="#c49b5c"
          roughness={0.58}
          metalness={0.08}
          flatShading
        />
      </mesh>
      {BASE_ROOF_RAFTER_SIDES.map((side) => (
        <mesh
          key={side}
          position={[side * 0.22, 0.09, 0.16]}
          rotation={[0, 0, side * -0.77]}
        >
          <boxGeometry args={[0.63, 0.055, 0.075]} />
          <meshStandardMaterial
            color="#d8b36d"
            roughness={0.58}
            metalness={0.07}
            flatShading
          />
        </mesh>
      ))}
      {BASE_ROOF_SHINGLE_BANDS.map((band) => (
        <mesh key={band.y} position={[0, band.y, 0.17]}>
          <boxGeometry args={[band.width, 0.04, 0.045]} />
          <meshStandardMaterial
            color="#8a789d"
            roughness={0.7}
            metalness={0.14}
            flatShading
          />
        </mesh>
      ))}
      <mesh position={[0, 0.31, 0.18]}>
        <boxGeometry args={[0.18, 0.07, 0.09]} />
        <meshStandardMaterial
          color="#efd08a"
          roughness={0.54}
          metalness={0.08}
          flatShading
        />
      </mesh>
      <mesh position={[0, -0.29, 0.22]}>
        <boxGeometry args={[0.34, 0.055, 0.055]} />
        <meshStandardMaterial
          color="#efd08a"
          roughness={0.55}
          metalness={0.08}
          flatShading
        />
      </mesh>
      {BASE_ROOF_RAFTER_SIDES.map((side) => (
        <mesh key={`post:${side}`} position={[side * 0.42, -0.18, 0.18]}>
          <boxGeometry args={[0.065, 0.22, 0.065]} />
          <meshStandardMaterial
            color="#a67b42"
            roughness={0.62}
            metalness={0.08}
            flatShading
          />
        </mesh>
      ))}
    </group>
  );
}

function BaseDoorPanel({ side }: { side: -1 | 1 }) {
  const x = side * 0.36;
  return (
    <group>
      <RoundedBox
        args={[0.22, 0.82, 0.16]}
        radius={0.03}
        smoothness={1}
        position={[x, 0, 0]}
      >
        <meshStandardMaterial
          color="#bc8442"
          roughness={0.64}
          metalness={0.12}
          flatShading
        />
      </RoundedBox>
      {BASE_DOOR_BRACE_Y.map((y) => (
        <mesh key={y} position={[x, y, 0.1]}>
          <boxGeometry args={[0.26, 0.055, 0.045]} />
          <meshStandardMaterial
            color="#7f4c27"
            roughness={0.66}
            metalness={0.12}
            flatShading
          />
        </mesh>
      ))}
      <mesh position={[x - side * 0.065, 0, 0.12]}>
        <sphereGeometry args={[0.035, 8, 6]} />
        <meshStandardMaterial
          color="#f5d06f"
          roughness={0.42}
          metalness={0.32}
          flatShading
        />
      </mesh>
      <mesh position={[x - side * 0.15, 0, -0.01]}>
        <boxGeometry args={[0.035, 0.72, 0.09]} />
        <meshStandardMaterial
          color="#6f3d22"
          roughness={0.68}
          metalness={0.08}
          flatShading
        />
      </mesh>
    </group>
  );
}

function BaseFloorSpikes({ durability }: { durability: number }) {
  const maxDurability = BASE_PART_CATALOG["floor-spikes"].durability;
  const ratio = Math.max(0.15, Math.min(1, durability / maxDurability));
  const spikeHeight = 0.48 * ratio;
  return (
    <group>
      <BaseFloorPanel />
      {BASE_FLOOR_SPIKE_X.map((x) => (
        <mesh key={x} position={[x, -0.31 + spikeHeight * 0.5, 0.15]}>
          <coneGeometry args={[0.09 * ratio, spikeHeight, 5]} />
          <meshStandardMaterial
            color={ratio > 0.5 ? "#d4dde8" : "#7b8290"}
            emissive={ratio > 0.5 ? "#3b82f6" : "#000000"}
            emissiveIntensity={0.08 * ratio}
            roughness={0.5}
            metalness={0.35}
            flatShading
          />
        </mesh>
      ))}
    </group>
  );
}

function BaseTurret({ durability }: { durability: number }) {
  const maxDurability = BASE_PART_CATALOG["basic-turret"].durability;
  const ratio = Math.max(0.2, Math.min(1, durability / maxDurability));
  return (
    <group>
      <RoundedBox
        args={[0.58, 0.2, 0.16]}
        radius={0.035}
        smoothness={1}
        position={[0, -0.3, 0]}
      >
        <meshStandardMaterial
          color="#6674a3"
          roughness={0.62}
          metalness={0.3}
          flatShading
        />
      </RoundedBox>
      <mesh position={[0, -0.04, 0.08]} scale={[1, ratio, 1]}>
        <cylinderGeometry args={[0.18, 0.24, 0.3, 12]} />
        <meshStandardMaterial
          color="#8aa4ff"
          emissive="#5b6cff"
          emissiveIntensity={0.12 * ratio}
          roughness={0.5}
          metalness={0.35}
          flatShading
        />
      </mesh>
      <mesh position={[0, 0.18, 0.08]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.045, 0.055, 0.46, 8]} />
        <meshStandardMaterial
          color="#c6d1ff"
          roughness={0.42}
          metalness={0.38}
          flatShading
        />
      </mesh>
    </group>
  );
}

export function BunkerOverlay({
  preview,
  blockedCells,
  bunker,
  activeRaid,
  selectedPartCell,
  dragTargetCell,
  targetCell,
  buildMode,
  onBunkerPartTap,
  onBunkerPartPointerDown,
  onBunkerCellHover,
  onBunkerCellTap,
  onBunkerDragTarget,
  onBunkerDragEnd,
}: {
  preview?: BunkerFootprint | null;
  blockedCells?: readonly MineCoord[];
  bunker?: BunkerState | null;
  activeRaid?: BunkerRaidSnapshot | null;
  selectedPartCell?: MineCoord | null;
  dragTargetCell?: MineCoord | null;
  targetCell?: MineCoord | null;
  buildMode?: BunkerBuildMode;
  onBunkerPartTap?: (cell: MineCoord) => void;
  onBunkerPartPointerDown?: (cell: MineCoord) => void;
  onBunkerCellHover?: (cell: MineCoord) => void;
  onBunkerCellTap?: (cell: MineCoord) => void;
  onBunkerDragTarget?: (cell: MineCoord) => void;
  onBunkerDragEnd?: (cell: MineCoord) => void;
}) {
  const footprint = bunker?.footprint ?? preview;
  if (!footprint) return null;
  const outlineColor = bunker ? "#54e0c7" : "#f5c542";
  const outlineOpacity = bunker ? 0.5 : 0.42;
  const lines = [];
  const left = footprint.col - 0.5;
  const right = footprint.col + footprint.width - 0.5;
  const top = -footprint.row + 0.5;
  const bottom = -(footprint.row + footprint.height - 1) - 0.5;
  for (let i = 0; i <= footprint.width; i++) {
    const col = footprint.col + i - 0.5;
    lines.push(
      <mesh
        key={`bunker-vline:${i}`}
        position={[cellX(col), (top + bottom) / 2, 0.78]}
      >
        <planeGeometry args={[0.035, Math.abs(top - bottom)]} />
        <meshBasicMaterial
          color={outlineColor}
          transparent
          opacity={i === 0 || i === footprint.width ? outlineOpacity : 0.16}
          depthWrite={false}
        />
      </mesh>,
    );
  }
  for (let i = 0; i <= footprint.height; i++) {
    const row = footprint.row + i - 0.5;
    lines.push(
      <mesh
        key={`bunker-hline:${i}`}
        position={[cellX((left + right) / 2), -row, 0.78]}
      >
        <planeGeometry args={[Math.abs(right - left), 0.035]} />
        <meshBasicMaterial
          color={outlineColor}
          transparent
          opacity={i === 0 || i === footprint.height ? outlineOpacity : 0.16}
          depthWrite={false}
        />
      </mesh>,
    );
  }
  const blocked =
    blockedCells?.map((cell) => (
      <group key={`bunker-blocked:${cell.col}:${cell.row}`}>
        <mesh position={[cellX(cell.col), -cell.row, 1]} renderOrder={18}>
          <planeGeometry args={[1.08, 1.08]} />
          <meshBasicMaterial
            color={SUPPORT_SELECT_RED}
            transparent
            opacity={0.24}
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
        <SelectedSupportCellOutline col={cell.col} row={cell.row} />
      </group>
    )) ?? [];
  const cellFromPoint = (event: {
    point: { x: number; y: number };
  }): MineCoord => ({
    col: Math.round(event.point.x),
    row: Math.round(-event.point.y),
  });
  const selectedKey = selectedPartCell
    ? `${selectedPartCell.col}:${selectedPartCell.row}`
    : null;
  const targetColor = buildMode === "remove" ? "#ff6b6b" : "#54e0c7";
  const validTarget =
    targetCell && containsBunkerCell(footprint, targetCell.col, targetCell.row)
      ? targetCell
      : null;
  const targetHighlight =
    validTarget && buildMode !== "move" ? (
      <group key={`bunker-target:${validTarget.col}:${validTarget.row}`}>
        <mesh
          position={[cellX(validTarget.col), -validTarget.row, 1.04]}
          renderOrder={20}
        >
          <planeGeometry args={[1.08, 1.08]} />
          <meshBasicMaterial
            color={targetColor}
            transparent
            opacity={0.18}
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
        <SelectedSupportCellOutline
          col={validTarget.col}
          row={validTarget.row}
        />
      </group>
    ) : null;
  const cellTargetPlane =
    bunker &&
    buildMode !== "move" &&
    !activeRaid &&
    onBunkerCellTap &&
    onBunkerCellHover ? (
      // biome-ignore lint/a11y/noStaticElementInteractions: React Three Fiber scene targets are not DOM controls.
      <mesh
        position={[
          cellX(footprint.col + (footprint.width - 1) / 2),
          -(footprint.row + (footprint.height - 1) / 2),
          0.44,
        ]}
        renderOrder={12}
        onPointerMove={(e) => {
          onBunkerCellHover(cellFromPoint(e));
        }}
        onClick={(e) => {
          e.stopPropagation();
          onBunkerCellTap(cellFromPoint(e));
        }}
      >
        <planeGeometry args={[footprint.width, footprint.height]} />
        <meshBasicMaterial
          color={targetColor}
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
    ) : null;
  const dragTarget =
    dragTargetCell &&
    containsBunkerCell(footprint, dragTargetCell.col, dragTargetCell.row) ? (
      <group
        key={`bunker-drag-target:${dragTargetCell.col}:${dragTargetCell.row}`}
      >
        <mesh
          position={[cellX(dragTargetCell.col), -dragTargetCell.row, 1.08]}
          renderOrder={21}
        >
          <planeGeometry args={[1.08, 1.08]} />
          <meshBasicMaterial
            color="#54e0c7"
            transparent
            opacity={0.2}
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
        <SelectedSupportCellOutline
          col={dragTargetCell.col}
          row={dragTargetCell.row}
        />
      </group>
    ) : null;
  const dragPlane =
    bunker && buildMode === "move" && onBunkerDragTarget && onBunkerDragEnd ? (
      <mesh
        position={[
          cellX(footprint.col + (footprint.width - 1) / 2),
          -(footprint.row + (footprint.height - 1) / 2),
          0.45,
        ]}
        renderOrder={13}
        onPointerDown={(e) => {
          const cell = cellFromPoint(e);
          if (
            bunker.parts.some((part) => {
              return part.col === cell.col && part.row === cell.row;
            })
          ) {
            e.stopPropagation();
            onBunkerPartPointerDown?.(cell);
          }
        }}
        onPointerMove={(e) => {
          onBunkerDragTarget(cellFromPoint(e));
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          onBunkerDragEnd(cellFromPoint(e));
        }}
        onPointerCancel={(e) => {
          e.stopPropagation();
          onBunkerDragEnd(cellFromPoint(e));
        }}
      >
        <planeGeometry args={[footprint.width, footprint.height]} />
        <meshBasicMaterial
          color="#54e0c7"
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
    ) : null;
  const parts =
    bunker?.parts.map((part) => {
      const partCell = { col: part.col, row: part.row };
      const partKey = `${part.col}:${part.row}`;
      const selected = selectedKey === partKey;
      return (
        // biome-ignore lint/a11y/noStaticElementInteractions: React Three Fiber scene targets are not DOM controls.
        <group
          key={`bunker-part:${part.col}:${part.row}`}
          position={[cellX(part.col), -part.row, 0.5]}
          onClick={(e) => {
            e.stopPropagation();
            if (buildMode === "remove" && onBunkerCellTap) {
              onBunkerCellTap(partCell);
              return;
            }
            if (buildMode === "move") onBunkerPartTap?.(partCell);
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (buildMode === "move") onBunkerPartPointerDown?.(partCell);
          }}
        >
          {selected && (
            <SelectedSupportCellOutline col={part.col} row={part.row} />
          )}
          <BasePartVisual
            col={part.col}
            durability={part.durability}
            footprint={footprint}
            partId={part.partId}
          />
        </group>
      );
    }) ?? [];
  const clankers =
    activeRaid?.clankers.map((clanker) => (
      <ClankerMesh key={clanker.id} clanker={clanker} raid={activeRaid} />
    )) ?? [];
  const xpPickups =
    (activeRaid?.xpPickups ?? [])
      .filter((pickup) => !pickup.collected)
      .map((pickup) => (
        <group
          key={pickup.id}
          position={[cellX(pickup.col), -pickup.row, 0.86]}
        >
          <RaidXpPickupVisual />
        </group>
      )) ?? [];
  return (
    <>
      {lines}
      {blocked}
      {bunker && (
        <mesh position={[cellX(bunker.core.col), -bunker.core.row, 0.62]}>
          <octahedronGeometry args={[0.28, 0]} />
          <meshStandardMaterial
            color="#c084fc"
            emissive="#8b5cf6"
            emissiveIntensity={0.7}
            roughness={0.35}
            flatShading
          />
        </mesh>
      )}
      {cellTargetPlane}
      {targetHighlight}
      {parts}
      {dragTarget}
      {dragPlane}
      {clankers}
      {xpPickups}
    </>
  );
}

/** Width of the dressed surface camp strip around the origin. */
