"use client";

import { useCallback, useEffect, useRef } from "react";
import { ACHIEVEMENT_BY_ID } from "@/lib/achievements";
import { useStampAlertStore } from "@/state/stamp-alert-store";
import { StampArt } from "./stamp-art";

/** Total run of the pop-hold-fade animation in mine.css. */
export const STAMP_ALERT_MS = 3000;

/**
 * Transient "stamp collected" banner (REQ-032). Drains the stamp alert
 * queue one stamp at a time. Like StratumBanner, the CSS animation owns
 * each alert's lifetime (onAnimationEnd advances the queue) and a timer
 * is only the stuck-alert reaper for environments where the animation
 * never runs; re-arming from animationstart keeps it from racing a
 * late-starting animation on a stalled main thread.
 */
export function StampCollectAlert({
  onOpenStampBook,
}: {
  /** Makes the alert clickable: opens this stamp in the Stamp Book. */
  onOpenStampBook?: (achievementId: string) => void;
}) {
  const achievementId = useStampAlertStore((s) => s.queue[0] ?? null);
  const shiftStampAlert = useStampAlertStore((s) => s.shiftStampAlert);
  const reaper = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armReaper = useCallback(
    (delayMs: number) => {
      if (reaper.current !== null) clearTimeout(reaper.current);
      reaper.current = setTimeout(() => {
        reaper.current = null;
        shiftStampAlert();
      }, delayMs);
    },
    [shiftStampAlert],
  );

  useEffect(() => {
    if (achievementId === null) return;
    armReaper(STAMP_ALERT_MS * 2);
    return () => {
      if (reaper.current !== null) {
        clearTimeout(reaper.current);
        reaper.current = null;
      }
    };
  }, [achievementId, armReaper]);

  if (achievementId === null) return null;
  return (
    <StampAlertCard
      key={achievementId}
      achievementId={achievementId}
      onAnimationStart={() => armReaper(STAMP_ALERT_MS + 400)}
      onAnimationEnd={shiftStampAlert}
      onOpen={
        onOpenStampBook
          ? () => {
              // The book takes over: advance the queue so the alert is
              // not still popping over the opened dialog.
              onOpenStampBook(achievementId);
              shiftStampAlert();
            }
          : undefined
      }
    />
  );
}

/** The visible alert card, store-free so it can render anywhere. */
export function StampAlertCard({
  achievementId,
  onAnimationStart,
  onAnimationEnd,
  onOpen,
}: {
  achievementId: string;
  onAnimationStart?: () => void;
  onAnimationEnd?: () => void;
  /** Makes the card content a button that opens the Stamp Book. */
  onOpen?: () => void;
}) {
  const definition = ACHIEVEMENT_BY_ID.get(achievementId);
  if (!definition) return null;
  const content = (
    <>
      <StampArt achievementId={achievementId} size={56} />
      <div>
        <span className="mine-stamp-alert-eyebrow">Stamp collected</span>
        <strong className="mine-stamp-alert-title">{definition.title}</strong>
      </div>
    </>
  );
  return (
    <div
      className="mine-stamp-alert"
      role="status"
      data-stamp-alert={achievementId}
      onAnimationStart={onAnimationStart}
      onAnimationEnd={onAnimationEnd}
    >
      {onOpen ? (
        <button
          type="button"
          className="mine-stamp-alert-open"
          aria-label={`Open ${definition.title} in the Stamp Book`}
          onClick={onOpen}
        >
          {content}
        </button>
      ) : (
        content
      )}
    </div>
  );
}
