"use client";

import { useCallback, useEffect, useState } from "react";

interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  priceEmeralds: number;
}

interface ShopData {
  emeralds: number;
  inventory: Array<{ part_id: string; count: number }>;
  catalog: CatalogEntry[];
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
};

const buyButtonStyle = (affordable: boolean): React.CSSProperties => ({
  background: affordable ? "#26304a" : "#161b28",
  color: affordable ? "#e6e8ee" : "#5a6378",
  border: "1px solid #344061",
  borderRadius: 6,
  padding: "4px 12px",
  cursor: affordable ? "pointer" : "not-allowed",
});

/**
 * Buying robot parts lives inside the Workshop now (the standalone Part
 * Shop page is gone). Vibes come from the mine; spend them here to stock
 * parts to snap onto a bot. Gear and supplies are bought in-world at the
 * mine stalls, so this panel is parts only.
 */
// Remember the last loaded shop across mounts. Re-opening the Shop tab then
// shows the previous catalog instantly (revalidated in the background) instead
// of dropping back to a spinner, so switching to an already-loaded tab does
// not blink.
let shopDataCache: ShopData | null = null;
let shopUnavailableCache = false;

// Warm the cache once from the workshop mount, so the first time the player
// opens the Shop tab it renders the catalog immediately instead of dropping
// the sheet to a spinner and springing back (the tab-switch blink). No-op once
// a result is cached.
export async function prefetchShop() {
  if (shopDataCache || shopUnavailableCache) return;
  try {
    const res = await fetch("/api/shop");
    if (res.status === 503) {
      shopUnavailableCache = true;
      return;
    }
    if (!res.ok) return;
    shopDataCache = (await res.json()) as ShopData;
    shopUnavailableCache = false;
  } catch {
    shopUnavailableCache = true;
  }
}

export function PartsShop() {
  const [shop, setShop] = useState<ShopState>(() =>
    shopDataCache
      ? { state: "ready", data: shopDataCache, notice: null }
      : shopUnavailableCache
        ? { state: "unavailable" }
        : { state: "loading" },
  );

  const refresh = useCallback(async (notice: string | null = null) => {
    try {
      const res = await fetch("/api/shop");
      if (res.status === 503) {
        shopUnavailableCache = true;
        setShop({ state: "unavailable" });
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as ShopData;
      shopDataCache = data;
      shopUnavailableCache = false;
      setShop({ state: "ready", data, notice });
    } catch {
      shopUnavailableCache = true;
      setShop({ state: "unavailable" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (shop.state === "loading") {
    return (
      <div
        className="workshop-sheet-loading"
        role="status"
        aria-label="Loading the parts shop"
      >
        <span className="workshop-spinner" aria-hidden="true" />
      </div>
    );
  }
  if (shop.state === "unavailable") {
    return (
      <aside style={panelStyle} aria-label="Parts shop">
        <p style={{ margin: 0, opacity: 0.7, fontSize: "0.85rem" }}>
          Buying parts needs storage; it is not configured in this environment.
        </p>
      </aside>
    );
  }

  const { data, notice } = shop;
  const counts = new Map(data.inventory.map((row) => [row.part_id, row.count]));

  const refreshAndBroadcast = async (noticeText: string | null = null) => {
    await refresh(noticeText);
    window.dispatchEvent(new CustomEvent("vibebots:parts-changed"));
  };

  const buy = async (partId: string) => {
    const res = await fetch("/api/shop/buy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partId }),
    });
    if (res.ok) {
      void refreshAndBroadcast("bought!");
    } else {
      const body = await res.json().catch(() => ({}));
      void refreshAndBroadcast(
        typeof body.error === "string" ? body.error : "purchase failed",
      );
    }
  };

  return (
    <aside style={panelStyle} aria-label="Parts shop">
      <p style={{ margin: "0 0 12px", fontSize: "0.95rem" }}>
        <span style={{ color: "#f5c542", fontWeight: 700 }}>
          {data.emeralds} vibes
        </span>
        {notice && (
          <span style={{ marginLeft: 10, opacity: 0.75, fontSize: "0.85rem" }}>
            {notice}
          </span>
        )}
      </p>

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
        Vibes come from the mine. Cash out at the surface, then spend here.
      </p>
    </aside>
  );
}
