export type CadenceTimer = number;

export interface CadenceClock {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => CadenceTimer;
  clearTimeout: (timer: CadenceTimer) => void;
}

export interface DirectionCadenceController<T> {
  press: (input: T, repeatMs: number) => boolean;
  release: (input: T | null) => void;
  cancel: () => void;
}

export function createDirectionCadenceController<T>({
  clock,
  onAction,
  isOpposite,
}: {
  clock: CadenceClock;
  /**
   * isAutoRepeat is true only for the second and later firings of one
   * uninterrupted hold. A fresh press, and a tap that buffered during
   * the cooldown, both count as deliberate presses (false).
   */
  onAction: (input: T, isAutoRepeat: boolean) => boolean;
  /** Enables tap-cancels-tap: an opposite tap clears the buffered one. */
  isOpposite?: (a: T, b: T) => boolean;
}): DirectionCadenceController<T> {
  let heldInput: T | null = null;
  let nextActionAt = 0;
  let timer: CadenceTimer | null = null;
  // One-slot tap buffer: a press that lands inside the cooldown window is
  // remembered (newest wins, opposite cancels) and fires exactly at
  // nextActionAt. It can never fire early and never holds more than one
  // action, so tapping stays rate-capped identically to holding.
  let bufferedInput: T | null = null;
  // False until the current hold's first firing lands; distinguishes a
  // held auto-repeat from a delayed fresh press for onAction.
  let heldFiredOnce = false;

  const clearTimer = () => {
    if (timer === null) return;
    clock.clearTimeout(timer);
    timer = null;
  };

  const cancel = () => {
    heldInput = null;
    bufferedInput = null;
    heldFiredOnce = false;
    clearTimer();
  };

  const tryAction = (
    input: T,
    repeatMs: number,
    isAutoRepeat: boolean,
  ): boolean => {
    const now = clock.now();
    if (now < nextActionAt) return false;
    if (!onAction(input, isAutoRepeat)) {
      if (heldInput === input) cancel();
      return false;
    }
    nextActionAt = now + repeatMs;
    bufferedInput = null;
    if (heldInput === input) heldFiredOnce = true;
    return true;
  };

  const scheduleNext = (repeatMs: number) => {
    clearTimer();
    if (heldInput === null && bufferedInput === null) return;
    // Always make forward progress: a zero-delay reschedule after an
    // early-fired timer would otherwise spin without advancing time.
    const delayMs = Math.max(1, nextActionAt - clock.now());
    timer = clock.setTimeout(() => {
      timer = null;
      if (heldInput !== null) {
        tryAction(heldInput, repeatMs, heldFiredOnce);
        // Reschedule while the input is still held, even when this firing
        // attempted nothing: timers can fire a hair before nextActionAt
        // (clock jitter, dilated timers on loaded devices), and treating
        // that as the end of the chain silently killed the held repeat. A
        // rejected action clears heldInput via cancel(), so a dead hold
        // still stops the chain here.
        if (heldInput !== null) scheduleNext(repeatMs);
        return;
      }
      if (bufferedInput !== null) {
        // The buffered one-shot: a deliberate press delayed to the next
        // legal action time, then forgotten.
        const input = bufferedInput;
        bufferedInput = null;
        tryAction(input, repeatMs, false);
      }
    }, delayMs);
  };

  const press = (input: T, repeatMs: number): boolean => {
    // Only a genuine NEW press may buffer: OS keydown auto-repeat re-enters
    // press() with the direction already held, and letting those refresh the
    // buffer would fire one trailing step after the key is released.
    const gateClosed = clock.now() < nextActionAt;
    if (gateClosed && heldInput !== input) {
      if (
        bufferedInput !== null &&
        isOpposite &&
        isOpposite(bufferedInput, input)
      ) {
        // Tap-cancels-tap: the opposite press erases the pending move
        // instead of replacing it, so a quick correction nets to zero.
        bufferedInput = null;
      } else {
        bufferedInput = input;
      }
    }
    // A keydown repeat of the already-held direction is a continuation
    // of the hold, not new intent: once the hold has fired, its repeat
    // presses count as auto-repeat (otherwise an OS keydown repeat
    // arriving while the gate is open would masquerade as a deliberate
    // fresh press and, for "up", plant ladders mid-hold).
    const continuesHold = heldInput === input && heldFiredOnce;
    if (heldInput !== input) {
      heldInput = input;
      heldFiredOnce = false;
    }
    const attempted = tryAction(input, repeatMs, continuesHold);
    if (heldInput !== null || bufferedInput !== null) scheduleNext(repeatMs);
    return attempted;
  };

  const release = (input: T | null) => {
    if (input !== null && heldInput !== input) return;
    heldInput = null;
    heldFiredOnce = false;
    // A buffered tap survives its own release: it fires once at the next
    // legal time. Without a buffer there is nothing left to wait for.
    if (bufferedInput === null) clearTimer();
  };

  return {
    press,
    release,
    cancel,
  };
}
