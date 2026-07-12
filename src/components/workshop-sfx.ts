"use client";

import { audioCtx, type ToneWave, tone } from "./sfx-audio";

/**
 * Workshop bench sfx (F-050): a short snap when a part places and a
 * brighter two-note chime when parts merge, matching the existing visual
 * snap and merge bump. Synthesized through the shared sfx-audio context
 * (gesture-resumed), with no mine event types imported anywhere here.
 */

export type WorkshopSfxEvent = "place" | "merge";

export interface WorkshopToneStep {
  wave: ToneWave;
  start: number;
  end?: number;
  gain: number;
  /** Offset from the play call, seconds. */
  delay: number;
  len: number;
}

/** The tone recipe per event; pure so the selection is unit-testable. */
export function workshopSfxTones(event: WorkshopSfxEvent): WorkshopToneStep[] {
  if (event === "merge") {
    // A brighter chime than the snap: a rising major third, the second
    // note landing as the merge bump settles.
    return [
      { wave: "sine", start: 660, gain: 0.1, delay: 0, len: 0.12 },
      { wave: "sine", start: 830, gain: 0.12, delay: 0.07, len: 0.18 },
    ];
  }
  // Place: one dry mechanical snap, a fast downward tick.
  return [
    { wave: "triangle", start: 420, end: 240, gain: 0.12, delay: 0, len: 0.07 },
    { wave: "square", start: 1400, gain: 0.03, delay: 0, len: 0.025 },
  ];
}

export function playWorkshopSfx(event: WorkshopSfxEvent): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  for (const step of workshopSfxTones(event)) {
    tone(ac, {
      wave: step.wave,
      start: step.start,
      end: step.end,
      gain: step.gain,
      at: now + step.delay,
      len: step.len,
      out: ac.destination,
    });
  }
}
