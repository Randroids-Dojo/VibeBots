# Prompt: rewrite VibeBots CI from the ground up

A self-contained brief to hand to a top-tier agent. It front-loads the hard-won lessons so the agent does not repeat mistakes we already paid for, and it asks for a concrete architecture plus a staged migration plan rather than platitudes.

---

You are redesigning the continuous integration system for a browser game called VibeBots, from first principles. I want you to produce a concrete target architecture and a staged migration plan, not a list of best practices. Optimize for three things at once: eliminate the failure modes described below, and simultaneously extract more regression safety and richer, faster feedback than the current setup gives. Treat this as a systems design problem with real cost tradeoffs, and make explicit recommendations with your reasoning.

## The product and stack

VibeBots is an autonomous robot-battler with a mining economy. It runs on Next.js (App Router) deployed to Vercel, TypeScript strict, pnpm. The 3D layers use `three` via `three/webgpu` (a WebGPU renderer with automatic WebGL2 fallback) plus `@react-three/fiber` and `@react-three/drei`, with rapier (deterministic build) for physics. Tooling is Biome, Vitest, and Playwright. Persistence is a single Neon Postgres.

## A design fact that matters for testing

The game sim is a pure function of `(seed, gear, action log)`. The client simulates locally and the server re-runs the identical sim to credit official results; world-snapshot FNV hashes are the verification primitive, and any change to sim rules bumps a `SIM_VERSION` / `MINE_VERSION` constant that invalidates stored hashes. `src/sim` is enforced pure (no react/next/three, no `Math.random`, no transcendental math) by a lint override and a purity script. This determinism is an asset the CI should exploit far more than it currently does.

## The current CI (what exists)

GitHub Actions. A required parallel gate of: lint/dash/whitespace/sim-purity checks, typecheck, unit tests (Vitest), a production build, and a "Critical E2E" Playwright smoke selected by grepping test titles across 2 shards. Separately, a "Full E2E" Playwright matrix of ~210 tests runs only on a nightly schedule and on manual dispatch, currently in 32 single-worker shards with a 35 minute per-shard budget. Playwright's web server is `next start` with storage forced off so results match CI.

## The failure the redesign must kill

GitHub-hosted runners have no GPU, so Chromium falls back to SwiftShader (software GL) on a 4-vCPU runner. Roughly 29 of the 210 Full-E2E tests render actual 3D scenes and fail *consistently* on CI (both retries) while passing locally on real hardware. Their failure modes are 60 second render timeouts, GPU-process crashes, and canvas pixel or telemetry assertions that never settle. The Full E2E matrix was red for over a week, and the redness was invisible because shards were timing out and cascading unrelated specs (including pure helper tests) to "failed."

## Hard-won lessons the current team already paid for

Do not re-derive these; design around them.

1. Increasing Playwright workers above 1 on the software renderer is a trap: two SwiftShader contexts starve each other on 4 vCPUs and mass-timeout tests that pass at one worker. Parallelism must come from more shard jobs, not more workers per job.
2. Raising the per-test timeout to compensate backfires: slow tests then linger until a shard exceeds its whole-job budget and times out, re-masking results.
3. Adding shards prevents shard-level timeouts but does nothing for the consistent failures; the ~29 are a rendering-capability wall, not a scheduling problem.
4. `--disable-dev-shm-usage` is needed on CI or the software renderer crashes the GPU process on the small `/dev/shm`.
5. The single biggest velocity killer is that CI-only failures do not reproduce locally: a fast dev machine renders SwiftShader fine even when forced to it, so every hypothesis costs a ~30 minute dispatch. Any redesign that does not make CI failures locally reproducible has not solved the real problem.
6. The suite conflates three different kinds of assertion inside single spec files: pure logic, GPU-independent functional behavior (DOM, store state, data-attribute probes the app already exposes), and genuinely render-dependent behavior (pixel diffs, motion QA, "camera pans," "not one flat gray," telemetry sample counts). Only the third kind needs a GPU. Most of the 210 do not.
7. Selecting the required subset by grepping test titles is fragile; a title edit silently changes what gates.
8. Each of the 32 shards independently checks out, installs, builds, and installs browsers before running ~6 tests, so the build runs 32 times.

## What I want you to design

Start from the question "what capability does each assertion actually require, and what is the cheapest environment that can give a trustworthy answer," then build tiers around that rather than around one Playwright matrix. I expect something like: a pure/deterministic tier (Vitest plus sim golden-hash vectors that fail if replay output changes without a version bump), a GPU-independent functional-UI tier that runs fast and always gates by driving the app through its existing data-attribute probes and store state without asserting on rendered pixels, and a separate render/visual/motion tier for the assertions that truly need a GPU. For that last tier, decide and justify among: GPU-enabled runners (self-hosted or paid), a pinned deterministic offscreen renderer with golden-image baselines, running real-browser smoke against the Vercel preview deployment (which has a real GPU on the reviewer's machine), or converting pixel/motion assertions to renderer-independent in-app instrumentation. I want your opinion on which of these is worth it and which are dead ends, given the determinism the app already has.

Then push past merely fixing it. Use the determinism to add regression safety the current CI lacks: golden sim/world hashes gated on version bumps, performance-regression tracking (frame budget, heap churn, draw calls, the app already emits per-build telemetry), bundle and build-output regression, and a post-deploy smoke against the real Vercel preview or production. Make flakes a first-class, data-driven system: automatic detection, an auto-managed quarantine with an owner and an expiry so nothing rots silently, and a signal that distinguishes "consistent failure" from "flake" automatically (we had to compute that by hand across two runs). Build the required gate to be fast (target well under ten minutes), build the artifact once and fan it out to shards instead of rebuilding per shard, and make local reproduction of any CI environment a single command (a container that matches the runner and its GL stack exactly), because that is what makes every other fix cheap to land.

## Constraints and preferences

GitHub Actions and Vercel are the platforms. Hosted runners have no GPU; be explicit and honest about cost whenever you propose GPU or self-hosted infrastructure, and offer a no-new-infra option alongside it. Keep the required merge gate strictly separated from advisory/nightly tiers, and make "required vs advisory" a deliberate, documented policy rather than an accident of which job happens to be green. Prefer instrumentation the app can expose deterministically over screenshot diffing wherever an assertion allows it. Do not use em-dashes.

## Deliverables

1. A target architecture: the tiers, what each asserts, what environment runs it, which are required vs advisory, and how feedback surfaces.
2. A concrete rendering-tier recommendation with the tradeoff table (cost, reliability, coverage, maintenance) and a clear pick.
3. A flake-management and quarantine design.
4. The specific new regression/feedback capabilities you would add and how each is wired.
5. A staged migration plan that keeps main mergeable throughout, starting with the highest-leverage, lowest-risk step, and says exactly how to reclassify the existing ~210 tests into tiers without a big-bang rewrite.
6. The failure modes of your own design and how you would detect them early.

Ask me for any decision that is genuinely mine to make (for example, the appetite for paid GPU runners), but make a default recommendation for each so the plan is executable if I say nothing.
