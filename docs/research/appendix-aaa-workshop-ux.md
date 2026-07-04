# What Makes Build / Customization Systems Feel AAA and Fun

Research brief for the VibeBots connector-based robot workshop (mobile-first, Android portrait, three.js). Focus: transferable UX and "feel" patterns from the best building games, ranked and translated into a prioritized backlog for a drag-parts-onto-connectors, merge-duplicates-to-level-up workshop with a mined-resource economy.

Date: 2026-07-04. Sources cited inline and listed at the end. All source text is summarized, not reproduced.

---

## 1. The core thesis

The best build systems are fun for two independent reasons, and AAA polish comes from serving both at once:

1. **The IKEA effect.** Players over-value things they assemble themselves. Labor on top of possession creates psychological ownership; abandoning a self-built thing feels like a real loss, which is exactly the retention engine you want. The "ceremony of creation" matters as much as the finished object. Minecraft-class games are essentially IKEA-effect engines. Design implication: every step where the player exerts effort or makes a personal choice (naming, painting, positioning, merging) deepens attachment, so make those steps feel good and make the result visibly *theirs*. (Sources: IxDF, GameMastering, Agate.)

2. **Moment-to-moment "juice."** Juice is the layer of animation, sound, particle, and haptic feedback that does not change the rules but changes how the game *feels*: responsive, alive, satisfying. A single action feels best when visual + audio + haptic fire together (e.g. snap-flash + click + short rumble). The recommended method is to build juice in layers: get the mechanic working, then add one feedback channel at a time. (Sources: Blood Moon Interactive, GameAnalytics/Game Developer, DesignTheGame.)

Merge mechanics specifically (directly relevant to your "merge duplicates to level up") are satisfying because each merge is a **small completion** with a clean pop of visual + audio feedback and a number going up. Chain reactions ("one merge triggers another") are cited repeatedly as the single best feeling in merge games. Design implication: the merge-to-level-up moment must be one of the juiciest events in the whole app, and cascading/chained merges should be possible and celebrated. (Source: merge-game roundups, Udonis/Plarium.)

---

## 2. Pattern catalog, by theme

### A. Placement and snapping feedback

The universal AAA lesson: **solve precision invisibly with snapping, and always show a ghost preview of where the thing will land before committing.**

- **Hand-authored snap points (magnets), not just a grid.** Halo Infinite's Forge moved from grid-only to magnet-based snapping with author-placed snap nodes on each asset. This is the closest analog to your connector model: your connectors *are* the snap magnets. The key insight is that "a tiny imperceptible gap between two objects" causes physics bugs and visual wrongness, so snapping should close the last gap automatically and constrain to a small set of valid orientations rather than infinite freedom. Constraining snap options is what makes it usable on a controller (or a phone). (Source: rystorm.com Forge analysis.)
- **Loose proximity snapping.** Tears of the Kingdom's Ultrahand snaps when two surfaces get near each other, choosing the nearest valid orientation. The advised technique is "approach slowly and let it snap" rather than fighting manual rotation. For a phone this is gold: the player should not have to be pixel-precise; get the part close to a connector and it clicks in. (Source: Game8, GamerRant TotK.)
- **Ghost/transparent preview.** Ultrahand shows a translucent preview; Autobuild shows a transparent preview of the whole design before you commit. Show the part as a ghost at the snap target, tinted for valid/invalid, before the player releases. (Source: Zelda Wiki Autobuild.)
- **Valid / invalid highlighting.** Tint the ghost and/or the target connector green when a placement is legal and red when not. LEGO Fortnite's editor refuses overlap and auto-inserts spacing rather than allowing an illegal state, which keeps the build always-valid. (Source: Epic dev docs, LEGO Brick Editor.)
- **Snap-to-ground / auto-orient, but always previewed.** Forge's snap-to-ground was fast but *lacked a preview*, which created uncertainty and forced reliance on undo. Lesson: any automatic reposition must be previewed, or you must have bullet-proof undo.
- **Show parts in-scene at real scale ("asset zoo").** Forge browses assets rendered in the actual scene with actual lighting/scale, instead of a separate 2D panel where you can't judge size. For your part tray, render parts as real 3D thumbnails (or drop them into the scene to preview) so scale reads correctly.

### B. Symmetry / mirror / auto-align

Every serious builder ships a mirror tool; it is table stakes for anything with a left/right.

- **Mirror mode across a plane.** Trailmakers mirrors the build across the builder's center plane and crucially mirrors *everything*: blocks, colors, skins, decals, and block config, not just geometry. Besiege's symmetry tool mirrors placing, editing, *and deleting* across a chosen axis, with multiple selectable axes. Design implication: when mirror is on, every action (add, paint, delete, merge) applies to the mirrored counterpart too. (Sources: Trailmakers wiki, Besiege wiki.)
- **Configurable radial/rotational symmetry.** KSP's VAB offers mirror and radial symmetry; the beloved Editor Extensions mod adds arbitrary radial counts and center-part alignment. For a robot with radial limbs (4 legs, 6 thrusters) radial symmetry is a huge time-saver.
- **Angle snapping in fixed increments.** KSP and Besiege snap rotation to increments (45 deg default; mods expose 1/5/15/22.5/30/45/60/90). Besiege's "Snap Value" restricts translation to fixed steps (e.g. 0.5 m). On a phone, snapping rotation to increments is what makes rotation usable at all with a fat finger.
- **Auto-center / align helpers.** Center-part-in-body, align-to-guide, snap-to-guide. Forza's livery editor and its community tools lean on "snap to guides or grid helpers" for alignment.

### C. Camera control on a phone (the make-or-break constraint for you)

This is where most 3D builders fail on mobile, and where you have the most to gain.

- **Standard gesture grammar (learn it, don't reinvent it).** Research and AR guidance converge on: one-finger drag = orbit/rotate the world; two-finger pinch = zoom; two-finger drag = pan. Consider whether you even need full 3D manipulation. The recommendation is to *simplify to 2D where possible* since most real objects are grounded; reserve the second finger for the extra axis only when needed. (Sources: Inborn Experience AR gestures, arXiv one-touch, LMU one-handed input.)
- **Auto-focus / snap camera to selection.** Trailmakers' "Autofocus" moves the camera to the selected block or group, and it also works in the paint and configure menus. This is enormous on a small screen: when the player taps a connector or part, glide the camera to frame it. It removes the constant manual camera-wrangling that kills mobile building.
- **One-handed reachability.** Portrait mobile means the thumb owns the bottom third of the screen. Put the primary build actions (confirm, rotate, mirror toggle, undo) in a bottom action bar within thumb reach; keep the top for status/budget readouts. (Source: LMU one-handed input via orbits.)
- **Constrain the camera.** Free 6-DOF cameras get players lost. Orbit-around-the-bot with clamped pitch and a "reset/recenter" button is calmer and faster than a free-fly camera on a touch screen.

### D. Juice: sound, haptics, particles, animation on place / merge / delete

Translate the general juice literature into the specific build events you have:

- **On snap/place:** a short scale "pop" (squash-and-stretch overshoot) on the placed part, a brief green flash or rim highlight on the connector, a crisp click SFX, and a light haptic tick. Fire all three channels together. (Blood Moon, GameAnalytics.)
- **On merge / level-up (your signature moment):** this should be the biggest celebration in the app: a bright particle burst at the merge point, the merged part scale-pops and settles, a rising "level up" sound stinger, a stronger haptic, and the level number visibly ticking up. Merge-game analysis explicitly credits the bright particle + satisfying pop + number-jump as *the* reason the genre is addictive. Support and celebrate **chain merges** if two upgraded parts can immediately merge again. (Source: merge roundups.)
- **On delete/remove:** a small "gib"/dissolve or shatter with a downward whoosh, plus a resource refund popup if you refund materials. Destruction feedback makes removal feel intentional, not like an error. (rystorm, Blood Moon.)
- **Layer it, don't dump it.** Build the mechanic first, then add screen/element flash, then particles, then audio, then haptics, iterating one channel at a time. Overdoing juice on a phone (constant heavy shake) is nauseating; keep it tight and short.
- **Haptics rule:** always pair haptics with a matching visual/audio cue; never fire haptics alone. (DesignTheGame.)

### E. Undo / redo, copy / paste, duplication

- **Undo is a creativity enabler, not a safety net.** The Forge analysis is blunt: without reliable undo, players "become much more conservative with their changes." Robust, multi-step undo/redo is what lets players experiment, which is the whole point of a build toy. This is arguably the single highest-leverage non-flashy feature. You already have `editor-history` in VibeKit, so wire it deep.
- **Copy/paste and duplicate parts/sub-assemblies.** Forza's livery tooling and its community editors emphasize duplicate/delete/reorder of layers and groups; Fortnite Creative and Forge support copy/paste of placed objects. Halo Reach players complained loudly about the *lack* of copy/paste, which is a signal of how expected it is. For robots: duplicate a whole arm assembly and mirror it to the other side in one action.
- **Grouping / prefabs.** Forge prefabs, Forza vinyl groups, Trailmakers block groups: select multiple parts, "Create Group," then move/mirror/scale/paint the group as one object. This is the bridge to blueprints (next).

### F. Presets / templates / blueprints / autobuild memory / sharing

- **Autobuild memory.** TotK's Autobuild remembers recent builds (30 stored) and lets you favorite a few (8 slots) to instantly re-summon a whole design. The community's top complaints are instructive as *what to do better*: players want to **name** favorites, want **more** slots, and want to make **minor edits** to a saved design. So: save blueprints, let players name and rename them, give generous slots, and let a saved blueprint be loaded as an editable starting point. (Sources: GameSpot, GamerRant.)
- **Buyable/winnable blueprints as onboarding.** Banjo-Kazooie: Nuts & Bolts lets players *buy or win* prebuilt vehicle blueprints, so you are never forced to build from scratch to progress. This is the accessibility valve: a player who does not want to engineer can still play with a good default, then tweak it. (Source: Jiggywikki, GameSpot Q&A.)
- **Preset color themes / paint libraries.** Gundam Breaker 4 offers preset paint jobs based on real mobile suits as a *starting point* before fine-tuning, and preset color themes per kit. Give players good default paint schemes so a bot looks intentional in two taps, with deep customization available underneath. (Source: ANN advertorial, oneesports.)
- **Sharing by code / seed.** Forza shares liveries by share code; your replays are already `{seed, design ids, simVersion}`. Sharing a bot as a compact code/link is cheap given your deterministic design-id model and drives the community/IKEA-effect loop (people show off what they made).

### G. Progression and unlock cadence

- **Drip-feed parts; do not dump the catalog.** Progression literature warns that too many options or rewards at once overwhelms; the fix is clear, manageable advancement steps with difficulty/complexity rising in sync with the player's growing mastery. Banjo N&B explicitly tuned accessibility-vs-depth *through the progression of the game*, revealing complexity over time. (Sources: gamedesignskills, GamePill, Banjo N&B interview.)
- **Fixed part stats to protect build freedom.** Both Gundam Breaker 4 and Armored Core VI use *fixed, balanced* per-part parameters so cosmetic/structural choices do not silently wreck performance, letting players "focus on creating." If your merge-to-level-up scales stats, keep the scaling legible and consistent so players can build for looks without a hidden penalty. (Source: Gundam Breaker 4 coverage, AC6 guides.)
- **Merge-to-level-up as its own progression curve.** Your merge mechanic *is* a progression system: each merge is a small completion (dopamine) toward a long-term goal (maxed part). Make the near-term merge cheap and frequent, the high-tier merges rare and ceremonial.

### H. Validation feedback (why a build is invalid; budgets shown well)

- **Live budget meters with proactive alerts.** Armored Core VI shows load/weight budgets and *actively alerts* the UI element when a part pushes you over capacity; parts carry weight/EN-load and the assembly warns in-context. KSP shows mass/part-count/delta-v live. Show your budgets (power, weight, connector slots, resource cost) as live meters that update as parts attach, and flash the specific meter that a placement would violate. (Sources: theloadout AC6, KSP VAB.)
- **Explain the *why*, at the point of failure.** Do not just refuse a placement; tint the offending connector/meter and say the reason ("over power budget," "no matching connector"). LEGO's editor prevents illegal states entirely by auto-spacing, which is the gentlest form of validation: make the invalid action impossible rather than punishing it after the fact.
- **Keep the build always-valid where you can.** Prefer designs where the workshop cannot enter a broken state (auto-space, snap-only-to-valid-connectors) over designs that allow a broken build and then scold.

### I. Onboarding a builder without a wall of text

- **Teach through the first build, Mario 1-1 style.** Super Mario Maker's philosophy: most players skip tutorials, and full-screen text overlays kill "the joy of experimenting." Instead teach the concept inside the first playable moment. For the workshop: hand the player a near-complete bot missing one obvious part and a glowing connector, so their first action *is* the tutorial. (Sources: 10Clouds, Appcues, Crooked Pixels.)
- **Discovery over instruction.** Simple drag-and-drop, immediate testable results, iterate. Let the player build, watch the bot fight, and come back to tweak, learning by the feedback loop rather than a manual.
- **Progressive disclosure of tools.** Introduce mirror, groups, paint, and budgets only when the player has a bot that would benefit, not all at once on the first screen.

### J. Making the creation feel like it's YOURS (identity)

- **Naming.** Let players name the bot (and blueprints). Naming is a low-cost, high-attachment IKEA-effect lever, and its absence is TotK Autobuild's most-requested fix.
- **Painting / decals / finish.** Gundam Breaker 4 lets players tune metallic/gloss/matte finish via color wheels, apply decals, and add weathering; those cosmetic choices are the emotional payoff of the whole system and a top reason players value their Gunpla. Even a small palette + a few decals + a finish toggle makes bots feel personal. (Source: Gundam Breaker 4 coverage.)
- **Cosmetic-only identity, no pay/grind-to-win.** Keep identity layers (paint, decals, name, stamps) purely cosmetic so self-expression never becomes a power treadmill. (This also aligns with the project's own stamp/achievement rule set.)
- **Show it off.** Sharing codes, a garage/gallery view, and battle replays that display the player's named, painted bot close the ownership loop: the reward for building is being seen.

---

## 3. Cross-cutting AAA "feel" principles (the short version)

1. Snap invisibly; never make the player be precise on a touch screen.
2. Always show a ghost preview and a valid/invalid color before commit.
3. Fire visual + audio + haptic together on every meaningful build event; keep each short.
4. Make the merge/level-up the juiciest moment in the app, and allow chain merges.
5. Auto-focus the camera to the selection; constrain the camera; thumb-reachable actions.
6. Undo/redo must be bullet-proof so players dare to experiment.
7. Live budget meters that explain *why*, flashing the specific violated meter.
8. Teach inside the first build; no wall of tutorial text.
9. Name it, paint it, share it: cosmetic identity is the retention payoff.
10. Give good default blueprints/paints so non-engineers still get a bot they like.

---

## 4. Prioritized backlog for the VibeBots workshop

Tailored to: mobile portrait, three.js, drag parts onto connectors, merge duplicates to level up, mined-resource economy. Cost estimates are relative: S = small (hours to ~1 day), M = medium (a few days), L = large (multi-day / multi-slice). Ordered high-impact / low-cost first.

### Tier 1: highest impact, lowest cost (do first)

1. **Ghost preview + valid/invalid connector highlight on drag.** *(S-M)*
   Pattern: translucent part rendered at the target connector, connector glows green (valid) / red (invalid) before release.
   Why fun: removes touch-precision anxiety, makes every placement feel deliberate and correct, reads instantly on a small screen. This is the backbone of "feels AAA."

2. **Snap-on-proximity to the nearest valid connector.** *(S-M, likely already partly present)*
   Pattern: TotK-style "get it close and it clicks in," snapping to the nearest legal connector/orientation.
   Why fun: fat-finger-proof; the core interaction stops fighting the player.

3. **Merge/level-up juice pass.** *(S)*
   Pattern: particle burst + scale-pop + rising stinger + haptic + visible level number tick on merge; support/celebrate chain merges.
   Why fun: your signature economy loop becomes the dopamine centerpiece; directly mirrors why merge games are addictive. Cheapest big win.

4. **Place/delete juice pass.** *(S)*
   Pattern: click SFX + connector flash + short haptic on place; dissolve/shatter + refund popup on delete.
   Why fun: every touch feels responsive and physical; deletion feels intentional.

5. **Undo/redo wired through the editor.** *(S-M, VibeKit editor-history exists)*
   Pattern: multi-step undo/redo with thumb-reachable buttons.
   Why fun: unlocks fearless experimentation, which is the entire point of a build toy; quietly the highest-leverage feature.

6. **Auto-focus camera to selection.** *(M)*
   Pattern: tap a part/connector, camera glides to frame it; also when opening paint/config.
   Why fun: eliminates the #1 mobile-3D frustration (camera wrangling) and makes the small screen feel roomy.

7. **Bot naming.** *(S)*
   Pattern: editable name on the bot, shown in garage and battle.
   Why fun: cheapest IKEA-effect / ownership lever; TotK's most-requested missing feature.

### Tier 2: high impact, medium cost

8. **Live budget meters with point-of-failure explanation.** *(M)*
   Pattern: power / weight / slot / resource-cost meters update live as parts attach; the specific meter flashes with a reason when a placement would violate it.
   Why fun: turns invisible constraints into legible, strategic decisions (AC6/KSP feel); prevents the "why won't it let me?" dead end.

9. **Mirror mode across the bot's center plane.** *(M)*
   Pattern: toggle; add/paint/delete/merge applies to the mirrored counterpart too (Trailmakers/Besiege semantics).
   Why fun: halves the work for symmetric bots (the common case) and makes builds look intentional and balanced.

10. **Standardized touch camera grammar + recenter.** *(M)*
    Pattern: one-finger orbit, pinch zoom, two-finger pan, clamped pitch, a recenter button; primary actions in a bottom thumb bar.
    Why fun: matches muscle memory from every other mobile 3D app; keeps the player oriented and one-handed.

11. **Blueprint save/load (named, editable, generous slots).** *(M)*
    Pattern: save a bot as a named blueprint, reload it as an editable starting point; more than 8 slots; explicitly fix TotK's pain points.
    Why fun: lets players iterate on a lineage of designs and re-summon favorites; huge for a battler where you tune between fights.

12. **Duplicate part / sub-assembly (+ mirror-duplicate).** *(M)*
    Pattern: duplicate a part or a grouped assembly; "duplicate and mirror to other side" in one action.
    Why fun: building a second identical arm should be one tap, not a re-build; expected feature whose absence players notice.

13. **Preset paint themes + basic decals + finish toggle.** *(M)*
    Pattern: a few good default color themes (two-tap good-looking bot), a small decal set, metallic/gloss/matte toggle.
    Why fun: cosmetic identity is the emotional payoff; presets give non-artists a sharp result fast (Gundam Breaker model).

### Tier 3: high impact, larger cost (schedule deliberately)

14. **First-build onboarding (Mario 1-1 style).** *(M-L)*
    Pattern: start the player with a near-complete bot missing one part and a glowing connector; their first drag *is* the tutorial; progressive disclosure of mirror/paint/budgets.
    Why fun: teaches by doing, no text wall; preserves the joy of discovery.

15. **Default/starter blueprints you can buy or earn.** *(M)*
    Pattern: Banjo N&B accessibility valve: prebuilt bots available to buy with mined resources or earn, usable as-is or as editable bases.
    Why fun: players who do not want to engineer still progress and still get a bot they can tweak later.

16. **Angle/step snapping controls for rotation and offset.** *(M)*
    Pattern: rotation snaps to increments (e.g. 15/45/90 deg), with a fine mode; step snapping for any free positioning.
    Why fun: makes precise adjustment possible with a fat finger; KSP/Besiege staple.

17. **Grouping / prefabs.** *(L)*
    Pattern: select multiple parts, group, then move/mirror/paint/duplicate the group as one; foundation for richer blueprints.
    Why fun: manages complexity as bots get bigger; enables the duplicate-an-arm workflow at scale.

18. **Share-by-code / garage gallery.** *(M-L)*
    Pattern: export a bot as a compact code/link (leans on your deterministic design-id + seed model); a gallery to browse and show off.
    Why fun: closes the ownership loop, being seen is the reward for building; drives community and the IKEA-effect flywheel.

19. **Radial symmetry (N-fold) for limbs/thrusters.** *(L)*
    Pattern: KSP-style radial symmetry with a selectable count for radially arranged parts.
    Why fun: instant 4-legged / 6-thruster symmetry; niche but delightful for advanced builders.

### Tier 4: polish / stretch

20. **Asset-zoo part tray (real 3D thumbnails at true scale).** *(M-L)*
    Pattern: render parts as live 3D previews (or drop-to-preview in scene) so scale/lighting read correctly, not flat icons.
    Why fun: players judge fit before committing; feels premium. Watch performance on low-end Android.

21. **Snap sound/haptic variety by material or tier.** *(S)*
    Pattern: higher-tier / heavier parts get a beefier click and rumble.
    Why fun: cheap richness; the bot "sounds" like it is getting more serious as it levels.

22. **Stamp/achievement hooks for building milestones.** *(S-M)*
    Pattern: first bot named, first max-level part, first mirrored build, first shared bot (cosmetic only, per project rules).
    Why fun: optional goals that reinforce mastery without a power treadmill.

---

## 5. Notes specific to VibeBots constraints

- **Connectors are your snap magnets.** The Forge magnet-node model maps almost 1:1: each connector is an author-placed snap point with a valid orientation, so you get precise, gap-free, controller/touch-friendly placement for free. Constrain to valid-connector snaps only and you can keep the build *always valid* (LEGO-style), which sidesteps a lot of validation UX.
- **Merge is both economy and juice.** Because merge-to-level-up is your core economic loop, its feedback is not optional polish; it is the primary reason the loop will feel good. Budget real effort for Tier-1 item 3.
- **Mobile portrait first.** Camera auto-focus (item 6) and standardized gestures + thumb bar (item 10) are worth more here than on any other platform; the research on one-handed input and AR gesture grammar all points the same way. Prior VibeBots memory notes that desktop aspect hid off-screen-miner bugs, so validate the workshop camera at 390x760 too.
- **three.js / WebGPU cost.** Keep juice short and GPU-cheap (sprite/particle pops, not heavy post FX) given the WebGL2 fallback path and the project's capability-gating rule; do not gate build juice on WebGPU-only passes.
- **Deterministic sharing is nearly free.** Since designs are already id + seed based, share-by-code (item 18) is mostly UI, not new infra.

---

## Sources

Placement / snapping / editors:
- https://rystorm.com/blog/neat-first-forge-demo (Halo Infinite Forge magnet snapping, asset zoo, undo, prefabs)
- https://dev.epicgames.com/documentation/en-us/fortnite/working-with-the-lego-brick-editor-in-fortnite (LEGO stud/tube snapping, 90-degree increments)
- https://dev.epicgames.com/documentation/en-us/fortnite/hotkey-and-keybinding-shortcuts-in-fortnite-creative (Fortnite Creative grid snap, copy/paste)
- https://halo.fandom.com/wiki/Forge/Tricks and https://www.bungie.net/en/Forums/Post/2601649 (Forge alignment/snapping)

Symmetry / mirror / align:
- https://www.trailmakers.wiki.gg/wiki/Building_Tools (mirror mode mirrors colors/decals/config; autofocus)
- https://besiege.fandom.com/wiki/Advanced_Building (symmetry tool mirrors add/edit/delete; snap value; angle snap)
- https://github.com/linuxgurugamer/EditorExtensionsRedux (KSP radial symmetry, angle snap increments, center align)
- https://itsgamertime.com/hidden-features-of-the-vab-in-kerbal-space-program/ (VAB angle snap/offset/rotation)

Camera / mobile input:
- https://medium.com/inborn-experience/the-essential-guide-to-mobile-ar-gestures-51906df56d3d (drag=rotate, pinch=zoom, two-finger=pan)
- http://www.medien.ifi.lmu.de/pubdb/publications/pub/esteves2022imwut/esteves2022imwut.pdf (one-handed input via orbits/motion matching)
- https://arxiv.org/pdf/2106.14505 (one-touch gesture grammar: drag/slide/swipe/tap)

Juice / game feel / merge:
- https://www.bloodmooninteractive.com/articles/juice.html (layered juice: shake, flash, particles, audio layering)
- https://www.gameanalytics.com/blog/squeezing-more-juice-out-of-your-game-design (combine visual+audio+haptic for impact)
- https://www.designthegame.com/learning/tutorial/how-tactile-interactions-game-juice-drive-player-engagement (haptics must pair with visual/audio)
- https://plarium.com/en/blog/best-merge-games-android/ and https://www.blog.udonis.co/mobile-marketing/mobile-games/top-merge-games (merge = small completions, bright particle + pop + number jump, chain reactions)

Blueprints / autobuild / accessibility:
- https://www.gamespot.com/articles/zelda-tears-of-the-kingdom-autobuild-guide/1100-6514038/ and https://zelda.fandom.com/wiki/Autobuild (Autobuild preview, memory of 30, 8 favorites)
- https://gamerant.com/zelda-tears-of-the-kingdom-small-fixes-to-the-building-system-that-would-change-everything-totk/ (missing naming, more slots, editable saves)
- https://banjokazooiewiki.com/wiki/List_of_Nuts_%26_Bolts_pre-made_vehicles and https://www.gamespot.com/articles/qanda-banjo-kazooie-nuts-and-bolts-vehicle-creator/1100-6197469/ (buy/win blueprints; accessibility vs depth via progression)

Customization depth / identity / validation:
- https://www.animenewsnetwork.com/advertorial/2024-08-28/how-to-create-over-a-quintillion-uniquely-customized-gunpla-in-gundam-breaker-4/.214879 and https://www.oneesports.gg/gaming/gundam-breaker-4-customization-endless/ (color/style wheels, finish, decals, weathering, preset paints, fixed balanced stats, scale/reposition parts)
- https://www.theloadout.com/armored-core-6/assembly-guide (AC6 load/weight budget alerts, Units/Frame/Inner/Expansion)
- https://forzahorizoncar.com/en/guides/livery-editor-guide.html (layer system, group/mirror/resize, snap to guides)

Onboarding:
- https://medium.com/beautiful-code-smart-design-by-10clouds/why-tutorials-are-important-in-ux-design-and-what-we-can-learn-from-super-mario-creators-6ce2a5ecc81b and https://www.appcues.com/blog/3-fundamental-user-onboarding-lessons-from-classic-nintendo-games (teach in first playable moment; players skip tutorials)

Ownership / progression psychology:
- https://ixdf.org/literature/topics/ikea-effect and https://gamemastering.de/ikea-effect/ and https://agate.id/the-ikea-effect-in-gamification-harnessing-player-engagement/ (IKEA effect, ceremony of creation, ownership bias)
- https://gamedesignskills.com/game-design/game-progression/ and https://gamepill.com/level-up-the-art-of-designing-game-progression-and-player-rewards/ (drip-feed, avoid overwhelm, pace complexity with mastery)
