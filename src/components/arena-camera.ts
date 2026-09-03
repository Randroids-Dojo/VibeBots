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

/**
 * Below this width-to-height ratio the viewport is portrait and the rig
 * frames over the player's shoulder (F-245): a broadside shot on a tall
 * screen has to back off until both bots fit its narrow width and they
 * read as specks, while a shot along the line between them puts their
 * separation into the screen's height instead, from much closer.
 */
export const ARENA_PORTRAIT_ASPECT = 1;

export function arenaCameraFrameForBounds(
  bounds: ArenaCameraBounds,
  botCenters: [{ x: number; z: number }, { x: number; z: number }],
  aspect = 16 / 9,
): ArenaCameraFrame {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const spanZ = bounds.maxZ - bounds.minZ;
  const horizontalSpan = Math.max(spanX, spanZ);
  // Broadcast framing: tight on the clash, pulling back as the bots
  // separate. The old padding (+4.5 flat, 1.2x, min 10) held a wide
  // establishing shot for the whole match and the fight read tiny.
  const paddedWidth = horizontalSpan + 2.2 + horizontalSpan * 0.18;
  const paddedHeight = spanY + 2.2;
  const halfFovRadians = (ARENA_CAMERA_FOV_DEGREES * Math.PI) / 360;
  const framingDistance =
    Math.max(paddedWidth, paddedHeight) / (2 * Math.tan(halfFovRadians));
  const dx = botCenters[1].x - botCenters[0].x;
  const dz = botCenters[1].z - botCenters[0].z;
  const center = arenaCameraBoundsCenter(bounds);
  const alongLine = Math.atan2(dx, dz);

  if (aspect < ARENA_PORTRAIT_ASPECT) {
    // Over the player's shoulder (bot 1 is the player's in every workshop
    // fight): the rig sits behind it, higher, and closer, looking down
    // the line at the opponent, so the separation runs up the screen.
    return {
      targetX: center.x,
      targetY: Math.max(0.8, center.y),
      targetZ: center.z,
      yaw: alongLine,
      height: Math.min(9, Math.max(4.2, 3.6 + horizontalSpan * 0.24)),
      distance: Math.min(18, Math.max(5.5, framingDistance * 0.7)),
    };
  }

  return {
    targetX: center.x,
    targetY: Math.max(0.8, center.y),
    targetZ: center.z,
    yaw: alongLine + Math.PI / 2,
    height: Math.min(7.5, Math.max(3.2, 2.9 + horizontalSpan * 0.14)),
    distance: Math.min(24, Math.max(6.5, framingDistance * 1.05)),
  };
}
