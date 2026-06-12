"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
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
  type OreId,
  oreDef,
  returnEnergyCost,
  returnLadderNeed,
  stratumAt,
  warpRange,
} from "@/sim/mine";
import { PART_CATALOG } from "@/sim/parts";
import { useMineStore } from "@/state/mine-store";
import { type StallDef, stallAt } from "./mine-stalls";
import { MineTouchControls } from "./mine-touch-controls";

const MineCanvas = dynamic(() => import("./mine-canvas"), { ssr: false });

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
        { id, text: `+${ore.value} cr`, color: "#54e0c7" },
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
                ? `The cargo stayed below: ${wreck.value} cr${wreck.parts > 0 ? ` and ${wreck.parts} part${wreck.parts > 1 ? "s" : ""}` : ""}.`
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

/**
 * The menu for the stall the miner is standing at (REQ-021): sell at
 * the Assay Office, buy consumables at the Supply Depot, buy gear at
 * the Outfitter. Walking off the column closes it.
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
}: {
  stall: StallDef;
  mine: MineState;
  gear: MineGear;
  balance: number | null;
  shopNote: string | null;
  cashOutPending: boolean;
  onCashOut: () => void;
  onBuyConsumable: (
    item: "dynamite" | "rope" | "ladder" | "plank" | "beacon",
  ) => void;
  onBuyGear: (track: keyof MineGear) => void;
  onBuyElevator: () => void;
  onRide: (dir: "ride-down" | "ride-up" | "warp-down" | "warp-home") => void;
}) {
  const miner = mine.miner;
  const banked = miner.bankedCredits;
  const bankedParts = miner.bankedParts.length;
  const offline = balance === null;
  const rowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginTop: 6,
  };
  return (
    <section
      aria-label={stall.name}
      style={{
        position: "absolute",
        bottom: 28,
        left: "50%",
        transform: "translateX(-50%)",
        width: 320,
        background: "rgba(17, 21, 31, 0.95)",
        border: `1px solid ${stall.color}`,
        borderRadius: 10,
        padding: 14,
        zIndex: 10,
      }}
    >
      <p style={{ margin: 0, fontWeight: 700, color: stall.color }}>
        {stall.name}
      </p>
      <p style={{ margin: "2px 0 0", fontSize: "0.75rem", opacity: 0.6 }}>
        {stall.blurb}
        {balance !== null && ` | wallet: ${balance} cr`}
      </p>
      {offline && (
        <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "#f5c542" }}>
          the ledger is offline right now; browsing only
        </p>
      )}
      {stall.id === "assay" &&
        (banked > 0 || bankedParts > 0 ? (
          <>
            <p style={{ margin: "10px 0 0", fontSize: "0.9rem" }}>
              on the books: <strong>{banked} cr</strong>
              {bankedParts > 0 &&
                ` and ${bankedParts} part${bankedParts > 1 ? "s" : ""}`}
            </p>
            <button
              type="button"
              onClick={onCashOut}
              disabled={cashOutPending || offline}
              style={{ marginTop: 10 }}
            >
              {cashOutPending ? "Hauling to the vault..." : "Sell banked loot"}
            </button>
          </>
        ) : (
          <p style={{ margin: "10px 0 0", fontSize: "0.85rem", opacity: 0.7 }}>
            nothing banked yet; haul something up and it lands on the books.
          </p>
        ))}
      {stall.id === "supply" && (
        <div>
          {(
            [
              ["dynamite", "Dynamite"],
              ["rope", "Recall Rope"],
              ["ladder", "Ladder"],
              ["plank", "Plank"],
              ["beacon", "Warp Beacon"],
            ] as const
          ).map(([item, name]) => {
            const price = CONSUMABLE_PRICES[item];
            const affordable = balance !== null && balance >= price;
            return (
              <div key={item} style={rowStyle}>
                <span style={{ fontSize: "0.9rem" }}>
                  {name}{" "}
                  <span style={{ color: "#54e0c7" }}>
                    x{mine.consumables[item]}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onBuyConsumable(item)}
                  disabled={!affordable}
                >
                  {price} cr
                </button>
              </div>
            );
          })}
          <p style={{ margin: "8px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
            purchases pack straight into the current claim.
          </p>
        </div>
      )}
      {stall.id === "outfitter" && (
        <div>
          {GEAR_TRACKS.map((def) => {
            const level = gear[def.track];
            const maxed = level >= maxGearLevel(def.track);
            const price = maxed ? null : def.prices[level - 1];
            const affordable =
              price !== null && balance !== null && balance >= price;
            return (
              <div key={def.track} style={rowStyle}>
                <span style={{ fontSize: "0.9rem" }}>
                  {def.name} lv {level}
                  <span
                    style={{
                      display: "block",
                      fontSize: "0.7rem",
                      opacity: 0.55,
                    }}
                  >
                    {def.blurb}
                  </span>
                </span>
                {maxed ? (
                  <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>max</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onBuyGear(def.track)}
                    disabled={!affordable}
                  >
                    {price} cr
                  </button>
                )}
              </div>
            );
          })}
          <p style={{ margin: "8px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
            upgrades bought mid-dig apply on the next claim.
          </p>
        </div>
      )}
      {stall.id === "winch" && (
        <div>
          <p style={{ margin: "10px 0 0", fontSize: "0.9rem" }}>
            {gear.elevator > 0
              ? `rail reaches ${gear.elevator} deep`
              : "no rail yet; the shaft waits"}
          </p>
          <div style={rowStyle}>
            <span style={{ fontSize: "0.9rem" }}>
              extend rail {ELEVATOR_SEGMENT_ROWS} rows
              <span
                style={{ display: "block", fontSize: "0.7rem", opacity: 0.55 }}
              >
                free rides, surface to rail end
              </span>
            </span>
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
            >
              {elevatorSegmentPrice(gear.elevator / ELEVATOR_SEGMENT_ROWS + 1)}{" "}
              cr
            </button>
          </div>
          <button
            type="button"
            onClick={() => onRide("ride-down")}
            disabled={mine.gear.elevator <= 0}
            style={{ marginTop: 10 }}
          >
            {mine.gear.elevator > 0
              ? `Ride down to ${mine.gear.elevator}`
              : "Ride down (no rail)"}
          </button>
        </div>
      )}
      {stall.id === "warp" && (
        <div>
          <p style={{ margin: "10px 0 0", fontSize: "0.9rem" }}>
            {(() => {
              const beacon = findBeacon(mine);
              return beacon
                ? `beacon planted at ${beacon.row} deep`
                : "no beacon planted; kits at the depot";
            })()}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: "0.75rem", opacity: 0.6 }}>
            warpcoil range {warpRange(mine.gear)} rows (upgrade at the
            Outfitter)
          </p>
          <button
            type="button"
            onClick={() => onRide("warp-down")}
            disabled={(() => {
              const beacon = findBeacon(mine);
              return !beacon || beacon.row > warpRange(mine.gear);
            })()}
            style={{ marginTop: 10 }}
          >
            Warp to beacon
          </button>
        </div>
      )}
      {shopNote && (
        <p style={{ margin: "10px 0 0", fontSize: "0.8rem", color: "#54e0c7" }}>
          {shopNote}
        </p>
      )}
    </section>
  );
}

export function MinePanel() {
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
  // Touch players never see keyboard copy (matches the renderer's
  // coarse-pointer heuristic). False during SSR; set before paint.
  const [coarsePointer, setCoarsePointer] = useState(false);
  const armedRef = useRef(false);
  const setDynamiteArmed = (value: boolean | ((prev: boolean) => boolean)) => {
    armedRef.current =
      typeof value === "function" ? value(armedRef.current) : value;
    setDynamiteArmedState(armedRef.current);
  };
  void tick;

  useEffect(() => {
    // The world first (it seeds the claim), then gear (which rebuilds
    // the trip over that world when levels differ).
    void loadWorld().then(() => loadGear());
  }, [loadWorld, loadGear]);

  useEffect(() => {
    setCoarsePointer(window.matchMedia?.("(pointer: coarse)").matches ?? false);
  }, []);

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
  // The village (REQ-021): standing on a stall's column opens its menu.
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
                    ? "Beacon out of warpcoil range. Upgrade at the Outfitter."
                    : lastResult.reason === "no-rope"
                      ? "No rope."
                      : lastResult.reason === "surface"
                        ? undefined
                        : lastResult.reason === "blocked"
                          ? "No way through."
                          : "Edge of the claim."
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
                  ? "Sell at the Assay Office (gold sign)."
                  : undefined;
  const cashNote =
    cashOut.state === "done"
      ? `Vaulted ${cashOut.credits} cr${cashOut.milestoneBonus > 0 ? ` +${cashOut.milestoneBonus} depth bonus` : ""}${cashOut.parts.length > 0 ? ` +${cashOut.parts.length} parts` : ""}. The claim stands.`
      : cashOut.state === "unavailable"
        ? "Vault unreachable; loot is safe, try again."
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
      {stall && (
        <StallMenu
          stall={stall}
          mine={mine}
          gear={gear}
          balance={balance}
          shopNote={shopNote}
          cashOutPending={cashOut.state === "pending"}
          onCashOut={() => void submitCashOut()}
          onBuyConsumable={(item) => void buyConsumable(item)}
          onBuyGear={(track) => void buyGearUpgrade(track)}
          onBuyElevator={() => void buyElevator()}
          onRide={(dir) => move(dir)}
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
              &#128176; {carryValue} cr
              {miner.carriedParts.length > 0 &&
                ` +${miner.carriedParts.length}p`}
            </span>
          )}
          {(miner.bankedCredits > 0 || miner.bankedParts.length > 0) && (
            <span style={{ ...chipStyle, color: "#f5c542" }}>
              &#127974; {miner.bankedCredits} cr
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
              &#11014; {climbCost.toFixed(1)}&#9889; {laddersNeeded}&#129699;
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
          &#129699; {mine.consumables.ladder}
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
          miner.row <= mine.gear.elevator && (
            <button
              type="button"
              aria-label="Ride elevator up"
              onClick={() => move("ride-up")}
              style={iconButtonStyle}
            >
              &#128727;
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
