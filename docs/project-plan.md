# Unified Quake TypeScript engine project plan

This plan builds one Bun engine for Quake 1, Quake 2 and Quake 3, including their classic and rerelease editions, all expansions, all game content and all functionality. Completion includes full campaigns, multiplayer, bots, local splitscreen, saves, demos, media, input, menus, server operation and mods. Maps, movement, characters, weapons, entities and rules can mix across games, including different selections for actors in one session. Implementation is authorized. Checkpoint `7521ab4` makes shared body ground authoritative and shares Q3 gauntlet/lightning execution. Root checks cover foreign support, cleared support, a retail moving platform carrying a player/item/foreign grenade, suspended-item preservation, native/selected attacks, reflection and saves. Checkpoint `83b4dfe` shares Q3 shotgun execution and source impact effects; actual native/selected fire, Team Arena reflection, binary saves and shooter-release cleanup pass. Checkpoint `db11bbd` shares native and selected Q3 machinegun/chaingun execution and preserves actor identity through Q3 trigger/impact dispatch. Checkpoints `b078c5c`, `11eab2e` and `2a434c4` add shared Q3 mover, damage/use, radius/spawn and target-laser observations; `368e179` fixes Q1 CTF program admission. Root checks cover real foreign barrels, native Team Arena reflection, LMCTF rules, selected bullet saves and contact ordering. Checkpoint `3d59ed6` commits shared grapple weapon-slot selection, source handoffs, outgoing presentation and saves. Checkpoint `1fbc44b` transports attached bodies through committed shared movement and saves their relations in save format 2. Checkpoints `a036455` and `39ba6f8` fix semantic grapple lifetime checks and Q3 brush collision roles. Earlier `edb5b35` commits selected offhand Threewave, Q2 CTF and LMCTF execution. Checkpoint `e3437e2` supplies offhand Q2 grenades, `f8999c4` and `c6c25b6` supply source primary handoffs, and `0ac29b3` retains logical map identity and scopes map assets; recipe schema 2 rejects the old format. Earlier checkpoints supply equipment cores, source hosts/projection, catalog selection and sky/noise save handling. Earlier selected base-Q3 arsenal and native pickup-supply checkpoints remain bounded implementation progress. Earlier checkpoint `423101a` fixes Q2 intensity, MD2 face culling, Sarge child-model skins, audio queue sizing/frame cost and selected-character jump audio under Q1 movement. Earlier checkpoint `827636f` adds the Q3-derived bot core on Q2 standard deathmatch. W03 remains the only formally accepted package, for its early tooling scope. The [execution ledger](execution-status.md) separates source progress, uncommitted work and installed artifacts.

Checkpoint `69f33f9` shares Q3 rail execution; `0cbad5d` shares radius damage and preserves projectile provenance. Native/selected attacks, reflection, temporary rail unlinking, binary saves and source effects have bounded checks. Checkpoints `c74d205` and `cb89c28` attach selected Q3 world weapons and preserve Q2 SKY surfaces carrying NODRAW. Root inspected CPU captures from the production scene composition. Checkpoints `b640bb4` and `5a1d7a6` publish the initial Q1 view weapon and apply native MDL skin-background preprocessing; same-camera captures verify the missing gun and blue edge corrections. Checkpoint `e8cc40c` shares native and selected Q3 projectile continuation, including bounded damage, bounce/fuse, owner-release saves and reflection checks. Checkpoints `4ee713a` and `674a0b0` preserve special missile contacts and lifetimes across actual actor release. Complete visual fidelity remains open. Checkpoint `0652053` admits selected classic Q2 infantry on Q1 maps and classic Q1 army on Q2 maps through the same actor, body and source behavior services. Root checks cover natural attacks in both directions, binary saves with explicit lifetime remapping, and base1's actual pickup-triggered activation, combat-point route and death target. Source and authored item drops remain distinct. This does not establish the full bestiary, rerelease interchangeability, Q1 path-corner traversal or all mission scripts; finer unsupported source cadences reject explicitly. Checkpoint `bc17271` registers classic dog and berserk through existing source services. Root checks cover untouched authored berserk placement/attack/save on Q1, selected dog bite/leap/save on a fitting Q1 recipe, and native startup drop/flags/callback ordering. Actual all-dog replacement on Q2 base1 now refuses obstructed source bounds explicitly; no creature is moved or shrunk. This is not universal dog placement or rerelease berserk acceptance.

Earlier source checks exercise the selected Q3 arsenal on Q1/Q2 maps through shared actors and all three movement providers. The lead reports bounded exact-damage, rocket/grenade, save and travel checks. That work is not in the installed executable. Named Q1 id1 and Q2 base-program standard-match profiles now admit native weapon/ammunition pickups into the selected base-Q3 arsenal. Root checks cover real pickups, pending-switch saves, travel, mission-key clearing, respawn capacities and retained Q2 power-armor cells. Arbitrary pickup replacement, expansion supply, backpacks/death drops, capacity packs and other arsenals remain incomplete. Q1/Q2 source services are extracted, and native map admission uses the same implementation. Preallocated actors retain identity, body and combat; Q1 checkpoints support foreign and non-slot owners. Focused root checks passed 11 Q1 tests with 256 assertions and 3 Q2 tests with 23 assertions. Actor-owned execution and bounded classic selected-creature admission are committed; the full roster, unexercised authored obligations and presentation joins remain incomplete. Full independent swappability remains the target, not a completed capability.

The lead independently verified grenade input, projectiles, bodies and actual damage on Q1/Q2/Q3, including a Q3 lethal source death. Checks cover Q1/Q2 cooking and flight saves, a 180-step Q2 save continuation, primed Q1 campaign travel, and LMCTF pause/disconnect cleanup. Selected equipment assets retain source provenance. Native world stepping remains unchanged at the exercised 16/30/100/25/50 ms intervals. Q3 trigger eligibility now works without fake foreign entities; actual pickup and hurt overlaps were verified. These bounded results do not establish general foreign attacker/client views or Q3 full saves, which remain unsupported.

The lead independently verified shared slot selection, rapid switching, outgoing presentation, source gauntlet suppression, saves and travel in representative native and mixed configurations. Rerelease CTF follows an actual q3dm11 door through its full 94-unit movement and stop. LMCTF retains native player-contact damage pulses, and attached relations survive save identity remapping. All three grapple variants now follow actual moving Q3 brushes in the exercised Q1-movement configurations. Native Q3 movement beside a real LMCTF hook also passes. Complete sky/render fidelity, general Q3 foreign observations and full Q3 saves remain unproven. Active work addresses selected Q1 arsenal/supply integration and the remaining monster roster, cadence and mission obligations. The close army firing capture remains insufficient evidence of firing-frame fidelity; the actual initial camera approach triggers the berserk area light off, and another authored trigger restores style 32 to 12; its sampled 7/255 remains dark. GUI/keybinding wiring is absent.

The user's current priority is the engine; menu work is paused. Finish core interoperability and prove independent selections in actual play before resuming menu work. Preserve one common subsystem implementation with useful capabilities from every game. All-family native gameplay, monsters, multiple arsenals, pickup replacement, mixed networking and guest parity remain incomplete. The executable in `~/Projects/qfiles` remains the older `827636f` bot build; none of the subsequent engine, arsenal or equipment checkpoints has replaced it. No audible launch accompanies this documentation update. Broad hardening and release acceptance remain required after implementation, live play and optimization.

The [source assessment](source-assessment.md) pins checkout paths, commits, original references, data and defects. The [feature ledger](feature-coverage.md) preserves 25 rows and all 40 inventory families for expansion into an exhaustive registry. The [machine work graph](work-packages.json) owns IDs and dependencies; its [diagram](dependency-graph.mmd) presents them. The [verification plan](verification-plan.md) defines evidence. Run [plan validation](validate-plan.ts) with `bun docs/validate-plan.ts`. Run [validator tests](test-plan-validator.ts) with `bun docs/test-plan-validator.ts`.

Q1 Nintendo 64 fixture coverage remains unresolved. Extra Quake Live assets do not expand the requested product scope.

## Build one simulation from the strongest subsystem implementations

One shared TypeScript world executes official actors, weapons, movement and missions. Concurrent complete family loops would create competing authority over time, contacts, lifetime and transitions.

Shared id Tech ancestry offers common command buffering, cvars, filesystems, messages, math, entity allocation/linking, resource lifetimes, animation and renderer submission. Consolidate after comparing registration order, path precedence, errors, bit encoding, rounding, link timing and invalidation. Retain differing policies. Q2's command and cvar headers already record changed iteration order; familiar names alone do not establish equivalence.

For every subsystem, choose the strongest implementation and broaden that common system with every useful feature from every game. This rule applies throughout the product: one engine, one world and one executable, with the combined capabilities available across content. Preserve source-specific policies where behavior requires them. Original source and retail observations define fidelity; TypeScript outputs are not golden oracles.

| Subsystem | Starting material and required improvement |
| --- | --- |
| Ownership and strict tooling | Q3's instance-owned world, resource lifecycle and compiler-API policy checker. Extend contracts beyond its product assumptions. |
| QuakeC and Q1 content | Q1's VM profiles, archives, release formats and campaign knowledge. Port built-in behavior to strict TS and replace lossy entity mappings. |
| Game bindings and content selection | Q2's peer APIs, campaign catalog and asset precedence. Separate API, timing and wire identities throughout. |
| Rendering | Q3's shared CPU and GL backend contract, with Q1 and Q2 palette, model, effect and rerelease improvements. |
| Bots and navigation | Use one Q3-derived player-bot core and add useful rerelease features. Bots issue normal actions under engine physics. Broaden shared navigation across required content; do not select an alternate rerelease player-bot brain in production. |
| Seats, input and sound | Q1 and Q2 controller assignment, haptics and seats; Q2 environmental audio; Q3 ownership and mixing where stronger. |
| Media and interface | Retain Q1 typography/localization, Q2 guidance and weapon wheel, Q3 scripted UI, and CIN, OGV and RoQ codecs. |
| Verification | Q3's immutable snapshots and artifact evidence, plus useful scenarios from every port after expectation review. |

Built-in Q1 actors, weapons and missions receive audited TypeScript ports from original QuakeC. Mechanical generators can produce constants, layouts and registries. A general semantic transpiler adds control-flow and aliasing obligations without removing crossover adaptation, so it is not a prerequisite. QC and QVM execution remain required for external gamecode and independent comparison.

## Resolve choices before constructing the executable session

Keep three objects separate. A launch choice describes what the player selected. An executable recipe contains resolved content, providers, numeric policies and dependencies. View options control rendering and local presentation. Changing resolution or the renderer does not change simulation identity.

Namespaced IDs identify game, edition, package and revision. Asset IDs include archive hash, member path and mount precedence. Equal filenames, classnames or numeric slots can name different content.

Q2's [mount rules](/home/buzzkill/Projects/quake-2-re-ts/src/client/menu_content.ts:800) provide the default. Selected rerelease rules receive their assets while selected classic geometry can retain map precedence. Explicit presentation overrides remain separate. Q1's [behavior switch](/home/buzzkill/Projects/quake-1-re-ts/ARCHITECTURE.md:141) changes engine behavior without replacing the campaign's gamecode. Preserve that distinction in named presets.

The player's map/campaign selection includes its mission logic, objectives, scripts, exits and normal level progression. Resolve internal mission and transition ownership automatically from that content; no separate mission selector is required. Swapping movement, characters, weapons, monsters or pickups must preserve that progression, including keys, sigils, targets and puzzles. Selected monsters must retain the authored encounter's mission obligations. The map also retains its lava, jump pads, traps and other authored world mechanisms. Swapping individual world mechanisms across game sources is deferred for later investigation; visual overrides remain allowed.

A Q2 map with Q1 movement and a Q3 character retains the map's entity and mission graph. The movement provider owns locomotion and prediction. The character supplies body, viewpoint, animation and voice, with independently selectable body, skin and voice where supported. Chosen weapons own their actions and ammunition. Movement, appearance and protocol do not implicitly choose combat or match rules.

The independent game-source choices are map/campaign with its progression, movement/physics, character, weapons, monsters/NPCs, pickups/equipment, combat and inventory rules, and presentation such as HUD, effects, sounds and music. Each selects behavior or content from the games for the common engine. Internal providers implement these choices without exposing separate whole-game runtimes.

Game mode, teams and scoring are independent settings, not Q1-versus-Q2-versus-Q3 source choices. Other settings and suboptions include bot skill/population, loadout quantities, capacities, death-drop configuration and character body/skin/voice selections. Grapple equip and attachment options below are also settings. These distinctions describe the intended design, not proof that every combination currently works. Menu implementation remains paused while engine interoperability is completed.

Offhand Q2 grenade execution is now committed across Q1/Q2/Q3 worlds, with the bounded evidence above. Checkpoint `47310c3` supplies Threewave, Q2 CTF and LMCTF grapple cores with their mechanics preserved and independent binding APIs. Native and offhand grenade actions reserve ammunition from the same inventory. Checkpoint `edb5b35` adds application offhand grapple execution; shared weapon-slot selection is committed in `3d59ed6`. Q2 hand grenades must be independently selectable offhand on any map with any arsenal, without selecting Q2 weapons. Press/release throws a grenade; holding cooks it before release. The current weapon stays equipped.

Required grapple source variants include Q1 Threewave, Q2 CTF and LMCTF. Both weapon-slot and offhand grapples are required in single-player, co-op and non-CTF multiplayer as well as CTF/LMCTF, without mode gating. Grapple mechanics, equip mode and activation binding are independent choices; allowed firing, weapon switching and attachment persistence are separately configurable. CTF and LMCTF presets supply native defaults without locking combinations. This broader grapple support is required work, not an implemented capability claim.

Selected equipment must not change the world physics timestep. Prepare actions against logical deadlines to avoid drift; emit effects at the current world pose and observe fuse expiry on a world boundary. The hand-action deadline-drift correction is committed; grenade checks preserve native world stepping. The selected-Q3-projectile host-clock prepass still requires unification.

The target includes Q2 characters completing a Q1 rerelease campaign while preserving its progression, with each player choosing movement and weapons independently. Objective modes on foreign maps require real spawn and objective placement, supplied by reviewed adapters or generated data. Missing adaptations remain work to finish.

## Separate headless simulation from every local seat

Signature sketches only:

```ts
interface Simulation {
	step(input: InputBatch): SimulationOutput;
	checkpoint(): SaveImage;
	close(): void;
}
interface SeatPresentation {
	render(snapshot: WorldSnapshot, options: ViewOptions,
		target: RenderBackend): void;
}
```

A dedicated host constructs simulation, clocks and connections without opening SDL or a renderer. A local application owns one or more seat clients. Each seat has input routing, prediction, camera, HUD, private messages, configuration and presentation state. Explicit listener and haptics policies route audio and rumble. No implicit seat-zero shortcut can satisfy local multiplayer acceptance.

The seat fixture combines local and remote players on CPU and GL. Give local seats different inventory and HUD layouts, independent wheel/menu actions and directed commands. Verify private effects reach only their seat and shared effects enter world state exactly once. Secondary layouts, inventory and commands must survive the source ports' dropped-message paths.

One session owns actor identities, authoritative components, spatial links, callbacks, clocks, RNG, inventory and campaign state. Only its registry constructs opaque generational identities. Providers distinguish actors they own from foreign actors they observe, so observation cannot schedule another owner's behavior. Separate body, controller, inventory, objective and presentation tables replace optional-field entity structs. Indices support spatial queries, owned weapons, objective participants and callbacks.

Simulation runs synchronously. Each recipe fixes frame-entry phases, due-think boundaries, command subdivision and equal-time ordering. Native configurations retain source entity traversal. Mixed configurations define provider order, entity order and invocation order explicitly. Typed callbacks return source-required results; notifications are a separate contract. Their restricted domain operations do not expose scheduling, rendering or protocol internals. Preserve nested calls, RNG ownership and spawn/delete visibility. Promise completion cannot order gameplay. Keep Q1's selected clock behavior, Q2 classic 10 Hz, rerelease timing and Q3 command processing independent of wire identity.

Admission fixtures preserve Q2 `ClientConnect` acceptance and userinfo changes, and Q3's denial-string-or-null result. A void event cannot represent these contracts.

Numeric contracts specify operation-level binary32 rounding, integer conversion and wrapping, random order and guest x87 or SSE behavior. They must cover entire causal chains. Equal final coordinates alone cannot prove matching contact, weapon, animation or predictable-event ordering.

## Give each gameplay decision one authority

W05 and W41 require a Q1 rocket striking a Q2 monster with selected Q3 combat and movement. Assert exact source-derived values and order before accepting W42–W49. Source imports can begin against the published contracts while those proofs finish. Record immutable attack provenance before mutation. Defaults come from the native preset; explicit choices replace only their named decisions when resolving the recipe:

| Decision | Native default | Explicit override | Owner and mutation authority |
| --- | --- | --- | --- |
| Attack | Source weapon | Selected weapon | Weapon emits action/cause; inventory commits ammunition |
| Capacities, pickups, drops | Source inventory | Selected inventory policy | Inventory table owns identities, counts and capacities |
| Health, armor, immunity, impulse | Source combat rules | Selected combat/armor policy | Actor field owner commits each result once |
| Pain, death, retaliation | Source actor | Selected actor behavior | Controller invokes ordered reaction callbacks |
| Motion and replay | Native movement | Per-actor movement provider | Body owner consumes impulses through that kernel |
| Scoring and rounds | Native mode | Selected match rules | Match owner consumes confirmed outcomes |
| Mission and level transition | Map campaign | Explicit transition policy | Campaign owns predicates; coordinator commits travel |

Health starts from the actor definition with declared rule modifiers. Source damage helpers implement the selected combat order. Test simultaneous impacts, radius damage, retaliation, death-triggered targets and deleted actors without duplicate health or armor consumption.

Campaign controllers own mission graphs, keys, sigils, hub state and completion predicates. Match controllers own round conditions, teams, scoring and rotation. A transition coordinator resolves typed round and level intents according to the selected mode. In a campaign, a match event cannot bypass an unsatisfied mission gate. Competitive rotation cannot silently mark campaign objectives complete.

This contract includes Q1 horde, Q2 Tag and DeathBall, and Team Arena One Flag, Overload and Harvester. It also preserves Q3 tiers, awards, unlocks and postgame progression. Publish the authority order for content imports and prove simultaneous-transition behavior before accepting the dependent modules.

## Preserve geometry and presentation without forcing one format

One scene-query owner retains Q1 BSP29 and BSP2 hulls, Q2 IBSP38 and QBSP brushes, and Q3 BSP46 brushes and patches. Preserve contents, surfaces, visibility, area portals, moving submodels and source trace tolerances. BRUSHLIST parsing alone cannot prove foreign actor collision.

The early Q1 proof constructs usable solid space from actual BSP29/BSP2 maps without BRUSHLIST. It does not claim to recover the authored brush set. Exercise foreign boxes/capsules, clip-only solids, thin geometry, contents, `startsolid`, `allsolid`, rotating/moving submodels and source tolerances. Preserve the stock hull path and compare overlapping cases. Measure preprocessing size/time and query cost. Failure blocks dependent crossover cells, not unrelated work.

Both CPU and GL consume the scene and material contracts. The CPU backend rasterizes in TypeScript and presents through SDL2. GL submits real GPU work. Preserve palettes, light styles, shaders, patches, fog, particles, cinematics and rerelease effects. Model adapters preserve frame animation, tags and skeletons. Explicit attachment metadata positions weapons and effects; a cosmetic change does not silently alter collision.

Offline Bun tools index archives and generate required collision, navigation and attachment data reproducibly. Q3 foreign-map bots need AAS construction, not only existing AAS loading. Q1 and Q2 navigation and original monster paths remain distinct obligations.

## Treat guest execution and semantic overrides as separate proofs

Retain QC v6 hosts for NQ CRC 5927 and QW CRC 54730, QVM game, cgame and UI roles, Q2 game APIs 3 and 2023, and cgame API 2022. These hosts are peers over shared services. No compatibility binding chains through another game's full runtime.

Required DLL and SO support uses a TypeScript guest CPU and ABI implementation. The audited corpus contains PE32 i386 with x87, PE32+ x64 with SSE, and ELF32 and ELF64. Loader work includes relocations, address space, calling conventions, imports, callbacks, runtime allocation, TLS and required unwind behavior. Prove actual initialization, gameplay, saving and shutdown. Native loading or an external emulator does not satisfy this requirement.

Guest raw bytes remain authoritative for source-specific state. Mappings define encodings, offsets, pointer widths, strides, callback addresses and lifetimes. Test partial writes, aliased loads, overlapping copies and integer/float reinterpretation. One canonical scalar cannot preserve every raw representation. Collision caches relink at source-defined points.

The fixture retains a foreign-actor pointer, enters nested damage/touch callbacks, deletes that actor and reuses its slot. Assert observations before each return, stale-pointer behavior, link-time bounds and restored interpreter context. Repeat with two sessions, then checkpoint and restore in a fresh process. No delayed copy-back or post-callback write masking may hide failure.

Private mod code may implement movement, damage or inventory internally. Loading its archive, VM or executable does not make those behaviors independently replaceable. Instrument actual calls and memory accesses, then prove artifact-specific semantic boundaries and the selected overrides against independent behavior. Generalized separation of unknown private implementations remains unresolved required work. The plan neither claims that typed views solve it nor removes those combinations from scope.

## Preserve complete sessions and player workflows

Native saves contain recipe identity, versioned shared or source-private checkpoint variants, raw guest state, stable callback IDs, clocks, RNG and progression. They contain no renderer handles or host JavaScript closures. Restoration reconstructs resources, guest-visible identities and callback bindings, then compares continuation with uninterrupted play. Original save and demo formats retain their behavior through explicit codecs.

Legacy network formats serve configurations they can represent. Mixed sessions negotiate content, rules, movement, inventory and numeric identities. Prediction covers weapon switching, ammo, animation, impulses and events alongside movement. Replay tests combine late/lost commands, different weapon/movement clocks, Q2 64 settings and LMCTF wide-wire adaptation. Specify predictable events and suppress duplicate effects on replay. Real reference peers establish original wire compatibility; two endpoints from this engine cannot provide independent proof.

Build traditional native SDL menus, rendered by both backends. Cover campaigns, maps, independent mix settings, character/loadout previews, local seats, bots, hosting, discovery, favorites, downloads, mods, saves, demos, cinematics, achievements, lobbies, controls, audio, video, accessibility and localization. Preserve legacy scripted and guest UIs. Guidance, POIs, health bars, inventory and weapon wheels remain runtime features.

Use ImageGen after layouts and an art brief exist. Record prompts/provenance and inspect compiled-menu captures. Art complements scalable text; interaction testing remains required.

## Assign ownership around the decisions each module contains

| Module area | Owned decisions |
| --- | --- |
| `src/catalog/` | Installed content, archive precedence, identities and recipe resolution |
| `src/world/` | Authoritative components, scheduler, gameplay policy composition and snapshots |
| `src/content/q1/`, `q2/`, `q3/` | Source actors, weapons, missions and mode behavior |
| `src/movement/` | Locomotion and prediction contracts |
| `src/compat/`, `src/guest/` | Source APIs, byte layouts, guest execution and semantic bindings |
| `src/scene/`, `src/render/` | Collision representations, models, materials and CPU/GL output |
| `src/connection/` | Protocols, client prediction, transfers and demos |
| `src/app/`, platform and audio areas | Native menus, per-seat clients, devices, media and lifecycle |
| `tools/`, verification data | Mechanical generation, source comparisons and reproducible evidence |

The graph assigns exact file ownership. Interfaces hide domain policy instead of forwarding generic service calls.

## Execute the dependency graph in verifiable stages

This overview groups canonical packages; [work-packages.json](work-packages.json) retains the exact dependency edges.

| Work stream | Packages | Gate |
| --- | --- | --- |
| Source, policy and contracts | W01–W05 | Captured inputs, enforceable strictness and ownership contracts |
| Collision and prediction | W16, W24–W26 | Foreign solid-space and timed event-replay proofs |
| Permanent behaviors and real runtime | W74 feeds W42/W45/W49 and W73 in parallel | Shared behavior imports; actual CPU/GL single-player and co-op remain required |
| Official gameplay | W41–W51 | Shared authority, direct TS content, composition and progression |
| Guest execution, in parallel | W27–W39 | Bytecode/binary execution and memory contracts |
| Joined product | W66, then W40 | Official/source-VM integration, then required native guest registration |
| Complete acceptance | W67–W72 | Full manifest, performance, Linux artifacts, review and closure |

W50 composes official and QC/QVM behavior independently of native CPU completion. After W66, W40 takes the explicit `src/app/modules.ts` handoff for native semantic integration. Its failures block dependent configurations and release, while official work continues.

Follow the user's code-first sequence: import and join the engine, reach live human play, optimize, then complete broad hardening and regression infrastructure. W05 uses the reviewed source comparison and existing source census now; W01 continues exhaustive feature accounting in parallel. W02's initial source cases and actual Q2 references supply code inputs. Broad retail and performance capture belongs to later verification gates. W03 keeps the practical Bun build and strict type guards usable, and W04 supplies a basic runner. Ban `any`, casts including const assertions, non-null assertions and suppressed diagnostics. All 40 feature families and complete configuration accounting remain required for final acceptance. Existing SDL2, GL, Vorbis and FreeType FFI and embedded GLSL establish the platform boundary; gameplay and offline tools remain TypeScript.

Establish usable contracts for shared ownership, callback ordering, damage and transitions while importing code. Keep checks needed to implement those contracts; defer broader adversarial probes, regression infrastructure and performance campaigns until the engine supports live human play and optimization. Q1's mg1 all-sigil exit and mg3 rune thresholds must survive foreign players. Q2's observed losses of POI stage, fog density, brush animation and flechette capacity must survive actual fresh-process restoration. Each failed probe blocks only dependent work.

W74 adds permanent representative behaviors. W73 runs them through actual Bun CPU/GL gameplay: Q2 map, Q1 motion, Q3 character; and Q2 characters in a Q1 rerelease campaign. Prove input, firing, mission gates, fresh-process save restoration and transitions in single-player and co-op. W42, W45 and W49 import directly from W74 foundations; the other content packages inherit that dependency through their base family. W73 runs as a required integration milestone alongside bulk W42–W49 imports. Its bootstrap remains in the product; W66 later takes the explicit `src/main.ts` handoff for full integration.

Import ready content, formats, movement, modes, bots, navigation, media, menus, administration, downloads and guest modules in parallel. Every feature family must receive source expectations and live acceptance cases before final closure; building that full regression infrastructure does not precede the imports. Include per-seat audio, rumble and localization, Q2 guidance, Q3 progression, and missing inherited functionality. Existing failures do not become compatibility requirements.

After imports, live human play and optimization, complete deferred hardening, regression infrastructure, broad retail/reference capture and full runner accounting in W67–W71. Reconcile all declared configurations and mandatory behavioral suites against the exact raw and compiled Linux artifacts. Execute full campaigns and competitive matches, mixed local/remote sessions, renderer changes, reconnect, recovery and shutdown. The [verification plan](verification-plan.md) governs immutable snapshots, deterministic shards, independent oracles, retries and evidence retention.

## Coordinate work and close only demonstrated outcomes

The lead assigns independent Astra workers with exclusive paths. Current recovery dispatches use low or medium effort according to the task; earlier xhigh dispatches are historical. The lead starts source ports when concrete published inputs and exclusive paths are ready, even while prerequisite packages remain running. Graph edges govern review and acceptance order; they do not require source workers to wait for prerequisite acceptance. Failed or blocked prerequisites prevent dependent running work. Assign exclusive files and reserve slots before leaf delegation. Do not invent work to fill the cap. Reviewers join each lane; the lead owns integration and independent combined-artifact verification.

Make local progress commits after verified bounded packages and coherent integration checkpoints. The lead coordinates Git staging and commits using exact reviewed paths, or isolated worktrees. Serialize shared-index operations and preserve unrelated ongoing writes. Commit messages identify the change, verification and remaining gates. A progress commit records useful work without claiming release completion.

P0 records hardware, driver, resolution, Bun version and reference workloads, then proposes justified performance budgets. This plan invents no delivery estimates or user-approved FPS targets. Acceptance requires adopted budgets and measured frame-time distributions, memory, load cost and guest overhead in real gameplay.

The finite official configuration product receives stable case IDs and complete accounting. Pairwise samples, skipped fixtures, boot counts or compilation cannot close it. Unbounded play histories and future mods receive separate generated and invariant-based coverage, with the tested domain reported precisely. Required failures, missing inputs and unexecuted cases remain completion blockers.

Independent review selects shared-world execution subject to those prerequisite proofs. The complete-family-runtime alternative contributes owned-versus-observed actors, source-private checkpoints and attack provenance. Reject complete family loops, copied foreign records and global context swapping. Design approval is not runtime acceptance. The user authorized continued implementation toward the full engine until an explicit stop. Historical planning-only assessments retain their original meaning; they do not revoke the current authorization. Only the lead records package acceptance after reviewing the required evidence and combined state.
