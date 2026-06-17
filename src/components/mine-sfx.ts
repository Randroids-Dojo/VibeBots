"use client";

import type { CellKind, MineAction, MoveResult, OreId } from "@/sim/mine";

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

type ToneWave = OscillatorType;

export type MineSfxEvent =
  | "step"
  | "strike-dirt"
  | "strike-rock"
  | "strike-ore"
  | "strike-cache"
  | "dig-dirt"
  | "dig-rock"
  | `dig-ore-${OreId}`
  | "dig-cache"
  | "ore-pickup"
  | "cache-fanfare"
  | "dynamite"
  | "gas"
  | "crush"
  | "fall-death"
  | "collapse"
  | "abandon"
  | "recall"
  | "ladder"
  | "plank"
  | "beacon"
  | "warp"
  | "elevator"
  | "buy"
  | "sell"
  | "deny"
  | "clang";

const ORE_PITCH: Record<OreId, number> = {
  coal: 0.72,
  copper: 0.9,
  silver: 1.08,
  emerald: 1.28,
  ruby: 1.48,
  diamond: 1.7,
  "core-crystal": 2.0,
};

function clean(nodes: AudioNode[], delayMs: number): void {
  window.setTimeout(() => {
    for (const node of nodes) node.disconnect();
  }, delayMs);
}

function tone(
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

function burstNoise(
  ac: AudioContext,
  out: AudioNode,
  at: number,
  len: number,
  gain: number,
  filterFreq: number,
): AudioBufferSourceNode {
  const sampleRate = ac.sampleRate;
  const buffer = ac.createBuffer(
    1,
    Math.max(1, Math.floor(sampleRate * len)),
    sampleRate,
  );
  const data = buffer.getChannelData(0);
  let v = 0x12345678;
  for (let i = 0; i < data.length; i++) {
    v ^= v << 13;
    v ^= v >>> 17;
    v ^= v << 5;
    data[i] = ((v >>> 0) / 2147483648 - 1) * (1 - i / data.length);
  }
  const source = ac.createBufferSource();
  source.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterFreq;
  filter.Q.value = 0.9;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  source.connect(filter).connect(g).connect(out);
  source.start(at);
  source.stop(at + len);
  source.onended = () => {
    filter.disconnect();
    g.disconnect();
  };
  return source;
}

function bus(ac: AudioContext, level: number, len: number): GainNode {
  const now = ac.currentTime;
  const out = ac.createGain();
  out.gain.setValueAtTime(level, now);
  out.gain.exponentialRampToValueAtTime(0.0001, now + len);
  out.connect(ac.destination);
  clean([out], Math.ceil((len + 0.08) * 1000));
  return out;
}

function strikeEvent(kind: CellKind): MineSfxEvent {
  if (kind === "rock") return "strike-rock";
  if (kind === "ore") return "strike-ore";
  if (kind === "part-cache") return "strike-cache";
  return "strike-dirt";
}

function isPlainMove(action: MineAction | null): boolean {
  return (
    action === "left" ||
    action === "right" ||
    action === "up" ||
    action === "down"
  );
}

export function mineResultSfxEvents(
  result: MoveResult | null,
  action: MineAction | null,
): MineSfxEvent[] {
  if (!result) return [];
  if (!result.ok) return result.reason === "rock" ? ["clang"] : ["deny"];

  const events: MineSfxEvent[] = [];
  if (result.cracked) events.push(strikeEvent(result.cracked.kind));
  if (result.dug) {
    if (result.dugOre) events.push(`dig-ore-${result.dugOre}`);
    else if (result.dug === "rock") events.push("dig-rock");
    else if (result.dug === "part-cache") events.push("dig-cache");
    else events.push("dig-dirt");
  } else if (isPlainMove(action) && !result.cracked) {
    events.push("step");
  }

  if (result.laddered) events.push("ladder");
  if (result.planked || result.plankPlaced) events.push("plank");
  if (result.exploded || (result.blasted ?? 0) > 0) events.push("dynamite");
  if ((result.vented ?? 0) > 0) events.push("gas");
  if (result.dugOre) events.push("ore-pickup");
  if (result.found) events.push("cache-fanfare");
  if (result.recalled) events.push("recall");
  if (action === "place-beacon") events.push("beacon");
  if (action === "warp-down" || action === "warp-home") events.push("warp");
  if (action === "ride-down" || action === "ride-up") events.push("elevator");
  if (result.abandoned) events.push("abandon");
  else if (result.fallFatal) {
    // The renderer plays the death cue at impact, not when the sim resets.
  } else if (result.crushed) events.push("crush");
  else if (result.collapsed) events.push("collapse");

  return events;
}

export function mineShopNoteSfxEvent(note: string | null): MineSfxEvent | null {
  if (!note) return null;
  if (
    note.includes("failed") ||
    note.includes("offline") ||
    note.includes("not enough") ||
    note.includes("nothing was charged")
  ) {
    return "deny";
  }
  return "buy";
}

function playStep(): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const out = bus(ac, 0.22, 0.12);
  tone(ac, {
    wave: "triangle",
    start: 84,
    end: 58,
    gain: 0.22,
    at: now,
    len: 0.08,
    out,
  });
  burstNoise(ac, out, now, 0.07, 0.08, 420);
}

function playStrike(kind: MineSfxEvent): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const out = bus(ac, 0.34, 0.2);
  if (kind === "strike-rock") {
    tone(ac, {
      wave: "triangle",
      start: 120,
      end: 62,
      gain: 0.28,
      at: now,
      len: 0.14,
      out,
    });
    burstNoise(ac, out, now, 0.09, 0.09, 1500);
  } else if (kind === "strike-ore") {
    tone(ac, {
      wave: "sine",
      start: 620,
      end: 760,
      gain: 0.15,
      at: now,
      len: 0.12,
      out,
    });
    burstNoise(ac, out, now, 0.08, 0.06, 2200);
  } else if (kind === "strike-cache") {
    tone(ac, {
      wave: "square",
      start: 220,
      end: 170,
      gain: 0.1,
      at: now,
      len: 0.1,
      out,
    });
    tone(ac, {
      wave: "triangle",
      start: 920,
      end: 680,
      gain: 0.08,
      at: now + 0.02,
      len: 0.12,
      out,
    });
  } else {
    tone(ac, {
      wave: "triangle",
      start: 96,
      end: 64,
      gain: 0.18,
      at: now,
      len: 0.1,
      out,
    });
    burstNoise(ac, out, now, 0.08, 0.07, 520);
  }
}

function playDig(event: MineSfxEvent): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const out = bus(ac, 0.44, 0.28);
  if (event === "dig-rock") {
    tone(ac, {
      wave: "triangle",
      start: 145,
      end: 46,
      gain: 0.36,
      at: now,
      len: 0.2,
      out,
    });
    burstNoise(ac, out, now, 0.15, 0.16, 1050);
  } else if (event === "dig-cache") {
    tone(ac, {
      wave: "square",
      start: 190,
      end: 130,
      gain: 0.14,
      at: now,
      len: 0.13,
      out,
    });
    tone(ac, {
      wave: "triangle",
      start: 780,
      end: 1050,
      gain: 0.1,
      at: now + 0.05,
      len: 0.16,
      out,
    });
    burstNoise(ac, out, now, 0.08, 0.08, 800);
  } else if (event.startsWith("dig-ore-")) {
    const ore = event.slice("dig-ore-".length) as OreId;
    const pitch = ORE_PITCH[ore] ?? 1;
    tone(ac, {
      wave: "sine",
      start: 260 * pitch,
      end: 410 * pitch,
      gain: 0.16,
      at: now,
      len: 0.18,
      out,
    });
    tone(ac, {
      wave: "triangle",
      start: 620 * pitch,
      end: 540 * pitch,
      gain: 0.08,
      at: now + 0.02,
      len: 0.16,
      out,
    });
    burstNoise(ac, out, now, 0.09, 0.08, 1600 * pitch);
  } else {
    tone(ac, {
      wave: "triangle",
      start: 105,
      end: 52,
      gain: 0.28,
      at: now,
      len: 0.18,
      out,
    });
    burstNoise(ac, out, now, 0.12, 0.16, 480);
  }
}

function playPickup(): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const out = bus(ac, 0.22, 0.34);
  tone(ac, {
    wave: "sine",
    start: 720,
    end: 920,
    gain: 0.11,
    at: now,
    len: 0.12,
    out,
  });
  tone(ac, {
    wave: "sine",
    start: 930,
    end: 1260,
    gain: 0.09,
    at: now + 0.08,
    len: 0.15,
    out,
  });
}

function playCacheFanfare(): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const out = bus(ac, 0.3, 0.62);
  for (const [i, freq] of [520, 660, 880, 1320].entries()) {
    tone(ac, {
      wave: "triangle",
      start: freq,
      gain: 0.08,
      at: now + i * 0.09,
      len: 0.16,
      out,
    });
  }
}

function playDynamite(): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const out = bus(ac, 0.58, 0.55);
  tone(ac, {
    wave: "sawtooth",
    start: 82,
    end: 28,
    gain: 0.42,
    at: now,
    len: 0.34,
    out,
  });
  burstNoise(ac, out, now, 0.28, 0.28, 120);
  burstNoise(ac, out, now + 0.03, 0.24, 0.18, 1600);
}

function playGas(): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const out = bus(ac, 0.36, 0.42);
  burstNoise(ac, out, now, 0.32, 0.18, 2400);
  tone(ac, {
    wave: "sawtooth",
    start: 170,
    end: 90,
    gain: 0.09,
    at: now,
    len: 0.28,
    out,
  });
}

function playDeath(kind: MineSfxEvent): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const out = bus(ac, 0.42, 0.8);
  if (kind === "abandon") {
    tone(ac, {
      wave: "triangle",
      start: 260,
      end: 130,
      gain: 0.18,
      at: now,
      len: 0.35,
      out,
    });
    tone(ac, {
      wave: "sine",
      start: 420,
      end: 320,
      gain: 0.06,
      at: now + 0.1,
      len: 0.34,
      out,
    });
  } else if (kind === "fall-death") {
    tone(ac, {
      wave: "sawtooth",
      start: 160,
      end: 28,
      gain: 0.32,
      at: now,
      len: 0.42,
      out,
    });
    burstNoise(ac, out, now + 0.03, 0.28, 0.26, 180);
    burstNoise(ac, out, now + 0.12, 0.2, 0.12, 900);
  } else {
    tone(ac, {
      wave: "sawtooth",
      start: kind === "crush" ? 120 : 170,
      end: 36,
      gain: 0.26,
      at: now,
      len: 0.45,
      out,
    });
    burstNoise(ac, out, now + 0.08, 0.24, kind === "crush" ? 0.22 : 0.12, 360);
  }
}

function playRecall(): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const out = bus(ac, 0.28, 0.5);
  tone(ac, {
    wave: "sine",
    start: 360,
    end: 900,
    gain: 0.14,
    at: now,
    len: 0.3,
    out,
  });
  tone(ac, {
    wave: "triangle",
    start: 680,
    end: 1280,
    gain: 0.07,
    at: now + 0.08,
    len: 0.26,
    out,
  });
}

function playBuild(event: MineSfxEvent): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const out = bus(ac, 0.28, 0.28);
  if (event === "ladder" || event === "plank") {
    tone(ac, {
      wave: "triangle",
      start: event === "ladder" ? 210 : 180,
      end: 120,
      gain: 0.14,
      at: now,
      len: 0.12,
      out,
    });
    burstNoise(ac, out, now + 0.02, 0.08, 0.08, event === "ladder" ? 950 : 620);
  } else if (event === "beacon") {
    tone(ac, {
      wave: "sine",
      start: 430,
      end: 860,
      gain: 0.12,
      at: now,
      len: 0.22,
      out,
    });
    tone(ac, {
      wave: "sine",
      start: 1290,
      end: 980,
      gain: 0.06,
      at: now + 0.04,
      len: 0.22,
      out,
    });
  }
}

function playTransport(event: MineSfxEvent): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const out = bus(ac, 0.3, 0.5);
  if (event === "elevator") {
    tone(ac, {
      wave: "sawtooth",
      start: 95,
      end: 155,
      gain: 0.12,
      at: now,
      len: 0.34,
      out,
    });
    burstNoise(ac, out, now, 0.2, 0.05, 360);
  } else {
    tone(ac, {
      wave: "sine",
      start: 520,
      end: 1420,
      gain: 0.11,
      at: now,
      len: 0.28,
      out,
    });
    tone(ac, {
      wave: "triangle",
      start: 1100,
      end: 440,
      gain: 0.06,
      at: now + 0.12,
      len: 0.25,
      out,
    });
  }
}

function playCommerce(event: MineSfxEvent): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const out = bus(ac, 0.26, 0.44);
  if (event === "deny") {
    tone(ac, {
      wave: "triangle",
      start: 170,
      end: 92,
      gain: 0.14,
      at: now,
      len: 0.18,
      out,
    });
    return;
  }
  const notes = event === "sell" ? [620, 880, 1180] : [460, 690];
  for (const [i, freq] of notes.entries()) {
    tone(ac, {
      wave: "triangle",
      start: freq,
      gain: 0.08,
      at: now + i * 0.07,
      len: 0.13,
      out,
    });
  }
}

export function playMineSfxEvent(event: MineSfxEvent): void {
  if (event === "clang") {
    playPickaxeClang();
  } else if (event === "step") {
    playStep();
  } else if (event.startsWith("strike-")) {
    playStrike(event);
  } else if (event.startsWith("dig-")) {
    playDig(event);
  } else if (event === "ore-pickup") {
    playPickup();
  } else if (event === "cache-fanfare") {
    playCacheFanfare();
  } else if (event === "dynamite") {
    playDynamite();
  } else if (event === "gas") {
    playGas();
  } else if (
    event === "crush" ||
    event === "fall-death" ||
    event === "collapse" ||
    event === "abandon"
  ) {
    playDeath(event);
  } else if (event === "recall") {
    playRecall();
  } else if (event === "ladder" || event === "plank" || event === "beacon") {
    playBuild(event);
  } else if (event === "warp" || event === "elevator") {
    playTransport(event);
  } else if (event === "buy" || event === "sell" || event === "deny") {
    playCommerce(event);
  }
}

export function playMineResultSfx(
  result: MoveResult | null,
  action: MineAction | null,
): void {
  for (const event of mineResultSfxEvents(result, action)) {
    playMineSfxEvent(event);
  }
}

/**
 * The pick glancing off rock too hard to cut: a low body thud with a
 * short metallic clang ringing over it. Pure synthesis, gone in ~0.25s.
 */
function playPickaxeClang(): void {
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
