"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import type { Direction } from "@/sim/mine";
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
  const statusLine =
    lastResult && !lastResult.ok
      ? lastResult.reason === "blocked"
        ? "Rock. Your pickaxe is not strong enough."
        : "Edge of the claim."
      : lastResult?.ok && lastResult.collapsed
        ? "Lamp died down there. The crew hauled you up; the cargo stayed below."
        : miner.row === 0
          ? "On the surface. Loot banks automatically here."
          : undefined;

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh" }}>
      <MineCanvas />

      <aside
        style={{
          position: "absolute",
          top: 70,
          left: 20,
          width: 240,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <section style={panelStyle} aria-label="Mine status">
          <p style={{ margin: 0, fontSize: "0.9rem" }}>
            depth <strong>{miner.row}</strong>, energy{" "}
            <strong>{miner.energy.toFixed(1)}</strong>
          </p>
          <p style={{ margin: "6px 0 0", fontSize: "0.85rem", opacity: 0.85 }}>
            carrying {miner.carriedEmeralds} emeralds
            {miner.carriedParts.length > 0 &&
              `, ${miner.carriedParts.length} parts`}
          </p>
          <p style={{ margin: "6px 0 0", fontSize: "0.85rem", opacity: 0.85 }}>
            banked {miner.bankedEmeralds} emeralds, {miner.bankedParts.length}{" "}
            parts
          </p>
          {(miner.bankedEmeralds > 0 || miner.bankedParts.length > 0) &&
            cashOut.state !== "unavailable" && (
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
              vaulted {cashOut.emeralds} emeralds
              {cashOut.parts.length > 0 && ` and ${cashOut.parts.length} parts`}
              ; balance {cashOut.balance}. Fresh claim opened.
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
            arrows or WASD work too. Dig deep, watch the lamp, bank on the
            surface.
          </p>
        </section>
      </aside>
    </div>
  );
}
