"use client";

import { useCallback, useEffect, useState } from "react";

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

export function ShopPanel() {
  const [shop, setShop] = useState<ShopState>({ state: "loading" });

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

  return (
    <section style={panelStyle} aria-label="Part shop">
      <p style={{ margin: "0 0 12px", fontSize: "0.95rem" }}>
        balance: <strong>{data.emeralds}</strong> emeralds
        {notice && (
          <span style={{ marginLeft: 10, opacity: 0.75, fontSize: "0.85rem" }}>
            {notice}
          </span>
        )}
      </p>
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
              style={{
                background:
                  data.emeralds >= part.priceEmeralds ? "#26304a" : "#161b28",
                color:
                  data.emeralds >= part.priceEmeralds ? "#e6e8ee" : "#5a6378",
                border: "1px solid #344061",
                borderRadius: 6,
                padding: "4px 12px",
                cursor:
                  data.emeralds >= part.priceEmeralds
                    ? "pointer"
                    : "not-allowed",
              }}
            >
              {part.priceEmeralds} em
            </button>
          </li>
        ))}
      </ul>
      <p style={{ margin: "12px 0 0", fontSize: "0.75rem", opacity: 0.6 }}>
        emeralds come from the mine. Cash out at the surface, then spend here.
      </p>
    </section>
  );
}
