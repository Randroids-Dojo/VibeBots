"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  carriedValue,
  type Direction,
  type OreId,
  oreDef,
  returnEnergyCost,
  stratumAt,
} from "@/sim/mine";
import { useMineStore } from "@/state/mine-store";

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

export function MinePanel() {
  const tick = useMineStore((s) => s.tick);
  const mine = useMineStore((s) => s.mine);
  const lastResult = useMineStore((s) => s.lastResult);
  const move = useMineStore((s) => s.move);
  const cashOut = useMineStore((s) => s.cashOut);
  const submitCashOut = useMineStore((s) => s.submitCashOut);
  void tick;

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
      useMineStore.getState().move(dir);
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

  const statusLine =
    lastResult && !lastResult.ok
      ? lastResult.reason === "blocked"
        ? "Rock. Your pickaxe is not strong enough."
        : "Edge of the claim."
      : lastResult?.ok && lastResult.collapsed
        ? "Lamp died down there. The crew hauled you up; the cargo stayed below."
        : miner.row === 0
          ? "On the surface. Loot banks automatically here; going dark below means losing the carry."
          : undefined;

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh" }}>
      <MineCanvas />
      <StratumBanner row={miner.row} />

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
          </p>
          {miner.row > 0 && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: "0.8rem",
                color: lampLow ? "#ff6b6b" : "#8b93a7",
              }}
            >
              climb home needs ~{climbCost.toFixed(1)} energy
              {lampLow && ". The lamp is running low; bank it or lose it."}
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
            <button
              type="button"
              onClick={() => void submitCashOut()}
              disabled={cashOut.state === "pending"}
              style={{ marginTop: 8 }}
            >
              {cashOut.state === "pending"
                ? "Hauling to the vault..."
                : "Cash out banked loot"}
            </button>
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
            <button type="button" onClick={() => move("up")}>
              Up
            </button>
            <span />
            <button type="button" onClick={() => move("left")}>
              Left
            </button>
            <button type="button" onClick={() => move("down")}>
              Down
            </button>
            <button type="button" onClick={() => move("right")}>
              Right
            </button>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: "0.75rem", opacity: 0.6 }}>
            arrows or WASD work too. Richer ores run deeper; watch the lamp and
            bank on the surface.
          </p>
        </section>
      </aside>
    </div>
  );
}
