"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  CONSUMABLE_PRICES,
  cargoCapacity,
  carriedCount,
  carriedValue,
  type Direction,
  GEAR_TRACKS,
  MINE_WIDTH,
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
} from "@/sim/mine";
import { PART_CATALOG } from "@/sim/parts";
import { useMineStore } from "@/state/mine-store";
import { type StallDef, stallAt } from "./mine-stalls";

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

const panelStyle: React.CSSProperties = {
  background: "rgba(17, 21, 31, 0.92)",
  border: "1px solid #26304a",
  borderRadius: 10,
  padding: 14,
};

function carriedSummary(carried: Partial<Record<OreId, number>>): string {
  const chunks: string[] = [];
  for (const [id, count] of Object.entries(carried)) {
    if (count)
      chunks.push(`${count} ${oreDef(id as OreId).name.toLowerCase()}`);
  }
  return chunks.join(", ");
}

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
  const hi = Math.min(mine.rows.length - 1, at.row + 6);
  for (let r = lo; r <= hi; r++) {
    for (let c = 0; c < MINE_WIDTH; c++) {
      const cell = mine.rows[r][c];
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
              {wreck.crushed ? "Crushed by a boulder" : "The lamp died"}
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
}: {
  stall: StallDef;
  mine: MineState;
  gear: MineGear;
  balance: number | null;
  shopNote: string | null;
  cashOutPending: boolean;
  onCashOut: () => void;
  onBuyConsumable: (item: "dynamite" | "rope" | "ladder" | "plank") => void;
  onBuyGear: (track: keyof MineGear) => void;
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
  const balance = useMineStore((s) => s.balance);
  const shopNote = useMineStore((s) => s.shopNote);
  const buyConsumable = useMineStore((s) => s.buyConsumable);
  const buyGearUpgrade = useMineStore((s) => s.buyGearUpgrade);
  const [dynamiteArmed, setDynamiteArmedState] = useState(false);
  const armedRef = useRef(false);
  const setDynamiteArmed = (value: boolean | ((prev: boolean) => boolean)) => {
    armedRef.current =
      typeof value === "function" ? value(armedRef.current) : value;
    setDynamiteArmedState(armedRef.current);
  };
  void tick;

  useEffect(() => {
    void loadGear();
  }, [loadGear]);

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
  const carrySummary = carriedSummary(miner.carried);
  const climbCost = returnEnergyCost(miner);
  // The climb estimate assumes a cleared shaft; warn with a margin so a
  // detour or two does not turn the warning into a lie (REQ-017).
  const lampLow = miner.row > 0 && miner.energy < climbCost * 1.25 + 2;
  // Ladder budget for the same straight-home climb (REQ-020).
  const laddersNeeded = returnLadderNeed(mine);
  const ladderShort = miner.row > 0 && laddersNeeded > mine.consumables.ladder;
  // The village (REQ-021): standing on a stall's column opens its menu.
  const stall = miner.row === 0 ? stallAt(miner.col) : null;

  const statusLine =
    lastResult && !lastResult.ok
      ? lastResult.reason === "rock"
        ? "Hard rock. A better pickaxe from the Shop would cut it (or dynamite)."
        : lastResult.reason === "hold-full"
          ? "The hold is full. Bank it on the surface (or upgrade the cargo hold)."
          : lastResult.reason === "no-dynamite"
            ? "No dynamite left. The Shop sells it."
            : lastResult.reason === "no-ladder"
              ? "Out of ladders; the wall is sheer. Buy ladders at the Shop, or recall before the lamp dies."
              : lastResult.reason === "no-plank"
                ? "That's a drop. Out of planks to bridge it; buy more at the depot or find another way around."
                : lastResult.reason === "no-rope"
                  ? "No recall rope. The Shop sells it."
                  : lastResult.reason === "surface"
                    ? "Already on the surface."
                    : lastResult.reason === "blocked"
                      ? "No way through there."
                      : "Edge of the claim."
      : lastResult?.ok && lastResult.crushed
        ? "A boulder came down on you. The crew dug you out; the cargo stayed under the rock."
        : lastResult?.ok && lastResult.collapsed
          ? "Lamp died down there. The crew hauled you up; the cargo stayed below."
          : lastResult?.ok && lastResult.recalled
            ? "The rope yanked you home; the carry is banked."
            : lastResult?.ok && (lastResult.vented ?? 0) > 0
              ? `Gas vented! The lamp burned ${(lastResult.vented ?? 0) * 8} energy.`
              : miner.row === 0
                ? "On the surface. Loot banks automatically here; going dark below means losing the carry."
                : undefined;

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
        />
      )}

      <aside
        style={{
          position: "absolute",
          top: 70,
          left: 20,
          width: 250,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <section style={panelStyle} aria-label="Mine status">
          <p style={{ margin: 0, fontSize: "0.9rem" }}>
            depth <strong>{miner.row}</strong> ({stratum.name}), energy{" "}
            <strong style={lampLow ? { color: "#ff6b6b" } : undefined}>
              {miner.energy.toFixed(1)}
            </strong>
            /{maxEnergy(gear)}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: "0.75rem", opacity: 0.6 }}>
            pickaxe {gear.pickaxe}, lamp {gear.lamp}, hold {carriedCount(miner)}
            /{cargoCapacity(gear)}, lantern {gear.lantern}
          </p>
          {miner.row > 0 && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: "0.8rem",
                color: lampLow || ladderShort ? "#ff6b6b" : "#8b93a7",
              }}
            >
              climb home needs ~{climbCost.toFixed(1)} energy and{" "}
              {laddersNeeded} ladder{laddersNeeded === 1 ? "" : "s"}
              {lampLow && ". The lamp is running low; bank it or lose it."}
              {ladderShort &&
                ". Not enough ladders to climb home; buy more or keep a rope."}
            </p>
          )}
          <p style={{ margin: "6px 0 0", fontSize: "0.85rem", opacity: 0.85 }}>
            carrying{" "}
            {carrySummary.length > 0 || miner.carriedParts.length > 0 ? (
              <>
                {carrySummary.length > 0 ? carrySummary : null}
                {miner.carriedParts.length > 0 &&
                  `${carrySummary.length > 0 ? ", " : ""}${miner.carriedParts.length} part${miner.carriedParts.length > 1 ? "s" : ""}`}{" "}
                worth <strong>{carryValue} cr</strong>
              </>
            ) : (
              "nothing"
            )}
          </p>
          <p style={{ margin: "6px 0 0", fontSize: "0.85rem", opacity: 0.85 }}>
            banked {miner.bankedCredits} cr, {miner.bankedParts.length} parts
          </p>
          {(miner.bankedCredits > 0 || miner.bankedParts.length > 0) && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: "0.8rem",
                color: "#f5c542",
              }}
            >
              sell it at the Assay Office on the surface (the gold-sign building
              to the left).
            </p>
          )}
          {cashOut.state === "done" && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: "0.8rem",
                color: "#54e0c7",
              }}
            >
              vaulted {cashOut.credits} cr
              {cashOut.milestoneBonus > 0 &&
                ` + ${cashOut.milestoneBonus} cr depth bonus`}
              {cashOut.parts.length > 0 && ` and ${cashOut.parts.length} parts`}
              ; balance {cashOut.balance}. Fresh claim opened.
            </p>
          )}
          {cashOut.state === "unavailable" && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: "0.8rem",
                color: "#f5c542",
              }}
            >
              the vault is unreachable right now; your loot is safe, try again
            </p>
          )}
          {cashOut.state === "error" && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: "0.8rem",
                color: "#ff6b6b",
              }}
            >
              {cashOut.message}
            </p>
          )}
          {miner.collapses > 0 && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: "0.8rem",
                color: "#ff6b6b",
              }}
            >
              collapses: {miner.collapses}
            </p>
          )}
          {statusLine && (
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "0.8rem",
                color: "#f5c542",
              }}
            >
              {statusLine}
            </p>
          )}
        </section>

        <section style={panelStyle} aria-label="Dig controls">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 6,
            }}
          >
            <span />
            <button type="button" onClick={() => act("up")}>
              Up
            </button>
            <span />
            <button type="button" onClick={() => act("left")}>
              Left
            </button>
            <button type="button" onClick={() => act("down")}>
              Down
            </button>
            <button type="button" onClick={() => act("right")}>
              Right
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setDynamiteArmed((armed) => !armed)}
              disabled={mine.consumables.dynamite <= 0 && !dynamiteArmed}
              aria-pressed={dynamiteArmed}
              style={
                dynamiteArmed
                  ? { background: "#7a2c2c", color: "#ffd9d9" }
                  : undefined
              }
            >
              {dynamiteArmed
                ? "Armed! Pick a direction"
                : `Dynamite (${mine.consumables.dynamite})`}
            </button>
            <button
              type="button"
              onClick={() => {
                setDynamiteArmed(false);
                move("recall");
              }}
              disabled={mine.consumables.rope <= 0 || miner.row === 0}
            >
              Recall ({mine.consumables.rope})
            </button>
            <span
              style={{
                alignSelf: "center",
                fontSize: "0.85rem",
                color: ladderShort ? "#ff6b6b" : "#8b93a7",
              }}
            >
              Ladders ({mine.consumables.ladder}) | Planks (
              {mine.consumables.plank})
            </span>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: "0.75rem", opacity: 0.6 }}>
            arrows or WASD work too. Climbing plants a ladder per cell (8 free
            per trip); stepping over a drop plants a plank (4 free). Placed ones
            stay usable. Richer ores run deeper; watch the lamp, mind the
            wobbling boulders, and bank on the surface.
          </p>
        </section>
      </aside>
    </div>
  );
}
