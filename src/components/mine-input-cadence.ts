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
}: {
  clock: CadenceClock;
  onAction: (input: T) => boolean;
}): DirectionCadenceController<T> {
  let heldInput: T | null = null;
  let nextActionAt = 0;
  let timer: CadenceTimer | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    clock.clearTimeout(timer);
    timer = null;
  };

  const cancel = () => {
    heldInput = null;
    clearTimer();
  };

  const tryAction = (input: T, repeatMs: number): boolean => {
    const now = clock.now();
    if (now < nextActionAt) return false;
    if (!onAction(input)) {
      if (heldInput === input) cancel();
      return false;
    }
    nextActionAt = now + repeatMs;
    return true;
  };

  const scheduleHeld = (repeatMs: number) => {
    clearTimer();
    if (heldInput === null) return;
    // Always make forward progress: a zero-delay reschedule after an
    // early-fired timer would otherwise spin without advancing time.
    const delayMs = Math.max(1, nextActionAt - clock.now());
    timer = clock.setTimeout(() => {
      timer = null;
      if (heldInput === null) return;
      tryAction(heldInput, repeatMs);
      // Reschedule while the input is still held, even when this firing
      // attempted nothing: timers can fire a hair before nextActionAt
      // (clock jitter, dilated timers on loaded devices), and treating
      // that as the end of the chain silently killed the held repeat. A
      // rejected action clears heldInput via cancel(), so a dead hold
      // still stops the chain here.
      if (heldInput !== null) scheduleHeld(repeatMs);
    }, delayMs);
  };

  const press = (input: T, repeatMs: number): boolean => {
    if (heldInput === input) {
      const attempted = tryAction(input, repeatMs);
      if (attempted && heldInput !== null) scheduleHeld(repeatMs);
      return attempted;
    }
    heldInput = input;
    const attempted = tryAction(input, repeatMs);
    if (heldInput !== null) scheduleHeld(repeatMs);
    return attempted;
  };

  const release = (input: T | null) => {
    if (input !== null && heldInput !== input) return;
    cancel();
  };

  return {
    press,
    release,
    cancel,
  };
}
