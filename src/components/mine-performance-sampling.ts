"use client";

import { useEffect } from "react";
import type { AppRelease } from "@/lib/app-release-types";
import { summarizeFrameMetrics } from "@/lib/performance-metrics";
import { MINE_VERSION } from "@/sim/mine";

const PERFORMANCE_LAST_SENT_KEY = "vibebots-performance-last-sent";
const PERFORMANCE_SAMPLE_MS = 12_000;
const PERFORMANCE_INITIAL_DELAY_MS = 4_000;
const PERFORMANCE_REPEAT_MS = 5 * 60_000;
const PERFORMANCE_MIN_SEND_INTERVAL_MS = 60 * 60_000;

interface PerformanceWindowOverrides {
  __vibebotsPerfInitialDelayMs?: number;
  __vibebotsPerfSampleMs?: number;
  __vibebotsPerfRepeatMs?: number;
  __vibebotsPerfMinSendIntervalMs?: number;
}

function browserNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function performanceOverride(
  key: keyof PerformanceWindowOverrides,
  fallback: number,
): number {
  const value = (window as Window & PerformanceWindowOverrides)[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function lastPerformanceSentAt(): number {
  try {
    return Number(localStorage.getItem(PERFORMANCE_LAST_SENT_KEY) ?? 0);
  } catch {
    return 0;
  }
}

function markPerformanceSent(): void {
  try {
    localStorage.setItem(PERFORMANCE_LAST_SENT_KEY, String(Date.now()));
  } catch {}
}

export function useMinePerformanceSampling(appRelease: AppRelease) {
  useEffect(() => {
    let cancelled = false;
    let timeout = 0;
    let frame = 0;

    const shouldSend = (now: number) => {
      const minInterval = performanceOverride(
        "__vibebotsPerfMinSendIntervalMs",
        PERFORMANCE_MIN_SEND_INTERVAL_MS,
      );
      const last = lastPerformanceSentAt();
      return !Number.isFinite(last) || now - last >= minInterval;
    };

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      window.clearTimeout(timeout);
      timeout = window.setTimeout(sample, delayMs);
    };

    const finish = (
      startedAt: number,
      frames: number[],
      drawCalls: number[],
      canvas: HTMLCanvasElement,
    ) => {
      if (cancelled || frames.length < 5) return;
      const summary = summarizeFrameMetrics(frames);
      const drawTotal = drawCalls.reduce((sum, value) => sum + value, 0);
      markPerformanceSent();
      fetch("/api/performance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "mine",
          appVersion: appRelease.version,
          appBuild: appRelease.build,
          mineVersion: MINE_VERSION,
          durationMs: Math.round(performance.now() - startedAt),
          ...summary,
          drawCallsAvg:
            drawCalls.length === 0
              ? null
              : Math.round((drawTotal / drawCalls.length) * 10) / 10,
          drawCallsMax: drawCalls.length === 0 ? null : Math.max(...drawCalls),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
          hardwareConcurrency: browserNumber(navigator.hardwareConcurrency),
          deviceMemoryGb: browserNumber(
            (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
          ),
          renderer: canvas.dataset.renderer ?? null,
          visibilityState: document.visibilityState,
        }),
        keepalive: true,
      }).catch(() => {});
    };

    function sample() {
      if (cancelled) return;
      const repeatMs = performanceOverride(
        "__vibebotsPerfRepeatMs",
        PERFORMANCE_REPEAT_MS,
      );
      if (document.visibilityState !== "visible" || !shouldSend(Date.now())) {
        schedule(repeatMs);
        return;
      }
      const canvas = document.querySelector("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) {
        schedule(1_000);
        return;
      }
      const sampleMs = Math.max(
        250,
        performanceOverride("__vibebotsPerfSampleMs", PERFORMANCE_SAMPLE_MS),
      );
      const frames: number[] = [];
      const drawCalls: number[] = [];
      const startedAt = performance.now();
      let previous = startedAt;
      const collect = (now: number) => {
        if (cancelled) return;
        frames.push(now - previous);
        previous = now;
        const draw = Number(canvas.dataset.drawCalls);
        if (Number.isFinite(draw)) drawCalls.push(draw);
        if (now - startedAt >= sampleMs) {
          finish(startedAt, frames, drawCalls, canvas);
          schedule(repeatMs);
          return;
        }
        frame = requestAnimationFrame(collect);
      };
      frame = requestAnimationFrame(collect);
    }

    schedule(
      performanceOverride(
        "__vibebotsPerfInitialDelayMs",
        PERFORMANCE_INITIAL_DELAY_MS,
      ),
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      cancelAnimationFrame(frame);
    };
  }, [appRelease]);
}
