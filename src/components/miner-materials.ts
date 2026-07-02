/**
 * TSL node materials for the miner robot (character pipeline slice 2).
 * One shared set of material instances for every miner on screen: shared
 * programs keep the phone draw budget honest, and the node graphs compile
 * on both the WebGPU backend and the WebGL2 fallback.
 *
 * The materials are module singletons; meshes must attach them with
 * `dispose={null}` so a canvas unmount never disposes a shared program.
 */

import {
  abs,
  color,
  dot,
  float,
  fract,
  mix,
  normalView,
  oneMinus,
  positionViewDirection,
  pow,
  sin,
  smoothstep,
  time,
  uv,
} from "three/tsl";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";

/** View-angle rim: bright at grazing angles, like lamp light wrapping the
 * silhouette. The staple of readable stylized characters on dark scenes. */
function rimNode(strength: number, exponent = 2.6) {
  return pow(
    oneMinus(abs(dot(normalView, positionViewDirection))),
    exponent,
  ).mul(strength);
}

function hullMaterial(hex: string, rimHex: string, rimStrength: number) {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = color(hex);
  material.roughness = 0.48;
  material.metalness = 0.3;
  material.flatShading = true;
  material.emissiveNode = color(rimHex).mul(rimNode(rimStrength));
  return material;
}

/** Warm orange hull plating with a lamp-warm rim. */
export const MINER_HULL = hullMaterial("#ff9f43", "#ffb066", 0.55);
/** Lighter head plating. */
export const MINER_HULL_LIGHT = hullMaterial("#ffb066", "#ffd9a0", 0.5);
/** Dark chassis under-plating. */
export const MINER_CHASSIS = hullMaterial("#2b2f3a", "#54e0c7", 0.22);
/** Gunmetal joints and servos with a cool steel rim. */
export const MINER_JOINT = (() => {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = color("#3a3f4d");
  material.roughness = 0.38;
  // Tempered until the environment-lighting slice: full metalness has
  // nothing to reflect yet and reads black from unlit angles.
  material.metalness = 0.5;
  material.flatShading = true;
  material.emissiveNode = color("#9fb4d8").mul(rimNode(0.5, 3.2));
  return material;
})();
/** Pick head steel: bright, hard, with a sharp rim so the swing reads. */
export const MINER_PICK_STEEL = (() => {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = color("#c3cbd9");
  material.roughness = 0.3;
  // Tempered until the environment-lighting slice (see MINER_JOINT).
  material.metalness = 0.55;
  material.flatShading = true;
  material.emissiveNode = color("#e8f1ff").mul(rimNode(0.8, 2.2));
  return material;
})();
/** Rubber feet and grips: matte, grounded. */
export const MINER_RUBBER = (() => {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = color("#23262f");
  material.roughness = 0.92;
  material.metalness = 0.05;
  material.flatShading = true;
  return material;
})();
/** Hard-hat safety yellow. */
export const MINER_HAT = hullMaterial("#f5c542", "#ffe9a8", 0.45);
/** Wood pick handle. */
export const MINER_HANDLE = (() => {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = color("#6b4a2a");
  material.roughness = 0.9;
  material.flatShading = true;
  return material;
})();

/** Chest screen: teal glass with a slow scanline sweeping upward. */
export const MINER_SCREEN = (() => {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = color("#0d2b26");
  material.roughness = 0.3;
  material.flatShading = true;
  const sweep = smoothstep(
    float(0.86),
    float(1.0),
    fract(uv().y.mul(1.0).sub(time.mul(0.45))),
  );
  material.emissiveNode = color("#54e0c7").mul(float(0.55).add(sweep.mul(0.9)));
  return material;
})();

/** Visor: cyan glow with a soft breathing pulse (never fully dark). */
export const MINER_VISOR = (() => {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = color("#101820");
  material.roughness = 0.25;
  material.flatShading = true;
  material.emissiveNode = color("#7df9ff").mul(
    float(1.0).add(sin(time.mul(2.1)).mul(0.25)),
  );
  return material;
})();

/** Headlamp lens: the brightest constant emissive on the model. */
export const MINER_LAMP_LENS = (() => {
  const material = new MeshBasicNodeMaterial();
  material.colorNode = color("#fff3c4").mul(2.4);
  return material;
})();

/** Knee and joint accent glow. */
export const MINER_KNEE_GLOW = (() => {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = color("#54e0c7");
  material.roughness = 0.45;
  material.flatShading = true;
  material.emissiveNode = color("#2fe9c7").mul(0.9);
  return material;
})();

/** Backpack battery: three charge bars burned into one mesh via uv. */
export const MINER_BATTERY = (() => {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = color("#1d2129");
  material.roughness = 0.5;
  material.flatShading = true;
  const bars = smoothstep(float(0.16), float(0.2), fract(uv().y.mul(3)))
    .mul(smoothstep(float(0.92), float(0.88), fract(uv().y.mul(3))))
    .mul(smoothstep(float(0.06), float(0.12), uv().x))
    .mul(smoothstep(float(0.94), float(0.88), uv().x));
  material.emissiveNode = mix(color("#0a0c10"), color("#54e0c7"), bars).mul(
    1.15,
  );
  return material;
})();

/** Antenna beacon: red, blinking like aircraft warning lights. */
export const MINER_BEACON = (() => {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = color("#ff6b6b");
  material.roughness = 0.4;
  material.flatShading = true;
  material.emissiveNode = color("#ff6b6b").mul(
    float(0.5).add(
      smoothstep(float(0.72), float(0.98), sin(time.mul(2.6))).mul(1.8),
    ),
  );
  return material;
})();
