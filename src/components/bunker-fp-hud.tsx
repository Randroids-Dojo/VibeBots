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
import {
  BASE_PART_CATALOG,
  BASE_PART_IDS,
  type BasePartId,
  type BasePartInventory,
} from "@/sim/bunker";
import { fpInput } from "./bunker-fp-input";
import {
  type FpTargetInfo,
  getFpTargetSnapshot,
  subscribeFpTarget,
} from "./bunker-fp-target-state";
import type {
  BunkerToolAction,
  CarriedBunkerPart,
} from "./mine-bunker-toolbelt";

/** Taps on the look zone shorter than this act with the current tool. */
const FP_TAP_MS = 250;
/** ... unless the pointer wandered further than this (a look drag). */
const FP_TAP_SLOP_PX = 12;

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
 * (a quick tap on the look zone acts with the current tool; one-block
 * steps auto-jump per F-094, so there is no jump button).
 * Both get the bottom hotbar: pick slot, six part slots with counts,
 * pry toggle, and the carried-part chip. All zones write the shared
 * fpInput singleton the rig consumes each frame; the target label
 * chip subscribes to the rig's change-only target store.
 */
export function BunkerFpHud({
  inventory,
  tool,
  selectedPartId,
  carried,
  onSelectPart,
  onSelectPick,
  onTogglePry,
  onStowCarried,
  onPutBackCarried,
  onExit,
}: {
  inventory: BasePartInventory;
  tool: BunkerToolAction;
  selectedPartId: BasePartId;
  carried: CarriedBunkerPart | null;
  onSelectPart: (partId: BasePartId) => void;
  onSelectPick: () => void;
  onTogglePry: () => void;
  onStowCarried: () => void;
  onPutBackCarried: () => void;
  onExit: () => void;
}) {
  const [coarse, setCoarse] = useState(false);
  const [locked, setLocked] = useState(false);
  const js = useRef(createJoystick());
  const ringRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const [stickOn, setStickOn] = useState(false);
  const look = useRef({
    active: false,
    pointerId: -1,
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    startedAt: 0,
    moved: 0,
  });
  useEffect(() => {
    setCoarse(window.matchMedia("(hover: none) and (pointer: coarse)").matches);
    const onLockChange = () => setLocked(Boolean(document.pointerLockElement));
    document.addEventListener("pointerlockchange", onLockChange);
    onLockChange();
    return () => {
      document.removeEventListener("pointerlockchange", onLockChange);
    };
  }, []);

  // Any lingering held input dies with the overlay.
  useEffect(() => {
    return () => {
      fpInput.forward = 0;
      fpInput.strafe = 0;
      fpInput.lookX = 0;
      fpInput.lookY = 0;
      fpInput.act = false;
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
    look.current.active = true;
    look.current.pointerId = event.pointerId;
    look.current.x = event.clientX;
    look.current.y = event.clientY;
    look.current.startX = event.clientX;
    look.current.startY = event.clientY;
    look.current.startedAt = performance.now();
    look.current.moved = 0;
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
    look.current.active = false;
    look.current.pointerId = -1;
  };

  const lookUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (look.current.pointerId !== event.pointerId) return;
    const wasTap =
      look.current.active &&
      performance.now() - look.current.startedAt < FP_TAP_MS &&
      look.current.moved < FP_TAP_SLOP_PX;
    look.current.active = false;
    look.current.pointerId = -1;
    // A quick, still tap acts with the current tool; the rig consumes
    // the flag on its next frame against the live crosshair target.
    if (wasTap) fpInput.act = true;
  };

  const carriedDef = carried ? BASE_PART_CATALOG[carried.part.partId] : null;

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
      <FpTargetLabel />
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
        {BASE_PART_IDS.map((partId, index) => {
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
      </div>
      {carried && carriedDef && (
        <div className="bunker-fp-carried" role="status">
          <span>
            Carrying <strong>{carriedDef.name}</strong>{" "}
            {carried.part.durability}/{carriedDef.durability}
          </span>
          <button type="button" onClick={onStowCarried}>
            Stow part
          </button>
          <button type="button" onClick={onPutBackCarried}>
            Put back
          </button>
        </div>
      )}
      <button
        type="button"
        className="bunker-fp-exit"
        aria-label="Exit bunker"
        onClick={onExit}
      >
        Exit bunker
      </button>
    </>
  );
}
