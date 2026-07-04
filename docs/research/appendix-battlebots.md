# BattleBots Research for a Physics-Based Robot-Battler Workshop

Research date: 2026-07-04. Purpose: feed the build-workshop design of VibeBots (deterministic 3D physics robot battler) with real-world combat-robot archetypes, tradeoffs, and translation notes for a mobile physics sim.

All facts below are summarized in our own words from the cited sources. No copyrighted text is reproduced.

---

## Part 1: Notable Bots (winners + fan favorites)

### Modern reboot championship record (Giant Nut winners)

- 2015 (World Championship I): Bite Force
- 2016 (WC II): Tombstone
- 2018 (WC III): Bite Force
- 2019 (WC IV): Bite Force
- 2020 (WC V): End Game (first international winner)
- 2021 (WC VI): Tantrum
- 2022/23 (WC VII): SawBlaze (first hammer-saw to win)
- 2024 (WC VIII): HUGE

Bite Force holds the modern record with three Giant Nuts. Sources: [Giant Nut wiki](https://battlebots.fandom.com/wiki/Giant_Nut), [Robot Wrestling champions by year](https://www.robotwrestling.org/battlebots-champions-by-year/), [Wikipedia: BattleBots](https://en.wikipedia.org/wiki/BattleBots).

Classic Comedy Central era (2000-2002) most-decorated: BioHazard (4 heavyweight titles), Hazard (3 middleweight Giant Nuts, ~17-1), Son of Whyachi (Season 3 heavyweight champ). Source: [Wikipedia: BattleBots](https://en.wikipedia.org/wiki/BattleBots).

---

### 1. Tombstone (Ray Billings)
- **Weapon**: Massive horizontal bar spinner. ~65-75 lb S7 tool-steel bar, tip speed historically cited over 200 mph (capped at 250 mph). Interchangeable bars: a sharp-edged red bar to bite wedges, a heavy gray bar for blunt force.
- **Chassis/drive**: Two-wheel drive, box-shaped, low. Large exposed wheels protrude past the frame, making it invertible and baiting opponents into the blade path.
- **Armor**: Minimal. Armored nose section protecting the front frame and weapon chain; relies on offense over defense. Etek weapon motor, NPC T64 drive motors.
- **Why it mattered**: "King of Kinetic Energy." One of the most destructive bots ever; weapon energy so high it damages itself and opponents. Evolution of Billings' Last Rites/Shin Splitter.
- Sources: [Tombstone wiki](https://battlebots.fandom.com/wiki/Tombstone), [battlebots.com](https://battlebots.com/robot/tombstone-2021/).

### 2. Bite Force (Paul Ventimiglia / Aptyx Designs)
- **Weapon**: Started as a lifting/grabbing jaw (control bot), later evolved into a vertical spinner.
- **Chassis/drive**: Began as a tracked bot with magnets in the tracks for grip; later a four-wheel-drive design. 6061 aluminum frame.
- **Armor**: Efficient, reliable build; emphasis on consistency and drivetrain quality over raw armor mass. Cheap to build (~$15k).
- **Why it mattered**: 26-1 career, 3 Giant Nuts, most successful modern bot. Reliability + driver skill + adaptable weapon.
- Sources: [Bite Force wiki](https://battlebots.fandom.com/wiki/Bite_Force), [battlebots.com](https://battlebots.com/robot/bite-force/).

### 3. Minotaur (Marco Meggiolaro / Team RioBotz, Brazil)
- **Weapon**: Highly destructive horizontal **drum** spinner, ~60-70 lb, originally up to 12,000 rpm (later 11,000 to meet 250 mph cap). Two Scorpion outrunner motors.
- **Chassis/drive**: Compact, aggressive four-wheel-drive brick built around their earlier Touro Maximus. Excellent acceleration and pushing power.
- **Armor**: Modest; leans on speed, aggression, and drum energy.
- **Why it mattered**: Beloved for relentless aggression and crowd energy; drum throws opponents violently while staying controllable.
- Sources: [Minotaur wiki](https://battlebots.fandom.com/wiki/Minotaur), [battlebots.com](https://battlebots.com/robot/minotaur-2021/).

### 4. End Game (Nick Mabey & Jack Barker, New Zealand)
- **Weapon**: Powerful **vertical spinner** hitting ~6000 rpm in under 5 seconds. Interchangeable heads: single-tooth flywheel, asymmetric bar, teardrop disk.
- **Chassis/drive**: Boxy, four-wheel drive. Weapon can self-right the bot; also has a secondary independent self-righting arm.
- **Armor**: Balanced; wedge-forward front to feed the vertical spinner.
- **Why it mattered**: First international Giant Nut winner (2020), two Golden Bolts. Vertical spinner + dependable self-right = few dead ends.
- Sources: [End Game wiki](https://battlebots.fandom.com/wiki/End_Game), [battlebots.com](https://battlebots.com/robot/end-game/).

### 5. Hydra (Jake Ewert)
- **Weapon**: Rear-hinged **flipper**, but hydraulic (unique in BattleBots). Builds spring pressure, uses ~12 oz of fluid as a medium to fire a hydraulic cylinder for near-instant flips. Comparable to or stronger than Bronco without large air tanks.
- **Chassis/drive**: Flat, low, four-wheel drive. Very low profile to get under opponents.
- **Armor**: Low flat wedge body; self-righting via the flipper.
- **Why it mattered**: Fast repeated flips, no big gas tanks, tosses opponents (demonstrated launching a 450 lb quad bike). Control + air time.
- Sources: [Hydra wiki](https://battlebots.fandom.com/wiki/Hydra), [battlebots.com](https://battlebots.com/robot/hydra-2019/).

### 6. Witch Doctor (Mike & Andrea Gellatly)
- **Weapon**: Potent **vertical disc spinner**, ~60 lb hardened S7 tool-steel weapon; discs made AR500-grade to resist shattering.
- **Chassis/drive**: Milled + welded aluminum frame, four-wheel drive, wedge-front to feed the disc.
- **Armor**: Moderate; the wedge front doubles as protection and weapon feed.
- **Why it mattered**: Perennial finalist (multiple runner-up finishes), fan-favorite paint/flair, consistent damage output.
- Sources: [Witch Doctor wiki](https://battlebots.fandom.com/wiki/Witch_Doctor), [battlebots.com](https://battlebots.com/robot/25345/).

### 7. Whiplash (Matt Vasquez / Team Fast Electric Robots)
- **Weapon**: Hybrid **articulated lifter + vertical disc**. Rear-hinged lifter arm carrying a 22 lb spinning disc that rotates ~180 degrees, so it can lift, deal spinner damage, or attack overhead like a hammer-saw. Disc swappable for an AR500 plate.
- **Chassis/drive**: Four-wheel-drive control platform; forks on the arm protected by a wedge.
- **Armor**: Control-focused; forks + wedge for getting under opponents.
- **Why it mattered**: Elite driving (Vasquez is a top-tier modern driver), versatile control-plus-damage tool, WC V runner-up.
- Sources: [Whiplash wiki](https://battlebots.fandom.com/wiki/Whiplash), [battlebots.com](https://battlebots.com/robot/whiplash-2021/).

### 8. SawBlaze (Jamison Go)
- **Weapon**: **Hammer saw**: a vertical spinner on an articulating overhead arm. 16" AR550-steel disc, 250 mph tip speed, titanium blade shaft. A front dustpan/scoop traps the opponent, then the arm brings the saw down.
- **Chassis/drive**: Control-oriented brick; front wedge/dustpan to slide under and pin.
- **Armor**: Solid; the dustpan doubles as protection and control surface.
- **Why it mattered**: First hammer-saw to win the Giant Nut (WC VII). Combines control (pin) with damage (overhead spinner).
- Sources: [SawBlaze wiki](https://battlebots.fandom.com/wiki/SawBlaze), [Hammer Saws wiki](https://battlebots.fandom.com/wiki/Hammer_Saws), [Xometry case study](https://www.xometry.com/resources/case-studies/sawblaze/).

### 9. Copperhead (Team Copperhead)
- **Weapon**: Single-tooth **drum** spinner, ~50 lb S7 tool steel, ~140-180 mph tip speed (tuned lower for more "bite").
- **Chassis/drive**: Two-wheel drive, invertible, compact. Chunky 5"-thick custom rubber wheels for grip.
- **Armor**: Wedge/wedgelets at the front to feed the drum; modest side armor.
- **Why it mattered**: High bite drum that flings opponents; scrappy fan favorite.
- Sources: [Copperhead wiki](https://battlebots.fandom.com/wiki/Copperhead), [Drum Spinners wiki](https://battlebots.fandom.com/wiki/Drum_Spinners).

### 10. Icewave (Marco Meggiolaro-adjacent era / Team Icewave)
- **Weapon**: 54"-long horizontally spinning **bar** (once the largest weapon in robot combat), 47 lb steel, driven by a **15 hp internal combustion engine** (modified Husqvarna concrete saw). Blade mounted slightly forward. Historically ~300 mph, capped to 250.
- **Chassis/drive**: The IC engine sits on top; heavy top-mounted weapon over a low base.
- **Armor**: Base plus weapon carry the mass; vulnerable when the engine stalls or the weapon is stopped.
- **Why it mattered**: Spectacle weapon; gas-engine power means enormous stored energy, but engine reliability/self-righting are weaknesses.
- Sources: [Icewave wiki](https://battlebots.fandom.com/wiki/Icewave), [battlebots.com](https://battlebots.com/robot/icewave/).

### 11. Bronco (Inertia Labs, Reason Bradley & Alexander Rose)
- **Weapon**: Powerful **rear-hinged pneumatic flipper** (compressed nitrogen; CO2 is banned). ~3x the flipping power of their classic-era champ Toro.
- **Chassis/drive**: Wide low four-wheel-drive body; the flipper arm reaches forward under opponents.
- **Armor**: Modest; the flipper front is the working surface.
- **Why it mattered**: Iconic tosses (throwing heavyweights across the box). Inertia Labs pioneered US flippers. Great control + air time, but limited fire count per match.
- Sources: [Bronco wiki](https://battlebots.fandom.com/wiki/Bronco), [Inertia Labs wiki](https://battlebots.fandom.com/wiki/Inertia_Labs).

### 12. Son of Whyachi (Team Whyachi)
- **Weapon**: Caged **3-arm horizontal spinner** ("spinner of death" full-body-ish rotor). Three 10 lb S7 hammers, 120 lb total rotor, eight Magmotors.
- **Chassis/drive**: Originally a "shuffler" walking drive (feet), later moved to wheels/superheavyweight after rule changes.
- **Armor**: The spinning cage of hammers is both weapon and defense; nearly untouchable while spun up.
- **Why it mattered**: First horizontal-spinner heavyweight champ (Season 3, beat BioHazard). Delivered one of the most devastating hits in show history.
- Sources: [Son of Whyachi wiki](https://battlebots.fandom.com/wiki/Son_of_Whyachi).

### 13. BioHazard (Carlo Bertocchini)
- **Weapon**: Four-bar **lifting arm** (control/lifter), fast and immensely strong (each modified linear actuator ~1,400 lb force; ran 12V motors at 24V).
- **Chassis/drive**: Six-wheel box, one of the shortest heavyweights ever (~4" tall), hinged skirts to seal to the floor.
- **Armor**: Low-profile invulnerability: nothing could get under it. Titanium-era plating and careful low CG.
- **Why it mattered**: 4 heavyweight titles. The archetypal control/wedge-lifter: win by dominance, not destruction.
- Sources: [BioHazard wiki](https://battlebots.fandom.com/wiki/BioHazard), [Wikipedia](https://en.wikipedia.org/wiki/BioHazard).

### 14. Hazard (Tony Buchignani & Dan Danknick / Team Delta)
- **Weapon**: Top-mounted **horizontal steel blade** (overhead bar spinner).
- **Chassis/drive**: Four-wheel drive, box-shaped, clean and reliable.
- **Armor**: Solid box; blade sweeps above the deck.
- **Why it mattered**: 3 middleweight Giant Nuts, ~17-1, near-undefeated. Proof that a disciplined overhead spinner + good drive dominates a weight class.
- Sources: [Hazard wiki](https://battlebots.fandom.com/wiki/Hazard).

### 15. Vlad the Impaler (Gage Cauchois / Team Vladmeisters)
- **Weapon**: **Lifting forks/spikes** on a pulley system + a pneumatic self-righting piston.
- **Chassis/drive**: Four wheels driven from two motors via chains/sprockets; reliable. Tip magnets keep forks flush to the floor.
- **Armor**: Shock-isolation ("wubs") between shell and frame to absorb kinetic-weapon hits; generous gap between shell and internals.
- **Why it mattered**: Reigning champ known for reliability and control. Pioneered floor magnets and shock-isolation still used today.
- Sources: [Vlad the Impaler wiki](https://battlebots.fandom.com/wiki/Vlad_the_Impaler).

### 16. Tantrum (Seems Reasonable Robotics)
- **Weapon**: Unique **"puncher"**: a vertical spinning S7 drum on a sliding mechanism (retracts/extends for a punch-like hit).
- **Chassis/drive**: Four-wheel drive with custom wheels housing planetary gears; nimble and tough.
- **Armor**: Well-armored, durable; survives exchanges then out-drives.
- **Why it mattered**: WC VI champion (2021). Durability + control + a compact punching drum, a fresh weapon idea.
- Sources: [Tantrum wiki](https://battlebots.fandom.com/wiki/Tantrum), [battlebots.com](https://battlebots.com/robot/tantrum-wcvii/).

### 17. Razer (UK, Ian Lewis & Simon Scott)
- **Weapon**: Hydraulic **crusher / beak** exerting ~3 tonnes at the tip; pierces armor and internals.
- **Chassis/drive**: Four-wheel drive, wedge-shaped profile; beak arcs down to clamp.
- **Armor**: Wedge body; self-rights via wing panels beside the beak.
- **Why it mattered**: First famous crusher in the sport; iconic design, immense localized force, huge showmanship. Slow but surgical.
- Sources: [Razer wiki](https://battlebots.fandom.com/wiki/Razer), [Crushers wiki](https://battlebots.fandom.com/wiki/Crushers), [Wikipedia: Razer](https://en.wikipedia.org/wiki/Razer_(robot)).

### 18. HUGE (Jonathan Schultz)
- **Weapon**: Vertical **bar spinner** carried high between two enormous wheels.
- **Chassis/drive**: Two-wheel drive "Big-Wheel" design: 40"-diameter UHMW + Tegris wheels (~30 lb each); thin-profile body slung between them. UHMW legs brace/balance.
- **Armor**: The giant compliant UHMW wheels absorb hits and are hard to attack; the thin body sits above most opponents' weapons.
- **Why it mattered**: 2024 Giant Nut winner. One-of-a-kind silhouette; the wheels make it nearly immune to horizontal spinners and let its bar reach top panels.
- Sources: [HUGE wiki](https://battlebots.fandom.com/wiki/HUGE), [About the Robot](https://hugebattlebots.com/about-the-robot), [Common Robot Types (NHRL)](https://wiki.nhrl.io/wiki/index.php/Common_Robot_Types).

---

## Part 2: Game-Ready Archetypes

### 2A. Core / Chassis Body Archetypes

The chassis defines silhouette, center of gravity (CG), wheel exposure, weapon mounting points, and self-right behavior. Recommend 6 distinct bodies.

**C1. Low Invertible Wedge/Box** (Tombstone, Copperhead, Hydra base, Bite Force)
- Silhouette: flat, low, symmetric top/bottom so it works upside down. Wheels often exposed at the sides.
- Tradeoffs: best weapon energy and hardest to get under; poor if the chosen weapon can't self-right and it lands on a non-driving face. Low CG = stable, hard to flip.
- Suits: horizontal spinners, drums, low flippers. Light-to-medium armor.

**C2. Tall Brick / Heavyweight Box** (Hazard, Tantrum, Vlad, Witch Doctor)
- Silhouette: taller box with enclosed wheels, top-mounted or front weapon.
- Tradeoffs: room for big batteries, armor, and reliable drive; higher CG so easier to flip; needs a self-right if invertible weapons hit it.
- Suits: overhead spinners, lifters, crushers, punchers. Medium-heavy armor.

**C3. Wide Low Horizontal-Spinner Platform** (Icewave, Son of Whyachi, Minotaur variants)
- Silhouette: broad, low, weapon mass dominating the top or full perimeter; short wheelbase.
- Tradeoffs: enormous weapon reach and gyro presence; huge recoil pushes the bot around; fragile once the weapon is stopped; hard to self-right if top-heavy.
- Suits: big horizontal bars, shells, ring/full-body rotors. Sacrificial/minimal armor because offense is defense.

**C4. Six-Wheel Control Brick** (BioHazard, Vlad)
- Silhouette: ultra-low, long, many small wheels, hinged floor skirts.
- Tradeoffs: unbeatable "get under" game and traction; low damage output; slower turning; the whole strategy fails against a bot even lower or a strong spinner.
- Suits: lifters, forks, clamps, control wedges. Hardened low-front plate.

**C5. Two-Wheel Self-Righting / Egg** (End Game-style compact, drum bots)
- Silhouette: narrow, two large drive wheels, weapon at the front, weapon or arc self-rights it.
- Tradeoffs: cheap, agile, weapon doubles as self-right; only two contact points so pushed around easily; tips over readily but recovers.
- Suits: vertical spinners and drums (which naturally self-right). Light armor.

**C6. Big-Wheel / Slung-Body** (HUGE)
- Silhouette: two oversized compliant wheels with a thin weapon body suspended between them, riding high.
- Tradeoffs: near-immune to horizontal spinners and floor-hugging control bots, reaches over wedges; awful pushing power, unstable, weird handling, easy to high-center.
- Suits: vertical spinner only. Armor lives in the wheels (compliant UHMW), not plate.

Optional 7th if you want variety: **Drum-Front Pram** (Copperhead/Minotaur read as this) is really C1/C5 with a dedicated front drum pocket, a low two-wheel body whose entire front face is the weapon feed. Worth exposing as its own preset because the drum-pocket geometry differs from a bar spinner mount.

### 2B. Weapon Archetypes

For each: damage pattern, sim translation (impulse/energy, recoil, reach), and counters. In a deterministic sim, model kinetic weapons as a stored-energy flywheel: `E = 0.5 * I * w^2`. A hit converts some fraction of E into an impulse on the contact point (both bots), applies self-recoil to the attacker, and spends "spin-up" energy from a budget. Cap tip speed (mirror the real 250 mph rule) to keep energy bounded and deterministic.

**W1. Vertical Spinner** (End Game, Witch Doctor, HUGE)
- Damage: upward-throwing hits; launches opponents and self, tends to self-right the attacker.
- Sim: high stored E; contact impulse mostly vertical (+ some horizontal). Recoil throws attacker up/back. Reach = disc radius at front. Spin-up cost moderate.
- Counters: get on top, control bots (lifters) that avoid the front, brick durability, big-wheel bots that ride above it.

**W2. Horizontal Spinner (bar / shell / ring)** (Tombstone, Icewave, Hazard)
- Damage: sideways-throwing, huge reach, hits anything in the sweep plane.
- Sim: highest stored E and biggest gyroscopic + recoil effects; every hit shoves the attacker sideways (model as reaction impulse + angular kick). Reach = bar half-length. Expensive spin-up; self-damage risk on hard hits.
- Counters: wedges/forks that get under before the bar bites, invertible low bots, tanky sacrificial armor, attacking the exposed wheels, big-wheel immunity.

**W3. Drum** (Minotaur, Copperhead, Tantrum's puncher)
- Damage: high "bite" (grabs and flings) with lower reach than a bar; controllable.
- Sim: medium-high E, short reach (drum sits in a front pocket), strong forward-throw impulse, lower recoil than a long bar, fast spin-up. Great for repeated controlled hits.
- Counters: getting under it, taller bots, overhead weapons that hit the drum housing.

**W4. Hammer / Axe** (overhead striker)
- Damage: single localized downward blow; good vs top armor, low continuous threat.
- Sim: model as an actuated arm with an impulse on swing; energy per swing from an actuator budget with a cooldown. Short reach, needs the opponent pinned/adjacent. Little recoil.
- Counters: mobility, spinners that hit before the swing lands, thick top plate.

**W5. Hammer Saw** (SawBlaze)
- Damage: overhead spinning disc on an arm; combines W1 damage with W4 control/placement.
- Sim: a spinning flywheel mounted on an articulated arm; when arm is down and in contact, apply spinner impulse. Two energy budgets: arm actuation + weapon spin. Reach set by arm length. Needs a control/pin surface to be effective.
- Counters: staying mobile, out-driving, spinners that disable the arm.

**W6. Flipper / Launcher (pneumatic/hydraulic)** (Bronco, Hydra)
- Damage: no material damage, but launches opponents (self-damage on their landing) and can throw them out of arena / immobilize by inversion.
- Sim: instantaneous large vertical impulse at the front contact when fired; consume one "shot" from a limited gas/charge budget with recharge time. Reach short (must be under the target). Little attacker recoil, but a big vertical impulse can pop the attacker too.
- Counters: low invertible bots that self-right, weight/traction, spinners that damage the flipper arm, running the flipper out of air.

**W7. Lifter** (BioHazard, Whiplash arm)
- Damage: control weapon; tips opponents, exposes their belly, can pin.
- Sim: actuated arm applying a sustained lifting force (not an impulse). Model as a motor torque limit and a max lift load. Cheap energy, high uptime. Reach short; must get under.
- Counters: even-lower bots, spinners, brute pushing.

**W8. Crusher / Clamp** (Razer)
- Damage: very high localized, slow; pierces armor, can immobilize by grabbing.
- Sim: a clamp joint that, on grab, applies a large sustained force at a point (penetration/HP damage over time) and creates a physics constraint linking the two bots (control). Slow actuation, needs the opponent stationary/adjacent. Minimal reach.
- Counters: speed, spinners, being too big to grab, wedge control.

**W9. Wedge / Control (no active weapon)** (BioHazard-as-wedge, Whiplash forks)
- Damage: none directly; wins by control, pushing into hazards/walls, and inverting.
- Sim: pure geometry: a low front ramp that converts an opponent's forward motion into upward displacement (redirect their velocity). Zero weapon energy cost.
- Counters: other wedges (wedge wars), spinners that damage the wedge, bots that can self-right after being flipped.

**W10. Saw** (secondary cutting disc)
- Damage: low, cosmetic-to-moderate; slices soft armor.
- Sim: small flywheel, low impulse, mostly a finisher/support weapon. Usually pair with a control primary.
- Counters: hardened plate, mobility.

**W11. Spinner-of-Death / Full-Body Rotor** (Son of Whyachi)
- Damage: perimeter shell/ring that is weapon and armor at once; hits from any angle.
- Sim: rotor as both a large-I flywheel and a defensive collision surface; while spun up, incoming contacts also transfer energy back to the attacker. Enormous recoil and drift; hard to steer while spun up (melty-brain style).
- Counters: wedges before spin-up, pinning, arena hazards, waiting it out.

**W12. Multibot** (two+ coordinated units)
- Damage: split forces; one controls, one damages.
- Sim: two independent bodies sharing a health pool or win condition; AI coordination. Cheap individually, fragile individually. Great for a "swarm" archetype in a game.
- Counters: area weapons, killing one to cripple coordination.

### 2C. Armor Archetypes

**A1. Forks / Wedges (geometric armor)**: thin hardened front ramps that get under opponents and deflect spinners. Cheap weight, no HP, pure geometry. Tradeoff: only protects the front arc; useless from the side/top.

**A2. Hardened Plate (AR500/AR550/titanium analogues)**: high HP per panel, resists spinner bite. Heavy, so it trades speed and weapon budget. Best on brick and control bodies. Model as high HP + high impact threshold per hit.

**A3. UHMW / Poly (compliant plastic)**: absorbs and rebounds kinetic hits, cracks instead of transmitting shock; light. Great vs spinners (deadens energy) but poor vs crushers/piercers. HUGE's wheels are the extreme case. Model as damping/energy-absorption + lower pierce resistance.

**A4. Spinning Outer Shell**: the rotor doubles as armor (Son of Whyachi); nearly untouchable while spun up, defenseless when stopped. Model as conditional armor tied to weapon RPM.

**A5. Sacrificial / Modular Panels**: cheap bolt-on panels that take a hit and detach/break, protecting internals; swap between matches. Model as destructible sub-parts with their own HP that pop off. Good gameplay hook for a workshop (visible damage + repair economy).

**A6. Shock Isolation ("wubs" / rubber mounts)** (Vlad the Impaler): not outer armor but internal, decouples the shell from vital components so kinetic hits don't destroy electronics. Model as a damage-reduction modifier on internal-component damage, distinct from panel HP.

---

## Part 3: Implementation Priority Notes (for the physics sim)

- The kinetic-weapon energy model (`E = 0.5*I*w^2`, capped tip speed, impulse-on-contact, attacker recoil, spin-up budget) is the single most important system; it drives vertical spinners, horizontal spinners, and drums, which together account for the majority of iconic bots.
- Self-righting is a first-class mechanic, not an afterthought: many top bots (End Game, Bite Force, Vlad, Razer, Hydra) win/lose on it. Give the invertible bodies (C1, C5) a "weapon self-rights" flag and give bricks (C2) a dedicated srimech part.
- Wedge geometry (W9/A1) is a deterministic velocity-redirect, essentially free to compute and a hard counter to spinners: it makes the rock-paper-scissors legible.
- Gyroscopic/recoil drift on big horizontal spinners is what makes them feel real and gives them a downside; worth simulating even approximately.

---

## Source List

- [Giant Nut wiki](https://battlebots.fandom.com/wiki/Giant_Nut)
- [List of Award-Winning Robots](https://battlebots.fandom.com/wiki/List_of_Award-Winning_Robots)
- [Robot Wrestling: Champions by Year](https://www.robotwrestling.org/battlebots-champions-by-year/)
- [Wikipedia: BattleBots](https://en.wikipedia.org/wiki/BattleBots)
- [Tombstone](https://battlebots.fandom.com/wiki/Tombstone) / [battlebots.com](https://battlebots.com/robot/tombstone-2021/)
- [Bite Force](https://battlebots.fandom.com/wiki/Bite_Force) / [battlebots.com](https://battlebots.com/robot/bite-force/)
- [Minotaur](https://battlebots.fandom.com/wiki/Minotaur) / [battlebots.com](https://battlebots.com/robot/minotaur-2021/)
- [End Game](https://battlebots.fandom.com/wiki/End_Game) / [battlebots.com](https://battlebots.com/robot/end-game/)
- [Hydra](https://battlebots.fandom.com/wiki/Hydra) / [battlebots.com](https://battlebots.com/robot/hydra-2019/)
- [Witch Doctor](https://battlebots.fandom.com/wiki/Witch_Doctor) / [battlebots.com](https://battlebots.com/robot/25345/)
- [Whiplash](https://battlebots.fandom.com/wiki/Whiplash) / [battlebots.com](https://battlebots.com/robot/whiplash-2021/)
- [SawBlaze](https://battlebots.fandom.com/wiki/SawBlaze) / [Hammer Saws](https://battlebots.fandom.com/wiki/Hammer_Saws) / [Xometry](https://www.xometry.com/resources/case-studies/sawblaze/)
- [Copperhead](https://battlebots.fandom.com/wiki/Copperhead) / [Drum Spinners](https://battlebots.fandom.com/wiki/Drum_Spinners)
- [Icewave](https://battlebots.fandom.com/wiki/Icewave) / [battlebots.com](https://battlebots.com/robot/icewave/)
- [Bronco](https://battlebots.fandom.com/wiki/Bronco) / [Inertia Labs](https://battlebots.fandom.com/wiki/Inertia_Labs)
- [Son of Whyachi](https://battlebots.fandom.com/wiki/Son_of_Whyachi)
- [BioHazard](https://battlebots.fandom.com/wiki/BioHazard) / [Wikipedia](https://en.wikipedia.org/wiki/BioHazard)
- [Hazard](https://battlebots.fandom.com/wiki/Hazard)
- [Vlad the Impaler](https://battlebots.fandom.com/wiki/Vlad_the_Impaler)
- [Tantrum](https://battlebots.fandom.com/wiki/Tantrum) / [battlebots.com](https://battlebots.com/robot/tantrum-wcvii/)
- [Razer](https://battlebots.fandom.com/wiki/Razer) / [Crushers](https://battlebots.fandom.com/wiki/Crushers) / [Wikipedia](https://en.wikipedia.org/wiki/Razer_(robot))
- [HUGE](https://battlebots.fandom.com/wiki/HUGE) / [Team HUGE](https://hugebattlebots.com/about-the-robot) / [NHRL Common Robot Types](https://wiki.nhrl.io/wiki/index.php/Common_Robot_Types)
