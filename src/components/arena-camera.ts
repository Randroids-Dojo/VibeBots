export const ARENA_CAMERA_FOV_DEGREES = 42;

export interface ArenaCameraBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface ArenaCameraFrame {
  targetX: number;
  targetY: number;
  targetZ: number;
  yaw: number;
  height: number;
  distance: number;
}

export function emptyArenaCameraBounds(): ArenaCameraBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
}

export function includeArenaCameraPoint(
  bounds: ArenaCameraBounds,
  x: number,
  y: number,
  z: number,
  padding = 0,
): void {
  bounds.minX = Math.min(bounds.minX, x - padding);
  bounds.maxX = Math.max(bounds.maxX, x + padding);
  bounds.minY = Math.min(bounds.minY, y - padding);
  bounds.maxY = Math.max(bounds.maxY, y + padding);
  bounds.minZ = Math.min(bounds.minZ, z - padding);
  bounds.maxZ = Math.max(bounds.maxZ, z + padding);
}

export function includeArenaCameraBounds(
  target: ArenaCameraBounds,
  source: ArenaCameraBounds,
): void {
  includeArenaCameraPoint(target, source.minX, source.minY, source.minZ);
  includeArenaCameraPoint(target, source.maxX, source.maxY, source.maxZ);
}

export function arenaCameraBoundsReady(bounds: ArenaCameraBounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxY) &&
    Number.isFinite(bounds.minZ) &&
    Number.isFinite(bounds.maxZ)
  );
}

export function arenaCameraBoundsCenter(bounds: ArenaCameraBounds): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
}

export function arenaCameraFrameForBounds(
  bounds: ArenaCameraBounds,
  botCenters: [{ x: number; z: number }, { x: number; z: number }],
): ArenaCameraFrame {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const spanZ = bounds.maxZ - bounds.minZ;
  const horizontalSpan = Math.max(spanX, spanZ);
  const paddedWidth = horizontalSpan + 4.5 + horizontalSpan * 0.24;
  const paddedHeight = spanY + 3.5;
  const halfFovRadians = (ARENA_CAMERA_FOV_DEGREES * Math.PI) / 360;
  const framingDistance =
    Math.max(paddedWidth, paddedHeight) / (2 * Math.tan(halfFovRadians));
  const dx = botCenters[1].x - botCenters[0].x;
  const dz = botCenters[1].z - botCenters[0].z;
  const center = arenaCameraBoundsCenter(bounds);

  return {
    targetX: center.x,
    targetY: Math.max(0.8, center.y),
    targetZ: center.z,
    yaw: Math.atan2(dx, dz) + Math.PI / 2,
    height: Math.min(8.5, Math.max(5.2, 4.8 + horizontalSpan * 0.12)),
    distance: Math.min(28, Math.max(10, framingDistance * 1.2)),
  };
}
