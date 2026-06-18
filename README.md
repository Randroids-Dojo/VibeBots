# VibeBots

VibeBots is an online autonomous robot battler with a mining-driven economy. Players dig for resources, buy or discover modular robot parts, build bots in a connector-based workshop, then watch those bots fight CPU bots or other player-built bots without direct control.

## Stack

- Next.js 16 (App Router, TypeScript strict, Turbopack) on Vercel, pnpm
- three.js via `three/webgpu` (WebGPURenderer, automatic WebGL2 fallback) + react-three-fiber 9
- Rapier 3D physics: `@dimforge/rapier3d-deterministic-compat`, exact-pinned, identical WASM build in the browser and in Vercel Node functions
- VibeKit (`@randroids-dojo/vibekit`, tag-pinned) for seeded rng, math, storage, and server helpers
- Biome 2 (lint + format), Vitest 4 (unit), Playwright (e2e smoke)

The core architectural bet is hybrid match authority: the browser previews matches with a local deterministic sim, and the server reruns the exact same sim to produce the official result. `GET /api/sim/verify?seed=42&steps=600` returns the world snapshot hash; it must match what any other machine computes for the same inputs.

## Development

```bash
pnpm install
pnpm dev              # dev server at http://localhost:3000
pnpm test             # unit tests (incl. sim determinism)
pnpm typecheck        # next typegen + tsc --noEmit
pnpm lint             # biome ci
pnpm build            # production build
pnpm test:e2e         # playwright smoke (builds must exist: run pnpm build first)
pnpm check:dashes     # AGENTS.md Rule 1 (no em/en-dashes)
pnpm check:purity     # src/sim determinism contract
```

## Environment variables

Set on the Vercel project (the dashboard or CLI), never committed:

- `DATABASE_URL` and friends: auto-provisioned by the dedicated Neon Postgres marketplace integration (Rule 11: one backing store per project, never shared). Created as sensitive values, so they are injected at deploy time and do not `vercel env pull` locally; local dev without them degrades to 503 "storage not configured" on persistence routes.
- `AUTH_SECRET`: HMAC secret for the signed guest cookie (Production + Preview).

## Operations

Mine cash-out monitoring uses structured JSON logs from
`src/server/monitoring.ts`. Warning and error events include `source`
(`"vibebots"`), `component` (`"mine.cash_out"`), `alert` (`true`), a stable
`event` name, and a hashed player identifier. Configure Vercel log drains or
log-based alerts on these events:

- `mine.cash_out.consumables_not_owned`
- `mine.cash_out.gear_not_owned`
- `mine.cash_out.wrong_mine_seed`
- `mine.cash_out.legacy_support_reconciled`
- `mine.cash_out.cash_out_failed`

For a known affected long-running player whose client support snapshot drifted,
repair stored support stock explicitly instead of adding runtime replay
exceptions:

```sh
pnpm ops:repair-support -- --player-hash <log-player-hash> --ladder <count> --plank <count>
pnpm ops:repair-support -- --player-hash <log-player-hash> --ladder <count> --plank <count> --apply
```

The command dry-runs by default and only raises `ladder_count` and
`plank_count`. It never changes vibes, resources, gear, paid consumables, mine
worlds, or trip counters.

## Project docs

- `AGENTS.md`: rules for all agentic tools working in this repo
- `docs/gdd/`: the Game Design Document (source of truth for what VibeBots is)
- `docs/IMPLEMENTATION_PLAN.html`, `docs/WORKING_AGREEMENT.html`: the loop and process contracts
- `docs/RELEASE_NOTES.html`: versioned release notes
- `docs/PROGRESS_LOG.html`, `docs/GDD_COVERAGE.json`, `docs/OPEN_QUESTIONS.html`, `docs/FOLLOWUPS.html`, `docs/DEPENDENCY_LEDGER.html`: continuity ledgers
- `.dots/`: task backlog (HTML Dots, `dot-html` CLI)
