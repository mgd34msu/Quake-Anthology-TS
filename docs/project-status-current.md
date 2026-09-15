# Historical project status at 98074c6e

This full report preserves the 2026-09-13 source snapshot at `98074c6e`, including its historical counts and installation claims. See [installed executable and recent fixes](execution-status.md#installed-executable-and-recent-fixes) for the newer verified installation and bounded checks. No new full requirement audit is claimed.

Usability is the highest product priority across client menus and console commands. Completion requires sensible defaults for selected content, visible values, direct mouse/keyboard editing, familiar commands, clear feedback, persistent settings and an actual menu/runtime check. Committed source now includes native game/edition presets, a shared binding table and console binding/configuration corrections; these updates are installed. Startup binding access, selected-content defaults, visible slider values and archived settings now have accepted source/runtime evidence. Original `default.cfg`/`autoexec.cfg` startup execution remains open. See the [current priorities](implementation-priorities.md#highest-product-priority-usable-controls-and-console).

Current installed source is `b78ec91`. The [console source comparison](console-source-parity.md) separates shipped behavior, implemented candidates and remaining source contracts across Q1/QW, Q2 and Q3/Team Arena. Expanded grants, source cvars, Q2 localization, console byte-mode corrections and general/selected-character precaching are now accepted and installed. Dynamic mod commands, remaining cvar families, timing, flight and startup configuration execution retain their stated gaps. The short compiled movement/input check does not qualify full parity, audible output or sustained performance. The comparison does not re-audit the historical feature totals below. See [execution status](execution-status.md#installed-executable-and-recent-fixes) for the exact executable receipt and bounded runtime scope.

**ENGINE NOT COMPLETE.** One Bun application and shared actor, body, collision, combat, inventory, session, rendering, and device ownership are implemented. The complete Q1/Q2/Q3 feature union, every required content combination, every native compatibility profile, and full campaign and presentation fidelity are not achieved.

This report is a source snapshot at `98074c6e7bfc690e10981923393a523474a11823`, prepared on 2026-09-13. The clock was checked at 15:21:51 UTC. It combines the earlier per-game feature deep dives, the later declaration/signature comparisons against all three donors, the three feature inventories, the retained requirement verdicts, and subsequent accepted source work. It does not claim that all requirements or source functions were re-audited today.

## What the numbers cover

The [requirement ledger](completion-status.json) contains **477 unique IDs: 288 Done and 189 Open**. Its source cutoff is `7964fc31bfa186e538994eea3ed71cb6b8d035f6`; carried verdicts originate at `39ea4c0cab9910c6b78d5f8d18d3bc36494dd519`. Later accepted changes below do not automatically close requirements. The rows vary greatly in scope, so these counts are not an overall engine completion percentage.

| Family | Done | Open | Total | Integrated | Shared replacement | Extended common |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Q1 | 123 | 57 | 180 | 102 | 16 | 5 |
| Q2 | 114 | 79 | 193 | 62 | 31 | 21 |
| Q3 | 51 | 53 | 104 | 39 | 7 | 5 |
| Total | 288 | 189 | 477 | 203 | 54 | 31 |

The last three columns describe the basis of Done verdicts. Integrated means the requirement is implemented through the engine's selected source path. Shared replacement means common behavior fulfills the requirement instead of retaining a separate donor implementation. Extended common means shared services were extended to provide the required capability. These classifications do not rank one donor as universally better.

The counts and category tables were recomputed from actual JSON rows, with duplicate-ID detection and family-total checks. All 477 IDs and 94 category groups reconcile. The [full checklist](completion-status.md) contains every requirement, verdict, reason, and source link. This report does not duplicate all 477 rows.

**The 477 requirements are not an exhaustive inventory of the intended engine.** The later source comparison exposed additional capabilities without explicit feature IDs, including VCR replay, GIF presentation, world text, extended cvar commands, SOCKS configuration, event/config journals, and external MOTD. They remain part of the project scope even when they have no separate denominator entry.

## Evidence from both comparison passes

| Family | Feature deep dive and original inventory | Later source declaration/signature comparison |
| --- | --- | --- |
| Q1 | [Comparison](comparison-q1.md), [180 original features](../verification/features/q1.json); donor checkout `../quake-1-re-ts` | [Full report](../verification/integration-candidates/q1/report.md); pinned donor `6bc6a8bf29b66981e3b6ce7251ebbc6413120270`; 568 donor files, 84,022 declarations, including the 14,540-function census subset |
| Q2 | [Comparison](comparison-q2.md), [193 original features](../verification/features/q2.json); donor checkout `../quake-2-re-ts` | [Full findings](../verification/integration-candidates/q2/findings.md); pinned donor `0d73750cbe5683c7411934d0a5d4eb5acd4da676`; independent enumeration retained 1,181 TS/TSX files, including 860 production files and 321 tests |
| Q3 | [Comparison](comparison-q3.md), [104 original features](../verification/features/q3.json); donor checkout `../quake-3-ts` | [Full report](../verification/integration-candidates/q3/report.md); pinned donor `8453c49824eb7a5ed5aee452f74e19336965d1f8`; 1,135 donor files, 209,188 declarations, including the 45,634-function census subset |

The mechanical pass uses unified source `3dc9ca6ca404dc4522ab9e9669fff458805b0993`, with 1,687 files and 203,489 declarations. It preserves callable signatures, types, classes, variables, parameters, imports, hashes, unmatched records, and ambiguous candidate groups. A matching name or signature is a review lead; it does not prove equivalent behavior. An unanchored declaration is not automatically a missing feature.

The [source inventory reconciliation](source-inventory-reconciliation.md) joins both passes with all three original inventories. Its reproduction command creates `/tmp/quake-integration-combined/combined.json`, retaining every original feature and references to complete raw artifacts by path and hash. The current status uses the reconciliation's later acceptance receipts instead of repeating its older missing-caller findings as current defects. For example, browser construction, ConfigStore, QVM client construction, GIF playback, and world-text production now have joins; each complete workflow still needs its own evidence.

## Additional findings and their present disposition

The implementation descriptions in this table summarize accepted work or explicit open findings. They do not create new ledger verdicts.

| Finding from the combined reviews | Present disposition | Concrete source or receipt and remaining boundary |
| --- | --- | --- |
| Q1 deterministic network-driver VCR | Open | Donor `src/common/net_vcr.ts:129` and `net_main.ts:899` replay operations with time/session identity. Unified `src/network/q1/demos.ts` packet-demo support does not supply this application-selected VCR driver. |
| Q2 animated GIF presentation | Implemented through extended common image resources | `e05343b` connects decoding, frame loading, and animation. Root accepted 17 tests/139 assertions with all 12 installed combinations, plus 25/417 existing cinematic/world checks, and inspected original/captured frames and a matching CPU/GL pair. Full renderer parity is separate. |
| Oriented/static world text | Implemented through extended common storage and CPU/GL scene commands | `3f6be42` joins source entities; `39ea4c0c` adds native default distance culling. Newer `200493b6` and `ef4d34d1` join live controls and guest imports, described below. Naturally authored campaign coverage and other debug shapes remain separate. |
| Extended cvar commands | Implemented through extended common command services | `7b7110e` joins `setu`, `sets`, `seta`, `toggle`, `inc`, `dec`, `reset`, and `resetall`, retaining Q1 variable promotion/default semantics. Combined cvar/input/range/HTTP receipt: 60 tests/557 assertions. Complete console/script behavior remains open. |
| SOCKS5 configuration and UDP association | Implemented through a shared transport replacement for native clients | `7964fc31` joins saved settings before native sends through `socks-settings.ts`, `RemoteApplication`, and `UdpTransport.connectSocks`. Root 5/55 covers Q2 signon/travel/reopen and NQ/QW/Q3 handshakes. Browser/listen configuration and physical-network/full-play qualification remain open. |
| Q3 event and configuration journals | Open | Donor `common-console.ts`, `common-frame.ts`, and `common-journal.ts` join event acquisition and config/file replay. No equivalent shared application journal was established. Ordinary saves are not this capability. |
| Q3 external MOTD service | Open | Donor `src/engine/client-motd.ts:23` implements external challenge-checked request/response. Unified external `getmotd` flow was not established; server `g_motd` is a different feature. |
| HTTP/native queues, packages, and filelists | Implemented through extended common downloads for the accepted Q2/Q3 workflows | `30f824fa`, `8637652`, `b48bfea`, `95ede754`, and `c578714` cover mounted downloaded packages, validated filelists, ranges, native fallback, permissions, cancellation, and interrupted Q3 admission/retry. Five Q2 download rows and one Q3 row were explicitly closed. General resume, redirects, browser UI, and all-wire generalization remain open. |
| Extended image formats and replacements | Implemented through common decoding/resolution and controls | Production union includes PCX, WAL, TGA, PNG, JPG/JPEG, BMP, and GIF. `185c06e`, `aeb059d`, `8e4230f`, `0022dc2`, and `58e715e` cover fallback, original logical dimensions, common resolution, saved runtime controls, and visible menus. Replacement pixels retain authored world/UI dimensions. |
| MD5 model replacements | Implemented through extended common model selection | `a68b43e` joins default Q2 MD5 loading/animation; Q1 already has a join. `9e55c75` retains native/MD5 pairs and joins load/use, tier/distance, persistence, and per-seat controls, root 17/369. Remote model-specific execution and universal visual fidelity were not requalified. |
| Saved screenshot commands | Implemented through the shared application capture service | `fc0c15e`, root 5/77, connects screenshot/levelshot commands and active capture. Complete Q3 capture and demo/timedemo workflows remain separate. |
| Q1 remote prompts and chase controls | Partial local prompt implementation; remote/chase work open | `d07700b` proves local prompt UI/lifecycle. Remote prompt events still need supported transport/application/input ownership. A shared camera transform alone does not implement Q1 `chase_active` policy. |
| Q2 authored mapdb starts; Q2/Q3 browser and configuration workflows | Existing services with remaining production workflow qualification | Source metadata and browser/configuration constructors were located. Complete authored start metadata, favorites/status/filter workflows, arbitrary cvars, and per-seat bindings cannot be closed from constructor presence. |
| Q2/Q3 demos, GTV, and complete VM roles | Format/runtime mechanisms exist; complete application workflows open | Demo/MVD/KEX codecs do not establish a recorder/player/GTV service. `ApplicationQvmClient` proves a join exists, not full game/cgame/UI mod admission, syscalls, lifecycle, and compatibility. |

## Shared engine and subsystem status

### Composition, maps, and gameplay selection

Implemented: one session and authoritative world carry source-owned gameplay through shared actor identity, bodies, collision, damage, inventory, scheduling, presentation, and persistence services. Supported recipes select movement, characters, arsenals, monsters, and equipment independently. Actual mixed-world checks include selected Q1/Q2/Q3 base arsenals and bounded selected Q1/Q2 creatures. Map entities, lava, movers, goals, trigger chains, and mission accounting remain map-owned. A native remote client uses server authority rather than starting a second local gameplay world.

Remaining: every required map/game/movement/character/arsenal/monster/equipment combination, expansion supply and weapon admission, complete foreign target semantics, and all authored objectives. Registering a monster or accepting one mixed encounter does not prove its full attack/pain/death/navigation behavior across every map. Stock Q3 supplies player/bot characters rather than a campaign monster roster. Surgical map mixing is deferred in the project plan.

### Physics, movement, and scaling

Implemented: shared authoritative bodies, ground support, collision, mover/rider relations, and source-selected movement/numeric profiles. Existing receipts cover actual moving platforms, carried foreign actors, attached grapples, projectile contacts, source cadence, and save identity remapping. Different source movement behavior remains intentional; no comparison establishes Q3 movement as the universal replacement.

Remaining: complete source edge behavior and every native prediction profile, Q1 rerelease corpse-extension semantics, and all combinations of actor dimensions, views, attacks, attachments, and collision. Q2 64 dynamic movement/profile work is still in validation at this snapshot.

No scaling factor has been selected. Model, hull, and map measurements and visual lineups have not established a required world-unit conversion. Native source/map pairs remain factor 1. Any justified cross-game policy must preserve relative source actor sizes; a physical conversion must carry collision, view, attack, and render dimensions together. See the [scaling evidence](source-inventory-reconciliation.md#map-relative-actor-scaling--priorities-1-and-7).

### Formats, content discovery, and assets

Implemented: a shared installed-content catalog, recipe-scoped mounts, provenance, archive/package handling, source map/model/skin formats, the production image union, replacement logical dimensions, GIF playback, and Q1/Q2 MD5 selection. Downloaded packages can supply active content in accepted remote workflows.

Remaining: complete authored start/mapdb metadata, discovered add-on and arbitrary mod selection, map rotation editing, every product restriction and pure-policy case, and explicit Quake 64 product coverage. The full inventory's Quake 64 requirements remain open; movement work does not automatically establish product admission or its entire campaign.

### Rendering and audio

Implemented: common scene/material commands feed CPU and GL renderers, with source lighting, skins, view weapons, gamma, model replacements, world text, and bounded two-seat evidence. Audio has shared device/settings ownership, source sound/music routing, queued PCM timing, and saved device selection. `0065d73b` passed root 31/263 including dummy SDL PCM/clock/music retention and remote travel. Output remains 44,100 Hz, stereo, 16-bit.

Remaining: complete materials, fog, sky, liquids, particles, shadows, transparency, source fonts/HUD layouts, renderer restart behavior, and source-grounded image/performance comparisons. Audio ownership does not by itself consolidate all mixing algorithms; the Q3 deep dive flagged separate mixer paths as a consolidation gap, which was not reverified for this report. Configurable output formats, complete streamed media, music transitions, reverb/Doppler/listener fidelity, physical sound quality, and failure races remain unqualified. Bounded CPU/GL images do not establish full-frame or universal renderer parity.

### Weapons, creatures, equipment, and match rules

Implemented: common damage and inventory authority with deliberate source attack/victim policies, shared native/selected Q3 attack execution, selected base Q1/Q2 arsenals, native pickups and bounded supply adaptation. Grapple weapon/offhand behavior, handoff, moving-brush attachment, and cooked grenade state have actual mixed-source checks. Q1 expansions/add-ons and Q2 CTF/LMCTF have substantial source modules and individual Done requirements.

Remaining: universal expansion roster/equipment selection, every native/mixed encounter, all target policies, foreign objective/spawn adaptation, campaign-aware bot use, and complete game-mode workflows. Q2 Tag, DeathBall, limits/options, rerelease coop instancing/lives, and Q1 CTF/Horde obligations remain open. A category whose listed features are Done still does not imply every complete campaign or permutation was played through.

### Campaigns, saves, and recovery

Implemented: authored target and mission state, bounded travel with selected recipes, shared save identity remapping, source callbacks, and tested weapon/projectile/equipment continuations. Existing receipts cover actual save/close/reload and specific authored travel paths.

Remaining: complete original-map boss/finale completion, hubs/backtracking/endings, every campaign transition and restart, source save-format compatibility, autosave/recovery workflows, required QC state, and complete unified Q3 world saves. The Q1 campaign category's 3/3 verdict applies to those three defined rows; it is not an end-to-end all-campaign certificate.

### Bots, input, and local seats

Implemented: the Q3-derived bot controller participates in supported Q1/Q2/Q3 standard deathmatch combinations, reads real source arsenal/pickup observations, moves through shared authority, and retains bounded travel/respawn behavior. Local seats, device assignment/tuning, bindings, gyro fallback, haptic settings, and source appearance have selected application checks. Shared device persistence was explicitly accepted as a replacement, including two-seat restart and remote CPU/GL cases.

Remaining: all arsenals and tactics, campaign/team objectives, full AAS/NAV2/foreign-map construction, moving obstacles and all-map navigation. Multiple local players on every remote protocol, full controller preview/UI, physical hotplug, MIDI and legacy device obligations remain open. Identical devices without serials cannot be reliably distinguished after reordering by GUID/ordinal alone.

### Menus, configuration, browser, downloads, and operator controls

Implemented: startup selection, Play recipe construction, save browsing, selected Sound/Controls/Video preferences, ConfigStore, visible texture/model controls, extended cvar commands, shared browser construction, and accepted download services. Saved remote QW identity/skins/colors and the new native QW command subset have bounded evidence.

Remaining: full source menu/HUD/wheel/inventory/progression workflows, arbitrary archived cvars and scripts, complete per-seat binds and restart behavior, map/rotation editors, LAN/master status/filter/favorites workflows, operator stdin/status/kick/rcon/filter controls, and complete password/spectator/flood/inactivity policy. A library command or browser constructor alone is insufficient.

### Media, accessibility, replay, services, and tools

Implemented: format mechanisms and bounded GIF/media/image playback, capture commands, source text/localization structures, and some accessibility options are present. Individual diagnostic/capture rows have accepted joins.

Remaining: complete CIN/RoQ and rerelease cinematic workflows, synchronized soundtrack, pause/skip/transition controls, subtitles/captions, independent readability scales, contrast/non-color-only workflows, ordinary/native demo recording and playback, timedemo, multi-view/GTV, VCR, and event/config journals. Q3 progression/unlocks/medals/postgame, external authorization/rankings/MOTD, durable achievements and lobby reporting, chase/spline cameras, OmniTimer, and authoring/distribution role accounting remain open where listed. Supplied codecs or callbacks do not complete these user workflows.

## Native wire and mod compatibility

This is a sparse compatibility matrix, not an all-native-games claim. The current source assessment distinguishes normal application admission from codec/library support and independent peer evidence.

| Profile | Normal application route | Evidence and open boundary |
| --- | --- | --- |
| NQ 15/666/999 | Classic-id1 client and host | Independent donor servers exercised shared-client signon and movement across all three. Complete reverse-direction peer qualification, rerelease/expansion/mod admission, and private extensions remain open. |
| QW 28 | Client and dedicated pinned CRC-54730 host | Independent donor peers exercised both directions in bounded signon, firing, movement, travel, and skin cases. Spectators, graphical hosting, arbitrary mods, full prediction/effects, and complete admin/download policy remain open. |
| Q2 classic 34 | Client and host | Controlled application-peer evidence exists. No independent retail-peer receipt is claimed by this report. Complete stock behavior remains an open ledger requirement. |
| R1Q2 35, Q2Pro 36, private classic 4038 | Codec/library support; no normal selected application route established | Format or synthetic decode evidence is insufficient for native connection qualification. |
| Q2 rerelease 1038 | Server route reachable; client rejects this profile | The remote client still selects classic 34. Q2 64 configstring/movement checks do not prove rerelease remote admission. |
| KEX 2023 and demo 2022 | Codec support | Required native handshake/admission remains unestablished. Retail/private dialect limits remain explicit. |
| Q3 68 | Client and host | Actual stock cgame/UI VM CPU/GL execution and controlled wire checks exist. Full independent retail-peer, snapshot/prediction, pure-policy, and authorization qualification remains open. |

One shared engine owns local sessions and remote presentation/input/audio/image/transport services. This architectural integration does not complete every protocol. The native mod target also includes normal application admission, execution, save, travel, and teardown for required QC, QVM game/cgame/UI, and native DLL/SO behavior. Pinned QC programs, isolated guest imports, or VM constructors do not establish arbitrary mod support. The [implementation priorities](implementation-priorities.md) retain full native interoperability and actual mod execution as separate unfinished obligations.

## Accepted source changes after the requirement cutoff

These receipts are supplied by the lead's completed review. They are included in the report's source snapshot and are not claimed as freshly rerun by the report author.

| Commit | Accepted change | Root validation and limit |
| --- | --- | --- |
| `200493b6` | Live `gl_debug_distfrac` controls the common world-text culling path | CPU/GL two-seat coverage, 6 tests/82 assertions. This extends the earlier fixed-default culling implementation. |
| `ef4d34d1` | Actual rerelease DLL's two world-text imports feed the common text store | 1 test/16 assertions. Normal guest admission and its complete lifecycle remain open. |
| `e0409dc0` | Native QW commands execute through the shared ordered command phase | 5 tests/206 assertions. This accepts the exercised command subset, not spectators, pause, complete administration, or arbitrary mods. |
| `98074c6e` | Native authored Q1 soldier/dog gib deaths reuse the existing gib/head helpers in QC order | Root independently passed 14 tests/301 assertions and the actual dedicated rerelease e1m1 witness. The head clears ground, has source bounds and signed spin, flies, and remains alive at 23.5 seconds; gib pieces accelerate, bounce, settle, and expire. Committed and pushed. Rerelease corpse-extension semantics remain open. |

## In-flight work outside this snapshot

| Work | Current boundary |
| --- | --- |
| Q2 64 dynamic profiles and configuration | The candidate is frozen. Root's actual application test passed 1 test/68 assertions and source review is complete; writer strict/policy checks passed. Final acceptance/commit remains pending. Authored travel/profile/configstring checks remain distinct from rerelease native-client admission. |
| Native guest preparation/lifecycle | The Medium-effort candidate is frozen; owner tests and writer strict/policy checks passed. Root's actual test and review remain pending. Accepted text imports do not close normal guest startup, save/travel, or teardown. |
| `misc_flare` | Missing entity/render integration was inspected; not implemented. |
| Cross-game scaling | Measurements and visual comparisons exist; no factor or engine conversion has been chosen. |

The active coordination cap is six agents. Historical agents and completed tasks are not counted as currently active workers. The live roster belongs to the lead's current agent list; this static source report does not invent a live headcount. Authorized commits may be pushed. No build, release, publication artifact, or CI result is claimed for this snapshot.

Repository README, GPLv2 licensing, and `.gitignore` are committed. The lead verified that accepted commits are pushed and match origin. CI and release work are outside the current user-requested scope.

## Installed executable

The installed executable is older than the accepted source snapshot. The lead reverified these artifact values; this report did not rebuild it.

| Property | Installed value |
| --- | --- |
| Source commit | `3a073e87ec7a4126f396e15833b8afb9df569403` |
| SHA-256 | `c6f3a0df8c03aee584cd45dbd45ea5df1064808b90f2ea38b1955a2a4281ddcd` |
| Size | 119,519,360 bytes |
| Mode | `0755` |
| Modification time | `2026-09-12T16:16:00-0500` |

New source tests and commits do not describe that installed binary until it is rebuilt and installed from verified source.

## Requirement categories

These tables group every current ledger ID by its first two dot-separated components. They retain the inventory's category names, so `save` and `saves`, for example, remain distinct source-family labels. Done counts are bounded requirement verdicts, not fresh tests or complete subsystem acceptance.


### Q1 categories

| Ledger category | Done | Open | Total |
| --- | ---: | ---: | ---: |
| `q1.content` | 2 | 2 | 4 |
| `q1.campaign` | 3 | 0 | 3 |
| `q1.execution` | 0 | 3 | 3 |
| `q1.movement` | 1 | 0 | 1 |
| `q1.combat` | 9 | 0 | 9 |
| `q1.inventory` | 15 | 0 | 15 |
| `q1.monster` | 15 | 0 | 15 |
| `q1.world` | 2 | 0 | 2 |
| `q1.hipnotic` | 8 | 3 | 11 |
| `q1.rogue` | 17 | 0 | 17 |
| `q1.mg1` | 4 | 0 | 4 |
| `q1.horde` | 1 | 1 | 2 |
| `q1.mg3` | 25 | 1 | 26 |
| `q1.ctf` | 0 | 2 | 2 |
| `q1.multiplayer` | 1 | 4 | 5 |
| `q1.seats` | 2 | 3 | 5 |
| `q1.bots` | 1 | 4 | 5 |
| `q1.input` | 5 | 1 | 6 |
| `q1.ui` | 0 | 5 | 5 |
| `q1.text` | 2 | 1 | 3 |
| `q1.accessibility` | 0 | 2 | 2 |
| `q1.assets` | 3 | 0 | 3 |
| `q1.render` | 2 | 2 | 4 |
| `q1.video` | 0 | 1 | 1 |
| `q1.audio` | 4 | 0 | 4 |
| `q1.saves` | 1 | 3 | 4 |
| `q1.demos` | 0 | 2 | 2 |
| `q1.config` | 0 | 2 | 2 |
| `q1.network` | 0 | 8 | 8 |
| `q1.events` | 0 | 4 | 4 |
| `q1.services` | 0 | 1 | 1 |
| `q1.physics` | 0 | 1 | 1 |
| `q1.tools` | 0 | 1 | 1 |
| **Q1 total** | **123** | **57** | **180** |

### Q2 categories

| Ledger category | Done | Open | Total |
| --- | ---: | ---: | ---: |
| `q2.content` | 7 | 5 | 12 |
| `q2.game` | 1 | 1 | 2 |
| `q2.weapon` | 11 | 0 | 11 |
| `q2.inventory` | 6 | 1 | 7 |
| `q2.powerup` | 2 | 2 | 4 |
| `q2.combat` | 1 | 0 | 1 |
| `q2.monster` | 1 | 0 | 1 |
| `q2.world` | 1 | 1 | 2 |
| `q2.xatrix` | 4 | 1 | 5 |
| `q2.rogue` | 10 | 1 | 11 |
| `q2.rerelease` | 2 | 4 | 6 |
| `q2.mode` | 0 | 5 | 5 |
| `q2.ctf` | 4 | 0 | 4 |
| `q2.lmctf` | 8 | 0 | 8 |
| `q2.seats` | 6 | 1 | 7 |
| `q2.bots` | 3 | 1 | 4 |
| `q2.navigation` | 2 | 2 | 4 |
| `q2.hud` | 1 | 11 | 12 |
| `q2.accessibility` | 2 | 4 | 6 |
| `q2.input` | 5 | 3 | 8 |
| `q2.audio` | 6 | 1 | 7 |
| `q2.music` | 1 | 2 | 3 |
| `q2.media` | 0 | 6 | 6 |
| `q2.save` | 6 | 3 | 9 |
| `q2.campaign` | 3 | 2 | 5 |
| `q2.service` | 0 | 2 | 2 |
| `q2.demo` | 0 | 6 | 6 |
| `q2.network` | 5 | 2 | 7 |
| `q2.browser` | 0 | 4 | 4 |
| `q2.download` | 5 | 0 | 5 |
| `q2.admin` | 1 | 5 | 6 |
| `q2.config` | 2 | 3 | 5 |
| `q2.capture` | 1 | 0 | 1 |
| `q2.diagnostics` | 1 | 0 | 1 |
| `q2.assets` | 4 | 0 | 4 |
| `q2.visual` | 2 | 0 | 2 |
| **Q2 total** | **114** | **79** | **193** |

### Q3 categories

| Ledger category | Done | Open | Total |
| --- | ---: | ---: | ---: |
| `q3.progression` | 0 | 7 | 7 |
| `q3.modes` | 8 | 2 | 10 |
| `q3.combat` | 8 | 0 | 8 |
| `q3.bots` | 4 | 2 | 6 |
| `q3.team-ai` | 6 | 0 | 6 |
| `q3.admin` | 3 | 3 | 6 |
| `q3.network` | 3 | 2 | 5 |
| `q3.discovery` | 0 | 2 | 2 |
| `q3.services` | 0 | 2 | 2 |
| `q3.content` | 2 | 3 | 5 |
| `q3.execution` | 0 | 1 | 1 |
| `q3.ui` | 1 | 5 | 6 |
| `q3.presentation` | 3 | 4 | 7 |
| `q3.formats` | 2 | 1 | 3 |
| `q3.input` | 3 | 3 | 6 |
| `q3.audio` | 3 | 3 | 6 |
| `q3.media` | 1 | 3 | 4 |
| `q3.recording` | 0 | 3 | 3 |
| `q3.configuration` | 0 | 2 | 2 |
| `q3.diagnostics` | 0 | 2 | 2 |
| `q3.persistence` | 1 | 1 | 2 |
| `q3.cameras` | 1 | 1 | 2 |
| `q3.source-applications` | 0 | 1 | 1 |
| `q3.world` | 1 | 0 | 1 |
| `q3.movement` | 1 | 0 | 1 |
| **Q3 total** | **51** | **53** | **104** |


## Remaining completion gates

The remaining work is larger than the next few patches: finish independent gameplay selection and scaling policy; qualify the complete format/render/audio feature union; complete native peers and mod admission; exercise the full roster, campaigns, saves, match rules, bots, input, seats, menus, configuration, media, replay, and services. Each required workflow needs actual production execution and source-grounded acceptance. Explicit rejection makes an unsupported combination diagnosable; it does not fulfill the requirement.

The [project plan](project-plan.md), [implementation priorities](implementation-priorities.md), [execution receipts](execution-status.md), [combined source findings](source-inventory-reconciliation.md), and [complete requirement checklist](completion-status.md) provide the detailed work and evidence behind this snapshot. Older dated paragraphs in those documents remain historical; the source, ledger, and installed-artifact cutoffs above govern this report.
