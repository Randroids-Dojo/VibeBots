import { FP_CELL_COUNT } from "./bunker-fp-grid";

/**
 * Progressive first-person bunker tutorial (F-097): a chain of small
 * non-modal cards that teach look, walk, dig, place, and pry, each
 * advancing 1.5s after the player demonstrates the mechanic. The
 * state machine lives outside React as module scalars (the
 * bunker-fp-target-state mini-store pattern): the rig feeds it cheap
 * scalar observations once per frame through updateFpTutorial, which
 * early-returns when idle or complete and allocates nothing in steady
 * state; listeners are notified only when the visible card changes.
 * Completion (finishing or skipping) persists to localStorage so the
 * tutorial runs once; the settings menu's replay button clears the
 * flag so the next bunker entry re-arms it.
 */

export const FP_TUTORIAL_DONE_KEY = "vibebots-bunker-fp-tutorial-done";
/** In-room frames before the first card shows. */
export const FP_TUTORIAL_ENTRY_DELAY_MS = 1000;
/** Pause between a demonstrated (or dismissed) step and the next card. */
export const FP_TUTORIAL_STEP_GAP_MS = 1500;
/** Lifetime of cards with no demonstrable action (done, zero-stock). */
export const FP_TUTORIAL_AUTO_ADVANCE_MS = 6000;
/** Cumulative |yaw| + |pitch| travel that demonstrates looking. */
export const FP_TUTORIAL_LOOK_RADIANS = 1.2;
/** Cumulative horizontal travel (cells) that demonstrates walking. A
 * fresh claim's spawn pocket is only three cells wide, so this stays
 * under the ~1.2 cells a single strafe covers before the claim rock
 * (F-115): otherwise a new player could not clear the walk step. */
export const FP_TUTORIAL_WALK_CELLS = 1.0;

export const FP_TUTORIAL_STEPS = [
  "look",
  "walk",
  "dig",
  "place",
  "pry",
  "done",
] as const;
export type FpTutorialStep = (typeof FP_TUTORIAL_STEPS)[number];
/** What the HUD renders: a step id, the zero-stock place variant, or
 * nothing (idle, waiting, between steps, or complete). */
export type FpTutorialCard = FpTutorialStep | "place-no-stock";

/** The storage surface the machine persists through; injectable so
 * unit tests run without a browser. */
export interface FpTutorialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeLocalStorage(): FpTutorialStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isFpTutorialDone(
  storage: FpTutorialStorage | null = safeLocalStorage(),
): boolean {
  try {
    return storage?.getItem(FP_TUTORIAL_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

/** The settings menu's "Replay bunker tutorial": clearing the flag
 * re-arms the chain on the next bunker entry. */
export function clearFpTutorialDone(
  storage: FpTutorialStorage | null = safeLocalStorage(),
): void {
  try {
    storage?.removeItem(FP_TUTORIAL_DONE_KEY);
  } catch {
    // Storage blocked: without a flag the tutorial reruns anyway.
  }
}

const PHASE_IDLE = 0;
/** Armed, counting the entry delay from the first observed frame. */
const PHASE_WAITING = 1;
const PHASE_SHOWING = 2;
/** Demonstrated or dismissed; counting the gap to the next card. */
const PHASE_GAP = 3;
const PHASE_COMPLETE = 4;

let phase = PHASE_IDLE;
let stepIndex = 0;
let card: FpTutorialCard | null = null;
/** Entry-delay or gap deadline; 0 means "seed on the next update". */
let deadline = 0;
/** Showing-phase timed advance for undemonstrable cards; 0 = none. */
let autoAdvanceAt = 0;
let lookAccum = 0;
let walkAccum = 0;
let lastYaw = 0;
let lastPitch = 0;
let lastPx = 0;
let lastPz = 0;
let lastOpenCells = 0;
let lastPartsCount = 0;
let havePrev = false;
/** Total part stock, fed by the HUD at prop cadence (setFpTutorialStock). */
let stock = 0;
/** Captured at arm time so frame-driven completion can persist. */
let armedStorage: FpTutorialStorage | null = null;

const listeners = new Set<() => void>();

function setCard(next: FpTutorialCard | null): void {
  if (card === next) return;
  card = next;
  for (const listener of listeners) listener();
}

export function subscribeFpTutorial(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFpTutorialCard(): FpTutorialCard | null {
  return card;
}

/**
 * Arm on bunker entry. When the done flag is set the machine stays
 * idle (updateFpTutorial early-returns every frame); otherwise the
 * chain restarts from the look step after the entry delay.
 */
export function armFpTutorial(
  storage: FpTutorialStorage | null = safeLocalStorage(),
): void {
  armedStorage = storage;
  stepIndex = 0;
  deadline = 0;
  autoAdvanceAt = 0;
  lookAccum = 0;
  walkAccum = 0;
  havePrev = false;
  phase = isFpTutorialDone(storage) ? PHASE_IDLE : PHASE_WAITING;
  setCard(null);
}

/** Leaving the bunker drops any in-progress run without persisting;
 * the next entry starts over from the look step. */
export function disarmFpTutorial(): void {
  phase = PHASE_IDLE;
  armedStorage = null;
  havePrev = false;
  setCard(null);
}

/** The HUD reports total part stock whenever the inventory prop
 * changes, so the place and pry steps can degrade gracefully. */
export function setFpTutorialStock(totalStock: number): void {
  stock = totalStock;
}

function completeFpTutorial(): void {
  phase = PHASE_COMPLETE;
  setCard(null);
  try {
    armedStorage?.setItem(FP_TUTORIAL_DONE_KEY, "1");
  } catch {
    // Storage blocked: complete for this session only.
  }
}

/**
 * Shows the step at `index`, resolving degradations against the most
 * recent observations: a fully dug volume skips the dig step; a
 * zero-stock place step swaps to the Hardware Store copy on a timer;
 * a pry step with nothing placed and no stock (nothing to pry back)
 * times out too; the closer always times out.
 */
function showStep(index: number, now: number): void {
  let next = index;
  if (FP_TUTORIAL_STEPS[next] === "dig") {
    // Every cell is exactly one of open, part-stamped, core, or undug
    // rock, so the diggable remainder falls out of the observations.
    const undug = FP_CELL_COUNT - lastOpenCells - lastPartsCount - 1;
    if (undug <= 0) next += 1;
  }
  if (next >= FP_TUTORIAL_STEPS.length) {
    completeFpTutorial();
    return;
  }
  stepIndex = next;
  phase = PHASE_SHOWING;
  lookAccum = 0;
  walkAccum = 0;
  autoAdvanceAt = 0;
  const step = FP_TUTORIAL_STEPS[next];
  let visible: FpTutorialCard = step;
  if (step === "place" && stock <= 0) {
    visible = "place-no-stock";
    autoAdvanceAt = now + FP_TUTORIAL_AUTO_ADVANCE_MS;
  } else if (step === "pry" && lastPartsCount <= 0 && stock <= 0) {
    autoAdvanceAt = now + FP_TUTORIAL_AUTO_ADVANCE_MS;
  } else if (step === "done") {
    autoAdvanceAt = now + FP_TUTORIAL_AUTO_ADVANCE_MS;
  }
  setCard(visible);
}

function advanceFromShowing(now: number): void {
  if (FP_TUTORIAL_STEPS[stepIndex] === "done") {
    completeFpTutorial();
    return;
  }
  phase = PHASE_GAP;
  deadline = now + FP_TUTORIAL_STEP_GAP_MS;
  setCard(null);
}

/** The card's X: skip this one step; the next shows after the gap. */
export function dismissFpTutorialStep(now: number): void {
  if (phase !== PHASE_SHOWING) return;
  advanceFromShowing(now);
}

/** "Skip tutorial": end the whole chain now and persist the flag. */
export function skipFpTutorial(
  storage: FpTutorialStorage | null = armedStorage ?? safeLocalStorage(),
): void {
  armedStorage = storage;
  completeFpTutorial();
}

/**
 * Per-frame observation feed from the rig. Scalars only; two
 * comparisons and out when the tutorial is idle or complete, and no
 * allocation on any path (module-scalar accumulators, change-only
 * listener notification through setCard).
 */
export function updateFpTutorial(
  now: number,
  yaw: number,
  pitch: number,
  px: number,
  pz: number,
  openCells: number,
  partsCount: number,
): void {
  if (phase === PHASE_IDLE || phase === PHASE_COMPLETE) return;
  if (!havePrev) {
    // First observed frame: seed baselines and start the entry delay
    // from here, so slow scene compiles never eat the settle time.
    havePrev = true;
    lastYaw = yaw;
    lastPitch = pitch;
    lastPx = px;
    lastPz = pz;
    lastOpenCells = openCells;
    lastPartsCount = partsCount;
    if (phase === PHASE_WAITING) deadline = now + FP_TUTORIAL_ENTRY_DELAY_MS;
    return;
  }
  const lookDelta = Math.abs(yaw - lastYaw) + Math.abs(pitch - lastPitch);
  const walkDelta = Math.hypot(px - lastPx, pz - lastPz);
  const dug = openCells > lastOpenCells;
  const placed = partsCount > lastPartsCount;
  // A pry refunds the part straight to inventory (F-099), so the
  // demonstration is the placed-parts count dropping.
  const pried = partsCount < lastPartsCount;
  lastYaw = yaw;
  lastPitch = pitch;
  lastPx = px;
  lastPz = pz;
  lastOpenCells = openCells;
  lastPartsCount = partsCount;

  if (phase === PHASE_WAITING) {
    if (now >= deadline) showStep(0, now);
    return;
  }
  if (phase === PHASE_GAP) {
    if (now >= deadline) showStep(stepIndex + 1, now);
    return;
  }

  // PHASE_SHOWING: check the current step's demonstration.
  const step = FP_TUTORIAL_STEPS[stepIndex];
  let demonstrated = false;
  if (step === "look") {
    lookAccum += lookDelta;
    demonstrated = lookAccum >= FP_TUTORIAL_LOOK_RADIANS;
  } else if (step === "walk") {
    walkAccum += walkDelta;
    demonstrated = walkAccum >= FP_TUTORIAL_WALK_CELLS;
  } else if (step === "dig") {
    demonstrated = dug;
  } else if (step === "place") {
    demonstrated = placed;
  } else if (step === "pry") {
    demonstrated = pried;
  }
  if (!demonstrated && autoAdvanceAt !== 0 && now >= autoAdvanceAt) {
    demonstrated = true;
  }
  if (demonstrated) advanceFromShowing(now);
}
