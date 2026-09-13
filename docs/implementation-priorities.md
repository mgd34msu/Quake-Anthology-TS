# Implementation priorities

This is the ordered common-engine backlog after accepted source commit `d07700be0dc85312f4279bb6ec694961443b303c`. It combines the [source inventory reconciliation](source-inventory-reconciliation.md) with the historical requirement list in [completion-status.json](completion-status.json). It is a planning map, not a new code audit or completion-percentage report.

Priority is engineering order, not a requirement to wait for every earlier group. Work on 1–2 as foundations; 3–6 can proceed in parallel with fixed contracts; 7–12 cover shared integration; 13–21 cover consumer completion; 22–24 cover remaining tools and services. Sustained play and requested release work follow the content joins. Bounded source review and actual behavior checks remain part of every change.

Use existing shared services and extend their feature union. Preserve independent selections and source-owned behavior rather than adding separate per-game subsystems. Before implementing a historical gap, check the accepted receipts below and the current source: later work has already closed parts of this older list.

## Ordered backlog

### 1. One authoritative simulation and composition

Finish shared actor, body, clock, collision, movement, damage, inventory and target ownership. Keep map, gameplay, movement, character and presentation selections independent, including map-owned hazards.

**Done when:** A mixed-content session advances each actor once, uses one collision/body state and routes damage, inventory and targets through the same owners; changing one selection preserves the other selections.

### 2. Shared content, assets and provenance

Complete format and mod discovery, expansion dependencies, authored map databases, Quake 64 and observed IBSP44 support. Preserve asset provenance and overlay precedence.

**Done when:** Each supported product and mod resolves its required assets, start maps and dependencies through the common catalog with explicit missing-data errors. Accepted PKZ support and downloaded-package remounting remain in place.

### 3. Shared CPU and GL rendering

Complete the rendering feature union: effects, fog, shadows, transparency, view weapons, fonts and world text. Compare actual scenes on both renderers.

**Done when:** The same scene commands express the required features on CPU and GL, with source-grounded visual comparisons for the affected scenes. Accepted GIF playback is retained; bounded matching images do not imply universal renderer parity.

### 4. Common audio

Complete timing, streamed PCM, spatial sound, reverb, Doppler, music and pause behavior through the common mixer.

**Done when:** Authored sounds and streamed media preserve timing, routing and lifecycle across seats and content selections, including pause/resume and moving sources; audible fidelity and performance are checked separately.

### 5. Native client and server wire compatibility

Complete NQ 15/666/999, QuakeWorld, Q2 classic/enhanced/rerelease and Q3 in both directions: signon, snapshots, prediction, pure checks, authorization and teardown.

**Done when:** Actual native peers exercise all required NQ 15/666/999, QuakeWorld, Q2 classic/enhanced/rerelease and Q3 profiles in both directions, including signon, prediction, authorization, travel and disconnect. Missing required profiles remain open; explicit rejection is diagnostic only. Separate retail/private dialect limitations must not substitute for the required stock protocols.

### 6. Actual mod execution

Complete NetQuake and QuakeWorld QC hosts, QVM game/cgame/UI roles and TypeScript hosts for native DLL/SO behavior, including application admission, save and travel.

**Done when:** The required QC, QVM and native-mod behavior runs through normal application admission, execution, travel, save and teardown across every required host. A pinned-program whitelist is insufficient. Required programs or host combinations that remain unsupported keep this priority open; explicit failure only explains the limitation.

### 7. Swappable gameplay rosters and equipment

Complete expansion weapons, monsters, pickups, powerups and equipment. Support grapple weapon and offhand behavior, plus cooked grenades, independently of the selected match mode.

**Done when:** Each required encounter and item runs through shared gameplay services in its native world and every required cross-game combination, with authored behavior and independently selectable equipment.

### 8. Authored maps and campaigns

Complete map entities, mission trigger graphs, campaign transitions, hubs, backtracking and endings.

**Done when:** Actual authored maps complete their target chains and mission transitions, including revisits and endings, without replacing them with test-only triggers.

### 9. Complete saves and recovery

Complete mixed-world saves, source save formats, autosaves, recovery and the save/load UI.

**Done when:** All required mixed-world and player state survives actual save, close and reload, including campaign revisits and required QC state. Required source save formats and QC save support remain unfinished until implemented; version guards and explicit rejection do not complete them.

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

Complete per-wire extensions, filelists, queues, remounting, fallback, resume, redirects, policy and user feedback.

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

## Recent accepted work and new leads

These dispositions do not change the historical ledger or invent new requirement IDs.

| Lead or receipt | Disposition and remaining boundary |
| --- | --- |
| GIF images | Accepted in `e05343b`: actual installed image cases 17 tests / 139 assertions, plus media/world lifecycle 25 / 417. CPU/GL image agreement is bounded to the inspected samples. Keep this work; remaining renderer union is priority 3. |
| Extended cvar commands | Accepted in `7b7110e`, including Q1 custom-variable promotion. Keep these commands; broader configuration persistence remains priority 15. |
| HTTP ranges | Accepted in `8637652`: actual RemoteApplication downloaded and mounted the 1,991,612-byte PAK using one HEAD and four concurrent range GETs, with identical SHA and native WAL fallback. Focused cvar/range/HTTP checks passed 60 / 557. Resume, redirects and wider wire/UI work remain priority 14. |
| World text | In progress in shared text/presentation ownership; not accepted by this document. Priority 3. |
| Q1 VCR | Open source-inventory lead. Priority 22. |
| SOCKS5 | Open source-inventory lead. Priority 24. |
| Q3 event/config journals | Open source-inventory lead. Priority 22. |
| MOTD | Open source-inventory lead. Priority 24. |
| Local game prompts | Accepted in `d07700b`: actual application proof passed 25 assertions, with source review and CPU image inspection. Local UI pagination/lifecycle and the Q1 player lifecycle recursion correction are included. Private native remote prompt transport remains unsupported. Priority 17 retains that boundary. |

The seven newly identified source leads are GIF, extended cvar commands, world text, Q1 VCR, SOCKS5, Q3 journals and MOTD. HTTP ranges and local prompts are additional accepted receipts, not additional invented ledger entries. The installed executable remains source `3a073e8`; these newer source commits have not been rebuilt into it.

## Historical requirement appendix

The following **197 historical not-done requirements** come from cutoff `27c17a9e6bee1e6a50cec1479ef70d2a9d5c66e4`, with the ledger's unaffected verdicts carried from `a5fca3567968151261506707acfc392a5b95679e`. Every ID appears exactly once under its primary planning priority, with its original title. Cross-cutting work can depend on other priorities.

This is **not a current failure count**. Later accepted native clients, VM execution, downloads, GIFs, commands, prompts and other work can supersede parts of the old reasons. Consult the linked ledger for the historical reasons and paths, and the reconciliation/execution receipts for later acceptance. Inclusion here does not instruct an engineer to rebuild completed work. No fresh 477-row audit was performed.

### Priority 1: One authoritative simulation and composition — 4 historical requirements

- `q1.content.launch-selection` — Select gameplay separately from content and engine behavior
- `q1.physics.rerelease-gibs-corpses` — Rerelease gib and corpse collision semantics
- `q2.game.provider-selection` — Select base, expansion, CTF, LMCTF, and KEX game providers
- `q2.rerelease.q64-movement` — Match Q2 64 server movement and prediction

### Priority 2: Shared content, assets and provenance — 6 historical requirements

- `q1.content.quake64` — Identify and launch the required Quake 64 content
- `q2.content.discovered-addons` — Discover installed add-on directories
- `q2.content.start-map-discovery` — Resolve mapdb, maplist, and BSP start maps
- `q3.content.mod-selection` — Mod discovery, selection and return to base
- `q3.formats.ibsp44-compatibility` — Observed IBSP44 map compatibility
- `q3.content.demo-product-profiles` — Independent prerelease demo product restrictions

### Priority 3: Shared CPU and GL rendering — 7 historical requirements

- `q1.render.fog-sky-liquids` — Fog, skyboxes and liquid presentation
- `q1.render.model-effects-particles` — Model effects, particles, shadows and transparency
- `q1.video.mode-restart-capture` — Video modes, resize, fullscreen and renderer restart
- `q2.config.renderer-restart` — Restart or switch renderer within a live session
- `q3.presentation.fonts-and-glyphs` — Bitmap, proportional and Team Arena glyph fonts
- `q3.presentation.materials-cpu-gl` — Materials and complete CPU/GL rendering
- `q3.presentation.visual-options-restart` — Visual settings, display lifecycle and source hardware profiles

### Priority 4: Common audio — 5 historical requirements

- `q2.audio.raw-pcm` — Mix cinematic and streamed PCM
- `q2.music.pause-resume-gain` — Control music pause, resume, and continuous gain
- `q2.music.menu-shuffle` — Control menu music and playlist shuffle
- `q3.audio.background-music` — Background intro/loop music and continuous gain
- `q3.audio.raw-pcm-output-diagnostics` — Raw PCM, output formats and sound diagnostics

### Priority 5: Native client and server wire compatibility — 8 historical requirements

- `q1.network.nq-wire` — NetQuake protocols 15, 666 and 999
- `q1.network.qw-prediction` — QuakeWorld protocol and prediction
- `q1.network.native-session-negotiation` — Negotiate full native session identity
- `q1.network.retail-kex-boundary` — Separate documented Q1 wire compatibility from retail KEX claims
- `q2.network.classic-protocol` — Preserve stock protocol 34 behavior
- `q3.network.snapshots-prediction` — Snapshots, deltas and client prediction
- `q3.services.authorization-endpoints` — CD-key authorization and configurable service endpoints
- `q3.content.pure-policy` — Pure package checksums and filesystem selection

### Priority 6: Actual mod execution — 3 historical requirements

- `q1.execution.nq-qw-host-abi` — Keep NetQuake and QuakeWorld gamecode host contracts distinct
- `q1.execution.builtin-typescript-gameplay` — Run first-party Q1 gameplay in strict TypeScript
- `q3.execution.qvm-roles` — QVM game, cgame and UI execution

### Priority 7: Swappable gameplay rosters and equipment — 11 historical requirements

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

### Priority 8: Authored maps and campaigns — 4 historical requirements

- `q1.execution.entity-properties` — Preserve foreign entity classes, fields and target graphs
- `q2.content.native-starts` — Launch authored campaign starting maps
- `q2.campaign.unit-backtracking` — Restore revisited levels within a unit
- `q2.campaign.hub-endings` — Complete hubs, objectives, secrets, and endings

### Priority 9: Complete saves and recovery — 8 historical requirements

- `q1.ui.save-load-menus` — Save, load and autosave selection UI
- `q1.saves.classic-v5` — Classic version 5 save import and export
- `q1.saves.kex-v6` — KEX-style version 6 save compatibility
- `q1.saves.autosave` — Timed autosave and recovery
- `q2.save.eligibility-paths` — Enforce save eligibility and contained slot paths
- `q2.save.poi-health-story` — Restore objective and presentation state
- `q2.save.autosave-transition` — Distinguish autosaves from transition snapshots
- `q3.persistence.complete-world-save` — Complete unified world saves under Q3 gameplay

### Priority 10: Match rules and objectives — 12 historical requirements

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

### Priority 11: One shared bot and navigation system — 9 historical requirements

- `q1.bots.population` — Manual bots, autofill and eligibility
- `q1.bots.knowledge-skill` — Bot personalities, weapon/item knowledge and skill
- `q1.bots.combat-traversal` — Bot combat, swimming, jumps and monster interactions
- `q1.bots.ctf-coop-horde` — Bot objectives and campaign participation
- `q2.bots.combat-campaign-goals` — Execute bot combat and campaign decisions
- `q2.navigation.dynamic-obstacles` — Update routes for doors, lifts, hazards, and moving floors
- `q2.navigation.foreign-map-construction` — Construct navigation for maps without NAV2
- `q3.bots.aas-reachability-clustering` — AAS reachability, clustering, writing and optimization
- `q3.bots.foreign-map-construction` — Navigation construction for foreign maps and moving geometry

### Priority 12: Independent local and remote seats — 6 historical requirements

- `q1.seats.connections-lifecycle` — Two to four independent local player connections
- `q1.seats.presentation-ownership` — Resolve shared effects, audio, menus and recordings for seats
- `q1.seats.device-persistence` — Persistent per-player device and tuning assignments
- `q1.seats.qw-native-extension` — Local players with QuakeWorld gameplay and native networking
- `q2.seats.remote-network` — Use multiple local players on a remote server
- `q3.input.multiple-local-players` — Multiple local seats and remote participation

### Priority 13: Input and controller behavior — 5 historical requirements

- `q1.input.controller-tuning` — Controller deadzones, curves and per-seat settings UI
- `q2.input.controller-assignment` — Persist controller-to-player assignments
- `q2.input.per-player-tuning` — Tune controller axes independently
- `q2.input.binds-keyboard-mouse` — Bind keyboard and mouse gameplay controls
- `q3.input.joystick-profiles-hotplug` — Joystick profiles, thresholds and device lifecycle

### Priority 14: Common downloads — 7 historical requirements

- `q1.network.downloads` — QuakeWorld content download queues and policy
- `q2.download.path-policy` — Validate and contain content downloads
- `q2.download.http-queue` — Download content through concurrent HTTP queues
- `q2.download.filelists` — Expand validated server filelists
- `q2.download.mount-rescan` — Mount downloaded archives and rescan missing assets
- `q2.download.udp-fallback` — Fall back from HTTP to UDP transfer
- `q3.content.client-download-restart` — Client package download, contained writes and restart

### Priority 15: Console, cvars and profile persistence — 5 historical requirements

- `q1.config.commands-console` — Console scripts, aliases, history and completion
- `q1.config.persistence-migration` — Archived configuration and writable profile migration
- `q2.config.archived-state` — Persist binds and archived cvars
- `q3.configuration.console-scripts` — Console, history, completion and command scripts
- `q3.configuration.persistence-startup` — Archived cvars, bindings and startup configuration

### Priority 16: Unified setup and main menus — 10 historical requirements

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

### Priority 17: HUD and gameplay interaction — 18 historical requirements

- `q1.multiplayer.identity` — Player names, colors and setup
- `q1.ui.weapon-quickswitch` — Weapon-wheel data and quickswitch impulses
- `q1.ui.radial-weapon-wheel` — Rendered radial weapon selection
- `q1.ui.hud-inventory` — Classic, Hipnotic and Rogue HUD/inventory layouts
- `q1.events.prompts` — Localized prompts and choice impulses
- `q1.events.finale-acknowledgement` — Rerelease finale completion acknowledgement
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

### Priority 18: Server browser and administration — 19 historical requirements

- `q1.multiplayer.chat` — Public, team and private messages
- `q1.multiplayer.pause-kick-status` — Pause, kick, ping and player status
- `q1.network.hosting-lifecycle` — Listen and dedicated server lifecycle
- `q1.network.discovery` — Direct connect, LAN search and server browser
- `q1.network.admission-admin` — Passwords, spectators, rcon, filtering and flood control
- `q2.network.connectionless-rcon` — Process status, ping, challenges, and rcon
- `q2.browser.master-lan` — Discover servers from UDP, HTTP, and LAN sources
- `q2.browser.status-details` — Inspect server rules and player details
- `q2.browser.sort-filter` — Filter and sort server results
- `q2.browser.favorites` — Persist favorites and direct-connect addresses
- `q2.admin.operator-console` — Use dedicated-server stdin
- `q2.admin.status-kick` — Inspect clients and remove a player
- `q2.admin.masters-heartbeat` — Configure masters and heartbeat publication
- `q2.admin.spectator-chase` — Enter spectator mode and chase active players
- `q3.admin.permissions-cheats-passwords` — Password admission and developer command permissions
- `q3.admin.operator-rcon-filters` — Operator controls, rcon, filters and logging
- `q3.discovery.lan-global-favorites` — LAN, master lists and favorites
- `q3.discovery.ping-status-cache-filters` — Ping/status queues, filtering and persistent cache
- `q3.admin.pause-flood-inactivity` — Pause eligibility, command flood control and inactivity

### Priority 19: Cinematics and media — 7 historical requirements

- `q2.media.cin-video` — Decode and present classic CIN frames
- `q2.media.cin-soundtrack` — Synchronize the CIN soundtrack
- `q2.media.static-pcx` — Present static PCX intermission images
- `q2.media.pause-skip-transition` — Pause, skip, and finish cinematic transitions
- `q2.media.rerelease-formats` — Play required rerelease and expansion media formats
- `q3.media.cinematic-clock-transitions` — Cinematic timing, looping, hold and skip
- `q3.media.world-and-menu-video` — World material and menu cinematics

### Priority 20: Localization and accessibility — 10 historical requirements

- `q1.text.localization-overlays` — Localization, fallback and mod overlay precedence
- `q1.accessibility.contrast-color` — Contrast and color-accessibility settings
- `q1.accessibility.subtitles-captions` — Timed subtitles and sound captions
- `q2.accessibility.language-reload` — Reload mounted localization tables
- `q2.accessibility.contrast-typeface` — Choose contrast backgrounds and alternate typefaces
- `q2.accessibility.independent-scales` — Scale menus, HUD, and console independently
- `q2.accessibility.color-and-captions` — Complete readable non-color-only and caption workflows
- `q2.media.timed-subtitles` — Display timed cinematic subtitles and captions
- `q3.presentation.accessibility-scales` — Readable UI, independent scales and accessibility
- `q3.media.subtitles-captions` — Timed subtitles and captions for supplied media

### Priority 21: Progression and local service lifecycle — 11 historical requirements

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

### Priority 22: Recording and replay — 10 historical requirements

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

### Priority 23: Runtime capture and authoring tools — 7 historical requirements

- `q1.tools.chase-camera-diagnostics` — Runtime chase camera and diagnostic commands
- `q2.capture.screenshots` — Capture the active CPU and GL scene
- `q3.recording.screenshots-levelshots` — Screenshots, levelshots and capture timing
- `q3.diagnostics.runtime-tools` — Runtime diagnostic and developer commands
- `q3.diagnostics.omnitimer` — OmniTimer initialization, stamps and reporting
- `q3.cameras.spline-runtime` — Spline camera evaluation and timed camera events
- `q3.source-applications.role-accounting` — Separate authoring and distribution application roles

### Priority 24: External and historical services — 5 historical requirements

- `q1.services.addon-discovery` — Local and online add-on browsing
- `q3.network.ipx-transport` — Historical IPX transport obligation
- `q3.services.rankings-lifecycle` — Ranking login, match lifecycle and submission
- `q3.input.midi-controller` — MIDI note input and device configuration
- `q3.audio.a3d-geometry-contract` — Legacy A3D geometry behavior account

### Priority 25: Sustained play, fidelity and performance — 0 historical requirements

No historical not-done row is assigned primarily here; the scope comes from the common-engine plan and source-inventory leads.


### Priority 26: Later hardening and release work — 0 historical requirements

No historical not-done row is assigned primarily here; the scope comes from the common-engine plan and source-inventory leads.
