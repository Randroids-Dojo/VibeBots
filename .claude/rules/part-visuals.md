---
description: Bot part visuals are render-only geometry over unchanged physics colliders. Never reshape a part by editing its collider.
paths:
  - "src/components/part-visuals.tsx"
  - "src/components/part-geometry.ts"
  - "src/components/part-geometry.test.ts"
  - "src/components/workshop-canvas.tsx"
  - "src/components/arena-canvas.tsx"
  - "src/sim/parts.ts"
---

<h1>Part visuals are render-only</h1>

<p>Full pipeline and how-to: <code>docs/PART_ART_PIPELINE.html</code>. Read it before shaping parts.</p>

<h2>The one hard rule</h2>

<p>A part's <code>shape</code> in <code>src/sim/parts.ts</code> (<code>cuboid</code> | <code>ball</code> | <code>cylinder</code>) is the deterministic Rapier collider. It drives physics, layout, drag targeting, snapshot hashes, and replays. NEVER change it to make a part look different. Any collider change bumps <code>SIM_VERSION</code> (Rule 3) and invalidates saved replays. If a visual change tempts you to widen or move a collider, stop: reshape the render mesh instead, or raise it in <code>docs/OPEN_QUESTIONS.html</code>.</p>

<h2>Where art lives</h2>

<ul>
  <li>All part geometry is built in <code>src/components/part-geometry.ts</code> (pure three, no JSX, node-testable) and dispatched by the shared <code>partGeometry(shape, category)</code> in <code>part-visuals.tsx</code>. One edit there upgrades all four render call sites (workshop <code>PlacedPart</code> / <code>HeroPart</code> / <code>DragGhost</code> and the arena).</li>
  <li>Materials stay <code>meshStandardMaterial</code> so the emissive selection glow and merge gold-flash refs keep working. <code>CATEGORY_SURFACE</code> holds the per-category metalness / roughness / emissive. Do NOT re-add <code>flatShading</code>: it recomputes facet normals in-shader and erases the baked fillet normals the geometry carries.</li>
</ul>

<h2>Invariants you must keep</h2>

<ul>
  <li><strong>Stay inside the collider.</strong> Every rendered vertex must sit within the collider half-extents (+1e-3). Bevels, grooves, and insets carve INWARD; teeth and greebles sit AT the collider bound, never past it, so the silhouette players aim at matches physics. <code>part-geometry.test.ts</code> asserts this across the whole catalog at both detail tiers; keep it green.</li>
  <li><strong>Stay cheap on mobile.</strong> Detail is tiered off <code>resolveGraphicsQualityTier(readStoredGraphicsQuality(), hasCoarsePointer())</code> (LOW for coarse-pointer / forced-WebGL2 phones, HIGH for desktop). Keep parts under ~2000 tris, one material each, no textures, no new render passes. Geometry is module-cached per unique shape; do not build per-frame or per-instance.</li>
  <li><strong>Verify visually.</strong> Screenshot the workshop carousel and an arena match (desktop and 390x760 Android portrait) before shipping. See <a href="../../docs/PART_ART_PIPELINE.html">the pipeline doc</a> for the exact checklist.</li>
</ul>
