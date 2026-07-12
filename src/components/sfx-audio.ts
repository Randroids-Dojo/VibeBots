"use client";

/**
 * Shared WebAudio plumbing for the synthesized sfx (no audio assets).
 * One lazily-created, gesture-resumed AudioContext is shared across every
 * surface's sounds. Each surface keeps its own event vocabulary in its
 * own module (mine-sfx, workshop-sfx); only the context and the tone
 * primitive live here, so no surface imports another's event types.
 */

let ctx: AudioContext | null = null;

export function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export type ToneWave = OscillatorType;

/** One enveloped oscillator: quick attack, exponential decay over len. */
export function tone(
  ac: AudioContext,
  {
    wave = "sine",
    start,
    end,
    gain,
    at,
    len,
    out,
  }: {
    wave?: ToneWave;
    start: number;
    end?: number;
    gain: number;
    at: number;
    len: number;
    out: AudioNode;
  },
): OscillatorNode {
  const osc = ac.createOscillator();
  osc.type = wave;
  osc.frequency.setValueAtTime(start, at);
  if (end != null) osc.frequency.exponentialRampToValueAtTime(end, at + len);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + len + 0.02);
  osc.onended = () => g.disconnect();
  return osc;
}
