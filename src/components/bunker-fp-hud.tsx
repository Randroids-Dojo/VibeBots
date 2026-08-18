"use client";

import {
  beginJoystick,
  createJoystick,
  endJoystick,
  JOYSTICK_DEADZONE,
  JOYSTICK_RADIUS,
  moveJoystick,
  readJoystick,
} from "@randroids-dojo/vibekit";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { BunkerPlayerProgress } from "@/lib/bunker-api-types";
import {
  AVAILABLE_BASE_PART_IDS,
  BASE_PART_CATALOG,
  type BasePartId,
  type BasePartInventory,
  type BunkerOrientation,
  isRotatableBasePart,
} from "@/sim/bunker";
import { fpInput } from "./bunker-fp-input";
import {
  beginFpLookPress,
  createFpLookPress,
  FP_LONG_PRESS_MS,
  shouldFireFpLongPress,
  shouldFireFpTapAct,
} from "./bunker-fp-press";
import { formatRaidCooldown, raidCooldownMsLeft } from "./bunker-fp-raid";
import { getFpRaidHudSnapshot, subscribeFpRaidHud } from "./bunker-fp-raid-hud";
import {
  type FpTargetInfo,
  getFpBoxedInSnapshot,
  getFpTargetSnapshot,
  subscribeFpBoxedIn,
  subscribeFpTarget,
} from "./bunker-fp-target-state";
import {
  armFpTutorial,
  disarmFpTutorial,
  dismissFpTutorialStep,
  type FpTutorialCard,
  getFpTutorialCard,
  setFpTutorialStock,
  skipFpTutorial,
  subscribeFpTutorial,
} from "./bunker-fp-tutorial";
import type { BunkerToolAction } from "./bunker-tool-types";

function PickIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 12c4-6 12-9 20-8l-3 3c-4 0-8 1-11 3l14 14-3 3L7 13c-1 2-2 4-2 7l-3 3c-1-4 0-8 2-11z" />
    </svg>
  );
}

function fpTargetLabel(target: FpTargetInfo): string {
  if (target.kind === "rock-diggable") return "Claim rock (diggable)";
  if (
    (target.kind === "part" ||
      target.kind === "door" ||
      target.kind === "spikes") &&
    target.partId
  ) {
    const def = BASE_PART_CATALOG[target.partId];
    return `${def.name} ${target.durability}/${def.durability}`;
  }
  return "";
}

/**
 * Escape hint for a player enclosed by parts or rock (a sealed legacy
 * base): visible while the rig reports no passable lateral neighbor.
 * Tapping it dismisses it until the player is boxed in again (getting
 * free rearms it), so it can never nag someone who knows the tools.
 */
function FpBoxedInHint() {
  const boxedIn = useSyncExternalStore(
    subscribeFpBoxedIn,
    getFpBoxedInSnapshot,
    getFpBoxedInSnapshot,
  );
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!boxedIn) setDismissed(false);
  }, [boxedIn]);
  if (!boxedIn || dismissed) return null;
  return (
    <button
      type="button"
      className="bunker-fp-boxed-hint"
      data-testid="bunker-fp-boxed-hint"
      onClick={() => setDismissed(true)}
    >
      <span>
        Boxed in? Press and hold (or right-click) a part to pry it loose, or
        open Upkeep (top right) then Reset.
      </span>
      <strong aria-hidden="true">&#10005;</strong>
    </button>
  );
}

/** How long the raid's win/loss banner stays up after the settled raid
 * clears from the store, so even a seconds-long raid ends with a readable
 * verdict instead of the HUD snapping straight back to the build tools. */
const RAID_RESULT_HOLD_MS = 6000;

/** Per-platform tutorial copy: coarse pointers teach the touch
 * gestures, everyone else the mouse and keyboard (Rule 10: all text
 * is DOM, never in-canvas). */
const FP_TUTORIAL_COPY: Record<
  FpTutorialCard,
  { touch: string; desktop: string }
> = {
  look: {
    touch: "Drag the right side of the screen to look around.",
    desktop: "Click the scene, then move the mouse to look around.",
  },
  walk: {
    // Auto-hop needs a one-block step, and a bare claim has none until
    // you dig or place, so the walk card only teaches walking; the step
    // hop is a surface tip and shows itself once a ledge exists.
    touch: "Hold the left stick to walk around the bunker.",
    desktop: "WASD or the arrow keys walk; Space jumps.",
  },
  dig: {
    touch: "Aim the pick at the brighter claim rock and tap to dig.",
    desktop: "Aim the pick at the brighter claim rock and click to dig.",
  },
  place: {
    touch: "Pick a part slot, aim at a face, and tap to place it.",
    desktop: "Pick a part slot, aim at a face, and click to place it.",
  },
  "place-no-stock": {
    touch: "No parts in stock. The surface Hardware Store sells panels.",
    desktop: "No parts in stock. The surface Hardware Store sells panels.",
  },
  pry: {
    touch: "Hold a finger on a placed part to pry it back into your pack.",
    desktop: "Right-click a placed part to pry it back into your pack.",
  },
  done: {
    // Upkeep and Exit are labelled buttons on screen; the closer does not
    // need to read them out.
    touch: "That is the whole kit.",
    desktop: "That is the whole kit.",
  },
};

/**
 * The progressive tutorial card (F-097): one small non-modal card at
 * a time above the hotbar, driven by the external state machine the
 * rig feeds each frame. The X skips one step, "Skip tutorial" ends
 * the chain; the closer card is itself a button (tap anywhere on it
 * to finish, mirroring the boxed-in hint).
 */
function BunkerFpTutorial({ coarse }: { coarse: boolean }) {
  const card = useSyncExternalStore(
    subscribeFpTutorial,
    getFpTutorialCard,
    getFpTutorialCard,
  );
  if (!card) return null;
  const copy = FP_TUTORIAL_COPY[card][coarse ? "touch" : "desktop"];
  if (card === "done") {
    return (
      <button
        type="button"
        className="bunker-fp-tutorial"
        data-testid="bunker-fp-tutorial"
        data-step="done"
        onClick={() => skipFpTutorial()}
      >
        <span>{copy}</span>
        <strong aria-hidden="true">&#10005;</strong>
      </button>
    );
  }
  return (
    <div
      className="bunker-fp-tutorial"
      data-testid="bunker-fp-tutorial"
      data-step={card}
      role="status"
    >
      <p>{copy}</p>
      <span className="bunker-fp-tutorial-actions">
        <button
          type="button"
          aria-label="Dismiss this tip"
          data-testid="bunker-fp-tutorial-dismiss"
          onClick={() => dismissFpTutorialStep(performance.now())}
        >
          &#10005;
        </button>
        <button
          type="button"
          data-testid="bunker-fp-tutorial-skip"
          onClick={() => skipFpTutorial()}
        >
          Skip tutorial
        </button>
      </span>
    </div>
  );
}

/** Subscribes to the crosshair target store on its own, so a target
 * change re-renders only this chip and never the hotbar around it. */
function FpTargetLabel() {
  const target = useSyncExternalStore(
    subscribeFpTarget,
    getFpTargetSnapshot,
    getFpTargetSnapshot,
  );
  const label = fpTargetLabel(target);
  if (!label) return null;
  return (
    <div className="bunker-fp-target-label" role="status">
      {label}
    </div>
  );
}

/**
 * DOM overlay for the first-person bunker viewer, rendered as a
 * SIBLING of the canvas (Rule 10: all text is DOM, never in-canvas).
 * Desktop gets the exit button, crosshair, and a resume hint while
 * pointer lock is off; coarse pointers get the move/look touch zones
 * (a quick tap on the look zone acts with the current tool, a long
 * still press over an unchanged target quick-pries like right-click;
 * one-block steps auto-jump per F-094, so there is no jump button).
 * Both get the bottom hotbar: pick slot, six part slots with counts,
 * and the pry toggle (a pry refunds the part straight to inventory,
 * F-099). All zones write the shared fpInput singleton the rig
 * consumes each frame; the target label chip subscribes to the rig's
 * change-only target store; `denyNotice` surfaces mine-panel's brief
 * pry-refusal chip (a damaged part must be repaired first).
 */
export function BunkerFpHud({
  inventory,
  tool,
  selectedPartId,
  selectedOrientation,
  onRotate,
  denyNotice,
  bagOreCount,
  bagStackCount,
  bagCapacity,
  bagOpen,
  onSelectPart,
  onSelectPick,
  onTogglePry,
  onOpenBag,
  onOpenStatus,
  player,
  onExit,
  onStartLiveRaid,
  raidTierCeiling,
  raidStartAllowed,
  nextRaidAvailableAtMs,
}: {
  inventory: BasePartInventory;
  tool: BunkerToolAction;
  selectedPartId: BasePartId;
  /** Facing of the selected rotatable part (the staircase); shown on the
   * rotate control. */
  selectedOrientation: BunkerOrientation;
  /** Cycle the selected rotatable part's facing (the rotate control). */
  onRotate: () => void;
  denyNotice: string | null;
  bagOreCount: number;
  bagStackCount: number;
  bagCapacity: number;
  bagOpen: boolean;
  onSelectPart: (partId: BasePartId) => void;
  onSelectPick: () => void;
  onTogglePry: () => void;
  onOpenBag: () => void;
  /** Opens the Upkeep sheet as an overlay over the live first-person
   * canvas (repair, skins, reset). The flat view hides its collapsed
   * trigger while the miner stands in the claim (F-119 fold), so this
   * button is the sheet's doorway from inside. */
  onOpenStatus: () => void;
  /** Glance numbers for the passive HUD chips (vibes, level, XP, beacon
   * cap); null while the bunker view has not loaded. */
  player: BunkerPlayerProgress | null;
  onExit: () => void;
  /** Start a live first-person raid at the chosen tier. */
  onStartLiveRaid: (tier: number) => void;
  /** Highest raid tier the player's level unlocks. */
  raidTierCeiling: number;
  /** False while the bunker is a mid-trip claim (raids need it banked). */
  raidStartAllowed: boolean;
  /** Server clock (ms) when the raid cooldown ends; null when a raid may
   * start now. While it is in the future the Start control gives way to a
   * live countdown instead of a button that would silently 409. */
  nextRaidAvailableAtMs: number | null;
}) {
  const [coarse, setCoarse] = useState(false);
  const [locked, setLocked] = useState(false);
  const raid = useSyncExternalStore(
    subscribeFpRaidHud,
    getFpRaidHudSnapshot,
    getFpRaidHudSnapshot,
  );
  const raidActive = raid.active;
  // Two-step guard for leaving a live raid (F-162). The in-fight Exit control
  // is hidden on purpose, so touch players (no Escape key) get a deliberate
  // Leave-raid control that arms a forfeit confirmation before it drops out.
  // Reset whenever a raid is not running so a stale arm never greets the next.
  const [abandonArmed, setAbandonArmed] = useState(false);
  useEffect(() => {
    if (!raidActive) setAbandonArmed(false);
  }, [raidActive]);
  // Hurt flash: every bite that lands bumps a counter, and the counter is
  // the flash element's key, so React remounts it and the CSS animation
  // restarts even on back-to-back bites. Health only ever falls within a
  // raid, so a rise means a new raid and resets the baseline.
  //
  // The counter clears whenever no raid is running. Settling a raid drops
  // the HUD snapshot back to zero health, which reads as one last hit, and
  // a counter left above zero would then fire a phantom red flash at the
  // START of the next raid, before anything had bitten.
  const raidHealth = raid.health;
  const [hurtPulse, setHurtPulse] = useState(0);
  const lastHealthRef = useRef(raidHealth);
  useEffect(() => {
    if (!raidActive) {
      setHurtPulse(0);
    } else if (raidHealth < lastHealthRef.current) {
      setHurtPulse((pulse) => pulse + 1);
    }
    lastHealthRef.current = raidHealth;
  }, [raidActive, raidHealth]);
  // Hold the win/loss banner for a beat after the raid clears. The resolve
  // response drops `activeLiveRaid` almost immediately after the outcome
  // settles, which used to erase "Bunker held!"/"Bunker breached!" within a
  // network round-trip; a raid that ends fast then read as ending for no
  // reason. The live panel keeps priority while a raid runs.
  const [heldRaidOutcome, setHeldRaidOutcome] = useState<"won" | "lost" | null>(
    null,
  );
  useEffect(() => {
    if (raidActive) {
      setHeldRaidOutcome(raid.outcome === "active" ? null : raid.outcome);
    }
  }, [raidActive, raid.outcome]);
  useEffect(() => {
    if (raidActive || heldRaidOutcome === null) return;
    const timer = setTimeout(
      () => setHeldRaidOutcome(null),
      RAID_RESULT_HOLD_MS,
    );
    return () => clearTimeout(timer);
  }, [raidActive, heldRaidOutcome]);
  // Countdown tick at display granularity: the chip shows whole minutes
  // above an hour, so an hours-long cooldown re-renders once a minute
  // instead of every second, and the final hour counts seconds. The chain
  // stops itself once the deadline passes so an idle HUD stops rendering.
  const [cooldownNowMs, setCooldownNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (nextRaidAvailableAtMs === null) return;
    setCooldownNowMs(Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const remaining = nextRaidAvailableAtMs - Date.now();
      if (remaining <= 0) return;
      timer = setTimeout(
        () => {
          setCooldownNowMs(Date.now());
          schedule();
        },
        remaining > 60 * 60 * 1000 ? 60 * 1000 : 1000,
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [nextRaidAvailableAtMs]);
  const cooldownMsLeft = raidCooldownMsLeft(
    nextRaidAvailableAtMs,
    cooldownNowMs,
  );
  const [raidTier, setRaidTier] = useState(1);
  const pickedTier = Math.min(raidTier, Math.max(1, raidTierCeiling));
  const js = useRef(createJoystick());
  const ringRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const [stickOn, setStickOn] = useState(false);
  const look = useRef(createFpLookPress());
  const longPressTimerRef = useRef<number>(0);
  useEffect(() => {
    setCoarse(window.matchMedia("(hover: none) and (pointer: coarse)").matches);
    const onLockChange = () => setLocked(Boolean(document.pointerLockElement));
    document.addEventListener("pointerlockchange", onLockChange);
    onLockChange();
    return () => {
      document.removeEventListener("pointerlockchange", onLockChange);
    };
  }, []);

  // Arm the tutorial chain for this bunker visit (a no-op when the
  // done flag is set); leaving drops any in-progress run so the next
  // entry starts over from the look step.
  useEffect(() => {
    armFpTutorial();
    return () => {
      disarmFpTutorial();
    };
  }, []);

  // The place and pry steps degrade gracefully at zero stock; feed
  // the machine the total at prop cadence, never per frame.
  useEffect(() => {
    let total = 0;
    for (const partId of AVAILABLE_BASE_PART_IDS) total += inventory[partId];
    setFpTutorialStock(total);
  }, [inventory]);

  // Any lingering held input (or armed hold timer) dies with the
  // overlay.
  useEffect(() => {
    return () => {
      window.clearTimeout(longPressTimerRef.current);
      fpInput.forward = 0;
      fpInput.strafe = 0;
      fpInput.lookX = 0;
      fpInput.lookY = 0;
      fpInput.act = false;
      fpInput.actHeld = false;
      fpInput.pryAct = false;
    };
  }, []);

  const applyStick = () => {
    const v = readJoystick(js.current);
    const len = Math.hypot(v.x, v.y);
    if (len < JOYSTICK_DEADZONE) {
      fpInput.forward = 0;
      fpInput.strafe = 0;
    } else {
      const scale = (len - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE) / len;
      fpInput.strafe = v.x * scale;
      fpInput.forward = -v.y * scale;
    }
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(${v.x * JOYSTICK_RADIUS}px, ${v.y * JOYSTICK_RADIUS}px)`;
    }
  };

  const stickDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    beginJoystick(js.current, event.pointerId, event.clientX, event.clientY);
    if (ringRef.current) {
      ringRef.current.style.left = `${event.clientX}px`;
      ringRef.current.style.top = `${event.clientY}px`;
    }
    setStickOn(true);
    applyStick();
  };
  const stickMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (js.current.pointerId !== event.pointerId) return;
    moveJoystick(js.current, event.clientX, event.clientY);
    applyStick();
  };
  const stickUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (js.current.pointerId !== event.pointerId) return;
    endJoystick(js.current);
    fpInput.forward = 0;
    fpInput.strafe = 0;
    setStickOn(false);
  };

  const lookDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    beginFpLookPress(
      look.current,
      event.pointerId,
      event.clientX,
      event.clientY,
      performance.now(),
      getFpTargetSnapshot(),
    );
    if (tool === "dig") {
      // Digging holds to mine: the press keeps the pickaxe swinging so
      // dragging the aim across cells mines each one (F-114). The edge
      // act guarantees a strike even on a sub-frame tap. No long-press
      // pry here (holding means keep mining, not right-click).
      fpInput.act = true;
      fpInput.actHeld = true;
      return;
    }
    // A press held still through the hold window quick-pries whatever
    // the crosshair saw at press start (the touch right-click); the
    // predicate re-checks stillness and that the target never changed.
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      const press = look.current;
      if (
        !shouldFireFpLongPress(press, performance.now(), getFpTargetSnapshot())
      ) {
        return;
      }
      press.longPressFired = true;
      fpInput.pryAct = true;
    }, FP_LONG_PRESS_MS);
  };
  const lookMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!look.current.active || look.current.pointerId !== event.pointerId) {
      return;
    }
    fpInput.lookX += event.clientX - look.current.x;
    fpInput.lookY += event.clientY - look.current.y;
    look.current.x = event.clientX;
    look.current.y = event.clientY;
    look.current.moved = Math.max(
      look.current.moved,
      Math.hypot(
        event.clientX - look.current.startX,
        event.clientY - look.current.startY,
      ),
    );
  };
  const lookCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (look.current.pointerId !== event.pointerId) return;
    window.clearTimeout(longPressTimerRef.current);
    fpInput.actHeld = false;
    look.current.active = false;
    look.current.pointerId = -1;
  };

  const lookUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (look.current.pointerId !== event.pointerId) return;
    window.clearTimeout(longPressTimerRef.current);
    // Releasing always stops any held dig mining.
    fpInput.actHeld = false;
    // A quick, still tap acts with the current tool; the rig consumes
    // the flag on its next frame against the live crosshair target. A
    // press the long-press hold already consumed never also acts. Dig
    // taps already fired their strike on press (hold-to-mine), so they
    // do not tap-act again.
    const wasTap = shouldFireFpTapAct(look.current, performance.now());
    look.current.active = false;
    look.current.pointerId = -1;
    if (wasTap && tool !== "dig") fpInput.act = true;
  };

  return (
    <>
      {coarse && (
        <>
          <div
            className="bunker-fp-look-zone"
            onPointerDown={lookDown}
            onPointerMove={lookMove}
            onPointerUp={lookUp}
            onPointerCancel={lookCancel}
          />
          <div
            className="bunker-fp-move-zone"
            onPointerDown={stickDown}
            onPointerMove={stickMove}
            onPointerUp={stickUp}
            onPointerCancel={stickUp}
          />
          <div
            className={`bunker-fp-stick-ring${stickOn ? " bunker-fp-stick-on" : ""}`}
            ref={ringRef}
            aria-hidden="true"
          >
            <div className="bunker-fp-stick-knob" ref={knobRef} />
          </div>
        </>
      )}
      {!coarse && !locked && (
        <div className="bunker-fp-resume-hint" role="status">
          Click to look around
        </div>
      )}
      <div
        className={`bunker-fp-crosshair${!coarse && !locked ? " bunker-fp-crosshair-hidden" : ""}`}
        data-testid="bunker-fp-crosshair"
        aria-hidden="true"
      />
      {raidActive && hurtPulse > 0 && (
        <div
          key={hurtPulse}
          className="bunker-fp-hurt-flash"
          data-testid="bunker-fp-hurt-flash"
          aria-hidden="true"
        />
      )}
      {raidActive ? (
        <div
          className="bunker-fp-raid-panel"
          data-testid="bunker-fp-raid-panel"
        >
          {raid.outcome === "active" ? (
            <>
              {/* The live region sits on the banner, not the whole panel:
                  the panel also holds a one-second countdown and a health
                  bar that changes on every bite, and wrapping those in a
                  status region makes it announce continuously (F-119:
                  announce meaningful phase changes, not live counters).
                  The banner's Clanker count is the phase worth hearing. */}
              <strong className="bunker-fp-raid-banner" role="status">
                {`Raid: ${raid.clankersAlive}/${raid.clankersTotal} Clankers left`}
              </strong>
              <span className="bunker-fp-raid-timer">{`${raid.secondsLeft}s`}</span>
              {/* Health is the raid's most urgent readout now that contact
                  is a fight. Assistive tech can read it on demand (the bar
                  is decorative, the value carries the text); it is just not
                  announced on every bite. */}
              <span
                className="bunker-fp-raid-health"
                data-testid="bunker-fp-raid-health"
                data-health={raid.health}
              >
                <span
                  className="bunker-fp-raid-health-track"
                  aria-hidden="true"
                >
                  <span
                    className="bunker-fp-raid-health-fill"
                    style={{
                      width: `${
                        raid.maxHealth > 0
                          ? Math.max(
                              0,
                              Math.round((raid.health / raid.maxHealth) * 100),
                            )
                          : 0
                      }%`,
                    }}
                  />
                </span>
                <span className="bunker-fp-raid-health-value">
                  {`${raid.health} HP`}
                </span>
                <span className="bunker-fp-visually-hidden">health</span>
              </span>
              {raid.breached && (
                <span className="bunker-fp-raid-breach">
                  Breached! Swing or run
                </span>
              )}
              {abandonArmed ? (
                <div
                  className="bunker-fp-raid-abandon-confirm"
                  data-testid="bunker-fp-raid-abandon-confirm"
                >
                  <span>Leave and forfeit this raid?</span>
                  <button
                    type="button"
                    className="bunker-fp-raid-abandon-yes"
                    data-testid="bunker-fp-raid-abandon-yes"
                    onClick={onExit}
                  >
                    Forfeit
                  </button>
                  <button
                    type="button"
                    className="bunker-fp-raid-abandon-no"
                    data-testid="bunker-fp-raid-abandon-no"
                    onClick={() => setAbandonArmed(false)}
                  >
                    Stay
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="bunker-fp-raid-abandon"
                  data-testid="bunker-fp-raid-abandon"
                  aria-expanded={false}
                  onClick={() => setAbandonArmed(true)}
                >
                  Leave raid
                </button>
              )}
            </>
          ) : (
            <strong
              className={
                raid.outcome === "won"
                  ? "bunker-fp-raid-result bunker-fp-raid-won"
                  : "bunker-fp-raid-result bunker-fp-raid-lost"
              }
              data-testid="bunker-fp-raid-result"
            >
              {raid.outcome === "won" ? "Bunker held!" : "Bunker breached!"}
            </strong>
          )}
        </div>
      ) : (
        <>
          {heldRaidOutcome !== null && (
            <div
              className="bunker-fp-raid-panel"
              data-testid="bunker-fp-raid-panel"
              role="status"
            >
              <strong
                className={
                  heldRaidOutcome === "won"
                    ? "bunker-fp-raid-result bunker-fp-raid-won"
                    : "bunker-fp-raid-result bunker-fp-raid-lost"
                }
                data-testid="bunker-fp-raid-result"
              >
                {heldRaidOutcome === "won"
                  ? "Bunker held!"
                  : "Bunker breached!"}
              </strong>
            </div>
          )}
          <FpTargetLabel />
          <FpBoxedInHint />
          <BunkerFpTutorial coarse={coarse} />
          <div
            className="bunker-fp-hotbar"
            role="toolbar"
            aria-label="Bunker tools"
          >
            <button
              type="button"
              className="bunker-fp-slot bunker-fp-slot-pick"
              data-testid="bunker-fp-pick"
              aria-label="Pick (dig claim rock)"
              aria-pressed={tool === "dig"}
              onClick={onSelectPick}
            >
              <PickIcon />
              <small>Pick</small>
            </button>
            <span className="bunker-fp-hotbar-divider" aria-hidden="true" />
            {AVAILABLE_BASE_PART_IDS.map((partId, index) => {
              const count = inventory[partId];
              const active = tool === "build" && selectedPartId === partId;
              return (
                <button
                  key={partId}
                  type="button"
                  className="bunker-fp-slot"
                  data-testid={`bunker-fp-slot-${partId}`}
                  aria-label={`${BASE_PART_CATALOG[partId].name} x${count}`}
                  aria-pressed={active}
                  disabled={count <= 0}
                  onClick={() => onSelectPart(partId)}
                >
                  <span className="bunker-fp-slot-key">{index + 1}</span>
                  <strong>{BASE_PART_CATALOG[partId].name}</strong>
                  <small>x{count}</small>
                </button>
              );
            })}
            <button
              type="button"
              className="bunker-fp-slot bunker-fp-slot-pry"
              data-testid="bunker-fp-pry"
              aria-label="Pry"
              aria-pressed={tool === "pry"}
              onClick={onTogglePry}
            >
              <strong>Pry</strong>
              <small>Q</small>
            </button>
            {tool === "build" && isRotatableBasePart(selectedPartId) && (
              <button
                type="button"
                className="bunker-fp-slot bunker-fp-slot-rotate"
                data-testid="bunker-fp-rotate"
                data-orientation={selectedOrientation}
                aria-label={`Rotate staircase, facing ${selectedOrientation + 1} of 4`}
                onClick={onRotate}
              >
                <strong aria-hidden="true">&#8635;</strong>
                <small>R</small>
              </button>
            )}
          </div>
          {denyNotice && (
            <div
              className="bunker-fp-deny"
              data-testid="bunker-fp-deny"
              role="status"
            >
              {denyNotice}
            </div>
          )}
          {player && (
            <div
              className="bunker-fp-status-chips"
              role="status"
              aria-label="Bunker player status"
            >
              <span className="bunker-fp-chip bunker-fp-chip-vibes">
                {`\u{1FA99} ${player.balance} vibes`}
              </span>
              <span className="bunker-fp-chip">
                {player.nextLevelXp === null
                  ? `Lv ${player.overallLevel}/${player.levelCap} \u00b7 XP capped \u00b7 Beacons ${player.beaconLimit}`
                  : `Lv ${player.overallLevel}/${player.levelCap} \u00b7 XP ${player.progressXp}/${player.progressXp + player.neededXp} \u00b7 Beacons ${player.beaconLimit}`}
              </span>
            </div>
          )}
          <button
            type="button"
            className="bunker-fp-bag"
            data-testid="bunker-fp-bag"
            aria-label="Open bag"
            aria-controls="mine-bag-panel"
            aria-expanded={bagOpen}
            title={`Open bag. ${bagOreCount} ore chunks in ${bagStackCount}/${bagCapacity} stack slots.`}
            onClick={onOpenBag}
          >
            &#127890; {bagOreCount} ({bagStackCount}/{bagCapacity})
          </button>
          <div
            className="bunker-fp-raid-start"
            data-testid="bunker-fp-raid-start"
          >
            {cooldownMsLeft > 0 ? (
              <span
                className="bunker-fp-raid-cooldown"
                data-testid="bunker-fp-raid-cooldown"
                role="status"
                title="The Clankers regroup between raids"
              >
                {`Next raid in ${formatRaidCooldown(cooldownMsLeft)}`}
              </span>
            ) : (
              <>
                {raidTierCeiling > 1 && (
                  <span className="bunker-fp-raid-tier">
                    <button
                      type="button"
                      aria-label="Lower raid tier"
                      disabled={pickedTier <= 1}
                      onClick={() => setRaidTier(Math.max(1, pickedTier - 1))}
                    >
                      -
                    </button>
                    <span data-testid="bunker-fp-raid-tier">{`Tier ${pickedTier}`}</span>
                    <button
                      type="button"
                      aria-label="Raise raid tier"
                      disabled={pickedTier >= raidTierCeiling}
                      onClick={() =>
                        setRaidTier(Math.min(raidTierCeiling, pickedTier + 1))
                      }
                    >
                      +
                    </button>
                  </span>
                )}
                <button
                  type="button"
                  className="bunker-fp-raid-start-button"
                  data-testid="bunker-fp-raid-start-button"
                  disabled={!raidStartAllowed}
                  title={
                    raidStartAllowed
                      ? undefined
                      : "Bank the bunker at the surface first"
                  }
                  onClick={() => onStartLiveRaid(pickedTier)}
                >
                  {raidTierCeiling > 1
                    ? `Start raid (T${pickedTier})`
                    : "Start raid"}
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            className="bunker-fp-exit"
            aria-label="Exit bunker"
            onClick={onExit}
          >
            Exit bunker
          </button>
          <button
            type="button"
            className="bunker-fp-status"
            data-testid="bunker-fp-status"
            aria-label="Open bunker upkeep"
            onClick={onOpenStatus}
          >
            Upkeep
          </button>
        </>
      )}
    </>
  );
}
