"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  BENCH_ROSTER,
  type BenchComparison,
  type BenchReport,
  compareBench,
  runBench,
} from "@/sim/bench";
import { type BotDesign, validateDesign } from "@/sim/design";
import { pillStyle, STATUS, secondsFromTicks } from "./workshop-ui";

/**
 * The bench: fight the current design against the whole stock roster
 * headlessly and report what happened. This is the measurement half of the
 * build loop. A single match resolves in roughly 200ms, so a roster pass is
 * about a second, which is fast enough to run after every change.
 *
 * Re-running after a build change reports the A/B against the previous run,
 * so a change can be judged by what it did rather than by how it looked.
 */

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * Starting arrangements fought per opponent. Three keeps a roster pass to a
 * few seconds while giving the win rate real samples behind it.
 */
const BENCH_VARIATIONS = 3;

const OUTCOME_COLOR: Record<string, string> = {
  win: STATUS.good,
  loss: STATUS.bad,
  draw: STATUS.warn,
};

function Comparison({ comparison }: { comparison: BenchComparison }) {
  const flat =
    comparison.winRateDelta === 0 &&
    comparison.gained.length === 0 &&
    comparison.lost.length === 0;
  return (
    <div
      data-testid="bench-comparison"
      style={{
        marginTop: 8,
        padding: 8,
        borderRadius: 8,
        background: "#141a2c",
        border: "1px solid #263155",
        fontSize: "0.72rem",
      }}
    >
      <strong style={{ fontSize: "0.75rem" }}>Since the last run</strong>
      <p style={{ margin: "4px 0 0" }}>
        Win rate {signed(Math.round(comparison.winRateDelta * 100))} pts, damage
        dealt {signed(comparison.damageDealtDelta)}, damage taken{" "}
        {signed(comparison.damageTakenDelta)}.
      </p>
      {comparison.gained.length > 0 && (
        <p style={{ margin: "4px 0 0", color: OUTCOME_COLOR.win }}>
          Now beats: {comparison.gained.join(", ")}
        </p>
      )}
      {comparison.lost.length > 0 && (
        <p style={{ margin: "4px 0 0", color: OUTCOME_COLOR.loss }}>
          No longer beats: {comparison.lost.join(", ")}
        </p>
      )}
      {flat && (
        <p style={{ margin: "4px 0 0", opacity: 0.75 }}>
          No outcome changed. Check the score margins below for movement too
          small to flip a result.
        </p>
      )}
    </div>
  );
}

export function BenchPanel({
  design,
  panelStyle,
}: {
  design: BotDesign;
  panelStyle: React.CSSProperties;
}) {
  const [report, setReport] = useState<BenchReport | null>(null);
  const [comparison, setComparison] = useState<BenchComparison | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The report the next run compares against. Held in a ref so a re-render
  // mid-run cannot swap the baseline underneath the comparison.
  const baseline = useRef<BenchReport | null>(null);
  const running = progress !== null;

  // Memoized: a bench run re-renders this panel once per match through
  // setProgress, and validateDesign walks every connector plus an O(n^2)
  // clearance pass.
  const runnable = useMemo(() => validateDesign(design).ok, [design]);

  const run = useCallback(async () => {
    setError(null);
    setComparison(null);
    setProgress({
      done: 0,
      total: BENCH_ROSTER.length * BENCH_VARIATIONS,
    });
    try {
      const next = await runBench(design, {
        // Several starting arrangements per opponent, not one. A single
        // fixed spawn made every matchup one deterministic outcome, so a
        // six-bot roster reported a win rate with no variance behind it.
        variations: BENCH_VARIATIONS,
        onMatch: async (_match, index, total) => {
          setProgress({ done: index + 1, total });
          // Hand the main thread back between matches so the bench canvas
          // keeps rendering and the progress readout actually paints.
          await new Promise((resolve) => setTimeout(resolve, 0));
        },
      });
      const previous = baseline.current;
      setReport(next);
      if (previous) setComparison(compareBench(previous, next));
      baseline.current = next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "bench run failed");
    } finally {
      setProgress(null);
    }
  }, [design]);

  return (
    <section style={panelStyle} aria-label="Bench">
      <h2 style={{ margin: "0 0 4px", fontSize: "0.95rem" }}>Bench</h2>
      <p style={{ margin: "0 0 8px", fontSize: "0.72rem", opacity: 0.8 }}>
        Fights this build against all {BENCH_ROSTER.length} stock bots from{" "}
        {BENCH_VARIATIONS} starting positions each. Run it after a change to see
        what the change actually did.
      </p>

      <button
        type="button"
        data-testid="run-bench"
        onClick={run}
        disabled={running || !runnable}
        style={pillStyle({
          primary: runnable,
          disabled: running || !runnable,
          large: true,
        })}
      >
        {running
          ? `Fighting ${progress.done}/${progress.total}...`
          : report
            ? "Run bench again"
            : "Run bench"}
      </button>

      {!runnable && (
        <p
          style={{ margin: "8px 0 0", fontSize: "0.72rem", color: STATUS.warn }}
        >
          The bench needs an arena-legal bot. Fix the build first.
        </p>
      )}
      {error && (
        <p
          style={{ margin: "8px 0 0", fontSize: "0.72rem", color: STATUS.bad }}
        >
          {error}
        </p>
      )}

      {report && (
        <div data-testid="bench-report" style={{ marginTop: 10 }}>
          <p
            data-testid="bench-win-rate"
            style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}
          >
            {percent(report.winRate)} win rate
          </p>
          <p style={{ margin: "2px 0 0", fontSize: "0.75rem", opacity: 0.85 }}>
            {report.wins}W {report.losses}L {report.draws}D over{" "}
            {report.matches.length} fights. {report.decisiveWins} by disable,{" "}
            {report.timeouts} ran out the clock.
          </p>
          <p style={{ margin: "2px 0 0", fontSize: "0.75rem", opacity: 0.85 }}>
            Median time to kill:{" "}
            {report.medianTimeToKill === null
              ? "no clean kills"
              : secondsFromTicks(report.medianTimeToKill)}
            . Damage {report.averageDamageDealt} dealt,{" "}
            {report.averageDamageTaken} taken per fight.
          </p>

          {comparison && <Comparison comparison={comparison} />}

          {report.weakestParts.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong style={{ fontSize: "0.75rem" }}>Loses most often</strong>
              <ul
                style={{
                  margin: "2px 0 0",
                  paddingLeft: 18,
                  fontSize: "0.72rem",
                  opacity: 0.85,
                }}
              >
                {report.weakestParts.slice(0, 4).map((part) => (
                  <li key={part.partId} data-testid="bench-weak-part">
                    {part.name}: lost {part.losses} time
                    {part.losses === 1 ? "" : "s"} across {part.matches} fight
                    {part.matches === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul
            style={{
              margin: "8px 0 0",
              padding: 0,
              listStyle: "none",
              fontSize: "0.72rem",
            }}
          >
            {report.matches.map((match) => (
              <li
                key={`${match.opponentId}:${match.variation}`}
                data-testid="bench-match-row"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "3px 0",
                  borderTop: "1px solid #232b42",
                }}
              >
                <span>{match.opponentName}</span>
                <span style={{ color: OUTCOME_COLOR[match.outcome] }}>
                  {match.outcome}
                  <span style={{ opacity: 0.6 }}>
                    {" "}
                    {match.reason === "disable"
                      ? secondsFromTicks(match.ticks)
                      : `margin ${Math.round(match.scoreMargin)}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
