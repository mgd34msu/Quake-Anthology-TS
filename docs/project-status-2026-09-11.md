**Full project status, 2026-09-11**

The engine is incomplete. The required result remains one engine, one executable and one entry point, with independently selectable maps, movement, characters, weapons, monsters, equipment, rules and supported guest programs. Real gameplay and shared-world integration exist, but the complete union is unfinished. The installed executable now includes verified engine and startup-menu work through `ca5003b`; this is a development checkpoint, not full release acceptance.

This report uses source checkpoint **5a1d7a6**, the [canonical work-package ledger](work-packages.json), [project plan](project-plan.md), [execution ledger](execution-status.md) and [dependency graph](dependency-graph.mmd). The graph contains **74 packages and 303 acceptance edges**. This read-only status refresh ran no application, audio or full test suite.

**What the numbers mean**

Formally accepted packages: **1/74**. The ledger declares **55 running and 18 planned**. Only W03 is accepted, for its early tooling scope. These are package-closure counts, not a percentage of code written. A row marked **0/1** means its complete acceptance requirements remain unfinished; it does not mean no implementation exists. Accepted subcriteria are not tracked well enough for feature-level fractions.

The feature ledger records **0/477 formally accepted feature rows**. The product manifest records **24/25 product rows observed**. These coarse inventory records lag implementation. Neither measures current code, campaigns or working combinations. In particular, W37 through W40 and W56 retain planned labels despite implemented services, adapters or codecs.

| Stage | Accepted / total packages | Running | Planned |
| --- | ---: | ---: | ---: |
| Foundation | 1/8 | 6 | 1 |
| Formats and assets | 0/7 | 7 | 0 |
| World collision | 0/1 | 1 | 0 |
| Rendering and media | 0/5 | 5 | 0 |
| Input, saves and interface | 0/6 | 4 | 2 |
| Movement | 0/3 | 3 | 0 |
| Guest execution | 0/14 | 9 | 5 |
| Gameplay and composition | 0/11 | 11 | 0 |
| Networking and recording | 0/5 | 4 | 1 |
| Bots and navigation | 0/2 | 2 | 0 |
| Independent verification | 0/3 | 0 | 3 |
| Application integration and performance | 0/5 | 3 | 2 |
| Release | 0/4 | 0 | 4 |
| **Overall** | **1/74** | **55** | **18** |

**Current engine boundary**

Committed progress includes `0652053` for two classic selected creatures, `e8cc40c` for common Q3 projectile execution, `4ee713a` for native Q3 hook/proximity impacts on actual foreign nonplayers, `b640bb4` for the initial Q1 view weapon and `5a1d7a6` for Q1 model skin edges. Q3 native and selected weapons now share actual firing and projectile code instead of separate bullet/projectile loops. Actual checks cover damage, reflection, source fuse timing, release generations, event retention, saves on Q1/Q2 worlds and source equipment interactions.

Subsequent checkpoint `674a0b0` commits the four-file hook/mine lifetime fix after lead source review and all eight independent actual-map probes. It prevents hooks and attached mines from transferring to replacement actors, preserves historical damage attribution and cleans up live victim/trigger state. This subsequent commit does not change the audit base of `5a1d7a6` or close a full work package.

Subsequent checkpoint `bc17271` commits guarded classic dog/berserk admission. Lead checks cover authored berserk placement/attack/save on Q1 and dog bite/leap/save on a fitting Q1 recipe. All-dog Q2 base1 replacement refuses obstructed bounds; it is not accepted interoperability. Checkpoints `ce41c91` and `71ea143` preserve Q2 stationary support and Q1 terminal-path pause deadlines. Actual untouched e1m2 patrol progression and save continuation pass; terminal pause uses a controlled actual callback, not an authored terminal-route claim.

Checkpoint `ed91729` runs selected Q1 weapons and native supply pickups on Q2/Q3 maps. Independent checks cover first shots, pickups, quad damage, native Q3 movement, Q2 live-grenade save/travel and grapple-slot resume. Checkpoint `550c7b0` shares map-owned silencer charges, shot/impact noise and selected-character attack presentation; six actual-map probes cover 31-shot exhaustion, saves, coop projectile impacts and Sarge animation. Checkpoints `b70af97` and `bf94ded` preserve map lighting colors, Q1 model surfaces, view-weapon depth and local lightning placement; the lead inspected frozen CPU captures on both maps. Checkpoint `d6c6131` adds display gamma after CPU/GL scene rendering. Frozen Q2 shotgun and Q3 lightning captures verify the exact shared lookup table against raw framebuffer pixels, unchanged alpha and a byte-identical neutral redraw; the actual GL driver was NVIDIA, not Mesa. Default-framebuffer versus FBO rasterization differences remain a fidelity limit. Native audio and complete visual fidelity remain unproved.

Checkpoint `8bf2485` separates Q2 weapon owners from native player entities and preserves actual-actor impact noise and lifetime checks. Checkpoint `f17a688` runs the reusable Q1 creature controller on shared map actors, with source startup, mission routes, contact goals, projectiles and backpack supplies. Independent frozen checks cover classic enforcer attacks on Q2, flying-projectile and death/drop saves, ammo-only backpack behavior, existing army/dog regressions and explicit obstructed-placement refusal. The combined source candidate passed 73 tests with 1,558 assertions and ten actual gameplay probes. Root inspected the enforcer CPU captures and native attack-frame geometry. This is bounded classic enforcer evidence, not full-roster, rerelease or campaign acceptance; native army/dog controller ownership is unchanged.

Checkpoint `064d1bf` admits selected base-Q2 weapons on Q1/Q3 maps through shared actors and actual classic/rerelease source cadence. Independent checks passed 13 actual gameplay probes, 55 source tests with 1,718 assertions, two adapter tests with 339 assertions and the corrected BFG visibility test. Evidence covers firing, pickups, saves/travel, source timing, quad changes during projectile flight and offhand quad behavior. Root inspected the production CPU Q1/Sarge/Q2-shotgun capture at gamma 1 and 1.3: native view-model frame 9, kick and flags 21 were present, with no unhandled effects. Checkpoint `3ccaeb0` preserves proximity-mine attacker credit for live native and foreign owners, with released-owner fallback; its source callback check passed 36 assertions. Expansion weapon admission, complete foreign target semantics and native visual/audio fidelity remain open.

Checkpoint `af35a0f` restores native Q1 barrel box collision, stationary movement and source drop behavior. Checkpoint `7cbab8d` reads actual target-owned solid and Q2 flags for rail/BFG, and dispatches dodge to the target's actual Q2 monster context. Independent actual-source checks cover the untouched e1m1 barrel at slot 322 taking scheduled BFG laser damage from 20 to 15 health, and admitted infantry switching from stand to its native duck move. The existing Q2 weapon suite passed 23 tests with 328 assertions. These checks do not establish complete foreign-target semantics; the exact `misc_explobox` BFG policy remains, with `misc_explobox2` adaptation deferred.

Checkpoints `8f91da4` and `6d7c253` add shared pickup-grant previews and remove unsupported Q1 crouching from bot navigation. Independent checks passed seven supply tests with 147 assertions and three posture tests with 94 assertions. Checkpoint `eb0d55f` runs the same Q3-derived bot core on Q1 standard deathmatch with selected base-Q2 weapon knowledge, preserving existing Q2/Q3 behavior. Frozen checks passed the Q1/Q2 application tests (2 tests/42 assertions), native Q3 application tests (2/15) and catalog tests (3/22). Actual probes cover respawn resetting rail decision 10 to starter shotgun 2, teleport retaining weapon preference, actor lifetime reuse, and unsupported bot arsenals leaving the game loaded. Q1 dm4→dm5 travel retains the exact admitted composition, module artifacts and asset precedence while resolving the new map. Native Q1 and foreign Q3 bot arsenal support, health/armor/powerup goals and remaining source-ID tactical comparisons are incomplete. These source commits are included in the installed `ca5003b` development executable.

Complete independent swappability remains the main missing capability. Selected base Q1/Q2/Q3 weapons and several source equipment mechanics work in bounded mixed configurations. Remaining expansion arsenals, the complete enemy roster, finer source cadence, map mission obligations, expansion supply mappings, VM-private overrides and mixed network state are unfinished. Full native Q3 saving and complete guest saving remain open. Rendering has inspected improvements, but lighting, sky and flash fidelity are not fully established; silent checks do not establish that audible chopping is fixed.

Checkpoint `d771286` adds source-owned weapon/ammo pickup goals to the shared bot controller, following observer `2aba7e5` and grant-preview helper `0625ca0`. Independent actual probes on the final frozen source cover Q1 dm4 with selected base-Q2 weapons and native Q2 base1: bots start in verified supported approach lanes, then ordinary movement/touch collects the untouched authored pickup, matches previewed inventory gains and observes source respawn. Q1 collected a rocket launcher plus five rockets and five grenades; Q2 collected a shotgun plus ten shells. Q2 checks also preserve a full-ammo refused pickup, value ammo for an empty owned weapon and retire a removed pickup identity. The library fixture covers generation reuse; physical same-slot reuse was not established by the map probe. Reachable trigger-volume targets and generated-edge progress fix the observed route failures without changing native AAS steering. Final strict/policy checks passed, with focused arena/source checks (6 tests/268 assertions). Health, armor and powerup goals, remaining native-Q1 weapons/foreign-Q3 bot arsenals and broader modes remain open. This source checkpoint is newer than the installed `ca5003b` executable; formal acceptance counts are unchanged.

Checkpoint `55e0b80`, following native preview `00b08bf` and weapon-intent routing `2c632a4`, admits native base-id1 Q1 deathmatch weapons through the same bot controller. The bounded Q1 rerelease dm4 fixture uses a Q2 character and source teleport into a verified supported 96-unit approach lane: ordinary bot movement collects the untouched authored rocket launcher with exact previewed ammo, observes respawn, switches from axe to a ranged weapon and deals actual damage, then retains its client through dm5 travel and removes the bot cleanly. Root independently passed the full shared-world fixture (3 tests/59 assertions); final isolated strict/policy checks passed. Existing native Q3 behavior remains supported. Grenade-launcher tactics, other Q1 programs, team modes and all-map coverage remain unqualified. These commits are newer than the installed `ca5003b` menu executable; formal acceptance counts are unchanged.

Checkpoint `24fe385` reads actual Q1/Q2 weapon owners independently of Q1/Q2 map ownership, using engine join `daee0a8` to preserve repeated selected-Q1 fire. The bounded new case uses Q2 rerelease base1, Q2 movement/character and selected classic Q1 weapons. From a supported source-teleport approach lane, ordinary bot movement collects the untouched Q2 shotgun pickup into the previewed Q1 inventory, observes source respawn, reads map-owned quad, then switches from axe to shotgun and consumes ammunition while dealing damage. Root independently passed all four shared-world cases (4 tests/77 assertions); final isolated strict/policy checks passed. At this checkpoint, Q3-map foreign arsenals, remaining weapon tactics, team modes and all-map coverage were unqualified. The installed executable remains `ca5003b`; formal acceptance counts are unchanged.

Checkpoint `f8447c6` admits selected base-Q2 weapon bots on baseq3 standard deathmatch maps through the same controller and actual arsenal observations. Detached movement prediction no longer executes native Q3 weapon callbacks for a foreign arsenal. The bounded actual Q3 fixture uses a supported approach lane and deliberately empties starter bullets to verify alternate-weapon choice, then checks mapped shotgun pickup, damage provenance and native medkit use to 125 health. Root independently passed the frozen shared-world and arena tests (6 tests/311 assertions); full isolated strict/policy checks passed. Broader modes and other foreign arsenals remain unqualified. The installed executable remains `ca5003b`; formal acceptance counts are unchanged.

Checkpoint `ebc68d0` preserves map-owned combat feedback and bot powerup observations with foreign weapons. Actual Q3-map selected-Q2 shotgun damage updates native hit count and attacker feedback; Q1/Q2 quad and environmental protection are read from the map owner after arsenal inventory refresh. Expiry checks query source-clock boundaries; they do not prove timer execution. Root independently passed the frozen affected shared-world cases and native Q3 arena (4 tests/301 assertions, two unchanged cases intentionally filtered), plus source/authority checks (14 tests/146 assertions). Full isolated strict/policy checks passed. Health/armor/powerup pickup goals, broader modes and complete source feedback remain open; the installed executable and formal acceptance counts are unchanged.

The executable at `~/Projects/qfiles/quake-typescript` is updated through `ca5003b`. Running it without arguments opens the mouse-driven main menu. Supported configuration resolves an exact recipe on Play; actual save browsing/loading, shared options, display Apply and runtime-failure return passed independent frozen probes, with CPU/GL captures inspected. The [installed build record](execution-status.md#installed-build) records hashes, full build gates and installed help/no-argument smoke. Full campaigns, arbitrary pickup replacement, Q3 saves, server/lobby/bot administration and audio/rendering fidelity remain incomplete. Astra workers continue under lead coordination with one Git writer; formal acceptance counts remain unchanged.

**Every work package**

Titles and declared states below come directly from the canonical ledger. Evidence descriptions distinguish implemented paths and recorded bounded checks from still-required full acceptance. Dependencies govern acceptance order; they do not imply that work must sit idle while other packages are running.

**Foundation**

| ID and planned work | Declared state; accepted / total | Exists and bounded evidence | Still required |
| --- | --- | --- | --- |
| W01 Inventory required features, content, and common code lineage | running; 0/1 | Donor census, source lineage and a ledger of 477 features across 40 source families and 25 unified feature families exist. | Finish exhaustive function mapping, reconcile omissions and prove the complete requested union. |
| W02 Capture authoritative behavior and performance baselines | running; 0/1 | Source-derived reference cases and actual Q2 native screenshots and executions are retained. | Complete matched gameplay, rendering and named-machine performance baselines. Broad capture remains deferred under the code-first sequence. |
| W03 Establish strict TypeScript policy and one Bun build entry | accepted; 1/1 | The early strict TypeScript policy, Bun tooling and single build-entry setup are formally accepted. | This acceptance covers tooling only. It does not qualify the current executable, gameplay or release. |
| W04 Build verification interfaces and evidence accounting | running; 0/1 | Typed verification requests, results, manifests and a basic runner exist. | Finish broad regression coverage and evidence reconciliation after implementation and live play; a working runner does not establish coverage. |
| W05 Freeze shared contracts and explicit game differences | running; 0/1 | Shared typed recipes, actor/body ownership, clocks, recipe format 3 and save format 2 are in production. | Complete independent selection across every axis, guest-private behavior bindings and remaining mission obligations. |
| W06 Reuse and qualify Linux SDL2 and native library bindings | running; 0/1 | SDL2 through Bun FFI supports real CPU/GL execution, input, controllers and audio; earlier native runs exist. | Qualify the exact latest source on devices, restarts and multiple seats. Earlier platform runs do not qualify every new change. |
| W07 Close missing required content and Quake 64 manifests | planned; 0/1 | The content manifest records 24 of 25 product rows observed, including Q2 rerelease Nintendo 64 content. | Resolve Q1 rerelease Quake 64 inputs. The required MD4-v1 header fixture is also missing; observed products are not completed campaigns. |
| W08 Consolidate common engine services and session lifetimes | running; 0/1 | Common core, session and scheduler services drive the actual shared actor traversal. | Finish source-policy convergence and lifecycle coverage. Continuing lifetime fixes show why this package remains open. |

**Formats and assets**

| ID and planned work | Declared state; accepted / total | Exists and bounded evidence | Still required |
| --- | --- | --- | --- |
| W09 Load archives and resolve independent content profiles | running; 0/1 | PAK, PK3, ZIP, KPF and loose-file loading, mounts and independent content catalog resolution exist. | Qualify complete mod, pure-package, overlay and conflict behavior across every required composition. |
| W10 Read Quake 1 maps and extended collision data | running; 0/1 | BSP29, BSP2, 2PSB and BSPX readers support actual Q1 map use. | Finish independent collision/render fidelity and coverage of every required extension and variant. |
| W11 Read Quake 2 classic and rerelease maps | running; 0/1 | IBSP38 and QBSP readers support actual classic and rerelease Q2 maps. | Complete independent checks of all variants, geometry, lighting and extended data under their source profiles. |
| W12 Read Quake 3 maps and patch surfaces | running; 0/1 | BSP46 geometry, patches, fog and light-grid data run on real Q3 maps. | Finish every required patch/collision/material variant and independent source fidelity checks. |
| W13 Read Quake 1 and Quake 2 models and sprites | running; 0/1 | MDL, SPR, MD2 and SP2 readers render real Q1/Q2 models and sprites. | Complete variant, animation, bounds, palette and source-presentation coverage beyond inspected examples. |
| W14 Read Quake 3 and skeletal model formats | running; 0/1 | MD3, MD4 and MD5 structures, tags and skeletal handling exist. Actual Sarge and a selected Q3 held weapon render. | Complete fixtures and pose/attachment coverage for every format; general foreign held-weapon binding remains incomplete. |
| W15 Consolidate images, palettes, lighting, and material scripts | running; 0/1 | Palette/image decoding, materials and lightstyles exist. SKY/NODRAW precedence and Q1 skin flood-fill fixes are committed. | Complete lighting, blending, sky, texture sampling and flash fidelity. Matching model/shader inputs alone does not establish matching pixels. |

**World collision**

| ID and planned work | Declared state; accepted / total | Exists and bounded evidence | Still required |
| --- | --- | --- | --- |
| W16 Prove shared collision and Q1 solid-space construction | running; 0/1 | Shared collision handles actual foreign boxes, contents, brushes, movers, ground and attached bodies in focused checks. | Qualify arbitrary bounds, thin geometry, rotation and performance. Current selected-dog checks find six obstructed placements among 17 authored candidates. |

**Rendering and media**

| ID and planned work | Declared state; accepted / total | Exists and bounded evidence | Still required |
| --- | --- | --- | --- |
| W17 Consolidate scene preparation and render commands | running; 0/1 | ApplicationWorldScene now prepares the same production world/models/equipment/effects for the application and CPU offscreen inspection. | Finish all source effects, model combinations and per-seat presentation. The inspected complete scenes still have fidelity limits. |
| W18 Implement the complete CPU rasterizer | running; 0/1 | The TypeScript CPU rasterizer renders actual complete scenes and provides current inspected captures. | Finish source fidelity, supported variants and exact-build performance qualification; a rendered screenshot is not complete renderer acceptance. |
| W19 Implement the complete OpenGL renderer | running; 0/1 | The OpenGL renderer has earlier actual application execution evidence. | Qualify the latest combined source, all effects and CPU/GL agreement. Recent visual corrections have current CPU evidence only. |
| W20 Consolidate audio decoding, mixing, and spatial playback | running; 0/1 | Decoding, mixing, spatial sound, streams, reverb and queue management exist. Checkpoint 423101a changes queuing and frame cost. | Audible chopping is not declared fixed by silent checks. Complete device/playback fidelity and load qualification; LMCTF has no soundtrack of its own. |
| W21 Preserve cinematics, typography, localization, and captions | running; 0/1 | CIN, RoQ, still images, fonts, FreeType, kfont, localization and captions have implementations. | OGV/Theora decoding is not implemented and is explicitly rejected. Complete media, subtitle and localization workflows remain open. |

**Input, saves and interface**

| ID and planned work | Declared state; accepted / total | Exists and bounded evidence | Still required |
| --- | --- | --- | --- |
| W22 Consolidate per-seat input, controls, console, and capture | running; 0/1 | Per-seat keyboard, mouse, gamepad, rumble, console and capture paths exist. | Complete gyro, hotplug, private/local/remote control behavior and every actual UI/input connection. |
| W23 Save complete shared worlds and original profile state | running; 0/1 | Actual Q1/Q2 binary saves preserve tested callbacks, RNG, inventory, equipment, selected monsters/projectiles and travel state. | Native Q3 full-world saves are unsupported. Guest full-map saving failed its instruction budget; all original import/export profiles remain unqualified. |
| W59 Build the common SDL menu, HUD, and settings system | running; 0/1 | Native SDL controls/settings, per-seat HUD/messages/POIs, weapon-wheel logic and legacy interfaces exist; native UI fixtures and earlier captures are recorded. | Complete inherited settings, accessibility/localization and connected HUD/control workflows. Shared startup/pause menus now have inspected CPU/GL captures; full interface coverage remains open. |
| W60 Build complete content, campaign, composition, and save menus | planned; 0/1 | The installed main menu configures supported independent selections and browses actual saves; exact-recipe Play/load and failure return have live evidence. | Complete campaign/composition coverage, arbitrary pickup replacement and Q3 full saves remain unavailable; the recorded package state is not updated by this bounded checkpoint. |
| W61 Build server, lobby, local-seat, bot, and administration menus | planned; 0/1 | Networking, bots, seats and administration have underlying source services and bounded application joins. | Complete server browser, lobby, seat, bot and administration menus remain incomplete; service code is not a finished workflow. |
| W62 Generate and review reusable native-menu raster art | running; 0/1 | Four ImageGen assets, including the new main-menu background, have PNGs and repository provenance; actual CPU/GL menu captures were inspected. | Complete native composition, icons, readability and accessibility review. Four assets do not finish the interface. |

**Movement**

| ID and planned work | Declared state; accepted / total | Exists and bounded evidence | Still required |
| --- | --- | --- | --- |
| W24 Extract Quake 1 movement and source timing profiles | running; 0/1 | Q1 movement and timing profiles execute with mixed map, character and weapon selections. | Complete source-profile prediction, contacts, water/mover behavior and every required mixed interaction. |
| W25 Extract Quake 2 movement with matching prediction | running; 0/1 | Q2 movement and prediction code runs in actual mixed sessions, including classic/rerelease equipment checks. | Finish independent prediction agreement, Q64 differences and complete timing/contact/profile coverage. |
| W26 Separate Quake 3 movement from weapon and animation choices | running; 0/1 | Q3 movement works independently of selected appearance and tested weapons; real hooks pull through native Q3 commands. | Finish every source prediction/contact behavior and complete independence from remaining source-client assumptions. |

**Guest execution**

| ID and planned work | Declared state; accepted / total | Exists and bounded evidence | Still required |
| --- | --- | --- | --- |
| W27 Host QuakeC with private authoritative guest memory | running; 0/1 | The QC interpreter, programs, private memory, executor, profiles, builtins and hosts exist. | Qualify all required progs/mod dialects and reviewed private-behavior overrides. Running a VM does not prove arbitrary semantic replacement. |
| W28 Resolve the TypeScript QuakeC compiler and union-source lane | planned; 0/1 | Official built-in gameplay uses direct TypeScript source extraction. The compiler evaluation remains a separate declared task. | Resolve whether QC compiler or union-source tooling is needed. Direct TypeScript official extraction is chosen; an unnecessary compiler is not mandatory. |
| W29 Host all Quake 3 QVM roles and legacy scripted interfaces | running; 0/1 | QVM game, cgame and UI execution, syscalls, raw records and legacy scripted interfaces exist. | Complete arbitrary-mod role coverage, prediction, restart and reviewed private-state override qualification. |
| W30 Define TypeScript guest memory and CPU execution contracts | running; 0/1 | Checked 32/64-bit guest memory, CPU state, callback identities and raw checkpoint machinery exist; core/ABI fixtures cover nested execution. | Finish production guest-private semantic binding and complete actor/composition acceptance beyond low-level fixtures. |
| W31 Load PE32 and PE32+ modules in TypeScript | running; 0/1 | PE32/PE32+ sections, relocations, imports, exports and TLS loading exist, with actual installed classic/rerelease DLL fixtures. | Complete independent format references, every reached initialization path and required unwind behavior; parsed exports alone are insufficient. |
| W32 Load ELF32 and ELF64 modules in TypeScript | running; 0/1 | ELF32/ELF64 parsing, relocation, TLS and unwind metadata support Quake Live fixtures. | Complete required dependencies and real native module execution qualification; ELF loading is not complete gameplay. |
| W33 Execute i386 integer and control-flow instructions | running; 0/1 | The i386 decoder/interpreter executes real CPU/ABI fixtures and bounded classic DLL paths. | Finish required reached instruction, fault, semantic and performance coverage across native modules. |
| W34 Execute x86-64 integer and control-flow instructions | running; 0/1 | The x86-64 interpreter preserves exact-width state and executes the rerelease DLL through bounded gameplay callbacks. | Finish complete required module execution and independent instruction/performance qualification. |
| W35 Execute x87 and SSE floating-point behavior | running; 0/1 | x87/SSE execution and a real LMCTF extended-precision VectorLength fixture exist. | Complete independent game-math and exception/rounding coverage. JavaScript arithmetic cannot substitute for unverified source floating-point semantics. |
| W36 Implement Windows and System V guest calls and callbacks | running; 0/1 | A same-CPU ABI runner covers Windows/System V families, nested callbacks, variadics, aggregate bytes and saved callback rebinding. | Required exception paths and remaining layouts are open; nontrivial C++ passing, vectorcall, AVX and long-double arguments are not inferred. |
| W37 Implement reached guest OS, CRT, and C++ runtime services | planned; 0/1 | Windows/System V services, TLS, stdio, locales and MSVC streams already run bounded actual DLL initialization despite the planned label. | Complete C++ unwind/exceptions, contended waits and missing import modes. Update the coarse ledger without treating reached services as universal compatibility. |
| W38 Host Q2 native API 3 and rerelease game/cgame records | planned; 0/1 | Classic and rerelease Q2 native layouts/hosts exist. Recorded retail execution reaches 502 edicts and 36 assertions through active RunFrame. | Complete callback, semantic override, prediction, save and gameplay qualification. The planned label understates implementation, not the remaining acceptance work. |
| W39 Host Q3 native qagame, cgame, and UI interfaces | planned; 0/1 | Native Quake Live API-10 table and Q3 i386 dllEntry/vmMain interfaces exist. | Qualify all required qagame/cgame/UI roles, restarts and native composition; Quake Live fixture support is not product completion. |
| W40 Integrate native semantic bindings and prove real guest gameplay | planned; 0/1 | Bounded real native DLL map/client/frame execution exists. This is more than loader-only progress. | Full-map JSON saving exceeded 20 million instructions. Complete firing/damage, saves, multiplayer, private semantics and source-cadence performance remain required. |

**Gameplay and composition**

| ID and planned work | Declared state; accepted / total | Exists and bounded evidence | Still required |
| --- | --- | --- | --- |
| W41 Prove single actor, combat, and callback authority | running; 0/1 | One registry, body, inventory, combat and callback authority has actual mixed damage, reentry, mover, trigger and historical-projectile proofs. | Finish the complete guest-alias and source-policy union, including every required worked ownership example and dependent provider acceptance. |
| W42 Extract Quake 1 base gameplay into typed behavior providers | running; 0/1 | Real id1 player, arsenal, monster, mover, trigger and travel providers exist; e1m1/e1m2 and selected-Q3 supply/save checks pass. | Finish every original/rerelease base mechanic, campaign and independently selected foreign interaction. |
| W43 Extract Quake 1 mission-pack behaviors | running; 0/1 | Hipnotic/Rogue weapons, ammo, backpacks, monsters and campaign entities exist; source fixtures cover lasers, empathy, powered ammo and grapple behavior. | Complete both campaigns, every edition difference and foreign-map/arsenal interaction acceptance. |
| W44 Extract Quake 1 rerelease additions, CTF, and horde | running; 0/1 | Q1 addon campaign gates, destructibles, monsters, CTF and horde exist; fixtures cover distinct MG1/MG3 runes and authored hub/horde spawning. | Complete all selected programs, Q64 requirements, modes, achievement/lobby workflows and authored conditions. |
| W45 Extract Quake 2 base gameplay and source behavior | running; 0/1 | Q2 EntityServices, base player/weapons/items/entities/monsters and composition run actual base1/base2, save/travel and foreign-callback cases. | Complete the original campaign/mode union, full monster admission and arbitrary foreign interactions while preserving classic cadence. |
| W46 Extract Quake 2 Xatrix and Rogue expansions | running; 0/1 | Xatrix/Rogue weapons, items, monsters, projectiles, spheres, entities and Tag source modules exist. | Complete expansion campaigns, source-differential mechanics, Tag behavior and independently selected foreign combinations. |
| W47 Extract Quake 2 CTF and LMCTF behaviors | running; 0/1 | CTF/LMCTF flags, rules, scoring, equipment and match administration exist; pause, settings/travel and actual grapple/slot/save/contact-pulse checks are recorded. | Finish independent-client objective, death/team-change, administration, HUD/voting workflows and objective placement on every required foreign map. |
| W48 Extract the complete Quake 2 rerelease feature set | running; 0/1 | Rerelease base/expansion/Machine/Q64 code exists; fixtures cover timing, saved callbacks, healthbars, notifications, fog and Q64 scenery/cameras. | Complete every campaign, mode, balance option, bot/cgame capability and rerelease-only state roundtrip. |
| W49 Extract Quake 3 and Team Arena gameplay providers | running; 0/1 | Q3/Team Arena source providers now share native/selected hitscan and projectile execution. Actual reflection, damage, rail unlink and foreign special-impact checks pass. | Complete all mode/progression/admin behavior, selected Team Arena admission, native Q3 saves and remaining whole-game assumptions. |
| W50 Compose official gameplay and source-VM semantics | running; 0/1 | Recipes compose tested movement, appearance, Q3 arsenal, source gear and classic selected creatures over the same world. | Arbitrary every-axis selection remains incomplete: other arsenals, full enemy roster/cadence, mission obligations, expansion supply and VM-private overrides are open. |
| W51 Preserve campaign, round, achievement, and lobby state | running; 0/1 | Source campaign/round modules and application Q1/Q2 saves/travel preserve tested inventory, callbacks and equipment selection. | Prove every ending, hub, boss, coop/retry path, Q3 tier/medal history and durable achievements/lobby workflow. One map transition is insufficient. |

**Networking and recording**

| ID and planned work | Declared state; accepted / total | Exists and bounded evidence | Still required |
| --- | --- | --- | --- |
| W52 Consolidate transport, sessions, discovery, and service workflows | running; 0/1 | Shared transport/session identities, composition offers, discovery, downloads, administration and online-service contracts exist; actual UDP joins are recorded. | Complete mixed-state transport, local/remote seats, independent peers and inherited IPX/auth/ranking/lobby obligations. |
| W53 Preserve NetQuake and QuakeWorld wire behavior | running; 0/1 | NQ/QW codecs, channels and demos exist; actual NetQuake protocol-15 application checks cover shared actors, effects and travel. | Qualify all NQ15/666/999 and QW28/29 peers, timing, hosting, spectators, downloads and rerelease compatibility. |
| W54 Preserve Quake 2 classic, wide, and rerelease protocols | running; 0/1 | Classic, expanded and rerelease Q2 codecs cover separate wire layouts; fixtures exercise seven profiles, fragmentation, KEX seats and negotiation. | Complete independent-client campaigns/matches, reconnect/downloads and all logic/API/wire/timing combinations. Codec tests do not establish full sessions. |
| W55 Preserve Quake 3 and Team Arena protocols | running; 0/1 | Q3 protocol-68 messages, channels, snapshots, prediction, pure checks and downloads exist; actual UDP admission/movement is recorded. | Complete independent peer/mode/restart qualification and explicit mixed-state/multi-seat transport. Stock packets cannot represent arbitrary foreign actors. |
| W56 Preserve demos, MVD, replay, and spectator controls | planned; 0/1 | Family demo codecs and Q2 MVD/KEX demo readers exist despite the planned label. | Complete real recording/playback, timedemo, attract, seek/spectator controls and all-seat state equivalence; no complete unified recording workflow is accepted. |

**Bots and navigation**

| ID and planned work | Declared state; accepted / total | Exists and bounded evidence | Still required |
| --- | --- | --- | --- |
| W57 Consolidate bot behavior, combat, and team orders | running; 0/1 | The Q3-derived bot core, population, combat, goals and orders run bounded Q2 standard deathmatch through ordinary player commands. | Finish wider content/mode admission, useful rerelease knowledge integration, leadership and objective/team-order behavior in the common core. |
| W58 Construct navigation for every required map format | running; 0/1 | NAV2/AAS readers and TypeScript graph construction, reachability and runtime queries exist, with retail/application route fixtures. | Qualify every map/movement/bounds combination, water, ladders, teleports, movers, blocked routes and objective modes. |

**Independent verification**

| ID and planned work | Declared state; accepted / total | Exists and bounded evidence | Still required |
| --- | --- | --- | --- |
| W63 Build independent format, media, render, and runtime-tool cases | planned; 0/1 | Focused format/media/render tests and actual captures exist as development evidence. | Build and execute the full independent format, media, rendering and runtime-tool verification set after code integration. |
| W64 Build independent gameplay, campaign, seat, and UI cases | planned; 0/1 | Focused gameplay, campaign, seat and UI fixtures exist, including real-map checks. | Complete the independent campaign, gameplay, seat and UI acceptance program; existing narrow checks do not cover its denominator. |
| W65 Build independent guest, protocol, and service cases | planned; 0/1 | Guest instruction/ABI tests and protocol peer fixtures exist. | Complete independent guest, wire and service qualification across the required products and executable profiles. |

**Application integration and performance**

| ID and planned work | Declared state; accepted / total | Exists and bounded evidence | Still required |
| --- | --- | --- | --- |
| W66 Integrate one source simulation and complete native SDL client | running; 0/1 | One src/main.ts entry, application bootstrap, shared simulation, dedicated execution and seat infrastructure run actual source content. | Integrate the full official/source-VM union and complete client workflows. A single entry point alone is not full engine completion. |
| W67 Execute every declared configuration and required behavior suite | planned; 0/1 | The expected configuration dimensions and acceptance dependencies are declared. | Execute the complete required configuration and behavior matrix. No valid completed/total configuration result is available yet. |
| W68 Measure and implement useful threading and performance work | planned; 0/1 | Targeted frame-cost and audio-queue fixes exist. | Measure the full named-machine workload, implement useful threading/optimization and prove source-cadence performance under actual gameplay. |
| W73 Prove the first actual mixed-game executable alongside bulk imports | running; 0/1 | Earlier mixed-game CPU/GL play, local seats, firing and travel were demonstrated. | The complete specimen mission, fresh-process and coop criteria remain unaccepted. The user's broken runtime experience prevents a broad playable claim. |
| W74 Extract permanent behaviors for the two early playable specimens | running; 0/1 | Permanent Q1/Q2/Q3 behavior foundations are used by the production engine and later extracted providers. | Finish both early specimens and complete source behavior coverage; foundations existing in production do not close all dependent gameplay. |

**Release**

| ID and planned work | Declared state; accepted / total | Exists and bounded evidence | Still required |
| --- | --- | --- | --- |
| W69 Qualify exact source and compiled Linux gameplay | planned; 0/1 | Earlier source and compiled CPU/GL gameplay runs provide bounded development evidence. | Qualify the exact current source and Linux artifact across required gameplay and profiles; earlier binaries cannot qualify new changes. |
| W70 Package the Linux executable and complete player/operator docs | planned; 0/1 | The verified `ca5003b` development executable is installed in qfiles with build provenance, corrected menu launch notes and passing help/no-argument menu smoke checks. | Complete release qualification and player/operator guides; the installed development checkpoint is not full release acceptance. |
| W71 Independently review the combined implementation and evidence | planned; 0/1 | The lead performs independent bounded source/probe reviews before checkpoint commits. | Complete the combined implementation and release-evidence audit after integration; checkpoint review is not final release review. |
| W72 Reconcile all required work and close the release | planned; 0/1 | The release gates and dependency graph are defined. | Reconcile all required work and evidence, resolve blockers and close the release. Release completion is 0/1. |

**Supporting source and evidence**

Current joins are visible in the [shared runtime](../src/app/bootstrap/simulation/runtime.ts), [actor execution](../src/app/bootstrap/simulation/actor-execution.ts), [Q3 projectile core](../src/content/q3/base/game/projectile.ts) and [production scene preparation](../src/app/bootstrap/presentation-scene.ts). Guest limitations are documented in the [ABI](../src/guest/abi/README.md), [Windows runtime](../src/guest/runtime/windows/README.md) and [System V runtime](../src/guest/runtime/system-v/README.md) notes. Read their older intermediate stops alongside newer execution-ledger progress.

Relevant fixtures include [native rerelease](../tests/compat/q2/rerelease/native.test.ts), [Q3 integration](../tests/gameplay/q3/integration.test.ts), [NetQuake UDP](../tests/network/q1/application.test.ts), [Q3 UDP](../tests/network/q3/application.test.ts) and [native UI](../tests/ui/common/native-ui.test.ts). Fixture existence does not imply every profile was rerun. [Media presentation](../src/media/presentation.ts) and [playback](../src/media/playback.ts) explicitly reject OGV/Theora.

Campaign code lives in source/app modules, and demo/MVD code under family networking. Those paths do not remove the unfinished W51/W56 workflow obligations.
