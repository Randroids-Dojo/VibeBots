#!/usr/bin/env node
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const MAX_LADDER_TARGET = 32;
const MAX_PLANK_TARGET = 16;

function usage() {
  console.error(`usage:
  pnpm ops:repair-support -- --player-hash <hash> --ladder <count> --plank <count> [--apply]
  pnpm ops:repair-support -- --player-id <uuid> --ladder <count> --plank <count> [--apply]

Dry-run is the default. Use --apply only after reviewing the planned update.
Only ladder_count and plank_count can be raised. Paid consumables, vibes,
resources, gear, mine worlds, and trip counters are never changed.`);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

function readTarget(name, max) {
  const raw = readArg(name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${name} must be an integer from 0 to ${max}`);
  }
  return value;
}

function playerHash(playerId) {
  return createHash("sha256").update(playerId).digest("hex").slice(0, 16);
}

async function findPlayer(sql, playerId, hash) {
  if (playerId) {
    const rows = await sql`
      SELECT id, ladder_count, plank_count
      FROM players
      WHERE id = ${playerId}`;
    return rows[0] ?? null;
  }

  const rows = await sql`
    SELECT id, ladder_count, plank_count
    FROM players`;
  const matches = rows.filter((row) => playerHash(row.id) === hash);
  if (matches.length > 1) {
    throw new Error(`player hash ${hash} matched more than one row`);
  }
  return matches[0] ?? null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const playerId = readArg("--player-id");
  const hash = readArg("--player-hash");
  const ladderTarget = readTarget("--ladder", MAX_LADDER_TARGET);
  const plankTarget = readTarget("--plank", MAX_PLANK_TARGET);

  if (process.argv.includes("--help")) {
    usage();
    return;
  }
  if ((playerId && hash) || (!playerId && !hash)) {
    throw new Error("provide exactly one of --player-id or --player-hash");
  }
  if (ladderTarget === null && plankTarget === null) {
    throw new Error("provide --ladder, --plank, or both");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const sql = neon(databaseUrl);
  const player = await findPlayer(sql, playerId, hash);
  if (!player) {
    throw new Error("player not found");
  }

  const before = {
    ladder: Number(player.ladder_count),
    plank: Number(player.plank_count),
  };
  const target = {
    ladder: ladderTarget ?? before.ladder,
    plank: plankTarget ?? before.plank,
  };
  const after = {
    ladder: Math.max(before.ladder, target.ladder),
    plank: Math.max(before.plank, target.plank),
  };
  const plan = {
    dryRun: !apply,
    playerHash: playerHash(player.id),
    before,
    target,
    after,
    changed: after.ladder !== before.ladder || after.plank !== before.plank,
  };

  if (!apply || !plan.changed) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const rows = await sql`
    UPDATE players
    SET ladder_count = GREATEST(ladder_count, ${after.ladder}),
        plank_count = GREATEST(plank_count, ${after.plank})
    WHERE id = ${player.id}
    RETURNING ladder_count, plank_count`;
  console.log(
    JSON.stringify(
      {
        ...plan,
        dryRun: false,
        stored: {
          ladder: Number(rows[0].ladder_count),
          plank: Number(rows[0].plank_count),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exit(1);
});
