import { RoundedBox } from "@react-three/drei";
import { memo, useMemo } from "react";
import {
  biomeAt,
  findPortalBeacons,
  type MineState,
  START_COL,
} from "@/sim/mine";
import { useBlockDetail } from "./mine-block-render";
import { DESTINATIONS, type DestinationDef } from "./mine-destinations";
import {
  cellHash,
  cellX,
  surfaceColorForBiome,
  surfaceTrimColorForBiome,
  variedColor,
} from "./mine-render-palette";
import { STALLS, type StallDef } from "./mine-stalls";
import {
  surfaceMetal,
  surfaceStone,
  surfaceTimber,
} from "./mine-surface-materials";

export const CAMP_WIDTH = 60;

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
  const tiles = [];
  for (let col = firstCol - 1; col <= lastCol + 1; col++) {
    const biome = biomeAt(col);
    const x = cellX(col);
    tiles.push(
      <group key={col} position={[x, 0, -0.36]}>
        <mesh position={[0, -0.47, 0]}>
          <boxGeometry args={[1.02, 0.08, 0.9]} />
          <meshStandardMaterial
            color={variedColor(surfaceColorForBiome(biome), col, 0)}
            roughness={biome === "highTech" ? 0.45 : 1}
            metalness={biome === "highTech" ? 0.45 : 0}
            flatShading
          />
        </mesh>
        <mesh position={[0, -0.4, 0.1]}>
          <boxGeometry args={[0.94, 0.045, 0.34]} />
          <meshStandardMaterial
            color={surfaceTrimColorForBiome(biome)}
            roughness={0.9}
            metalness={biome === "highTech" ? 0.3 : 0}
            emissive={biome === "highTech" ? "#0b4a36" : "#000000"}
            emissiveIntensity={biome === "highTech" ? 0.25 : 0}
            flatShading
          />
        </mesh>
        {biome === "default" && Math.abs(col - 0.5) > 8 && (
          <mesh
            position={[
              (cellHash(col, 11, 2) - 0.5) * 0.46,
              -0.32,
              (cellHash(col, 13, 2) - 0.5) * 0.4,
            ]}
            rotation={[0, cellHash(col, 17, 2) * 3, 0]}
          >
            <coneGeometry args={[0.055, 0.16, 5]} />
            <meshStandardMaterial color="#4f7a4a" roughness={1} flatShading />
          </mesh>
        )}
      </group>,
    );
  }
  const portals = findPortalBeacons(mine).filter(
    (portal) => portal.col >= firstCol - 2 && portal.col <= lastCol + 2,
  );
  return (
    <group>
      {tiles}
      {portals.map((portal) => (
        <group key={portal.id} position={[cellX(portal.col), -0.14, 0.55]}>
          <PortalBeaconModel color={portal.color} active={portal.active} />
        </group>
      ))}
    </group>
  );
}

const TIMBER = "#5a4632";
const TIMBER_DARK = "#3a2c1e";
const WOOD_POST = "#4a3424";
const STONE = "#6e7078";
const STONE_LIGHT = "#9a9dab";
const METAL = "#8a8f9c";

/** Emissive name board; brightens while the stall menu is open. */
function SignBoard({
  color,
  position,
  width = 0.78,
}: {
  color: string;
  position: [number, number, number];
  width?: number;
}) {
  return (
    <mesh position={position}>
      <boxGeometry args={[width, 0.2, 0.06]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.95}
        flatShading
      />
    </mesh>
  );
}

/** Doorway recess with a warm glow while the shop is open. */
function DoorGlow({
  position,
  size = [0.4, 0.62],
}: {
  position: [number, number, number];
  size?: [number, number];
}) {
  return (
    <mesh position={position}>
      <boxGeometry args={[size[0], size[1], 0.05]} />
      <meshStandardMaterial
        color="#2e2410"
        emissive="#ffd9a0"
        emissiveIntensity={0.3}
        roughness={1}
        flatShading
      />
    </mesh>
  );
}

/** Warm porch lamp marking a doorway at night. */
function PorchLamp({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position}>
      <icosahedronGeometry args={[0.07, 0]} />
      <meshStandardMaterial
        color="#ffe9a8"
        emissive="#ffd9a0"
        emissiveIntensity={1.8}
        flatShading
      />
    </mesh>
  );
}

/** Elevator: timber derrick with a sheave wheel over a drum cabin. */
function ElevatorModel({ color }: { color: string }) {
  const detail = useBlockDetail();
  return (
    <>
      <RoundedBox
        args={[1.3, 0.85, 0.85]}
        radius={0.05}
        smoothness={2}
        position={[0, 1.48, 0]}
      >
        <primitive object={surfaceTimber(TIMBER, detail)} attach="material" />
      </RoundedBox>
      <DoorGlow position={[0.3, 1.4, 0.41]} />
      <PorchLamp position={[0.62, 1.78, 0.4]} />
      {/* Derrick legs and cross-braces rising off the cabin roof */}
      <mesh position={[-0.46, 2.55, 0]} rotation={[0, 0, 0.16]}>
        <boxGeometry args={[0.12, 1.6, 0.12]} />
        <primitive
          object={surfaceTimber(WOOD_POST, detail)}
          attach="material"
        />
      </mesh>
      <mesh position={[0.46, 2.55, 0]} rotation={[0, 0, -0.16]}>
        <boxGeometry args={[0.12, 1.6, 0.12]} />
        <primitive
          object={surfaceTimber(WOOD_POST, detail)}
          attach="material"
        />
      </mesh>
      <mesh position={[0, 2.32, 0]} rotation={[0, 0, 0.55]}>
        <boxGeometry args={[0.95, 0.07, 0.07]} />
        <primitive
          object={surfaceTimber(TIMBER_DARK, detail)}
          attach="material"
        />
      </mesh>
      <mesh position={[0, 2.32, 0]} rotation={[0, 0, -0.55]}>
        <boxGeometry args={[0.95, 0.07, 0.07]} />
        <primitive
          object={surfaceTimber(TIMBER_DARK, detail)}
          attach="material"
        />
      </mesh>
      {/* Crown platform, pulley wheel, cable, and the cable drum */}
      <mesh position={[0, 3.36, 0]}>
        <boxGeometry args={[0.74, 0.1, 0.4]} />
        <primitive
          object={surfaceTimber(TIMBER_DARK, detail)}
          attach="material"
        />
      </mesh>
      <mesh position={[0, 3.6, 0]}>
        <torusGeometry args={[0.26, 0.05, 8, 18]} />
        <meshStandardMaterial
          color={METAL}
          metalness={0.5}
          roughness={0.4}
          flatShading
        />
      </mesh>
      <mesh position={[0, 3.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.14, 8]} />
        <meshStandardMaterial color="#3a3f4d" flatShading />
      </mesh>
      <mesh position={[0, 2.8, 0]}>
        <boxGeometry args={[0.03, 1.6, 0.03]} />
        <meshStandardMaterial color="#23262f" flatShading />
      </mesh>
      <mesh position={[0, 2.0, 0.18]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.16, 0.16, 0.5, 10]} />
        <meshStandardMaterial color="#6b4a2a" roughness={0.7} flatShading />
      </mesh>
      {/* Beacon lamp so the tallest silhouette reads at night */}
      <mesh position={[0, 3.78, 0]}>
        <icosahedronGeometry args={[0.06, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.8}
          flatShading
        />
      </mesh>
      <SignBoard color={color} position={[-0.3, 1.78, 0.44]} width={0.6} />
    </>
  );
}

/** Hardware Store: a stone shop with columns and a gold emblem. */
function HardwareStoreModel({ color }: { color: string }) {
  const detail = useBlockDetail();
  return (
    <>
      <RoundedBox
        args={[1.5, 1.15, 0.9]}
        radius={0.04}
        smoothness={2}
        position={[0, 1.62, 0]}
      >
        <primitive object={surfaceStone(STONE, detail)} attach="material" />
      </RoundedBox>
      {/* Cornice and pediment */}
      <mesh position={[0, 2.26, 0]}>
        <boxGeometry args={[1.66, 0.14, 1.0]} />
        <primitive
          object={surfaceStone(STONE_LIGHT, detail)}
          attach="material"
        />
      </mesh>
      <mesh
        position={[0, 2.45, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[1, 1, 0.55]}
      >
        <cylinderGeometry args={[0.62, 0.62, 0.7, 3, 1, false, Math.PI]} />
        <primitive
          object={surfaceStone(STONE_LIGHT, detail)}
          attach="material"
        />
      </mesh>
      {/* Gold emblem on the pediment face */}
      <mesh position={[0, 2.45, 0.4]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 0.05, 12]} />
        <meshStandardMaterial
          color="#f5c542"
          emissive="#f5c542"
          emissiveIntensity={0.7}
          metalness={0.5}
          roughness={0.3}
          flatShading
        />
      </mesh>
      {/* Portico: columns and architrave around the door */}
      <mesh position={[-0.4, 1.56, 0.42]}>
        <cylinderGeometry args={[0.085, 0.1, 0.92, 8]} />
        <primitive
          object={surfaceStone(STONE_LIGHT, detail)}
          attach="material"
        />
      </mesh>
      <mesh position={[0.4, 1.56, 0.42]}>
        <cylinderGeometry args={[0.085, 0.1, 0.92, 8]} />
        <primitive
          object={surfaceStone(STONE_LIGHT, detail)}
          attach="material"
        />
      </mesh>
      <mesh position={[0, 2.08, 0.42]}>
        <boxGeometry args={[1.06, 0.12, 0.2]} />
        <primitive
          object={surfaceStone(STONE_LIGHT, detail)}
          attach="material"
        />
      </mesh>
      <DoorGlow position={[0, 1.42, 0.47]} size={[0.44, 0.68]} />
      <PorchLamp position={[0, 1.9, 0.52]} />
      {/* Lit side windows */}
      <mesh position={[-0.58, 1.75, 0.46]}>
        <boxGeometry args={[0.22, 0.28, 0.04]} />
        <meshStandardMaterial
          color="#2a1c0c"
          emissive="#ffd9a0"
          emissiveIntensity={0.4}
          flatShading
        />
      </mesh>
      <mesh position={[0.58, 1.75, 0.46]}>
        <boxGeometry args={[0.22, 0.28, 0.04]} />
        <meshStandardMaterial
          color="#2a1c0c"
          emissive="#ffd9a0"
          emissiveIntensity={0.4}
          flatShading
        />
      </mesh>
      {/* Entry steps down to the boardwalk */}
      <mesh position={[0, 1.1, 0.6]}>
        <boxGeometry args={[0.86, 0.09, 0.46]} />
        <primitive object={surfaceStone(STONE, detail)} attach="material" />
      </mesh>
      <mesh position={[0, 1.19, 0.52]}>
        <boxGeometry args={[0.64, 0.09, 0.3]} />
        <primitive object={surfaceStone(STONE, detail)} attach="material" />
      </mesh>
      <SignBoard color={color} position={[0, 2.26, 0.55]} width={0.8} />
    </>
  );
}

/** Supply Depot: open-front trade post with goods on the counter. */
function SupplyDepotModel({ color }: { color: string }) {
  const detail = useBlockDetail();
  return (
    <>
      <RoundedBox
        args={[1.55, 1.0, 0.9]}
        radius={0.05}
        smoothness={2}
        position={[0, 1.55, 0]}
      >
        <primitive object={surfaceTimber(TIMBER, detail)} attach="material" />
      </RoundedBox>
      <mesh position={[0, 2.1, 0]} rotation={[0, 0, 0.05]}>
        <boxGeometry args={[1.75, 0.08, 1.0]} />
        <meshStandardMaterial
          color={TIMBER_DARK}
          roughness={0.95}
          flatShading
        />
      </mesh>
      {/* Open shopfront: dark interior warmed by lamplight when open */}
      <mesh position={[0, 1.5, 0.43]}>
        <boxGeometry args={[1.05, 0.58, 0.05]} />
        <meshStandardMaterial
          color="#171209"
          emissive="#ffd9a0"
          emissiveIntensity={0.22}
          roughness={1}
          flatShading
        />
      </mesh>
      <mesh position={[0, 1.24, 0.5]}>
        <boxGeometry args={[1.05, 0.08, 0.18]} />
        <primitive
          object={surfaceTimber(WOOD_POST, detail)}
          attach="material"
        />
      </mesh>
      {/* Counter goods: dynamite, rope coil, crate */}
      <mesh position={[-0.3, 1.37, 0.48]}>
        <cylinderGeometry args={[0.045, 0.045, 0.16, 6]} />
        <meshStandardMaterial color="#ff6b6b" roughness={0.6} flatShading />
      </mesh>
      <mesh position={[0, 1.31, 0.48]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.07, 0.03, 6, 10]} />
        <meshStandardMaterial color="#c9a86a" roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0.3, 1.35, 0.48]}>
        <boxGeometry args={[0.16, 0.12, 0.12]} />
        <meshStandardMaterial color="#f5c542" roughness={0.7} flatShading />
      </mesh>
      {/* Canvas awning over the counter */}
      <mesh position={[0, 1.95, 0.58]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[1.45, 0.05, 0.5]} />
        <meshStandardMaterial color="#d97f2e" roughness={0.95} flatShading />
      </mesh>
      <PorchLamp position={[0, 1.74, 0.62]} />
      <mesh position={[-0.62, 1.42, 0.66]}>
        <cylinderGeometry args={[0.03, 0.03, 0.75, 6]} />
        <primitive
          object={surfaceTimber(WOOD_POST, detail)}
          attach="material"
        />
      </mesh>
      <mesh position={[0.62, 1.42, 0.66]}>
        <cylinderGeometry args={[0.03, 0.03, 0.75, 6]} />
        <primitive
          object={surfaceTimber(WOOD_POST, detail)}
          attach="material"
        />
      </mesh>
      {/* Stock spilling out beside the shopfront */}
      <RoundedBox
        args={[0.3, 0.3, 0.3]}
        radius={0.03}
        smoothness={2}
        position={[-0.95, 1.2, 0.25]}
      >
        <primitive object={surfaceTimber(TIMBER, detail)} attach="material" />
      </RoundedBox>
      <mesh position={[0.95, 1.2, 0.25]}>
        <cylinderGeometry args={[0.14, 0.17, 0.3, 9]} />
        <meshStandardMaterial color="#7a5230" roughness={0.85} flatShading />
      </mesh>
      <SignBoard color={color} position={[0, 2.28, 0.2]} width={0.9} />
    </>
  );
}

/** Upgrades: a smithy with a glowing forge window and chimney. */
function UpgradesModel({ color }: { color: string }) {
  const detail = useBlockDetail();
  return (
    <>
      <RoundedBox
        args={[1.35, 0.95, 0.9]}
        radius={0.05}
        smoothness={2}
        position={[0, 1.5, 0]}
      >
        <meshStandardMaterial color="#5c5045" roughness={0.9} flatShading />
      </RoundedBox>
      <mesh position={[0, 2.1, 0]} rotation={[0, 0, 0.18]}>
        <boxGeometry args={[1.6, 0.08, 1.0]} />
        <meshStandardMaterial color="#2f2620" roughness={0.95} flatShading />
      </mesh>
      {/* Chimney with embers on the high side of the shed roof */}
      <mesh position={[-0.42, 2.5, -0.05]}>
        <boxGeometry args={[0.22, 0.8, 0.22]} />
        <primitive object={surfaceStone(STONE, detail)} attach="material" />
      </mesh>
      <mesh position={[-0.42, 2.92, -0.05]}>
        <boxGeometry args={[0.15, 0.05, 0.15]} />
        <meshStandardMaterial
          color="#33150a"
          emissive="#ff7a3c"
          emissiveIntensity={1.5}
          flatShading
        />
      </mesh>
      <DoorGlow position={[0.28, 1.36, 0.44]} />
      <PorchLamp position={[0.55, 1.7, 0.46]} />
      {/* Forge window: always glowing, the smith never sleeps */}
      <mesh position={[-0.32, 1.6, 0.46]}>
        <boxGeometry args={[0.32, 0.28, 0.04]} />
        <meshStandardMaterial
          color="#331b08"
          emissive="#ffb066"
          emissiveIntensity={0.9}
          flatShading
        />
      </mesh>
      {/* Anvil out front */}
      <mesh position={[0.82, 1.13, 0.28]}>
        <boxGeometry args={[0.16, 0.14, 0.14]} />
        <meshStandardMaterial color="#3a3f4d" roughness={0.6} flatShading />
      </mesh>
      <mesh position={[0.82, 1.25, 0.28]}>
        <boxGeometry args={[0.3, 0.09, 0.11]} />
        <meshStandardMaterial
          color={METAL}
          metalness={0.6}
          roughness={0.3}
          flatShading
        />
      </mesh>
      {/* Pick leaning on the wall */}
      <mesh position={[-0.78, 1.27, 0.3]} rotation={[0, 0, 0.35]}>
        <cylinderGeometry args={[0.018, 0.018, 0.42, 6]} />
        <meshStandardMaterial color="#6b4a2a" roughness={0.9} flatShading />
      </mesh>
      <mesh position={[-0.84, 1.47, 0.3]} rotation={[0, 0, 0.85]}>
        <boxGeometry args={[0.16, 0.04, 0.04]} />
        <meshStandardMaterial
          color={METAL}
          metalness={0.6}
          roughness={0.3}
          flatShading
        />
      </mesh>
      <SignBoard color={color} position={[0, 1.92, 0.5]} width={0.7} />
    </>
  );
}

/** Warp Pad: a humming arch and crystal, nothing like the timber row. */
function WarpPadModel({ color }: { color: string }) {
  return (
    <>
      <mesh position={[0, 1.12, 0]} scale={[1, 1, 0.62]}>
        <cylinderGeometry args={[0.8, 0.9, 0.18, 10]} />
        <meshStandardMaterial
          color="#3a3050"
          metalness={0.3}
          roughness={0.6}
          flatShading
        />
      </mesh>
      <mesh position={[0, 2.0, 0]}>
        <torusGeometry args={[0.55, 0.055, 10, 28]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.7}
          metalness={0.3}
          roughness={0.4}
          flatShading
        />
      </mesh>
      <mesh position={[0, 2.0, 0]} scale={[1, 1.5, 1]}>
        <octahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={2.0}
          flatShading
        />
      </mesh>
      {/* Emitter pylons flanking the arch */}
      <mesh position={[-0.85, 1.55, 0]}>
        <boxGeometry args={[0.15, 0.85, 0.15]} />
        <meshStandardMaterial color="#473a5e" roughness={0.7} flatShading />
      </mesh>
      <mesh position={[0.85, 1.55, 0]}>
        <boxGeometry args={[0.15, 0.85, 0.15]} />
        <meshStandardMaterial color="#473a5e" roughness={0.7} flatShading />
      </mesh>
      <mesh position={[-0.85, 2.02, 0]}>
        <icosahedronGeometry args={[0.07, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.8}
          flatShading
        />
      </mesh>
      <mesh position={[0.85, 2.02, 0]}>
        <icosahedronGeometry args={[0.07, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.8}
          flatShading
        />
      </mesh>
      {/* Power conduit and control console */}
      <mesh position={[0, 1.2, 0.12]}>
        <boxGeometry args={[1.55, 0.05, 0.05]} />
        <meshStandardMaterial
          color="#1c1626"
          emissive={color}
          emissiveIntensity={0.5}
          flatShading
        />
      </mesh>
      <mesh position={[0.55, 1.32, 0.3]}>
        <boxGeometry args={[0.2, 0.32, 0.16]} />
        <meshStandardMaterial color="#23262f" roughness={0.6} flatShading />
      </mesh>
      <mesh position={[0.55, 1.42, 0.39]}>
        <boxGeometry args={[0.14, 0.1, 0.02]} />
        <meshStandardMaterial
          color="#0d2b26"
          emissive="#7df9ff"
          emissiveIntensity={1.2}
          flatShading
        />
      </mesh>
    </>
  );
}

/** A village stall: each shop gets its own distinct structure. The
 * village is static (the tap-to-open prompt signals the active shop),
 * so the memoized SurfaceDressing never reconciles while walking. */
function StallBuilding({
  id,
  x,
  color,
}: {
  id: StallDef["id"];
  x: number;
  color: string;
}) {
  return (
    <group position={[x, -1.5, -0.85]}>
      {id === "elevator" && <ElevatorModel color={color} />}
      {id === "buyer" && <HardwareStoreModel color={color} />}
      {id === "supply" && <SupplyDepotModel color={color} />}
      {id === "upgrades" && <UpgradesModel color={color} />}
      {id === "warp" && <WarpPadModel color={color} />}
      {/* Doorstep mat on the boardwalk marks the standing spot */}
      <mesh position={[0, 1.1, 0.9]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.8, 0.5]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.26}
          transparent
          opacity={0.55}
        />
      </mesh>
    </group>
  );
}

/** Workshop: a tin-roofed garage with a roll-up door and a lit bench. */
function WorkshopModel({ color }: { color: string }) {
  return (
    <>
      <RoundedBox
        args={[1.6, 1.2, 0.95]}
        radius={0.05}
        smoothness={2}
        position={[0, 1.6, 0]}
      >
        <meshStandardMaterial
          color={METAL}
          roughness={0.7}
          metalness={0.3}
          flatShading
        />
      </RoundedBox>
      {/* Corrugated roof cap */}
      <mesh position={[0, 2.28, 0]}>
        <boxGeometry args={[1.78, 0.12, 1.05]} />
        <meshStandardMaterial
          color={STONE}
          roughness={0.6}
          metalness={0.4}
          flatShading
        />
      </mesh>
      {/* Roll-up door with a warm interior glow */}
      <mesh position={[0, 1.34, 0.49]}>
        <boxGeometry args={[1.0, 0.86, 0.05]} />
        <meshStandardMaterial
          color="#2a2f3a"
          emissive="#7df9ff"
          emissiveIntensity={0.18}
          roughness={0.8}
          flatShading
        />
      </mesh>
      {[-0.24, -0.04, 0.16].map((dy) => (
        <mesh key={dy} position={[0, 1.34 + dy, 0.52]}>
          <boxGeometry args={[1.0, 0.03, 0.02]} />
          <meshStandardMaterial color="#1a1e27" flatShading />
        </mesh>
      ))}
      {/* Lit side window */}
      <mesh position={[0.62, 1.72, 0.4]}>
        <boxGeometry args={[0.26, 0.24, 0.04]} />
        <meshStandardMaterial
          color="#0d2b26"
          emissive="#7df9ff"
          emissiveIntensity={1.1}
          flatShading
        />
      </mesh>
      {/* A big gear bolted to the facade */}
      <mesh position={[-0.6, 1.8, 0.46]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.16, 0.05, 6, 10]} />
        <meshStandardMaterial
          color={color}
          metalness={0.5}
          roughness={0.5}
          flatShading
        />
      </mesh>
      <PorchLamp position={[0, 1.86, 0.6]} />
      <SignBoard color={color} position={[0, 2.5, 0.3]} width={0.95} />
    </>
  );
}

/** Battles: a small colosseum drum with banners over a lit floor. */
function BattlesModel({ color }: { color: string }) {
  const detail = useBlockDetail();
  return (
    <>
      <mesh position={[0, 1.5, 0]}>
        <cylinderGeometry args={[0.85, 0.92, 1.0, 16]} />
        <primitive object={surfaceStone(STONE, detail)} attach="material" />
      </mesh>
      {/* Rim */}
      <mesh position={[0, 2.02, 0]}>
        <torusGeometry args={[0.86, 0.08, 8, 18]} />
        <primitive
          object={surfaceStone(STONE_LIGHT, detail)}
          attach="material"
        />
      </mesh>
      {/* Glowing arched entrance */}
      <mesh position={[0, 1.34, 0.88]}>
        <boxGeometry args={[0.44, 0.62, 0.1]} />
        <meshStandardMaterial
          color="#160b06"
          emissive="#ff8f3a"
          emissiveIntensity={0.5}
          roughness={1}
          flatShading
        />
      </mesh>
      {/* Crossed swords over the door */}
      {[0.6, -0.6].map((r) => (
        <mesh key={r} position={[0, 1.96, 0.9]} rotation={[0, 0, r]}>
          <boxGeometry args={[0.05, 0.4, 0.03]} />
          <meshStandardMaterial
            color={STONE_LIGHT}
            metalness={0.6}
            roughness={0.4}
            flatShading
          />
        </mesh>
      ))}
      {/* Banner flags */}
      {[-0.72, 0.72].map((x) => (
        <group key={x} position={[x, 2.0, 0.25]}>
          <mesh position={[0, 0.28, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.8, 6]} />
            <meshStandardMaterial
              color={WOOD_POST}
              roughness={0.9}
              flatShading
            />
          </mesh>
          <mesh position={[x < 0 ? 0.13 : -0.13, 0.5, 0]}>
            <boxGeometry args={[0.24, 0.16, 0.02]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.6}
              flatShading
            />
          </mesh>
        </group>
      ))}
      <PorchLamp position={[0, 1.6, 0.95]} />
      <SignBoard color={color} position={[0, 2.52, 0.4]} width={0.95} />
    </>
  );
}

/** A destination building: walking onto its column shows an Enter prompt
 * that routes to another screen, instead of opening a stall sheet. */
function DestinationBuilding({
  id,
  x,
  color,
}: {
  id: DestinationDef["id"];
  x: number;
  color: string;
}) {
  return (
    <group position={[x, -1.5, -0.85]}>
      {id === "workshop" && <WorkshopModel color={color} />}
      {id === "battles" && <BattlesModel color={color} />}
      {/* Doorstep mat on the boardwalk marks the standing spot */}
      <mesh position={[0, 1.1, 0.9]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.8, 0.5]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.26}
          transparent
          opacity={0.55}
        />
      </mesh>
    </group>
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
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.05} color="#cfe0ff" fog={false} />
    </points>
  );
}

/**
 * Night-camp surface dressing: headframe, lanterns, grass, stalls.
 * Memoized with no props, so it renders once and never reconciles on a
 * move tick. The per-step rebuild of this tree (heavier since the
 * detailed buildings landed) was the surface walk-by stutter.
 */
/** Small prop clusters set between the stalls: a stacked crate pair, a
 * barrel, and a grain sack, hash-varied per slot so no two clusters sit
 * identically. Shares the structural TSL materials. */
function VillageProps({ x, seed }: { x: number; seed: number }) {
  const detail = useBlockDetail();
  const a = cellHash(seed, 71, 3);
  const b = cellHash(seed, 73, 9);
  const spin = a * 1.2 - 0.6;
  return (
    <group position={[x, -1.5, -0.15 - b * 0.35]}>
      {/* Crate pair, the top one skewed */}
      <mesh position={[0, 1.11, 0]} rotation={[0, spin, 0]}>
        <boxGeometry args={[0.26, 0.22, 0.26]} />
        <primitive object={surfaceTimber(TIMBER, detail)} attach="material" />
      </mesh>
      <mesh position={[0.04, 1.32, 0.02]} rotation={[0, spin + 0.5, 0]}>
        <boxGeometry args={[0.2, 0.18, 0.2]} />
        <primitive
          object={surfaceTimber(WOOD_POST, detail)}
          attach="material"
        />
      </mesh>
      {/* Barrel with metal hoops */}
      <mesh position={[0.34, 1.14, 0.1]}>
        <cylinderGeometry args={[0.11, 0.13, 0.28, 9]} />
        <primitive
          object={surfaceTimber(TIMBER_DARK, detail)}
          attach="material"
        />
      </mesh>
      <mesh position={[0.34, 1.2, 0.1]}>
        <cylinderGeometry args={[0.125, 0.125, 0.03, 9]} />
        <primitive object={surfaceMetal(METAL, detail)} attach="material" />
      </mesh>
      {/* Grain sack slumped against the crates */}
      <mesh position={[-0.26, 1.08, 0.08]} scale={[1, 0.78, 0.9]}>
        <sphereGeometry args={[0.13, 8, 6]} />
        <meshStandardMaterial color="#a68b5f" roughness={0.95} flatShading />
      </mesh>
    </group>
  );
}

export const SurfaceDressing = memo(function SurfaceDressing() {
  const tufts = [];
  for (let i = 0; i < 14; i++) {
    const h = cellHash(i, 97, 3);
    const x = (h - 0.5) * 30;
    // Keep grass off the boardwalk and the village frontage.
    if (Math.abs(x - 0.5) < 7.6) continue;
    tufts.push(
      <mesh
        key={i}
        position={[x, -0.44, (cellHash(i, 89, 7) - 0.5) * 0.5 - 0.2]}
        rotation={[0, h * 3, 0]}
      >
        <coneGeometry args={[0.07, 0.16 + h * 0.12, 5]} />
        <meshStandardMaterial color="#4f7a4a" roughness={1} flatShading />
      </mesh>,
    );
  }
  const frameX = cellX(START_COL);
  return (
    <group
      onUpdate={(group) => {
        // The village both throws and catches the sun's shadows (G1).
        // Applied by traversal: the dressing is a memoized static tree,
        // so this runs once instead of prop-plumbing every mesh.
        group.traverse((child) => {
          child.castShadow = true;
          child.receiveShadow = true;
        });
      }}
    >
      {/* Night sky over the camp */}
      <NightStars />
      {/* Grassy lip along the ground line the miner walks on */}
      <mesh position={[0, -0.47, -0.3]}>
        <boxGeometry args={[CAMP_WIDTH, 0.07, 0.9]} />
        <meshStandardMaterial color="#3d5c3a" roughness={1} flatShading />
      </mesh>
      {tufts}
      {/* Boardwalk fronting the shop row, split around the shaft mouth.
          Each plank reaches the edge-of-town destination buildings. */}
      <mesh position={[-4.1, -0.44, -0.05]}>
        <boxGeometry args={[7.0, 0.05, 0.7]} />
        <meshStandardMaterial color="#6b5638" roughness={0.95} flatShading />
      </mesh>
      <mesh position={[4.6, -0.44, -0.05]}>
        <boxGeometry args={[8.0, 0.05, 0.7]} />
        <meshStandardMaterial color="#6b5638" roughness={0.95} flatShading />
      </mesh>
      {/* Headframe straddling the starting shaft */}
      <group position={[frameX, -1.5, 0]}>
        <mesh position={[-0.62, 1.62, 0]} rotation={[0, 0, 0.32]}>
          <boxGeometry args={[0.1, 1.5, 0.1]} />
          <meshStandardMaterial color="#4a3424" roughness={0.9} flatShading />
        </mesh>
        <mesh position={[0.62, 1.62, 0]} rotation={[0, 0, -0.32]}>
          <boxGeometry args={[0.1, 1.5, 0.1]} />
          <meshStandardMaterial color="#4a3424" roughness={0.9} flatShading />
        </mesh>
        <mesh position={[0, 2.3, 0]}>
          <torusGeometry args={[0.22, 0.05, 8, 14]} />
          <meshStandardMaterial
            color="#8a4f2d"
            metalness={0.4}
            roughness={0.5}
            flatShading
          />
        </mesh>
        <mesh position={[0, 1.66, 0]}>
          <boxGeometry args={[0.025, 1.3, 0.025]} />
          <meshStandardMaterial color="#23262f" flatShading />
        </mesh>
      </group>
      {/* The village stalls (REQ-021) */}
      {STALLS.map((stall) => (
        <StallBuilding
          key={stall.id}
          id={stall.id}
          x={cellX(stall.col)}
          color={stall.color}
        />
      ))}
      {/* Ground clutter between the stalls: crates, barrels, and sacks
          give the frontage depth (W2). Explicit per-slot offsets keep
          neighboring clusters from colliding in the tight gaps. */}
      {STALLS.map((stall, index) => (
        <VillageProps
          key={`props:${stall.id}`}
          x={cellX(stall.col) + [-1.0, 1.0, -1.05, 1.0, 1.1][index]}
          seed={index}
        />
      ))}
      {/* Enter-a-screen destination buildings (Workshop, Battles) */}
      {DESTINATIONS.map((dest) => (
        <DestinationBuilding
          key={dest.id}
          id={dest.id}
          x={cellX(dest.col)}
          color={dest.color}
        />
      ))}
      {/* Lantern posts flanking the headframe */}
      {[-1.3, 1.3].map((x) => (
        <group key={x} position={[x, -1.5, 0.3]}>
          <mesh position={[0, 1.45, 0]}>
            <boxGeometry args={[0.07, 0.95, 0.07]} />
            <meshStandardMaterial color="#4a3424" roughness={0.9} flatShading />
          </mesh>
          <mesh position={[0, 1.95, 0]}>
            <icosahedronGeometry args={[0.12, 0]} />
            <meshStandardMaterial
              color="#ffe9a8"
              emissive="#ffd9a0"
              emissiveIntensity={1.8}
              flatShading
            />
          </mesh>
        </group>
      ))}
    </group>
  );
});
