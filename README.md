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
pnpm test:e2e:critical # critical Playwright smoke for every CI push
pnpm test:e2e         # playwright smoke, local defaults to 2 file-level workers (run pnpm build first)
pnpm ci:inventory     # validate and list stable Playwright case metadata
pnpm check:dashes     # AGENTS.md Rule 1 (no em/en-dashes)
pnpm check:purity     # src/sim determinism contract
pnpm ops:check-account-env # non-secret Clerk readiness preflight
```

## Environment variables

Set on the Vercel project (the dashboard or CLI), never committed:

- `DATABASE_URL` and friends: auto-provisioned by the dedicated Neon Postgres marketplace integration (Rule 11: one backing store per project, never shared). Created as sensitive values, so they are injected at deploy time and do not `vercel env pull` locally; local dev without them degrades to 503 "storage not configured" on persistence routes.
- `AUTH_SECRET`: HMAC secret for the signed guest cookie (Production + Preview).
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`: Clerk project keys for the approved Google sign-in integration. Local development keys can be pulled by the Clerk CLI into ignored `.env.local`; production keys should come from the Vercel project integration or dashboard. Guest-first play and local saves still work without them because the Clerk provider and proxy are guarded. Ready setup requires `@clerk/nextjs`, a publishable key that starts with `pk_test_` or `pk_live_`, and a secret key that starts with `sk_test_` or `sk_live_`.
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`: public Clerk sign-in entrypoint used by the mine Account dialog. Set to `/sign-in` when Clerk keys are present so the Account dialog can create a one-time handoff before opening Clerk.
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL`: leave unset for the first VibeBots account-sync release. `/sign-in` is the single sign-in-or-up page, keeping account creation on the same handoff path as sign-in.
- `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`: Clerk fallback for direct sign-in visits without a one-time handoff. Set to `/mine?account=1` only after the Clerk provider is wired, so those visits return to the Account dialog.
- `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`: Clerk fallback for account creation reached from the sign-in component without a one-time handoff. Set to `/mine?account=1` with the sign-in fallback so completed account creation returns to the Account dialog.
- `NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL`, `CLERK_SIGN_IN_FORCE_REDIRECT_URL`, and `CLERK_SIGN_UP_FORCE_REDIRECT_URL`: leave unset for VibeBots account sync. Force redirects bypass the one-time account handoff token and the preflight rejects them when present.
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`, `CLERK_AFTER_SIGN_IN_URL`, and `CLERK_AFTER_SIGN_UP_URL`: leave unset. Clerk marks these redirect variables deprecated for new apps, and VibeBots uses the fallback redirect variables instead.
- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`: Web Push keys for native browser release notifications. Generate and store them with `pnpm ops:setup-push-env -- --production-only`; keep the private key secret.
- `WEB_PUSH_CONTACT_EMAIL`: optional contact email for the Web Push VAPID subject. Defaults to `support@randroid.dev`.
- `NOTIFICATION_ADMIN_TOKEN`: bearer token required by `POST /api/notifications/release`, the manual fallback for dispatching the current release summary to enabled subscriptions. Normal release dispatch is triggered idempotently by the no-store `/api/version` check when storage and Web Push keys are configured.

## Operations

### Production verification

Production Vercel URLs can be protected by Vercel authentication or bot checks before the request reaches VibeBots. A fresh headless Playwright context, `curl`, or plain `fetch` may see a Vercel login or security checkpoint instead of the app.

For normal closeout, verify production readiness with GitHub deployment status and Vercel CLI or API metadata tied to the pushed commit sha:

```bash
gh api -X GET repos/Randroids-Dojo/VibeBots/deployments -f sha=<sha>
gh api repos/Randroids-Dojo/VibeBots/deployments/<deployment-id>/statuses
vercel inspect <deployment-url>
vercel ls vibe-bots
```

Use local `next start`, preview CI, or GitHub Actions for Playwright app smoke coverage. Only automate production UI when the slice explicitly needs production playtest evidence, and use an authenticated real browser context for that run.

### Native release notifications

Fresh worktrees need the ignored Vercel project link before using Vercel env commands:

```bash
ln -sfn /Users/randroid/Documents/Dev/VibeBots/.vercel .vercel
# or, when that source is unavailable:
vercel link --yes --project vibe-bots
```

Do not copy `.env` files between worktrees. They may contain secrets and are not needed for production env setup.

To generate and store a fresh production VAPID pair plus the admin fallback token without printing secret values:

```bash
pnpm ops:setup-push-env -- --production-only
vercel redeploy <latest-production-deployment-url> --target production
```

The helper passes values through stdin and suppresses Vercel CLI diagnostics so generated secrets do not appear in argv or command output. After redeploy, verify without printing keys:

```bash
node -e "fetch('https://vibe-bots.vercel.app/api/notifications/config').then(r=>r.json()).then(j=>console.log({configured:j.configured, hasVapidPublicKey: Boolean(j.vapidPublicKey), releaseNoticeId:j.releaseNoticeId}))"
```

Expected result: `configured: true`, `hasVapidPublicKey: true`.

Mine cash-out monitoring uses structured JSON logs from
`src/server/monitoring.ts`. Warning and error events include `source`
(`"vibebots"`), `component` (`"mine.cash_out"`), `alert` (`true`), a stable
`event` name, safe request context, and a hashed player identifier when an
existing player cookie is available. Configure Vercel log drains or log-based
alerts on these events:

- `mine.cash_out.invalid_json_body`
- `mine.cash_out.request_validation_failed`
- `mine.cash_out.storage_not_configured`
- `mine.cash_out.consumables_not_owned`
- `mine.cash_out.gear_not_owned`
- `mine.cash_out.mine_version_mismatch`
- `mine.cash_out.no_mine_on_file`
- `mine.cash_out.player_not_found`
- `mine.cash_out.trip_already_cashed_out`
- `mine.cash_out.wrong_mine_seed`
- `mine.cash_out.legacy_support_reconciled`
- `mine.cash_out.cash_out_failed`

Successful sells emit `mine.cash_out.cash_out_succeeded` with `alert=false`.
Use it to correlate a player hash, seed, trip index, credited value, charged
consumables, and remaining stock without paging on normal traffic.

Mine performance samples are stored in `player_performance_samples`. The
client records compact frame percentiles from real browser play, plus renderer
mode, draw calls, viewport size, device pixel ratio, hardware hints, app
version, mine version, user agent, and active player id. Use this table to
triage low-frame or glitch reports from old laptops and compare them by
renderer, DPR, viewport, and p95 frame time.

Balance tuning events are stored in `player_balance_events`. Each row belongs
to one player and records app version, mine version, event name, and compact
JSON properties. Use this append-only stream to tune progression by aggregating
events such as `mine.cash_out`, `gear.upgrade`, `consumable.purchase`,
`base_part.purchase`, `elevator.upgrade`, and `bunker.raid_reward`.

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

For a known affected player whose local in-flight trip checkpoint is stale after
a mine-version bump, repair the stored replay guard explicitly instead of
changing payout rules:

Run it with `DATABASE_URL` set for the target database. For production, prefer
`vercel env run -e production -- pnpm ops:repair-stale-trip -- ...` so the
connection string is loaded from Vercel and not copied into the shell history.

```sh
pnpm ops:repair-stale-trip -- --player-hash <log-player-hash> --expected-seed <seed> --expected-trip-index <count>
pnpm ops:repair-stale-trip -- --player-hash <log-player-hash> --expected-seed <seed> --expected-trip-index <count> --apply
```

The command dry-runs by default and only advances `mine_worlds.trip_count` from
the exact expected value to expected + 1 when the seed also matches. It never
changes the durable mine diff, gear, wallet, inventory, achievements, parts,
designs, or saved bots.

### Account sign-in preflight

After the approved Clerk SDK slice, run the non-secret preflight with the target
environment loaded before treating account sync as ready:

```sh
pnpm ops:check-account-env -- --require-ready --google-scopes "openid email profile"
```

For local development, `clerk doctor` verifies the Clerk CLI login, linked app,
and ignored `.env.local` key presence without printing key values. Production is
not ready until the production Clerk instance and Vercel project env are
configured.

For test coverage of the preflight itself, use fake key-shaped values rather
than real secrets:

```sh
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_fake CLERK_SECRET_KEY=sk_test_fake NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL='/mine?account=1' NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL='/mine?account=1' pnpm ops:check-account-env -- --require-ready --google-scopes "openid email profile"
```

The command prints booleans, issue codes, and the required identity scope list
only. It never prints Clerk key values. Ready setup requires
`NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` and
`NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/mine?account=1` and
`NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/mine?account=1`, with
`NEXT_PUBLIC_CLERK_SIGN_UP_URL`, public and server Clerk force redirect env
vars, and public and server deprecated after redirect env vars unset.

## Project docs

- `AGENTS.md`: rules for all agentic tools working in this repo
- `docs/gdd/`: the Game Design Document (source of truth for what VibeBots is)
- `docs/research/account-sync-google-signin.html`, `docs/research/account-sync-clerk-vercel-setup.html`, `docs/research/account-link-vibekit-extraction.html`: optional Google sign-in design, Clerk setup checklist, and VibeKit extraction contract
- `docs/IMPLEMENTATION_PLAN.html`, `docs/WORKING_AGREEMENT.html`: the loop and process contracts (Mainline Integration records the continuous-mainline decision: auto-merge on the required gate, post-merge tripwires, fix-forward repair)
- `docs/CI_WORKFLOW.html`: parallel CI, critical smoke, full smoke, the mainline health tripwire, and superseded-run policy
- `docs/MAINLINE_REVIEW_LOG.html`: post-merge adversarial review cursor (replaces pre-merge bot review)
- `docs/ci-rewrite-prompt.md`, `docs/CI_REWRITE_OWNER_QUESTIONS.html`: staged CI migration design and owner decisions that would otherwise pause it
- `src/lib/app-release-notes.ts`: player-facing release notes shown in game (`docs/RELEASE_NOTES.html` is a frozen pre-0.1.259 archive, not maintained)
- `docs/PROGRESS_LOG.html`, `docs/GDD_COVERAGE.json`, `docs/OPEN_QUESTIONS.html`, `docs/FOLLOWUPS.html`, `docs/DEPENDENCY_LEDGER.html`: continuity ledgers
- `.dots/`: task backlog (HTML Dots, `dot-html` CLI)
