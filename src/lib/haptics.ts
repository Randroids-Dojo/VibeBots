/**
 * Tiny haptics helper (K): fire a short vibration alongside the visual pop so
 * a place or merge lands with a physical tap on devices that support it
 * (Android Chrome does; iOS Safari ignores navigator.vibrate, which is a safe
 * no-op). Kept trivial and guarded so it never throws on unsupported devices
 * or during SSR. Patterns are intentionally brief so building never feels
 * buzzy.
 */
export const HAPTIC_PLACE = 12;
export const HAPTIC_REMOVE = 22;
// A merge is the signature moment, so it gets a double-tap pattern.
export const HAPTIC_MERGE: number[] = [0, 16, 26, 34];

export function buzz(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  const vibrate = navigator.vibrate?.bind(navigator);
  if (!vibrate) return;
  try {
    vibrate(pattern);
  } catch {
    // Some engines throw on odd patterns or when the page is not visible.
    // Haptics are pure polish, so swallow and move on.
  }
}
