import { RoundedBox } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import {
  BoxGeometry,
  type BufferGeometry,
  ConeGeometry,
  type Group,
  type Mesh,
  MeshStandardMaterial,
  type MeshStandardNodeMaterial,
} from "three/webgpu";
import {
  FALL_DELAY_ACTIONS,
  type MineBiomeId,
  type MineCell,
  type OreId,
} from "@/sim/mine";
import { isWebGPUBackend } from "./graphics-quality";
import {
  BOULDER_BLOCK_GEOMETRY,
  DIRT_BLOCK_GEOMETRY,
  METAL_BLOCK_GEOMETRY,
  ROCK_BLOCK_GEOMETRY,
} from "./mine-block-geometries";
import {
  blockDetailEnabled,
  boulderBlockMaterial,
  crystalMaterial,
  dirtBlockMaterial,
  gasBlockMaterial,
  getOrCreate,
  metalBlockMaterial,
  rockBlockMaterial,
} from "./mine-block-materials";
import {
  BOULDER_COLOR,
  biomeDirtColorAt,
  CACHE_COLOR,
  cellHash,
  cellX,
  GAS_COLOR,
  GLOWING_ORES,
  METAL_COLOR,
  ORE_COLORS,
  rockColorsForBiome,
  TEETER_EMISSIVE,
} from "./mine-render-palette";

/** Shader detail gate shared by every scene consumer: high quality tier
 * AND the live WebGPU backend. */
export function useBlockDetail(): boolean {
  return useThree((state) => blockDetailEnabled(isWebGPUBackend(state.gl)));
}

/** Scratch the shared resolver fills for MineBlockBody's mesh; reused
 * across renders (synchronous, non-reentrant) so posing a body allocates
 * nothing. Its geometry/material are written by instancedBlockBody before
 * any read, so they start undefined rather than seeding a real material. */
const bodyScratch: InstancedBlockBody = {
  geometry: undefined as unknown as BufferGeometry,
  material: undefined as unknown as MeshStandardNodeMaterial,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
};

/**
 * The solid body for a mine cell (F-046: one source of truth for the
 * mine canvas and the Holodeck). The dirt/ore/rock/metal bodies come from
 * the shared instancedBlockBody resolver, the same one the instanced grid
 * uses, so the React path and the instanced path can never drift; the
 * inline-material kinds (part-cache, gas, boulder) stay here. Materials are
 * shared TSL singletons, geometry is one per shape, so `dispose={null}`.
 */
export function MineBlockBody({
  cell,
  col,
  row,
  biome = "default",
}: {
  cell: MineCell;
  col: number;
  row: number;
  biome?: MineBiomeId;
}) {
  const detail = useBlockDetail();
  if (cell.kind === "part-cache") {
    return <CacheCrate col={col} row={row} />;
  }
  if (cell.kind === "gas") {
    return (
      <mesh
        geometry={DIRT_BLOCK_GEOMETRY}
        material={gasBlockMaterial(GAS_COLOR, detail)}
        dispose={null}
      />
    );
  }
  if (cell.kind === "boulder") {
    return (
      <mesh
        rotation={[0, cellHash(col, row, 29) * 3.1, 0]}
        geometry={BOULDER_BLOCK_GEOMETRY}
        material={boulderBlockMaterial(BOULDER_COLOR, detail)}
        dispose={null}
      />
    );
  }
  // Dirt, ore, rock, and metal share the resolver used by the instanced
  // grid; rotation is [0,0,0] for the axis-aligned bodies (identity).
  instancedBlockBody(cell, col, row, biome, detail, bodyScratch);
  const body = (
    <mesh
      rotation={[bodyScratch.rotX, bodyScratch.rotY, bodyScratch.rotZ]}
      geometry={bodyScratch.geometry}
      material={bodyScratch.material}
      dispose={null}
    />
  );
  if (cell.kind === "ore" && cell.ore) {
    return (
      <>
        {body}
        <OreCrystals
          col={col}
          row={row}
          color={ORE_COLORS[cell.ore]}
          glow={GLOWING_ORES.has(cell.ore)}
        />
      </>
    );
  }
  return body;
}

/** The geometry, shared material, and rotation for a cell whose solid
 * body is drawn by the instanced grid (mine-instanced-grid.ts). Written
 * into a caller-owned scratch object so classifying a cell allocates
 * nothing at input cadence. */
export interface InstancedBlockBody {
  geometry: BufferGeometry;
  material: MeshStandardNodeMaterial;
  rotX: number;
  rotY: number;
  rotZ: number;
}

/**
 * The single source of truth for a solid block's geometry, shared
 * material, and rotation: both the instanced grid and MineBlockBody's
 * React path fill `out` from here, so the two can never drift and stay
 * pixel-identical. Covers dirt, ore (the dirt base; crystals are overlaid
 * by the caller), non-fallen rock, and metal. Caller must have confirmed
 * instancedBlockDraw(cell), or (MineBlockBody) already handled the
 * inline-material kinds (part-cache, gas, boulder).
 */
export function instancedBlockBody(
  cell: MineCell,
  col: number,
  row: number,
  biome: MineBiomeId,
  detail: boolean,
  out: InstancedBlockBody,
): void {
  out.rotX = 0;
  out.rotY = 0;
  out.rotZ = 0;
  if (cell.kind === "rock") {
    const rockColors = rockColorsForBiome(biome);
    const tier = Math.min((cell.rockTier ?? 1) - 1, rockColors.length - 1);
    out.geometry = ROCK_BLOCK_GEOMETRY;
    out.material = rockBlockMaterial(rockColors[tier], detail);
    out.rotX = cellHash(col, row, 13) * 3.1;
    out.rotY = cellHash(col, row, 17) * 3.1;
    out.rotZ = cellHash(col, row, 19) * 3.1;
    return;
  }
  if (cell.kind === "metal") {
    out.geometry = METAL_BLOCK_GEOMETRY;
    out.material = metalBlockMaterial(METAL_COLOR, detail);
    return;
  }
  // Dirt and ore bodies: the shared beveled cube tinted by stratum/biome.
  out.geometry = DIRT_BLOCK_GEOMETRY;
  out.material = dirtBlockMaterial(biomeDirtColorAt(col, row), detail);
}

/** Fingerprint of the MineCell fields the cell visuals read: the shared
 * body above plus the mine canvas's per-cell overlays (bag, supports,
 * seeped gas, teeter countdown). The mine canvas caches cell elements on
 * this plus its view-layer inputs (F-075), so extend this whenever cell
 * JSX starts reading a new field. Damage (hp and oreRemaining against
 * the pick) and floor-drop piles are view-computed and appended by the
 * canvas itself. */
export function cellRenderSignature(cell: MineCell): string {
  return (
    `${cell.kind}|${cell.ore ?? ""}|${cell.rockTier ?? 0}|${cell.fallIn ?? -1}|` +
    `${cell.fallen ? 1 : 0}${cell.ladder ? 1 : 0}${cell.plank ? 1 : 0}` +
    `${cell.beacon ? 1 : 0}${cell.gasSeeped ? 1 : 0}${cell.bag ? 1 : 0}`
  );
}

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
    </>
  );
}

const DYNAMITE_RED = "#b43b32";
export const FUSE_GLOW = "#ffb347";
const DYNAMITE_WARNING = TEETER_EMISSIVE;
export function DynamiteCharge({ col, row }: { col: number; row: number }) {
  const bodyRef = useRef<Group>(null);
  const warningRef = useRef<Mesh>(null);
  const sparkRef = useRef<Mesh>(null);
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
    </group>
  );
}

export function crackSegmentCountForDamage(damage: number): number {
  const d = Math.max(0, Math.min(1, damage));
  return 3 + Math.floor(d * 6) + Math.floor(d * d * 7);
}

/** Crystals jutting from an ore cell, sized and angled per cell hash.
 * Glassy shared TSL material with fresnel rims; glowing tiers breathe. */
export function OreCrystals({
  col,
  row,
  color,
  glow,
  hint = false,
}: {
  col: number;
  row: number;
  color: string;
  glow: boolean;
  /** A vein still embedded in a wall (ore one cell behind the surface the
   * player faces), not an exposed cluster. Renders fewer crystals, smaller
   * and recessed into the face, so it reads as "ore in this block" rather
   * than a dug-out pocket wall. Off by default so 2D mine callers are
   * unchanged. */
  hint?: boolean;
}) {
  const detail = useBlockDetail();
  const material = crystalMaterial(color, glow, detail);
  const base = 3 + Math.floor(cellHash(col, row, 7) * 3);
  const count = hint ? Math.max(2, base - 1) : base;
  // A hint sits just under the surface (z 0.30 vs 0.42) at a reduced scale so
  // it looks embedded in the wall the player has yet to dig.
  const faceZ = hint ? 0.3 : 0.42;
  const scaleMul = hint ? 0.62 : 1;
  const crystals = [];
  for (let i = 0; i < count; i++) {
    const a = cellHash(col, row, 11 + i);
    const b = cellHash(col, row, 23 + i);
    const s = (0.08 + cellHash(col, row, 31 + i) * 0.11) * scaleMul;
    crystals.push(
      <mesh
        key={i}
        position={[(a - 0.5) * 0.56, (b - 0.5) * 0.56, faceZ]}
        rotation={[a * 2.2, b * 2.2, (a + b) * 1.8]}
        scale={[s, s * (1.5 + b * 0.7), s]}
        material={material}
        dispose={null}
      >
        <octahedronGeometry args={[1, 0]} />
      </mesh>,
    );
  }
  return <>{crystals}</>;
}

/** Actions-remaining until a block drops, mapped to teeter urgency. Clamps
 * to a 0.2 floor so a distant doom still trembles softly while an imminent
 * one shakes hard. Lives here with FallingRockShard so the shard glow set
 * has one home (the mine canvas imports it for the wobble too). */
export function teeterUrgency(fallIn: number): number {
  return Math.min(
    1,
    Math.max(0.2, (FALL_DELAY_ACTIONS - fallIn + 1) / FALL_DELAY_ACTIONS),
  );
}

/** A shard's emissive glow for a teeter urgency: bright while counting
 * down, dim once settled. One source for FallingRockShard and the warm-up. */
function shardGlow(urgency: number): number {
  return urgency > 0 ? 0.2 + 0.55 * urgency : 0.05;
}

// Shared shard geometry and materials so a teetering/fallen rock mounts
// allocation-free (dispose={null} is safe: geometry and material are both
// shared singletons). The glow caches stay bounded because teeterUrgency,
// hence glow, is discrete (fallIn is a small integer).
const SHARD_MAIN_GEOMETRY = new ConeGeometry(0.48, 0.92, 5);
const SHARD_SIDE_GEOMETRY = new ConeGeometry(0.18, 0.45, 4);
const SHARD_CHUNK_GEOMETRY = new BoxGeometry(0.18, 0.52, 0.2);
const SHARD_CHUNK_MATERIAL = new MeshStandardMaterial({
  color: "#4d3637",
  roughness: 0.86,
  flatShading: true,
});
const shardMainMaterials = new Map<number, MeshStandardMaterial>();
const shardSideMaterials = new Map<number, MeshStandardMaterial>();

/** One shared main-shard material per distinct glow (emissive intensity). */
function shardMainMaterial(glow: number): MeshStandardMaterial {
  return getOrCreate(
    shardMainMaterials,
    glow,
    () =>
      new MeshStandardMaterial({
        color: "#7d4a3c",
        emissive: TEETER_EMISSIVE,
        emissiveIntensity: glow,
        roughness: 0.72,
        metalness: 0.08,
        flatShading: true,
      }),
  );
}

/** One shared side-shard material per distinct glow (emissive intensity). */
function shardSideMaterial(glow: number): MeshStandardMaterial {
  return getOrCreate(
    shardSideMaterials,
    glow,
    () =>
      new MeshStandardMaterial({
        color: "#a45f43",
        emissive: TEETER_EMISSIVE,
        emissiveIntensity: glow,
        roughness: 0.7,
        flatShading: true,
      }),
  );
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
  const glow = shardGlow(urgency);
  return (
    <group rotation={[0.15, 0, tilt]}>
      <mesh
        position={[0, -0.02, 0]}
        scale={[0.9, 1.08, 0.72]}
        geometry={SHARD_MAIN_GEOMETRY}
        material={shardMainMaterial(glow)}
        dispose={null}
      />
      <mesh
        position={[-0.2, 0.2, 0.2]}
        rotation={[0.7, 0.4, -0.2]}
        geometry={SHARD_SIDE_GEOMETRY}
        material={shardSideMaterial(glow * 0.7)}
        dispose={null}
      />
      <mesh
        position={[0.22, -0.18, 0.24]}
        rotation={[-0.5, 0.2, 0.6]}
        geometry={SHARD_CHUNK_GEOMETRY}
        material={SHARD_CHUNK_MATERIAL}
        dispose={null}
      />
    </group>
  );
}

/** Every shard material the mine can show, for the load-time warm-up: the
 * chunk plus the main and side materials at each glow FallingRockShard uses
 * (settled, and across the discrete teeter countdown). Owns the glow
 * enumeration so the warm-up never re-derives the formula. */
export function collectShardMaterials(): MeshStandardMaterial[] {
  const glows = new Set<number>([shardGlow(0)]);
  for (let fallIn = 1; fallIn <= FALL_DELAY_ACTIONS + 1; fallIn++) {
    glows.add(shardGlow(teeterUrgency(fallIn)));
  }
  const materials: MeshStandardMaterial[] = [SHARD_CHUNK_MATERIAL];
  for (const glow of glows) {
    materials.push(shardMainMaterial(glow), shardSideMaterial(glow * 0.7));
  }
  return materials;
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
