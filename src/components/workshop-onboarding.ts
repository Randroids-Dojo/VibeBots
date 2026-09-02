import type { BotDesign } from "@/sim/design";

/**
 * The guided first build (G6, workshop garage program). A blank bench
 * intimidates, so a first-ever visit opens with a nearly finished bot, one
 * wheel missing, and one line saying what to do. Three steps, each
 * advanced by the player demonstrating it (Mario 1-1 teaching: the first
 * action is the tutorial), then the guide is done for good. Completion
 * persists to localStorage the way the bunker tutorial does, so the guide
 * runs once per browser; the settings menu can clear it to replay.
 */

export const WORKSHOP_GUIDE_DONE_KEY = "vibebots-workshop-first-build-done";

export const GUIDE_STEPS = ["place", "fight", "shop", "done"] as const;
export type GuideStep = (typeof GUIDE_STEPS)[number];

export interface GuideCard {
  step: Exclude<GuideStep, "done">;
  title: string;
  line: string;
}

export const GUIDE_CARDS: Record<Exclude<GuideStep, "done">, GuideCard> = {
  place: {
    step: "place",
    title: "Finish the bot",
    line: "Drag the wheel from below onto the glowing mount.",
  },
  fight: {
    step: "fight",
    title: "See it move",
    line: "Tap Test fight and pick an opponent. Your bot drives itself.",
  },
  shop: {
    step: "shop",
    title: "Get more parts",
    line: "The Shop tab sells parts. The mine pays for them.",
  },
};

/** The part the first step hands the player. */
export const GUIDED_PART_ID = "drive-wheel";

/**
 * How many drive wheels the bench carries once the guided wheel is on: the
 * start design has one, the player adds the second. Counting wheels rather
 * than parts means placing some other part (a plate on the top mount)
 * does not end the step while the glowing axle is still empty.
 */
export const GUIDED_WHEELS_WHEN_DONE = 2;

/**
 * The Cube Rammer with its left wheel missing: a bot that is one obvious
 * drag from done. The free left axle is the glowing mount. Left, not right,
 * on purpose: the bench camera sits on the bot's right (+x) side, so the
 * left axle projects nearer the screen centre than the fitted right wheel
 * does, and a drop over the bot lands on the mount rather than merging
 * into the wheel already there.
 */
export const GUIDED_START_DESIGN: BotDesign = {
  name: "My Bot",
  parts: [
    { iid: "core", partId: "core-cube" },
    { iid: "wheel-r", partId: "drive-wheel" },
    { iid: "spike", partId: "ram-spike" },
  ],
  connections: [
    {
      parentIid: "core",
      parentConnector: "axle-right",
      childIid: "wheel-r",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "front",
      childIid: "spike",
      childConnector: "mount",
    },
  ],
};

/** What the bench can observe to advance a step. */
export interface GuideObservation {
  /** Drive wheels on the bot right now. */
  wheelCount: number;
  fightStarted: boolean;
  shopOpened: boolean;
}

/** The observation the guide draws from a design: its drive-wheel count. */
export function guideWheelCount(design: BotDesign): number {
  let count = 0;
  for (const part of design.parts) {
    if (part.partId === GUIDED_PART_ID) count += 1;
  }
  return count;
}

/**
 * The step after an observation. Pure, so the order and the exit
 * conditions are unit tested: placing the second wheel finishes "place", starting
 * any fight finishes "fight", opening the Shop tab finishes "shop". A step
 * never goes backward, and a later demonstration also clears earlier
 * steps (a player who loads a two-wheel blueprint has finished placing).
 */
export function nextGuideStep(
  step: GuideStep,
  observed: GuideObservation,
): GuideStep {
  let current = step;
  if (current === "place" && observed.wheelCount >= GUIDED_WHEELS_WHEN_DONE) {
    current = "fight";
  }
  if (current === "fight" && observed.fightStarted) current = "shop";
  if (current === "shop" && observed.shopOpened) current = "done";
  return current;
}

export interface GuideStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeLocalStorage(): GuideStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isWorkshopGuideDone(
  storage: GuideStorage | null = safeLocalStorage(),
): boolean {
  try {
    return storage?.getItem(WORKSHOP_GUIDE_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markWorkshopGuideDone(
  storage: GuideStorage | null = safeLocalStorage(),
): void {
  try {
    storage?.setItem(WORKSHOP_GUIDE_DONE_KEY, "1");
  } catch {
    // Storage blocked: the guide reruns next visit, which is the safe side.
  }
}

export function clearWorkshopGuideDone(
  storage: GuideStorage | null = safeLocalStorage(),
): void {
  try {
    storage?.removeItem(WORKSHOP_GUIDE_DONE_KEY);
  } catch {
    // Storage blocked: nothing to clear.
  }
}
