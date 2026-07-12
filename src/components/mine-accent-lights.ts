/**
 * Fixed-count accent-light pool (F-077). The decorative point lights on
 * warp beacons, dropped bags, dynamite, and surface portals were removed
 * by the constant-light-count fix (#105): a fluctuating light count makes
 * three recompile every material program, and those lights entered and
 * left the render window as the miner moved. The pool restores the local
 * glow at a CONSTANT count: the canvas always mounts ACCENT_LIGHT_COUNT
 * point lights, each render gathers the visible emitters and keeps the
 * nearest, and unused slots park at intensity 0 (changing no pixels while
 * keeping the scene's light count fixed).
 *
 * Frame-loop rule: the render loop gathers emitters through module
 * scratch, so a pass allocates nothing.
 */

export const ACCENT_LIGHT_COUNT = 3;

export interface AccentEmitterSlot {
  x: number;
  y: number;
  z: number;
  color: string;
  intensity: number;
  /** three PointLight.distance; named to avoid shadowing the d2 metric. */
  lightDistance: number;
  decay: number;
  /** Squared cell distance to the miner; the pool keeps the nearest. */
  d2: number;
}

/** Module scratch, reset at the top of every render-loop pass. */
export const ACCENT_SLOTS: AccentEmitterSlot[] = Array.from(
  { length: ACCENT_LIGHT_COUNT },
  () => ({
    x: 0,
    y: 0,
    z: 0,
    color: "#ffffff",
    intensity: 0,
    lightDistance: 1,
    decay: 1,
    d2: Infinity,
  }),
);

let slotsUsed = 0;

export function resetAccentEmitters(): void {
  slotsUsed = 0;
}

/** Slots holding a live emitter after the current gather pass. */
export function accentEmitterCount(): number {
  return slotsUsed;
}

/** Offer one emitter to the pool; keeps the ACCENT_LIGHT_COUNT nearest. */
export function pushAccentEmitter(
  x: number,
  y: number,
  z: number,
  color: string,
  intensity: number,
  lightDistance: number,
  decay: number,
  d2: number,
): void {
  let target: number;
  if (slotsUsed < ACCENT_LIGHT_COUNT) {
    target = slotsUsed;
    slotsUsed += 1;
  } else {
    target = 0;
    for (let i = 1; i < ACCENT_LIGHT_COUNT; i++) {
      if (ACCENT_SLOTS[i].d2 > ACCENT_SLOTS[target].d2) target = i;
    }
    if (ACCENT_SLOTS[target].d2 <= d2) return;
  }
  const slot = ACCENT_SLOTS[target];
  slot.x = x;
  slot.y = y;
  slot.z = z;
  slot.color = color;
  slot.intensity = intensity;
  slot.lightDistance = lightDistance;
  slot.decay = decay;
  slot.d2 = d2;
}
