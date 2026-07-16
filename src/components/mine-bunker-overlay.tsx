import {
  BASE_PART_CATALOG,
  type BasePartId,
  type BunkerFootprint,
  type BunkerSkinId,
  type BunkerState,
  DEFAULT_BUNKER_SKIN,
} from "@/sim/bunker";
import type { MineCoord } from "@/sim/mine";
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
 * and placed tunnel-plane parts. All editing happens in the
 * first-person view.
 */
export function BunkerOverlay({
  preview,
  blockedCells,
  bunker,
}: {
  preview?: BunkerFootprint | null;
  blockedCells?: readonly MineCoord[];
  bunker?: BunkerState | null;
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
  return (
    <>
      {lines}
      {blocked}
      {parts}
    </>
  );
}

/** Width of the dressed surface camp strip around the origin. */
