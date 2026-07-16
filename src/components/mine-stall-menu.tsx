"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useRef,
  useState,
} from "react";
import {
  BASE_PART_CATALOG,
  BASE_PART_IDS,
  type BasePartId,
  basePartMinimumLevel,
  basePartOwnedCount,
  basePartOwnedLimit,
} from "@/sim/bunker";
import {
  BEACON_LABEL_MAX_LENGTH,
  CONSUMABLE_PRICES,
  elevatorColumn,
  elevatorRailPrice,
  elevatorSpeedRows,
  findBeacons,
  findPortalBeacons,
  GEAR_TRACKS,
  gearUpgradeRequirements,
  MINE_BOTTOM_ROW,
  type MineAction,
  type MineGear,
  type MineGearTrack,
  type MineState,
  maxGearLevel,
  normalizeBeaconLabel,
  portalWarpAction,
  recallRopeRange,
  renameBeaconAction,
  warpRange,
} from "@/sim/mine";
import { useBunkerStore } from "@/state/bunker-store";
import {
  HoldToBuyButton,
  SheetRow,
  sheetButtonStyle,
  triggerShopHaptic,
} from "./mine-sheet-controls";
import type { StallDef } from "./mine-stalls";

/** Downward drag distance (px) past which releasing closes the sheet. */
const SWIPE_DISMISS_PX = 70;
const SHEET_DRAG_START_PX = 8;

export const STALL_ICONS: Record<StallDef["id"], string> = {
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
  battery: "\u{1F50B}",
  cargo: "\u{1F392}",
  lantern: "\u{1F3EE}",
  warpcoil: "\u{1F300}",
  blast: "\u{1F4A5}",
  elevatorSpeed: "\u{1F6D7}",
  fall: "\u{1FA82}",
  recall: "\u{1FAA2}",
};

const BASE_PART_ICONS: Record<BasePartId, string> = {
  "wall-panel": "\u{1F9F1}",
  "floor-panel": "\u{25A3}",
  "roof-panel": "\u{2302}",
  "door-panel": "\u{1F6AA}",
  "basic-turret": "\u{1F6E1}\u{FE0F}",
  "floor-spikes": "\u{1F53A}",
};

function HardwareStorePanel({
  balance,
  buyQuantity,
  setBuyQuantity,
  onBuyBasePart,
}: {
  balance: number | null;
  buyQuantity: number;
  setBuyQuantity: (quantity: number) => void;
  onBuyBasePart: (partId: BasePartId, quantity: number) => void;
}) {
  const inventory = useBunkerStore((s) => s.inventory);
  const bunker = useBunkerStore((s) => s.bunker);
  const player = useBunkerStore((s) => s.player);
  const bunkerStatus = useBunkerStore((s) => s.status);
  const playerLevel = player?.overallLevel ?? 1;

  return (
    <div>
      <QuantityPicker value={buyQuantity} onChange={setBuyQuantity} />
      {BASE_PART_IDS.map((partId) => {
        const def = BASE_PART_CATALOG[partId];
        const totalPrice = def.price * buyQuantity;
        const affordable = balance !== null && balance >= totalPrice;
        const minLevel = basePartMinimumLevel(partId);
        const levelLocked = playerLevel < minLevel;
        const ownedCount = basePartOwnedCount(partId, bunker, inventory);
        const ownedLimit = basePartOwnedLimit(partId, playerLevel);
        const capped = ownedCount + buyQuantity > ownedLimit;
        const hasLimit = Number.isFinite(ownedLimit);
        const detail =
          partId === "basic-turret"
            ? `${def.blurb}. Level ${minLevel}. ${def.ammo ?? 0} shots per raid. Breaks after ${def.durability} Clanker hits.`
            : partId === "floor-spikes"
              ? `${def.blurb}. Breaks after ${def.durability} steps. Limit ${ownedLimit} at your level.`
              : def.blurb;
        const canBuy = affordable && !levelLocked && !capped;
        const buttonLabel = levelLocked
          ? `Requires level ${minLevel}`
          : capped
            ? `Limit ${ownedLimit}`
            : `Buy ${buyQuantity} for ${totalPrice} vibes`;
        return (
          <SheetRow
            key={partId}
            icon={BASE_PART_ICONS[partId]}
            name={def.name}
            sub={detail}
            badge={
              hasLimit
                ? `have ${ownedCount} / ${ownedLimit}`
                : `have ${inventory[partId] ?? 0}`
            }
            action={
              <button
                type="button"
                onClick={() => onBuyBasePart(partId, buyQuantity)}
                disabled={!canBuy}
                style={{ ...sheetButtonStyle(canBuy), minWidth: 124 }}
              >
                {buttonLabel}
              </button>
            }
          />
        );
      })}
      {bunkerStatus === "unavailable" && (
        <p
          style={{ margin: "10px 0 0", fontSize: "0.75rem", color: "#f5c542" }}
        >
          Bunker ledger offline. Base stock can be browsed, but purchases wait
          until storage is online.
        </p>
      )}
      {balance === null && (
        <p
          style={{ margin: "10px 0 0", fontSize: "0.75rem", color: "#f5c542" }}
        >
          Wallet ledger offline. The Hardware Store can show the catalog, but
          purchases wait until storage is online.
        </p>
      )}
    </div>
  );
}

function QuantityPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (quantity: number) => void;
}) {
  return (
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
        const active = value === quantity;
        return (
          <button
            key={quantity}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(quantity)}
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
  );
}

export type DepotItem = "dynamite" | "rope" | "ladder" | "plank" | "beacon";
const DEPOT_BUY_QUANTITIES = [1, 5, 10] as const;

/**
 * The shop sheet (REQ-021): standing at a stall slides a mobile bottom
 * sheet up over the lower screen, with thumb-sized rows and the wallet
 * in the header. Walking off the column closes it.
 */
export function StallMenu({
  stall,
  mine,
  gear,
  balance,
  playerLevel,
  deepestDepth,
  beaconLimit,
  shopNote,
  cashOutPending,
  elevatorPurchasePending,
  elevatorPlacementRequired,
  railResyncFailed,
  railRetryPending,
  onRetryRailResync,
  onBuyConsumable,
  onBuyBasePart,
  onBuyGear,
  onBuyElevator,
  onChooseElevatorShaft,
  onRide,
  onClose,
  sheetRef,
}: {
  stall: StallDef;
  mine: MineState;
  gear: MineGear;
  balance: number | null;
  playerLevel: number;
  deepestDepth: number;
  beaconLimit: number;
  shopNote: string | null;
  cashOutPending: boolean;
  elevatorPurchasePending: boolean;
  elevatorPlacementRequired: boolean;
  railResyncFailed: boolean;
  railRetryPending: boolean;
  onRetryRailResync: () => void;
  onBuyConsumable: (item: DepotItem, quantity: number) => void;
  onBuyBasePart: (partId: BasePartId, quantity: number) => void;
  onBuyGear: (track: MineGearTrack) => void;
  onBuyElevator: () => void;
  onChooseElevatorShaft: () => void;
  onRide: (action: MineAction) => void;
  onClose: () => void;
  sheetRef?: RefObject<HTMLElement | null>;
}) {
  const miner = mine.miner;
  const banked = miner.bankedCredits;
  const bankedParts = miner.bankedParts.length;
  const autoBanking = banked > 0 || bankedParts > 0;
  const upgradeFunds = balance === null ? null : balance + banked;
  const elevatorMaxed = gear.elevator >= MINE_BOTTOM_ROW - 1;
  const choosingExistingShaft = elevatorPlacementRequired && gear.elevator > 0;
  const offline = balance === null;
  const beacons = findBeacons(mine);
  const portals = findPortalBeacons(mine).filter((portal) => portal.active);
  const warpDestinationCount = beacons.length + portals.length;
  const beaconTotal = mine.consumables.beacon + beacons.length;
  const beaconRoom = Math.max(0, beaconLimit - beaconTotal);
  // Swipe-to-dismiss: the sheet follows a downward pull from anywhere inside
  // the panel. A short tug snaps back.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [buyQuantity, setBuyQuantity] = useState(1);
  const [beaconDrafts, setBeaconDrafts] = useState<Record<string, string>>({});
  const draggingRef = useRef(false);
  const dragStart = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const dismiss = () => {
    setDragY(0);
    setDragging(false);
    draggingRef.current = false;
    dragStart.current = null;
    onClose();
  };
  const onSheetPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target instanceof HTMLElement) {
      const editable = e.target.closest(
        "input, textarea, select, [contenteditable='true']",
      );
      if (editable) return;
    }
    dragStart.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onSheetPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (
      dragStart.current === null ||
      e.pointerId !== dragStart.current.pointerId
    ) {
      return;
    }
    const dy = e.clientY - dragStart.current.y;
    const dx = Math.abs(e.clientX - dragStart.current.x);
    if (!draggingRef.current) {
      if (dy <= SHEET_DRAG_START_PX || dy <= dx) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      draggingRef.current = true;
      setDragging(true);
    }
    e.preventDefault();
    setDragY(dy > 0 ? dy : 0);
  };
  const onSheetPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (
      dragStart.current === null ||
      e.pointerId !== dragStart.current.pointerId
    ) {
      return;
    }
    const dy = e.clientY - dragStart.current.y;
    const wasDragging = draggingRef.current;
    dragStart.current = null;
    setDragging(false);
    draggingRef.current = false;
    if (!wasDragging) return;
    e.preventDefault();
    if (dy > SWIPE_DISMISS_PX) dismiss();
    else setDragY(0);
  };
  const onSheetPointerCancel = () => {
    dragStart.current = null;
    draggingRef.current = false;
    setDragging(false);
    setDragY(0);
  };
  return (
    <section
      ref={sheetRef}
      aria-label={stall.name}
      className="stall-sheet"
      onPointerDown={onSheetPointerDown}
      onPointerMove={onSheetPointerMove}
      onPointerUp={onSheetPointerUp}
      onPointerCancel={onSheetPointerCancel}
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
        touchAction: "none",
      }}
    >
      <div
        style={{
          margin: "-8px -18px 0",
          padding: "10px 18px 4px",
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
      {stall.id === "buyer" && (
        <HardwareStorePanel
          balance={balance}
          buyQuantity={buyQuantity}
          setBuyQuantity={setBuyQuantity}
          onBuyBasePart={onBuyBasePart}
        />
      )}
      {stall.id === "supply" && (
        <div>
          <QuantityPicker value={buyQuantity} onChange={setBuyQuantity} />
          {(
            [
              ["dynamite", "Dynamite", "fuels your selected blast tier"],
              ["rope", "Recall Rope", "bank within your rope range"],
              ["ladder", "Ladder", "climbs one cell, stays planted"],
              ["plank", "Plank", "bridges one gap, stays planted"],
              ["beacon", "Warp Beacon", "plants the warp anchor"],
            ] as const
          ).map(([item, name, blurb]) => {
            const price = CONSUMABLE_PRICES[item];
            const totalPrice = price * buyQuantity;
            const beaconAllowed =
              item !== "beacon" || buyQuantity <= beaconRoom;
            const affordable =
              balance !== null && balance >= totalPrice && beaconAllowed;
            const beaconBadge =
              item === "beacon"
                ? `${mine.consumables.beacon} packed, ${beacons.length} planted`
                : null;
            const actionLabel =
              item === "beacon" && !beaconAllowed
                ? `Limit ${beaconLimit} total`
                : `Buy ${buyQuantity} for ${totalPrice} vibes`;
            const rowSub =
              item === "beacon" && !beaconAllowed
                ? "At the cap. If a beacon is deployed, scrap it in scrap mode to free a slot."
                : blurb;
            return (
              <SheetRow
                key={item}
                icon={ITEM_ICONS[item]}
                name={name}
                sub={rowSub}
                badge={beaconBadge ?? `have ${mine.consumables[item]}`}
                action={
                  <button
                    type="button"
                    onClick={() => {
                      triggerShopHaptic("press");
                      onBuyConsumable(item, buyQuantity);
                    }}
                    disabled={!affordable}
                    style={{ ...sheetButtonStyle(affordable), minWidth: 124 }}
                  >
                    {actionLabel}
                  </button>
                }
              />
            );
          })}
        </div>
      )}
      {stall.id === "upgrades" && (
        <div>
          {GEAR_TRACKS.map((def) => {
            // blast is optional on gear (absent reads as level 1).
            const level = gear[def.track] ?? 1;
            const maxed = level >= maxGearLevel(def.track);
            const price = maxed ? null : def.prices[level - 1];
            const requirements = gearUpgradeRequirements(def.track, level);
            const levelLocked = playerLevel < requirements.playerLevel;
            const depthLocked = deepestDepth < requirements.maxDepth;
            const locked = levelLocked || depthLocked;
            const affordable =
              price !== null &&
              upgradeFunds !== null &&
              upgradeFunds >= price &&
              !cashOutPending &&
              !locked;
            const lockLabel = levelLocked
              ? `level ${requirements.playerLevel}`
              : depthLocked
                ? `depth ${requirements.maxDepth}`
                : null;
            return (
              <SheetRow
                key={def.track}
                icon={ITEM_ICONS[def.track] ?? "\u{2699}\u{FE0F}"}
                name={def.name}
                sub={lockLabel ? `${def.blurb}; needs ${lockLabel}` : def.blurb}
                badge={
                  def.track === "blast"
                    ? `tier ${level}`
                    : def.track === "recall"
                      ? `row ${recallRopeRange(gear)}`
                      : `lv ${level}`
                }
                action={
                  maxed ? (
                    <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>
                      max
                    </span>
                  ) : locked ? (
                    <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>
                      locked
                    </span>
                  ) : (
                    <HoldToBuyButton
                      label={`${autoBanking ? "Bank + " : ""}${price} vibes`}
                      disabled={!affordable}
                      onCommit={() => onBuyGear(def.track)}
                      ariaLabel={`Hold to buy ${def.name} for ${price} vibes`}
                    />
                  )
                }
              />
            );
          })}
          <p style={{ margin: "10px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
            Upgrades sell any hauled-up loot first, then apply immediately.
          </p>
        </div>
      )}
      {stall.id === "elevator" && (
        <div>
          <SheetRow
            icon={"\u{1F6D7}"}
            name={
              choosingExistingShaft
                ? `place your existing ${gear.elevator}-row shaft`
                : gear.elevator > 0
                  ? `rail at column ${elevatorColumn(gear)} reaches ${gear.elevator} deep`
                  : "choose your shaft column"
            }
            sub={
              choosingExistingShaft
                ? "one free location choice; bought depth stays"
                : elevatorMaxed
                  ? "rail reaches the mine bottom"
                  : gear.elevator > 0
                    ? "one premium row per purchase"
                    : `first rail costs ${elevatorRailPrice(0)} vibes`
            }
            action={
              <button
                type="button"
                aria-label={
                  elevatorPurchasePending
                    ? choosingExistingShaft
                      ? "Placing existing elevator shaft"
                      : "Buying one elevator rail"
                    : choosingExistingShaft
                      ? "Choose free elevator shaft location"
                      : elevatorMaxed
                        ? "Elevator rail is at maximum depth"
                        : gear.elevator > 0
                          ? `Buy one elevator rail for ${elevatorRailPrice(gear.elevator)} vibes`
                          : "Choose elevator shaft location"
                }
                onClick={
                  gear.elevator > 0 && !choosingExistingShaft
                    ? onBuyElevator
                    : onChooseElevatorShaft
                }
                disabled={
                  elevatorPurchasePending ||
                  railResyncFailed ||
                  (!choosingExistingShaft &&
                    (elevatorMaxed ||
                      upgradeFunds === null ||
                      upgradeFunds < elevatorRailPrice(gear.elevator)))
                }
                style={sheetButtonStyle(
                  !elevatorPurchasePending &&
                    !railResyncFailed &&
                    (choosingExistingShaft ||
                      (!elevatorMaxed &&
                        upgradeFunds !== null &&
                        upgradeFunds >= elevatorRailPrice(gear.elevator))),
                )}
              >
                {elevatorPurchasePending
                  ? choosingExistingShaft
                    ? "Placing..."
                    : "Buying..."
                  : choosingExistingShaft
                    ? "Choose spot"
                    : elevatorMaxed
                      ? "Max"
                      : gear.elevator > 0
                        ? `${autoBanking ? "Bank + " : ""}${elevatorRailPrice(gear.elevator)} vibes`
                        : "Choose spot"}
              </button>
            }
          />
          {railResyncFailed && (
            <div
              data-testid="rail-resync-recovery"
              role="alert"
              style={{
                margin: "8px 0 0",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(245, 158, 11, 0.5)",
                background: "rgba(245, 158, 11, 0.12)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <span style={{ fontSize: "0.72rem", lineHeight: 1.35 }}>
                Your rail moved on another device and the refresh failed. Retry
                to reload the latest rail before buying.
              </span>
              <button
                type="button"
                data-testid="rail-resync-retry"
                aria-label="Retry refreshing the rail"
                onClick={onRetryRailResync}
                disabled={railRetryPending}
                style={{
                  ...sheetButtonStyle(!railRetryPending),
                  alignSelf: "flex-start",
                }}
              >
                {railRetryPending ? "Refreshing..." : "Retry refresh"}
              </button>
            </div>
          )}
          <p style={{ margin: "6px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
            {choosingExistingShaft
              ? "Choose any surface column. The old shaft stays open as a tunnel."
              : "Buy the first rail at any surface column. That spot stays yours."}
          </p>
          <p style={{ margin: "6px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
            speed level {gear.elevatorSpeed ?? 1} moves{" "}
            {elevatorSpeedRows(gear)} rows per automatic step
          </p>
        </div>
      )}
      {stall.id === "warp" && (
        <div>
          <SheetRow
            icon={ITEM_ICONS.beacon}
            name={
              warpDestinationCount > 0
                ? `${warpDestinationCount} destination${warpDestinationCount > 1 ? "s" : ""} online`
                : "No planted beacons yet"
            }
            sub={
              warpDestinationCount > 0
                ? `Warpcoil range: ${warpRange(mine.gear)} rows for planted beacons. Biome portals are free.`
                : `Buy beacon kits at the Supply Depot. Warpcoil range: ${warpRange(mine.gear)} rows.`
            }
          />
          <div
            style={{
              display: "grid",
              gap: 8,
              marginTop: 12,
              maxHeight: 220,
              overflowY: "auto",
              paddingRight: 2,
            }}
          >
            {warpDestinationCount === 0 ? (
              <button
                type="button"
                disabled
                style={{
                  ...sheetButtonStyle(false),
                  width: "100%",
                  minHeight: 48,
                }}
              >
                Warp to beacon
              </button>
            ) : (
              <>
                {portals.map((portal) => (
                  <div
                    key={`portal:${portal.id}`}
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: 10,
                      border: `1px solid ${portal.color}`,
                      borderRadius: 12,
                      background: "rgba(17, 21, 31, 0.45)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <span style={{ fontWeight: 800 }}>{portal.name}</span>
                      <span style={{ opacity: 0.78, fontSize: "0.78rem" }}>
                        col {portal.col}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRide(portalWarpAction(portal.id))}
                      style={{
                        ...sheetButtonStyle(true),
                        width: "100%",
                        minHeight: 38,
                      }}
                    >
                      Portal
                    </button>
                  </div>
                ))}
                {beacons.map((beacon, index) => {
                  const draftKey = `${beacon.col},${beacon.row}`;
                  const fallbackName =
                    index === 0 ? "Newest beacon" : `Beacon ${index + 1}`;
                  const displayName = beacon.label ?? fallbackName;
                  const draft = beaconDrafts[draftKey] ?? beacon.label ?? "";
                  const cleanedDraft = normalizeBeaconLabel(draft);
                  const renameReady = cleanedDraft !== (beacon.label ?? "");
                  return (
                    <div
                      key={draftKey}
                      style={{
                        display: "grid",
                        gap: 8,
                        padding: 10,
                        border: "1px solid rgba(84, 224, 199, 0.18)",
                        borderRadius: 12,
                        background: "rgba(17, 21, 31, 0.45)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <span style={{ fontWeight: 800 }}>{displayName}</span>
                        <span style={{ opacity: 0.78, fontSize: "0.78rem" }}>
                          row {beacon.row}, col {beacon.col}
                          {beacon.inRange ? "" : " out of range"}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto auto",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        <input
                          aria-label={`Rename ${fallbackName}`}
                          maxLength={BEACON_LABEL_MAX_LENGTH}
                          value={draft}
                          placeholder={fallbackName}
                          onChange={(event) =>
                            setBeaconDrafts((current) => ({
                              ...current,
                              [draftKey]: event.target.value,
                            }))
                          }
                          style={{
                            width: "100%",
                            minWidth: 0,
                            height: 38,
                            borderRadius: 10,
                            border: "1px solid #2c3a5c",
                            background: "rgba(12, 15, 23, 0.86)",
                            color: "#e6e8ee",
                            padding: "0 10px",
                            fontWeight: 700,
                          }}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onRide(renameBeaconAction(beacon, cleanedDraft))
                          }
                          disabled={!renameReady}
                          style={{
                            ...sheetButtonStyle(renameReady),
                            minWidth: 64,
                            minHeight: 38,
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onRide(
                              `warp-down:${beacon.col},${beacon.row}` as MineAction,
                            )
                          }
                          disabled={!beacon.inRange}
                          style={{
                            ...sheetButtonStyle(beacon.inRange),
                            minWidth: 60,
                            minHeight: 38,
                          }}
                        >
                          Warp
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
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
