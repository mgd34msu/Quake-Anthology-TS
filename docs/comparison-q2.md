# Q2 donor and unified-engine comparison

This audit covers all **193 Q2 feature IDs** in [verification/features/q2.json](../verification/features/q2.json), plus core scheduling, collision and native execution that cross family boundaries. It is a source-grounded checklist as of 2026-09-12, not a claim of exhaustive function-level equivalence or completed product acceptance. Every inventoried Q2 feature appears once in the final table. A feature not yet in that inventory is not thereby excluded from the target.

The brain source/fixture changes cited below were pushed in commit `8f5e9a3e70cd66ca86ce1f9718e2a6cd61827bbb` after isolated strict TypeScript and policy checks passed and root reported 8 focused tests/260 assertions passing. The installed executable remains at `e20b6d6`; source verification does not claim that newer code is installed.

The target is one engine with the best supported common implementation and the union of useful source features. No Q3 subsystem wins by default. Intentional gameplay, source file formats, units and mod/protocol contracts remain selectable or compatible where required. Legacy capacity and quality limits are not mandatory merely because a donor exposes them. Map-authored lava, jumppads, movers, goals and missions remain map-owned; surgical map mixing is deferred.

**Chosen** means the inspected shared implementation is the current architectural choice, with its reason stated. **Provisional** means a sensible foundation exists but comparative fidelity, performance or workflow evidence is missing. **Uncompared** means this audit cannot rank alternatives. None of these terms means full acceptance. Current adoption and recommended final consolidation are separate: parallel legacy implementations can exist today without being the desired final architecture.

Compatibility preserves movement, weapon/combat/monster/mode semantics, authored triggers, resource formats and external API/wire contracts for a stated reason. An eight-voice cap, paletted intermediate clipping, seat-zero shortcut or global device assumption is an implementation limit to improve unless the user deliberately selects exact classic reproduction. High-quality rendering, scalable audio, input and accessibility capabilities should be available universally.

## Inputs and evidence limits

The source census already pins the following inputs in [source-manifest.json](../verification/source-manifest.json). These are the manifest's revisions, not a fresh Git/remote check. This audit did not run Git, rewrite the census, run global tests, open a desktop game or play audio. Linked source paths were checked on disk. Historical source-status prose is not promoted to current verification.

| Input | Manifest revision | Role |
| --- | --- | --- |
| `../quake-2-re-ts` | `0d73750cbe5683c7411934d0a5d4eb5acd4da676` | TypeScript donor: classic programs, KEX adaptation, renderer, seats, client and protocols |
| `../qsrc/quake-2` | `372afde46e7defc9dd2d719a1732b8ace1fa096e` | Original classic game/engine contracts |
| `../qsrc/quake2-rerelease-dll` | `8dc1fc9794c01ece06881e703851b768fb3994de` | Official merged rerelease game/cgame contracts; game source is not the proprietary KEX renderer |
| `../qsrc/q2repro` | `dafa004c6f0a3218f426dc661412ffdc1ed2a523` | Rerelease-compatible client/renderer, extensions and networking |
| `../qsrc/lmctf60` | `c518031380d2b59a41667c164353033aaa309e90` | LMCTF original behavior |

The Q2 TypeScript source-set hash in that census is `84d108c6a589ddac6404416ab15bb9ff8f3099727ce50812409ab3d0b86ed1f5` across 1,193 pinned files. Hashing proves identity, not behavior. The [feature ledger](../verification/feature-ledger.json) explicitly says implementation and acceptance are not established; this document does not turn its 193 requirements into 193 passing checks.

Original contracts outrank donor omissions. The earlier [Q2 interoperability assessment](research/q2-interoperability.md) found missing classic-adaptation save fields, an empty flashlight action, missing achievement/story adaptation and a Q64 server/client configuration mismatch. Those are historical donor findings, not approved semantics and not proof that the corresponding unified defects still exist. Current joins and gaps are listed below.

## Actual bounded evidence used here

| Evidence | What was actually exercised | What it does not establish |
| --- | --- | --- |
| B1 | [monster-cadence.test.ts](../tests/first-playable/simulation/monster-cadence.test.ts): actual e1m1, RR infantry four 25 ms turns and classic one 100 ms turn, fractional boundary, fresh restore, mixed Q3 grenade interval. Passed 59 assertions in the implementation task. | All mixed cadence, physics or source RNG cases |
| B2 | [rerelease-monster-projectile.test.ts](../tests/first-playable/simulation/rerelease-monster-projectile.test.ts): actual base3 physical RR parasite tip/segment callbacks, drain and fresh save. Passed 36 assertions after removal of the duplicate classic beam. [models.test.ts](../tests/render/commands/models/models.test.ts): real RR MD2 centered segments, final stretch and orientation. Full model suite passed before the final added geometry assertions; focused final beam case passed 22 assertions. | Complete creature rendering, brightness parity, MD5 replacement parity or network beam presentation |
| B2 images | `.artifacts/tmp/rr-creature-render/{cpu,gl}-parasite-attack.png`, independently inspected. Same base3 observer at `(-112,-300,-167.96875)`, angles `(30,90,0)`, FOV 110; actual parasite and flying tip. Source lit corridor remains dark. | Matching CPU/GL images are not proof of matching KEX pixels. Native KEX renderer was not available; official RF_BEAM docs plus q2repro `src/client/tent.c:CL_DrawBeam` ground segment behavior. |
| B3 | Existing [selected-q2-monsters.test.ts](../tests/first-playable/simulation/selected-q2-monsters.test.ts), [monster-projectile-save.test.ts](../tests/first-playable/simulation/monster-projectile-save.test.ts), [rerelease-heavy-projectile.test.ts](../tests/first-playable/simulation/rerelease-heavy-projectile.test.ts) retain implementation-team evidence for actual mutant jump and source projectile saves. | This audit did not rerun every one of those suites; they are not complete encounter acceptance. |
| B4 | [aquatic-monsters.test.ts](../tests/first-playable/simulation/aquatic-monsters.test.ts): native versus selected classic/RR train flippers, actual water, natural chase/bites and fresh save. Final provider-typed fixture passed 2 tests/46 assertions. Q1 fish evidence is recorded by its family owner, not counted as Q2 coverage. | Land behavior, all authored water maps or arbitrary substitutions |
| B5 | [brain-armor.test.ts](../tests/first-playable/simulation/brain-armor.test.ts): actual selected Q1 shotgun/Q3 machinegun on fact1 RR brain, front protection/rear bypass, shared cell restore/continued consumption; one-damage shared-authority probe compared with native RR brain. Full pair passed 73 assertions; final Q1 branch with null/world direction controls passed 44 assertions, Q3 branch unchanged. | The one-damage request is not an actual weapon shot. Q3-native-world combat bridge is a separate uncovered path. Global strict/policy acceptance belongs to the checkpoint writer. |

Other named test files below are **existing evidence targets**, not tests newly executed by this audit. Recorded reports in [execution-status.md](execution-status.md) remain bounded and historical unless identified above. No campaign, networking matrix, guest runtime or renderer family is marked fully complete.

## Source products

| Product | Source/program paths | Current shared dispatch and remaining limit |
| --- | --- | --- |
| Classic baseq2 | Donor `src/game`; original `game` | Shared Q2 base composition; bounded actual base-map proofs above, no complete campaign acceptance |
| Classic Xatrix | Donor `src/xatrix`; original rerelease repository `original/xatrix` | Mission-pack modules exist; full selected-arsenal/campaign matrix unverified |
| Classic Rogue | Donor `src/rogue`; original `original/rogue` | Mission-pack modules and mode policies exist; full campaign/unique item lifecycle unverified |
| Classic CTF | Donor `src/ctf`; original `original/ctf` | Shared CTF match/equipment; all peer/mode combinations unverified |
| Classic LMCTF | Donor `src/lmctf`; `qsrc/lmctf60` | Shared LMCTF source module; complete original-host agreement/tournament acceptance open |
| RR baseq2 | Donor `src/kexgame`; official `rerelease` | Actual RR definitions and cadence on shared services; narrower selected admission than full native registrar |
| RR Xatrix | Donor `src/kexgame/xatrix`; official `rerelease/xatrix` | Explicit rerelease program dispatch; full campaign and mixed selection unverified |
| RR Rogue | Donor `src/kexgame/rogue`; official `rerelease/rogue` | Explicit rerelease program dispatch; full campaign and mode lifecycle unverified |
| RR CTF | Donor `src/kexgame/g_ctf.ts`; official `rerelease/g_ctf.cpp` | Shared match policy; not a claim of complete KEX native wire support |
| Call of the Machine (`mg2`) | Official merged rerelease plus authored MG2 maps | Catalog and source dispatch exist; full hubs/bosses/endings remain unqualified |
| Q2 64 (`n64`) | Official merged rerelease, Q64 movement settings and authored maps | Explicit Q64 module; server/prediction/profile parity needs actual matched-stream evidence |

These are the 11 Q2 product rows in [catalog/products.ts](../src/content/catalog/products.ts). The donor's `lmctf-kex` adaptation is a distinct mod/presentation/transport arrangement; it is not an extra proven unified product. Classic and rerelease geometry/assets/programs must retain explicit provenance when mixed.

## Common foundations, useful union and retained policies

The following groups supply the unified paths, reasoning, evidence and limits used by every feature row in the inventory below. Native modules are considered imported when their implementation exists; **runtime integration is a separate column in the feature inventory**.

<a id="g01"></a>

### G01 Catalog, mounts and launch

Unified paths: [src/content/catalog/launch.ts](../src/content/catalog/launch.ts), [src/content/catalog/products.ts](../src/content/catalog/products.ts), [src/content/mounts/index.ts](../src/content/mounts/index.ts), [src/app/bootstrap/startup.ts](../src/app/bootstrap/startup.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen common catalog and resource provenance. Q2 donor menu_content.ts/files.ts separates map edition, game code and auxiliary assets; unified typed recipes retain these identities rather than comparing filenames. | Expose discovery, dependency diagnostics, mount generations and ordered map rotations to every family. | Game program, asset edition and map provider remain independently selected; borrowed resources must not replace the owning program. | Actual fact1/train/e1m1 selected launch paths exercised in B1–B4. Existing tests/content/catalog cover resolution. **Remaining:** Arbitrary discovered mods do not establish executable gameplay support; complete rotation editing and live-remount UI parity remain unverified. |

<a id="g02"></a>

### G02 Game dispatch and authored entity precedence

Unified paths: [src/content/composition/q2/index.ts](../src/content/composition/q2/index.ts), [src/app/bootstrap/simulation/monster-runtime.ts](../src/app/bootstrap/simulation/monster-runtime.ts), [src/app/bootstrap/simulation/runtime.ts](../src/app/bootstrap/simulation/runtime.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen shared actor/body table with source controllers. Donor server/bindings/legacy.ts and kex.ts isolate game APIs but duplicate world ownership; the unified controller join preserves one actor identity and map mission. | Expose explicit behavior selection, source callbacks and item-supply conversion across games. | Authored maps own triggers, hazards, jumppads, objectives and mission links. No automatic replacement of map lava or launch pads by movement/weapon family. | B1–B4 preserve map actor ownership. Runtime admission rejects unimplemented authored spawns and unsupported spawn flags. **Remaining:** Admission is deliberately narrower than the full source spawn table. Arbitrary per-map entity mixing remains deferred. |

<a id="g03"></a>

### G03 Base weapons and projectile state

Unified paths: [src/content/q2/foundation/weapons/index.ts](../src/content/q2/foundation/weapons/index.ts), [src/app/bootstrap/simulation/arsenal/q2.ts](../src/app/bootstrap/simulation/arsenal/q2.ts), [src/persistence/q2-weapons.ts](../src/persistence/q2-weapons.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen actual Q2 weapon state machines behind shared combat/physics, not a Q3 weapon approximation. Original game/p_weapon.c and rerelease/p_weapon.cpp define cadence and fire order. | Expose selectable arsenals, per-weapon resources, reliable source projectile continuation and owned effects universally. | Classic 100 ms and rerelease 25 ms timing, ammo, charge/cook behavior, spread and recoil remain source policies. | B1 proves mixed weapon/monster deadlines; B2/B3 prove selected source projectile saves. Other base weapon fixtures exist under tests/gameplay/foundation/q2. **Remaining:** Every weapon × map × movement combination is not verified; expansion selected arsenals have separate admission limits. |

<a id="g04"></a>

### G04 Inventory, pickups and powerups

Unified paths: [src/content/q2/foundation/items.ts](../src/content/q2/foundation/items.ts), [src/content/composition/q1-q2-supply.ts](../src/content/composition/q1-q2-supply.ts), [src/content/composition/q2-q3-supply.ts](../src/content/composition/q2-q3-supply.ts), [src/world/gameplay/inventory.ts](../src/world/gameplay/inventory.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen shared inventory with source item modules and explicit supply profiles. This preserves Q2 salvage, capacity and timed effects rather than erasing them in a generic item count. | Expose capacity changes, pickup eligibility, shared timed effects and explicit cross-family supply mappings. | Armor salvage, coop item sharing/instancing, deathmatch respawn/drop and powerup stacking remain selected source/match policies. | B5 proves monster cells through shared inventory and restore. Existing composition and Q2 item/player tests are runnable evidence targets. **Remaining:** Full pickup replacement matrix and expansion supply profiles remain partial; no full foreign-inventory equivalence claim. |

<a id="g05"></a>

### G05 Damage, armor and momentum

Unified paths: [src/world/gameplay/armor.ts](../src/world/gameplay/armor.ts), [src/world/gameplay/policies.ts](../src/world/gameplay/policies.ts), [src/world/gameplay/authority.ts](../src/world/gameplay/authority.ts), [src/app/bootstrap/simulation/runtime.ts](../src/app/bootstrap/simulation/runtime.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen single GameplayAuthority with native victim armor. Q2 screen direction/cells and rerelease minimum absorption are valuable behavior that a Q3-only armor formula would lose. | Expose direction-aware protection, damage provenance, shared armor-cell binding and source feedback to every attacker family. | Attacker damage flags/arithmetic and victim armor edition are distinct. Q1 center-only contact uses reverse incoming direction only for non-world inflictors; actual contact points retain precedence. | B5 actual Q1 shotgun/Q3 machinegun front/rear hits, fresh cells and native RR one-damage control. No new global combat policy introduced. **Remaining:** Q3 native-world combat bridge still supplies constant facing zero/no Q2 profile; that separate path is not covered by B5. Full pitched-screen/source precision comparison remains open. |

<a id="g06"></a>

### G06 Ordinary monsters and source AI

Unified paths: [src/content/q2/base/monsters/index.ts](../src/content/q2/base/monsters/index.ts), [src/content/q2/rerelease/monsters/index.ts](../src/content/q2/rerelease/monsters/index.ts), [src/content/q2/foundation/monsters/index.ts](../src/content/q2/foundation/monsters/index.ts), [src/content/q2/foundation/monsters/alternate-fly.ts](../src/content/q2/foundation/monsters/alternate-fly.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen actual classic/RR definitions on one Q2Monsters controller. Donor translated legacy copies can omit rerelease details; original rerelease game definitions outrank such omissions. | Expose swimming, flying, alternate flight, source pain/death, projectile callbacks and shared saves across admissible maps. | Think arithmetic/order, hulls, source randomness, sight rules, water behavior and corpse/gib semantics remain edition policies. | B1–B5 cover infantry cadence, parasite appendage, heavy projectile source, mutant jump, aquatic chase/bites and brain armor in bounded retail maps. **Remaining:** Full bosses, medic resurrection, mission-pack variants and authored encounter obligations are not admitted merely because native modules exist. Full roster/animation parity is unproven. |

<a id="g07"></a>

### G07 World entities, movers and cameras

Unified paths: [src/content/q2/base/entities/index.ts](../src/content/q2/base/entities/index.ts), [src/content/q2/foundation/movers.ts](../src/content/q2/foundation/movers.ts), [src/content/q2/rerelease/entities.ts](../src/content/q2/rerelease/entities.ts), [src/content/q2/rerelease/triggers.ts](../src/content/q2/rerelease/triggers.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen map-owned entity programs sharing world physics. Original g_func/g_trigger/g_target behavior remains authoritative; a generic Q3 trigger translation would lose target-chain semantics. | Expose reusable mover/camera/trigger services and source-controlled effects without transferring map authority. | Lava, slime, crushers, jumppads, gravity zones, cameras and mission triggers stay with the authored map/program. | Existing tests/gameplay/q2-base and tests/gameplay/q2-rerelease cover source entities; B4 uses actual map water/geometry, not rewritten water. **Remaining:** All target chains and campaign puzzle solutions need actual map acceptance. Presence of a spawn implementation is not that proof. |

<a id="g08"></a>

### G08 The Reckoning

Unified paths: [src/content/q2/missionpacks/weapons/definitions.ts](../src/content/q2/missionpacks/weapons/definitions.ts), [src/content/q2/missionpacks/projectiles/index.ts](../src/content/q2/missionpacks/projectiles/index.ts), [src/content/q2/missionpacks/monsters/index.ts](../src/content/q2/missionpacks/monsters/index.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen native Xatrix source policies in common Q2 composition; provisional as the best full integration until broad source comparisons run. | Keep Ion Ripper ricochets, Phalanx, traps/food cubes and quad fire available as selectable mechanics. | Native attack/collision/ammo/gib differences remain Xatrix policies; authored expansion missions remain map-owned. | Existing tests/gameplay/q2-missionpacks contain source-level scenarios; not rerun for this audit. **Remaining:** Complete campaign and foreign-map/arsenal combinations remain unverified; imported expansion code is not complete selected-arsenal admission. |

<a id="g09"></a>

### G09 Ground Zero

Unified paths: [src/content/q2/missionpacks/weapons/definitions.ts](../src/content/q2/missionpacks/weapons/definitions.ts), [src/content/q2/missionpacks/spheres.ts](../src/content/q2/missionpacks/spheres.ts), [src/content/q2/missionpacks/doppleganger.ts](../src/content/q2/missionpacks/doppleganger.ts), [src/content/q2/missionpacks/modes/index.ts](../src/content/q2/missionpacks/modes/index.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen Rogue modules on shared ownership, provisionally. Preserve actual original/merged rerelease behavior rather than replacing unique mechanics with base equivalents. | Expose chainfist, flechettes, mines, heatbeam, tracker, spheres, nuke, decoy, double damage and infrared. | Source timing, owner cleanup, tracking, immunity and mode rules remain selectable; map hazards remain authored. | Existing Q2 mission-pack tests and projectile persistence code; no fresh complete Rogue run here. **Remaining:** All sphere/decoy/mine lifetimes and travel/save combinations, Tag and DeathBall matches, and selected expansion arsenal coverage remain unqualified. |

<a id="g10"></a>

### G10 Rerelease added enemies and merged programs

Unified paths: [src/content/q2/rerelease/monsters/index.ts](../src/content/q2/rerelease/monsters/index.ts), [src/content/q2/rerelease/monsters/guncmdr.ts](../src/content/q2/rerelease/monsters/guncmdr.ts), [src/content/q2/rerelease/monsters/guardian.ts](../src/content/q2/rerelease/monsters/guardian.ts), [src/content/q2/rerelease/monsters/shambler.ts](../src/content/q2/rerelease/monsters/shambler.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen original rerelease game source over simplified donor legacy backports. Native modules exist; best full behavior is provisional until encounters are compared. | Expose useful attacks/navigation/gib systems universally once their source obligations are preserved. | Guardian phases, health bars, boss succession and program-specific triggers cannot be discarded during selection. | Existing tests/gameplay/q2-rerelease/monsters; ordinary selected actual proofs do not certify these bosses. **Remaining:** Gun commander/guardian/shambler encounter completion and all MG2/N64 campaign conditions remain unverified in this audit. |

<a id="g11"></a>

### G11 Rerelease cooperative players

Unified paths: [src/content/q2/rerelease/players.ts](../src/content/q2/rerelease/players.ts), [src/content/q2/rerelease/campaign.ts](../src/content/q2/rerelease/campaign.ts), [src/content/composition/q2/index.ts](../src/content/composition/q2/index.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen shared client identity plus actual RR player policies, provisionally; donor KEX seat/social APIs provide needed semantics beyond base Q3 client assumptions. | Expose local identities, instanced-item ownership, squad respawn and cooperative lives as reusable capabilities. | Enable source-selected cooperative rules explicitly; do not silently change classic coop. | Existing rerelease player/campaign tests; B4 native RR player identity path was required and supplied. **Remaining:** Full mixed local/remote coop lifecycle, instanced pickup visibility and campaign completion are not proven. |

<a id="g12"></a>

### G12 Movement and prediction profiles

Unified paths: [src/movement/q2/classic.ts](../src/movement/q2/classic.ts), [src/movement/q2/rerelease.ts](../src/movement/q2/rerelease.ts), [src/network/q2/prediction.ts](../src/network/q2/prediction.ts), [src/content/q2/rerelease/q64/index.ts](../src/content/q2/rerelease/q64/index.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen common movement contract with actual source PMove implementations. Neither higher frame rate nor Q3 movement is a universal fidelity winner. | Expose client prediction/reconciliation and the union of movement capabilities through selectable profiles. | Classic fixed-point, rerelease float movement, Q64 settings, air acceleration and player command dialect remain explicit. Map jump forces/hazards stay map-owned. | Existing movement/q2 and first-playable/prediction tests; no fresh cross-profile error/performance benchmark in this audit. **Remaining:** Donor historical Q64 server/client config mismatch is not a desired behavior. All network/profile matrices need matched command-stream proof. |

<a id="g13"></a>

### G13 Deathmatch, Tag and DeathBall

Unified paths: [src/content/composition/q2/match.ts](../src/content/composition/q2/match.ts), [src/content/q2/missionpacks/modes/index.ts](../src/content/q2/missionpacks/modes/index.ts), [src/content/composition/q2/match.ts](../src/content/composition/q2/match.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen match authority separate from map and movement; source mode controllers remain the provisional native behavior foundation. | Expose configurable limits, team state and objective services across map families. | Dmflags, rerelease weapon settings and unique scoring/spawn rules remain mode policies, not global replacements. | Existing gameplay/composition and Q2 mode tests; no full match run here. **Remaining:** Complete setup/admin/end-of-match/rotation workflows and foreign-map objective availability remain unverified. |

<a id="g14"></a>

### G14 CTF

Unified paths: [src/content/q2/multiplayer/ctf/index.ts](../src/content/q2/multiplayer/ctf/index.ts), [src/content/q2/equipment/ctf-grapple.ts](../src/content/q2/equipment/ctf-grapple.ts), [src/app/bootstrap/q2-match-ui.ts](../src/app/bootstrap/q2-match-ui.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen Q2 CTF source rules with shared actors/inventory and equipment. Q3 flag rules do not replace Q2 techs or hook behavior. | Expose teams, flags, techs and grapples through common match/equipment interfaces. | Capture scoring, returns, tech effects, spectator/team lifecycle and hook physics remain CTF policies. | Existing tests/gameplay/q2-multiplayer/ctf/core.test.ts and first-playable/q2-match-ui.test.ts; not rerun here. **Remaining:** Full classic/RR CTF × local/remote × foreign-map acceptance is unproven. |

<a id="g15"></a>

### G15 LMCTF

Unified paths: [src/content/q2/multiplayer/lmctf/index.ts](../src/content/q2/multiplayer/lmctf/index.ts), [src/content/q2/equipment/lmctf-grapple.ts](../src/content/q2/equipment/lmctf-grapple.ts), [src/app/bootstrap/q2-console.ts](../src/app/bootstrap/q2-console.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen LMCTF source controller with shared match services. Preserve distinct runes/tournament/hook behavior; do not substitute base CTF. | Expose offhand equipment, voting, referee/tournament and rune capabilities universally where selected. | LMCTF scoring, rune arithmetic, haste cadence, cvars and map assets remain explicit mod policy. | Existing tests/content/q2/lmctf/application.test.ts and console.test.ts; historical status records actual lmctf09 checks, not rerun here. **Remaining:** All rune combinations, original binary32 agreement, full tournament/match/admin and connected-peer interoperability remain unqualified. LMCTF has no separate soundtrack requirement. |

<a id="g16"></a>

### G16 Local seats and remote seat ownership

Unified paths: [src/world/session/session.ts](../src/world/session/session.ts), [src/input/seat.ts](../src/input/seat.ts), [src/network/common/loopback.ts](../src/network/common/loopback.ts), [src/app/bootstrap/network/q2.ts](../src/app/bootstrap/network/q2.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen independent shared seats/clients, supported by both Q2 and Q1 donor seat designs. This is preferable to seat-zero aliases because identity/input/HUD ownership is explicit. | Expose 1–4 layouts, independent commands, private messages, device assignment and mixed local/remote sessions. | Listener mixing and shared menu focus require explicit policy; protocol limitations must not masquerade as shared-seat limits. | Existing core/session, input and remote-application tests; prior execution-status has bounded split-view captures, not rerun here. **Remaining:** Native Q2 remote binding rejects more than one player on one connection. Independent remote connections and all hotplug/reconnect combinations remain open. |

<a id="g17"></a>

### G17 Bots and personality data

Unified paths: [src/bots/behavior/rerelease/index.ts](../src/bots/behavior/rerelease/index.ts), [src/bots/behavior/director.ts](../src/bots/behavior/director.ts), [src/app/bootstrap/simulation/bots.ts](../src/app/bootstrap/simulation/bots.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen common bot controller with source knowledge/arsenal adapters. RR behavior and Q3 botlib remain compared inputs, not an automatic Q3 winner; best broad AI quality is uncompared. | Expose population, skills, personality, team orders and combat/supply decisions for all families. | Source weapon tactics and movement affordances remain typed inputs; campaign intentions must retain map objectives. | Existing tests/bots/behavior/shared-world.test.ts; prior bounded nine map/weapon family cases are recorded in execution-status, not rerun here. **Remaining:** Broader maps, expansion weapons, modes, campaign completion, path quality and skill calibration remain open. |

<a id="g18"></a>

### G18 Navigation and guidance routes

Unified paths: [src/bots/navigation/load.ts](../src/bots/navigation/load.ts), [src/bots/navigation/nav.ts](../src/bots/navigation/nav.ts), [src/bots/navigation/construct.ts](../src/bots/navigation/construct.ts), [src/bots/navigation/runtime.ts](../src/bots/navigation/runtime.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen shared graph/query service retaining Q2 NAV2 and Q3 AAS import. Q2 navigation capabilities/dynamic links are additions, not data to discard in favor of one format. | Expose imported and constructed routes, traversal constraints and dynamic obstacle updates to bots and guidance. | Capabilities follow actual movement/world state; source-specific path choices can remain selectable. | Existing bots/navigation tests; authored route retention exercised by selected-monster fixtures elsewhere. **Remaining:** No broad route quality/performance comparison, exhaustive door/lift handling or full campaign-guidance path proof here. |

<a id="g19"></a>

### G19 HUD, inventory and selection UI

Unified paths: [src/ui/hud/index.ts](../src/ui/hud/index.ts), [src/ui/hud/wheel.ts](../src/ui/hud/wheel.ts), [src/app/bootstrap/presentation.ts](../src/app/bootstrap/presentation.ts), [src/app/bootstrap/q2-match-ui.ts](../src/app/bootstrap/q2-match-ui.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen common seat-owned HUD primitives plus native source layouts. RR wheel/carousel ergonomics are useful additions; native HUD schemas must not be flattened into Q3 stats. | Expose inventory, radial selection, notifications and accessible scaling for all arsenals. | Classic/RR layout, score/help data and source-specific weapon selection remain selectable. | Existing UI, first-playable/rerelease-presentation and Q2 match UI tests; no fresh complete wheel workflow here. **Remaining:** All radial/carousel controls and HUD parity on every foreign arsenal/remote source remain unknown. |

<a id="g20"></a>

### G20 POI, compass, health bars and flashlight

Unified paths: [src/content/q2/rerelease/goals.ts](../src/content/q2/rerelease/goals.ts), [src/content/q2/rerelease/types.ts](../src/content/q2/rerelease/types.ts), [src/ui/hud/index.ts](../src/ui/hud/index.ts), [src/app/bootstrap/rerelease-presentation.ts](../src/app/bootstrap/rerelease-presentation.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen direction: promote Q2 RR authored guidance/effect capabilities into common presentation. This choice is provisional because application joins are incomplete. | Expose objective markers, route arrows, boss bars and optional flashlight to every compatible map/program without inventing objectives. | Target selection/stages and boss ownership stay map/program-owned; visibility and user accessibility controls are independent. | Generic HudSeatState POI drawing and source help-path/flashlight events exist. No fresh actual compass/flashlight capture here. **Remaining:** Application RR receiver handles fog/story/localized-print/sky, but no help-path/flashlight consumer was found. Generic POI support alone does not prove native guidance. |

<a id="g21"></a>

### G21 Localization, fonts and accessibility

Unified paths: [src/text/localization.ts](../src/text/localization.ts), [src/text/kfont.ts](../src/text/kfont.ts), [src/text/truetype.ts](../src/text/truetype.ts), [src/text/captions.ts](../src/text/captions.ts), [src/app/bootstrap/rerelease-presentation.ts](../src/app/bootstrap/rerelease-presentation.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen common text layer combining Q2 localization/KFONT and general TrueType layout. Q2 formatting/language fallback are real strengths; no reason to replace them with Q3-only font behavior. | Expose language selection, reload/fallback, Unicode, captions and independent menu/HUD/console scale universally. | Native message formatting and authored font metrics remain source/data policy; user contrast/typeface settings remain independent. | Existing text/UI tests; actual story/localized message adapter inspected, no all-language render review here. **Remaining:** Full font coverage, live language reload, captions/non-color cues and accessibility menu workflows remain unverified. |

<a id="g22"></a>

### G22 Input, controllers and haptics

Unified paths: [src/input/router.ts](../src/input/router.ts), [src/input/gamepad.ts](../src/input/gamepad.ts), [src/input/haptics.ts](../src/input/haptics.ts), [src/platform/controller.ts](../src/platform/controller.ts), [src/app/bootstrap/input.ts](../src/app/bootstrap/input.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen shared per-seat input routing, combining donor device semantics. Best gyro/response implementation is uncompared; source count is not a quality metric. | Expose hotplug, mappings, deadzones/curves, trigger thresholds, haptic envelopes and per-player settings universally. | Raw command dialect and selected movement interpretation stay separate from device configuration. | Existing tests/input/input.test.ts and platform tests; no real device/haptic/gyro exercise in this silent audit. **Remaining:** Complete gyro behavior, physical-device loss/focus and all settings persistence are not certified. |

<a id="g23"></a>

### G23 Sound channels and multiple listeners

Unified paths: [src/audio/engine.ts](../src/audio/engine.ts), [src/audio/quake-mixer.ts](../src/audio/quake-mixer.ts), [src/audio/streams.ts](../src/audio/streams.ts), [src/app/bootstrap/audio.ts](../src/app/bootstrap/audio.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Current: UnifiedAudio coordinates listeners, but AudioMixer, QuakeMixer and source-paint retain parallel mixing paths. Final consolidation remains open. Recommended: one scalable voice/mixing core using the strongest measured capabilities, provisionally the Q3-capability baseline plus Q1/Q2 features; no comparative quality/performance winner is yet proven. | Expose positional audio, Doppler, ambient/world loops, streamed PCM, reverb and explicit multi-listener mixing universally. Merge useful Q1/Q2 features into one scalable voice core. | Preserve source sound-event timing, channel identity and file/API semantics because gameplay/scripts depend on them. Attenuation style may be an explicit compatibility choice. Old voice caps and low-precision intermediate clipping need not limit the common default; pause/listener mixing are user/session policy. | Existing audio/playback and bootstrap tests; offscreen captures used dummy audio and prove no audible behavior. **Remaining:** Parallel mixing paths remain a consolidation gap. Full listening/performance comparisons, high voice-count behavior and multi-seat acoustic quality remain unverified. |

<a id="g24"></a>

### G24 Environmental reverb

Unified paths: [src/audio/environments.ts](../src/audio/environments.ts), [src/audio/reverb.ts](../src/audio/reverb.ts), [src/audio/engine.ts](../src/audio/engine.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen Q2repro/Q2-derived environment selector and stereo DSP as a universal candidate: they supply material/room-dependent reverb absent from a plain mixer. Quality is provisional. | Expose room/material reverb and underwater filtering through every map family where spatial queries/data exist. | User gain/enable settings and source/environment presets remain selectable; never infer material data that a map does not provide. | tests/audio/playback.test.ts exercises DSP. EnvironmentReverb is imported and UnifiedAudio.setEnvironment exists. **Remaining:** No production call to setEnvironment was found under src. Application reverb integration and audible source comparison are missing evidence, not a completed feature. |

<a id="g25"></a>

### G25 Music

Unified paths: [src/audio/music.ts](../src/audio/music.ts), [src/platform/vorbis.ts](../src/platform/vorbis.ts), [src/app/bootstrap/audio/music.ts](../src/app/bootstrap/audio/music.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen common streaming music service with mounted-source track resolution. Q2 Ogg support extends the shared audio feature set. | Expose gain, pause/resume and playlist/menu controls independently from map geometry. | Authored track selection remains content-owned; shuffle and menu music are user policy. | Existing audio tests and historical execution-status track decode notes; no audible run here. **Remaining:** All archive/music naming variants and menu shuffle workflows are not compared. LMCTF inherits suitable Q2 music; do not invent an LMCTF soundtrack. |

<a id="g26"></a>

### G26 Cinematics and media

Unified paths: [src/media/cin.ts](../src/media/cin.ts), [src/media/cin-playback.ts](../src/media/cin-playback.ts), [src/media/roq.ts](../src/media/roq.ts), [src/media/transitions.ts](../src/media/transitions.ts), [src/app/bootstrap/finale.ts](../src/app/bootstrap/finale.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen shared media pipeline with native CIN, PCX and RoQ decoders, not one donor codec. Best synchronization/render quality remains provisional. | Expose decoded video/stills, streamed audio, pause/skip and subtitle scheduling universally. | Authored finale/transition timing stays map/program-owned; source decoder behavior and user caption controls remain explicit. | Existing tests/media/cinematic.test.ts; no actual Q2 ending with synchronized soundtrack captured in this audit. **Remaining:** All rerelease/expansion media formats, complete end transitions and timed subtitle presentation remain unverified. |

<a id="g27"></a>

### G27 Save ownership and source containers

Unified paths: [src/persistence/q2-typescript.ts](../src/persistence/q2-typescript.ts), [src/persistence/q2-rerelease.ts](../src/persistence/q2-rerelease.ts), [src/persistence/q2-containers.ts](../src/persistence/q2-containers.ts), [src/app/bootstrap/simulation/save.ts](../src/app/bootstrap/simulation/save.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen shared SaveImage plus explicit source codecs. Donor sv_ccmds splits legacy/KEX containers despite old unified-container prose; preserve source formats without repeating that ownership split. | Expose source callbacks/graphs, inventory capacities, projectile ownership and client-visible state through one save coordinator. | Native binary/JSON formats, autosave/transition eligibility and migration policy remain explicit. Never reinterpret incompatible source schemas silently. | B1–B5 fresh restore actual source+body continuation; existing tests/persistence/source-saves.test.ts covers source formats. **Remaining:** Full original-save interoperability, every private field/program and native guest full-map save remain unproven. JSON serializability alone is not semantic completeness. |

<a id="g28"></a>

### G28 Units, landmarks and campaign progression

Unified paths: [src/content/q2/rerelease/campaign.ts](../src/content/q2/rerelease/campaign.ts), [src/content/q2/base/player/landmarks.ts](../src/content/q2/base/player/landmarks.ts), [src/content/composition/q2/save.ts](../src/content/composition/q2/save.ts), [src/app/bootstrap/application.ts](../src/app/bootstrap/application.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen map-owned campaign state with shared travel/save coordination. Preserve Q2 unit backtracking/landmarks rather than replacing them with arena rotation. | Expose persistent level snapshots, cross-level/unit flags and landmark-relative arrivals universally where authored. | Keys, objectives, secrets, hub decisions and endings remain program/map policies. | Existing campaign/save/transition source tests and recorded bounded travel work; no complete campaign finished here. **Remaining:** Every unit revisit, coop-key path, landmark and ending combination needs actual campaign evidence. |

<a id="g29"></a>

### G29 Achievements and online/lobby services

Unified paths: [src/network/services/online.ts](../src/network/services/online.ts), [src/content/q2/rerelease/types.ts](../src/content/q2/rerelease/types.ts), [src/content/q2/rerelease/goals.ts](../src/content/q2/rerelease/goals.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Provisional common event/service boundary. Source achievement/lobby semantics must remain available, but local event production is not an online service implementation. | Expose durable local achievements and explicit optional lobby/report adapters across games. | Platform credentials, publication and social identity stay outside source game simulation; local privacy/user choices remain explicit. | Event/service interfaces exist; no platform-connected run in this audit. **Remaining:** No app achievement consumer found; durable completion, match reporting and complete lobby lifecycle remain unverified. |

<a id="g30"></a>

### G30 Demos, MVD and GTV

Unified paths: [src/network/q2/demo.ts](../src/network/q2/demo.ts), [src/network/q2/codecs/mvd.ts](../src/network/q2/codecs/mvd.ts), [src/network/q2/codecs/kexdemo.ts](../src/network/q2/codecs/kexdemo.ts), [src/network/q3/recording.ts](../src/network/q3/recording.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Provisional shared recording services with source codecs. Q2 MVD/GTV are useful additions, not reasons to discard single-view compatibility. | Expose seek/view controls and authenticated spectator streaming where implemented. | Wire/demo protocol identity and recorded seat ownership remain explicit; codec similarity is not compatibility. | Existing network/q2 tests cover codecs; no actual MVD/GTV broadcast or complete demo UX executed here. **Remaining:** Application recording/playback controls, multi-seat view selection and authenticated GTV workflow remain unknown. |

<a id="g31"></a>

### G31 Protocols, admission and transport

Unified paths: [src/network/q2/codec.ts](../src/network/q2/codec.ts), [src/network/q2/codecs/q2repro.ts](../src/network/q2/codecs/q2repro.ts), [src/app/bootstrap/network/q2.ts](../src/app/bootstrap/network/q2.ts), [src/app/bootstrap/simulation/network.ts](../src/app/bootstrap/simulation/network.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen common session transport with explicit Q2 codecs. Keep 34/35/36/1038/private4038/KEX identities distinct; neither widest protocol nor Q3 wire is a universal replacement. | Expose challenge/reconnect/reliable delivery, downloads and source state adaptation through common services. | Native wire only carries configurations it can represent. Movement/HUD profile must not be inferred from width alone. | Existing tests/network/q2/network.test.ts and first-playable/network/q2-application.test.ts; no new connected-peer run here. **Remaining:** KEX live transport explicitly unbound. Q2 server writes old_origin=body.origin, losing modeled-beam endpoint. Cross-family connected servers and all external native clients remain unverified. |

<a id="g32"></a>

### G32 Browser and downloads

Unified paths: [src/network/services/discovery.ts](../src/network/services/discovery.ts), [src/network/services/downloads.ts](../src/network/services/downloads.ts), [src/network/q2/connectionless.ts](../src/network/q2/connectionless.ts), [src/app/bootstrap/network/remote.ts](../src/app/bootstrap/network/remote.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Provisional common discovery/download foundation. Q2 HTTP filelists, queueing and fallback requirements supplement Q3 pure/archive behavior; no wholesale Q3 winner established. | Expose LAN/master/HTTP discovery, favorites, filters, validated downloads and mount rescans universally. | Path containment, server trust, native download framing and pure-content rules remain explicit source/security policy. | Existing network/common and remote-application tests; no actual public master/download session here. **Remaining:** Full browser UX, HTTP-to-UDP fallback, filelist expansion and downloaded-content remount acceptance remain unqualified. |

<a id="g33"></a>

### G33 Server administration and identity

Unified paths: [src/network/services/admin.ts](../src/network/services/admin.ts), [src/app/bootstrap/q2-console.ts](../src/app/bootstrap/q2-console.ts), [src/app/bootstrap/application.ts](../src/app/bootstrap/application.ts), [src/content/q2/base/player/commands.ts](../src/content/q2/base/player/commands.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen common console/admin dispatch with native mode commands; best full administration UX remains provisional. | Expose status/kick/chat/private messages, operator stdin, identity and spectator controls universally. | Match/referee privileges, source cvars, handedness and view settings remain explicit policies. | Existing LMCTF console/application and network tests; no full connected-admin workflow here. **Remaining:** Master publication, every spectator/chase mode and complete configuration persistence need acceptance. |

<a id="g34"></a>

### G34 Configuration and settings

Unified paths: [src/core/commands/index.ts](../src/core/commands/index.ts), [src/core/cvars/index.ts](../src/core/cvars/index.ts), [src/console/index.ts](../src/console/index.ts), [src/ui/settings/index.ts](../src/ui/settings/index.ts), [src/app/bootstrap/startup.ts](../src/app/bootstrap/startup.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen shared typed cvar/command/settings ownership; donor cfg/alias behavior is retained where source-relevant. Best completion/history UX is not comparatively benchmarked. | Expose archived settings, aliases, binds, completion and independent audio/video/input controls. | Preserve compatibility command names, units and gameplay defaults where external scripts or intended gameplay depend on them. Legacy quality/capacity defaults may improve. User-selected values must survive restart/travel. | Existing core/commands,cvars and UI settings tests; prior startup captures are bounded evidence. **Remaining:** Every donor console command, renderer restart and live setting change has not been exercised. |

<a id="g35"></a>

### G35 Rendering backends and capture

Unified paths: [src/render/cpu/index.ts](../src/render/cpu/index.ts), [src/render/gl/index.ts](../src/render/gl/index.ts), [src/render/scene/models/prepare.ts](../src/render/scene/models/prepare.ts), [src/capture/index.ts](../src/capture/index.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen one scene/model preparation path feeding CPU and GL. This prevents duplicated source model semantics; it does not establish either backend as best quality/performance. | Expose offscreen screenshots and source-aware model/effect rendering on every map family. | Preserve authored textures/palettes and render-flag meaning for format fidelity; old intermediate precision or low-quality filtering are not required limits. Higher-quality common rendering and backend/user controls remain universal. | B2 CPU/GL parasite captures independently inspected, including actual modeled beam. Existing render fixtures cover geometry. **Remaining:** No full renderer parity/performance/brightness qualification. Both backends matching can reproduce the same source mistake. |

<a id="g36"></a>

### G36 BSPX lightmaps/lightgrid and MD5 replacement

Unified paths: [src/formats/q2-map/bspx.ts](../src/formats/q2-map/bspx.ts), [src/formats/q3-model/md5.ts](../src/formats/q3-model/md5.ts), [src/render/scene/models/light-sampler.ts](../src/render/scene/models/light-sampler.ts), [src/app/bootstrap/assets.ts](../src/app/bootstrap/assets.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen feature union: retain tested Q2 BSPX lightgrid/decoupled maps and join Q2 skeletal replacement selection to shared assets/rendering. Accepted `a68b43e` now joins default Q2 application replacement selection and animation alongside the existing Q1 path. | Expose improved entity lighting and skeletal replacements universally while preserving authored resource provenance. | Asset tier, model scale, skin/frame mapping, and light style semantics stay source/data-owned; replacement is user-selectable. | Existing formats/q2-map, q3-model/md5 and render/model tests; B2 used actual source MD2, not an MD5 comparison. **Current at accepted `a68b43e`:** actual MD5 loader/frame mapping/joint-scale behavior passed 6 tests/148 assertions and normal CPU/GL application runs; source front culling is corrected. Animation is Done/integrated. User-selectable replacement tiers, application `gl_md5_load`/`gl_md5_use` configuration and distance selection remain open, so replacement selection is still Not done. Earlier `185c06e` lacked the Q2 join; that historical finding is superseded. Existing Q1 MD5 and separately tested BSPX behavior remain retained. Broad MD2/MD5 or lightgrid/fallback fidelity comparisons remain unqualified. |

<a id="g37"></a>

### G37 Authored lighting, fog and world effects

Unified paths: [src/content/q2/rerelease/lights.ts](../src/content/q2/rerelease/lights.ts), [src/content/q2/foundation/shadow-lights.ts](../src/content/q2/foundation/shadow-lights.ts), [src/app/bootstrap/rerelease-presentation/fog.ts](../src/app/bootstrap/rerelease-presentation/fog.ts), [src/render/scene/world.ts](../src/render/scene/world.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen shared light/fog scene contracts carrying native target state. Q2 RR fog/target-light controls are additions to common rendering, not restricted to Q2 BSPs. | Expose dynamic lights, switchable shadows, sky/fog transitions and source effect state universally. | Authored effect timing/positions stay map-owned; presentation preferences do not rewrite missions. | Existing first-playable/q2-shadow-light and rerelease-presentation tests. B2 only validates one lit corridor model scene. **Remaining:** All sky/fog transitions, shadow correctness and source-renderer comparisons remain incomplete. |

<a id="g38"></a>

### G38 Native game and cgame guests

Unified paths: [src/compat/q2/classic/index.ts](../src/compat/q2/classic/index.ts), [src/compat/q2/rerelease/index.ts](../src/compat/q2/rerelease/index.ts), [src/guest/abi/index.ts](../src/guest/abi/index.ts), [src/guest/x64/index.ts](../src/guest/x64/index.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen common interpreted guest/ABI machinery instead of donor fixed static-module lists. This supplies missing mod execution capability; semantic completeness/performance are provisional. | Expose supported native game/cgame modules through the same world/service contracts, never a second physics world. | Classic ABI, rerelease API versions, guest ISA/runtime and serialization budgets remain explicit compatibility contracts. | Existing tests/compat/q2/rerelease/native.test.ts; execution-status records a bounded retail native run with36assertions/502edicts, not rerun here. **Remaining:** Native full-map JSON save exceeded20million instructions in recorded evidence. Complete callbacks, C++ runtime, mod overrides, supported platforms and gameplay are not established. |

<a id="g39"></a>

### G39 Core clocks, RNG and scheduling

Unified paths: [src/world/session/clocks.ts](../src/world/session/clocks.ts), [src/world/scheduler.ts](../src/world/scheduler.ts), [src/app/bootstrap/simulation/random.ts](../src/app/bootstrap/simulation/random.ts), [src/app/bootstrap/simulation/runtime.ts](../src/app/bootstrap/simulation/runtime.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen common source deadline scheduler and explicit numeric/RNG profiles. Q2 RR cadence and random generator must be added without creating another world or overstepping Q3 projectiles. | Expose multiple source cadences and resumable deterministic callbacks on one actor/body timeline. | Source time units, PRNG distribution/sequence and floating-point rules remain intentional policies. | B1 proves four25ms RR turns and one100ms classic turn on a100ms map, fractional boundary, save continuation and one Q3 grenade interval. **Remaining:** Whole-program deterministic agreement and exhaustive mixed frame-order cases remain unproven. |

<a id="g40"></a>

### G40 Collision and shared physics

Unified paths: [src/world/collision/index.ts](../src/world/collision/index.ts), [src/app/bootstrap/simulation/physics.ts](../src/app/bootstrap/simulation/physics.ts), [src/content/q2/foundation/motion.ts](../src/content/q2/foundation/motion.ts), [src/content/q2/foundation/monsters/ai.ts](../src/content/q2/foundation/monsters/ai.ts).

| Decision and comparison | Universal feature union | Retained policies | Evidence and remaining gap |
| --- | --- | --- | --- |
| Chosen common broad-phase/body ownership with native source trace/movement policies. No source engine wins by having fewer checks or moving monsters out of authored geometry. | Expose BSP/brush queries, flying/swimming, projectiles, gravity and source callbacks across map families. | Solid/content masks, hulls, step/drop arithmetic, source gravity and native authored placement are explicit. Map hazards remain map-owned. | B3/B4 selected/native jump/placement/swim evidence; shared geometry used without moving monsters or changing map water. **Remaining:** All solid overlaps, rotating pushers, inverted gravity, foreign hulls and collision precision remain unqualified. |

## Feature-by-feature donor inventory

All 193 source IDs are retained. The source link identifies the donor implementation (or original contract when the donor is incomplete); its additional original-source witnesses and exact ranges remain in [q2.json](../verification/features/q2.json). The group link names actual unified files and the comparison/union/policy decision above.

Runtime status is **J**: an applicable source/module/application join is present, with the group's limits; **P**: partial join or codec/library only; **G**: concrete missing application path; **?**: no complete workflow traced. J is not a checkmark for behavioral parity. **B** references actual bounded evidence above; **T** means an existing test target is named in the group, not freshly run or full-feature certified; **—** means no feature-specific execution evidence claimed here. Source presence itself does not establish target completion.

| Feature ID and requirement | Donor source | Unified comparison group | Runtime / evidence |
| --- | --- | --- | --- |
| `q2.content.campaign-catalog` — Discover the seven Q2 content families | [D:src/client/menu_content.ts](../../quake-2-re-ts/src/client/menu_content.ts) | [G01](#g01) | P / T |
| `q2.content.native-starts` — Launch authored campaign starting maps | [D:src/client/menu_content.ts](../../quake-2-re-ts/src/client/menu_content.ts) | [G01](#g01) | P / T |
| `q2.content.ruleset-mount-order` — Select gameplay independently from map edition | [D:src/client/menu_content.ts](../../quake-2-re-ts/src/client/menu_content.ts) | [G01](#g01) | J / T |
| `q2.content.launch-lifecycle` — Switch campaigns and modes within one process | [D:src/client/menu_content.ts](../../quake-2-re-ts/src/client/menu_content.ts) | [G01](#g01) | P / T |
| `q2.content.coop-launch` — Launch campaign coop and local players | [D:src/client/menu_content.ts](../../quake-2-re-ts/src/client/menu_content.ts) | [G01](#g01) | P / T |
| `q2.content.discovered-addons` — Discover installed add-on directories | [D:src/client/menu_content.ts](../../quake-2-re-ts/src/client/menu_content.ts) | [G01](#g01) | P / T |
| `q2.content.start-map-discovery` — Resolve mapdb, maplist, and BSP start maps | [D:src/client/menu_content.ts](../../quake-2-re-ts/src/client/menu_content.ts) | [G01](#g01) | P / T |
| `q2.content.server-map-lists` — Choose maps and inspect mode eligibility | [D:src/client/menu_content.ts](../../quake-2-re-ts/src/client/menu_content.ts) | [G01](#g01) | P / T |
| `q2.content.rotation-editor` — Edit and persist ordered map rotations | [D:src/client/menu_content.ts](../../quake-2-re-ts/src/client/menu_content.ts) | [G01](#g01) | P / T |
| `q2.content.auxiliary-map-assets` — Use foreign map dependencies without overriding gameplay | [D:src/qcommon/files.ts](../../quake-2-re-ts/src/qcommon/files.ts) | [G01](#g01) | J / T |
| `q2.content.same-name-remount` — Invalidate caches when map provenance changes | [D:src/qcommon/files.ts](../../quake-2-re-ts/src/qcommon/files.ts) | [G01](#g01) | J / T |
| `q2.content.missing-dependencies` — Report missing campaign installations and required maps | [D:src/client/menu_content.ts](../../quake-2-re-ts/src/client/menu_content.ts) | [G01](#g01) | J / T |
| `q2.game.provider-selection` — Select base, expansion, CTF, LMCTF, and KEX game providers | [D:src/server/bindings/legacy.ts](../../quake-2-re-ts/src/server/bindings/legacy.ts) | [G02](#g02) | J / B1–B5 |
| `q2.game.native-entity-precedence` — Preserve native entities while supplying foreign mechanics | [D:src/game/g_spawn.ts](../../quake-2-re-ts/src/game/g_spawn.ts) | [G02](#g02) | J / B1/B4 |
| `q2.weapon.blaster` — Fire the blaster | [D:src/game/p_weapon.ts](../../quake-2-re-ts/src/game/p_weapon.ts) | [G03](#g03) | J / T |
| `q2.weapon.shotgun` — Fire the shotgun | [D:src/game/p_weapon.ts](../../quake-2-re-ts/src/game/p_weapon.ts) | [G03](#g03) | J / T |
| `q2.weapon.super-shotgun` — Fire the super shotgun | [D:src/game/p_weapon.ts](../../quake-2-re-ts/src/game/p_weapon.ts) | [G03](#g03) | J / T |
| `q2.weapon.machinegun` — Sustain machinegun fire | [D:src/game/p_weapon.ts](../../quake-2-re-ts/src/game/p_weapon.ts) | [G03](#g03) | J / T |
| `q2.weapon.chaingun` — Spin and fire the chaingun | [D:src/game/p_weapon.ts](../../quake-2-re-ts/src/game/p_weapon.ts) | [G03](#g03) | J / T |
| `q2.weapon.hand-grenade` — Cook and throw hand grenades | [D:src/game/p_weapon.ts](../../quake-2-re-ts/src/game/p_weapon.ts) | [G03](#g03) | J / T |
| `q2.weapon.grenade-launcher` — Fire bouncing launcher grenades | [D:src/game/p_weapon.ts](../../quake-2-re-ts/src/game/p_weapon.ts) | [G03](#g03) | J / T |
| `q2.weapon.rocket-launcher` — Fire rockets and apply splash knockback | [D:src/game/p_weapon.ts](../../quake-2-re-ts/src/game/p_weapon.ts) | [G03](#g03) | J / T |
| `q2.weapon.hyperblaster` — Sustain hyperblaster fire | [D:src/game/p_weapon.ts](../../quake-2-re-ts/src/game/p_weapon.ts) | [G03](#g03) | J / T |
| `q2.weapon.railgun` — Pierce targets with the railgun | [D:src/game/p_weapon.ts](../../quake-2-re-ts/src/game/p_weapon.ts) | [G03](#g03) | J / T |
| `q2.weapon.bfg` — Charge and detonate the BFG | [D:src/game/p_weapon.ts](../../quake-2-re-ts/src/game/p_weapon.ts) | [G03](#g03) | J / T |
| `q2.inventory.weapon-selection` — Select, cycle, drop, and recover weapons | [D:src/game/p_weapon.ts](../../quake-2-re-ts/src/game/p_weapon.ts) | [G04](#g04) | J / T |
| `q2.inventory.ammo-capacity` — Pick up ammunition up to the current capacity | [D:src/game/g_items.ts](../../quake-2-re-ts/src/game/g_items.ts) | [G04](#g04) | J / T |
| `q2.inventory.bandolier` — Increase capacities with the bandolier | [D:src/game/g_items.ts](../../quake-2-re-ts/src/game/g_items.ts) | [G04](#g04) | J / T |
| `q2.inventory.ammo-pack` — Increase capacities with the ammo pack | [D:src/game/g_items.ts](../../quake-2-re-ts/src/game/g_items.ts) | [G04](#g04) | J / T |
| `q2.inventory.health-megahealth` — Pick up health and decay megahealth | [D:src/game/g_items.ts](../../quake-2-re-ts/src/game/g_items.ts) | [G04](#g04) | J / T |
| `q2.inventory.armor-salvage` — Salvage and replace armor | [D:src/game/g_items.ts](../../quake-2-re-ts/src/game/g_items.ts) | [G04](#g04) | J / T |
| `q2.inventory.power-armor` — Toggle power armor and consume cells on protection | [D:src/game/g_items.ts](../../quake-2-re-ts/src/game/g_items.ts) | [G04](#g04) | J / B5 (monster screen only) |
| `q2.powerup.quad` — Activate and extend quad damage | [D:src/game/g_items.ts](../../quake-2-re-ts/src/game/g_items.ts) | [G04](#g04) | J / T |
| `q2.powerup.invulnerability` — Activate and expire invulnerability | [D:src/game/g_items.ts](../../quake-2-re-ts/src/game/g_items.ts) | [G04](#g04) | J / T |
| `q2.powerup.breather-envirosuit` — Use breathing and environmental protection | [D:src/game/g_items.ts](../../quake-2-re-ts/src/game/g_items.ts) | [G04](#g04) | J / T |
| `q2.powerup.silencer` — Consume silenced shots | [D:src/game/g_items.ts](../../quake-2-re-ts/src/game/g_items.ts) | [G04](#g04) | J / T |
| `q2.combat.damage-armor-knockback` — Resolve damage, armor, friendly fire, and death once | [D:src/game/g_combat.ts](../../quake-2-re-ts/src/game/g_combat.ts) | [G05](#g05) | J / B5 |
| `q2.monster.base-ai` — Run native monster sensing, attacks, pain, and death | [D:src/game/g_ai.ts](../../quake-2-re-ts/src/game/g_ai.ts) | [G06](#g06) | J / B1–B5 |
| `q2.world.movers-triggers` — Use doors, platforms, trains, buttons, and trigger chains | [D:src/game/g_func.ts](../../quake-2-re-ts/src/game/g_func.ts) | [G07](#g07) | J / T |
| `q2.world.flashlight` — Toggle the rerelease flashlight under every host profile | [D:src/game/g_items.ts](../../quake-2-re-ts/src/game/g_items.ts) | [G20](#g20) | G / — |
| `q2.xatrix.ionripper` — Fire the Ion Ripper | [D:src/xatrix/p_weapon.ts](../../quake-2-re-ts/src/xatrix/p_weapon.ts) | [G08](#g08) | J / T |
| `q2.xatrix.phalanx` — Fire the Phalanx particle cannon | [D:src/xatrix/p_weapon.ts](../../quake-2-re-ts/src/xatrix/p_weapon.ts) | [G08](#g08) | J / T |
| `q2.xatrix.trap` — Throw traps and collect food cubes | [D:src/xatrix/p_weapon.ts](../../quake-2-re-ts/src/xatrix/p_weapon.ts) | [G08](#g08) | J / T |
| `q2.xatrix.quadfire` — Activate quad fire | [D:src/xatrix/g_items.ts](../../quake-2-re-ts/src/xatrix/g_items.ts) | [G08](#g08) | J / T |
| `q2.xatrix.monsters` — Fight Reckoning monsters and variants | [D:src/xatrix/g_spawn.ts](../../quake-2-re-ts/src/xatrix/g_spawn.ts) | [G08](#g08) | J / T |
| `q2.rogue.chainfist` — Cut targets with the chainfist | [D:src/rogue/p_weapon.ts](../../quake-2-re-ts/src/rogue/p_weapon.ts) | [G09](#g09) | J / T |
| `q2.rogue.etf-rifle` — Fire armor-piercing flechettes | [D:src/rogue/p_weapon.ts](../../quake-2-re-ts/src/rogue/p_weapon.ts) | [G09](#g09) | J / T |
| `q2.rogue.proximity-mines` — Deploy proximity mines | [D:src/rogue/p_weapon.ts](../../quake-2-re-ts/src/rogue/p_weapon.ts) | [G09](#g09) | J / T |
| `q2.rogue.heatbeam` — Maintain a heatbeam attack | [D:src/rogue/p_weapon.ts](../../quake-2-re-ts/src/rogue/p_weapon.ts) | [G09](#g09) | J / T |
| `q2.rogue.disintegrator` — Acquire and track a disintegrator target | [D:src/rogue/p_weapon.ts](../../quake-2-re-ts/src/rogue/p_weapon.ts) | [G09](#g09) | J / T |
| `q2.rogue.nuke` — Deploy the A-M Bomb | [D:src/rogue/g_items.ts](../../quake-2-re-ts/src/rogue/g_items.ts) | [G09](#g09) | J / T |
| `q2.rogue.spheres` — Use defender, hunter, and vengeance spheres | [D:src/rogue/g_items.ts](../../quake-2-re-ts/src/rogue/g_items.ts) | [G09](#g09) | J / T |
| `q2.rogue.doppleganger` — Spawn a doppleganger decoy | [D:src/rogue/g_items.ts](../../quake-2-re-ts/src/rogue/g_items.ts) | [G09](#g09) | J / T |
| `q2.rogue.double-damage` — Activate double damage | [D:src/rogue/g_items.ts](../../quake-2-re-ts/src/rogue/g_items.ts) | [G09](#g09) | J / T |
| `q2.rogue.infrared` — Activate infrared vision | [D:src/rogue/g_items.ts](../../quake-2-re-ts/src/rogue/g_items.ts) | [G09](#g09) | J / T |
| `q2.rogue.monsters-hazards` — Fight Ground Zero monsters and authored hazards | [D:src/rogue/g_spawn.ts](../../quake-2-re-ts/src/rogue/g_spawn.ts) | [G09](#g09) | J / T |
| `q2.rerelease.gun-commander` — Fight the gun commander | [D:src/kexgame/m_guncmdr.ts](../../quake-2-re-ts/src/kexgame/m_guncmdr.ts) | [G10](#g10) | J / T |
| `q2.rerelease.shambler` — Fight the rerelease shambler | [D:src/kexgame/m_shambler.ts](../../quake-2-re-ts/src/kexgame/m_shambler.ts) | [G10](#g10) | J / T |
| `q2.rerelease.guardian` — Complete the guardian encounter | [D:src/kexgame/m_guardian.ts](../../quake-2-re-ts/src/kexgame/m_guardian.ts) | [G10](#g10) | J / T |
| `q2.rerelease.instanced-items` — Use coop item instancing | [D:src/kexgame/g_items.ts](../../quake-2-re-ts/src/kexgame/g_items.ts) | [G11](#g11) | P / T |
| `q2.rerelease.squad-respawn-lives` — Use squad respawn and cooperative lives | [D:src/client/menu_content.ts](../../quake-2-re-ts/src/client/menu_content.ts) | [G11](#g11) | P / T |
| `q2.rerelease.q64-movement` — Match Q2 64 server movement and prediction | [D:src/kexgame/p_client.ts](../../quake-2-re-ts/src/kexgame/p_client.ts) | [G12](#g12) | J / T |
| `q2.mode.deathmatch-limits` — End a deathmatch on authored limits | [D:src/game/g_main.ts](../../quake-2-re-ts/src/game/g_main.ts) | [G13](#g13) | P / T |
| `q2.mode.dm-options` — Apply classic deathmatch flags | [D:src/client/menu_content.ts](../../quake-2-re-ts/src/client/menu_content.ts) | [G13](#g13) | P / T |
| `q2.mode.rerelease-options` — Apply rerelease deathmatch and weapon settings | [D:src/client/menu_content.ts](../../quake-2-re-ts/src/client/menu_content.ts) | [G13](#g13) | P / T |
| `q2.mode.tag` — Play Rogue Tag | [D:src/kexgame/rogue/g_rogue_newdm.ts](../../quake-2-re-ts/src/kexgame/rogue/g_rogue_newdm.ts) | [G13](#g13) | P / T |
| `q2.mode.deathball` — Play rerelease DeathBall | [D:src/kexgame/rogue/g_rogue_newdm.ts](../../quake-2-re-ts/src/kexgame/rogue/g_rogue_newdm.ts) | [G13](#g13) | P / T |
| `q2.ctf.flag-objective` — Capture and return CTF flags | [D:src/ctf/g_ctf.ts](../../quake-2-re-ts/src/ctf/g_ctf.ts) | [G14](#g14) | J / T |
| `q2.ctf.grapple` — Use the CTF grappling hook | [D:src/ctf/g_ctf.ts](../../quake-2-re-ts/src/ctf/g_ctf.ts) | [G14](#g14) | J / T |
| `q2.ctf.techs` — Use and drop CTF tech powerups | [D:src/ctf/g_ctf.ts](../../quake-2-re-ts/src/ctf/g_ctf.ts) | [G14](#g14) | J / T |
| `q2.ctf.team-lifecycle` — Join teams and spectate a CTF match | [D:src/ctf/g_ctf.ts](../../quake-2-re-ts/src/ctf/g_ctf.ts) | [G14](#g14) | J / T |
| `q2.lmctf.flag-objective` — Complete Loki's Minions flag objectives | [D:src/lmctf/g_ctffunc.ts](../../quake-2-re-ts/src/lmctf/g_ctffunc.ts) | [G15](#g15) | J / T |
| `q2.lmctf.damage-resistance-runes` — Apply damage and resistance runes | [D:src/lmctf/g_runes.ts](../../quake-2-re-ts/src/lmctf/g_runes.ts) | [G15](#g15) | J / T |
| `q2.lmctf.haste-rune` — Accelerate weapons with the haste rune | [D:src/lmctf/g_runes.ts](../../quake-2-re-ts/src/lmctf/g_runes.ts) | [G15](#g15) | J / T |
| `q2.lmctf.regeneration-vampire` — Apply regeneration and vampire runes | [D:src/lmctf/g_runes.ts](../../quake-2-re-ts/src/lmctf/g_runes.ts) | [G15](#g15) | J / T |
| `q2.lmctf.offhand-hook` — Use the LMCTF offhand hook | [D:src/lmctf/g_ctffunc.ts](../../quake-2-re-ts/src/lmctf/g_ctffunc.ts) | [G15](#g15) | J / T |
| `q2.lmctf.tournament` — Run an LMCTF tournament match | [D:src/lmctf/g_tourney.ts](../../quake-2-re-ts/src/lmctf/g_tourney.ts) | [G15](#g15) | J / T |
| `q2.lmctf.voting` — Vote on map changes and referee selection | [D:src/lmctf/g_vote.ts](../../quake-2-re-ts/src/lmctf/g_vote.ts) | [G15](#g15) | J / T |
| `q2.lmctf.server-profile` — Apply LMCTF-specific server options | [D:src/client/menu_content.ts](../../quake-2-re-ts/src/client/menu_content.ts) | [G15](#g15) | J / T |
| `q2.seats.view-layouts` — Render one to four local player views | [D:src/client/cl_seats.ts](../../quake-2-re-ts/src/client/cl_seats.ts) | [G16](#g16) | J / T |
| `q2.seats.real-player-lifecycle` — Create local seats as real game clients | [D:src/server/sv_seats.ts](../../quake-2-re-ts/src/server/sv_seats.ts) | [G16](#g16) | J / T |
| `q2.seats.independent-commands` — Drive each local player independently | [D:src/client/cl_seats.ts](../../quake-2-re-ts/src/client/cl_seats.ts) | [G16](#g16) | J / T |
| `q2.seats.private-messages` — Route private HUD and messages to the correct seat | [D:src/client/cl_seats.ts](../../quake-2-re-ts/src/client/cl_seats.ts) | [G16](#g16) | P / T |
| `q2.seats.hotplug-focus` — Handle controller loss and shared menu focus | [D:src/client/cl_seats.ts](../../quake-2-re-ts/src/client/cl_seats.ts) | [G16](#g16) | P / T |
| `q2.seats.remote-network` — Use multiple local players on a remote server | [D:src/client/cl_seats.ts](../../quake-2-re-ts/src/client/cl_seats.ts) | [G16](#g16) | P / T |
| `q2.seats.mixed-local-remote` — Mix local seats and remote peers on a listen server | [D:src/server/sv_seats.ts](../../quake-2-re-ts/src/server/sv_seats.ts) | [G16](#g16) | P / T |
| `q2.bots.add-remove-fill` — Manage bot population | [D:src/server/bots/bot_client.ts](../../quake-2-re-ts/src/server/bots/bot_client.ts) | [G17](#g17) | P / T |
| `q2.bots.skills-personalities` — Select bot skills and characters | [D:src/server/bots/bot_client.ts](../../quake-2-re-ts/src/server/bots/bot_client.ts) | [G17](#g17) | P / T |
| `q2.bots.combat-campaign-goals` — Execute bot combat and campaign decisions | [D:src/server/bots/bot_client.ts](../../quake-2-re-ts/src/server/bots/bot_client.ts) | [G17](#g17) | P / T |
| `q2.bots.map-lifecycle` — Restore bot population after map changes | [D:src/server/bots/bot_client.ts](../../quake-2-re-ts/src/server/bots/bot_client.ts) | [G17](#g17) | P / T |
| `q2.navigation.nav2-loading` — Load and validate NAV2 navigation data | [D:src/server/nav.ts](../../quake-2-re-ts/src/server/nav.ts) | [G18](#g18) | P / T |
| `q2.navigation.path-capabilities` — Respect navigation traversal capabilities | [D:src/server/nav.ts](../../quake-2-re-ts/src/server/nav.ts) | [G18](#g18) | P / T |
| `q2.navigation.dynamic-obstacles` — Update routes for doors, lifts, hazards, and moving floors | [D:src/server/nav.ts](../../quake-2-re-ts/src/server/nav.ts) | [G18](#g18) | P / T |
| `q2.navigation.foreign-map-construction` — Construct navigation for maps without NAV2 | [D:src/server/nav.ts](../../quake-2-re-ts/src/server/nav.ts) | [G18](#g18) | P / T |
| `q2.hud.profile-selection` — Select the correct classic or rerelease HUD | [D:src/client/cgame/host.ts](../../quake-2-re-ts/src/client/cgame/host.ts) | [G19](#g19) | P / T |
| `q2.hud.inventory` — Open and use the inventory display | [D:src/client/cl_inv.ts](../../quake-2-re-ts/src/client/cl_inv.ts) | [G19](#g19) | P / T |
| `q2.hud.weapon-wheel` — Select a weapon with the radial wheel | [D:src/client/cl_wheel.ts](../../quake-2-re-ts/src/client/cl_wheel.ts) | [G19](#g19) | P / T |
| `q2.hud.powerup-wheel` — Use powerups through the radial wheel | [D:src/client/cl_wheel.ts](../../quake-2-re-ts/src/client/cl_wheel.ts) | [G19](#g19) | P / T |
| `q2.hud.weapon-carousel` — Cycle weapons with the carousel | [D:src/client/cl_wheel.ts](../../quake-2-re-ts/src/client/cl_wheel.ts) | [G19](#g19) | P / T |
| `q2.hud.score-help` — Display scoreboards and the help computer | [D:src/kexgame/p_hud.ts](../../quake-2-re-ts/src/kexgame/p_hud.ts) | [G19](#g19) | P / T |
| `q2.hud.poi-stages` — Activate and advance objective markers | [D:src/client/cl_scrn.ts](../../quake-2-re-ts/src/client/cl_scrn.ts) | [G20](#g20) | P / — |
| `q2.hud.compass-help-path` — Draw the compass route to the active objective | [D:src/kexgame/g_items.ts](../../quake-2-re-ts/src/kexgame/g_items.ts) | [G20](#g20) | G / — |
| `q2.hud.boss-health-bars` — Display and clear authored boss health bars | [D:src/kexgame/p_hud.ts](../../quake-2-re-ts/src/kexgame/p_hud.ts) | [G20](#g20) | P / — |
| `q2.hud.damage-feedback` — Display damage direction and pickup feedback | [D:src/client/cl_scrn.ts](../../quake-2-re-ts/src/client/cl_scrn.ts) | [G19](#g19) | P / T |
| `q2.hud.centerprints-notifications` — Queue localized centerprints and notifications | [D:src/client/cl_scrn.ts](../../quake-2-re-ts/src/client/cl_scrn.ts) | [G19](#g19) | P / T |
| `q2.hud.story` — Show and clear rerelease story text | [D:src/game/g_kextarg.ts](../../quake-2-re-ts/src/game/g_kextarg.ts) | [G19](#g19) | P / T |
| `q2.accessibility.localization-formatting` — Resolve localized and formatted messages | [D:src/qcommon/loc.ts](../../quake-2-re-ts/src/qcommon/loc.ts) | [G21](#g21) | P / T |
| `q2.accessibility.language-reload` — Reload mounted localization tables | [D:src/qcommon/loc.ts](../../quake-2-re-ts/src/qcommon/loc.ts) | [G21](#g21) | P / T |
| `q2.accessibility.kfont-unicode` — Draw Unicode text with authored font metrics | [D:src/client/cgame/host.ts](../../quake-2-re-ts/src/client/cgame/host.ts) | [G21](#g21) | P / T |
| `q2.accessibility.contrast-typeface` — Choose contrast backgrounds and alternate typefaces | [D:src/kexgame/cgame/cg_screen.ts](../../quake-2-re-ts/src/kexgame/cgame/cg_screen.ts) | [G21](#g21) | P / T |
| `q2.accessibility.independent-scales` — Scale menus, HUD, and console independently | [D:src/client/cgame/host.ts](../../quake-2-re-ts/src/client/cgame/host.ts) | [G21](#g21) | P / T |
| `q2.accessibility.color-and-captions` — Complete readable non-color-only and caption workflows | [D:src/kexgame/cgame/cg_screen.ts](../../quake-2-re-ts/src/kexgame/cgame/cg_screen.ts) | [G21](#g21) | P / T |
| `q2.input.controller-assignment` — Persist controller-to-player assignments | [D:src/platform/gamepad_assign.ts](../../quake-2-re-ts/src/platform/gamepad_assign.ts) | [G22](#g22) | P / T |
| `q2.input.per-player-tuning` — Tune controller axes independently | [D:src/platform/gamepad_assign.ts](../../quake-2-re-ts/src/platform/gamepad_assign.ts) | [G22](#g22) | P / T |
| `q2.input.buttons-triggers` — Map controller buttons and analog triggers | [D:src/platform/gamepad_map.ts](../../quake-2-re-ts/src/platform/gamepad_map.ts) | [G22](#g22) | P / T |
| `q2.input.axis-deadzone` — Apply analog deadzones and response | [D:src/platform/gamepad_map.ts](../../quake-2-re-ts/src/platform/gamepad_map.ts) | [G22](#g22) | P / T |
| `q2.input.binds-keyboard-mouse` — Bind keyboard and mouse gameplay controls | [D:src/client/keys_impl.ts](../../quake-2-re-ts/src/client/keys_impl.ts) | [G22](#g22) | P / T |
| `q2.input.haptic-envelopes` — Play sound-triggered tactile envelopes | [D:src/platform/haptics.ts](../../quake-2-re-ts/src/platform/haptics.ts) | [G22](#g22) | P / T |
| `q2.input.per-seat-rumble` — Route haptics to the affected local player | [D:src/platform/haptics.ts](../../quake-2-re-ts/src/platform/haptics.ts) | [G22](#g22) | P / T |
| `q2.input.gyro-device-behavior` — Complete required gyro and device controls | [D:src/platform/gamepad_assign.ts](../../quake-2-re-ts/src/platform/gamepad_assign.ts) | [G22](#g22) | ? / — |
| `q2.audio.spatial-channels` — Spatialize positional sounds and channel replacement | [D:src/client/snd_dma.ts](../../quake-2-re-ts/src/client/snd_dma.ts) | [G23](#g23) | J / T |
| `q2.audio.looping-world` — Maintain looping world and entity sounds | [D:src/client/snd_dma.ts](../../quake-2-re-ts/src/client/snd_dma.ts) | [G23](#g23) | J / T |
| `q2.audio.wav-resampling` — Decode and resample authored WAV sounds | [D:src/client/snd_mem.ts](../../quake-2-re-ts/src/client/snd_mem.ts) | [G23](#g23) | J / T |
| `q2.audio.raw-pcm` — Mix cinematic and streamed PCM | [D:src/client/snd_dma.ts](../../quake-2-re-ts/src/client/snd_dma.ts) | [G23](#g23) | J / T |
| `q2.audio.environment-zones` — Select and interpolate reverb environments | [D:src/client/snd_environments.ts](../../quake-2-re-ts/src/client/snd_environments.ts) | [G24](#g24) | G / — |
| `q2.audio.reverb-dsp` — Apply audible reverb processing | [D:src/client/snd_reverb_dsp.ts](../../quake-2-re-ts/src/client/snd_reverb_dsp.ts) | [G24](#g24) | G / — |
| `q2.music.ogg-tracks` — Resolve and stream Ogg music tracks | [D:src/platform/cd_ogg.ts](../../quake-2-re-ts/src/platform/cd_ogg.ts) | [G25](#g25) | P / T |
| `q2.music.pause-resume-gain` — Control music pause, resume, and continuous gain | [D:src/platform/cd_ogg.ts](../../quake-2-re-ts/src/platform/cd_ogg.ts) | [G25](#g25) | P / T |
| `q2.music.menu-shuffle` — Control menu music and playlist shuffle | [D:src/client/cl_scrn.ts](../../quake-2-re-ts/src/client/cl_scrn.ts) | [G25](#g25) | P / T |
| `q2.audio.multiple-listeners` — Apply the explicit local-player audio policy | [D:src/client/snd_dma.ts](../../quake-2-re-ts/src/client/snd_dma.ts) | [G23](#g23) | J / T |
| `q2.media.cin-video` — Decode and present classic CIN frames | [D:src/client/cl_cin.ts](../../quake-2-re-ts/src/client/cl_cin.ts) | [G26](#g26) | P / T |
| `q2.media.cin-soundtrack` — Synchronize the CIN soundtrack | [D:src/client/cl_cin.ts](../../quake-2-re-ts/src/client/cl_cin.ts) | [G26](#g26) | P / T |
| `q2.media.static-pcx` — Present static PCX intermission images | [D:src/client/cl_cin.ts](../../quake-2-re-ts/src/client/cl_cin.ts) | [G26](#g26) | P / T |
| `q2.media.pause-skip-transition` — Pause, skip, and finish cinematic transitions | [D:src/client/cl_cin.ts](../../quake-2-re-ts/src/client/cl_cin.ts) | [G26](#g26) | P / T |
| `q2.media.rerelease-formats` — Play required rerelease and expansion media formats | [D:src/client/menu_content.ts](../../quake-2-re-ts/src/client/menu_content.ts) | [G26](#g26) | ? / — |
| `q2.media.timed-subtitles` — Display timed cinematic subtitles and captions | [D:src/client/cl_cin.ts](../../quake-2-re-ts/src/client/cl_cin.ts) | [G26](#g26) | ? / — |
| `q2.save.manual-slots` — Create and load manual save slots | [D:src/server/sv_ccmds.ts](../../quake-2-re-ts/src/server/sv_ccmds.ts) | [G27](#g27) | P / T (B1–B5 use encoded checkpoints) |
| `q2.save.eligibility-paths` — Enforce save eligibility and contained slot paths | [D:src/server/sv_ccmds.ts](../../quake-2-re-ts/src/server/sv_ccmds.ts) | [G27](#g27) | P / T |
| `q2.save.rerelease-json` — Persist rerelease game and level containers | [D:src/kexgame/g_save.ts](../../quake-2-re-ts/src/kexgame/g_save.ts) | [G27](#g27) | P / T |
| `q2.save.callback-graph` — Restore entity callbacks and references | [D:src/game/g_save.ts](../../quake-2-re-ts/src/game/g_save.ts) | [G27](#g27) | P / B1–B5 |
| `q2.save.inventory-capacities` — Restore expansion ammunition capacities | [D:src/game/g_save.ts](../../quake-2-re-ts/src/game/g_save.ts) | [G27](#g27) | P / B5 (cells only) |
| `q2.save.poi-health-story` — Restore objective and presentation state | [D:src/game/g_save.ts](../../quake-2-re-ts/src/game/g_save.ts) | [G27](#g27) | P / T |
| `q2.save.fog` — Restore entity and player fog state | [D:src/game/g_save.ts](../../quake-2-re-ts/src/game/g_save.ts) | [G27](#g27) | P / T |
| `q2.save.brush-animation` — Restore brush-model animation state | [D:src/game/g_save.ts](../../quake-2-re-ts/src/game/g_save.ts) | [G27](#g27) | P / T |
| `q2.campaign.unit-backtracking` — Restore revisited levels within a unit | [D:src/server/sv_ccmds.ts](../../quake-2-re-ts/src/server/sv_ccmds.ts) | [G28](#g28) | P / T |
| `q2.campaign.landmark-arrival` — Preserve landmark-relative arrival | [D:src/kexgame/p_client.ts](../../quake-2-re-ts/src/kexgame/p_client.ts) | [G28](#g28) | P / T |
| `q2.campaign.crosslevel-crossunit` — Persist authored crosslevel and crossunit flags | [D:src/kexgame/g_target.ts](../../quake-2-re-ts/src/kexgame/g_target.ts) | [G28](#g28) | P / T |
| `q2.campaign.coop-keys` — Share or preserve cooperative key progression | [D:src/game/g_items.ts](../../quake-2-re-ts/src/game/g_items.ts) | [G28](#g28) | P / T |
| `q2.campaign.hub-endings` — Complete hubs, objectives, secrets, and endings | [D:src/kexgame/p_hud.ts](../../quake-2-re-ts/src/kexgame/p_hud.ts) | [G28](#g28) | P / T |
| `q2.save.autosave-transition` — Distinguish autosaves from transition snapshots | [D:src/server/sv_ccmds.ts](../../quake-2-re-ts/src/server/sv_ccmds.ts) | [G27](#g27) | P / T |
| `q2.service.achievements` — Record authored achievement events durably | [D:src/game/g_kextarg.ts](../../quake-2-re-ts/src/game/g_kextarg.ts) | [G29](#g29) | G / — |
| `q2.service.match-report-lobby` — Complete match reporting and lobby lifecycle | [D:src/kexgame/p_hud.ts](../../quake-2-re-ts/src/kexgame/p_hud.ts) | [G29](#g29) | P / — |
| `q2.demo.client-recording` — Record and replay ordinary demos | [D:src/client/cl_main.ts](../../quake-2-re-ts/src/client/cl_main.ts) | [G30](#g30) | P / — |
| `q2.demo.protocol-playback` — Play supported classic and rerelease demos | [D:src/client/cl_demo.ts](../../quake-2-re-ts/src/client/cl_demo.ts) | [G30](#g30) | P / — |
| `q2.demo.server-recording` — Record server demos | [D:src/server/sv_ccmds.ts](../../quake-2-re-ts/src/server/sv_ccmds.ts) | [G30](#g30) | ? / — |
| `q2.demo.mvd-recording` — Record multi-view demos | [D:src/server/sv_mvd.ts](../../quake-2-re-ts/src/server/sv_mvd.ts) | [G30](#g30) | P / — |
| `q2.demo.gtv-streaming` — Authenticate and stream GTV spectators | [D:src/server/sv_mvd.ts](../../quake-2-re-ts/src/server/sv_mvd.ts) | [G30](#g30) | ? / — |
| `q2.demo.view-controls-seats` — Control playback and recorded local viewpoints | [D:src/client/cl_demo.ts](../../quake-2-re-ts/src/client/cl_demo.ts) | [G30](#g30) | P / — |
| `q2.network.admission-reconnect` — Connect, reconnect, and disconnect remote clients | [D:src/client/cl_main.ts](../../quake-2-re-ts/src/client/cl_main.ts) | [G31](#g31) | P / T |
| `q2.network.classic-protocol` — Preserve stock protocol 34 behavior | [D:src/qcommon/protocol/vanilla.ts](../../quake-2-re-ts/src/qcommon/protocol/vanilla.ts) | [G31](#g31) | J / T |
| `q2.network.extended-protocols` — Preserve supported R1Q2 and Q2PRO variants | [D:src/qcommon/protocol/r1q2.ts](../../quake-2-re-ts/src/qcommon/protocol/r1q2.ts) | [G31](#g31) | P / T |
| `q2.network.rerelease-1038` — Preserve the rerelease-derived protocol | [D:src/qcommon/protocol/q2repro.ts](../../quake-2-re-ts/src/qcommon/protocol/q2repro.ts) | [G31](#g31) | P / T |
| `q2.network.private-wide-classic` — Keep private wide-classic protocol 4038 distinct | [D:src/qcommon/protocol/q2repro.ts](../../quake-2-re-ts/src/qcommon/protocol/q2repro.ts) | [G31](#g31) | P / T |
| `q2.network.prediction-reconciliation` — Match selected movement in client prediction | [D:src/client/cl_pred.ts](../../quake-2-re-ts/src/client/cl_pred.ts) | [G12](#g12) | J / T |
| `q2.network.connectionless-rcon` — Process status, ping, challenges, and rcon | [D:src/client/cl_main.ts](../../quake-2-re-ts/src/client/cl_main.ts) | [G31](#g31) | P / T |
| `q2.browser.master-lan` — Discover servers from UDP, HTTP, and LAN sources | [D:src/client/cl_servers.ts](../../quake-2-re-ts/src/client/cl_servers.ts) | [G32](#g32) | P / — |
| `q2.browser.status-details` — Inspect server rules and player details | [D:src/client/cl_servers.ts](../../quake-2-re-ts/src/client/cl_servers.ts) | [G32](#g32) | P / — |
| `q2.browser.sort-filter` — Filter and sort server results | [D:src/client/cl_servers.ts](../../quake-2-re-ts/src/client/cl_servers.ts) | [G32](#g32) | P / — |
| `q2.browser.favorites` — Persist favorites and direct-connect addresses | [D:src/client/cl_servers.ts](../../quake-2-re-ts/src/client/cl_servers.ts) | [G32](#g32) | P / — |
| `q2.download.path-policy` — Validate and contain content downloads | [D:src/client/cl_http.ts](../../quake-2-re-ts/src/client/cl_http.ts) | [G32](#g32) | P / — |
| `q2.download.http-queue` — Download content through concurrent HTTP queues | [D:src/client/cl_http.ts](../../quake-2-re-ts/src/client/cl_http.ts) | [G32](#g32) | P / — |
| `q2.download.filelists` — Expand validated server filelists | [D:src/client/cl_http.ts](../../quake-2-re-ts/src/client/cl_http.ts) | [G32](#g32) | P / — |
| `q2.download.mount-rescan` — Mount downloaded archives and rescan missing assets | [D:src/client/cl_http.ts](../../quake-2-re-ts/src/client/cl_http.ts) | [G32](#g32) | P / — |
| `q2.download.udp-fallback` — Fall back from HTTP to UDP transfer | [D:src/client/cl_http.ts](../../quake-2-re-ts/src/client/cl_http.ts) | [G32](#g32) | P / — |
| `q2.admin.operator-console` — Use dedicated-server stdin | [D:src/platform/sys.ts](../../quake-2-re-ts/src/platform/sys.ts) | [G33](#g33) | P / T |
| `q2.admin.status-kick` — Inspect clients and remove a player | [D:src/server/sv_ccmds.ts](../../quake-2-re-ts/src/server/sv_ccmds.ts) | [G33](#g33) | P / T |
| `q2.admin.masters-heartbeat` — Configure masters and heartbeat publication | [D:src/server/sv_ccmds.ts](../../quake-2-re-ts/src/server/sv_ccmds.ts) | [G33](#g33) | P / T |
| `q2.admin.chat-team-private` — Communicate through player and server chat | [D:src/game/g_cmds.ts](../../quake-2-re-ts/src/game/g_cmds.ts) | [G33](#g33) | P / T |
| `q2.admin.player-identity` — Configure player names, skins, handedness, and view settings | [D:src/game/p_client.ts](../../quake-2-re-ts/src/game/p_client.ts) | [G33](#g33) | P / T |
| `q2.admin.spectator-chase` — Enter spectator mode and chase active players | [D:src/game/g_chase.ts](../../quake-2-re-ts/src/game/g_chase.ts) | [G33](#g33) | P / T |
| `q2.config.archived-state` — Persist binds and archived cvars | [D:src/client/cl_main.ts](../../quake-2-re-ts/src/client/cl_main.ts) | [G34](#g34) | P / T |
| `q2.config.scripts-aliases` — Execute config scripts, aliases, and command buffers | [D:src/qcommon/cmd.ts](../../quake-2-re-ts/src/qcommon/cmd.ts) | [G34](#g34) | P / T |
| `q2.config.console-completion` — Use console history and command or cvar completion | [D:src/qcommon/cmd.ts](../../quake-2-re-ts/src/qcommon/cmd.ts) | [G34](#g34) | P / T |
| `q2.config.audio-video-input-menus` — Apply video, audio, and input settings | [D:src/platform/vid.ts](../../quake-2-re-ts/src/platform/vid.ts) | [G34](#g34) | P / T |
| `q2.capture.screenshots` — Capture the active CPU and GL scene | [D:src/platform/vid.ts](../../quake-2-re-ts/src/platform/vid.ts) | [G35](#g35) | J / B2 |
| `q2.config.renderer-restart` — Restart or switch renderer within a live session | [D:src/platform/vid.ts](../../quake-2-re-ts/src/platform/vid.ts) | [G34](#g34) | P / T |
| `q2.diagnostics.runtime-camera` — Execute authored target cameras | [D:src/kexgame/g_target.ts](../../quake-2-re-ts/src/kexgame/g_target.ts) | [G07](#g07) | J / T |
| `q2.assets.bspx-lightmaps` — Load decoupled BSPX lightmaps | [D:src/qcommon/bspx.ts](../../quake-2-re-ts/src/qcommon/bspx.ts) | [G36](#g36) | J / T |
| `q2.assets.lightgrid` — Light entities from BSPX light grids | [D:src/qcommon/bspx.ts](../../quake-2-re-ts/src/qcommon/bspx.ts) | [G36](#g36) | J / T |
| `q2.assets.md5-replacements` — Select correctly scaled skeletal model replacements | [D:src/qcommon/md5_model.ts](../../quake-2-re-ts/src/qcommon/md5_model.ts) | [G36](#g36) | J / T |
| `q2.assets.md5-animation` — Animate skeletal models with authored scale | [D:src/qcommon/md5_model.ts](../../quake-2-re-ts/src/qcommon/md5_model.ts) | [G36](#g36) | J / T |
| `q2.visual.dynamic-lights` — Animate and switch authored target lights | [D:src/kexgame/g_target.ts](../../quake-2-re-ts/src/kexgame/g_target.ts) | [G37](#g37) | P / T |
| `q2.visual.sky-fog-world-effects` — Present authored sky, fog, and world effects | [D:src/kexgame/g_target.ts](../../quake-2-re-ts/src/kexgame/g_target.ts) | [G37](#g37) | P / T |

## Concrete gaps and unresolved comparisons

1. **Application reverb is not joined:** [audio/engine.ts](../src/audio/engine.ts) implements `setEnvironment`, per-listener environment state and DSP. A search of all production `src` finds no caller of `setEnvironment`. Q2 environment selection and DSP must be carried into application/map setup before claiming audible support.
2. **RR guidance/flashlight/achievement source events lack a demonstrated app consumer:** [rerelease/types.ts](../src/content/q2/rerelease/types.ts) defines them; [rerelease-presentation.ts](../src/app/bootstrap/rerelease-presentation.ts) handles fog, story, localized prints and sky. Generic POI HUD capability does not close the compass path. No achievement consumer was found in the app.
3. **Native KEX wire is not live:** [network/q2.ts](../src/app/bootstrap/network/q2.ts) rejects `q2-kex` and `q2-kex-demo` with `KEX native live transport is unbound`. Codec presence is not a connected-client claim. Q2repro-derived 1038, private4038 and proprietary KEX identities must remain distinct.
4. **Local beam repair is not network beam repair:** [simulation/network.ts](../src/app/bootstrap/simulation/network.ts) still writes `wire.old_origin` from `body.origin`. The local RR model-beam endpoint preservation therefore does not prove native-wire visual correctness.
5. **Native Q2 remote seating is restricted:** the current remote adapter says one player per native Q2 connection. The shared seat system must not be reported as complete remote rerelease split-screen without independent connections/negotiation proof.
6. **Selected content is intentionally narrower than native source code:** [monster-runtime.ts](../src/app/bootstrap/simulation/monster-runtime.ts) gates authored classes/flags; [runtime.ts](../src/app/bootstrap/simulation/runtime.ts) limits selected Q1 supply on Q2 programs to base Q2. Native expansion code is not an all-map selected arsenal/monster guarantee.
7. **Q3-native-world victim armor remains a separate hole:** its host supplies facing zero and no Q2 armor source profile. The fact1 brain proof uses a Q2 map/shared combat path and does not cover that bridge.
8. **Guest/source saving and service workflows are incomplete evidence:** native execution's recorded instruction-budget limit, all original container formats, cross-unit campaign state, online services, GTV, complete media/captions and server-browser/download UX require further concrete checks.
9. **No global best-renderer, best-AI or best-audio decision is justified yet:** CPU/GL matching and an imported Q3 bot library do not rank fidelity or performance. Preserve Q2 BSPX/lightgrid, MD5 tiering, localization, independent seats, reverb, guidance, save and protocol features in the universal target while benchmarking the shared implementations.

The immediate implementation priority follows concrete unjoined paths, then bounded source comparisons for the still-provisional choices. This document does not waive any source feature because the donor omitted it or because another family already offers a smaller substitute.
