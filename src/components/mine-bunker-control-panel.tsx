"use client";

import {
  BASE_PART_CATALOG,
  BASE_PART_IDS,
  type BasePartId,
  type BasePartInventory,
  type BunkerFootprint,
  type BunkerState,
  DEFENSE_XP_PER_LEVEL,
} from "@/sim/bunker";
import type { Direction, MineCoord } from "@/sim/mine";
import { useBunkerStore } from "@/state/bunker-store";
import { useDismissControls } from "./dismissible-dialog-frame";
import { sheetButtonStyle } from "./mine-sheet-controls";

export type BunkerBuildMode = "place" | "remove" | "move";
const BUNKER_WALK_BUTTONS: Array<[Direction, string]> = [
  ["left", "<"],
  ["up", "^"],
  ["right", ">"],
  ["down", "v"],
];
const BUNKER_MINER_DEATH_TIP =
  "Tip: Clankers follow open bunker cells. Fully enclose the player cell before the next raid.";

export function BunkerControlPanel({
  minerRow,
  claimMode,
  panelOpen,
  bunker,
  inventory,
  pendingClaim,
  preview,
  localBlockedCells,
  bankedBlockedCells,
  selectedPart,
  buildMode,
  onSelectPart,
  onBuildModeChange,
  onStartClaim,
  onCancelClaim,
  onOpenPanel,
  onDismissPanel,
  onClaim,
  onWalk,
  onStartRaid,
  onFinishRaid,
}: {
  minerRow: number;
  claimMode: boolean;
  panelOpen: boolean;
  preview: BunkerFootprint | null;
  bunker: BunkerState | null;
  inventory: BasePartInventory;
  pendingClaim: boolean;
  localBlockedCells: readonly MineCoord[];
  bankedBlockedCells: readonly MineCoord[];
  selectedPart: BasePartId;
  buildMode: BunkerBuildMode;
  onSelectPart: (partId: BasePartId) => void;
  onBuildModeChange: (mode: BunkerBuildMode) => void;
  onStartClaim: () => void;
  onCancelClaim: () => void;
  onOpenPanel: () => void;
  onDismissPanel: () => void;
  onClaim: () => void;
  onWalk: (dir: Direction) => void;
  onStartRaid: () => void;
  onFinishRaid: () => void;
}) {
  const status = useBunkerStore((s) => s.status);
  const activeRaid = useBunkerStore((s) => s.activeRaid);
  const player = useBunkerStore((s) => s.player);
  const lastReward = useBunkerStore((s) => s.lastRaidReward);
  const note = useBunkerStore((s) => s.note);
  const hasBunker = Boolean(bunker);
  const localBlockerCount = localBlockedCells.length;
  const bankedBlockerCount = bankedBlockedCells.length;
  const canClaim =
    !hasBunker &&
    status !== "loading" &&
    preview !== null &&
    localBlockerCount === 0;
  const raidAllowsBuild =
    !activeRaid || (activeRaid.survived && activeRaid.allClankersDead);
  const canBuild = hasBunker && raidAllowsBuild;
  const canPlace = canBuild && inventory[selectedPart] > 0;
  const compactLabel = hasBunker ? "Open bunker builder" : "Start bunker claim";
  const compactText = hasBunker ? "Bunker" : "Bunker claim";
  const openCompactPanel = hasBunker ? onOpenPanel : onStartClaim;
  const dismissPanel = hasBunker ? onDismissPanel : onCancelClaim;
  const levelProgressMax =
    player?.nextLevelXp === null
      ? DEFENSE_XP_PER_LEVEL
      : (player?.progressXp ?? 0) + (player?.neededXp ?? DEFENSE_XP_PER_LEVEL);
  const levelProgressValue =
    player?.nextLevelXp === null
      ? DEFENSE_XP_PER_LEVEL
      : (player?.progressXp ?? 0);
  const levelProgressPercent =
    levelProgressMax > 0
      ? Math.min(100, (levelProgressValue / levelProgressMax) * 100)
      : 0;
  const uncollectedPickups = (activeRaid?.xpPickups ?? []).filter(
    (pickup) => !pickup.collected,
  );
  const uncollectedPickupXp = uncollectedPickups.reduce(
    (sum, pickup) => sum + pickup.defenseXp,
    0,
  );
  const collectedPickupXp = (activeRaid?.xpPickups ?? []).reduce(
    (sum, pickup) => sum + (pickup.collected ? pickup.defenseXp : 0),
    0,
  );
  const finishDisabled =
    pendingClaim ||
    Boolean(activeRaid?.survived && uncollectedPickups.length > 0);
  const raidButtonLabel = activeRaid
    ? activeRaid.survived
      ? uncollectedPickups.length > 0
        ? "Walk over raid XP"
        : "Finish raid"
      : "End failed raid"
    : "Start Clanker raid";
  useDismissControls(
    minerRow > 0 && (claimMode || (hasBunker && panelOpen)),
    dismissPanel,
  );

  if (minerRow <= 0) return null;

  if ((!hasBunker && !claimMode) || (hasBunker && !panelOpen)) {
    return (
      <button
        type="button"
        aria-label={compactLabel}
        onClick={openCompactPanel}
        style={{
          position: "absolute",
          left: 12,
          bottom: 154,
          zIndex: 8,
          minHeight: 42,
          borderRadius: 999,
          border: "1px solid #54e0c7",
          background: "rgba(14, 20, 28, 0.94)",
          boxShadow: "0 8px 22px rgba(0, 0, 0, 0.36)",
          color: "#54e0c7",
          fontWeight: 800,
          padding: "0 14px",
          pointerEvents: "auto",
          cursor: "pointer",
        }}
      >
        {compactText}
      </button>
    );
  }
  return (
    <>
      {!hasBunker && (
        <button
          type="button"
          aria-label="Dismiss bunker builder"
          onClick={dismissPanel}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 112,
            left: 0,
            zIndex: 7,
            border: 0,
            background: "transparent",
            pointerEvents: "auto",
            cursor: "default",
          }}
        />
      )}
      <section
        aria-label="Bunker builder"
        style={{
          position: "absolute",
          left: 10,
          right: 10,
          bottom: 106,
          zIndex: 8,
          maxHeight: "min(238px, calc(100vh - 188px))",
          overflowY: "auto",
          border: "1px solid #54e0c7",
          borderRadius: 8,
          background: "rgba(14, 20, 28, 0.94)",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.42)",
          padding: 10,
          color: "#e6e8ee",
          pointerEvents: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <strong style={{ color: "#54e0c7" }}>Bunker</strong>
          <span
            style={{ marginLeft: "auto", fontSize: "0.75rem", opacity: 0.7 }}
          >
            lv {player?.overallLevel ?? 1}
          </span>
          {hasBunker && (
            <button
              type="button"
              onClick={onDismissPanel}
              style={{
                border: "1px solid #5b6680",
                borderRadius: 8,
                background: "#20283a",
                color: "#cdd6ea",
                fontWeight: 800,
                fontSize: "0.72rem",
                padding: "5px 8px",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          )}
        </div>
        <p style={{ margin: "6px 0 10px", fontSize: "0.78rem", opacity: 0.7 }}>
          {hasBunker
            ? buildMode === "place"
              ? "Place mode. Tap a claimed cell for the selected part."
              : buildMode === "remove"
                ? "Remove mode. Tap an undamaged placed part."
                : "Move mode. Drag any placed part to another claimed cell."
            : !preview
              ? "Dig deeper to fit a 7x5 claim. The top row cannot touch the surface."
              : localBlockerCount > 0
                ? `Clear ${localBlockerCount} red cell${localBlockerCount === 1 ? "" : "s"}. The miner's row counts.`
                : bankedBlockerCount > 0
                  ? "Ready to claim. Build now, then bank at surface to save."
                  : "Ready to claim. Build now, then bank at surface to save."}
        </p>
        {player && (
          <fieldset
            aria-label="Player level progress"
            style={{
              border: "1px solid rgba(84, 224, 199, 0.34)",
              borderRadius: 10,
              background: "rgba(84, 224, 199, 0.08)",
              padding: 8,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                fontSize: "0.76rem",
                fontWeight: 800,
              }}
            >
              <span>
                Player level {player.overallLevel}/{player.levelCap}
              </span>
              <span style={{ color: "#f5c542" }}>
                Beacon cap {player.beaconLimit}
              </span>
            </div>
            <div
              aria-hidden
              style={{
                height: 6,
                borderRadius: 999,
                background: "rgba(255, 255, 255, 0.12)",
                margin: "7px 0 5px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${levelProgressPercent}%`,
                  height: "100%",
                  background: "#54e0c7",
                }}
              />
            </div>
            <p style={{ margin: 0, fontSize: "0.72rem", opacity: 0.76 }}>
              {player.nextLevelXp === null
                ? `Defense XP ${player.defenseXp}. Level cap reached.`
                : `Defense XP ${levelProgressValue}/${levelProgressMax}. ${player.neededXp} XP to level ${player.overallLevel + 1}.`}
            </p>
          </fieldset>
        )}
        {lastReward && (
          <div
            role="alert"
            aria-label="Bunker battle result"
            style={{
              border: lastReward.survived
                ? "1px solid rgba(84, 224, 199, 0.42)"
                : "1px solid rgba(255, 107, 107, 0.5)",
              borderRadius: 10,
              background: lastReward.survived
                ? "rgba(84, 224, 199, 0.1)"
                : "rgba(255, 107, 107, 0.11)",
              padding: 8,
              marginBottom: 10,
              fontSize: "0.74rem",
            }}
          >
            <strong style={{ display: "block", marginBottom: 4 }}>
              {lastReward.survived ? "Defense survived" : "Defense failed"}
            </strong>
            {lastReward.survived ? (
              <span>
                +{lastReward.xpGained} defense XP, +{lastReward.vibesGained}{" "}
                vibes.
                {lastReward.leveledUp
                  ? ` Level ${lastReward.levelAfter} reached. Reward: beacon cap ${lastReward.beaconLimitAfter}.`
                  : ""}
                {lastReward.newStamps.includes("survival-first-defense")
                  ? " First Defense stamp earned."
                  : ""}
              </span>
            ) : (
              <span>No defense XP gained. {BUNKER_MINER_DEATH_TIP}</span>
            )}
          </div>
        )}
        {!hasBunker && (
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
          >
            <button
              type="button"
              disabled={!canClaim}
              onClick={onClaim}
              style={{ ...sheetButtonStyle(canClaim), width: "100%" }}
            >
              Claim 7x5 bunker
            </button>
            <button
              type="button"
              onClick={onCancelClaim}
              style={{
                ...sheetButtonStyle(true),
                width: "100%",
                border: "1px solid #5b6680",
                background: "#20283a",
                color: "#cdd6ea",
              }}
            >
              Cancel claim
            </button>
          </div>
        )}
        {hasBunker && (
          <>
            <fieldset
              aria-label="Build mode"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 6,
                margin: "0 0 8px",
                border: "1px solid rgba(138, 164, 255, 0.36)",
                borderRadius: 8,
                background: "rgba(17, 21, 31, 0.58)",
                padding: "14px 6px 6px",
                position: "relative",
              }}
            >
              <legend
                style={{
                  color: "#9fb6ff",
                  fontSize: "0.7rem",
                  fontWeight: 900,
                  padding: "0 5px",
                }}
              >
                Mode
              </legend>
              {(
                [
                  {
                    mode: "place",
                    label: "Place",
                    color: "#54e0c7",
                    enabled: canPlace,
                  },
                  {
                    mode: "remove",
                    label: "Remove",
                    color: "#ff6b6b",
                    enabled: canBuild,
                  },
                  {
                    mode: "move",
                    label: "Move",
                    color: "#8aa4ff",
                    enabled: canBuild,
                  },
                ] satisfies Array<{
                  mode: BunkerBuildMode;
                  label: string;
                  color: string;
                  enabled: boolean;
                }>
              ).map((item) => {
                const active = buildMode === item.mode;
                return (
                  <button
                    key={item.mode}
                    type="button"
                    aria-pressed={active}
                    disabled={!item.enabled}
                    onClick={() => onBuildModeChange(item.mode)}
                    style={{
                      minHeight: 34,
                      borderRadius: 6,
                      border: active
                        ? `2px solid ${item.color}`
                        : "1px solid #2c3a5c",
                      background: active
                        ? `${item.color}2b`
                        : "rgba(38, 48, 74, 0.55)",
                      color: active ? item.color : "#cdd6ea",
                      fontWeight: 900,
                      fontSize: "0.74rem",
                      cursor: item.enabled ? "pointer" : "not-allowed",
                      opacity: item.enabled ? 1 : 0.44,
                      boxShadow: active ? `0 0 0 2px ${item.color}24` : "none",
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </fieldset>
            <fieldset
              aria-label="Walk while building"
              style={{
                display: "grid",
                gridTemplateColumns: "40px 40px 40px 1fr",
                gap: 6,
                alignItems: "center",
                margin: "0 0 8px",
                border: "1px solid rgba(84, 224, 199, 0.28)",
                borderRadius: 8,
                background: "rgba(84, 224, 199, 0.06)",
                padding: "14px 6px 6px",
              }}
            >
              <legend
                style={{
                  color: "#54e0c7",
                  fontSize: "0.7rem",
                  fontWeight: 900,
                  padding: "0 5px",
                }}
              >
                Walk
              </legend>
              {BUNKER_WALK_BUTTONS.map(([dir, label]) => (
                <button
                  key={dir}
                  type="button"
                  aria-label={`Walk ${dir}`}
                  disabled={!canBuild}
                  onClick={() => onWalk(dir)}
                  style={{
                    minHeight: 34,
                    borderRadius: 6,
                    border: "1px solid #2c3a5c",
                    background: "rgba(38, 48, 74, 0.72)",
                    color: "#e6e8ee",
                    fontWeight: 900,
                    fontSize: "0.82rem",
                    cursor: canBuild ? "pointer" : "not-allowed",
                    opacity: canBuild ? 1 : 0.44,
                  }}
                >
                  {label}
                </button>
              ))}
            </fieldset>
            <fieldset
              aria-label="Base parts"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 6,
                marginBottom: 10,
                border: "1px solid rgba(84, 224, 199, 0.24)",
                borderRadius: 8,
                background: "rgba(17, 21, 31, 0.42)",
                padding: "14px 6px 6px",
              }}
            >
              <legend
                style={{
                  color: "#54e0c7",
                  fontSize: "0.7rem",
                  fontWeight: 900,
                  padding: "0 5px",
                }}
              >
                Parts
              </legend>
              {BASE_PART_IDS.map((partId) => {
                const active = selectedPart === partId;
                return (
                  <button
                    key={partId}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectPart(partId)}
                    style={{
                      minHeight: 34,
                      borderRadius: 6,
                      border: active
                        ? "1px solid #54e0c7"
                        : "1px solid #2c3a5c",
                      background: active
                        ? "rgba(84, 224, 199, 0.16)"
                        : "rgba(38, 48, 74, 0.55)",
                      color: active ? "#54e0c7" : "#cdd6ea",
                      fontWeight: 800,
                      fontSize: "0.68rem",
                      cursor: "pointer",
                      padding: "4px 3px",
                    }}
                  >
                    {BASE_PART_CATALOG[partId].name} x{inventory[partId]}
                  </button>
                );
              })}
            </fieldset>
            <button
              type="button"
              onClick={activeRaid ? onFinishRaid : onStartRaid}
              disabled={finishDisabled}
              style={{
                ...sheetButtonStyle(!finishDisabled),
                width: "100%",
                marginTop: 8,
                border: "1px solid #ff6b6b",
                color: "#ffd9d9",
                background: "#3a1820",
              }}
            >
              {raidButtonLabel}
            </button>
            {pendingClaim && (
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: "0.74rem",
                  color: "#f5c542",
                }}
              >
                Raids unlock after the bunker saves at the surface.
              </p>
            )}
            {activeRaid && (
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: "0.74rem",
                  color: "#f5c542",
                }}
              >
                {activeRaid.survived
                  ? uncollectedPickups.length > 0
                    ? `${activeRaid.clankers.length} ${activeRaid.clankers.length === 1 ? "Clanker" : "Clankers"} dead. Walk over ${uncollectedPickupXp} defense XP on the ground.`
                    : `All raid XP collected: ${collectedPickupXp} defense XP.`
                  : `Miner killed. The raid ended and all XP vanished. ${BUNKER_MINER_DEATH_TIP}`}
              </p>
            )}
          </>
        )}
        {note && (
          <p
            style={{ margin: "8px 0 0", fontSize: "0.74rem", color: "#f5c542" }}
          >
            {note}
          </p>
        )}
      </section>
    </>
  );
}
