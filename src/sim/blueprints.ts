import type { BotDesign } from "./design";

/**
 * Starter blueprints (J): one-tap, editable ready-made bots, one per chassis
 * archetype. They lower the blank-bench intimidation on a phone (Banjo Nuts
 * and Bolts lesson: ship working presets you can then tweak). Each is a valid
 * design (see blueprints.test.ts) within its core's power budget, with parts
 * placed to match that core's geometry (the low Wedge stays front-loaded; the
 * tall Tower carries the vertical spinner). Cores are free; the non-core parts
 * are a shopping list the player can see and build toward, since inventory is
 * only enforced at match-resolve.
 */
export interface Blueprint {
  id: string;
  label: string;
  blurb: string;
  design: BotDesign;
}

// Cube Rammer: the balanced all-rounder, two wheels and a front spike.
const CUBE_RAMMER: BotDesign = {
  name: "Cube Rammer",
  parts: [
    { iid: "core", partId: "core-cube" },
    { iid: "wheel-l", partId: "drive-wheel" },
    { iid: "wheel-r", partId: "drive-wheel" },
    { iid: "spike", partId: "ram-spike" },
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
      childIid: "spike",
      childConnector: "mount",
    },
  ],
  behavior: { aggression: 0.7, flankBias: 0.3, patience: 0.4 },
};

// Wedge Razor: the low front-loaded body, a plow to get under and a spike to
// bite. Its short top makes vertical stacks clip, so it stays front-loaded.
const WEDGE_RAZOR: BotDesign = {
  name: "Wedge Razor",
  parts: [
    { iid: "core", partId: "wedge-core" },
    { iid: "wheel-l", partId: "drive-wheel" },
    { iid: "wheel-r", partId: "drive-wheel" },
    { iid: "plow", partId: "plow-blade" },
    { iid: "spike", partId: "ram-spike" },
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
      childIid: "plow",
      childConnector: "mount",
    },
    {
      parentIid: "core",
      parentConnector: "front-right",
      childIid: "spike",
      childConnector: "mount",
    },
  ],
  behavior: { aggression: 0.85, flankBias: 0.5, patience: 0.2 },
};

// Tower Basher: the tall platform carries an overhead hammer on a mast (the
// tall body gives the arm clearance) with a front armor wedge.
const TOWER_BASHER: BotDesign = {
  name: "Tower Basher",
  parts: [
    { iid: "core", partId: "tower-core" },
    { iid: "wheel-l", partId: "drive-wheel" },
    { iid: "wheel-r", partId: "drive-wheel" },
    { iid: "mast", partId: "mast-pole" },
    { iid: "hammer", partId: "hammer-head" },
    { iid: "armor", partId: "armor-wedge" },
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
      parentConnector: "top",
      childIid: "mast",
      childConnector: "base",
    },
    {
      parentIid: "mast",
      parentConnector: "tip",
      childIid: "hammer",
      childConnector: "mount",
    },
    {
      parentIid: "core",
      parentConnector: "front",
      childIid: "armor",
      childConnector: "mount",
    },
  ],
  behavior: { aggression: 0.6, flankBias: 0.2, patience: 0.7 },
};

export const BLUEPRINTS: Blueprint[] = [
  {
    id: "cube-rammer",
    label: "Cube Rammer",
    blurb: "Balanced. Wheels and a front spike.",
    design: CUBE_RAMMER,
  },
  {
    id: "wedge-razor",
    label: "Wedge Razor",
    blurb: "Low and mean. Front plow and spike.",
    design: WEDGE_RAZOR,
  },
  {
    id: "tower-basher",
    label: "Tower Basher",
    blurb: "Tall and tough. Overhead hammer, front armor.",
    design: TOWER_BASHER,
  },
];
