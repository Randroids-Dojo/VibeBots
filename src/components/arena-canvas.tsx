"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Color,
  type Group,
  type InstancedMesh,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three/webgpu";
import {
  type ArenaCameraBounds,
  arenaCameraBoundsCenter,
  arenaCameraBoundsReady,
  arenaCameraFrameForBounds,
  emptyArenaCameraBounds,
  includeArenaCameraBounds,
  includeArenaCameraPoint,
} from "@/components/arena-camera";
import { partLook } from "@/components/part-look";
import {
  createWebGPU,
  partGeometry,
  partVertexColors,
  shapeRotation,
} from "@/components/part-visuals";
import { PerfProbeBridge } from "@/components/perf-probe-bridge";
import { paintedColor } from "@/lib/bot-paint";
import {
  ARENA_WALL_HALF_EXTENT,
  ARENA_WALL_HEIGHT,
  ARENA_WALL_THICKNESS,
  createArenaWorld,
} from "@/sim/arena";
import {
  createMatch,
  freeMatch,
  type MatchEndReason,
  type MatchScore,
  type MatchState,
  stepMatch,
  teardownInputFrom,
} from "@/sim/combat";
import { DT } from "@/sim/constants";
import {
  type BotDesign,
  CPU_BRAWLER_DESIGN,
  CPU_BULLDOZER_DESIGN,
  CPU_WHIRLIGIG_DESIGN,
  TEST_BOT_DESIGN,
} from "@/sim/design";
import { PART_CATALOG } from "@/sim/parts";
import { matchResultHash } from "@/sim/resolve";
import { buildTeardown, type MatchTeardown } from "@/sim/telemetry";
import { setDatasetNumber, setDatasetText } from "./dataset-diagnostics";
import { FallbackDprCap } from "./fallback-dpr-cap";
import {
  graphicsFeaturesFor,
  hasCoarsePointer,
  isWebGPUBackend,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";
import { useBlockDetail } from "./mine-block-render";
import { surfaceBareMetal, surfaceComposite } from "./mine-surface-materials";
import { StudioEnvironment } from "./studio-environment";

/** Clamp on accumulated frame time so a background tab cannot spiral. */
const MAX_FRAME_DELTA = 0.25;
/** Seconds to linger on the end banner before the next exhibition match. */
const RESTART_DELAY_SECONDS = 4;

const BOT_COLORS = ["#ff9f43", "#54e0c7"] as const;
/** Hull colour of a destroyed part: the part's own base, charred. */
const DESTROYED_DIM = 0.4;
/** Rammer at index 1: its spike (front connector, -z) faces the enemy.
 * Exhibitions rotate through the stock matchups so every visit shows a
 * different clash; the rotation is deterministic per page load. */
const EXHIBITION_MATCHUPS: [BotDesign, BotDesign][] = [
  [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN],
  [CPU_WHIRLIGIG_DESIGN, CPU_BULLDOZER_DESIGN],
  [CPU_BULLDOZER_DESIGN, TEST_BOT_DESIGN],
  [CPU_WHIRLIGIG_DESIGN, CPU_BRAWLER_DESIGN],
];
const EXHIBITION_DESIGNS: [BotDesign, BotDesign] = EXHIBITION_MATCHUPS[0];
const ARENA_CAMERA_SMOOTHING = 3.2;
/** Pre-fight countdown, seconds per step of 3..2..1..FIGHT. */
const COUNTDOWN_STEP_SECONDS = 0.8;
const COUNTDOWN_STEPS = 4;
const SPARK_CAPACITY = 96;
/** Per-category surface response; tint stays the bot color. */
interface ArenaSpark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  color: string;
}
const ARENA_CAMERA_PART_PADDING = 1.2;

/**
 * Deck and barrier geometry derived from the sim's bounce-wall ring
 * (F-063), so the concrete the player sees lines up with the colliders the
 * bots actually rebound off. The wall centers sit half a thickness past the
 * inner ring face; the deck reaches to the walls' outer face.
 */
const ARENA_WALL_CENTER = ARENA_WALL_HALF_EXTENT + ARENA_WALL_THICKNESS;
const ARENA_DECK_HALF = ARENA_WALL_CENTER + ARENA_WALL_THICKNESS;
const ARENA_DECK_SIZE = ARENA_DECK_HALF * 2;
const ARENA_WALL_SPAN = ARENA_DECK_SIZE;
// Rendered wall height and center match the sim collider exactly, so the
// bounce reads true (no visible/collider mismatch).
const ARENA_WALL_RENDER_HEIGHT = ARENA_WALL_HEIGHT;
const ARENA_WALL_RENDER_THICKNESS = ARENA_WALL_THICKNESS * 2;
const ARENA_WALL_RENDER_Y = ARENA_WALL_RENDER_HEIGHT / 2;

interface ArenaRun {
  match: MatchState;
  dispose: () => void;
}

async function bootMatch(designs: [BotDesign, BotDesign]): Promise<ArenaRun> {
  const world = await createArenaWorld();
  // Recorded so the fight can be taken apart afterwards. Impacts arrive at
  // contact cadence, not frame cadence, and the log is capped, so this is
  // not steady-state frame-loop allocation.
  const match = createMatch(world, designs, { telemetry: true });
  return {
    match,
    dispose: () => {
      freeMatch(match);
      world.free();
    },
  };
}

export interface HudPartPip {
  iid: string;
  healthRatio: number;
  destroyed: boolean;
}

export interface HudBot {
  label: string;
  healthPercent: number;
  partsRemaining: number;
  partCount: number;
  pips: HudPartPip[];
}

export interface HudState {
  bots: [HudBot, HudBot];
  banner: string | null;
}

function readHud(match: MatchState): HudState {
  const labels = match.bots.map((bot) => bot.design.name);
  const bots = match.bots.map((bot, index) => {
    let health = 0;
    let maxHealth = 0;
    let partsRemaining = 0;
    const pips: HudPartPip[] = [];
    for (const part of bot.design.parts) {
      const state = bot.parts.get(part.iid);
      if (!state) continue;
      health += state.health;
      maxHealth += state.maxHealth;
      if (!state.destroyed) partsRemaining += 1;
      pips.push({
        iid: part.iid,
        healthRatio: state.maxHealth > 0 ? state.health / state.maxHealth : 0,
        destroyed: state.destroyed,
      });
    }
    return {
      label: labels[index],
      healthPercent: maxHealth > 0 ? Math.round((health / maxHealth) * 100) : 0,
      partsRemaining,
      partCount: bot.parts.size,
      pips,
    };
  }) as [HudBot, HudBot];

  let banner: string | null = null;
  const status = match.status;
  if (status.over) {
    const detail =
      status.reason === "timeout"
        ? ` (${Math.round(status.scores[0].total)} vs ${Math.round(status.scores[1].total)})`
        : "";
    banner =
      status.winner === null
        ? `Draw by ${status.reason}${detail}`
        : `${labels[status.winner]} wins by ${status.reason}${detail}`;
  }
  return { bots, banner };
}

interface PartView {
  prevPos: Vector3;
  currPos: Vector3;
  prevRot: Quaternion;
  currRot: Quaternion;
}

type MatchBot = MatchState["bots"][number];

function newPartView(): PartView {
  return {
    prevPos: new Vector3(),
    currPos: new Vector3(),
    prevRot: new Quaternion(),
    currRot: new Quaternion(),
  };
}

function includeBotPartBounds(
  bounds: ArenaCameraBounds,
  bot: MatchBot,
  botIndex: 0 | 1,
  groups: Map<string, Group | null>,
  includeDestroyed: boolean,
): number {
  let count = 0;
  for (const iid of bot.assembled.bodies.keys()) {
    const group = groups.get(`${botIndex}:${iid}`);
    if (!group) continue;
    if (!includeDestroyed && (bot.parts.get(iid)?.destroyed ?? false)) {
      continue;
    }
    includeArenaCameraPoint(
      bounds,
      group.position.x,
      group.position.y,
      group.position.z,
      ARENA_CAMERA_PART_PADDING,
    );
    count += 1;
  }
  return count;
}

export interface MatchEndInfo {
  hash: string;
  tick: number;
  /** The inspection sheet for the fight that just ended. */
  teardown: MatchTeardown | null;
  /** How it ended, for the debrief (G9): who, why, and the judges' card. */
  winner: 0 | 1 | null;
  reason: MatchEndReason;
  scores: readonly [MatchScore, MatchScore] | null;
}

function ArenaScene({
  designs,
  stageRef,
  onHud,
  onMatchEnd,
  onMatchStart,
  onCountdown,
}: {
  designs: [BotDesign, BotDesign];
  stageRef: RefObject<HTMLDivElement | null>;
  onHud: (hud: HudState) => void;
  onMatchEnd?: (info: MatchEndInfo) => void;
  /** Fired when the exhibition loop boots the next fight. */
  onMatchStart?: () => void;
  onCountdown: (label: string | null) => void;
}) {
  const runRef = useRef<ArenaRun | null>(null);
  // Quantize-and-cache diagnostics (frame-loop-performance rule).
  const datasetCache = useRef<Record<string, number | string>>({});
  /** Bumped on every effect (re)run and cleanup; stale async boots check it. */
  const generationRef = useRef(0);
  const accumulatorRef = useRef(0);
  const endLingerRef = useRef(0);
  const restartingRef = useRef(false);
  const lastHudTickRef = useRef(-1);
  const bannerShownRef = useRef(false);
  const viewsRef = useRef(new Map<string, PartView>());
  const groupRefs = useRef(new Map<string, Group | null>());
  const materialRefs = useRef(new Map<string, MeshStandardMaterial | null>());
  const sparkInstRef = useRef<InstancedMesh>(null);
  const sparks = useRef<ArenaSpark[]>([]);
  const sparkMatrix = useRef(new Matrix4());
  const sparkColor = useRef(new Color());
  const partHealthSnapshot = useRef(new Map<string, number>());
  /** Seconds remaining in the pre-fight countdown; sim holds until 0. */
  const countdownRef = useRef(COUNTDOWN_STEP_SECONDS * COUNTDOWN_STEPS);
  const exhibitionCycleRef = useRef(0);
  // The active matchup: exhibitions rotate it per restart, and the part
  // meshes must render the same designs the sim is stepping.
  const [activeDesigns, setActiveDesigns] = useState(designs);
  // Per-part base hull colours and the core key per bot, at design cadence
  // (G5). A painted design wears its paint (body on core and structure,
  // trim on wheel hubs, steel weapons untouched); an unpainted design
  // keeps the team colour on every part so stock fighters stay legible.
  const teamColors = useMemo(
    () => [new Color(BOT_COLORS[0]), new Color(BOT_COLORS[1])] as const,
    [],
  );
  const baseColors = useMemo(() => {
    const map = new Map<string, Color>();
    activeDesigns.forEach((design, botIndex) => {
      for (const part of design.parts) {
        const def = PART_CATALOG[part.partId];
        if (!def) continue;
        const hex = design.paint
          ? paintedColor(def, design.paint, partLook(def).color)
          : BOT_COLORS[botIndex];
        map.set(`${botIndex}:${part.iid}`, new Color(hex));
      }
    });
    return map;
  }, [activeDesigns]);
  const baseColorsRef = useRef(baseColors);
  const coreKeys = useMemo(
    () =>
      activeDesigns.map((design, botIndex) => {
        const core = design.parts.find(
          (part) => PART_CATALOG[part.partId]?.category === "core",
        );
        return `${botIndex}:${core?.iid ?? "core"}`;
      }),
    [activeDesigns],
  );
  const coreKeysRef = useRef(coreKeys);
  const ringRefs = useRef<(Mesh | null)[]>([null, null]);
  const glForPaint = useThree((state) => state.gl);
  useEffect(() => {
    baseColorsRef.current = baseColors;
    coreKeysRef.current = coreKeys;
    // Publish each bot's paint so a test can read it off the DOM.
    const dataset = (glForPaint.domElement as HTMLCanvasElement).dataset;
    activeDesigns.forEach((design, botIndex) => {
      dataset[`botPaint${botIndex}`] = design.paint
        ? `${design.paint.primary}:${design.paint.accent}`
        : "none";
      // And the team ring under each bot, which keeps the sides readable
      // however the hulls are painted.
      dataset[`teamRing${botIndex}`] =
        `#${teamColors[botIndex].getHexString()}`;
    });
  }, [baseColors, coreKeys, activeDesigns, glForPaint, teamColors]);
  const desiredCameraPositionRef = useRef(new Vector3(8, 5, 10));
  const desiredCameraLookAtRef = useRef(new Vector3(0, 1, 0));
  const projectedBotRef = useRef<[Vector3, Vector3]>([
    new Vector3(),
    new Vector3(),
  ]);
  const projectedEdgeRef = useRef(new Vector3());

  const syncViews = useCallback((match: MatchState, hard: boolean) => {
    for (const [index, bot] of match.bots.entries()) {
      for (const [iid, body] of bot.assembled.bodies) {
        const key = `${index}:${iid}`;
        let view = viewsRef.current.get(key);
        if (!view) {
          view = newPartView();
          viewsRef.current.set(key, view);
        }
        const t = body.translation();
        const r = body.rotation();
        view.currPos.set(t.x, t.y, t.z);
        view.currRot.set(r.x, r.y, r.z, r.w);
        if (hard) {
          view.prevPos.copy(view.currPos);
          view.prevRot.copy(view.currRot);
        }
      }
    }
  }, []);

  useEffect(() => {
    // The parts and paint render from activeDesigns; keep it on the tuple
    // the match boots from, or a new designs prop would step a new sim
    // under the old bots until an exhibition restart.
    setActiveDesigns(designs);
    const generation = ++generationRef.current;
    bootMatch(designs).then((run) => {
      if (generationRef.current !== generation) {
        run.dispose();
        return;
      }
      runRef.current = run;
      syncViews(run.match, true);
      onHud(readHud(run.match));
    });
    return () => {
      generationRef.current += 1;
      runRef.current?.dispose();
      runRef.current = null;
    };
  }, [syncViews, onHud, designs]);

  useFrame((state, delta) => {
    const run = runRef.current;
    if (!run) return;
    const match = run.match;

    // Pre-fight countdown: the sim holds while the HUD counts down, so
    // both bots present their builds before the first hit.
    if (countdownRef.current > 0) {
      const before = Math.ceil(countdownRef.current / COUNTDOWN_STEP_SECONDS);
      countdownRef.current = Math.max(0, countdownRef.current - delta);
      const after = Math.ceil(countdownRef.current / COUNTDOWN_STEP_SECONDS);
      if (before !== after || countdownRef.current === 0) {
        onCountdown(
          countdownRef.current === 0
            ? null
            : after === 1
              ? "FIGHT"
              : String(after - 1),
        );
        onHud(readHud(match));
      }
      const stage = stageRef.current;
      if (stage) {
        if (countdownRef.current === 0) {
          setDatasetText(
            datasetCache.current,
            stage.dataset,
            "countdown",
            "over",
          );
        } else {
          setDatasetNumber(
            datasetCache.current,
            stage.dataset,
            "countdown",
            Math.ceil(countdownRef.current / COUNTDOWN_STEP_SECONDS),
            0,
          );
        }
      }
      accumulatorRef.current = 0;
    }

    accumulatorRef.current = Math.min(
      accumulatorRef.current + (countdownRef.current > 0 ? 0 : delta),
      MAX_FRAME_DELTA,
    );
    let stepped = false;
    while (accumulatorRef.current >= DT) {
      for (const view of viewsRef.current.values()) {
        view.prevPos.copy(view.currPos);
        view.prevRot.copy(view.currRot);
      }
      stepMatch(match);
      syncViews(match, false);
      accumulatorRef.current -= DT;
      stepped = true;
    }

    // Damage juice: per-part health drops spawn sparks at the part, a
    // destruction edge bursts big. Render-only; the sim is untouched.
    if (stepped) {
      for (const [index, bot] of match.bots.entries()) {
        for (const [iid, part] of bot.parts) {
          const key = `${index}:${iid}`;
          const prev = partHealthSnapshot.current.get(key);
          const curr = part.destroyed ? -1 : part.health;
          if (prev !== undefined && curr < prev) {
            const view = viewsRef.current.get(key);
            if (view) {
              const big = curr < 0;
              const count = big ? 22 : 6;
              const tint = big ? "#ffd9a0" : "#ffe9a8";
              for (let i = 0; i < count; i++) {
                if (sparks.current.length >= SPARK_CAPACITY) break;
                sparks.current.push({
                  x: view.currPos.x,
                  y: view.currPos.y + 0.1,
                  z: view.currPos.z,
                  vx: (Math.random() - 0.5) * (big ? 7 : 4),
                  vy: Math.random() * (big ? 5 : 3) + 1,
                  vz: (Math.random() - 0.5) * (big ? 7 : 4),
                  life: 0.18 + Math.random() * (big ? 0.35 : 0.18),
                  size: big ? 0.07 + Math.random() * 0.06 : 0.045,
                  color: i % 3 === 0 ? "#cfe1ff" : tint,
                });
              }
            }
          }
          partHealthSnapshot.current.set(key, curr);
        }
      }
    }
    for (const p of sparks.current) {
      p.life -= delta;
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.z += p.vz * delta;
      p.vy -= 12 * delta;
    }
    sparks.current = sparks.current.filter((p) => p.life > 0);
    const inst = sparkInstRef.current;
    if (inst) {
      let count = 0;
      for (const p of sparks.current) {
        if (count >= SPARK_CAPACITY) break;
        const scale = p.size * Math.max(0.1, Math.min(1, p.life * 4));
        sparkMatrix.current.makeScale(scale, scale, scale);
        sparkMatrix.current.setPosition(p.x, p.y, p.z);
        inst.setMatrixAt(count, sparkMatrix.current);
        inst.setColorAt(count, sparkColor.current.set(p.color));
        count += 1;
      }
      inst.count = count;
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }

    const alpha = accumulatorRef.current / DT;
    for (const [index, bot] of match.bots.entries()) {
      for (const iid of bot.assembled.bodies.keys()) {
        const key = `${index}:${iid}`;
        const view = viewsRef.current.get(key);
        const group = groupRefs.current.get(key);
        if (!view || !group) continue;
        group.position.lerpVectors(view.prevPos, view.currPos, alpha);
        group.quaternion.slerpQuaternions(view.prevRot, view.currRot, alpha);
        const material = materialRefs.current.get(key);
        if (material) {
          const part = bot.parts.get(iid);
          const destroyed = part?.destroyed ?? false;
          // The part's base hull colour (G5): its paint when the design is
          // painted, else the team colour. Precomputed at design cadence
          // and copied here, so the frame loop allocates nothing.
          const base = baseColorsRef.current.get(key) ?? teamColors[index];
          if (destroyed) {
            material.color.copy(base).multiplyScalar(DESTROYED_DIM);
            material.emissiveIntensity = 0;
            material.roughness = 0.9;
          } else {
            const ratio =
              part && part.maxHealth > 0 ? part.health / part.maxHealth : 1;
            // Battle scars: darkening char as a part wears down.
            material.color.copy(base).multiplyScalar(0.45 + 0.55 * ratio);
          }
        }
      }
      // The team ring (G5) rides under the core so a spectator can tell the
      // sides apart even when both hulls wear paint.
      const coreGroup = groupRefs.current.get(coreKeysRef.current[index]);
      const ring = ringRefs.current[index];
      if (coreGroup && ring) {
        ring.position.x = coreGroup.position.x;
        ring.position.z = coreGroup.position.z;
      }
    }

    const allBounds = emptyArenaCameraBounds();
    const botCenters: [{ x: number; z: number }, { x: number; z: number }] = [
      { x: 0, z: 0 },
      { x: 0, z: 0 },
    ];
    let framedBots = 0;
    // The player's bot's footprint, projected below so a test can read how
    // big the fight is on screen (F-245).
    let playerSpan = 0;
    for (const [index, bot] of match.bots.entries()) {
      const botIndex = index as 0 | 1;
      const botBounds = emptyArenaCameraBounds();
      const visibleParts = includeBotPartBounds(
        botBounds,
        bot,
        botIndex,
        groupRefs.current,
        false,
      );
      if (visibleParts === 0) {
        includeBotPartBounds(botBounds, bot, botIndex, groupRefs.current, true);
      }
      if (!arenaCameraBoundsReady(botBounds)) continue;
      includeArenaCameraBounds(allBounds, botBounds);
      if (botIndex === 1) {
        playerSpan = Math.max(
          botBounds.maxX - botBounds.minX,
          botBounds.maxZ - botBounds.minZ,
        );
      }
      const center = arenaCameraBoundsCenter(botBounds);
      botCenters[botIndex] = {
        x: center.x,
        z: center.z,
      };
      framedBots += 1;
    }

    if (framedBots === 2 && arenaCameraBoundsReady(allBounds)) {
      const frame = arenaCameraFrameForBounds(
        allBounds,
        botCenters,
        state.size.width / Math.max(1, state.size.height),
      );
      desiredCameraLookAtRef.current.set(
        frame.targetX,
        frame.targetY,
        frame.targetZ,
      );
      desiredCameraPositionRef.current.set(
        frame.targetX + Math.sin(frame.yaw) * frame.distance,
        frame.targetY + frame.height,
        frame.targetZ + Math.cos(frame.yaw) * frame.distance,
      );
      const blend = 1 - Math.exp(-delta * ARENA_CAMERA_SMOOTHING);
      state.camera.position.lerp(desiredCameraPositionRef.current, blend);
      state.camera.lookAt(desiredCameraLookAtRef.current);
      state.camera.updateMatrixWorld();

      const bot0 = projectedBotRef.current[0].set(
        botCenters[0].x,
        frame.targetY,
        botCenters[0].z,
      );
      const bot1 = projectedBotRef.current[1].set(
        botCenters[1].x,
        frame.targetY,
        botCenters[1].z,
      );
      bot0.project(state.camera);
      bot1.project(state.camera);
      const bot0InFrame = Math.abs(bot0.x) <= 0.88 && Math.abs(bot0.y) <= 0.82;
      const bot1InFrame = Math.abs(bot1.x) <= 0.88 && Math.abs(bot1.y) <= 0.82;
      const stage = stageRef.current;
      if (stage) {
        const cache = datasetCache.current;
        setDatasetText(cache, stage.dataset, "cameraMode", "cinematic-follow");
        setDatasetNumber(
          cache,
          stage.dataset,
          "cameraTargetX",
          frame.targetX,
          2,
        );
        setDatasetNumber(
          cache,
          stage.dataset,
          "cameraTargetZ",
          frame.targetZ,
          2,
        );
        setDatasetNumber(
          cache,
          stage.dataset,
          "cameraDistance",
          frame.distance,
          2,
        );
        setDatasetNumber(cache, stage.dataset, "bot0ScreenX", bot0.x, 3);
        setDatasetNumber(cache, stage.dataset, "bot1ScreenX", bot1.x, 3);
        setDatasetNumber(cache, stage.dataset, "bot0ScreenY", bot0.y, 3);
        setDatasetNumber(cache, stage.dataset, "bot1ScreenY", bot1.y, 3);
        // The player's bot's footprint as a fraction of the viewport width:
        // its half-span pushed along world x and along world z from its
        // centre, whichever projects wider.
        const edge = projectedEdgeRef.current;
        edge.set(
          botCenters[1].x + playerSpan / 2,
          frame.targetY,
          botCenters[1].z,
        );
        edge.project(state.camera);
        let halfWidth = Math.abs(edge.x - bot1.x);
        edge.set(
          botCenters[1].x,
          frame.targetY,
          botCenters[1].z + playerSpan / 2,
        );
        edge.project(state.camera);
        halfWidth = Math.max(halfWidth, Math.abs(edge.x - bot1.x));
        // NDC spans two units across the viewport, so a half-span in NDC
        // is the full-span fraction of the width.
        setDatasetNumber(cache, stage.dataset, "bot1ScreenSize", halfWidth, 3);
        setDatasetText(
          cache,
          stage.dataset,
          "botsInFrame",
          bot0InFrame && bot1InFrame ? "true" : "false",
        );
      }
    }

    if (stepped) {
      stageRef.current?.setAttribute("data-sim-tick", String(match.tick));
      const hudTick = Math.floor(match.tick / 15);
      // Edge-trigger the banner; a level trigger would re-render every
      // frame for the whole end linger.
      const bannerEdge = match.status.over && !bannerShownRef.current;
      if (hudTick !== lastHudTickRef.current || bannerEdge) {
        lastHudTickRef.current = hudTick;
        if (bannerEdge && match.status.over) {
          bannerShownRef.current = true;
          const teardownInput = teardownInputFrom(match);
          onMatchEnd?.({
            hash: matchResultHash(match),
            tick: match.tick,
            teardown: teardownInput ? buildTeardown(teardownInput) : null,
            winner: match.status.winner,
            reason: match.status.reason,
            scores:
              match.status.reason === "timeout" ? match.status.scores : null,
          });
        }
        onHud(readHud(match));
      }
    }

    // Exhibition loop: linger on the result, then run it back.
    if (match.status.over && !restartingRef.current) {
      endLingerRef.current += delta;
      if (endLingerRef.current > RESTART_DELAY_SECONDS) {
        restartingRef.current = true;
        endLingerRef.current = 0;
        runRef.current = null;
        run.dispose();
        // The previous result stops describing anything the moment the next
        // fight boots. Without this the teardown sheet for the last match
        // stays open over a live one.
        onMatchStart?.();
        const generation = generationRef.current;
        exhibitionCycleRef.current =
          (exhibitionCycleRef.current + 1) % EXHIBITION_MATCHUPS.length;
        const nextDesigns =
          designs === EXHIBITION_DESIGNS
            ? EXHIBITION_MATCHUPS[exhibitionCycleRef.current]
            : designs;
        setActiveDesigns(nextDesigns);
        countdownRef.current = COUNTDOWN_STEP_SECONDS * COUNTDOWN_STEPS;
        onCountdown("3");
        bootMatch(nextDesigns).then((next) => {
          if (generationRef.current !== generation) {
            next.dispose();
            return;
          }
          runRef.current = next;
          syncViews(next.match, true);
          bannerShownRef.current = false;
          lastHudTickRef.current = -1;
          onHud(readHud(next.match));
          restartingRef.current = false;
        });
      }
    }
  });

  const detail = useBlockDetail();
  const webgpuBackend = useThree((state) => isWebGPUBackend(state.gl));
  const features = graphicsFeaturesFor(
    resolveGraphicsQualityTier(readStoredGraphicsQuality(), hasCoarsePointer()),
  );
  const shadowsOn = features.shadows && webgpuBackend;

  return (
    <>
      <ambientLight intensity={0.55} color="#cdd8f4" />
      <directionalLight
        position={[6, 10, 4]}
        intensity={1.7}
        castShadow={shadowsOn}
        shadow-mapSize={[features.sunShadowMapSize, features.sunShadowMapSize]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-near={0.5}
        shadow-camera-far={40}
        shadow-bias={-0.0004}
      />
      {/* Corner rim lights tint each bot's home side. */}
      <pointLight
        position={[-9, 4, -9]}
        color={BOT_COLORS[0]}
        intensity={1.4}
        distance={22}
        decay={1.6}
      />
      <pointLight
        position={[9, 4, 9]}
        color={BOT_COLORS[1]}
        intensity={1.4}
        distance={22}
        decay={1.6}
      />
      <StudioEnvironment intensity={features.environmentIntensity} />
      {/* Team rings (G5): one flat ring per bot under its core, in the
          team colour, so the sides read even when both hulls wear paint. */}
      {([0, 1] as const).map((botIndex) => (
        <mesh
          key={`team-ring-${botIndex}`}
          ref={(node) => {
            ringRefs.current[botIndex] = node;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
        >
          <ringGeometry args={[0.58, 0.7, 40]} />
          <meshBasicMaterial
            color={BOT_COLORS[botIndex]}
            transparent
            opacity={0.8}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      ))}
      {([0, 1] as const).map((botIndex) =>
        activeDesigns[botIndex].parts.map((part) => {
          const key = `${botIndex}:${part.iid}`;
          const def = PART_CATALOG[part.partId];
          // The hull colour is the part's paint when the design is painted,
          // else the team colour (the frame loop keeps setting it for damage
          // char); the part's own identity comes from its surface response
          // and its baked two-tone vertex attribute (dark tread, bright tip,
          // deck line) over that colour.
          const look = partLook(def);
          const design = activeDesigns[botIndex];
          const hull = design.paint
            ? paintedColor(def, design.paint, look.color)
            : BOT_COLORS[botIndex];
          return (
            <group
              key={key}
              ref={(node) => {
                groupRefs.current.set(key, node);
              }}
            >
              <mesh
                rotation={shapeRotation(def.shape)}
                castShadow
                receiveShadow
              >
                {partGeometry(def)}
                <meshStandardMaterial
                  ref={(node) => {
                    materialRefs.current.set(key, node);
                  }}
                  color={hull}
                  vertexColors={partVertexColors(def)}
                  metalness={look.metalness}
                  roughness={look.roughness}
                  emissive={hull}
                  emissiveIntensity={look.emissiveBoost}
                />
              </mesh>
            </group>
          );
        }),
      )}
      {/* Damage sparks: one instanced draw, fullbright. */}
      <instancedMesh
        ref={sparkInstRef}
        args={[undefined, undefined, SPARK_CAPACITY]}
        count={0}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {/* The pit: matte concrete deck inside the bounce-wall ring (a
          metallic deck mirrors the dark void and reads black). The deck and
          walls trace the sim's collider ring so a rebound reads true. */}
      <mesh
        position={[0, -0.5, 0]}
        receiveShadow
        material={surfaceComposite("#5f6875", detail)}
        dispose={null}
      >
        <boxGeometry args={[ARENA_DECK_SIZE, 1, ARENA_DECK_SIZE]} />
      </mesh>
      {[
        {
          pos: [0, ARENA_WALL_RENDER_Y, -ARENA_WALL_CENTER] as const,
          size: [
            ARENA_WALL_SPAN,
            ARENA_WALL_RENDER_HEIGHT,
            ARENA_WALL_RENDER_THICKNESS,
          ] as const,
        },
        {
          pos: [0, ARENA_WALL_RENDER_Y, ARENA_WALL_CENTER] as const,
          size: [
            ARENA_WALL_SPAN,
            ARENA_WALL_RENDER_HEIGHT,
            ARENA_WALL_RENDER_THICKNESS,
          ] as const,
        },
        {
          pos: [-ARENA_WALL_CENTER, ARENA_WALL_RENDER_Y, 0] as const,
          size: [
            ARENA_WALL_RENDER_THICKNESS,
            ARENA_WALL_RENDER_HEIGHT,
            ARENA_WALL_SPAN,
          ] as const,
        },
        {
          pos: [ARENA_WALL_CENTER, ARENA_WALL_RENDER_Y, 0] as const,
          size: [
            ARENA_WALL_RENDER_THICKNESS,
            ARENA_WALL_RENDER_HEIGHT,
            ARENA_WALL_SPAN,
          ] as const,
        },
      ].map((wall) => (
        <mesh
          key={`${wall.pos[0]}:${wall.pos[2]}`}
          position={[wall.pos[0], wall.pos[1], wall.pos[2]]}
          castShadow
          receiveShadow
          material={surfaceBareMetal("#4a5262", detail)}
          dispose={null}
        >
          <boxGeometry args={[wall.size[0], wall.size[1], wall.size[2]]} />
        </mesh>
      ))}
      {/* Center ring accent on the deck. */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.4, 3.6, 48]} />
        <meshBasicMaterial color="#3d5a8f" toneMapped={false} />
      </mesh>
    </>
  );
}

export default function ArenaCanvas({
  designs = EXHIBITION_DESIGNS,
  onMatchEnd,
  onMatchStart,
}: {
  designs?: [BotDesign, BotDesign];
  onMatchEnd?: (info: MatchEndInfo) => void;
  /** Fired when the exhibition loop boots the next fight. */
  onMatchStart?: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [countdown, setCountdown] = useState<string | null>("3");
  const features = graphicsFeaturesFor(
    resolveGraphicsQualityTier(readStoredGraphicsQuality(), hasCoarsePointer()),
  );

  return (
    <div
      ref={stageRef}
      data-sim-tick="0"
      style={{ position: "relative", width: "100%", height: "100dvh" }}
    >
      <Canvas
        camera={{ position: [8, 5, 10], fov: 42 }}
        gl={createWebGPU}
        shadows={features.shadows ? "soft" : false}
      >
        <FallbackDprCap />
        <color attach="background" args={["#0b0e14"]} />
        <ArenaScene
          designs={designs}
          stageRef={stageRef}
          onHud={setHud}
          onMatchEnd={onMatchEnd}
          onMatchStart={onMatchStart}
          onCountdown={setCountdown}
        />
        <PerfProbeBridge source="arena" />
      </Canvas>

      {countdown && (
        <div
          data-testid="arena-countdown"
          style={{
            position: "absolute",
            top: "30%",
            left: 0,
            right: 0,
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              fontSize: countdown === "FIGHT" ? "3.4rem" : "4.4rem",
              fontWeight: 800,
              color: countdown === "FIGHT" ? "#54e0c7" : "#f5f7fb",
              textShadow: "0 2px 18px rgba(84, 224, 199, 0.35)",
              letterSpacing: "0.08em",
            }}
          >
            {countdown}
          </span>
        </div>
      )}

      {hud && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            gap: 24,
            pointerEvents: "none",
            fontSize: "0.85rem",
          }}
        >
          {hud.bots.map((bot, index) => (
            <div
              key={bot.label}
              style={{
                background: "rgba(11, 14, 20, 0.8)",
                border: `1px solid ${BOT_COLORS[index]}`,
                borderRadius: 8,
                padding: "8px 14px",
                minWidth: 180,
              }}
            >
              <div style={{ color: BOT_COLORS[index], fontWeight: 600 }}>
                {bot.label}
              </div>
              <div
                style={{
                  height: 6,
                  marginTop: 6,
                  borderRadius: 3,
                  background: "#1c2230",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${bot.healthPercent}%`,
                    height: "100%",
                    background: BOT_COLORS[index],
                  }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  marginTop: 6,
                  alignItems: "center",
                }}
              >
                {bot.pips.map((pip) => (
                  <span
                    key={pip.iid}
                    title={pip.iid}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: pip.destroyed ? "#3a4358" : BOT_COLORS[index],
                      opacity: pip.destroyed
                        ? 0.6
                        : 0.3 + 0.7 * pip.healthRatio,
                    }}
                  />
                ))}
                <span style={{ opacity: 0.7, marginLeft: 6 }}>
                  {bot.healthPercent}% hull
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {hud?.banner && (
        <div
          style={{
            position: "absolute",
            top: "38%",
            left: 0,
            right: 0,
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              background: "rgba(11, 14, 20, 0.85)",
              border: "1px solid #3a4358",
              borderRadius: 10,
              padding: "10px 22px",
              fontSize: "1.3rem",
              fontWeight: 600,
            }}
          >
            {hud.banner}
          </span>
        </div>
      )}
    </div>
  );
}
