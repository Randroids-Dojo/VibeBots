"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { AppRelease } from "@/lib/app-release-types";
import {
  CONSUMABLE_PRICES,
  cargoCapacity,
  carriedCount,
  carriedValue,
  cellAt,
  type Direction,
  ELEVATOR_COL,
  ELEVATOR_SEGMENT_ROWS,
  elevatorSegmentPrice,
  findBeacon,
  GEAR_TRACKS,
  type MineAction,
  type MineGear,
  type MineState,
  maxEnergy,
  maxGearLevel,
  oreDef,
  returnEnergyCost,
  returnLadderNeed,
  stratumAt,
  warpRange,
} from "@/sim/mine";
import { PART_CATALOG } from "@/sim/parts";
import { useMineStore } from "@/state/mine-store";
import { mineShopNoteSfxEvent, playMineSfxEvent } from "./mine-sfx";
import { type StallDef, stallAt } from "./mine-stalls";
import { MineTouchControls } from "./mine-touch-controls";

const MineCanvas = dynamic(() => import("./mine-canvas"), { ssr: false });

const RELEASE_LAST_PLAYED_KEY = "vibebots-last-played-app-version";
const RELEASE_LAST_PLAYED_BUILD_KEY = "vibebots-last-played-app-build";
const RELEASE_DISMISSED_KEY = "vibebots-release-notes-dismissed-id";
const RELEASE_PENDING_FROM_BUILD_KEY = "vibebots-release-notes-from-build";

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowDown: "down",
  ArrowUp: "up",
  ArrowLeft: "left",
  ArrowRight: "right",
  s: "down",
  w: "up",
  a: "left",
  d: "right",
};

/** Min gap between auto-repeated key moves; matches the thumbstick. */
const KEY_REPEAT_MS = 440;

const chipStyle: React.CSSProperties = {
  background: "rgba(17, 21, 31, 0.82)",
  border: "1px solid #26304a",
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: "0.8rem",
  lineHeight: 1.3,
  whiteSpace: "nowrap",
  display: "inline-block",
};

const iconButtonStyle: React.CSSProperties = {
  background: "rgba(17, 21, 31, 0.88)",
  border: "1px solid #26304a",
  borderRadius: 14,
  color: "#e6e8ee",
  minWidth: 54,
  height: 46,
  fontSize: "0.95rem",
  pointerEvents: "auto",
};

/** Banner shown for a few seconds when the miner enters a new stratum. */
function StratumBanner({ row }: { row: number }) {
  const [banner, setBanner] = useState<string | null>(null);
  const deepestSeen = useRef(0);
  const stratum = stratumAt(row);

  useEffect(() => {
    if (row <= deepestSeen.current) return;
    const wasStratum = stratumAt(deepestSeen.current);
    deepestSeen.current = row;
    if (stratum.name === wasStratum.name) return;
    setBanner(`Entering ${stratum.name}`);
    const timer = setTimeout(() => setBanner(null), 2600);
    return () => clearTimeout(timer);
  }, [row, stratum.name]);

  if (!banner) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 90,
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(17, 21, 31, 0.92)",
        border: "1px solid #54e0c7",
        color: "#54e0c7",
        borderRadius: 10,
        padding: "10px 22px",
        fontSize: "1.1rem",
        fontWeight: 600,
        pointerEvents: "none",
      }}
    >
      {banner}
    </div>
  );
}

function storedBuild(key: string): number | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function releaseNoteTexts(release: AppRelease): string[] {
  const items = release.changes.map((change) => change.text);
  return items.length > 0 ? items : ["Fresh build deployed."];
}

function releaseNoteContent(release: AppRelease): {
  intro: string | null;
  items: string[];
} {
  return {
    intro: release.intro ?? null,
    items: releaseNoteTexts(release),
  };
}

function ReleaseNotesPopup({
  release,
  manualOpenCount,
}: {
  release: AppRelease;
  manualOpenCount: number;
}) {
  const [content, setContent] = useState<{
    intro: string | null;
    items: string[];
  }>({ intro: null, items: [] });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (manualOpenCount <= 0) return;
    setContent(releaseNoteContent(release));
    setVisible(true);
  }, [manualOpenCount, release]);

  useEffect(() => {
    const lastPlayed = localStorage.getItem(RELEASE_LAST_PLAYED_KEY);
    const dismissed = localStorage.getItem(RELEASE_DISMISSED_KEY);
    const lastPlayedBuild = storedBuild(RELEASE_LAST_PLAYED_BUILD_KEY);
    let fromBuild = storedBuild(RELEASE_PENDING_FROM_BUILD_KEY);

    if (lastPlayed && lastPlayed !== release.version) {
      fromBuild = lastPlayedBuild;
      if (fromBuild !== null) {
        localStorage.setItem(RELEASE_PENDING_FROM_BUILD_KEY, String(fromBuild));
      } else {
        localStorage.removeItem(RELEASE_PENDING_FROM_BUILD_KEY);
      }
    }

    if (lastPlayed !== release.version) {
      localStorage.setItem(RELEASE_LAST_PLAYED_KEY, release.version);
      if (release.build !== null) {
        localStorage.setItem(
          RELEASE_LAST_PLAYED_BUILD_KEY,
          String(release.build),
        );
      } else {
        localStorage.removeItem(RELEASE_LAST_PLAYED_BUILD_KEY);
      }
    }

    if (dismissed === release.noticeId) return;
    if (!lastPlayed && !release.showToAll) return;

    const unseen = release.showToAll
      ? release.changes.map((change) => change.text)
      : release.changes
          .filter(
            (change) =>
              fromBuild === null ||
              change.build === null ||
              change.build > fromBuild,
          )
          .slice(0, 4)
          .map((change) => change.text);
    setContent({
      intro: release.intro ?? null,
      items: unseen.length > 0 ? unseen : ["Fresh build deployed."],
    });
    setVisible(true);
  }, [release]);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(RELEASE_DISMISSED_KEY, release.noticeId);
    localStorage.removeItem(RELEASE_PENDING_FROM_BUILD_KEY);
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="release-notes-title"
      data-app-version={release.version}
      data-release-note-id={release.noticeId}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(5, 8, 13, 0.58)",
        pointerEvents: "auto",
      }}
    >
      <section
        style={{
          width: "min(92vw, 360px)",
          border: "1px solid #54e0c7",
          borderRadius: 12,
          background: "rgba(17, 21, 31, 0.97)",
          boxShadow: "0 18px 54px rgba(0, 0, 0, 0.52)",
          color: "#e6e8ee",
          padding: "16px 18px",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <h2
            id="release-notes-title"
            style={{
              margin: 0,
              flex: 1,
              color: "#54e0c7",
              fontSize: "1.02rem",
              lineHeight: 1.2,
            }}
          >
            New in VibeBots
          </h2>
          <span
            style={{
              color: "#8b93a7",
              fontSize: "0.72rem",
              fontWeight: 700,
            }}
          >
            v{release.version}
          </span>
        </header>
        {content.intro && (
          <p
            style={{
              margin: "0 0 12px",
              color: "#dce5f7",
              fontSize: "0.9rem",
              lineHeight: 1.35,
            }}
          >
            {content.intro}
          </p>
        )}
        <ul
          style={{
            margin: "0 0 14px",
            paddingLeft: 18,
            color: "#cdd6ea",
            fontSize: "0.88rem",
            lineHeight: 1.35,
          }}
        >
          {content.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <button
          type="button"
          onClick={dismiss}
          style={{
            width: "100%",
            minHeight: 42,
            borderRadius: 10,
            border: "1px solid #54e0c7",
            background: "#172b30",
            color: "#54e0c7",
            fontWeight: 800,
            fontSize: "0.9rem",
            cursor: "pointer",
          }}
        >
          Got it
        </button>
      </section>
    </div>
  );
}

/**
 * Render-layer near-miss search (REQ-019): the best treasure within
 * reach of where the lamp died, from rows the client already generated.
 */
function nearMissLine(
  mine: MineState,
  at: { col: number; row: number },
): string | null {
  let best: { name: string; value: number; dist: number } | null = null;
  const lo = Math.max(1, at.row - 6);
  const hi = at.row + 6;
  for (let r = lo; r <= hi; r++) {
    for (let c = at.col - 6; c <= at.col + 6; c++) {
      const cell = cellAt(mine, c, r);
      if (!cell) continue;
      const dist = Math.abs(r - at.row) + Math.abs(c - at.col);
      if (dist === 0 || dist > 6) continue;
      const value =
        cell.kind === "part-cache"
          ? 999
          : cell.kind === "ore" && cell.ore
            ? oreDef(cell.ore).value
            : 0;
      if (value < 20) continue;
      const name =
        cell.kind === "part-cache"
          ? "a part cache"
          : cell.ore
            ? oreDef(cell.ore).name.toLowerCase()
            : "";
      if (
        !best ||
        value > best.value ||
        (value === best.value && dist < best.dist)
      ) {
        best = { name, value, dist };
      }
    }
  }
  if (!best) return null;
  const what = best.name === "a part cache" ? best.name : `a ${best.name}`;
  return `${what} sat ${best.dist} block${best.dist > 1 ? "s" : ""} from where the lamp died.`;
}

interface FloatNote {
  id: number;
  text: string;
  color: string;
}

/** Floating pickup text, cache fanfare, and the collapse reveal. */
function JuiceOverlays() {
  const tick = useMineStore((s) => s.tick);
  const mine = useMineStore((s) => s.mine);
  const lastResult = useMineStore((s) => s.lastResult);
  const [floats, setFloats] = useState<FloatNote[]>([]);
  const [fanfare, setFanfare] = useState<string | null>(null);
  const [wreck, setWreck] = useState<{
    crushed: boolean;
    abandoned: boolean;
    value: number;
    parts: number;
    nearMiss: string | null;
  } | null>(null);
  const nextId = useRef(1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the event stream; the rest is read-at-fire
  useEffect(() => {
    if (!lastResult?.ok) return;
    if (lastResult.dugOre) {
      const ore = oreDef(lastResult.dugOre);
      const id = nextId.current++;
      setFloats((prev) => [
        ...prev.slice(-4),
        { id, text: `+${ore.value} vibes`, color: "#54e0c7" },
      ]);
      setTimeout(
        () => setFloats((prev) => prev.filter((f) => f.id !== id)),
        1300,
      );
    }
    if (lastResult.found) {
      const name = PART_CATALOG[lastResult.found]?.name ?? lastResult.found;
      setFanfare(`Cache cracked: ${name}!`);
      setTimeout(() => setFanfare(null), 2800);
    }
    if (lastResult.collapsed && lastResult.lost) {
      setWreck({
        crushed: lastResult.crushed ?? false,
        abandoned: lastResult.abandoned ?? false,
        value: lastResult.lost.value,
        parts: lastResult.lost.parts.length,
        nearMiss: nearMissLine(mine, lastResult.lost),
      });
    }
  }, [tick]);

  return (
    <>
      {floats.map((f, i) => (
        <div
          key={f.id}
          className="mine-juice"
          style={{
            position: "absolute",
            left: "50%",
            top: `calc(50% - ${i * 18}px)`,
            transform: "translateX(-50%)",
            color: f.color,
            fontWeight: 700,
            fontSize: "1.05rem",
            textShadow: "0 1px 6px rgba(0,0,0,0.8)",
            pointerEvents: "none",
            animation: "mine-float-up 1.25s ease-out forwards",
          }}
        >
          {f.text}
        </div>
      ))}
      {fanfare && (
        <div
          className="mine-juice"
          style={{
            position: "absolute",
            top: 140,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(40, 32, 8, 0.95)",
            border: "2px solid #f5c542",
            color: "#f5c542",
            borderRadius: 12,
            padding: "14px 30px",
            fontSize: "1.25rem",
            fontWeight: 700,
            pointerEvents: "none",
            animation: "mine-fanfare-pop 2.8s ease-out forwards",
            boxShadow: "0 0 30px rgba(245, 197, 66, 0.35)",
          }}
        >
          {fanfare}
        </div>
      )}
      {wreck && (
        <button
          type="button"
          onClick={() => setWreck(null)}
          aria-label="Dismiss trip report"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 20,
            background:
              "radial-gradient(ellipse at center, rgba(60, 10, 10, 0.35), rgba(10, 4, 4, 0.85))",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "rgba(24, 12, 14, 0.96)",
              border: "1px solid #ff6b6b",
              borderRadius: 12,
              padding: "20px 30px",
              maxWidth: 360,
              color: "#ffd9d9",
              textAlign: "center",
            }}
          >
            <p style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>
              {wreck.crushed
                ? "Crushed by a boulder"
                : wreck.abandoned
                  ? "Abandoned the dig"
                  : "The lamp died"}
            </p>
            <p style={{ margin: "10px 0 0", fontSize: "0.95rem" }}>
              {wreck.value > 0 || wreck.parts > 0
                ? `The cargo stayed below: ${wreck.value} vibes${wreck.parts > 0 ? ` and ${wreck.parts} part${wreck.parts > 1 ? "s" : ""}` : ""}.`
                : "At least the hold was empty."}
            </p>
            {wreck.nearMiss && (
              <p
                style={{
                  margin: "10px 0 0",
                  fontSize: "0.9rem",
                  color: "#f5c542",
                }}
              >
                So close: {wreck.nearMiss}
              </p>
            )}
            <p style={{ margin: "12px 0 0", fontSize: "0.8rem", opacity: 0.7 }}>
              tap anywhere for one more trip
            </p>
          </div>
        </button>
      )}
    </>
  );
}

/** Big-tap-target sheet row: icon tile, label, action button. */
function SheetRow({
  icon,
  name,
  sub,
  badge,
  action,
}: {
  icon: string;
  name: string;
  sub?: string;
  badge?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px solid rgba(38, 48, 74, 0.55)",
      }}
    >
      <span
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          background: "rgba(38, 48, 74, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.2rem",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{ display: "block", fontSize: "0.95rem", fontWeight: 600 }}
        >
          {name}
          {badge && (
            <span
              style={{
                marginLeft: 8,
                fontSize: "0.75rem",
                fontWeight: 700,
                color: "#54e0c7",
              }}
            >
              {badge}
            </span>
          )}
        </span>
        {sub && (
          <span
            style={{ display: "block", fontSize: "0.72rem", opacity: 0.55 }}
          >
            {sub}
          </span>
        )}
      </span>
      {action}
    </div>
  );
}

/** Downward drag distance (px) past which releasing closes the sheet. */
const SWIPE_DISMISS_PX = 70;

const sheetButtonStyle = (enabled: boolean): React.CSSProperties => ({
  minWidth: 78,
  minHeight: 42,
  borderRadius: 12,
  border: "1px solid #2c3a5c",
  background: enabled ? "#1d2738" : "rgba(29, 39, 56, 0.4)",
  color: enabled ? "#e6e8ee" : "rgba(230, 232, 238, 0.35)",
  fontWeight: 700,
  fontSize: "0.9rem",
});

const STALL_ICONS: Record<StallDef["id"], string> = {
  buyer: "\u{1F3E6}",
  supply: "\u{1F4E6}",
  upgrades: "\u{1F6E0}\u{FE0F}",
  elevator: "\u{1F6D7}",
  warp: "\u{1F300}",
};

const ITEM_ICONS: Record<string, string> = {
  dynamite: "\u{1F9E8}",
  rope: "\u{1FAA2}",
  ladder: "\u{1FA9C}",
  plank: "\u{1FAB5}",
  beacon: "\u{1F4E1}",
  pickaxe: "\u{26CF}\u{FE0F}",
  lamp: "\u{1F526}",
  cargo: "\u{1F392}",
  lantern: "\u{1F3EE}",
  warpcoil: "\u{1F300}",
  blast: "\u{1F4A5}",
  elevatorSpeed: "\u{1F6D7}",
};

type DepotItem = "dynamite" | "rope" | "ladder" | "plank" | "beacon";
const DEPOT_BUY_QUANTITIES = [1, 5, 10] as const;

/**
 * The shop sheet (REQ-021): standing at a stall slides a mobile bottom
 * sheet up over the lower screen, with thumb-sized rows and the wallet
 * in the header. Walking off the column closes it.
 */
function StallMenu({
  stall,
  mine,
  gear,
  balance,
  shopNote,
  cashOutPending,
  onCashOut,
  onBuyConsumable,
  onBuyGear,
  onBuyElevator,
  onRide,
  onClose,
}: {
  stall: StallDef;
  mine: MineState;
  gear: MineGear;
  balance: number | null;
  shopNote: string | null;
  cashOutPending: boolean;
  onCashOut: () => void;
  onBuyConsumable: (item: DepotItem, quantity: number) => void;
  onBuyGear: (track: keyof MineGear) => void;
  onBuyElevator: () => void;
  onRide: (dir: "ride-down" | "ride-up" | "warp-down" | "warp-home") => void;
  onClose: () => void;
}) {
  const miner = mine.miner;
  const banked = miner.bankedCredits;
  const bankedParts = miner.bankedParts.length;
  const offline = balance === null;
  const beacon = findBeacon(mine);
  // Swipe-to-dismiss: the grab zone follows the finger down, and a far
  // enough pull (or a flick) closes the sheet. A short tug snaps back.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [buyQuantity, setBuyQuantity] = useState(1);
  const dragStart = useRef<number | null>(null);
  const dismiss = () => {
    setDragY(0);
    setDragging(false);
    dragStart.current = null;
    onClose();
  };
  const onGrabDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = e.clientY;
    setDragging(true);
  };
  const onGrabMove = (e: React.PointerEvent) => {
    if (dragStart.current === null) return;
    const dy = e.clientY - dragStart.current;
    setDragY(dy > 0 ? dy : 0);
  };
  const onGrabUp = (e: React.PointerEvent) => {
    if (dragStart.current === null) return;
    const dy = e.clientY - dragStart.current;
    dragStart.current = null;
    setDragging(false);
    if (dy > SWIPE_DISMISS_PX) dismiss();
    else setDragY(0);
  };
  return (
    <section
      aria-label={stall.name}
      className="stall-sheet"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        margin: "0 auto",
        maxWidth: 440,
        background:
          "linear-gradient(180deg, rgba(21, 27, 41, 0.97), rgba(12, 15, 23, 0.99))",
        borderTop: `2px solid ${stall.color}`,
        borderRadius: "18px 18px 0 0",
        boxShadow: "0 -14px 44px rgba(0, 0, 0, 0.55)",
        padding: "8px 18px 18px",
        zIndex: 10,
        transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
        transition: dragging ? "none" : "transform 180ms ease",
      }}
    >
      {/* Grab zone: the handle plus the strip around it (the iOS sheet
          convention). Pointer drag here pulls the sheet down to close. */}
      <div
        onPointerDown={onGrabDown}
        onPointerMove={onGrabMove}
        onPointerUp={onGrabUp}
        onPointerCancel={onGrabUp}
        style={{
          margin: "-8px -18px 0",
          padding: "10px 18px 4px",
          touchAction: "none",
          cursor: "grab",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 38,
            height: 4,
            borderRadius: 999,
            background: stall.color,
            opacity: 0.4,
            margin: "0 auto 8px",
          }}
        />
      </div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: "1.5rem" }}>{STALL_ICONS[stall.id]}</span>
        <span style={{ flex: 1 }}>
          <span
            style={{
              display: "block",
              fontWeight: 800,
              fontSize: "1.05rem",
              color: stall.color,
            }}
          >
            {stall.name}
          </span>
          <span
            style={{ display: "block", fontSize: "0.72rem", opacity: 0.55 }}
          >
            {stall.blurb}
          </span>
        </span>
        <span
          style={{
            background: "rgba(38, 48, 74, 0.6)",
            borderRadius: 999,
            padding: "6px 12px",
            fontSize: "0.85rem",
            fontWeight: 700,
            color: offline ? "#8b93a7" : "#f5c542",
            whiteSpace: "nowrap",
          }}
        >
          {offline ? "offline" : `\u{1F4B0} ${balance} vibes`}
        </span>
        <button
          type="button"
          aria-label="Close shop"
          onClick={dismiss}
          style={{
            flexShrink: 0,
            width: 34,
            height: 34,
            borderRadius: 999,
            border: "1px solid rgba(255, 255, 255, 0.18)",
            background: "rgba(38, 48, 74, 0.6)",
            color: "#cdd6ea",
            fontSize: "1.2rem",
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          {"×"}
        </button>
      </header>
      {offline && (
        <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "#f5c542" }}>
          the ledger is offline right now; browsing only
        </p>
      )}
      {stall.id === "buyer" &&
        (banked > 0 || bankedParts > 0 ? (
          <>
            <SheetRow
              icon={"\u{1F4B0}"}
              name={`${banked} vibes banked`}
              sub={
                bankedParts > 0
                  ? `plus ${bankedParts} part${bankedParts > 1 ? "s" : ""} for the workshop`
                  : "hauled up and ready to sell"
              }
            />
            <button
              type="button"
              onClick={onCashOut}
              disabled={cashOutPending || offline}
              style={{
                ...sheetButtonStyle(!cashOutPending && !offline),
                width: "100%",
                marginTop: 12,
                minHeight: 48,
                background:
                  cashOutPending || offline
                    ? "rgba(58, 47, 16, 0.4)"
                    : "#3a2f10",
                borderColor: "#f5c542",
                color: cashOutPending || offline ? "#8b93a7" : "#f5c542",
              }}
            >
              {cashOutPending ? "Selling..." : "Sell banked loot"}
            </button>
          </>
        ) : (
          <p
            style={{ margin: "12px 0 2px", fontSize: "0.85rem", opacity: 0.7 }}
          >
            nothing banked yet; haul something up and it banks.
          </p>
        ))}
      {stall.id === "supply" && (
        <div>
          <fieldset
            aria-label="Buy quantity"
            style={{
              display: "flex",
              gap: 8,
              margin: "10px 0 6px",
              padding: 0,
              border: 0,
            }}
          >
            {DEPOT_BUY_QUANTITIES.map((quantity) => {
              const active = buyQuantity === quantity;
              return (
                <button
                  key={quantity}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setBuyQuantity(quantity)}
                  style={{
                    border: active ? "1px solid #54e0c7" : "1px solid #2c3a5c",
                    background: active
                      ? "rgba(84, 224, 199, 0.16)"
                      : "rgba(38, 48, 74, 0.55)",
                    color: active ? "#54e0c7" : "#cdd6ea",
                    borderRadius: 10,
                    minWidth: 48,
                    minHeight: 34,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  x{quantity}
                </button>
              );
            })}
          </fieldset>
          {(
            [
              ["dynamite", "Dynamite", "blasts a plus through anything"],
              ["rope", "Recall Rope", "bank the carry from anywhere"],
              ["ladder", "Ladder", "climbs one cell, stays planted"],
              ["plank", "Plank", "bridges one gap, stays planted"],
              ["beacon", "Warp Beacon", "plants the warp anchor"],
            ] as const
          ).map(([item, name, blurb]) => {
            const price = CONSUMABLE_PRICES[item];
            const totalPrice = price * buyQuantity;
            const affordable = balance !== null && balance >= totalPrice;
            return (
              <SheetRow
                key={item}
                icon={ITEM_ICONS[item]}
                name={name}
                sub={blurb}
                badge={`have ${mine.consumables[item]}`}
                action={
                  <button
                    type="button"
                    onClick={() => onBuyConsumable(item, buyQuantity)}
                    disabled={!affordable}
                    style={{ ...sheetButtonStyle(affordable), minWidth: 124 }}
                  >
                    Buy {buyQuantity} for {totalPrice} vibes
                  </button>
                }
              />
            );
          })}
          <p style={{ margin: "10px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
            purchases pack straight into your current trip. Ladders and planks
            cost vibes now; the only free batch comes from dying in the mine,
            which refills you to 8 ladders and 4 planks.
          </p>
        </div>
      )}
      {stall.id === "upgrades" && (
        <div>
          {GEAR_TRACKS.map((def) => {
            // blast is optional on gear (absent reads as level 1).
            const level = gear[def.track] ?? 1;
            const maxed = level >= maxGearLevel(def.track);
            const price = maxed ? null : def.prices[level - 1];
            const affordable =
              price !== null && balance !== null && balance >= price;
            return (
              <SheetRow
                key={def.track}
                icon={ITEM_ICONS[def.track] ?? "\u{2699}\u{FE0F}"}
                name={def.name}
                sub={def.blurb}
                badge={`lv ${level}`}
                action={
                  maxed ? (
                    <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>
                      max
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onBuyGear(def.track)}
                      disabled={!affordable}
                      style={sheetButtonStyle(affordable)}
                    >
                      {price} vibes
                    </button>
                  )
                }
              />
            );
          })}
          <p style={{ margin: "10px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
            upgrades bought mid-dig apply on the next trip.
          </p>
        </div>
      )}
      {stall.id === "elevator" && (
        <div>
          <SheetRow
            icon={"\u{1F6D7}"}
            name={
              gear.elevator > 0
                ? `rail reaches ${gear.elevator} deep`
                : "no rail yet; the shaft waits"
            }
            sub="free rides, surface to rail end"
            action={
              <button
                type="button"
                onClick={onBuyElevator}
                disabled={
                  balance === null ||
                  balance <
                    elevatorSegmentPrice(
                      gear.elevator / ELEVATOR_SEGMENT_ROWS + 1,
                    )
                }
                style={sheetButtonStyle(
                  balance !== null &&
                    balance >=
                      elevatorSegmentPrice(
                        gear.elevator / ELEVATOR_SEGMENT_ROWS + 1,
                      ),
                )}
              >
                {elevatorSegmentPrice(
                  gear.elevator / ELEVATOR_SEGMENT_ROWS + 1,
                )}{" "}
                vibes
              </button>
            }
          />
          <p style={{ margin: "6px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
            each segment extends the rail {ELEVATOR_SEGMENT_ROWS} rows
          </p>
          <button
            type="button"
            onClick={() => onRide("ride-down")}
            disabled={mine.gear.elevator <= 0}
            style={{
              ...sheetButtonStyle(mine.gear.elevator > 0),
              width: "100%",
              marginTop: 12,
              minHeight: 48,
            }}
          >
            {mine.gear.elevator > 0
              ? `Ride down (rail to ${mine.gear.elevator})`
              : "Ride down (no rail)"}
          </button>
        </div>
      )}
      {stall.id === "warp" && (
        <div>
          <SheetRow
            icon={ITEM_ICONS.beacon}
            name={
              beacon
                ? `beacon planted at ${beacon.row} deep`
                : "no beacon planted; kits at the depot"
            }
            sub={`warpcoil range ${warpRange(mine.gear)} rows (upgrade at the Upgrades stall)`}
          />
          <button
            type="button"
            onClick={() => onRide("warp-down")}
            disabled={!beacon || beacon.row > warpRange(mine.gear)}
            style={{
              ...sheetButtonStyle(
                !!beacon && beacon.row <= warpRange(mine.gear),
              ),
              width: "100%",
              marginTop: 12,
              minHeight: 48,
            }}
          >
            Warp to beacon
          </button>
        </div>
      )}
      {shopNote && (
        <p style={{ margin: "12px 0 0", fontSize: "0.8rem", color: "#54e0c7" }}>
          {shopNote}
        </p>
      )}
    </section>
  );
}

export function MinePanel({ appRelease }: { appRelease: AppRelease }) {
  const tick = useMineStore((s) => s.tick);
  const mine = useMineStore((s) => s.mine);
  const lastResult = useMineStore((s) => s.lastResult);
  const move = useMineStore((s) => s.move);
  const cashOut = useMineStore((s) => s.cashOut);
  const submitCashOut = useMineStore((s) => s.submitCashOut);
  const gear = useMineStore((s) => s.gear);
  const loadGear = useMineStore((s) => s.loadGear);
  const loadWorld = useMineStore((s) => s.loadWorld);
  const balance = useMineStore((s) => s.balance);
  const shopNote = useMineStore((s) => s.shopNote);
  const buyConsumable = useMineStore((s) => s.buyConsumable);
  const buyGearUpgrade = useMineStore((s) => s.buyGearUpgrade);
  const buyElevator = useMineStore((s) => s.buyElevator);
  const [dynamiteArmed, setDynamiteArmedState] = useState(false);
  const [abandonArmed, setAbandonArmed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [releaseNotesOpenCount, setReleaseNotesOpenCount] = useState(0);
  // The column whose stall sheet is open. Standing on a stall no longer
  // auto-opens it: a prompt button appears and tapping it sets this.
  // Stepping off clears it, so walking by never pops the menu.
  const [openStallCol, setOpenStallCol] = useState<number | null>(null);
  // Touch players never see keyboard copy (matches the renderer's
  // coarse-pointer heuristic). False during SSR; set before paint.
  const [coarsePointer, setCoarsePointer] = useState(false);
  const armedRef = useRef(false);
  const lastCashOutStateRef = useRef(cashOut.state);
  const lastShopNoteRef = useRef<string | null>(null);
  // Throttle held-key auto-repeat to the same walk cadence as the
  // thumbstick; deliberate presses (event.repeat false) always fire.
  const lastKeyMoveRef = useRef(0);
  const setDynamiteArmed = (value: boolean | ((prev: boolean) => boolean)) => {
    armedRef.current =
      typeof value === "function" ? value(armedRef.current) : value;
    setDynamiteArmedState(armedRef.current);
  };
  void tick;

  useEffect(() => {
    // The world first (it seeds the mine), then gear (which rebuilds
    // the trip over that world when levels differ).
    void loadWorld().then(() => loadGear());
  }, [loadWorld, loadGear]);

  useEffect(() => {
    setCoarsePointer(window.matchMedia?.("(pointer: coarse)").matches ?? false);
  }, []);

  useEffect(() => {
    if (lastCashOutStateRef.current === cashOut.state) return;
    lastCashOutStateRef.current = cashOut.state;
    if (cashOut.state === "done") playMineSfxEvent("sell");
    else if (cashOut.state === "error" || cashOut.state === "unavailable") {
      playMineSfxEvent("deny");
    }
  }, [cashOut.state]);

  useEffect(() => {
    if (!shopNote || shopNote === lastShopNoteRef.current) return;
    lastShopNoteRef.current = shopNote;
    const event = mineShopNoteSfxEvent(shopNote);
    if (event) playMineSfxEvent(event);
  }, [shopNote]);

  // Moving off the column closes any open sheet, so the menu never
  // follows the miner and a return shows the prompt, not the open sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: column is the reset trigger, not read in the body; dropping it would fire once and never re-close
  useEffect(() => {
    setOpenStallCol(null);
  }, [mine.miner.col]);

  // The abandon confirm disarms itself; a stray thumb cannot torch a
  // haul twenty minutes deep.
  useEffect(() => {
    if (!abandonArmed) return;
    // Generous on purpose: the guard exists to stop double-tap
    // accidents (sub-second), and slow devices can take seconds
    // between deliberate taps.
    const timer = setTimeout(() => setAbandonArmed(false), 8000);
    return () => clearTimeout(timer);
  }, [abandonArmed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const targetEl = event.target as HTMLElement | null;
      if (
        targetEl &&
        (targetEl.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(targetEl.tagName))
      ) {
        return;
      }
      const dir = KEY_DIRECTIONS[event.key];
      if (!dir) return;
      event.preventDefault();
      // Held keys auto-repeat far faster than the walk cadence; clamp
      // the repeats so keyboard speed matches the thumbstick.
      if (event.repeat && Date.now() - lastKeyMoveRef.current < KEY_REPEAT_MS) {
        return;
      }
      lastKeyMoveRef.current = Date.now();
      if (armedRef.current) {
        armedRef.current = false;
        setDynamiteArmedState(false);
        useMineStore.getState().move(`dynamite-${dir}` as MineAction);
      } else {
        useMineStore.getState().move(dir);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const miner = mine.miner;
  const stratum = stratumAt(miner.row);
  const carryValue = carriedValue(miner);
  const climbCost = returnEnergyCost(miner);
  // The climb estimate assumes a cleared shaft; warn with a margin so a
  // detour or two does not turn the warning into a lie (REQ-017).
  const lampLow = miner.row > 0 && miner.energy < climbCost * 1.25 + 2;
  // Ladder budget for the same straight-home climb (REQ-020).
  const laddersNeeded = returnLadderNeed(mine);
  const ladderShort = miner.row > 0 && laddersNeeded > mine.consumables.ladder;
  // The village (REQ-021): standing on a stall's column opens its menu,
  // unless the player just closed it here (swipe-down or close button).
  const stall = miner.row === 0 ? stallAt(miner.col) : null;

  // One terse toast, game-style: the chips carry the numbers.
  const statusLine =
    lastResult && !lastResult.ok
      ? lastResult.reason === "rock"
        ? "Too hard for this pickaxe."
        : lastResult.reason === "hold-full"
          ? "Hold full. Bank it topside."
          : lastResult.reason === "no-dynamite"
            ? "No dynamite."
            : lastResult.reason === "no-ladder"
              ? "No ladders to climb. Recall or buy more."
              : lastResult.reason === "no-plank"
                ? "No planks to bridge that drop."
                : lastResult.reason === "no-beacon"
                  ? "No beacon. Kits are at the depot."
                  : lastResult.reason === "out-of-range"
                    ? "Beacon out of warpcoil range. Upgrade at the Upgrades stall."
                    : lastResult.reason === "no-rope"
                      ? "No rope."
                      : lastResult.reason === "surface"
                        ? undefined
                        : lastResult.reason === "blocked"
                          ? "No way through."
                          : "Edge of the mine."
      : lastResult?.ok && lastResult.crushed
        ? "Crushed! The crew dug you out; the cargo stayed behind."
        : lastResult?.ok && lastResult.abandoned
          ? "Abandoned the dig; the carry stayed behind."
          : lastResult?.ok && lastResult.collapsed
            ? "The lamp died. Hauled up empty."
            : lastResult?.ok && lastResult.recalled
              ? "Roped home; carry banked."
              : lastResult?.ok && (lastResult.vented ?? 0) > 0
                ? `Gas! ${(lastResult.vented ?? 0) * 8} energy burned.`
                : miner.row === 0 &&
                    (miner.bankedCredits > 0 || miner.bankedParts.length > 0)
                  ? "Sell at the Buyer (gold sign)."
                  : miner.row === 0 && mine.consumables.ladder === 0
                    ? "Out of ladders? Buy more at the depot, or a cave-in refills you to 8."
                    : undefined;
  const cashNote =
    cashOut.state === "done"
      ? `Sold for ${cashOut.credits} vibes${cashOut.milestoneBonus > 0 ? ` +${cashOut.milestoneBonus} depth bonus` : ""}${cashOut.parts.length > 0 ? ` +${cashOut.parts.length} parts` : ""}. Your mine stays.`
      : cashOut.state === "unavailable"
        ? "Couldn't sell; loot is safe, try again."
        : cashOut.state === "error"
          ? cashOut.message
          : null;

  const act = (dir: Direction) => {
    if (dynamiteArmed) {
      setDynamiteArmed(false);
      move(`dynamite-${dir}` as MineAction);
    } else {
      move(dir);
    }
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh" }}>
      <MineCanvas />
      <MineTouchControls onDirection={act} />
      <StratumBanner row={miner.row} />
      <JuiceOverlays />
      <ReleaseNotesPopup
        release={appRelease}
        manualOpenCount={releaseNotesOpenCount}
      />
      <button
        type="button"
        aria-label="Open settings"
        aria-expanded={settingsOpen}
        onClick={() => setSettingsOpen((open) => !open)}
        style={{
          position: "absolute",
          top: 58,
          right: 14,
          zIndex: 7,
          width: 42,
          height: 42,
          borderRadius: 12,
          border: "1px solid #26304a",
          background: "rgba(17, 21, 31, 0.88)",
          color: "#e6e8ee",
          fontSize: "1.12rem",
          fontWeight: 800,
          pointerEvents: "auto",
          cursor: "pointer",
        }}
      >
        &#9881;
      </button>
      {settingsOpen && (
        <section
          aria-label="Settings"
          style={{
            position: "absolute",
            top: 108,
            right: 14,
            zIndex: 7,
            width: 190,
            border: "1px solid #26304a",
            borderRadius: 12,
            background: "rgba(17, 21, 31, 0.96)",
            boxShadow: "0 12px 34px rgba(0, 0, 0, 0.42)",
            padding: 10,
            color: "#e6e8ee",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(false);
              setReleaseNotesOpenCount((count) => count + 1);
            }}
            style={{
              width: "100%",
              minHeight: 40,
              borderRadius: 10,
              border: "1px solid #54e0c7",
              background: "#172b30",
              color: "#54e0c7",
              fontSize: "0.9rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Release notes
          </button>
        </section>
      )}
      {/* Standing on a stall shows a prompt; the menu opens on tap, not
          on walk-by. Tapping again-after-close needs another tap. */}
      {stall && openStallCol !== miner.col && (
        <button
          type="button"
          aria-label={`Open ${stall.name}`}
          onClick={() => setOpenStallCol(miner.col)}
          style={{
            position: "absolute",
            bottom: 92,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            borderRadius: 999,
            border: `2px solid ${stall.color}`,
            background: "rgba(17, 21, 31, 0.92)",
            color: "#e6e8ee",
            fontWeight: 700,
            fontSize: "0.95rem",
            boxShadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
            zIndex: 8,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>{STALL_ICONS[stall.id]}</span>
          <span style={{ color: stall.color }}>{stall.name}</span>
          <span style={{ opacity: 0.6, fontSize: "0.82rem" }}>Tap to open</span>
        </button>
      )}
      {stall && openStallCol === miner.col && (
        <StallMenu
          stall={stall}
          mine={mine}
          gear={gear}
          balance={balance}
          shopNote={shopNote}
          cashOutPending={cashOut.state === "pending"}
          onCashOut={() => void submitCashOut()}
          onBuyConsumable={(item, quantity) =>
            void buyConsumable(item, quantity)
          }
          onBuyGear={(track) => void buyGearUpgrade(track)}
          onBuyElevator={() => void buyElevator()}
          onRide={(dir) => move(dir)}
          onClose={() => setOpenStallCol(null)}
        />
      )}

      {/* Chip HUD (REQ-024): thin, glanceable, game-first. Data
          attributes are the stable test surface; copy can change. */}
      <section
        aria-label="Mine status"
        data-depth={miner.row}
        data-energy={miner.energy.toFixed(1)}
        data-ladders={mine.consumables.ladder}
        data-planks={mine.consumables.plank}
        data-banked={miner.bankedCredits}
        data-climb-ladders={laddersNeeded}
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          right: 12,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 6,
          pointerEvents: "none",
          zIndex: 5,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            maxWidth: "calc(100% - 250px)",
          }}
        >
          <span style={chipStyle}>
            <span style={{ opacity: 0.65 }}>&#9660;</span> {miner.row}{" "}
            <span style={{ opacity: 0.65 }}>{stratum.name}</span>
          </span>
          <span
            style={{
              ...chipStyle,
              position: "relative",
              overflow: "hidden",
              minWidth: 118,
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: 0,
                width: `${Math.max(0, Math.min(100, (miner.energy / maxEnergy(mine.gear)) * 100))}%`,
                background: lampLow ? "#ff6b6b" : "#54e0c7",
                opacity: 0.3,
              }}
            />
            <span style={{ position: "relative" }}>
              &#128294; {miner.energy.toFixed(1)}/{maxEnergy(mine.gear)}
            </span>
          </span>
          <span style={chipStyle}>
            &#127890; {carriedCount(miner)}/{cargoCapacity(mine.gear)}
          </span>
          {(carryValue > 0 || miner.carriedParts.length > 0) && (
            <span style={{ ...chipStyle, color: "#f5c542" }}>
              &#128176; {carryValue} vibes
              {miner.carriedParts.length > 0 &&
                ` +${miner.carriedParts.length}p`}
            </span>
          )}
          {(miner.bankedCredits > 0 || miner.bankedParts.length > 0) && (
            <span style={{ ...chipStyle, color: "#f5c542" }}>
              &#127974; {miner.bankedCredits} vibes
              {miner.bankedParts.length > 0 && ` +${miner.bankedParts.length}p`}
            </span>
          )}
          {miner.row > 0 && (
            <span
              style={{
                ...chipStyle,
                color: lampLow || ladderShort ? "#ff6b6b" : "#8b93a7",
              }}
            >
              &#11014; {climbCost.toFixed(1)}&#9889; {laddersNeeded}&#129692;
            </span>
          )}
        </div>
        {statusLine && (
          <span style={{ ...chipStyle, color: "#f5c542" }}>{statusLine}</span>
        )}
        {cashNote && (
          <span
            style={{
              ...chipStyle,
              color: cashOut.state === "error" ? "#ff6b6b" : "#54e0c7",
            }}
          >
            {cashNote}
          </span>
        )}
      </section>

      {/* Consumable cluster: thumb-reach icon buttons. Movement is the
          thumbstick (or WASD/arrows); the D-pad is gone. */}
      <section
        aria-label="Dig controls"
        style={{
          position: "absolute",
          right: 12,
          bottom: 18,
          display: "flex",
          gap: 8,
          alignItems: "center",
          zIndex: 5,
        }}
      >
        <span
          style={{
            ...chipStyle,
            color: ladderShort ? "#ff6b6b" : "#8b93a7",
          }}
        >
          &#129692; {mine.consumables.ladder}
        </span>
        <span style={{ ...chipStyle, color: "#8b93a7" }}>
          &#129717; {mine.consumables.plank}
        </span>
        <button
          type="button"
          aria-label={`Dynamite (${mine.consumables.dynamite})`}
          onClick={() => setDynamiteArmed((armed) => !armed)}
          disabled={mine.consumables.dynamite <= 0 && !dynamiteArmed}
          aria-pressed={dynamiteArmed}
          style={{
            ...iconButtonStyle,
            ...(dynamiteArmed
              ? {
                  background: "#7a2c2c",
                  borderColor: "#ff6b6b",
                  boxShadow: "0 0 12px rgba(255, 107, 107, 0.5)",
                }
              : null),
          }}
        >
          &#129512; {mine.consumables.dynamite}
        </button>
        <button
          type="button"
          aria-label={`Recall (${mine.consumables.rope})`}
          onClick={() => {
            setDynamiteArmed(false);
            move("recall");
          }}
          disabled={mine.consumables.rope <= 0 || miner.row === 0}
          style={iconButtonStyle}
        >
          &#129526; {mine.consumables.rope}
        </button>
        {miner.row >= 1 && mine.consumables.beacon > 0 && (
          <button
            type="button"
            aria-label="Plant warp beacon"
            onClick={() => move("place-beacon")}
            style={iconButtonStyle}
          >
            &#128225; {mine.consumables.beacon}
          </button>
        )}
        {(() => {
          const beacon = findBeacon(mine);
          return (
            beacon &&
            miner.row === beacon.row &&
            miner.col === beacon.col &&
            beacon.row <= warpRange(mine.gear) && (
              <button
                type="button"
                aria-label="Warp home"
                onClick={() => move("warp-home")}
                style={iconButtonStyle}
              >
                &#127756;
              </button>
            )
          );
        })()}
        {miner.col === ELEVATOR_COL &&
          miner.row >= 1 &&
          miner.row < mine.gear.elevator && (
            <button
              type="button"
              aria-label="Ride elevator down"
              onClick={() => move("ride-down")}
              style={iconButtonStyle}
            >
              &#128727;&#11015;&#65039;
            </button>
          )}
        {miner.col === ELEVATOR_COL &&
          miner.row >= 1 &&
          miner.row <= mine.gear.elevator && (
            <button
              type="button"
              aria-label="Ride elevator up"
              onClick={() => move("ride-up")}
              style={iconButtonStyle}
            >
              &#128727;&#11014;&#65039;
            </button>
          )}
        <button
          type="button"
          aria-label="Abandon trip"
          onClick={() => {
            if (abandonArmed) {
              setAbandonArmed(false);
              setDynamiteArmed(false);
              move("abandon");
            } else {
              setAbandonArmed(true);
            }
          }}
          disabled={miner.row === 0}
          style={{
            ...iconButtonStyle,
            ...(abandonArmed
              ? {
                  background: "#7a2c2c",
                  borderColor: "#ff6b6b",
                  color: "#ffd9d9",
                }
              : null),
          }}
        >
          {abandonArmed ? "Sure?" : <>&#127987;</>}
        </button>
      </section>

      {/* One-shot onboarding: gone after the first action. */}
      {tick === 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 88,
            left: "50%",
            transform: "translateX(-50%)",
            ...chipStyle,
            color: "#8b93a7",
            pointerEvents: "none",
          }}
        >
          {coarsePointer
            ? "drag anywhere to move"
            : "drag anywhere to move \u00b7 WASD works too"}
        </div>
      )}
    </div>
  );
}
