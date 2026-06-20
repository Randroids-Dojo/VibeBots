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
    const delayMs = Math.max(0, nextActionAt - clock.now());
    timer = clock.setTimeout(() => {
      timer = null;
      if (heldInput === null) return;
      const attempted = tryAction(heldInput, repeatMs);
      if (attempted) scheduleHeld(repeatMs);
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
