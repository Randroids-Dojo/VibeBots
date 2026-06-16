"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CONSUMABLE_PRICES,
  GEAR_TRACKS,
  type MineConsumables,
  type MineGear,
  maxGearLevel,
} from "@/sim/mine";

interface ShopCatalogEntry {
  id: string;
  name: string;
  category: string;
  priceEmeralds: number;
}

interface ShopData {
  emeralds: number;
  inventory: Array<{ part_id: string; count: number }>;
  catalog: ShopCatalogEntry[];
}

type ShopState =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "ready"; data: ShopData; notice: string | null };

const panelStyle: React.CSSProperties = {
  background: "rgba(17, 21, 31, 0.92)",
  border: "1px solid #26304a",
  borderRadius: 10,
  padding: 16,
  maxWidth: 420,
};

const buyButtonStyle = (affordable: boolean): React.CSSProperties => ({
  background: affordable ? "#26304a" : "#161b28",
  color: affordable ? "#e6e8ee" : "#5a6378",
  border: "1px solid #344061",
  borderRadius: 6,
  padding: "4px 12px",
  cursor: affordable ? "pointer" : "not-allowed",
});

export function ShopPanel() {
  const [shop, setShop] = useState<ShopState>({ state: "loading" });
  const [gear, setGear] = useState<MineGear | null>(null);
  const [consumables, setConsumables] = useState<MineConsumables | null>(null);

  const refresh = useCallback(async (notice: string | null = null) => {
    try {
      const res = await fetch("/api/shop");
      if (res.status === 503) {
        setShop({ state: "unavailable" });
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setShop({ state: "ready", data, notice });
      const gearRes = await fetch("/api/gear");
      if (gearRes.ok) {
        const gearBody = await gearRes.json();
        setGear(gearBody.gear);
        setConsumables(gearBody.consumables ?? null);
      }
    } catch {
      setShop({ state: "unavailable" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (shop.state === "loading") {
    return <p style={{ padding: 24 }}>opening the shop...</p>;
  }
  if (shop.state === "unavailable") {
    return (
      <p style={{ padding: 24, opacity: 0.7 }}>
        The shop needs storage; it is not configured in this environment.
      </p>
    );
  }

  const { data, notice } = shop;
  const counts = new Map(data.inventory.map((row) => [row.part_id, row.count]));

  const buy = async (partId: string) => {
    const res = await fetch("/api/shop/buy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partId }),
    });
    if (res.ok) {
      void refresh("bought!");
    } else {
      const body = await res.json().catch(() => ({}));
      void refresh(
        typeof body.error === "string" ? body.error : "purchase failed",
      );
    }
  };

  const buyConsumable = async (
    item: "dynamite" | "rope" | "ladder" | "plank",
  ) => {
    const res = await fetch("/api/consumables/buy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item }),
    });
    if (res.ok) {
      const body = await res.json();
      void refresh(`${item} stocked (now ${body.count})`);
    } else {
      const body = await res.json().catch(() => ({}));
      void refresh(
        typeof body.error === "string" ? body.error : "purchase failed",
      );
    }
  };

  const upgrade = async (track: string) => {
    const res = await fetch("/api/gear/upgrade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track }),
    });
    if (res.ok) {
      const body = await res.json();
      void refresh(`${track} upgraded to level ${body.level}!`);
    } else {
      const body = await res.json().catch(() => ({}));
      void refresh(
        typeof body.error === "string" ? body.error : "upgrade failed",
      );
    }
  };

  return (
    <section style={panelStyle} aria-label="Part shop">
      <p style={{ margin: "0 0 12px", fontSize: "0.95rem" }}>
        balance: <strong>{data.emeralds}</strong> vibes
        {notice && (
          <span style={{ marginLeft: 10, opacity: 0.75, fontSize: "0.85rem" }}>
            {notice}
          </span>
        )}
      </p>

      <h3 style={{ margin: "0 0 8px", fontSize: "0.9rem", opacity: 0.8 }}>
        Mining gear
      </h3>
      <ul style={{ margin: "0 0 16px", padding: 0, listStyle: "none" }}>
        {GEAR_TRACKS.map((trackDef) => {
          const level = gear?.[trackDef.track] ?? 1;
          const atMax = level >= maxGearLevel(trackDef.track);
          const price = atMax ? null : trackDef.prices[level - 1];
          const affordable = price !== null && data.emeralds >= price;
          return (
            <li
              key={trackDef.track}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: "0.9rem" }}>
                {trackDef.name}{" "}
                <span style={{ color: "#54e0c7" }}>lv {level}</span>
                <span style={{ opacity: 0.5 }}> ({trackDef.blurb})</span>
              </span>
              {atMax ? (
                <span style={{ opacity: 0.5, fontSize: "0.85rem" }}>max</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void upgrade(trackDef.track)}
                  disabled={!affordable}
                  style={buyButtonStyle(affordable)}
                >
                  {price} vibes
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <h3 style={{ margin: "0 0 8px", fontSize: "0.9rem", opacity: 0.8 }}>
        Supplies
      </h3>
      <ul style={{ margin: "0 0 16px", padding: 0, listStyle: "none" }}>
        {(
          [
            ["dynamite", "Dynamite", "blasts a plus, any rock"],
            ["rope", "Recall Rope", "bank the carry from anywhere"],
            ["ladder", "Ladder", "climbs one cell; free refill on death"],
            ["plank", "Plank", "bridges one gap; free refill on death"],
          ] as const
        ).map(([item, name, blurb]) => {
          const price = CONSUMABLE_PRICES[item];
          const affordable = data.emeralds >= price;
          return (
            <li
              key={item}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: "0.9rem" }}>
                {name}{" "}
                <span style={{ color: "#54e0c7" }}>
                  x{consumables?.[item] ?? 0}
                </span>
                <span style={{ opacity: 0.5 }}> ({blurb})</span>
              </span>
              <button
                type="button"
                onClick={() => void buyConsumable(item)}
                disabled={!affordable}
                style={buyButtonStyle(affordable)}
              >
                {price} vibes
              </button>
            </li>
          );
        })}
      </ul>

      <h3 style={{ margin: "0 0 8px", fontSize: "0.9rem", opacity: 0.8 }}>
        Robot parts
      </h3>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {data.catalog.map((part) => (
          <li
            key={part.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: "0.9rem" }}>
              {part.name}
              <span style={{ opacity: 0.5 }}> ({part.category})</span>
              {counts.get(part.id) ? (
                <span style={{ color: "#54e0c7" }}>
                  {" "}
                  x{counts.get(part.id)}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => void buy(part.id)}
              disabled={data.emeralds < part.priceEmeralds}
              style={buyButtonStyle(data.emeralds >= part.priceEmeralds)}
            >
              {part.priceEmeralds} vibes
            </button>
          </li>
        ))}
      </ul>
      <p style={{ margin: "12px 0 0", fontSize: "0.75rem", opacity: 0.6 }}>
        Vibe-Brainiums come from the mine. Cash out at the surface, then spend
        here.
      </p>
    </section>
  );
}
