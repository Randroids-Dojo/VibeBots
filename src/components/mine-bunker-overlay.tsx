import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, Mesh } from "three/webgpu";
import {
  BASE_PART_CATALOG,
  type BasePartId,
  type BunkerFootprint,
  type BunkerRaidSnapshot,
  type BunkerSkinId,
  type BunkerState,
  DEFAULT_BUNKER_SKIN,
} from "@/sim/bunker";
import type { MineCoord } from "@/sim/mine";
import {
  animateClankerBody,
  ClankerBody,
  type ClankerParts,
  setGroupMaterialOpacity,
} from "./clanker-visual";
import {
  hasCoarsePointer,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";
import { useBlockDetail } from "./mine-block-render";
import { bunkerPartGeometry } from "./mine-bunker-part-geometry";
import { cellX } from "./mine-render-palette";
import {
  SelectedSupportCellOutline,
  SUPPORT_SELECT_RED,
} from "./mine-support-selection";
import type {
  SurfaceGeometryLayer,
  SurfaceGeometryTier,
} from "./mine-surface-geometry";
import {
  BASE_PART_EMISSIVES,
  bunkerPartMaterial,
} from "./mine-surface-materials";
import {
  CLANKER_BURST_VISIBLE_SECONDS,
  dissipatingOpacity,
  transientAnimationActive,
  transientAnimationProgress,
} from "./mine-transient-animation";

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
      <ClankerBody
        kind={clanker.kind}
        parts={partsRef.current}
        burstRef={burstRef}
      />
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
function partLayerMeshes(
  layers: readonly SurfaceGeometryLayer[],
  emissiveHex: string,
  detail: boolean,
  skin: BunkerSkinId,
) {
  return layers.map((layer) => (
    <mesh
      key={layer.role}
      geometry={layer.geometry}
      material={bunkerPartMaterial(layer.role, emissiveHex, detail, skin)}
      dispose={null}
    />
  ));
}

function BasePartVisual({
  partId,
  durability,
  tier,
  detail,
  skin = DEFAULT_BUNKER_SKIN,
}: {
  partId: BasePartId;
  durability: number;
  tier: SurfaceGeometryTier;
  detail: boolean;
  skin?: BunkerSkinId;
}) {
  const model = bunkerPartGeometry(partId, tier);
  const emissiveHex = BASE_PART_EMISSIVES[partId];
  return (
    <group>
      {partLayerMeshes(model.layers, emissiveHex, detail, skin)}
      {model.motionLayers.length > 0 && (
        <group
          position={model.motionAnchor}
          scale={[
            1,
            Math.max(
              BASE_PART_MIN_WILT,
              Math.min(1, durability / BASE_PART_CATALOG[partId].durability),
            ),
            1,
          ]}
        >
          {partLayerMeshes(model.motionLayers, emissiveHex, detail, skin)}
        </group>
      )}
    </group>
  );
}

/**
 * The flat mine view's bunker layer. Since the hammer flow retired
 * this is render-only: claim outline and preview, blocked claim cells,
 * placed tunnel-plane parts, the core, raid clankers, and XP pickups.
 * All editing happens in the first-person view.
 */
export function BunkerOverlay({
  preview,
  blockedCells,
  bunker,
  activeRaid,
}: {
  preview?: BunkerFootprint | null;
  blockedCells?: readonly MineCoord[];
  bunker?: BunkerState | null;
  activeRaid?: BunkerRaidSnapshot | null;
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
  // The flat mine view draws the tunnel plane only: parts placed on
  // deeper layers belong to the first-person view.
  const parts =
    bunker?.parts
      .filter((part) => (part.depth ?? 0) === 0)
      .map((part) => (
        <group
          key={`bunker-part:${part.col}:${part.row}`}
          position={[cellX(part.col), -part.row, 0.5]}
        >
          <BasePartVisual
            detail={detail}
            durability={part.durability}
            partId={part.partId}
            skin={bunker?.skin}
            tier={tier}
          />
        </group>
      )) ?? [];
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
      {parts}
      {clankers}
      {xpPickups}
    </>
  );
}

/** Width of the dressed surface camp strip around the origin. */
