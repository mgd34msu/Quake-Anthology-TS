# Implementation priorities

This is the ordered common-engine backlog with five bounded requirement completions at source cutoff `167bfbf19d06625ac2b350120647686e3e0170e9`. It combines the [source inventory reconciliation](source-inventory-reconciliation.md) with the carried-forward requirement list in [completion-status.json](completion-status.json). It is a planning map, not a new code audit or completion-percentage report.

Usability is the highest product priority and applies to every group below. The numbered backlog retains its historical engineering order; it does not postpone fixing a broken user flow. Work on 1–2 as foundations; 3–6 can proceed in parallel with fixed contracts; 7–12 cover shared integration; 13–21 cover consumer completion; 22–24 cover remaining tools and services. Sustained play and requested release work follow the content joins. Bounded source review and actual behavior checks remain part of every change.

Use existing shared services and extend their feature union. Preserve independent selections and source-owned behavior rather than adding separate per-game subsystems. Before implementing a historical gap, check the accepted receipts below and the current source: later work has already closed parts of this older list.

## Highest product priority: usable controls and console

Make client menus and console commands work without unnecessary steps. Use sensible defaults for selected content. Show current values, support direct mouse and keyboard editing, retain familiar command names and provide clear feedback. Settings must persist as users expect.

A feature is complete only when its public user flow works. Backend behavior alone is insufficient. Acceptance must show that a user can find the control, see its value, change or reset it and verify persistence through the actual menu/runtime or console. Use a focused check appropriate to the change; no separate elaborate test system is required.

Committed source through `8ec0b01` includes five native game/edition presets with campaigns, the shared binding table, canonical mouse names, readable binding queries and ordered configuration commands. Team Arena remains disabled pending its game/progression integration. Startup binding access, selected-content defaults, numeric slider values and archived settings have accepted source/runtime checks. Existing profile bindings are preserved. Original `default.cfg`/`autoexec.cfg` startup execution remains open. Installed qfiles is `8ec0b01`, with actual startup binding/value checks and four public load/input/save/exit flows. See [execution status](execution-status.md#installed-executable-and-recent-fixes) for the current acceptance boundary.

## Ordered backlog

### 1. One authoritative simulation and composition

Finish shared actor, body, clock, collision, movement, damage, inventory and target ownership. Keep map, gameplay, movement, character and presentation selections independent, including map-owned hazards.

**Done when:** A mixed-content session advances each actor once, uses one collision/body state and routes damage, inventory and targets through the same owners; changing one selection preserves the other selections.

Actor scaling covers Q1, Q2 and Q3 source/map combinations. Calibrate actual model/source units and existing replacement transforms before deciding whether a conversion is needed. A native source/map pair uses factor 1; if a cross-game conversion is justified, use a reciprocal source/map policy and one factor per game pair to preserve relative actor sizes, including Q3 character differences. A physical unit conversion must carry collision, view, attack and render dimensions together. A cosmetic family adjustment instead must preserve feet, attachments and native physics. Stock Q3 supplies player/bot characters, not a campaign monster roster. Measurements remain read-only; no automatic Q1 enlargement or physical conversion is established.

### 2. Shared content, assets and provenance

Complete format and mod discovery, expansion dependencies, authored map databases, Quake 64 and observed IBSP44 support. Preserve asset provenance and overlay precedence.

**Done when:** Each supported product and mod resolves its required assets, start maps and dependencies through the common catalog with explicit missing-data errors. Accepted PKZ support and downloaded-package remounting remain in place.

Image-format subrequirements: preserve the production decoder union PCX, WAL, TGA, PNG, JPG/JPEG, BMP and GIF; GIF is already accepted. Q2 JPEG/BMP replacement fallback is accepted in `185c06e`. Shared resolver `8e4230f` consolidates caller-specific resolution while preserving source skin semantics. Accepted `0022dc2` joins archived `r_override_textures`, `r_texture_overrides` and `r_texture_formats` with transactional runtime refresh, preserving active connections, Q3 cgame and seat state. Root passed 18 tests/305 assertions and strict/scoped checks, and inspected CPU/GL and Q3 snapshot evidence. Accepted menu `58e715e` adds shared visible controls with actual CPU/GL mouse checks (2/38, strict/scoped 0). Startup-selector font policy (`d5ed58b`) and MD5 load/use/tier/distance controls (`9e55c75`) are accepted; these receipts do not establish full renderer parity. PCX/BMP original logical-dimension recovery is accepted in `185c06e`; `aeb059d` connects the production original-image reader. Preserve these accepted joins. Q2 default application MD5 selection and animation are accepted in `a68b43e`, alongside the existing Q1 join. Replacement controls and distance selection are accepted in `9e55c75`.

Accepted `9e55c75` joins retained native/MD5 pairs, persisted load/use controls, shared Video settings and per-seat distance selection. Root passed 17 tests/369 assertions without skips, strict/scoped policy checks, and inspected CPU/GL two-seat and Q1 menu/gun images. Model-specific remote execution was not rerun; full visual parity remains unclaimed. Startup font policy is separately accepted in `d5ed58b` (actual CPU/GL startup: 2 tests/12 assertions). Q1 explicit LMP skin intent and logical dimensions are included in `9e55c75`. No engine scale factor was chosen.

### 3. Shared CPU and GL rendering

Complete the rendering feature union: effects, fog, shadows, transparency, view weapons, fonts and world text. Compare actual scenes on both renderers.

**Done when:** The same scene commands express the required features on CPU and GL, with source-grounded visual comparisons for the affected scenes. Accepted GIF playback is retained; bounded matching images do not imply universal renderer parity.

Image-replacement rendering must consume the common priority and format choices from priority 2. Preserve original logical dimensions independently of replacement pixel dimensions, including PCX/BMP, so replacement textures keep the intended world/UI scale on CPU and GL. The bounded image fixes in `185c06e` and production original reader in `aeb059d` are accepted; `8e4230f` adds the common resolver. Accepted `0022dc2` joins archived `r_override_textures`, `r_texture_overrides` and `r_texture_formats` with transactional runtime refresh, preserving active connections, Q3 cgame and seat state. Root passed 18 tests/305 assertions and strict/scoped checks, and inspected CPU/GL and Q3 snapshot evidence. Accepted menu `58e715e` adds shared visible controls with actual CPU/GL mouse checks (2/38, strict/scoped 0). Startup-selector font policy (`d5ed58b`) and MD5 load/use/tier/distance controls (`9e55c75`) are accepted; these receipts do not establish full renderer parity.

Accepted `75d26d8` shares material-group finalization with authored primary sort across Q1/Q2/Q3 views on CPU and GL, preserving multipass state and legacy draw order. Actual LRCTF captures on both backends place sort-4 marks before sort-9 explosions and show the restored flash. Final strict and scoped policy checks passed; each actual capture passed 102 assertions. The later `af9f412` correction fixes failed shader handles and builtin white/default texture resolution, including the exercised LRCTF missing-radar path, with actual CPU/GL checks. Included `5dc48dc` adds bounded native secondary source ordering with actual CPU/GL checks. Broader ordering and material fidelity remain unqualified. The dark-impact donor/material comparison did not establish a defect or justify a fix. Different live submissions prevent pixel-parity or FPS claims. This source correction is included in installed `75d26d8`; evidence is in `.artifacts/resume-20260913/lrctf-visual-review/candidate-report.md`.

Accepted `4a85967` established material identities and original scene slots. Installed `5dc48dc` adds the accepted shared source-ordering and transactional image-refresh work. Full strict/scoped policy checks and actual CPU/GL ordering and refresh cases passed. This is bounded source-behavior evidence, not full vanilla rendering parity; lighting and broader fidelity remain open. The investigated dark impact coverage was not established as a defect.

### 4. Common audio

Complete timing, streamed PCM, spatial sound, reverb, Doppler, music and pause behavior through the common mixer.

**Done when:** Authored sounds and streamed media preserve timing, routing and lifecycle across seats and content selections, including pause/resume and moving sources; audible fidelity and performance are checked separately.

### 5. Native client and server wire compatibility

Complete NQ 15/666/999, QuakeWorld, Q2 classic/enhanced/rerelease and Q3 in both directions: signon, snapshots, prediction, pure checks, authorization and teardown.

**Done when:** Actual native peers exercise all required NQ 15/666/999, QuakeWorld, Q2 classic/enhanced/rerelease and Q3 profiles in both directions, including signon, prediction, authorization, travel and disconnect. Missing required profiles remain open; explicit rejection is diagnostic only. Separate retail/private dialect limitations must not substitute for the required stock protocols.

Accepted `66e6136` provides bounded native protocol 28 QW remote admission, transfer queues and shared rendering/prediction. Dedicated base-protocol-28 hosting is now accepted in `88f84c10`; local graphical hosting, spectator/extensions, split-screen, demos, full prediction/effects and complete host download policy remain open. No requirement closes.

Accepted `066ab042` adds QW custom skins and editable saved remote identity; `0c0499c3` supplies shared indexed color/crop semantics. Local source-color forwarding is accepted in `a8f9e2f`, but local setup/color-console and cross-source appearance ownership remain open. Accepted `820173d` adds server-selected ASCII mod gamedir downloads through the common catalog, including travel and reopen. Arbitrary-mod qualification and complete host denial policy remain outstanding.

Accepted `5a0e1848` adds bounded classic-id1 NQ 15/666/999 application profiles; remaining product and wire qualification stays open. Accepted `36f395ee` closes shared device persistence, including custom bindings and per-seat haptic enable/strength. Full controller preview and physical-device qualification remain separate.

### 6. Actual mod execution

Complete NetQuake and QuakeWorld QC hosts, QVM game/cgame/UI roles and TypeScript hosts for native DLL/SO behavior, including application admission, save and travel.

Accepted `d5ca68f` admits parsed unknown Q3 client bytecode through normal production execution while preserving role/product validation, UI API checks, pure filtering, explicit unsupported-service errors, and lifetimes. Root passed 33 tests/568 assertions. Actual mounted LRCTF client modules ran 415 frames against a baseq3 server advertising LRCTF with sv_pure=0; that client-only proof did not exercise LRCTF server rules. Full mods and missionpack remain open.

Accepted server prerequisites now include optional shared session async stepping (`babe71b`), common/filesystem services across QVM roles without aliases (`fae018f`), ordered awaited Q3 callbacks and cleanup (`57083ac`), and the server guest ABI with borrowed records and shared collision (`dded3ea`). Combined server-ABI/record checks passed 43 tests/522 assertions with zero scoped strict/policy diagnostics; actual known-BASEQ3 pure client travel also passed. Shared awaited commands are accepted in `1eb7387`. These prerequisites are included in the installed `75d26d8` executable.

Accepted `729b1dd` binds cgame entity-token and PVS queries to the loaded Q3 world owner, with root five tests/3,196 assertions. At that checkpoint, admission remained limited to known baseq3; the later parsed-bytecode acceptance below supersedes that restriction.

Accepted `5258ee0` binds all 18 UI LAN browser calls through shared discovery and cache ownership. IPv4 and JSON cache scope and native admission gates remain. A bounded artifact-only gate bypass reached one active frame with real mounted LRCTF UI/cgame modules after UI71 completion, against a baseq3 server advertising fs_game=lrctf with sv_pure=0. That artifact probe left production admission unchanged; the later source acceptance below admits parsed unknown client bytecode. That artifact did not qualify LRCTF server rules or pure mods. Full gameplay, missionpack, and comprehensive unknown-module compatibility remain open. Accepted `1aa524d` reuses browser reads with root 19 tests/254 assertions.

Accepted `a8a842f` composes dedicated selected-Q3 qagame with the shared scene, bodies, clock, mounts, and network. Actual LRCTF qagame/UI/cgame ran with pure enabled for 30,037.81 ms wall time and 13,650 ms supplied simulation time, moved 171.5947 units, consumed ammunition from 50 to 0, and retired all VMs. Root passed 22 tests/192 assertions and existing BASEQ3 pure client travel; combined strict and scoped policy checks passed. At that checkpoint, bots, local seats, mixed mod providers, saves, restart and guest-server travel remained unsupported. Current source adds dedicated offline saves and bounded local two-seat play; local QVM saves are accepted in `19bf026`, while guest bots and travel remain guarded. Native DLL/SO and full mod completeness remain open, so this priority stays open. The accepted primary material-ordering correction in priority 3 restores the flash over marks; `af9f412` subsequently fixes the exercised missing-radar shader fallback and builtin texture resolution. The dark-impact donor/material comparison did not establish a defect or justify a fix. This source is included in installed `75d26d8`. Compiled verification covers dedicated LRCTF Init, 10 frames, and Shutdown only; the sustained client/server gameplay result above is source-run evidence. The installed `a43cd7c` also includes accepted snapshot identity/admission and shader fallback work.

**Done when:** The required QC, QVM and native-mod behavior runs through normal application admission, execution, travel, save and teardown across every required host. A pinned-program whitelist is insufficient. Required programs or host combinations that remain unsupported keep this priority open; explicit failure only explains the limitation.

Accepted `60bbc638` shares the pinned native QW program and damage authority with the existing QuakeCSource owner, retaining NQ behavior (root 9/718). This does not complete external-mod or spectator ABI coverage.

### 7. Swappable gameplay rosters and equipment

Complete expansion weapons, monsters, pickups, powerups and equipment. Support grapple weapon and offhand behavior, plus cooked grenades, independently of the selected match mode.

**Done when:** Each required encounter and item runs through shared gameplay services in its native world and every required cross-game combination, with authored behavior and independently selectable equipment.

Apply the calibrated priority-1 policy across Q1/Q2 monster rosters and Q1/Q2/Q3 player characters. A single factor per source/map game pair must preserve authored relative actor sizes, including the different Q3 player/bot character sizes. Native pairs stay at factor 1. Only introduce reciprocal physical conversion if measurements establish a need; carry collision, view, attack and render dimensions together. Cosmetic family adjustments must instead preserve feet, attachments and native physics. Stock Q3 has no campaign monster roster.

### 8. Authored maps and campaigns

Complete map entities, mission trigger graphs, campaign transitions, hubs, backtracking and endings.

**Done when:** Actual authored maps complete their target chains and mission transitions, including revisits and endings, without replacing them with test-only triggers.

### 9. Complete saves and recovery

Complete mixed-world saves, source save formats, autosaves, recovery and the save/load UI.

Accepted source restores admitted Hipnotic/id1 NetQuake/QuakeWorld checkpoints, native-Q3 and attached-bot state, and dedicated offline QVM state through the shared save boundary. `19bf026` adds local two-seat QVM disk restoration and transactional native/guest world replacement, retaining saved human seats without counting bots as humans. Earlier compiled `a6cb2e0` has bounded native Q3 save/load, post-load input, a second save and normal exit evidence, plus two Q2 mixed-recipe firing runs. `2ef9f51` also constructs startup restoration directly from saved state without overwriting autosaves or replaying source startup callbacks. These restore changes are included in installed `8ec0b01`; exact continuation retains its separate source-test evidence. Live-network saves, guest bots/travel, source-native save formats and full campaign recovery remain open. See [execution status](execution-status.md#installed-executable-and-recent-fixes) for current evidence. This priority remains open.

**Done when:** All required mixed-world and player state survives actual save, close and reload, including campaign revisits and required QC state. Required source save formats and QC programs beyond the admitted checkpoint scope remain unfinished; version guards and explicit rejection do not complete them.

### 10. Match rules and objectives

Complete team, spawn, timer, coop instancing and lives behavior across modes, including Tag, DeathBall and Horde.

**Done when:** Actual matches reach their authored win, loss and transition conditions with correct scoring, spawns and selected rule settings on native and supported foreign maps.

### 11. One shared bot and navigation system

Extend the Q3 bot foundation with the Q1/Q2 feature union, foreign-map navigation, moving geometry, objectives and campaign participation.

**Done when:** Bots execute combat and objective routes in real worlds, including supported moving geometry. Loading navigation data alone does not count as completing route execution.

### 12. Independent local and remote seats

Complete split-screen ownership of actors, input, audio, UI and recording through connection and travel lifecycles.

**Done when:** Each local seat remains independently controlled and presented on local and remote sessions; reassignment, disconnect, travel and recording preserve ownership.

### 13. Input and controller behavior

Complete keyboard/mouse binds, hotplug, per-seat assignments, deadzones, curves, gyro and rumble through shared settings.

**Done when:** Actual input reaches only the assigned seat, settings persist where promised, and focus/device loss cancels pending work. Accepted gyro calibration and haptic controls stay implemented; physical-controller qualification remains separate.

### 14. Common downloads

Complete remaining per-wire extensions, resume, redirects and user feedback.

Accepted `b48bfea` completes the five listed Q2 download requirements through shared services: root production receiver/Application checks passed 8/156, including HTTP/native precache, filelist validation and package rescan, cancellation, saved master permission and HTTP-off native fallback. Accepted `95ede754` adds game-local `@` scope (4/88). Accepted `c578714` closes the Q3 workflow with root actual two-package interruption/retry checks (1/134, strict/scoped policy 0): the completed package survives, closing removes the second partial, and reopening finishes both exact packages before authentic pure admission and one guest initialization. Broader resume, redirects, browser/download UI and cross-wire generalization remain separate work.

**Done when:** Actual missing-content joins finish through the shared contained storage and catalog path, with cancellation and recovery. Accepted concurrent HTTP ranges, package remounting and native fallback are retained, not reimplemented.

### 15. Console, cvars and profile persistence

Complete owned console/configuration state per game, mod and seat, including scripts, binds and startup persistence.

**Done when:** Commands and archived values retain the correct owner and survive the promised profile lifecycle. Accepted extended cvar commands and custom-variable promotion remain in place.

### 16. Unified setup and main menus

Complete useful setup menus for all independent selections and detailed mode/server profiles.

**Done when:** A user can configure and launch all required independent selection combinations through the common UI, retain choices and recover from invalid input without implementation-specific setup steps. Rejection of a required combination leaves that work open.

### 17. HUD and gameplay interaction

Complete inventory, wheels, carousel, scores, help, POI, compass, boss bars, prompts, finale input and player identity.

**Done when:** The selected gameplay gets the correct authored HUD and actionable controls through common presentation. Accepted local prompts work; private native remote prompt transport remains unsupported.

### 18. Server browser and administration

Complete LAN/master discovery, favorites, filters, details, rcon, permissions, passwords, kick/flood controls, heartbeat, spectator chase and dedicated stdin.

**Done when:** Users can find, inspect, join and administer supported real servers through the shared browser and operator paths, with correct permissions and lifecycle cleanup.

### 19. Cinematics and media

Complete the media format union, clocks, PCM, pause, skip, hold, world/menu video and transitions.

**Done when:** Actual supplied media plays with synchronized sound and correct lifecycle in world and menu consumers. Accepted CIN/RoQ and shared movie work is preserved; remaining format and transition gaps are verified individually.

### 20. Localization and accessibility

Complete localization overlays, subtitles, captions, readability, color contrast and independent UI scales.

**Done when:** Mounted language changes and accessibility settings affect the intended consumers; timed text stays synchronized and important information does not rely only on color.

### 21. Progression and local service lifecycle

Complete Q3 arena and Team Arena records, medals, unlocks and podiums, plus achievements, local match reporting and lobby transitions.

**Done when:** Actual completed matches update durable records and the correct next UI state, with reset/unlock behavior and failure handling matching the supported source profile.

### 22. Recording and replay

Complete native demo codecs, client/server recording, MVD/GTV, timedemo and recorded views; add Q1 VCR and Q3 event/config journals.

**Done when:** Real recordings replay with the required clocks, state and viewpoints, and journal/VCR paths reproduce their specified inputs and configuration behavior.

### 23. Runtime capture and authoring tools

Complete screenshots, levelshots, camera splines/chase, diagnostics, profiling and required authoring tools.

**Done when:** The normal application produces usable captures and diagnostic output from the intended frame and camera, while authoring/distribution tools have explicit supported roles.

### 24. External and historical services

Account for SOCKS5, MOTD, online add-ons, rankings, IPX, MIDI and A3D behavior. Keep stock-server authorization in priority 5.

**Done when:** Each obligation has working supported behavior or a precise external-service limitation; unavailable endpoints are never represented as successful local substitutes.

### 25. Sustained play, fidelity and performance

After content joins, complete sustained human play and tune fidelity and performance across supported combinations. Continue bounded checks during every earlier change.

**Done when:** Longer actual play exposes no unresolved progression or lifecycle blockers in the claimed scope, with measured performance and reviewed visual/audio fidelity.

### 26. Later hardening and release work

Do regression hardening, menu asset packaging and release work only when requested after the content work.

**Done when:** The specifically requested packaging or release scope passes its agreed checks. This plan authorizes no CI, executable rebuild or release work.

## Current followups — 2026-09-12

The image-replacement and actor-scaling details above are current planning followups, separate from the historical seven source-inventory leads and the carried requirement verdicts. Image decoder support and accepted GIF playback are existing work. The bounded image-resolution fixes are accepted in `185c06e`; the production original reader is accepted in `aeb059d`. Root checked the combined Hipnotic/reader source with 37 tests/1755 assertions and strict/policy checks. Actor-size measurements are read-only and were independently rerun: Q1 MDL height 51.8381, Q2 male MD2 49.8092, Q1 rerelease MD5 52.0984 and Q2 male MD5 50.0221. Assembled Q3 heights are Sarge 57.8448, Xaero 59.6382 and Anarki 62.2117. All standing hulls are 56 high; Q3 width/view height are 30/26, versus Q1/Q2 32/22. Visual reference calibration is separate from physics units. Root inspected `/tmp/q12-scale-native.png` and `/tmp/q12-scale-fixed-ratio.png`: Q2 `base1`, equal depth and floor placement, Q2 soldier/male beside Q1 shambler/Ranger, comparing native factor 1 with a common Q1 factor of 0.960860619. This comparison did not establish automatic enlargement. Root also reran `/tmp/map-scale-measure.ts` (`/tmp/root-map-scale-measure.log`): all three BSP vertex paths retain unscaled coordinates; reviewed defaults use step 18 and gravity 800. Room clearances 96/320/276 come from different rooms and are not a unit calibration. Equal actor hulls do not prove equivalent world scale. Root also inspected Q1 `start` and Q3 `q3dm1` lineups at scale 1, with assembled Sarge, Q2 male, shambler and Ranger aligned by feet at equal depth. No world conversion was established. No scale factor has been selected and no engine scaling change is claimed. These scale measurements do not change the ledger or historical seven-lead count; the finite MD5 verdict change is recorded separately.

## Recent accepted work and new leads

These dispositions do not change the historical ledger or invent new requirement IDs.

| Lead or receipt | Disposition and remaining boundary |
| --- | --- |
| GIF images | Accepted in `e05343b`: actual installed image cases 17 tests / 139 assertions, plus media/world lifecycle 25 / 417. CPU/GL image agreement is bounded to the inspected samples. Keep this work; remaining renderer union is priority 3. |
| Extended cvar commands | Accepted in `7b7110e`, including Q1 custom-variable promotion. Keep these commands; broader configuration persistence remains priority 15. |
| HTTP ranges | Accepted in `8637652`: actual RemoteApplication downloaded and mounted the 1,991,612-byte PAK using one HEAD and four concurrent range GETs, with identical SHA and native WAL fallback. Focused cvar/range/HTTP checks passed 60 / 557. Resume, redirects and wider wire/UI work remain priority 14. |
| Audio devices | Accepted `0065d73b`: named/default device selection and per-product audio settings persistence, with root dummy SDL and CPU/GL menu/restart/remote checks 31/263. Selectable output formats and physical audio qualification remain open. |
| World text | Bounded shared rendering accepted in `3f6be42`; `39ea4c0c` adds native default distance-culling (root CPU/GL and two-seat checks 6/60). Accepted `200493b6` joins live `gl_debug_distfrac` through CPU/GL two-seat checks (6/82). Accepted `ef4d34d1` joins the actual DLL's two world-text imports to common storage (1/16). The other eight debug-shape imports and complete normal guest admission remain open. |
| Native QW commands | Accepted `e0409dc0` joins the exercised native commands through the shared ordered command phase (root 5/206). Spectators, pause, complete administration and arbitrary mods remain open. |
| Q1 authored gibs and heads | Accepted `98074c6` reuses existing helpers in soldier head-first and dog gibs-first source order. Root passed 14/301 and actual rerelease head flight/persistence plus gib gravity/bounce/removal. Rerelease corpse-extension policy remains open. |
| Q2 64 movement configuration | Accepted `3176aee` joins selected source profiles and native server configuration publication; root actual authored bio/base travel checks passed 1/68. Rerelease remote admission and matching native prediction remain open. |
| Native guest preparation/lifecycle | Accepted `e5e51456` prepares the native Win64 Q2 guest source lifecycle; root passed 7/109. Complete bindings and normal application guest admission remain open. |
| Q1 VCR | Open source-inventory lead. Priority 22. |
| SOCKS5 | Accepted `7964fc31` joins archived/latched client settings to the existing RemoteApplication transport for NQ/QW/Q2/Q3. Root 5/55 covers Q2 CPU signon/travel/reopen and all-family handshake/reply paths. Browser/listen-server configuration and broader network qualification remain separate. |
| Native QW host | Accepted `60bbc638` shared QC and `88f84c10` dedicated protocol-28 host; independent donor-client movement, firing and travel verified. Graphical local hosting, spectators, arbitrary mods and complete operator commands remain open. |
| Q3 connectionless print | Accepted `3d6589c5` restores native newline-body reading; root 1/9. |
| Q3 event/config journals | Open source-inventory lead. Priority 22. |
| MOTD | Open source-inventory lead. Priority 24. |
| Shared resolver | Accepted `8e4230f`: one image-resolution path retains source skin semantics; root actual CPU/GL resolver tests passed 8/151 with no skips. Runtime controls/refresh are accepted in `0022dc2`; visible controls are accepted in `58e715e`. Startup-selector font policy is accepted in `d5ed58b` (2 tests/12 assertions). |
| HTTP filelist validation | Accepted `30d872a`: image and asset entry validation, root 4/79. Game-local `@` scope is accepted in `95ede754` (4/88); application permission is accepted in `b48bfea` (8/156). |
| Q2 camera and MD5 | Camera `0c05d78` passed native 2/154, cross-Q1 1/6 and normal CPU/GL application checks. MD5 `a68b43e` passed 6/148 plus exact normal CPU/GL runs; root inspected corrected textured blaster/hand and soldier placement. Animation acceptance is retained; replacement controls/distance are accepted in `9e55c75`. Full visual fidelity remains unqualified. |
| Shared screenshot capture | Accepted in `fc0c15e`: actual local/remote CPU and GL captures and reviewed complete-frame, dimension and file-ownership paths close `q2.capture.screenshots` as Done/shared-replacement. Multi-seat and resized-window screenshots were not separately exercised in the current five tests. Q3 recording-clock/FPS-timescale/restart integration remains open. |
| Local game prompts | Accepted in `d07700b`: actual application proof passed 25 assertions, with source review and CPU image inspection. Local UI pagination/lifecycle and the Q1 player lifecycle recursion correction are included. Private native remote prompt transport remains unsupported. Priority 17 retains that boundary. |

The seven newly identified source leads are GIF, extended cvar commands, world text, Q1 VCR, SOCKS5, Q3 journals and MOTD. HTTP ranges and local prompts are additional accepted receipts, not additional invented ledger entries. The historical installation at this audit was `3a073e8`. The current installed executable is `8ec0b01`; see [execution status](execution-status.md#installed-executable-and-recent-fixes) for its exact hash and bounded runtime evidence.

## Carried-forward open requirement appendix

The following **184 open requirements** use source cutoff `167bfbf19d06625ac2b350120647686e3e0170e9`. Five accepted requirements were removed from this appendix. The other 472 verdicts carry unchanged from `e5e51456d04a911528da8b52af9a50b794738318`, with only the status/kick remaining-work reason updated. No new audit was performed.

Every open ID appears exactly once under its primary planning priority, with its original title. Cross-cutting work can depend on other priorities. Later accepted work can supersede parts of carried reasons, so consult the completion ledger and acceptance receipts before implementing a gap. No fresh 477-row audit was performed.

### Priority 1: One authoritative simulation and composition — 4 carried-forward open requirements

- `q1.content.launch-selection` — Select gameplay separately from content and engine behavior
- `q1.physics.rerelease-gibs-corpses` — Rerelease gib and corpse collision semantics
- `q2.game.provider-selection` — Select base, expansion, CTF, LMCTF, and KEX game providers
- `q2.rerelease.q64-movement` — Match Q2 64 server movement and prediction

### Priority 2: Shared content, assets and provenance — 6 carried-forward open requirements

- `q1.content.quake64` — Identify and launch the required Quake 64 content
- `q2.content.discovered-addons` — Discover installed add-on directories
- `q2.content.start-map-discovery` — Resolve mapdb, maplist, and BSP start maps
- `q3.content.mod-selection` — Mod discovery, selection and return to base
- `q3.formats.ibsp44-compatibility` — Observed IBSP44 map compatibility
- `q3.content.demo-product-profiles` — Independent prerelease demo product restrictions


### Priority 3: Shared CPU and GL rendering — 7 carried-forward open requirements

- `q1.render.fog-sky-liquids` — Fog, skyboxes and liquid presentation
- `q1.render.model-effects-particles` — Model effects, particles, shadows and transparency
- `q1.video.mode-restart-capture` — Video modes, resize, fullscreen and renderer restart
- `q2.config.renderer-restart` — Restart or switch renderer within a live session
- `q3.presentation.fonts-and-glyphs` — Bitmap, proportional and Team Arena glyph fonts
- `q3.presentation.materials-cpu-gl` — Materials and complete CPU/GL rendering
- `q3.presentation.visual-options-restart` — Visual settings, display lifecycle and source hardware profiles

### Priority 4: Common audio — 5 carried-forward open requirements

- `q2.audio.raw-pcm` — Mix cinematic and streamed PCM
- `q2.music.pause-resume-gain` — Control music pause, resume, and continuous gain
- `q2.music.menu-shuffle` — Control menu music and playlist shuffle
- `q3.audio.background-music` — Background intro/loop music and continuous gain
- `q3.audio.raw-pcm-output-diagnostics` — Raw PCM, output formats and sound diagnostics

### Priority 5: Native client and server wire compatibility — 8 carried-forward open requirements

- `q1.network.nq-wire` — NetQuake protocols 15, 666 and 999
- `q1.network.qw-prediction` — QuakeWorld protocol and prediction
- `q1.network.native-session-negotiation` — Negotiate full native session identity
- `q1.network.retail-kex-boundary` — Separate documented Q1 wire compatibility from retail KEX claims
- `q2.network.classic-protocol` — Preserve stock protocol 34 behavior
- `q3.network.snapshots-prediction` — Snapshots, deltas and client prediction
- `q3.services.authorization-endpoints` — CD-key authorization and configurable service endpoints
- `q3.content.pure-policy` — Pure package checksums and filesystem selection

### Priority 6: Actual mod execution — 3 carried-forward open requirements

- `q1.execution.nq-qw-host-abi` — Keep NetQuake and QuakeWorld gamecode host contracts distinct
- `q1.execution.builtin-typescript-gameplay` — Run first-party Q1 gameplay in strict TypeScript
- `q3.execution.qvm-roles` — QVM game, cgame and UI execution

### Priority 7: Swappable gameplay rosters and equipment — 11 carried-forward open requirements

- `q1.hipnotic.monster-scourge` — Hipnotic scourge encounter
- `q1.hipnotic.monster-gremlin` — Hipnotic gremlin encounter
- `q1.hipnotic.monster-armagon` — Hipnotic armagon encounter
- `q1.mg3.lavasuit` — Dawn of the Machine lava suit
- `q2.inventory.power-armor` — Toggle power armor and consume cells on protection
- `q2.powerup.quad` — Activate and extend quad damage
- `q2.powerup.invulnerability` — Activate and expire invulnerability
- `q2.world.flashlight` — Toggle the rerelease flashlight under every host profile
- `q2.xatrix.quadfire` — Activate quad fire
- `q2.rogue.double-damage` — Activate double damage
- `q2.rerelease.guardian` — Complete the guardian encounter

### Priority 8: Authored maps and campaigns — 4 carried-forward open requirements

- `q1.execution.entity-properties` — Preserve foreign entity classes, fields and target graphs
- `q2.content.native-starts` — Launch authored campaign starting maps
- `q2.campaign.unit-backtracking` — Restore revisited levels within a unit
- `q2.campaign.hub-endings` — Complete hubs, objectives, secrets, and endings

### Priority 9: Complete saves and recovery — 8 carried-forward open requirements

- `q1.ui.save-load-menus` — Save, load and autosave selection UI
- `q1.saves.classic-v5` — Classic version 5 save import and export
- `q1.saves.kex-v6` — KEX-style version 6 save compatibility
- `q1.saves.autosave` — Timed autosave and recovery
- `q2.save.eligibility-paths` — Enforce save eligibility and contained slot paths
- `q2.save.poi-health-story` — Restore objective and presentation state
- `q2.save.autosave-transition` — Distinguish autosaves from transition snapshots
- `q3.persistence.complete-world-save` — Complete unified world saves under Q3 gameplay

### Priority 10: Match rules and objectives — 12 carried-forward open requirements

- `q1.horde.launch-waves` — Horde launch, wave spawning and survivor progression
- `q1.ctf.capture-loop` — Rerelease CTF capture, return, drop and scoring
- `q1.ctf.grapple-observer-vote` — Rerelease CTF grappling, observers and exit vote
- `q2.rerelease.instanced-items` — Use coop item instancing
- `q2.rerelease.squad-respawn-lives` — Use squad respawn and cooperative lives
- `q2.mode.deathmatch-limits` — End a deathmatch on authored limits
- `q2.mode.dm-options` — Apply classic deathmatch flags
- `q2.mode.rerelease-options` — Apply rerelease deathmatch and weapon settings
- `q2.mode.tag` — Play Rogue Tag
- `q2.mode.deathball` — Play rerelease DeathBall
- `q3.modes.single-player-arena` — Single-player arena match flow
- `q3.modes.foreign-objective-adaptation` — Objective and spawn adaptation on foreign maps

### Priority 11: One shared bot and navigation system — 9 carried-forward open requirements

- `q1.bots.population` — Manual bots, autofill and eligibility
- `q1.bots.knowledge-skill` — Bot personalities, weapon/item knowledge and skill
- `q1.bots.combat-traversal` — Bot combat, swimming, jumps and monster interactions
- `q1.bots.ctf-coop-horde` — Bot objectives and campaign participation
- `q2.bots.combat-campaign-goals` — Execute bot combat and campaign decisions
- `q2.navigation.dynamic-obstacles` — Update routes for doors, lifts, hazards, and moving floors
- `q2.navigation.foreign-map-construction` — Construct navigation for maps without NAV2
- `q3.bots.aas-reachability-clustering` — AAS reachability, clustering, writing and optimization
- `q3.bots.foreign-map-construction` — Navigation construction for foreign maps and moving geometry

### Priority 12: Independent local and remote seats — 5 carried-forward open requirements

- `q1.seats.connections-lifecycle` — Two to four independent local player connections
- `q1.seats.presentation-ownership` — Resolve shared effects, audio, menus and recordings for seats
- `q1.seats.qw-native-extension` — Local players with QuakeWorld gameplay and native networking
- `q2.seats.remote-network` — Use multiple local players on a remote server
- `q3.input.multiple-local-players` — Multiple local seats and remote participation

### Priority 13: Input and controller behavior — 4 carried-forward open requirements

- `q1.input.controller-tuning` — Controller deadzones, curves and per-seat settings UI
- `q2.input.per-player-tuning` — Tune controller axes independently
- `q2.input.binds-keyboard-mouse` — Bind keyboard and mouse gameplay controls
- `q3.input.joystick-profiles-hotplug` — Joystick profiles, thresholds and device lifecycle

### Priority 14: Common downloads — 1 open requirement

- `q1.network.downloads` — QuakeWorld content download queues and policy

### Priority 15: Console, cvars and profile persistence — 5 carried-forward open requirements

- `q1.config.commands-console` — Console scripts, aliases, history and completion
- `q1.config.persistence-migration` — Archived configuration and writable profile migration
- `q2.config.archived-state` — Persist binds and archived cvars
- `q3.configuration.console-scripts` — Console, history, completion and command scripts
- `q3.configuration.persistence-startup` — Archived cvars, bindings and startup configuration

### Priority 16: Unified setup and main menus — 10 carried-forward open requirements

- `q1.multiplayer.setup` — Configure and launch multiplayer matches
- `q1.ui.options-and-reset` — Complete options, binding and reset workflows
- `q2.content.server-map-lists` — Choose maps and inspect mode eligibility
- `q2.content.rotation-editor` — Edit and persist ordered map rotations
- `q2.config.audio-video-input-menus` — Apply video, audio, and input settings
- `q3.ui.base-settings` — Base menus for player, controls and settings
- `q3.ui.base-host-browser-ingame` — Base hosting, browser and in-game menus
- `q3.ui.base-demos-cinematics-configs` — Demo, movie and configuration menus
- `q3.ui.team-arena-scripts-feeders-visibility` — Team Arena scripts, feeders and owner draws
- `q3.ui.team-arena-skirmish` — Team Arena skirmish launch and next match

### Priority 17: HUD and gameplay interaction — 17 carried-forward open requirements

- `q1.multiplayer.identity` — Player names, colors and setup
- `q1.ui.weapon-quickswitch` — Weapon-wheel data and quickswitch impulses
- `q1.ui.radial-weapon-wheel` — Rendered radial weapon selection
- `q1.ui.hud-inventory` — Classic, Hipnotic and Rogue HUD/inventory layouts
- `q1.events.prompts` — Localized prompts and choice impulses
- `q2.hud.profile-selection` — Select the correct classic or rerelease HUD
- `q2.hud.inventory` — Open and use the inventory display
- `q2.hud.weapon-wheel` — Select a weapon with the radial wheel
- `q2.hud.powerup-wheel` — Use powerups through the radial wheel
- `q2.hud.weapon-carousel` — Cycle weapons with the carousel
- `q2.hud.score-help` — Display scoreboards and the help computer
- `q2.hud.poi-stages` — Activate and advance objective markers
- `q2.hud.compass-help-path` — Draw the compass route to the active objective
- `q2.hud.boss-health-bars` — Display and clear authored boss health bars
- `q2.hud.damage-feedback` — Display damage direction and pickup feedback
- `q2.hud.centerprints-notifications` — Queue localized centerprints and notifications
- `q2.admin.player-identity` — Configure player names, skins, handedness, and view settings

### Priority 18: Server browser and administration — 17 carried-forward open requirements

- `q1.multiplayer.chat` — Public, team and private messages
- `q1.multiplayer.pause-kick-status` — Pause, kick, ping and player status
- `q1.network.hosting-lifecycle` — Listen and dedicated server lifecycle
- `q1.network.discovery` — Direct connect, LAN search and server browser
- `q1.network.admission-admin` — Passwords, spectators, rcon, filtering and flood control
- `q2.network.connectionless-rcon` — Process status, ping, challenges, and rcon
- `q2.browser.master-lan` — Discover servers from UDP, HTTP, and LAN sources
- `q2.browser.status-details` — Inspect server rules and player details
- `q2.browser.sort-filter` — Filter and sort server results
- `q2.admin.status-kick` — Inspect clients and remove a player
- `q2.admin.masters-heartbeat` — Configure masters and heartbeat publication
- `q2.admin.spectator-chase` — Enter spectator mode and chase active players
- `q3.admin.permissions-cheats-passwords` — Password admission and developer command permissions
- `q3.admin.operator-rcon-filters` — Operator controls, rcon, filters and logging
- `q3.discovery.lan-global-favorites` — LAN, master lists and favorites
- `q3.discovery.ping-status-cache-filters` — Ping/status queues, filtering and persistent cache
- `q3.admin.pause-flood-inactivity` — Pause eligibility, command flood control and inactivity

### Priority 19: Cinematics and media — 7 carried-forward open requirements

- `q2.media.cin-video` — Decode and present classic CIN frames
- `q2.media.cin-soundtrack` — Synchronize the CIN soundtrack
- `q2.media.static-pcx` — Present static PCX intermission images
- `q2.media.pause-skip-transition` — Pause, skip, and finish cinematic transitions
- `q2.media.rerelease-formats` — Play required rerelease and expansion media formats
- `q3.media.cinematic-clock-transitions` — Cinematic timing, looping, hold and skip
- `q3.media.world-and-menu-video` — World material and menu cinematics

### Priority 20: Localization and accessibility — 9 carried-forward open requirements

- `q1.text.localization-overlays` — Localization, fallback and mod overlay precedence
- `q1.accessibility.contrast-color` — Contrast and color-accessibility settings
- `q1.accessibility.subtitles-captions` — Timed subtitles and sound captions
- `q2.accessibility.contrast-typeface` — Choose contrast backgrounds and alternate typefaces
- `q2.accessibility.independent-scales` — Scale menus, HUD, and console independently
- `q2.accessibility.color-and-captions` — Complete readable non-color-only and caption workflows
- `q2.media.timed-subtitles` — Display timed cinematic subtitles and captions
- `q3.presentation.accessibility-scales` — Readable UI, independent scales and accessibility
- `q3.media.subtitles-captions` — Timed subtitles and captions for supplied media

### Priority 21: Progression and local service lifecycle — 11 carried-forward open requirements

- `q1.events.achievements` — Achievement persistence and player UI
- `q1.events.level-completed-lobby` — Level-completed events and return-to-lobby lifecycle
- `q2.service.achievements` — Record authored achievement events durably
- `q2.service.match-report-lobby` — Complete match reporting and lobby lifecycle
- `q3.progression.catalog` — Arena and bot catalogs
- `q3.progression.difficulty-records` — Difficulty-specific arena records
- `q3.progression.medals` — Persistent medals and award thresholds
- `q3.progression.tiers-videos-unlocks` — Tier completion and movie unlocks
- `q3.progression.reset-and-unlock-commands` — Progression reset and explicit unlock commands
- `q3.progression.podium-postgame` — Podium, postgame and next-match navigation
- `q3.progression.team-arena-records` — Team Arena skirmish scores and best times

### Priority 22: Recording and replay — 10 carried-forward open requirements

- `q1.demos.nq-record-playback` — NetQuake demo recording, playback and timedemo
- `q1.demos.qw-record-spectate` — QuakeWorld demos, rerecord and spectator cameras
- `q2.demo.client-recording` — Record and replay ordinary demos
- `q2.demo.protocol-playback` — Play supported classic and rerelease demos
- `q2.demo.server-recording` — Record server demos
- `q2.demo.mvd-recording` — Record multi-view demos
- `q2.demo.gtv-streaming` — Authenticate and stream GTV spectators
- `q2.demo.view-controls-seats` — Control playback and recorded local viewpoints
- `q3.recording.demo-record-playback` — Demo recording and legacy playback
- `q3.recording.timedemo` — Timedemo clocks and performance reporting

### Priority 23: Runtime capture and authoring tools — 6 carried-forward open requirements

- `q1.tools.chase-camera-diagnostics` — Runtime chase camera and diagnostic commands
- `q3.recording.screenshots-levelshots` — Screenshots, levelshots and capture timing
- `q3.diagnostics.runtime-tools` — Runtime diagnostic and developer commands
- `q3.diagnostics.omnitimer` — OmniTimer initialization, stamps and reporting
- `q3.cameras.spline-runtime` — Spline camera evaluation and timed camera events
- `q3.source-applications.role-accounting` — Separate authoring and distribution application roles

### Priority 24: External and historical services — 5 carried-forward open requirements

- `q1.services.addon-discovery` — Local and online add-on browsing
- `q3.network.ipx-transport` — Historical IPX transport obligation
- `q3.services.rankings-lifecycle` — Ranking login, match lifecycle and submission
- `q3.input.midi-controller` — MIDI note input and device configuration
- `q3.audio.a3d-geometry-contract` — Legacy A3D geometry behavior account

### Priority 25: Sustained play, fidelity and performance — 0 carried-forward open requirements

No open ledger row is assigned primarily here; the scope comes from the common-engine plan and source-inventory leads.


### Priority 26: Later hardening and release work — 0 carried-forward open requirements

No open ledger row is assigned primarily here; the scope comes from the common-engine plan and source-inventory leads.
