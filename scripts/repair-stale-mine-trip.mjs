#!/usr/bin/env node
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const PLAYER_HASH_LENGTH = 16;

function usage() {
  console.error(`usage:
  pnpm ops:repair-stale-trip -- --player-hash <hash> --expected-seed <seed> --expected-trip-index <count> [--apply]
  pnpm ops:repair-stale-trip -- --player-id <uuid> --expected-seed <seed> --expected-trip-index <count> [--apply]

Dry-run is the default. The repair only advances mine_worlds.trip_count
from the exact expected value to expected + 1, and only when the stored
seed also matches. It never changes the durable mine diff, gear, wallet,
inventory, achievements, parts, designs, or saved bots.`);
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

function readIntArg(name) {
  const raw = readArg(name);
  if (raw === null) throw new Error(`${name} is required`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function readPlayerHash() {
  const raw = readArg("--player-hash");
  if (raw === null) return null;
  const hash = raw.toLowerCase();
  if (hash.length !== PLAYER_HASH_LENGTH || !/^[0-9a-f]+$/.test(hash)) {
    throw new Error(
      `--player-hash must be a ${PLAYER_HASH_LENGTH}-character hex hash`,
    );
  }
  return hash;
}

function safeNonNegativeInt(value, name) {
  const text = typeof value === "bigint" ? value.toString() : String(value);
  if (!/^\d+$/.test(text)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${name} is outside JavaScript's safe integer range`);
  }
  return number;
}

function playerHash(playerId) {
  return createHash("sha256")
    .update(playerId)
    .digest("hex")
    .slice(0, PLAYER_HASH_LENGTH);
}

async function findPlayer(sql, playerId, hash) {
  if (playerId) {
    const rows = await sql`
      SELECT p.id, mw.seed, mw.trip_count
      FROM players p
      LEFT JOIN mine_worlds mw ON mw.player_id = p.id
      WHERE p.id = ${playerId}`;
    return rows[0] ?? null;
  }

  const rows = await sql`
    SELECT p.id, mw.seed, mw.trip_count
    FROM players p
    LEFT JOIN mine_worlds mw ON mw.player_id = p.id
    WHERE substring(encode(sha256(convert_to(p.id::text, 'UTF8')), 'hex') from 1 for ${PLAYER_HASH_LENGTH}) = ${hash}`;
  if (rows.length > 1) {
    throw new Error(`player hash ${hash} matched more than one row`);
  }
  return rows[0] ?? null;
}

async function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }
  const apply = process.argv.includes("--apply");
  const playerId = readArg("--player-id");
  const hash = readPlayerHash();
  if ((playerId && hash) || (!playerId && !hash)) {
    throw new Error("provide exactly one of --player-id or --player-hash");
  }
  const expectedSeed = readIntArg("--expected-seed");
  const expectedTripIndex = readIntArg("--expected-trip-index");
  const nextTripIndex = expectedTripIndex + 1;
  if (!Number.isSafeInteger(nextTripIndex)) {
    throw new Error("--expected-trip-index is too large to advance safely");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const sql = neon(databaseUrl);
  const player = await findPlayer(sql, playerId, hash);
  if (!player) throw new Error("player not found");
  if (player.seed === null || player.trip_count === null) {
    throw new Error("player has no mine world row");
  }

  const before = {
    seed: safeNonNegativeInt(player.seed, "stored seed"),
    tripIndex: safeNonNegativeInt(player.trip_count, "stored trip_count"),
  };
  const matches =
    before.seed === expectedSeed && before.tripIndex === expectedTripIndex;
  const plan = {
    dryRun: !apply,
    playerHash: playerHash(player.id),
    expected: {
      seed: expectedSeed,
      tripIndex: expectedTripIndex,
    },
    before,
    after: matches ? { ...before, tripIndex: nextTripIndex } : before,
    changed: matches,
  };

  if (!apply || !matches) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const rows = await sql`
    UPDATE mine_worlds
    SET trip_count = ${nextTripIndex},
        updated_at = now()
    WHERE player_id = ${player.id}
      AND seed = ${expectedSeed}
      AND trip_count = ${expectedTripIndex}
    RETURNING seed, trip_count`;
  if (rows.length !== 1) {
    throw new Error("guarded update changed no rows");
  }
  console.log(
    JSON.stringify(
      {
        ...plan,
        dryRun: false,
        stored: {
          seed: safeNonNegativeInt(rows[0].seed, "updated seed"),
          tripIndex: safeNonNegativeInt(
            rows[0].trip_count,
            "updated trip_count",
          ),
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
