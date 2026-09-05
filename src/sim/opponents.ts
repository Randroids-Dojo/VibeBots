import {
  type BotDesign,
  type BotRule,
  CPU_BRAWLER_DESIGN,
  CPU_BULLDOZER_DESIGN,
  type Pitch,
} from "./design";

/**
 * Replica opponents: stock CPU bots built to closely match specific iconic
 * Comedy Central era BattleBots (2000-2002) using only the current part
 * catalog and connectors. They validate that the part system and the shaping
 * pass can reproduce recognizable real robots (user-directed 2026-07-05). The
 * archetype reference is docs/research/battlebots-design-reference.html; the
 * silhouette targets are called out per bot. Display names are homages, not the
 * trademarked originals; `inspiredBy` records the real bot each one models so
 * the intent stays legible. Every design is valid within its core power budget
 * (see opponents.test.ts) and is selectable as a battle opponent.
 */
export interface ReplicaOpponent {
  id: string;
  /** Shipped display name (a homage, not the trademarked original). */
  name: string;
  /** The real BattleBot this design is modeled on. */
  inspiredBy: string;
  /** One line shown in the opponent picker. */
  blurb: string;
  design: BotDesign;
}

/**
 * Contagion (models BioHazard): the low wedge control bot. A wide flat plow
 * plate scoops across the low Wedge core nose to get under and lift, no
 * stinger. The plow is wide, so it rides the offset front connector (twin
 * plates or a centered mount would overlap the wheels), which still reads as a
 * full front lid on the ultra low body. Fights like the original: patient,
 * positional, all about winning the floor rather than swinging.
 */
const CONTAGION: BotDesign = {
  name: "Contagion",
  behavior: { aggression: 0.4, flankBias: 0.35, patience: 0.85 },
  parts: [
    { iid: "core", partId: "wedge-core" },
    { iid: "wheel-l", partId: "drive-wheel" },
    { iid: "wheel-r", partId: "drive-wheel" },
    { iid: "lid", partId: "plow-blade" },
  ],
  connections: [
    {
      parentIid: "core",
      parentConnector: "axle-left",
      childIid: "wheel-l",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "axle-right",
      childIid: "wheel-r",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "front-left",
      childIid: "lid",
      childConnector: "mount",
    },
  ],
};

/**
 * Night Terror (models Nightmare): the giant front vertical disc. A minimal
 * Cube body dragging behind a spin mounted blade on the nose that spins about
 * the forward axis, so the disc dominates the silhouette. Fights aggressively,
 * charging blade first with wide resets to bring the rim in.
 */
const NIGHT_TERROR: BotDesign = {
  name: "Night Terror",
  behavior: { aggression: 0.85, flankBias: 0.6, patience: 0.2 },
  parts: [
    { iid: "core", partId: "core-cube" },
    { iid: "wheel-l", partId: "drive-wheel" },
    { iid: "wheel-r", partId: "drive-wheel" },
    { iid: "mount", partId: "spin-mount" },
    { iid: "blade", partId: "saw-blade" },
  ],
  connections: [
    {
      parentIid: "core",
      parentConnector: "axle-left",
      childIid: "wheel-l",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "axle-right",
      childIid: "wheel-r",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "front",
      childIid: "mount",
      childConnector: "base",
    },
    {
      parentIid: "mount",
      parentConnector: "spindle",
      childIid: "blade",
      childConnector: "hub",
    },
  ],
};

/**
 * Impaler (models Vlad the Impaler): forward fork tines at floor level. A low
 * Wedge core with two ram spikes projecting forward from the nose like pallet
 * forks, to slide under and impale. Fights as a relentless aggressive rammer.
 */
const IMPALER: BotDesign = {
  name: "Impaler",
  behavior: { aggression: 0.9, flankBias: 0.4, patience: 0.15 },
  parts: [
    { iid: "core", partId: "wedge-core" },
    { iid: "wheel-l", partId: "drive-wheel" },
    { iid: "wheel-r", partId: "drive-wheel" },
    { iid: "fork-l", partId: "ram-spike" },
    { iid: "fork-r", partId: "ram-spike" },
  ],
  connections: [
    {
      parentIid: "core",
      parentConnector: "axle-left",
      childIid: "wheel-l",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "axle-right",
      childIid: "wheel-r",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "front-left",
      childIid: "fork-l",
      childConnector: "mount",
    },
    {
      parentIid: "core",
      parentConnector: "front-right",
      childIid: "fork-r",
      childConnector: "mount",
    },
  ],
};

export const REPLICA_OPPONENTS: ReplicaOpponent[] = [
  {
    id: "contagion",
    name: "Contagion",
    inspiredBy: "BioHazard",
    blurb: "Low wedge controller. Wide lifting lid, wins the floor.",
    design: CONTAGION,
  },
  {
    id: "night-terror",
    name: "Night Terror",
    inspiredBy: "Nightmare",
    blurb: "Giant front disc. Charges blade first.",
    design: NIGHT_TERROR,
  },
  {
    id: "impaler",
    name: "Impaler",
    inspiredBy: "Vlad the Impaler",
    blurb: "Forward fork spikes. Relentless rammer.",
    design: IMPALER,
  },
];

/**
 * One rung of the fight ladder (H2, breadth and expression program): a
 * stock opponent in the order the roster offers them, easiest first for
 * the first build a player makes (the Cube Rammer: cube, two wheels, a
 * spike). The order is measured, not guessed: opponents.test.ts fights
 * the Cube Rammer up the ladder and pins that it beats the first three
 * rungs, loses to the last two, and that the debrief's counter (a lance
 * in the spike's place) beats the last rung. Bulldozer was a bench-only
 * archetype until this; it is the missing rung between a fair fight and
 * a punishing one.
 */
export interface FightRung {
  id: string;
  name: string;
  /** One line for the picker's tooltip. */
  blurb: string;
  /** Two or three words under the name: what this rung asks of a build. */
  hint: string;
  /** The real BattleBot a replica models; house archetypes have none. */
  inspiredBy?: string;
  design: BotDesign;
  /**
   * The counter the ladder test proves beats this rung (F-250): a part
   * the player can buy, and the sentence the debrief says after a loss
   * to it. Every claim here is a measured case in opponents.test.ts.
   */
  counter: RungCounter;
  /**
   * A counter that costs nothing (the second lever, 2026-09-04): a weapon
   * the player may already carry, tilted to a preset angle, measured from
   * the player seat against this rung with the starter build.
   */
  pitchCounter?: RungPitchCounter;
  /**
   * A counter that costs nothing and needs no angle (the second rule
   * vocabulary, 2026-09-05): one bench rule, measured from the player
   * seat against this rung with the starter build.
   */
  ruleCounter?: RungRuleCounter;
}

export interface RungCounter {
  partId: string;
  text: string;
}

export interface RungRuleCounter {
  rule: BotRule;
  text: string;
}

export interface RungPitchCounter {
  partId: string;
  pitch: Pitch;
  text: string;
}

const replica = (id: string): ReplicaOpponent => {
  const found = REPLICA_OPPONENTS.find((opponent) => opponent.id === id);
  if (!found) throw new Error(`no replica opponent ${id}`);
  return found;
};

/**
 * Gravestone (models Tombstone, H4): a heavy horizontal bar on the nose,
 * drive wheels, a ballast tail, patient. Measured 2026-09-02 from the
 * opponent seat as the rung above a lance build: it beats the Cube
 * Rammer with a spike, a lance, or a tempered lance in its nose, and
 * loses to a tempered lance with a ballast tail of its own, to a bar
 * with a tail, and to a Bulldozer with a tail, so the rung has counters
 * a player can buy.
 */
const GRAVESTONE: BotDesign = {
  name: "Gravestone",
  behavior: { aggression: 0.6, flankBias: 0.6, patience: 0.7 },
  parts: [
    { iid: "core", partId: "core-cube" },
    { iid: "wheel-l", partId: "drive-wheel" },
    { iid: "wheel-r", partId: "drive-wheel" },
    { iid: "mount", partId: "spin-mount" },
    { iid: "bar", partId: "spinner-bar" },
    { iid: "tail", partId: "ballast-block" },
  ],
  connections: [
    {
      parentIid: "core",
      parentConnector: "axle-left",
      childIid: "wheel-l",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "axle-right",
      childIid: "wheel-r",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "front",
      childIid: "mount",
      childConnector: "base",
    },
    {
      parentIid: "mount",
      parentConnector: "spindle",
      childIid: "bar",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "back",
      childIid: "tail",
      childConnector: "nose",
    },
  ],
};

// Headstone: Gravestone's heavier sibling, the seventh rung (2026-09-04).
// The Heavy Bar with a Hardened Plate swept the six rungs the day it
// shipped, so the ladder needed a top that beats it. Measured from the
// player seat: Headstone beats the starter build, the Cube Lancer, the
// level Tempered Lance with a tail (Gravestone's counter), and the sweep
// build, and draws the sweep build with a tail; a Tempered Lance tilted up
// 15 beats it, tail or no tail, and up 30 with a tail.
const HEADSTONE: BotDesign = {
  name: "Headstone",
  behavior: { aggression: 0.6, flankBias: 0.6, patience: 0.7 },
  parts: [
    { iid: "core", partId: "core-cube" },
    { iid: "wheel-l", partId: "drive-wheel" },
    { iid: "wheel-r", partId: "drive-wheel" },
    { iid: "mount", partId: "spin-mount" },
    { iid: "bar", partId: "heavy-bar" },
    { iid: "plate", partId: "hardened-plate" },
    { iid: "tail", partId: "ballast-block" },
  ],
  connections: [
    {
      parentIid: "core",
      parentConnector: "axle-left",
      childIid: "wheel-l",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "axle-right",
      childIid: "wheel-r",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "front",
      childIid: "mount",
      childConnector: "base",
    },
    {
      parentIid: "mount",
      parentConnector: "spindle",
      childIid: "bar",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "top",
      childIid: "plate",
      childConnector: "bottom",
    },
    {
      parentIid: "core",
      parentConnector: "back",
      childIid: "tail",
      childConnector: "nose",
    },
  ],
};

export const FIGHT_LADDER: readonly FightRung[] = [
  {
    id: "brawler",
    name: CPU_BRAWLER_DESIGN.name,
    blurb: "The stock brawler: a plate on top and nothing up front.",
    hint: "warm-up",
    design: CPU_BRAWLER_DESIGN,
    counter: {
      partId: "ram-spike",
      text: "Brawler has nothing up front: a Ram Spike on the nose and two Drive Wheels beat it.",
    },
  },
  {
    ...replica("contagion"),
    hint: "controls the floor",
    counter: {
      partId: "ram-spike",
      text: "Contagion wins the floor, not the fight: a Ram Spike on the nose and two Drive Wheels beat it.",
    },
  },
  {
    ...replica("night-terror"),
    hint: "all blade",
    counter: {
      partId: "ram-spike",
      text: "Night Terror is all blade: a Ram Spike on the nose and two Drive Wheels beat it.",
    },
    pitchCounter: {
      partId: "lance",
      pitch: 15,
      text: "A level Lance only draws with Night Terror; tilted up 15 it wins.",
    },
  },
  {
    id: "bulldozer",
    name: CPU_BULLDOZER_DESIGN.name,
    blurb: "Low roller drums, an armour nose, and a plow that never lets go.",
    hint: "outshoves a spike",
    design: CPU_BULLDOZER_DESIGN,
    counter: {
      partId: "tower-core",
      text: "Bulldozer outshoves a cube: the Tower Core with the same wheels and spike shoves it back.",
    },
  },
  {
    ...replica("impaler"),
    hint: "punishes a spike",
    counter: {
      partId: "lance",
      text: "Impaler punishes a spike: a Lance in the spike's place outreaches it.",
    },
  },
  {
    id: "gravestone",
    name: GRAVESTONE.name,
    inspiredBy: "Tombstone",
    blurb:
      "A heavy bar on a ballast tail. Eats lances; a tempered lance with a tail of its own beats it.",
    hint: "punishes a lance",
    design: GRAVESTONE,
    counter: {
      partId: "tempered-lance",
      text: "Gravestone eats lances: a Tempered Lance with a Ballast Block for a tail beats it.",
    },
    pitchCounter: {
      partId: "ram-spike",
      pitch: 15,
      text: "A level Ram Spike loses to Gravestone; tilted up 15 it gets over the bar and wins.",
    },
  },
  {
    id: "headstone",
    name: HEADSTONE.name,
    blurb:
      "Gravestone's heavier sibling: a heavy bar on a plated deck with a tail. Eats any level lance; a tempered lance tilted up beats it.",
    hint: "eats a level lance",
    design: HEADSTONE,
    counter: {
      partId: "tempered-lance",
      text: "Headstone eats a level lance: a Tempered Lance tilted up 15 beats it, tail or no tail.",
    },
    pitchCounter: {
      partId: "tempered-lance",
      pitch: 15,
      text: "A level Tempered Lance loses to Headstone; tilted up 15 it gets over the bar and wins.",
    },
    ruleCounter: {
      rule: { when: "enemy-close", act: "charge" },
      text: "The starter build loses to Headstone; told to charge without resets when they are within arm's reach, it wins.",
    },
  },
];
