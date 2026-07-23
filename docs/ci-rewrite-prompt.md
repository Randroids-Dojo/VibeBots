# VibeBots CI rewrite plan

## Status and objective

This is the executable design for replacing the current CI layout. It is a design slice only. It does not change a workflow, package script, test, branch rule, Vercel setting, or scheduled task. Each migration stage below is its own pull request and keeps the existing required checks in place until its replacement has passed in shadow mode.

Baseline at `3a7c4cd984ee61d6e18b3f14647ac6d90f8c0955` on 2026-07-22:

- Playwright lists 200 tests in 26 files.
- `pnpm test:e2e:critical` selects four tests in three files by matching title text.
- Full E2E runs 32 single-worker shards. Each shard checks out, installs, builds, and installs its browser before running about six tests.
- The latest completed scheduled run is red. Prior triage isolated roughly 29 repeat failures associated with software-rendered 3D paths, but that number is evidence from a point in time, not a permanent routing rule.
- Next.js 16.2.11 is available while the repository pins 16.2.10. The active red CI work takes priority under the dependency gate, so that upgrade stays a separate slice.

The rewrite must produce trustworthy required feedback in less than ten minutes, make every required failure locally reproducible with one command, and move real-renderer assertions to a capability that can answer them honestly. It must also exploit the deterministic simulation for stronger regression protection than the current browser matrix provides.

## Decisions

1. Classify every assertion by capability, not by spec file or historical job.
2. Keep one stable required branch check named `Required CI`. Its internal jobs may change without repeatedly editing branch protection.
3. Keep all merge-blocking checks on GitHub-hosted Linux runners. Required tests must not depend on the availability of a developer machine.
4. Use the current development Mac for scheduled real-renderer coverage through a local Codex task and a manual command. Do not register it as a persistent GitHub self-hosted runner while the repository is public. GitHub warns that public pull requests can execute dangerous code on self-hosted runners. Revisit a GitHub runner only if the repository becomes private or runner access is isolated behind a trusted, non-PR workflow. See [GitHub self-hosted runner access guidance](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access).
5. Prefer deterministic DOM, store, sim, and renderer instrumentation over pixel comparison whenever they prove the same behavior.
6. Use screenshots only for appearance that cannot be reduced to a stable semantic signal. A screenshot is not proof of motion by itself.
7. Build once per commit and distribute the exact build artifact to browser jobs. Never build once per shard.
8. Quarantine is temporary, owned, visible, and expiry-bound. Automation may open a quarantine pull request, but it may never merge one.
9. Required and advisory policy is explicit. A red advisory check creates work and remains visible, but it does not silently become a merge blocker.

## Target architecture

| Tier | Capability and assertions | Environment | Policy | Feedback |
| --- | --- | --- | --- | --- |
| Static quality | Dash rule, whitespace, Biome, sim purity, dependency and test inventory contracts | GitHub-hosted Ubuntu | Required | Inline annotations and job summary |
| Types and units | TypeScript, Vitest, route handlers, pure UI logic, replay logic | GitHub-hosted Ubuntu | Required | Vitest report and changed-file coverage summary |
| Deterministic goldens | Sim snapshots, mine replay hashes, economy outcomes, world construction versions | GitHub-hosted Ubuntu | Required | Vector diff with seed, inputs, old hash, new hash, and version decision |
| Build and bundle | One production build, route inventory, client bundle budgets, artifact manifest | GitHub-hosted Ubuntu | Required after shadow period | Build log, budget diff, downloadable build artifact |
| Functional browser | Navigation, forms, persistence, API integration, store state, accessibility, deterministic probes | Pinned Linux browser container, software GL allowed | Required | Playwright traces and screenshots only on failure |
| Preview smoke | Exact-SHA deployment health, routes, assets, API version, guest boot, storage-off behavior | GitHub-hosted browser against the Vercel preview | Required after shadow period | Deployment URL, commit SHA, trace on failure |
| Render and motion | WebGPU or WebGL fallback startup, visible motion, camera travel, canvas health, renderer telemetry | Development Mac with real hardware acceleration | Advisory nightly and manual before broad render changes | Trace, named screenshots, pixel samples, renderer metadata, timing report |
| Visual review | Small set of appearance baselines that cannot be expressed semantically | Development Mac, fixed browser, viewport, DPR, fonts, and renderer | Advisory | Baseline diff and review artifact |
| Soak and performance | Long mine sessions, heap churn, frame percentiles, draw calls, GPU resets | Development Mac plus production telemetry | Advisory at first; promote stable machine-independent budgets | Trend report by exact build SHA |

`Required CI` is an aggregator job with `if: always()`. It fails unless every required job for that commit succeeded or was intentionally not applicable under a documented path rule. No advisory result feeds this aggregator.

The target required critical path is:

1. Static quality, types, units, deterministic goldens, and build start in parallel.
2. Build uploads one immutable artifact and manifest.
3. Functional browser shards download that artifact and run in parallel.
4. Preview smoke waits for the Vercel deployment that reports the exact pull request head SHA.
5. `Required CI` summarizes the result.

Target budgets are two minutes for static and unit jobs, four minutes for build, three minutes for functional browser shards after artifact download, and less than ten minutes end to end. Budgets are service objectives, not longer test timeouts. A job that breaches its budget emits a timing artifact and fails only after a measured shadow period establishes a realistic threshold.

## Test classification contract

Every Playwright test must have:

- Exactly one capability tag: `@functional`, `@render`, `@visual`, or `@soak`.
- One stable case annotation such as `case-id: E2E-MINE-0042`.
- Optional policy tags such as `@critical`, `@preview`, or `@serial`.
- No routing dependency on title text, filename, line number, or a hardcoded count.

Playwright supports tags and annotations as test metadata. See [Playwright tags and annotations](https://playwright.dev/docs/test-annotations). `pnpm ci:inventory` will list all cases and fail on a missing or duplicate case ID, zero or multiple capability tags, an unknown tag, an expired quarantine, or a quarantine entry whose case no longer exists.

Capability definitions:

- `@functional`: The assertion remains trustworthy with no GPU. It may inspect DOM, accessibility state, network results, store state, data attributes, deterministic scene probes, or API responses. It must not wait for canvas pixels or use elapsed render frames as the result.
- `@render`: The assertion needs a working accelerated renderer, visible canvas output, or observable motion over time.
- `@visual`: The exact appearance matters and a reviewed image baseline is the contract.
- `@soak`: The test needs prolonged runtime, many actions, or statistical performance evidence.
- `@critical`: The case protects a short, player-visible, high-severity path and also keeps its capability tag. Required Linux CI accepts `@critical` only when the capability is `@functional`.

A single spec may contain multiple capability classes. Routing happens at the test level. If one test mixes functional and render assertions, split it into two tests that share setup. Preserve the functional half in required CI and move only the render assertion.

The first inventory commit records all 200 current cases and their initial classifications without changing behavior. Review each existing assertion in this order:

1. Pure helper or replay assertion: move to Vitest or a golden vector.
2. DOM, route, API, store, or deterministic data probe: tag `@functional`.
3. Canvas health that can be represented by renderer state, camera state, object counts, transforms, or consecutive-frame counters: expose a test-only deterministic probe and tag `@functional` if the probe is the product contract.
4. Actual visible output, motion, WebGPU fallback, or pixel composition: tag `@render`.
5. Exact styling or composition: tag `@visual` only when semantic assertions are insufficient.
6. Long-run stability or performance distribution: tag `@soak`.

No existing test leaves the nightly matrix until its replacement tier has run against at least five mainline commits and produced the expected result. This overlap makes migration incremental.

## Build once and reproduce locally

The build job creates a compressed runtime artifact containing the production `.next` output, `public`, the package metadata needed to start it, and `ci-build-manifest.json`. The manifest records:

- Commit SHA and dirty-state refusal.
- Node, pnpm, Next.js, Playwright, and Chromium versions.
- Lockfile hash and container image digest.
- Build start, finish, and duration.
- Route output and bundle baseline comparison.

Downstream jobs refuse an artifact whose manifest SHA does not equal the workflow head SHA. GitHub artifact retention is short and deliberate because this is a test input, not a release store.

The browser runtime is a repository-owned image published to GHCR and pinned by digest. It is based on Playwright's documented Linux dependencies, includes Node 22 and pnpm, and has the same Chromium and GL libraries used in hosted CI. The image is rebuilt only through a reviewed dependency update. See [Playwright Docker guidance](https://playwright.dev/docs/docker).

Add these commands during implementation:

```text
pnpm ci:inventory
pnpm ci:repro -- --case E2E-MINE-0042
pnpm ci:repro -- --shard 2/8
pnpm ci:bundle
pnpm ci:render -- --sha <commit>
pnpm test:goldens
pnpm test:goldens:update -- --reason <text>
```

`pnpm ci:repro` runs the pinned container, downloads or builds the matching artifact, forces the CI storage-off environment, uses one Playwright worker, and forwards the selected case or shard. It prints the image digest and exact inner command before running. This is the single-command contract for a required CI failure.

`pnpm ci:render` uses a dedicated clean checkout on the Mac. It never switches the user's active worktree, never reads repository env files, and refuses a dirty checkout. It records the OS, browser, renderer, GPU, viewport, DPR, and exact commit in its result.

## Rendering tier recommendation

| Option | Cost | Reliability | Coverage | Maintenance | Decision |
| --- | --- | --- | --- | --- | --- |
| Convert eligible checks to deterministic instrumentation | Low implementation cost, no runtime fee | High when the probe represents the player-visible rule | Most functional behavior, but not final pixels or driver behavior | Moderate probe discipline | Primary choice for all eligible assertions |
| Development Mac scheduled task | Existing hardware and electricity | Good when the machine is online; unsuitable as a required gate | Real WebGPU or WebGL fallback, motion, pixels, frame behavior | Browser pinning, clean checkout, task monitoring | Primary real-render tier, advisory |
| GitHub self-hosted Mac runner on the development machine | No new hardware, but creates a persistent remote execution surface | Availability depends on one personal machine | Same real-render coverage | High security and host isolation burden for a public repo | Do not use while public |
| Paid GPU runner | Recurring compute cost and vendor setup | Potentially high with a pinned image and dedicated capacity | Real Linux GPU and driver behavior | Image, driver, and capacity ownership | Reconsider if the Mac tier becomes a release bottleneck |
| Pinned offscreen renderer with image goldens | Low to moderate compute | Stable only for the renderer it emulates | Useful for narrow material or geometry snapshots, not browser WebGPU integration | Baseline churn and false diffs | Narrow tool, not the main render tier |
| Vercel preview in CI | Existing platform cost | High for deployed-stack checks | Real deployment, but the CI browser still has the runner's renderer | Bypass token and exact-SHA coordination | Required for functional deployment smoke, not GPU proof |
| Human browser review of preview | Human time | Variable | Excellent exploratory and qualitative coverage | Manual evidence discipline | Use for feature playtests, not a repeatable CI gate |

The clear pick is deterministic instrumentation for every assertion that permits it, plus the development Mac for the smaller set that truly requires real rendering. A Vercel preview does not supply a GPU to the test. The client machine supplies the renderer, so a GitHub-hosted browser against preview still uses software rendering. Preview smoke is valuable for deployment integration, not as a substitute for the Mac render tier.

Schedule the local Mac task for 5:30 AM America/Chicago. It fetches the newest `origin/main`, checks out the SHA in its dedicated directory, runs the `@render` set with one worker, then the bounded `@visual` and `@soak` subsets, and publishes a result linked to the SHA. If the machine is asleep or unavailable, the task records `missed`, alerts locally, and catches up once. It does not report success for a skipped run.

The Mac result becomes required only by a manual release policy for a slice that changes a renderer, frame loop, canvas, camera, 3D part, or visual baseline. It does not become a GitHub branch-protection check until equivalent isolated runner infrastructure is available.

## Deterministic and regression capabilities

### Sim and replay goldens

Create versioned JSON vectors under `tests/goldens/`. Each vector contains a stable ID, seed, gear or design inputs, action log, step count, `SIM_VERSION`, `MINE_VERSION` when applicable, final snapshot FNV hash, and selected semantic outcomes such as position, resources, health, score, and payout.

The required test applies every vector in browser-independent Node execution. It fails with a field-level diff. Updating a hash requires all of the following in the same change:

- The relevant version constant changes.
- The changed vector names the new version.
- `pnpm test:goldens:update -- --reason <text>` records a non-empty reason in a machine-readable change manifest.
- A version-policy test proves that changed deterministic output cannot land with the old version.

The inverse is also checked: a version bump with no changed vector emits a review warning so accidental or cargo-cult bumps are visible.

### Renderer-independent motion probes

Expose bounded, read-only probes for camera transform, active renderer, submitted frame count, draw calls, visible object counts, scene state, and last completed animation phase. Probes must read existing state and must not create a second product behavior. Motion tests compare at least two frames or transforms over time, as required by Rule 10.

Probe schemas are versioned. A probe contract test fails if a field disappears while a case still consumes it. Production exposure remains limited to non-sensitive diagnostic values already suitable for telemetry.

### Build and bundle regression

`pnpm ci:bundle` compares the Next.js route output and client assets to a baseline JSON committed for the current mainline. During two weeks of shadow mode it reports only. After calibration it fails when either threshold is exceeded without an approved budget update:

- Any route adds more than both 10 percent and 25 KiB compressed client JavaScript.
- Total compressed client JavaScript adds more than both 5 percent and 100 KiB.

Absolute and percentage thresholds prevent noise on tiny chunks and hide neither a large local spike nor broad creep. An update requires a reason and names the affected route or shared chunk.

### Performance and heap churn

Keep machine-independent allocation checks close to required CI. Run existing heap-churn and allocation scripts when a changed file matches the frame-loop ownership map. Begin advisory, then promote only metrics that remain stable in the pinned container.

Real frame timing, renderer mode, draw calls, GPU resets, and long-session behavior stay on the Mac tier. Report median, p95, and worst frame time against a rolling baseline for the same browser, renderer, viewport, and DPR. Flag a regression when p95 worsens by both 20 percent and 4 ms across three samples, or when draw calls rise by both 15 percent and 10 for the same scenario. These start as review signals, not blockers.

Production telemetry is a separate safety net. Compare exact application versions and renderer cohorts. Alert on a sustained p95 frame-time regression, a new GPU-reset signature, or a large increase in low-frame samples. Production telemetry never turns a currently running pull request green.

### Preview and post-deploy smoke

Wait for the GitHub deployment whose `sha` equals the pull request head. Do not pick the newest deployment by branch name. Use the Vercel automation bypass secret only in the trusted preview smoke job, never in fork pull requests or artifacts. See [Vercel protection bypass automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).

The preview set is small and GPU-independent: app shell, latest release note, guest mine boot, one deterministic action through a probe, one API health or version call, static asset load, and a protected-route response. A separate post-merge monitor ties production deployment status to the exact main SHA. Production UI automation remains limited to cases that have an authenticated browser context and genuinely need it.

The installed Vercel CLI is 55.0.0 while npm reports 56.5.0. Upgrade the CLI in its own tooling slice before relying on new CLI output as a parser contract. Pin the version used by automation after upgrading.

## Flake detection and quarantine

Every browser attempt emits one normalized record per case: case ID, commit SHA, tier, environment fingerprint, attempt, duration, outcome, failure fingerprint, artifact links, and quarantine state. Normalize stack paths, timestamps, ports, and generated IDs before hashing the failure message.

Classify results for the same commit and environment:

- `pass, pass`: stable pass.
- `fail, fail` with the same fingerprint: consistent failure.
- `fail, fail` with different fingerprints: unstable failure, investigate as flake or cascading infrastructure.
- `fail, pass` or `pass, fail`: observed flake.
- Browser launch, artifact download, runner loss, or global service failure before the case starts: infrastructure failure, not a product flake.

Retries remain evidence, not a way to erase the first result. Required CI fails on any non-quarantined failed first attempt until the classifier has enough history and the team deliberately changes policy.

Store quarantine entries in a reviewed manifest with:

- Stable case ID and capability tier.
- Owner.
- Tracking issue or followup.
- Failure fingerprint and evidence runs.
- Added date, reason, and expiry date no more than 14 days away.
- Expected disposition: fix, delete as duplicate, or replace with a different capability.

A scheduled classifier may open or update a pull request when a case flakes on at least two commits or exceeds a measured rate such as 2 failures in its last 20 eligible runs. It may not auto-merge. Expired quarantine fails `ci:inventory`. Quarantined cases still run in a separate non-blocking job, remain in summaries, and page the owner when they fail after expiry or change fingerprint. Deterministic goldens, static checks, and the preview health minimum are never auto-quarantined.

The classifier publishes a weekly table of stable pass rate, consistent failures, observed flakes, infrastructure failures, quarantined age, and median duration. This replaces manual comparison across runs.

## Staged migration

### Stage 0: inventory and stable identity

Add case IDs, capability tags, `pnpm ci:inventory`, timing output, and a generated inventory artifact. Replace the title grep for the current required subset with `@critical AND @functional`, but leave the existing Critical E2E job and Full E2E matrix otherwise unchanged.

Exit when all 200 baseline cases are classified, the inventory count matches Playwright discovery, title edits cannot change routing, and the generated inventory is reviewed.

### Stage 1: deterministic goldens

Add representative combat, mining, economy, replay, and world-snapshot vectors plus version-policy tests. Run them beside Vitest in required CI. Do not update any existing hash during the plumbing pull request.

Exit when an intentional local output mutation fails with a useful diff, an unchanged version blocks a golden update, and the normal mainline vectors are green.

### Stage 2: pinned CI runtime and one-command reproduction

Publish the pinned browser container and implement `pnpm ci:repro`. Run one current functional shard in shadow mode in both the old and new runtime and compare discovered case IDs, outcomes, and durations.

Exit when a recorded GitHub failure reproduces locally from its case ID and image digest, or the report explains a verified host-only difference.

### Stage 3: build once and functional fanout

Create the build artifact and manifest, split `@functional` tests into balanced duration-based shards, and remove build steps from those shards. Use Playwright's test-level sharding with one worker per software-rendered shard. See [Playwright sharding](https://playwright.dev/docs/test-sharding).

Run the new functional jobs in shadow mode for at least five mainline commits. Then make them inputs to `Required CI` and retire the title-grep job. Keep the old Full E2E schedule during overlap.

Exit when the artifact SHA guard is proven, functional discovery is complete, p95 required duration is below ten minutes, and no required case depends on rendered pixels.

### Stage 4: exact-SHA Vercel preview smoke

Add trusted preview protection bypass, exact deployment-SHA matching, and the small `@preview @functional` set. Start advisory, prove fork pull requests cannot read the bypass secret, then add it to `Required CI` if p95 completion keeps the total gate below ten minutes. If Vercel queue time makes that impossible, keep preview smoke as a separately required environment check with a documented release policy rather than slowing every source check.

Exit when the smoke fails against a deliberately broken preview asset or route and refuses a deployment for the wrong SHA.

### Stage 5: real-render Mac tier

Implement `pnpm ci:render`, the dedicated clean checkout, environment fingerprinting, artifacts, and the 5:30 AM America/Chicago Codex task. Move `@render`, `@visual`, and `@soak` cases out of the old Full E2E matrix only after each is observed on the Mac for five mainline commits.

Start with WebGPU or automatic fallback in the same configuration players use. Keep one explicit WebGL fallback scenario. Do not force SwiftShader for real-render acceptance.

Exit when missed schedules are visible, failures link to exact SHAs and artifacts, and a deliberate pixel, motion, and renderer-startup defect is detected.

### Stage 6: regression budgets and flake service

Add bundle shadow reporting, heap-churn routing, real-render performance trends, normalized outcome records, and the quarantine manifest. Calibrate before enforcing thresholds. Promote only machine-independent budgets to required CI.

Exit when the system distinguishes a seeded consistent failure, a deliberate fail-pass flake, and an infrastructure launch failure, and when an expired quarantine makes inventory red.

### Stage 7: retire the old Full E2E matrix

Compare the old matrix inventory to the union of units, goldens, functional, preview, render, visual, and soak. The difference must be empty by stable case ID. Remove the 32-shard job only after two weeks of overlapping evidence and update `docs/CI_WORKFLOW.html`, `AGENTS.md`, package scripts, branch protection, and operator instructions in the same closeout sequence.

Exit when every former Full E2E case has an owner tier, required branch protection names only `Required CI`, scheduled Mac and flake reports are live, and local reproduction is documented from a clean checkout.

## Failure modes and early detection

| Failure mode | Early detection and response |
| --- | --- |
| Misclassified render assertion remains required on Linux | Inventory lint forbids pixel helpers in `@functional`; run targeted static checks and audit any repeated SwiftShader fingerprint |
| Instrumentation passes while visible behavior is broken | Require real-render coverage for player-visible motion and periodic review that maps each probe to one visual scenario |
| Build artifact does not match tested SHA | Manifest SHA, lock hash, and image digest are verified before server start; mismatch fails immediately |
| Artifact omits a runtime file | Preview smoke and a local clean-container start test load routes and static assets from only the artifact |
| One Mac silently stops reporting | Heartbeat with `success`, `failure`, or `missed`; alert after one missed window and catch up once |
| Mac result changes with OS or browser update | Fingerprint every run; pin browser; treat fingerprint changes as a new baseline cohort |
| Public pull request reaches a trusted machine or secret | No persistent public self-hosted runner; trusted workflows check event and repository owner before secret use |
| Quarantine becomes a graveyard | Required owner, issue, 14-day expiry, inventory failure on expiry, weekly age report, no auto merge |
| Retry hides a regression | Preserve and classify every attempt; show first-attempt pass rate; required policy does not discard first failures silently |
| Duration-based shard map drifts | Recompute only from successful historical medians, publish the map as an artifact, and cap each shard's predicted duration |
| Required gate name or branch protection drifts | A repository policy check compares configured required contexts to the single documented `Required CI` context |
| Vercel smoke tests the wrong deployment | Query deployments by exact head SHA and verify `/api/version` or deployment metadata before testing |
| Bundle baseline is casually blessed | Budget update requires route or chunk name, byte delta, and reason; shadow report shows cumulative 30-day growth |
| Golden updates bless unintended sim drift | Field-level semantic diff, version-policy check, mandatory reason, and review of the generated change manifest |
| A required job is skipped by a path filter | Aggregator knows the allowed applicability rules and fails on an unexplained skipped or missing result |

## Completion criteria

The rewrite is complete only when:

- Required CI has a p95 under ten minutes over 20 mainline or pull request runs.
- The build executes once per commit and every browser shard verifies the same artifact SHA.
- Every Playwright case has one stable ID and one capability tier.
- The required browser tier contains no genuinely render-dependent assertion.
- Any required case can be reproduced locally with one command and the recorded image digest.
- Deterministic output cannot change without the matching simulation or mine version decision.
- Preview smoke verifies the exact deployment SHA.
- Real-render, visual, and soak results from the development Mac are visible, exact-SHA-bound, and missed runs are explicit.
- Flakes, consistent failures, and infrastructure failures are separated automatically.
- Every quarantine has an owner, issue, and unexpired deadline.
- The old 32-shard Full E2E matrix has zero uniquely owned cases before removal.
- `docs/CI_WORKFLOW.html`, `AGENTS.md`, package scripts, branch protection, and the local task documentation describe the final system without contradictory legacy instructions.

## Explicit assumptions and owner decisions

- Default infrastructure choice: use the current development Mac as an advisory scheduled Codex task, not a GitHub self-hosted runner.
- Default cost choice: buy no new GPU capacity now. Reconsider paid isolated GPU runners only if Mac availability blocks releases or render coverage grows beyond its nightly window. Current hosted runner pricing should be rechecked before approval. See [GitHub Actions runner pricing](https://docs.github.com/en/enterprise-cloud@latest/billing/reference/actions-runner-pricing).
- Default screenshot choice: keep a small reviewed visual set. Do not migrate all render assertions to image goldens.
- Default merge policy: source, deterministic, build, functional browser, and exact-SHA preview health are required after their shadow periods. Real-render, visual, soak, and telemetry trends are advisory except when the release process explicitly requires a fresh render result for a renderer-affecting change.
- Default schedule: 5:30 AM America/Chicago with one catch-up attempt.
- No stage may modify CI configuration without the project-required owner approval for that stage.
