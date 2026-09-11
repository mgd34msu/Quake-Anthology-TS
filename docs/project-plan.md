# Unified Quake TypeScript engine project plan

This plan builds one Bun engine for Quake 1, Quake 2 and Quake 3, including their classic and rerelease editions, all expansions, all game content and all functionality. Completion includes full campaigns, multiplayer, bots, local splitscreen, saves, demos, media, input, menus, server operation and mods. Maps, movement, characters, weapons, entities and rules can mix across games, including different selections for actors in one session. Implementation is authorized. The latest committed implementation checkpoint is `5278a70bb5579bc8dfd28a05d1693b2acf4db0e3`, following the shared application, combat/save, and interpreted native guest checkpoints. The engine is now in official-content completion and full-application integration, feeding W50 and W66. W03 remains the only formally accepted package, for its early tooling scope. The [execution ledger](execution-status.md) separates current evidence from historical dispatches.

The lead verified the successor's compiled executable on CPU with rerelease Rogue `rboss`, Q1 movement and the Q3 Sarge character, and on GL with CTF `q2ctf1`, two local seats, Q3 movement and a Q1 character. Bounded checks cover production bot movement, firing, restart and travel, plus Q1/Q2 saves and CTF/LMCTF restoration. These observations apply to the recorded checkpoint. They do not accept full packages, campaigns, source parity or every configuration.

Current joins include Machine navigation, remaining LMCTF match and administration workflows, and native guest callbacks. Generic Q2 dynamic-light shadow metadata/rendering remains missing. A standalone arena bot check still records zero shots despite firing in the real application. Complete CPU/GL content coverage, multiplayer interoperability and all declared configurations remain open. Follow the user's code-first sequence: finish imports and live gameplay, optimize, then complete broad hardening and release evidence at W67–W71.

The [source assessment](source-assessment.md) pins checkout paths, commits, original references, data and defects. The [feature ledger](feature-coverage.md) preserves 25 rows and all 40 inventory families for expansion into an exhaustive registry. The [machine work graph](work-packages.json) owns IDs and dependencies; its [diagram](dependency-graph.mmd) presents them. The [verification plan](verification-plan.md) defines evidence. Run [plan validation](validate-plan.ts) with `bun docs/validate-plan.ts`. Run [validator tests](test-plan-validator.ts) with `bun docs/test-plan-validator.ts`.

Q1 Nintendo 64 fixture coverage remains unresolved. Extra Quake Live assets do not expand the requested product scope.

## Build one simulation from the strongest subsystem implementations

One shared TypeScript world executes official actors, weapons, movement and missions. Concurrent complete family loops would create competing authority over time, contacts, lifetime and transitions.

Shared id Tech ancestry offers common command buffering, cvars, filesystems, messages, math, entity allocation/linking, resource lifetimes, animation and renderer submission. Consolidate after comparing registration order, path precedence, errors, bit encoding, rounding, link timing and invalidation. Retain differing policies. Q2's command and cvar headers already record changed iteration order; familiar names alone do not establish equivalence.

Choose per subsystem. Original source and retail observations define fidelity; TypeScript outputs are not golden oracles.

| Subsystem | Starting material and required improvement |
| --- | --- |
| Ownership and strict tooling | Q3's instance-owned world, resource lifecycle and compiler-API policy checker. Extend contracts beyond its product assumptions. |
| QuakeC and Q1 content | Q1's VM profiles, archives, release formats and campaign knowledge. Port built-in behavior to strict TS and replace lossy entity mappings. |
| Game bindings and content selection | Q2's peer APIs, campaign catalog and asset precedence. Separate API, timing and wire identities throughout. |
| Rendering | Q3's shared CPU and GL backend contract, with Q1 and Q2 palette, model, effect and rerelease improvements. |
| Bots and navigation | Compare Q1 and Q2's shared brain and retail navigation with Q3's personalities, AAS and team coordination. Preserve each required behavior. |
| Seats, input and sound | Q1 and Q2 controller assignment, haptics and seats; Q2 environmental audio; Q3 ownership and mixing where stronger. |
| Media and interface | Retain Q1 typography/localization, Q2 guidance and weapon wheel, Q3 scripted UI, and CIN, OGV and RoQ codecs. |
| Verification | Q3's immutable snapshots and artifact evidence, plus useful scenarios from every port after expectation review. |

Built-in Q1 actors, weapons and missions receive audited TypeScript ports from original QuakeC. Mechanical generators can produce constants, layouts and registries. A general semantic transpiler adds control-flow and aliasing obligations without removing crossover adaptation, so it is not a prerequisite. QC and QVM execution remain required for external gamecode and independent comparison.

## Resolve choices before constructing the executable session

Keep three objects separate. A launch choice describes what the player selected. An executable recipe contains resolved content, providers, numeric policies and dependencies. View options control rendering and local presentation. Changing resolution or the renderer does not change simulation identity.

Namespaced IDs identify game, edition, package and revision. Asset IDs include archive hash, member path and mount precedence. Equal filenames, classnames or numeric slots can name different content.

Q2's [mount rules](/home/buzzkill/Projects/quake-2-re-ts/src/client/menu_content.ts:800) provide the default. Selected rerelease rules receive their assets while selected classic geometry can retain map precedence. Explicit presentation overrides remain separate. Q1's [behavior switch](/home/buzzkill/Projects/quake-1-re-ts/ARCHITECTURE.md:141) changes engine behavior without replacing the campaign's gamecode. Preserve that distinction in named presets.

A Q2 map with Q1 movement and a Q3 character retains the map's entity and mission graph. The movement provider owns locomotion and prediction. The character supplies body, viewpoint, animation and voice. A cosmetic override changes appearance separately. Chosen weapons own their actions and ammunition. Explicit rules determine combat, teams and scoring; movement, skin and protocol do not select them implicitly.

Q2 characters can also complete a Q1 rerelease campaign. Its sigils, targets, puzzles, monsters and transitions retain their required behavior. Each player can choose different movement and weapons. Objective modes on foreign maps require real spawn and objective placement, supplied by reviewed adapters or generated data. Missing adaptations remain work to finish.

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
