"use client";

import { useState } from "react";
import {
  type BunkerFootprint,
  type BunkerState,
  DEFENSE_XP_PER_LEVEL,
  maxBunkerRaidTier,
} from "@/sim/bunker";
import type { MineCoord } from "@/sim/mine";
import { useBunkerStore } from "@/state/bunker-store";
import { useDismissControls } from "./dismissible-dialog-frame";
import { sheetButtonStyle } from "./mine-sheet-controls";

const BUNKER_MINER_DEATH_TIP =
  "Tip: Clankers follow open bunker cells. Fully enclose the player cell before the next raid.";

export function BunkerControlPanel({
  minerRow,
  claimMode,
  panelOpen,
  bunker,
  pendingClaim,
  preview,
  localBlockedCells,
  bankedBlockedCells,
  onStartClaim,
  onCancelClaim,
  onOpenPanel,
  onDismissPanel,
  onClaim,
  onStartRaid,
  onFinishRaid,
}: {
  minerRow: number;
  claimMode: boolean;
  panelOpen: boolean;
  preview: BunkerFootprint | null;
  bunker: BunkerState | null;
  pendingClaim: boolean;
  localBlockedCells: readonly MineCoord[];
  bankedBlockedCells: readonly MineCoord[];
  onStartClaim: () => void;
  onCancelClaim: () => void;
  onOpenPanel: () => void;
  onDismissPanel: () => void;
  onClaim: () => void;
  onStartRaid: (tier: number) => void;
  onFinishRaid: () => void;
}) {
  const status = useBunkerStore((s) => s.status);
  const activeRaid = useBunkerStore((s) => s.activeRaid);
  const player = useBunkerStore((s) => s.player);
  const lastReward = useBunkerStore((s) => s.lastRaidReward);
  const note = useBunkerStore((s) => s.note);
  const hasBunker = Boolean(bunker);
  const localBlockerCount = localBlockedCells.length;
  const canClaim =
    !hasBunker &&
    status !== "loading" &&
    preview !== null &&
    localBlockerCount === 0;
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
  // Raid tier selection (F-084): one tier per player level, capped by
  // the sim's ceiling. The pick clamps whenever the level changes so it
  // never exceeds what the server will accept.
  const tierCeiling = maxBunkerRaidTier(player?.overallLevel ?? 1);
  const [raidTier, setRaidTier] = useState(1);
  const pickedTier = Math.min(raidTier, tierCeiling);
  const raidButtonLabel = activeRaid
    ? activeRaid.survived
      ? uncollectedPickups.length > 0
        ? "Walk over raid XP"
        : "Finish raid"
      : "End failed raid"
    : "Start Clanker raid";
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

  useDismissControls(
    minerRow > 0 && (claimMode || (hasBunker && panelOpen)),
    hasBunker ? onDismissPanel : onCancelClaim,
  );

  if (minerRow <= 0) return null;
  if ((!hasBunker && !claimMode) || (hasBunker && !panelOpen)) {
    return (
      <button
        type="button"
        className="bunker-status-trigger"
        aria-label={hasBunker ? "Open bunker status" : "Start bunker claim"}
        onClick={hasBunker ? onOpenPanel : onStartClaim}
      >
        {hasBunker ? "Bunker" : "Claim bunker"}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className="bunker-status-backdrop"
        aria-label="Dismiss bunker status"
        onClick={hasBunker ? onDismissPanel : onCancelClaim}
      />
      <section className="bunker-status-sheet" aria-label="Bunker status">
        <header className="bunker-status-heading">
          <div>
            <span className="bunker-status-kicker">Underground claim</span>
            <strong>Bunker</strong>
          </div>
          <span>Lv {player?.overallLevel ?? 1}</span>
          <button
            type="button"
            className="bunker-status-close"
            onClick={hasBunker ? onDismissPanel : onCancelClaim}
          >
            Close
          </button>
        </header>

        <p className="bunker-status-copy">
          {hasBunker
            ? "Close this sheet and equip the hammer to build in the mine."
            : !preview
              ? "Dig deeper to fit a 7x5 claim. The top row cannot touch the surface."
              : localBlockerCount > 0
                ? `Clear ${localBlockerCount} red cell${localBlockerCount === 1 ? "" : "s"}. The miner's row counts.`
                : bankedBlockedCells.length > 0
                  ? "Ready to claim. Build now, then bank at surface to save."
                  : "Ready to claim. Build now, then bank at surface to save."}
        </p>

        {player && (
          <fieldset
            className="bunker-level-card"
            aria-label="Player level progress"
          >
            <div className="bunker-level-label-row">
              <strong>
                Level {player.overallLevel}/{player.levelCap}
              </strong>
              <span className="bunker-level-beacon">
                Beacon cap {player.beaconLimit}
              </span>
            </div>
            <div className="bunker-level-track" aria-hidden="true">
              <span style={{ width: `${levelProgressPercent}%` }} />
            </div>
            <small>
              {player.nextLevelXp === null
                ? `Defense XP ${player.defenseXp}. Level cap reached.`
                : `Defense XP ${levelProgressValue}/${levelProgressMax}. ${player.neededXp} XP to level ${player.overallLevel + 1}.`}
            </small>
          </fieldset>
        )}

        {lastReward && (
          <div
            className={
              lastReward.survived
                ? "bunker-result bunker-result-success"
                : "bunker-result bunker-result-failed"
            }
            role="alert"
          >
            <strong>
              {lastReward.survived ? "Defense survived" : "Defense failed"}
            </strong>
            <span>
              {lastReward.survived
                ? `+${lastReward.xpGained} defense XP, +${lastReward.vibesGained} vibes.`
                : `No defense XP gained. ${BUNKER_MINER_DEATH_TIP}`}
            </span>
          </div>
        )}

        {!hasBunker ? (
          <div className="bunker-status-actions">
            <button
              type="button"
              disabled={!canClaim}
              onClick={onClaim}
              style={sheetButtonStyle(canClaim)}
            >
              Claim 7x5 bunker
            </button>
            <button
              type="button"
              onClick={onCancelClaim}
              style={sheetButtonStyle(true)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            {!activeRaid && tierCeiling > 1 && (
              <div className="bunker-raid-tier" role="group" aria-label="Raid tier">
                <button
                  type="button"
                  aria-label="Lower raid tier"
                  onClick={() => setRaidTier(Math.max(1, pickedTier - 1))}
                  disabled={pickedTier <= 1}
                >
                  -
                </button>
                <span data-testid="bunker-raid-tier">
                  {`Tier ${pickedTier}`}
                </span>
                <button
                  type="button"
                  aria-label="Raise raid tier"
                  onClick={() =>
                    setRaidTier(Math.min(tierCeiling, pickedTier + 1))
                  }
                  disabled={pickedTier >= tierCeiling}
                >
                  +
                </button>
              </div>
            )}
            <button
              type="button"
              className="bunker-raid-button"
              onClick={
                activeRaid ? onFinishRaid : () => onStartRaid(pickedTier)
              }
              disabled={finishDisabled || (!activeRaid && pendingClaim)}
            >
              {activeRaid
                ? raidButtonLabel
                : `${raidButtonLabel} (T${pickedTier})`}
            </button>
          </>
        )}

        {pendingClaim && hasBunker && (
          <p className="bunker-status-note">
            Raids unlock after the bunker saves at the surface.
          </p>
        )}
        {activeRaid && (
          <p className="bunker-status-note">
            {activeRaid.survived
              ? uncollectedPickups.length > 0
                ? `${activeRaid.clankers.length} ${activeRaid.clankers.length === 1 ? "Clanker" : "Clankers"} dead. Walk over ${uncollectedPickupXp} defense XP on the ground.`
                : `All raid XP collected: ${collectedPickupXp} defense XP.`
              : `Miner killed. The raid ended and all XP vanished. ${BUNKER_MINER_DEATH_TIP}`}
          </p>
        )}
        {note && <p className="bunker-status-note">{note}</p>}
      </section>
    </>
  );
}
