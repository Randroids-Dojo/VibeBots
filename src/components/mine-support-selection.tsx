import type { CollectTarget } from "@/sim/mine";
import { cellX } from "./mine-render-palette";

export const SUPPORT_SELECT_RED = "#ff3b30";

export function SupportSelectionOutline({
  width,
  height,
  z = 0.14,
}: {
  width: number;
  height: number;
  z?: number;
}) {
  const bar = 0.045;
  return (
    <group position={[0, 0, z]}>
      <SelectionOutlineBars
        width={width}
        height={height}
        bar={bar}
        renderOrder={0}
        depthTest
      />
    </group>
  );
}

export function SelectionOutlineBars({
  width,
  height,
  bar,
  renderOrder,
  depthTest,
}: {
  width: number;
  height: number;
  bar: number;
  renderOrder: number;
  depthTest: boolean;
}) {
  const bars = [
    { position: [0, height / 2, 0], args: [width, bar, bar] },
    { position: [0, -height / 2, 0], args: [width, bar, bar] },
    { position: [-width / 2, 0, 0], args: [bar, height, bar] },
    { position: [width / 2, 0, 0], args: [bar, height, bar] },
  ] as const;
  return (
    <>
      {bars.map(({ position, args }) => (
        <mesh
          key={position.join(":")}
          position={position}
          renderOrder={renderOrder}
        >
          <boxGeometry args={args} />
          <meshBasicMaterial
            color={SUPPORT_SELECT_RED}
            toneMapped={false}
            depthWrite={false}
            depthTest={depthTest}
          />
        </mesh>
      ))}
    </>
  );
}

export function SelectedSupportCellOutline({
  col,
  row,
}: {
  col: number;
  row: number;
}) {
  return (
    <group position={[cellX(col), -row, 1.02]}>
      <SelectionOutlineBars
        width={1.1}
        height={1.1}
        bar={0.065}
        renderOrder={20}
        depthTest={false}
      />
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
