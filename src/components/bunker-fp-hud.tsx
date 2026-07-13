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
} from "react";
import { fpInput } from "./bunker-fp-input";

/**
 * DOM overlay for the first-person bunker viewer, rendered as a
 * SIBLING of the canvas (Rule 10: all text is DOM, never in-canvas).
 * Desktop gets the exit button and a resume hint while pointer lock is
 * off; coarse pointers get the move/look/jump touch controls: a
 * float-where-you-tap VibeKit joystick on the left 45%, a drag-look
 * zone on the right 55%, and a round jump button. All zones write the
 * shared fpInput singleton the rig consumes each frame.
 */
export function BunkerFpHud({ onExit }: { onExit: () => void }) {
  const [coarse, setCoarse] = useState(false);
  const [locked, setLocked] = useState(false);
  const js = useRef(createJoystick());
  const ringRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const [stickOn, setStickOn] = useState(false);
  const look = useRef({ active: false, pointerId: -1, x: 0, y: 0 });

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
  };
  const lookMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!look.current.active || look.current.pointerId !== event.pointerId) {
      return;
    }
    fpInput.lookX += event.clientX - look.current.x;
    fpInput.lookY += event.clientY - look.current.y;
    look.current.x = event.clientX;
    look.current.y = event.clientY;
  };
  const lookUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (look.current.pointerId !== event.pointerId) return;
    look.current.active = false;
    look.current.pointerId = -1;
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
            onPointerCancel={lookUp}
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
          <button
            type="button"
            className="bunker-fp-jump"
            aria-label="Jump"
            onPointerDown={() => {
              fpInput.jump = true;
            }}
          >
            &#11014;
          </button>
        </>
      )}
      {!coarse && !locked && (
        <div className="bunker-fp-resume-hint" role="status">
          Click to look around
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
