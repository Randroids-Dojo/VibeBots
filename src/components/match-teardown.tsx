"use client";

import { DT } from "@/sim/constants";
import type { MatchTeardown, TeardownPart } from "@/sim/telemetry";

/**
 * The post-match inspection sheet. The fight used to end with a banner and
 * nothing else; this answers "why did it lose" with per-part damage, the
 * part that landed the killing blow, and the hardest hits of the match.
 *
 * DOM text on purpose (Rule 10): exact numbers belong outside the canvas.
 */

function seconds(ticks: number): string {
  return `${(ticks * DT).toFixed(1)}s`;
}

function healthRatio(part: TeardownPart): number {
  return part.maxHealth > 0 ? part.health / part.maxHealth : 0;
}

const CATEGORY_COLOR: Record<TeardownPart["category"], string> = {
  core: "#ffd166",
  structure: "#8fa3c8",
  mobility: "#5ac8fa",
  weapon: "#ff7a7a",
};

function PartRow({
  part,
  nameOfEnemyPart,
}: {
  part: TeardownPart;
  nameOfEnemyPart: (iid: string) => string;
}) {
  const ratio = healthRatio(part);
  return (
    <li
      data-testid="teardown-part-row"
      data-part-iid={part.iid}
      data-destroyed={part.destroyed ? "true" : "false"}
      style={{
        listStyle: "none",
        padding: "6px 0",
        borderBottom: "1px solid #232b42",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          fontSize: "0.8rem",
        }}
      >
        <span style={{ color: CATEGORY_COLOR[part.category] }}>
          {part.name}
          {part.destroyed ? " (lost)" : ""}
        </span>
        <span style={{ opacity: 0.8 }}>
          {Math.round(part.health)}/{Math.round(part.maxHealth)}
        </span>
      </div>
      <div
        aria-hidden="true"
        style={{
          height: 4,
          borderRadius: 2,
          background: "#232b42",
          margin: "4px 0",
        }}
      >
        <div
          style={{
            width: `${Math.max(0, Math.min(1, ratio)) * 100}%`,
            height: "100%",
            borderRadius: 2,
            background: part.destroyed
              ? "#ff6b6b"
              : ratio > 0.5
                ? "#54e0c7"
                : "#ffd166",
          }}
        />
      </div>
      <div style={{ fontSize: "0.7rem", opacity: 0.75 }}>
        took {Math.round(part.damageTaken)} over {part.hitsTaken} hit
        {part.hitsTaken === 1 ? "" : "s"}
        {part.damageDealt > 0
          ? `, dealt ${Math.round(part.damageDealt)} over ${part.hitsDealt}`
          : ""}
        {part.destroyedAtTick !== null
          ? `, lost at ${seconds(part.destroyedAtTick)}`
          : ""}
        {part.killedBy ? ` to their ${nameOfEnemyPart(part.killedBy)}` : ""}
      </div>
    </li>
  );
}

export function MatchTeardownSheet({
  teardown,
  onClose,
}: {
  teardown: MatchTeardown;
  onClose: () => void;
}) {
  const nameLookup = teardown.bots.map(
    (bot) => new Map(bot.parts.map((part) => [part.iid, part.name])),
  );

  return (
    <section
      id="match-teardown-sheet"
      data-testid="match-teardown"
      aria-label="Match teardown"
      style={{
        position: "absolute",
        inset: "auto 12px 12px 12px",
        maxHeight: "62dvh",
        overflowY: "auto",
        background: "rgba(14,18,32,0.96)",
        border: "1px solid #344061",
        borderRadius: 12,
        padding: 14,
        color: "#e6e8ee",
        zIndex: 40,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <h2 style={{ margin: 0, fontSize: "0.95rem" }}>Teardown</h2>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "#26304a",
            color: "#e6e8ee",
            border: "1px solid #344061",
            borderRadius: 8,
            padding: "4px 12px",
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </header>

      <p style={{ margin: "0 0 10px", fontSize: "0.75rem", opacity: 0.8 }}>
        {seconds(teardown.ticks)} of fighting, {teardown.totalImpacts} impacts
        {teardown.truncated ? " (log truncated)" : ""}.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
        }}
      >
        {teardown.bots.map((bot, index) => (
          <div key={bot.name + String(index)} data-testid="teardown-bot">
            <h3 style={{ margin: "0 0 2px", fontSize: "0.85rem" }}>
              {bot.name}
            </h3>
            <p style={{ margin: "0 0 6px", fontSize: "0.7rem", opacity: 0.75 }}>
              dealt {Math.round(bot.damageDealt)}, took{" "}
              {Math.round(bot.damageTaken)}, lost {bot.partsLost} part
              {bot.partsLost === 1 ? "" : "s"}
              {bot.firstLossTick !== null
                ? `, first at ${seconds(bot.firstLossTick)}`
                : ""}
            </p>
            <ul style={{ margin: 0, padding: 0 }}>
              {bot.parts.map((part) => (
                <PartRow
                  key={part.iid}
                  part={part}
                  nameOfEnemyPart={(iid) =>
                    nameLookup[1 - index].get(iid) ?? iid
                  }
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {teardown.hardestHits.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: "0.85rem" }}>
            Hardest hits
          </h3>
          <ol
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: "0.72rem",
              opacity: 0.85,
            }}
          >
            {teardown.hardestHits.map((hit) => (
              <li
                key={`${hit.tick}-${hit.victimIid}-${hit.attackerIid}`}
                data-testid="teardown-hardest-hit"
              >
                {seconds(hit.tick)}: {teardown.bots[hit.attackerBot].name}
                {"'s "}
                {hit.attackerPartName} hit {hit.victimPartName} for{" "}
                {Math.round(hit.damage)} ({Math.round(hit.force)} N
                {hit.weapon ? ", weapon" : ""})
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
