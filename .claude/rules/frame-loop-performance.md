---
description: Frame loops must not allocate. GC pauses from per-frame garbage froze real phones for seconds (F-074).
paths:
  - "src/components/*canvas*.tsx"
  - "src/components/mine-*.ts"
  - "src/components/mine-*.tsx"
  - "src/components/miner-*.ts"
  - "src/components/arena-*.tsx"
  - "src/components/workshop-*.tsx"
  - "src/components/holodeck-*.tsx"
  - "src/components/part-visuals.tsx"
  - "src/components/perf-*.ts"
  - "src/components/perf-*.tsx"
---

<h1>Frame-loop performance</h1>

<p>This rule exists because of a shipped failure, not a hypothetical: production telemetry from a real phone (F-074, 2026-07-07) showed the mine freezing for 1 to 6 seconds whenever the JS heap sawtoothed from 200-350 MB back to 100 MB. The garbage came from the frame loop allocating small objects every frame. The fix slice (PR #91) removed the churn; this rule keeps it out.</p>

<h2>The invariant</h2>

<p>Code that runs every frame (<code>useFrame</code> callbacks and every function they call) must not allocate in steady state. At 60fps, "one small object per frame" is 5+ MB of garbage per minute per call site, and major GC pauses land inside the frame callback, exactly where players feel them. Low-battery CPU throttling multiplies the pause length.</p>

<h2>Known allocation patterns to reject in per-frame code</h2>

<ul>
  <li>Object or array literals, including options objects and <code>[x, y]</code> return tuples. Use a hoisted scratch object or an <code>out</code> parameter (see <code>createMinerPose</code>/<code>advanceMinerRig</code> and <code>sampleMotion</code>'s out tuple).</li>
  <li>Closures created inside the loop, including <code>.forEach</code>/<code>.map</code> callbacks defined inline in helpers that run per frame. Hoist to module-level functions (see <code>animateClankerBody</code>).</li>
  <li><code>.filter()</code>/<code>.map()</code>/<code>.slice()</code>/spread on per-frame arrays. Compact or mutate in place (see the particle write-index compaction in <code>mine-canvas.tsx</code>).</li>
  <li>String building: <code>toFixed</code>, <code>String()</code>, template literals, and especially per-frame DOM <code>dataset</code> writes (each write also mutates an attribute). Route diagnostics through <code>src/components/dataset-diagnostics.ts</code>, which only produces a string when the quantized value changed.</li>
  <li><code>for (const [k, v] of someMap)</code>: Map entry iteration allocates a tuple per entry per frame. Use <code>map.forEach</code> or restructure.</li>
  <li><code>new Vector3/Color/Matrix4</code> or <code>.clone()</code> per frame. Keep one scratch instance in a ref and <code>.set()</code>/<code>.copy()</code> into it.</li>
</ul>

<p>Shared constants that sit next to writable scratch buffers of the same shape must be deep-frozen (see <code>CRUMPLE_REST</code>), so an accidental write throws instead of corrupting.</p>

<h2>Check before shipping a render-path slice</h2>

<ul>
  <li>Scan every touched per-frame path against the list above.</li>
  <li>Measure when the slice touches frame loops or adds per-frame work: <code>node scripts/measure-heap-churn.mjs &lt;baseURL&gt; &lt;label&gt;</code> compares allocation rate and GC-drop counts against a baseline run of <code>main</code>; <code>node scripts/profile-allocations.mjs &lt;baseURL&gt;</code> names the top allocation call sites via Chrome's sampling heap profiler.</li>
  <li>After deploy, verify on real hardware through the telemetry: <code>GET /api/performance/insights?device=real</code> sessions should show a flat heap span (<code>heapMinMb</code>/<code>heapMaxMb</code>) and low stall counts; per-build A/B via <code>byBuild</code> quantifies the change.</li>
</ul>

<h2>Adjacent known traps</h2>

<ul>
  <li>three's WebGPURenderer <code>info.render.calls</code> accumulates since app start; per-frame draw calls are <code>info.render.drawCalls</code> (probe bug, PR #88).</li>
  <li>The per-tick React re-render of the mine cell grid is a separate, structural churn source (F-075). Do not "fix" it with per-frame band-aids; it needs memoized cell subtrees or an imperative grid.</li>
  <li>Per-action spawn helpers may allocate (they run at input cadence, not frame cadence), but keep their loops bounded and their objects small.</li>
</ul>
