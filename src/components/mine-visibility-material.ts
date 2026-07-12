import {
  color,
  mix,
  oneMinus,
  positionWorld,
  smoothstep,
  uniform,
} from "three/tsl";
import { MeshBasicNodeMaterial, Vector2 } from "three/webgpu";

const visibilityCenter = uniform(new Vector2());
const visibilityRadius = uniform(3);
const surfaceDarkness = uniform(0);

/**
 * One continuous world-space veil replaces the old per-cell darkness quads.
 * The wide feather hides the grid construction while keeping the clear area
 * circular. Above the ground line the day/night grade controls opacity;
 * underground the veil is hour-invariant.
 */
export const MINE_VISIBILITY_VEIL = (() => {
  const material = new MeshBasicNodeMaterial();
  const radialDistance = positionWorld.xy.sub(visibilityCenter).length();
  const penumbra = smoothstep(
    visibilityRadius.sub(0.7),
    visibilityRadius.add(1.15),
    radialDistance,
  );
  const underground = oneMinus(smoothstep(-0.62, -0.18, positionWorld.y));
  const darkness = mix(surfaceDarkness, 1, underground);

  material.colorNode = mix(color("#07121a"), color("#010308"), penumbra);
  material.opacityNode = penumbra.mul(darkness).mul(0.94);
  material.transparent = true;
  material.depthTest = false;
  material.depthWrite = false;
  material.toneMapped = false;
  return material;
})();

/**
 * Unlit backing for the underground half of the camera. The old standard
 * material caught the miner lamp through every 0.06-cell block gap, turning
 * the grid into glowing lines. World height keeps the authored sky visible
 * above the surface while every exposed underground crack stays near-black.
 */
export const MINE_CAVE_BACKDROP = (() => {
  const material = new MeshBasicNodeMaterial();
  material.colorNode = color("#010207");
  material.opacityNode = oneMinus(smoothstep(0.42, 0.58, positionWorld.y));
  material.transparent = true;
  material.depthWrite = false;
  material.toneMapped = false;
  return material;
})();

export function updateMineVisibilityVeil(
  centerX: number,
  centerY: number,
  radius: number,
  daylightDarkness: number,
): void {
  visibilityCenter.value.set(centerX, centerY);
  visibilityRadius.value = radius;
  surfaceDarkness.value = Math.max(0, Math.min(1, daylightDarkness));
}
