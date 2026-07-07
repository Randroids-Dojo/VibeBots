# AGENTS.md

Shared rules for every agentic coding tool working in VibeBots. Claude Code, Codex, Cursor, and any future agent: this file is mandatory reading before you write anything.

This repo uses the HTML-first variant of the spiral scaffold. The ledgers and contracts under `docs/` are `.html` files. This file (`AGENTS.md`) and `CLAUDE.md` stay as Markdown so Codex's root-down walk and Claude Code's project-memory import keep working.

Task tracking uses the HTML-backed Dots fork: the `dot-html` CLI (skill `task-tracking-dots-html`), which stores work items as `.html` files under `.dots/`. Do NOT use the Markdown `dot` CLI (skill `task-tracking-dots`) on this project, even if it is also installed. If only the Markdown variant is present, install the HTML fork first (`task-tracking-dots-html` ships an installer); do not silently fall back to Markdown dots.

Project pitch: VibeBots is an online autonomous robot battler with a mining-driven economy. Players dig for resources, buy or discover modular robot parts, build bots in a connector-based workshop, then watch those bots fight other player-built bots without direct control.

---

## RULE 1: NEVER USE EM-DASHES. EVER.

No em-dashes. Not in chat. Not in code comments. Not in commit messages. Not in PR descriptions. Not in docs. Not in test names. Not anywhere.

Use a period, comma, colon, parentheses, or rewrite the sentence. En-dashes are not substitutes. Plain hyphens are fine for ranges like `pages 10-20` and compound words.

Before every tool call that writes text, scan your output for Unicode codepoints U+2014 (em-dash) and U+2013 (en-dash). Rewrite if either is present.

If porting or quoting text from another source, strip all em-dashes from the ported text before committing.

---

## RULE 2: Read the GDD before making design decisions

The Game Design Document at `docs/gdd/` is the source of truth for what VibeBots is. Before proposing architecture, adding features, or changing data schemas, read it. If the GDD and your idea disagree, the GDD wins unless explicitly approved.

Before each implementation slice, read:

- `AGENTS.md`
- `README.md`
- `docs/IMPLEMENTATION_PLAN.html`
- `docs/WORKING_AGREEMENT.html`
- `docs/gdd/` (the relevant requirement files)
- `docs/PROGRESS_LOG.html`
- `docs/OPEN_QUESTIONS.html`
- `docs/FOLLOWUPS.html`
- `docs/GDD_COVERAGE.json`
- `docs/DEPENDENCY_LEDGER.html` (and run the Dependency Upgrade Gate from `docs/IMPLEMENTATION_PLAN.html`)
- `docs/CI_WORKFLOW.html` when touching CI, verification policy, release process, or monitoring behavior
- `docs/PART_ART_PIPELINE.html` when touching bot part geometry, materials, or any 3D part art (render-only over unchanged colliders; also the Fable 5 3D-art workflow)
- `docs/PLAYTEST.html` and `docs/FUN_FACTOR_AUDIT.html` when coverage is >=80% done
- the current task backlog (HTML Dots via `dot-html`, stored under `.dots/`)

### Path-scoped Rules

Four additional rule files live under `.claude/rules/`. They are loaded automatically:

- **Claude Code** loads them based on the `paths:` glob in their frontmatter.
- **Codex** loads them via per-directory `AGENTS.md` symlinks (`docs/AGENTS.md`, `docs/gdd/AGENTS.md`) on its root-down walk.

The five rules:

- `.claude/rules/slice-discipline.md` (paths: source-code globs): no drive-by refactors, no speculative abstractions, refactor-in-slice.
- `.claude/rules/ledger-append-only.md` (paths: the four ledger files): never delete past entries.
- `.claude/rules/gdd-build-log.md` (paths: GDD section files): append a build log entry on every shipped feature.
- `.claude/rules/part-visuals.md` (paths: the part geometry/material files and `src/sim/parts.ts`): bot part art is render-only geometry over unchanged physics colliders; never reshape a part by editing its collider. Full pipeline in `docs/PART_ART_PIPELINE.html`.
- `.claude/rules/frame-loop-performance.md` (paths: canvas and render-loop files): per-frame code must not allocate. Real-phone telemetry traced 1-6 second freezes to GC pauses from frame-loop garbage (F-074); the rule lists the known allocation patterns, the scratch-object idioms that replace them, and the measurement scripts (`scripts/measure-heap-churn.mjs`, `scripts/profile-allocations.mjs`) plus the telemetry A/B (`/api/performance/insights?device=real`, `byBuild`) that verify a render slice before and after it ships. Codex and other root-walk agents: read that file whenever a slice touches a `useFrame` path; it is not symlinked into `src/`.

When you add a source directory (`src/`, `app/`, `lib/`, `components/`, `pages/`, `tests/`, etc.) to this project, run this once to make slice-discipline visible to Codex inside that tree:

```
ln -sf ../.claude/rules/slice-discipline.md <src-dir>/AGENTS.md
```

Claude Code already picks up slice-discipline by path glob without the symlink.

---

## RULE 3: Stack constraints

Decided 2026-06-10 (walking-skeleton slice):

- **App**: Next.js 16 App Router on Vercel (Fluid Node runtime), TypeScript strict, React 19, pnpm. Turbopack default.
- **Rendering**: three (via `three/webgpu`: WebGPURenderer with automatic WebGL2 fallback, TSL for materials and postprocessing) + `@react-three/fiber` 9 + `@react-three/drei`. R3F canvases are client components dynamically imported with `ssr: false`. Do NOT use the WebGL-only pmndrs `postprocessing` packages; use three's native TSL post-processing.
- **Physics**: `@dimforge/rapier3d-deterministic-compat`, EXACT-pinned (never caret), the same package on client and server. Do not swap variants (simd, non-compat) and do not use `@react-three/rapier` for the authoritative sim.
- **State**: zustand for UI/game state (added when the workshop slice needs it). Sim state never lives in React state.
- **Shared kit**: `@randroids-dojo/vibekit`, tag-pinned github dep (rng, math, storage, editor-history; server kv/sign/rate-limit). Listed in `transpilePackages` (it ships raw TS).
- **Storage**: one dedicated Neon Postgres via the Vercel marketplace UI when persistence lands (Rule 11). Replays are `{seed, design ids, simVersion}` re-simulated on demand, so no Blob store.
- **Auth**: guest-first via a VibeKit-signed httpOnly cookie; Clerk later (players table carries a nullable `clerk_user_id`).
- **Tooling**: Biome 2 (no ESLint/Prettier), Vitest 4, Playwright.

Determinism contract (hybrid match authority, Q-003):

- `src/sim` is pure TypeScript: no react/next/three/zustand imports. Enforced by a Biome override and `scripts/check-sim-purity.sh`.
- No `Math.random` and no transcendental `Math` calls (sin/cos/pow/log/etc.) in `src/sim`; results differ across JS engines. Arithmetic, `Math.sqrt`, `Math.imul`, floor/min/max/abs are fine. Randomness comes from VibeKit's seeded rng only.
- The browser previews with the local sim; a Vercel Node function (never edge) reruns the identical sim for the official result. World snapshot hashes (`fnv1a64(world.takeSnapshot())`) are the verification primitive.
- Any rapier bump, DT change, or world-construction change bumps `SIM_VERSION` in `src/sim/constants.ts`.

Do not introduce new dependencies in core categories without explicit user approval.

---

## RULE 4: Commit messages and PR descriptions

- Write them as a human would.
- No AI attribution. No `Co-Authored-By: Claude`. No "Generated with Claude Code" footers. No mention of Claude, Anthropic, or AI assistance.
- Keep them short, clean, professional. Focus on the why, not the what.

---

## RULE 5: Autonomous PR loop

Operate continuously until the planned scope is complete. The loop definition lives in `docs/IMPLEMENTATION_PLAN.html`. The process contract lives in `docs/WORKING_AGREEMENT.html`. Follow both on every slice.

For every slice:

1. Read the rule, plan, product, progress, question, followup, coverage, dependency-ledger, and backlog documents listed in Rule 2.
2. Run the Dependency Upgrade Gate (see `docs/IMPLEMENTATION_PLAN.html`). If a watched dep is out of date, the upgrade IS the next slice unless red CI takes over.
3. Pick the highest-priority unblocked task from the implementation plan, dep ledger, GDD coverage gaps, followups, and active backlog.
4. Create one branch for one PR-sized slice. Always fetch remote `main`, then rebase the new branch on `origin/main` before implementation. Never push directly to `main`.
5. Implement the slice fully using existing project patterns.
6. Add or update tests appropriate to the risk and surface area.
7. Update `docs/PROGRESS_LOG.html`, `docs/GDD_COVERAGE.json`, `docs/OPEN_QUESTIONS.html`, `docs/FOLLOWUPS.html`, `docs/DEPENDENCY_LEDGER.html`, and the GDD section when the work changes them.
8. Run the local verification suite. At minimum: dash checks, `git diff --check`, type-check, relevant unit tests, broader checks when warranted.
9. Re-run the Dependency Upgrade Gate before opening the PR. If a watched release landed while the slice was in flight, defer the bump to its own PR (do not bundle).
10. Open a PR.
11. Inspect all PR review comments, including inline and threaded comments from CodeRabbit or other review bots.
12. Fix actionable review comments, reply in-thread when the platform supports it, resolve threads when resolved.
13. After every push to the PR branch, wait for any configured bot reviewer to finish its review pass. The wait is settled only when the required parallel CI gate from `docs/CI_WORKFLOW.html` is green AND at least 60 seconds have passed since the latest PR branch push or latest bot review activity, whichever is later. Re-inspect reviews and review threads after the settled wait.
14. Wait for the required parallel CI gate and the preview deploy to pass. Run the full Playwright smoke suite locally or by manual dispatch when the touched surface warrants it.
15. Merge only when green, review feedback is handled, bot review has settled, and the preview deploy is healthy.
16. Pull `main`, verify the current remote tip's required parallel CI gate and production deploy, smoke test production.
17. Close the completed backlog item with the PR number and verification.
18. Immediately start the next slice.

Do not stop at planning. Do not stop after opening a PR. Do not stop after merge. If blocked, log the blocker, update the backlog item, move to the next unblocked slice.

Never mark work complete with failing tests, unresolved actionable review comments, a bot review still in flight after the latest push, a red required parallel CI gate on the current remote tip, or a broken deploy.

### Fresh worktree bootstrap

When the user asks for a fresh worktree, create it from the latest fetched `origin/main`, then make ignored operational metadata available before doing repo work:

1. Link the Vercel project in the new worktree. Prefer `ln -sfn /Users/randroid/Documents/Dev/VibeBots/.vercel .vercel` when that source exists. Otherwise run `vercel link --yes --project vibe-bots`.
2. Do not copy or symlink `.env`, `.env.local`, or other secret-bearing env files.
3. Run `pnpm install --frozen-lockfile` before type-checks or tests in a fresh worktree, because `node_modules` is ignored.
4. If production Web Push env vars need setup or rotation, use `pnpm ops:setup-push-env -- --production-only`. The script passes values through stdin, suppresses Vercel CLI secret diagnostics, and avoids printing generated values.

### Post-merge and direct-main CI monitoring

CI and deploy monitoring after merges or direct pushes is part of the slice, not an optional status check. Treat slow, stale, or confusing monitoring as a process bug to improve.

Required flow after any merge or direct push to `main`:

1. Record the exact pushed sha, then verify `git ls-remote origin refs/heads/main` matches it.
2. If `origin/main` moves while monitoring, fetch immediately and check whether the pushed sha is still contained in `origin/main`. If it is contained, stop waiting on cancelled or superseded runs for older heads and verify the newest remote tip's required parallel CI gate instead. If it is not contained, reconcile before claiming the work shipped. Report both facts separately: the pushed commit status and the current remote head status.
3. Track GitHub Actions by run id and head sha, not by branch name alone. Branch queries can silently switch to a newer push.
4. Track Vercel by commit sha through GitHub deployment status and Vercel CLI metadata. Do not use unauthenticated `curl`, `fetch`, or headless Playwright against production Vercel URLs as a deploy-readiness gate; protected targets can return a Vercel login or security checkpoint before the app. Use local or CI Playwright for app smoke coverage, and use a real authenticated browser context only when a slice explicitly needs production playtest evidence.
5. Use bounded polling with timestamps. Prefer a short loop that prints status, conclusion, head sha, and run URL. Avoid long noisy `gh run watch` output unless it is actively useful.
6. If `gh` auth fails, stop the failed loop and switch to the public GitHub REST endpoints when the repo is public. Do not keep retrying the same broken command.
7. When a run is slow, inspect the jobs endpoint to identify the active step. If logs are unavailable until completion, say that explicitly and keep polling the run conclusion.
8. Before final response, verify the latest `origin/main` head, whether the shipped commit is contained in it, Vercel deployment status for the latest head, production aliases from deployment metadata, notification config when relevant, and CI conclusion for the pushed sha or its superseding current-tip run. If `origin/main` advanced after the push, also verify the latest head's CI or state clearly that it is still running.

CI speed policy:

- Required CI is the parallel gate in `docs/CI_WORKFLOW.html`: quality, typecheck, unit tests, build, and sharded critical Playwright smoke.
- The full Playwright smoke matrix runs on schedule and manual dispatch. Run it locally or by manual dispatch for broad-risk slices that change shared UI shell behavior, cross-route storage state, release-note infrastructure, Playwright harness behavior, or equivalent surfaces.
- Do not block normal closeout on cancelled, superseded, or older in-progress workflow runs once the current `origin/main` tip contains the shipped commit and its required parallel gate is green.

Continuous improvement requirement:

- If CI monitoring takes unusual time, auth breaks, branch status shifts underfoot, production reports an older sha, or the final status is confusing, root cause the monitoring problem before closing the task.
- Document the prevention in `AGENTS.md` when it is a reusable workflow rule, or in the slice progress log when it is a one-off incident.
- Keep the closeout short, but include enough exact evidence that the next agent can resume without rediscovering which sha, run id, or deploy was being watched.

---

## RULE 6: Destructive and shared-system actions

Always confirm with the user before:

- `git push --force`, `git reset --hard`, `rm -rf`, dropping data stores, deleting files or branches.
- Direct pushes to `main` or any protected branch.
- Modifying CI/CD configuration.
- Uploading content to third-party services.

Prior approval for one destructive action is not approval for all of them. Ask each time.

---

## RULE 7: When in doubt, ask. And prefer simple consistent flows.

- When a UX decision could go branchy (different behavior per route, per state, per user), default to one consistent rule across all cases.
- Always explain why you are prompting the user for input.
- If requirements are ambiguous and a reasonable default would be risky, ask. Otherwise choose the simplest consistent path, document the assumption in `docs/OPEN_QUESTIONS.html` with a `Recommended default:`, ship under that default, and keep moving.

---

## RULE 8: Secrets and environment variables

- Never commit `.env`, `.env.local`, or any file containing credentials.
- Never print secret values in logs, chat, or commit messages.
- Document expected env vars in `README.md`. Set them in the deployment dashboard, not in the repo.

---

## RULE 9: Testing expectations

- New pure logic must have unit tests.
- New API routes must have at least one route-handler test plus one smoke test.
- Do not mark a task complete with failing tests.

### Local test isolation

- Local testing must not interrupt or attach to another agent's running server, browser, or test process.
- Do not kill processes on occupied ports unless you started that exact process in the current turn and can identify its session.
- Prefer fresh worktrees and isolated ports for every local server, Playwright run, smoke test, and preview check.
- The Playwright config chooses an isolated per-worktree port by default and refuses to reuse an existing local server. If you need to target a server manually, set `PLAYWRIGHT_BASE_URL` to a server you started for this run.
- Use `PLAYWRIGHT_PORT` for an explicit isolated port. Avoid shared defaults like `3000`, `3001`, or another agent's logged port.

## RULE 10: Motion and overlay QA

When adding auto-scrolling, credits, animated overlays, portals, or modal UI:

- Verify the visible pixels move, not just that a control says the animation is active.
- Add coverage that measures a changing DOM rect, transform, canvas pixel, or other observable movement over time.
- Do not pause auto-motion on focus by default. Focus can happen on mount and silently disable the feature.
- For modal overlays, set z-index above every fixed interactive app surface and confirm background controls cannot sit above the dialog.
- Preserve normal keyboard activation on focused buttons and form controls.
- Expose toggle state with `aria-pressed` or equivalent accessible state.

When adding text-like labels to a three/R3F canvas, especially the mine canvas:

- Normal DOM text in HUDs, menus, dialogs, sheets, and overlays is allowed and preferred for exact words and numbers.
- Do not use runtime 3D text renderers such as `@react-three/drei` `Text` or troika text inside the mine canvas without explicit approval. Mobile WebGL/WebGPU fallback paths can render failed glyph atlas quads as white squares.
- Prefer mesh markers, icons, controlled sprite atlases, or DOM overlays anchored outside the canvas. If exact in-world text is unavoidable, document why, add a mobile or narrow-viewport smoke test, and sample canvas pixels for white-card artifacts.
- When investigating a white square or card that follows the player, search first for in-scene text, sprite, or texture atlas paths before tuning lights or materials.

---

## RULE 11: One backing store per project

Every Vercel project gets its own dedicated storage resources. Never share an Upstash KV, Postgres, Blob, or any other backing store across projects, even when key-prefix or schema namespacing would prevent collisions.

Why:

- Shared rate limits. One project's runaway loop pressures the other's ceiling.
- Shared billing. Cost attribution becomes impossible.
- Shared rotation. A token leak in one project forces every co-tenant to redeploy.
- Shared blast radius on outages. A misconfigured PUT in one project can fill the other's storage budget.

How:

- Provision storage via the Vercel marketplace UI before wiring code that needs it. The CLI does not expose marketplace provisioning; this is one of the few setup steps that lives in the dashboard.
- After provisioning, attach the resource to exactly one Vercel project. Never use `vercel env add` to copy another project's connection string into this project.
- The first env vars on a fresh project should come from the project's own provisioned store, not from another project's `.env.local`.
- Local dev pulls from the project's own Vercel env via `vercel env pull` (which respects the project link in `.vercel/project.json`).

If you find yourself about to run `vercel env add KV_REST_API_URL` with a value that came from another project's env, stop. Provision a dedicated store first.

---

## RULE 12: VibeReview playtest evidence

VibeReview (skill `randroid:vibereview`) is the qualitative-gate evidence pipeline for this project. The mining overhaul (PRs #16-#24) is the reference run; its session lives at `docs/reviews/20260610-220517-4C845606/`. Follow this shape for future feature loops.

### The loop shape that works

1. **Baseline playtest before design.** Play the current production feature with a scripted Playwright driver (see `scripts/playtest-mine*.mjs` for patterns), save screenshots into the session's `captures/` dir, and capture findings as VibeReview notes. The captures become `F-NNN` followups; those followups become the slice backlog.
2. **One confirmation pass per merged slice.** Re-run a scripted playtest against production after each slice deploys, confirm the specific followups it claimed to fix, and record the confirmation in `docs/FUN_FACTOR_AUDIT.html` (append a dated article; never edit old ones).
3. **Final audit with a verdict.** When the feature's coverage rows are done, re-run the audit prompts honestly and write the verdict. Anything still weak becomes a new followup, not a softened answer.

### Tool mechanics and traps

- **CLI path:** never run bare `vibereview` (it can launch the GUI app). Use the standalone binary, normally `../VibeReview/.build/reinstall/vibereview`. The skill's preflight snippet finds it.
- **Sessions are sticky:** `start` reattaches to the existing per-project session regardless of the `--title` you pass. The title is cosmetic; captures still land in this project's ledgers. Do not fight it.
- **Captures screenshot the reviewer's desktop, not the game.** The capture bridge talks to the live Chrome session (port 37717), so the UUID-named `captures/*.png` and the `browserTitle`/`browserURL` fields record whatever the human had on screen. That is private data. After every capture batch: delete the UUID PNG/browser.json files, repoint the generated PLAYTEST/FOLLOWUPS entries (Context, Screenshot, URL fields and the session html figures) at the scripted-run screenshots, and blank `browserTitle`/`browserURL` in `session.json`. Never commit desktop screenshots.
- **Real evidence comes from the Playwright run itself.** Have the driver save named screenshots (`confirm-*.png`, `juice-*.png`) into the same `captures/` dir and reference those from ledger entries.
- **Port 37717 conflict:** if the VibeReview GUI app is running, `capture` fails outright. Do not kill the user's app; append the evidence articles to `docs/PLAYTEST.html` manually in the same format and note the manual capture in the entry.
- **Inspect the diff before committing.** VibeReview auto-writes `F-NNN` followups and PLAYTEST articles from captures. Fix junk fields (wrong session labels, dead links) while the entries are still uncommitted; once committed they are append-only history.

### Scripted playtest drivers

- **Autonomous soak**: `node scripts/autoplay-mine.mjs <out-dir> [actions]` plays a seeded, policy-driven guest session against an isolated local server (build first), checks invariants after every action (HUD readable, canvas alive, no stuck states the game's own escape valve cannot clear), and exits nonzero with screenshots plus `autoplay-report.json` on any anomaly or console error. `AUTOPLAY_SEED` reproduces a session; `AUTOPLAY_BASE` targets an existing server. Run it after risky mine slices as a soak beyond the scripted e2es.

- Verify moves against HUD numbers (energy always drops on a real action, depth is exact), never against full status-text diffs; render lag desyncs text comparisons.
- Production sits behind Vercel bot protection. Do not point the standard Playwright test suite at production with `PLAYWRIGHT_BASE_URL`; it creates a fresh unauthenticated context and may only prove that Vercel showed a login page. Use a real authenticated browser context with `waitForSelector` and a generous timeout for the app shell when a slice explicitly needs production playtest evidence. Do not hammer `curl` at the page, because it can trigger the security checkpoint for the whole IP and block headless runs too. For deploy-readiness checks, poll Vercel or GitHub deployment metadata for the commit sha instead of scraping HTML.
- Prove motion per Rule 10 with consecutive-frame screenshot diffs after an input.
- Assert the presence of UI controls a slice claims to add (a scripted edit once shipped without its buttons; only an instrumented production run caught it). Pin such controls in the Playwright smoke afterward.

---

## RULE 13: Game tips are versioned copy

The mine surface tips in `src/components/mine-panel.tsx` are player-facing release copy, not throwaway helper text.

For every package version bump or app release note update:

- Review the full tip rotation.
- Remove tips that are stale, misleading, redundant, or too narrow for the current build.
- Update any tip affected by the release, especially mechanics, economy, controls, upgrades, hazards, shops, and recovery rules.
- Add a concise new tip when the release changes a player-facing mine rule that players may need to remember.
- Keep tips one-line and action-oriented. Do not turn them into tutorials or patch notes.
- Record the tip review in the slice's progress-log entry, even when no tip text changed.

If a version bump does not touch mining, still do the review and record that tips were checked with no changes needed.

---

## RULE 14: Review stamps for new features

The Stamp Book is the long-term cosmetic goal layer. When a slice adds or meaningfully changes a player-facing feature, review whether it should add one or more stamps.

Add stamps when they make the feature more legible, give players a clear optional goal, or mark a durable milestone they would be proud to collect. Prefer stamps for new mechanics, regions, progression gates, survival feats, feature mastery, and first-use moments.

Do not add stamps just because code changed. Avoid stamps for bug fixes, tiny UI polish, diagnostics, copy-only updates, or actions that would encourage unfun grinding.

Every new stamp must have a trustworthy progress source:

- Backfill from durable records when the server already stores proof.
- Start from new recorded counters when old profiles cannot prove it safely.
- Keep stamps cosmetic only. They must not grant vibes, gear, parts, consumables, luck, or combat power.
- Update `src/lib/achievements.ts`, the achievement tests, relevant server progress plumbing, GDD coverage, release notes, and the progress log.
- Record the stamp review in the slice's progress-log entry, even when no new stamp is added.

---

## Quick pre-commit checklist

1. No em-dashes. Run `grep -rnP '[\x{2014}\x{2013}]' .` (checks for U+2014 em-dash and U+2013 en-dash). Must return nothing.
2. No AI attribution in the commit message.
3. Tests pass locally.
4. GDD is still accurate, or updated.
5. No secrets in the diff.
6. If the diff touches a frame loop (`useFrame` or anything it calls), check it against `.claude/rules/frame-loop-performance.md` and run `scripts/measure-heap-churn.mjs` against a baseline when per-frame work changed.
