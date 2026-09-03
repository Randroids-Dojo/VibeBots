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
- `docs/MAINLINE_REVIEW_LOG.html` (the post-merge adversarial review cursor; run the review when it is behind `origin/main`)
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

### PR titles (added 2026-07-10 after user feedback)

- Lead with the outcome someone would notice, in plain words: "Fix the mine freezing on warps and long falls", not "Stream tunnel floors and darkness veils through the instanced grid". The mechanism belongs in the body.
- No internal tracker ids (`F-NNN`, `Q-NNN`), build numbers, version numbers, or codenames in the title. Reference them in the body.
- A title should make sense to someone reading the PR list a month later with no session context. If it only makes sense next to the ledgers, rewrite it.
- Never accept a defaulted title blindly. The GitHub compare page and `gh pr create --fill`/`--fill-first` all derive a default title from commit subjects (`--fill-first` specifically from the first commit), so a branch that opens with an investigation or docs commit gets a title describing that commit, not the change. Retitle the PR to describe the whole change before or right after opening it.
- The same outcome-first standard applies to commit subjects on `main`: this repo squash-merges with the PR title as the merge-commit subject, so the PR title is the permanent history line.

---

## RULE 5: Autonomous PR loop

Operate continuously until the planned scope is complete. The loop definition lives in `docs/IMPLEMENTATION_PLAN.html`. The process contract lives in `docs/WORKING_AGREEMENT.html`, whose Mainline Integration section is the standing decision behind this rule (adopted 2026-09-02 from the Cannonball-Vibe continuous-mainline contract, that repo's ADR-0025). Follow both on every slice.

For every slice:

1. Read the rule, plan, product, progress, question, followup, coverage, dependency-ledger, review-log, and backlog documents listed in Rule 2.
2. Check mainline health: `gh issue list --label red-main --state open`. If main is red, the repair is this session's slice; new work waits. The `Mainline health` workflow keeps that issue in sync with the latest completed CI on `main`, including the nightly Full E2E matrix, so this one command replaces listing runs by hand. Until the first health evaluation has run after adoption, or whenever `gh` cannot read issues, fall back to the manual scheduled-run check in `docs/CI_WORKFLOW.html` (Scheduled Run Visibility). Also read the production deployment state for the `origin/main` head (`gh api "repos/{owner}/{repo}/deployments?sha=<sha>&environment=Production"` and its statuses). A failed production deploy is red main too, even though the tripwire does not watch it yet (F-240).
3. Run the Dependency Upgrade Gate (see `docs/IMPLEMENTATION_PLAN.html`). If a watched dep is out of date, the upgrade IS the next slice unless red main takes over.
4. Run the post-merge adversarial review when the cursor in `docs/MAINLINE_REVIEW_LOG.html` is behind `origin/main`: read every squash commit since the cursor as if approving it, file findings as followups or open questions (never as merge blocks), confirm each merged PR's backlog item and ledger entry carry the PR number, and append a log entry. A finding makes the fix a candidate slice under normal priority; it does not reopen the PR.
5. Pick the highest-priority unblocked task from the implementation plan, dep ledger, GDD coverage gaps, followups, and active backlog.
6. Claim the slice before implementing. Check for an existing claim with `gh pr list --state open --search "<F-id or Q-id>"` (search covers PR bodies) and `git ls-remote origin 'refs/heads/*'` filtered for the id or slug; if another branch or PR already names the slice, select different work. Otherwise create one branch for one PR-sized slice from freshly fetched `origin/main`, push it, and open a draft PR as your first act: the draft PR is the claim. Put `Claims: F-NNN` (or the Q-id, or `none` plus a one-line scope) as the first line of the PR body, keep the title outcome-first per Rule 4, and put the id in the branch name when one exists. Never push directly to `main`.
7. Implement the slice fully using existing project patterns.
8. Add or update tests appropriate to the risk and surface area.
9. Update `docs/PROGRESS_LOG.html`, `docs/GDD_COVERAGE.json`, `docs/OPEN_QUESTIONS.html`, `docs/FOLLOWUPS.html`, `docs/DEPENDENCY_LEDGER.html`, and the GDD section when the work changes them. Close the backlog item in the same diff, citing the PR number; do not leave closure for a session that may never see the merge.
10. Run the local verification suite (`pnpm verify`, with `--build` for runtime-affecting slices). Run the full Playwright smoke suite locally or by manual dispatch when the touched surface warrants it; the merge gate does not run it.
11. Re-run the Dependency Upgrade Gate before marking the PR ready. If a watched release landed while the slice was in flight, defer the bump to its own PR (do not bundle).
12. Mark the PR ready and arm auto-merge: `gh pr merge <number> --auto --squash --subject "<title>" --body-file <path>`, after validating the squash text with `bash scripts/check-attribution.sh --message-file <path>`. Then move on; do not wait for the merge, the preview deploy, or a bot review. The only merge gates are the five required parallel CI contexts named in `docs/CI_WORKFLOW.html`. No human or service review happens before merge; CodeRabbit is retired. When `gh` is unavailable, enable auto-merge through the GitHub API or MCP equivalent. While the repository does not yet allow auto-merge (Q-038 open), merge yourself as soon as the required gate is green, with the same validated squash text and no bot-review wait.
13. If a human leaves review comments on an open PR of yours, treat them like any other user direction: fix, reply in-thread, resolve, and re-arm auto-merge if it dropped. There is no settled-wait for bots.
14. Immediately start the next slice at step 1. Step 2 on that pass is where a merge that broke `main` becomes visible, and repairing it outranks the slice you were about to pick.

Do not stop at planning. Do not stop after opening a PR. Do not stop after arming auto-merge. If blocked, log the blocker, update the backlog item, move to the next unblocked slice.

Never mark work complete with failing tests, unresolved actionable review comments from a human, a red required parallel CI gate on the PR head, or an open `red-main` issue that your merge caused.

### Stacked pull requests (added 2026-09-02)

Transitional. Once Q-038 is executed (auto-merge on the required gate), new slices branch from `origin/main` again and this section applies only while a stack opened before that is still landing.

When a session cannot merge (the main ruleset blocks a plain merge, auto-merge is off on the repository, and the administrator override is unavailable to the session), keep the loop moving with stacked branches: each slice branches from the previous slice's branch, its PR targets that branch, and GitHub retargets it to `main` as the one below it merges. The owner merges the stack bottom to top. Rules that keep the stack safe:

- Never rewrite a pushed branch (F-151, F-182). Carry a fix from a lower branch upward with a merge commit, never a rebase, and merge every branch below into every branch above it before opening the next PR. This is a manual stack held together by merge commits, not GitHub's native stacked pull request flow (which keeps a linear stack with cascading rebases); the repository squash-merges, so each PR lands as one commit whatever its branch history, and the no-rewrite rule above takes precedence over stack linearity.
- After every merge that touches `docs/PROGRESS_LOG.html`, count `<article` against `</article>` and `<dl>` against `</dl>` before committing. Two entries inserted at the same anchor on both sides share their closing tags as common context, so git resolves the conflict with one closing pair for two entries and the second entry nests inside the first. Insert the missing pair before the next `<article>`.
- A followup that a lower branch's ledger entry names must be defined on that branch (F-187), even when a higher branch already carries it: add the identical section at the identical anchor and the stacking merge sees the same hunk on both sides.
- Dependency bumps still land one per PR; stack them below the feature slices so they merge first.

### Patch scripts and Windows checkouts (added 2026-09-02)

- Write a multi-file edit as a script file and run it; read the script's own exit status before committing, and make anchors formatter-tolerant. A script that asserts on a line the formatter has since rewrapped stops halfway and leaves a commit missing its ledger entries; this happened twice in one session.
- Long bash heredocs with quoted delimiters can fail to parse on this Windows Git Bash. Keep heredocs short or use a script file.
- The dash check and the AGENTS link audit both fail on a Windows checkout for environmental reasons (two PNG binaries matched by the raw grep; the five rule symlinks checked out as plain files). Run a text-only scan (`grep -rnI` for U+2014 and U+2013) and record both as the F-224 and F-188 artifacts; both gates are green on CI.
- `dot-html` ships no Windows binary. Run the Linux release through WSL behind a wrapper that base64-packs the arguments (`wsl.exe` re-splits quoted arguments); the tracked `.dots/config` must be LF (a checkout from before the `.gitattributes` fix may still hold CRLF; a fresh worktree is fine).
- The whole workshop e2e file at four local workers can fail its timing-sensitive perf case by contention (F-240). Confirm a parallel-run failure with a serial rerun before treating it as a regression.

### Fresh worktree bootstrap

When the user asks for a fresh worktree, create it from the latest fetched `origin/main`, then make ignored operational metadata available before doing repo work:

1. Link the Vercel project in the new worktree. Prefer `ln -sfn /Users/randroid/Documents/Dev/VibeBots/.vercel .vercel` when that source exists. Otherwise run `vercel link --yes --project vibe-bots`.
2. Do not copy or symlink `.env`, `.env.local`, or other secret-bearing env files.
3. Run `pnpm install --frozen-lockfile` before type-checks or tests in a fresh worktree, because `node_modules` is ignored.
4. If production Web Push env vars need setup or rotation, use `pnpm ops:setup-push-env -- --production-only`. The script passes values through stdin, suppresses Vercel CLI secret diagnostics, and avoids printing generated values.

### Mainline health and repair

Integration is PR-only and merges exclusively through auto-merge on the required parallel gate. Everything else (the nightly Full E2E matrix, Preview Smoke, Functional Shadow, the render tier, the production deploy) is a post-merge tripwire, not a merge gate. The `Mainline health` workflow (`.github/workflows/mainline-health.yml`) watches the `CI` and `Browser Runtime` workflows on `main` and maintains a single open issue labeled `red-main` while any watched signal's latest completed run is red. A cancelled Full E2E run counts as red (F-131); a cancelled push run was superseded by a newer push and is skipped.

Fix-forward law: never revert, never force-push, and never bypass-merge to land work. A red main is repaired with new commits through the same PR flow, and the repair PR is the only slice a session may pick while the issue is open. Administrator bypass is reserved for governance operations the owner performs personally. When the red signal is the Full E2E matrix, re-dispatch it after the fix (`gh workflow run CI -f full_e2e=true`) so the signal clears without waiting for the nightly cron. A flake-only red still needs that green rerun, and the flake gets one line in the repair slice's progress entry so it cannot rot invisibly.

Monitoring hygiene, for the repair session and for any deploy check:

1. Track GitHub Actions by run id and head sha, not by branch name alone. Branch queries can silently switch to a newer push.
2. Track Vercel by commit sha through GitHub deployment status and Vercel CLI metadata. Do not use unauthenticated `curl`, `fetch`, or headless Playwright against production Vercel URLs as a deploy-readiness gate; protected targets can return a Vercel login or security checkpoint before the app. Use local or CI Playwright for app smoke coverage, and use a real authenticated browser context only when a slice explicitly needs production playtest evidence.
3. Use bounded polling with timestamps. Prefer a short loop that prints status, conclusion, head sha, and run URL. Avoid long noisy `gh run watch` output unless it is actively useful.
4. If `gh` auth fails, stop the failed loop and switch to the public GitHub REST endpoints when the repo is public. Do not keep retrying the same broken command.
5. If `origin/main` moves while you are repairing it, fetch immediately and check whether your fix is still contained. If it is not, reconcile before claiming the repair landed.
6. Watched workflow `name:` fields are load-bearing for the health watcher's `workflow_run` filter. Renaming `CI` or `Browser Runtime` silently detaches the tripwire; update both together.

CI speed policy:

- Required CI is the parallel gate in `docs/CI_WORKFLOW.html`: quality, typecheck, unit tests, build, and sharded critical Playwright smoke. Those five contexts are the whole merge gate.
- The full Playwright smoke matrix runs on schedule and manual dispatch as a post-merge tripwire. Run it locally or by manual dispatch before arming auto-merge for broad-risk slices that change shared UI shell behavior, cross-route storage state, release-note infrastructure, Playwright harness behavior, or equivalent surfaces.
- A red scheduled full-matrix run must never rot unseen: the health watcher evaluates the Full E2E signal separately from push runs, because push runs never execute the matrix. Known flakes are named in `docs/CI_WORKFLOW.html`; anything outside that list is treated as a regression.
- Two independently green PRs can auto-merge into a combined state never tested together (no merge queue, no strict up-to-date rule). The push run on `main` plus the tripwire detect it; the repair is fix-forward.

Continuous improvement requirement:

- If the tripwire misses a failure, fires falsely, or a repair takes unusual time because auth broke, branch status shifted underfoot, or production reported an older sha, root cause the monitoring problem before closing the task.
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
