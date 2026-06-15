"use client";

/**
 * Tiny WebAudio sfx, synthesized so the bundle ships no audio assets.
 * One lazily-created, gesture-resumed AudioContext is shared across
 * plays. Every call resumes it, so the first sound after a user gesture
 * (a move or tap) is audible on mobile, where contexts start suspended.
 */
let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
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

/**
 * The pick glancing off rock too hard to cut: a low body thud with a
 * short metallic clang ringing over it. Pure synthesis, gone in ~0.25s.
 */
export function playPickaxeClang(): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;

  // Master bus: keeps the whole hit short, punchy, and not too loud when
  // a player mashes into the same hard rock a few times.
  const out = ac.createGain();
  out.gain.setValueAtTime(0.5, now);
  out.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
  out.connect(ac.destination);

  // Low thud: the heft of the swing landing on something immovable.
  const thud = ac.createOscillator();
  thud.type = "triangle";
  thud.frequency.setValueAtTime(150, now);
  thud.frequency.exponentialRampToValueAtTime(46, now + 0.18);
  const thudGain = ac.createGain();
  thudGain.gain.setValueAtTime(0.0001, now);
  thudGain.gain.exponentialRampToValueAtTime(0.9, now + 0.008);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  thud.connect(thudGain).connect(out);
  thud.start(now);
  thud.stop(now + 0.24);

  // Metallic clang: a few inharmonic partials through a bandpass, each
  // gone in a blink, so steel-on-stone reads without turning shrill.
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 2400;
  band.Q.value = 0.7;
  band.connect(out);
  for (const [freq, level, len] of [
    [1850, 0.16, 0.13],
    [2550, 0.11, 0.1],
    [3400, 0.07, 0.08],
  ] as const) {
    const ring = ac.createOscillator();
    ring.type = "triangle";
    ring.frequency.setValueAtTime(freq, now);
    ring.frequency.exponentialRampToValueAtTime(freq * 0.82, now + len);
    const rg = ac.createGain();
    rg.gain.setValueAtTime(0.0001, now);
    rg.gain.exponentialRampToValueAtTime(level, now + 0.004);
    rg.gain.exponentialRampToValueAtTime(0.0001, now + len);
    ring.connect(rg).connect(band);
    ring.start(now);
    ring.stop(now + len + 0.02);
  }

  // Oscillators self-release when they stop, but the per-call master gain
  // and bandpass do not: drop them once the tail (the last-stopping thud)
  // finishes, so mashing a hard rock can't pile up dead nodes.
  thud.onended = () => {
    band.disconnect();
    out.disconnect();
  };
}
