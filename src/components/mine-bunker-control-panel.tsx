"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BUNKER_SKIN_CATALOG,
  type BunkerFootprint,
  type BunkerSkinId,
  type BunkerState,
  bunkerRepairPlan,
  DEFAULT_BUNKER_SKIN,
  DEFENSE_XP_PER_LEVEL,
  maxBunkerRaidTier,
} from "@/sim/bunker";
import type { MineCoord } from "@/sim/mine";
import { useBunkerStore } from "@/state/bunker-store";
import { useDismissControls } from "./dismissible-dialog-frame";
import { sheetButtonStyle } from "./mine-sheet-controls";

const BUNKER_MINER_DEATH_TIP =
  "Tip: Clankers follow open bunker cells. Fully enclose the player cell before the next raid.";

/** An armed Reset confirm disarms itself after this long (F-093). */
const RESET_CONFIRM_WINDOW_MS = 5_000;

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
  onRepair,
  onReset,
  onSelectSkin,
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
  onRepair?: () => void;
  /** Resets the bunker to a bare claim (F-093): undamaged parts refund
   * to inventory, damaged parts are lost, dug cells refill. */
  onReset?: () => void;
  onSelectSkin?: (skinId: BunkerSkinId) => void;
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
  // Memoized: the parts scan only reruns when a mutation response swaps
  // the bunker reference, not on every raid-tick re-render.
  const repairPlan = useMemo(
    () => (bunker ? bunkerRepairPlan(bunker) : null),
    [bunker],
  );
  const repairCost = repairPlan?.totalCost ?? 0;
  // Two-step Reset confirm (F-093): the first tap arms, the second tap
  // within the window fires. The timer, any other tap in the sheet, or
  // closing the sheet disarms it.
  const [resetArmed, setResetArmed] = useState(false);
  const resetDisarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarmReset = () => {
    if (resetDisarmTimer.current !== null) {
      clearTimeout(resetDisarmTimer.current);
      resetDisarmTimer.current = null;
    }
    setResetArmed(false);
  };
  useEffect(() => {
    return () => {
      if (resetDisarmTimer.current !== null) {
        clearTimeout(resetDisarmTimer.current);
      }
    };
  }, []);
  // Closing the sheet is "any other interaction": it disarms too. The
  // component stays mounted behind the trigger button, so the armed
  // state would otherwise survive a quick close and reopen.
  useEffect(() => {
    if (panelOpen) return;
    if (resetDisarmTimer.current !== null) {
      clearTimeout(resetDisarmTimer.current);
      resetDisarmTimer.current = null;
    }
    setResetArmed(false);
  }, [panelOpen]);
  const handleReset = () => {
    if (!resetArmed) {
      setResetArmed(true);
      resetDisarmTimer.current = setTimeout(() => {
        resetDisarmTimer.current = null;
        setResetArmed(false);
      }, RESET_CONFIRM_WINDOW_MS);
      return;
    }
    disarmReset();
    onReset?.();
  };
  // Reset only clears placed parts now; it preserves the excavation and
  // the spawn pocket (F-120: no ore regen, never respawn in rock), so a
  // dug-out-but-unbuilt claim has nothing to reset.
  const resetAvailable =
    hasBunker &&
    !activeRaid &&
    onReset !== undefined &&
    (bunker?.parts.length ?? 0) > 0;
  const balance = player?.balance ?? 0;
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
      <section
        className="bunker-status-sheet"
        aria-label="Bunker status"
        onPointerDownCapture={(event) => {
          // Any interaction other than the Reset button disarms an
          // armed reset confirm.
          if (!resetArmed) return;
          if (
            event.target instanceof Element &&
            event.target.closest('[data-testid="bunker-reset"]')
          ) {
            return;
          }
          disarmReset();
        }}
      >
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
            ? "Enter the bunker to build inside: place, pry, and dig in first person."
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
              <fieldset className="bunker-raid-tier" aria-label="Raid tier">
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
              </fieldset>
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

        {hasBunker && !activeRaid && !pendingClaim && (
          <>
            <p
              className="bunker-balance"
              role="status"
              aria-label="Vibes balance"
            >
              {`Vibes: ${balance}`}
            </p>
            {repairCost > 0 && onRepair && (
              <button
                type="button"
                className="bunker-repair-button"
                onClick={onRepair}
                disabled={balance < repairCost}
                title={
                  balance < repairCost
                    ? `Needs ${repairCost - balance} more vibes`
                    : undefined
                }
              >
                {`Repair bunker (${repairCost} vibes)`}
              </button>
            )}
            {onSelectSkin && (
              <fieldset
                className="bunker-skin-picker"
                aria-label="Bunker skins"
              >
                {Object.values(BUNKER_SKIN_CATALOG).map((skin) => {
                  const owned =
                    skin.price === 0 ||
                    (bunker?.skinsOwned ?? []).includes(skin.id);
                  const selected =
                    (bunker?.skin ?? DEFAULT_BUNKER_SKIN) === skin.id;
                  const affordable = owned || balance >= skin.price;
                  return (
                    <button
                      key={skin.id}
                      type="button"
                      aria-pressed={selected}
                      title={
                        affordable
                          ? skin.blurb
                          : `${skin.blurb} (needs ${skin.price - balance} more vibes)`
                      }
                      onClick={() => onSelectSkin(skin.id)}
                      disabled={selected || !affordable}
                    >
                      {owned || selected
                        ? skin.name
                        : `${skin.name} (${skin.price}v)`}
                    </button>
                  );
                })}
              </fieldset>
            )}
          </>
        )}

        {resetAvailable && (
          <button
            type="button"
            className="bunker-reset-button"
            data-testid="bunker-reset"
            aria-pressed={resetArmed}
            onClick={handleReset}
          >
            {resetArmed
              ? "Really reset? Parts return to inventory"
              : "Reset bunker"}
          </button>
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
