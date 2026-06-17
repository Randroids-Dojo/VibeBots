import { lightRadius, type MineGear } from "@/sim/mine";

export const MINE_CAMERA_BASE_DISTANCE = 13;
export const MINE_CAMERA_ZOOM_DEFAULT = 1;
export const MINE_CAMERA_MIN_ZOOM = 0.72;
export const MINE_CAMERA_STORAGE_KEY = "vibebots-mine-camera-zoom-v1";
export const MINE_CAMERA_FALLOFF_ROWS = 2;

const BASE_LANTERN_RADIUS = 3;
const BASE_FALLOFF_ZOOM = 0.12;
const MAX_ZOOM_STEP_PER_LANTERN_ROW = 0.09;

export function maxMineCameraZoomForRadius(radius: number): number {
  return Math.min(
    1.48,
    MINE_CAMERA_ZOOM_DEFAULT +
      BASE_FALLOFF_ZOOM +
      Math.max(0, radius - BASE_LANTERN_RADIUS) * MAX_ZOOM_STEP_PER_LANTERN_ROW,
  );
}

export function maxMineCameraZoom(gear: MineGear): number {
  return maxMineCameraZoomForRadius(lightRadius(gear));
}

export function clampMineCameraZoom(zoom: number, gear: MineGear): number {
  if (!Number.isFinite(zoom)) return MINE_CAMERA_ZOOM_DEFAULT;
  return Math.min(
    maxMineCameraZoom(gear),
    Math.max(MINE_CAMERA_MIN_ZOOM, zoom),
  );
}

export function mineCameraDistance(zoom: number): number {
  return MINE_CAMERA_BASE_DISTANCE * zoom;
}

export function mineRenderWindow(
  gear: MineGear,
  zoom: number,
): {
  above: number;
  below: number;
  cols: number;
} {
  const clamped = clampMineCameraZoom(zoom, gear);
  return {
    above: Math.ceil(8 * Math.max(1, clamped)),
    below: lightRadius(gear) + MINE_CAMERA_FALLOFF_ROWS,
    cols: Math.ceil(9 * Math.max(1, clamped)) + 1,
  };
}
