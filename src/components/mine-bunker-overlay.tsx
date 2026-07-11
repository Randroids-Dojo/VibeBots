import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type RefObject, useRef } from "react";
import type { Group, Material, Mesh } from "three/webgpu";
import type {
  BasePartId,
  BunkerFootprint,
  BunkerRaidSnapshot,
  BunkerState,
} from "@/sim/bunker";
import { BASE_PART_CATALOG, containsBunkerCell } from "@/sim/bunker";
import type { MineCoord } from "@/sim/mine";
import {
  hasCoarsePointer,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";
import { useBlockDetail } from "./mine-block-render";
import {
  BASE_PART_EMISSIVES,
  bunkerPartGeometry,
  bunkerPartMaterial,
} from "./mine-bunker-part-geometry";
import { cellX } from "./mine-render-palette";
import {
  SelectedSupportCellOutline,
  SUPPORT_SELECT_RED,
} from "./mine-support-selection";
import type {
  SurfaceGeometryTier,
  SurfaceMaterialRole,
} from "./mine-surface-geometry";
import {
  CLANKER_BURST_VISIBLE_SECONDS,
  dissipatingOpacity,
  transientAnimationActive,
  transientAnimationProgress,
} from "./mine-transient-animation";

export type BunkerBuildMode = "place" | "remove" | "move";

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

function setMaterialOpacity(material: Material | Material[], opacity: number) {
  const materials = Array.isArray(material) ? material : [material];
  for (const item of materials) {
    item.transparent = true;
    item.opacity = opacity;
    item.depthWrite = opacity >= 0.95;
  }
}

function setGroupMaterialOpacity(group: Group, opacity: number) {
  group.traverse((child) => {
    const mesh = child as Mesh;
    if (mesh.material) setMaterialOpacity(mesh.material, opacity);
  });
}

/** The animated part refs of one clanker, grouped so the per-frame
 * animator takes named fields instead of six adjacent same-typed
 * positional arguments. Built once per ClankerMesh (the RefObjects are
 * stable), so passing it allocates nothing per frame. */
interface ClankerParts {
  body: RefObject<Group | null>;
  legs: RefObject<Array<Group | null>>;
  mandibles: RefObject<Array<Group | null>>;
  sensor: RefObject<Group | null>;
  eye: RefObject<Mesh | null>;
}

/** Per-frame clanker body language. A module-level function (not a
 * closure rebuilt inside useFrame) with indexed loops: raids animate
 * every clanker every frame, so this path must not allocate. */
function animateClankerBody(
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
  const partsRef = useRef<ClankerParts>({
    body: bodyRef,
    legs: legRefs,
    mandibles: mandibleRefs,
    sensor: sensorRef,
    eye: eyeRef,
  });
  const localStartRef = useRef<number | null>(null);
  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const path = clanker.path && clanker.path.length > 0 ? clanker.path : null;
    if (!path || path.length === 1) {
      // Idle: parked on its own cell (no fallback array; the clanker
      // snapshot already carries the cell).
      const cell = path ? path[0] : clanker;
      group.position.set(cellX(cell.col), -cell.row, 0.78);
      animateClankerBody(
        group,
        partsRef.current,
        state.clock.elapsedTime,
        false,
        0,
      );
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
    animateClankerBody(
      group,
      partsRef.current,
      elapsedSeconds,
      true,
      Math.atan2(-(to.row - from.row), to.col - from.col),
    );
    const dead = elapsedSeconds >= deathSeconds;
    if (bodyRef.current) bodyRef.current.visible = !dead;
    if (burstRef.current) {
      const burstAge = Math.max(0, elapsedSeconds - deathSeconds);
      const burstActive =
        dead &&
        clanker.status === "self-destructed" &&
        transientAnimationActive(burstAge, CLANKER_BURST_VISIBLE_SECONDS);
      burstRef.current.visible = burstActive;
      if (burstActive) {
        const progress = transientAnimationProgress(
          burstAge,
          CLANKER_BURST_VISIBLE_SECONDS,
        );
        const scale = 0.6 + progress * 1.05;
        burstRef.current.scale.setScalar(scale);
        setGroupMaterialOpacity(
          burstRef.current,
          dissipatingOpacity(burstAge, CLANKER_BURST_VISIBLE_SECONDS),
        );
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
    <group>
      <mesh position={[0, 0, -0.06]}>
        <ringGeometry args={[0.52, 0.72, 32]} />
        <meshBasicMaterial
          color="#67e8f9"
          depthTest={false}
          depthWrite={false}
          opacity={0.48}
          transparent
        />
      </mesh>
      <mesh position={[0, 0, 0.08]}>
        <octahedronGeometry args={[0.46, 0]} />
        <meshBasicMaterial
          color="#39ff14"
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((index) => {
        const angle = (index * Math.PI) / 3;
        return (
          <mesh
            key={index}
            position={[Math.cos(angle) * 0.62, Math.sin(angle) * 0.62, 0.02]}
            rotation={[0, 0, angle]}
          >
            <boxGeometry args={[0.48, 0.08, 0.04]} />
            <meshStandardMaterial
              color="#facc15"
              emissive="#f59e0b"
              emissiveIntensity={0.85}
              roughness={0.26}
              flatShading
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        );
      })}
      <mesh position={[0, 0, 0.04]}>
        <torusGeometry args={[0.68, 0.045, 8, 28]} />
        <meshStandardMaterial
          color="#38bdf8"
          emissive="#0ea5e9"
          emissiveIntensity={0.7}
          roughness={0.34}
          flatShading
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/** Damage never scales below this, so wilted parts stay visible. */
const BASE_PART_MIN_WILT = 0.15;

/**
 * One placed base part: cached industrial geometry layers (REQ-035)
 * drawn with the shared surface material singletons, so placing parts
 * allocates no geometry, no materials, and no new shader programs.
 * Sealing parts fill their cell to +-0.5 and tile seamlessly with
 * neighbors; the durability-scaled motion assembly (spikes, turret
 * head) wilts toward its anchor as the part takes raid damage.
 */
function BasePartVisual({
  partId,
  durability,
  tier,
  detail,
}: {
  partId: BasePartId;
  durability: number;
  tier: SurfaceGeometryTier;
  detail: boolean;
}) {
  const model = bunkerPartGeometry(partId, tier);
  const maxDurability = BASE_PART_CATALOG[partId].durability;
  const wilt = Math.max(
    BASE_PART_MIN_WILT,
    Math.min(1, durability / maxDurability),
  );
  const material = (role: SurfaceMaterialRole) =>
    bunkerPartMaterial(role, BASE_PART_EMISSIVES[partId], detail);
  return (
    <group>
      {model.layers.map((layer) => (
        <mesh
          key={layer.role}
          geometry={layer.geometry}
          material={material(layer.role)}
          dispose={null}
        />
      ))}
      {model.motionLayers.length > 0 && (
        <group position={model.motionAnchor} scale={[1, wilt, 1]}>
          {model.motionLayers.map((layer) => (
            <mesh
              key={layer.role}
              geometry={layer.geometry}
              material={material(layer.role)}
              dispose={null}
            />
          ))}
        </group>
      )}
    </group>
  );
}

export function BunkerOverlay({
  preview,
  blockedCells,
  bunker,
  activeRaid,
  editingEnabled,
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
  editingEnabled?: boolean;
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
  // Resolved once per overlay render (not per part): the quality read
  // touches localStorage and matchMedia.
  const detail = useBlockDetail();
  const tier = resolveGraphicsQualityTier(
    readStoredGraphicsQuality(),
    hasCoarsePointer(),
  );
  const footprint = bunker?.footprint ?? preview;
  if (!footprint) return null;
  const canEditBunker = Boolean(bunker && (editingEnabled ?? !activeRaid));
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
    canEditBunker &&
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
    bunker &&
    canEditBunker &&
    buildMode === "move" &&
    onBunkerDragTarget &&
    onBunkerDragEnd ? (
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
            if (!canEditBunker) return;
            if (buildMode === "remove" && onBunkerCellTap) {
              onBunkerCellTap(partCell);
              return;
            }
            if (buildMode === "move") onBunkerPartTap?.(partCell);
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (!canEditBunker) return;
            if (buildMode === "move") onBunkerPartPointerDown?.(partCell);
          }}
        >
          {selected && (
            <SelectedSupportCellOutline col={part.col} row={part.row} />
          )}
          <BasePartVisual
            detail={detail}
            durability={part.durability}
            partId={part.partId}
            tier={tier}
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
          position={[cellX(pickup.col), -pickup.row, 1.48]}
          renderOrder={80}
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
