import { type MineGear, maxGearLevel } from "@/sim/mine";

export const START_ACTION_REPEAT_MS = 620;
export const MAXED_ACTION_REPEAT_MS = 420;
export const MINER_STEP_REPEAT_SHARE = 0.86;
export const START_MINER_STEP_SECONDS =
  (START_ACTION_REPEAT_MS * MINER_STEP_REPEAT_SHARE) / 1000;
export const MAXED_MINER_STEP_SECONDS =
  (MAXED_ACTION_REPEAT_MS * MINER_STEP_REPEAT_SHARE) / 1000;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function gearProgress(gear: MineGear): number {
  const current =
    gear.pickaxe -
    1 +
    (gear.battery - 1) +
    (gear.cargo - 1) +
    (gear.lantern - 1) +
    ((gear.fall ?? 1) - 1);
  const max =
    maxGearLevel("pickaxe") -
    1 +
    (maxGearLevel("battery") - 1) +
    (maxGearLevel("cargo") - 1) +
    (maxGearLevel("lantern") - 1) +
    (maxGearLevel("fall") - 1);
  return clamp01(current / max);
}

function scaled(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

export function actionRepeatMs(gear: MineGear): number {
  return Math.round(
    scaled(START_ACTION_REPEAT_MS, MAXED_ACTION_REPEAT_MS, gearProgress(gear)),
  );
}

/** Chained (held) steps fill the whole input-repeat interval, so the
 * next repeat retargets exactly as the glide lands: no standstill gap. */
export function minerChainStepSeconds(gear: MineGear): number {
  return actionRepeatMs(gear) / 1000;
}

export function minerStepSeconds(gear: MineGear): number {
  return (actionRepeatMs(gear) * MINER_STEP_REPEAT_SHARE) / 1000;
}
