import type { CollectTarget } from "@/sim/mine";
import { cellX } from "./mine-render-palette";

export const SUPPORT_SELECT_RED = "#ff3b30";

const BOX = 1.1;
const BAR = 0.065;
/** The four sides of the one selection box, sized once at module load. */
const SELECTION_BARS = [
  { position: [0, BOX / 2, 0], args: [BOX, BAR, BAR] },
  { position: [0, -BOX / 2, 0], args: [BOX, BAR, BAR] },
  { position: [-BOX / 2, 0, 0], args: [BAR, BOX, BAR] },
  { position: [BOX / 2, 0, 0], args: [BAR, BOX, BAR] },
] as const;

// The one highlight a selected cell gets, whatever mix of supports stands
// in it. It draws over everything so the selection reads at any depth.
export function SelectedSupportCellOutline({
  col,
  row,
}: {
  col: number;
  row: number;
}) {
  return (
    <group position={[cellX(col), -row, 1.02]}>
      {SELECTION_BARS.map(({ position, args }) => (
        <mesh key={position.join(":")} position={position} renderOrder={20}>
          <boxGeometry args={args} />
          <meshBasicMaterial
            color={SUPPORT_SELECT_RED}
            toneMapped={false}
            depthWrite={false}
            depthTest={false}
          />
        </mesh>
      ))}
    </group>
  );
}

export function SupportCellHitTarget({
  target,
  onToggleSupport,
}: {
  target: CollectTarget;
  onToggleSupport: (target: CollectTarget) => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: React Three Fiber scene targets are not DOM controls.
    <mesh
      position={[cellX(target.col), -target.row, 1.04]}
      renderOrder={19}
      onClick={(e) => {
        e.stopPropagation();
        onToggleSupport(target);
      }}
    >
      <planeGeometry args={[1.08, 1.08]} />
      <meshBasicMaterial
        color={SUPPORT_SELECT_RED}
        transparent
        opacity={0}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}
