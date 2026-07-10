import { TEETER_EMISSIVE } from "./mine-render-palette";

/** Every renderable kind, in instanced write-out order. The union type
 * derives from this tuple so the two cannot drift. */
export const PARTICLE_KINDS = ["spark", "debris", "dust"] as const;
export type ParticleKind = (typeof PARTICLE_KINDS)[number];

export interface Particle {
  id: number;
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Downward pull per second (dust floats, debris drops). */
  gravity: number;
  size: number;
  color: string;
  /** Seconds of life remaining (counts down in useFrame). */
  life: number;
}

export interface JuiceState {
  particles: Particle[];
  nextId: number;
  /** Screen-shake magnitude, decays in useFrame. */
  shake: number;
  /** Seconds left in the pick-swing animation. */
  swing: number;
  /** Seconds left in the too-hard pick bounce (overrides swing). */
  bounce: number;
  /** Lateral facing: -1 left, 1 right, 0 camera-facing. */
  facing: number;
  /** Dig lunge: body offset toward the struck cell, decaying. */
  lunge: { x: number; y: number; t: number };
  /** Seconds left in the most recent falling-rock warning cue. */
  fallWarning: number;
  /** Seconds left of the ordinary-fall pose window (F-057). */
  fallAnim: number;
  /** Seconds left of the post-landing squash (F-057). */
  land: number;
  /** Throttle accumulator for rocket booster thrust puffs (F-056). */
  boosterSpawn: number;
}

export function pushParticle(juice: JuiceState, p: Omit<Particle, "id">): void {
  juice.particles.push({ ...p, id: juice.nextId++ });
  // Cap sized to the instanced render pools (W3); oldest are dropped
  // first so fresh bursts always show.
  if (juice.particles.length > 360)
    juice.particles.splice(0, juice.particles.length - 360);
}

/** Chunky debris in the struck block's color. */
export function spawnBurst(
  juice: JuiceState,
  x: number,
  y: number,
  color: string,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    pushParticle(juice, {
      kind: "debris",
      x: x + (Math.random() - 0.5) * 0.5,
      y: y + (Math.random() - 0.5) * 0.5,
      vx: (Math.random() - 0.5) * 3,
      vy: Math.random() * 2.5 + 0.5,
      gravity: 9,
      size: 0.1 + Math.random() * 0.09,
      color,
      life: 0.45 + Math.random() * 0.3,
    });
  }
}

export function spawnDirtBreakBurst(
  juice: JuiceState,
  x: number,
  y: number,
  color: string,
): void {
  const dustColors = [color, "#6f5a42", "#9a7450", "#4a3527"];
  for (let i = 0; i < 24; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    pushParticle(juice, {
      kind: "debris",
      x: x + (Math.random() - 0.5) * 0.52,
      y: y + (Math.random() - 0.5) * 0.42,
      vx: side * (0.9 + Math.random() * 2.9) + (Math.random() - 0.5) * 0.8,
      vy: 0.7 + Math.random() * 3.4,
      gravity: 10.5 + Math.random() * 4,
      size: 0.09 + Math.random() * 0.16,
      color: dustColors[i % dustColors.length],
      life: 0.5 + Math.random() * 0.42,
    });
  }
  for (let i = 0; i < 18; i++) {
    pushParticle(juice, {
      kind: "dust",
      x: x + (Math.random() - 0.5) * 0.72,
      y: y - 0.22 + Math.random() * 0.22,
      vx: (Math.random() - 0.5) * 1.9,
      vy: 0.28 + Math.random() * 1.05,
      gravity: 1.6 + Math.random() * 0.8,
      size: 0.13 + Math.random() * 0.16,
      color: dustColors[(i + 1) % dustColors.length],
      life: 0.72 + Math.random() * 0.48,
    });
  }
}

/** Hot pick-strike sparks: fast, bright, gone in a blink. */
export function spawnSparks(
  juice: JuiceState,
  x: number,
  y: number,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    pushParticle(juice, {
      kind: "spark",
      x: x + (Math.random() - 0.5) * 0.3,
      y: y + (Math.random() - 0.5) * 0.3,
      vx: (Math.random() - 0.5) * 6,
      vy: Math.random() * 3.5 + 0.8,
      gravity: 11,
      size: 0.05 + Math.random() * 0.04,
      color: "#ffe9a8",
      life: 0.14 + Math.random() * 0.16,
    });
  }
}

/**
 * A cold metallic shower when the pick glances off rock too hard to cut:
 * steel-white sparks spraying back toward the miner (no rock chips fly,
 * nothing breaks), keyed cool to read apart from a hot, successful hit.
 */
export function spawnClang(
  juice: JuiceState,
  x: number,
  y: number,
  awayX: number,
  awayY: number,
): void {
  for (let i = 0; i < 10; i++) {
    pushParticle(juice, {
      kind: "spark",
      x: x + (Math.random() - 0.5) * 0.3,
      y: y + (Math.random() - 0.5) * 0.3,
      vx: awayX * (2 + Math.random() * 3.5) + (Math.random() - 0.5) * 2.4,
      vy: awayY * (2 + Math.random() * 3.5) + (Math.random() - 0.5) * 2.4 + 0.6,
      gravity: 13,
      size: 0.045 + Math.random() * 0.05,
      color: i % 3 === 0 ? "#fff4cc" : "#cfe1ff",
      life: 0.12 + Math.random() * 0.16,
    });
  }
}

/**
 * Rocket booster exhaust: warm sparks jetting straight down under the
 * miner while the jump jets fire and hover (F-056). Short-lived so the
 * plume stays tight under the feet.
 */
export function spawnBoosterThrust(
  juice: JuiceState,
  x: number,
  y: number,
): void {
  for (let i = 0; i < 3; i++) {
    pushParticle(juice, {
      kind: "spark",
      x: x + (Math.random() - 0.5) * 0.2,
      y: y - 0.34,
      vx: (Math.random() - 0.5) * 0.9,
      vy: -(1.8 + Math.random() * 1.8),
      gravity: 3,
      size: 0.05 + Math.random() * 0.05,
      color: i === 0 ? "#fff2c0" : "#ff9a3c",
      life: 0.14 + Math.random() * 0.12,
    });
  }
}

/** A soft scuff of dust kicked up by treads on a plain move. */
export function spawnDust(juice: JuiceState, x: number, y: number): void {
  for (let i = 0; i < 3; i++) {
    pushParticle(juice, {
      kind: "dust",
      x: x + (Math.random() - 0.5) * 0.4,
      y: y - 0.35,
      vx: (Math.random() - 0.5) * 0.7,
      vy: Math.random() * 0.6 + 0.15,
      gravity: 1.2,
      size: 0.06 + Math.random() * 0.05,
      color: "#7a6a55",
      life: 0.4 + Math.random() * 0.35,
    });
  }
}

export function spawnFallWarning(
  juice: JuiceState,
  x: number,
  y: number,
): void {
  for (let i = 0; i < 12; i++) {
    pushParticle(juice, {
      kind: i % 3 === 0 ? "spark" : "dust",
      x: x + (Math.random() - 0.5) * 0.32,
      y: y + (Math.random() - 0.5) * 0.28,
      vx: (Math.random() - 0.5) * 1.2,
      vy: Math.random() * 1.6 + 0.25,
      gravity: 2.4,
      size: 0.055 + Math.random() * 0.06,
      color: i % 3 === 0 ? "#ffe08a" : TEETER_EMISSIVE,
      life: 0.34 + Math.random() * 0.2,
    });
  }
}

export function spawnLadderFall(
  juice: JuiceState,
  x: number,
  fromY: number,
  toY: number,
): void {
  const distance = Math.max(1, Math.abs(toY - fromY));
  const chips = Math.min(10, 4 + Math.floor(distance * 2));
  for (let i = 0; i < chips; i++) {
    const ratio = chips <= 1 ? 1 : i / (chips - 1);
    pushParticle(juice, {
      kind: "debris",
      x: x + (Math.random() - 0.5) * 0.34,
      y: fromY + (toY - fromY) * ratio + (Math.random() - 0.5) * 0.2,
      vx: (Math.random() - 0.5) * 1.5,
      vy: Math.random() * 1.2 + 0.15,
      gravity: 7.5,
      size: 0.07 + Math.random() * 0.05,
      color: i % 3 === 0 ? "#f0c36b" : "#c88a3d",
      life: 0.28 + Math.random() * 0.22,
    });
  }
  const dust = Math.min(5, 2 + Math.floor(distance));
  for (let i = 0; i < dust; i++) {
    pushParticle(juice, {
      kind: "dust",
      x: x + (Math.random() - 0.5) * 0.46,
      y: toY - 0.34 + Math.random() * 0.12,
      vx: (Math.random() - 0.5) * 0.9,
      vy: Math.random() * 0.7 + 0.15,
      gravity: 1.1,
      size: 0.08 + Math.random() * 0.05,
      color: "#806a4e",
      life: 0.45 + Math.random() * 0.35,
    });
  }
}

/** Slow-falling sparkle in the broken ore's color: the treasure moment
 * lingers a beat longer than the dirt around it. */
export function spawnOreGlitter(
  juice: JuiceState,
  x: number,
  y: number,
  color: string,
  glow: boolean,
): void {
  const count = glow ? 14 : 9;
  for (let i = 0; i < count; i++) {
    pushParticle(juice, {
      kind: "spark",
      x: x + (Math.random() - 0.5) * 0.6,
      y: y + (Math.random() - 0.5) * 0.5,
      vx: (Math.random() - 0.5) * 1.4,
      vy: 0.5 + Math.random() * 1.4,
      gravity: 2.6,
      size: 0.035 + Math.random() * 0.045,
      color,
      life: 0.6 + Math.random() * 0.5,
    });
  }
}

/** Rising sickly wisps when a gas pocket vents. */
export function spawnGasHiss(juice: JuiceState, x: number, y: number): void {
  for (let i = 0; i < 12; i++) {
    pushParticle(juice, {
      kind: "dust",
      x: x + (Math.random() - 0.5) * 0.5,
      y: y + (Math.random() - 0.5) * 0.3,
      vx: (Math.random() - 0.5) * 0.8,
      vy: 0.8 + Math.random() * 1.2,
      // Negative pull: the cloud keeps climbing as it fades.
      gravity: -1.4 - Math.random() * 0.8,
      size: 0.1 + Math.random() * 0.12,
      color: i % 3 === 0 ? "#c8dc5a" : "#8fa32e",
      life: 0.8 + Math.random() * 0.5,
    });
  }
}
