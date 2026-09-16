# Retained remaining requirements by function

Retained assessment cutoff: `167bfbf19d06625ac2b350120647686e3e0170e9`. Input: `docs/completion-status.json`, SHA-256 `0aff45642441dff7ffd9010566d39e89a0a32e74bf922215822efd0c4b159231`. Mechanical grouping of retained open implementation verdicts. No verdict changes or later-acceptance reconciliation. Primary functional placements do not assign common-engine versus source-extension architecture. Secondary dependencies are reported separately and never counted as additional rows. Input provenance is identified by path, assessment cutoff and SHA-256; no repository revision is inferred from an arbitrary input file.

Every original ID, title, reason and source family is preserved below. The JSON additionally preserves basis and source paths.

| Function | Q1 | Q2 | Q3 | Total |
|---|---:|---:|---:|---:|
| content-assets | 2 | 1 | 3 | 6 |
| rendering | 3 | 2 | 2 | 7 |
| audio-music | 0 | 4 | 3 | 7 |
| input-seats | 4 | 3 | 3 | 10 |
| console-config | 2 | 1 | 2 | 5 |
| networking | 6 | 1 | 3 | 10 |
| downloads | 1 | 0 | 0 | 1 |
| server-browser-admin | 5 | 10 | 5 | 20 |
| mods-vms | 3 | 1 | 2 | 6 |
| movement-bodies | 1 | 1 | 0 | 2 |
| ai-navigation | 4 | 3 | 2 | 9 |
| combat-rosters-equipment | 4 | 7 | 0 | 11 |
| maps-campaigns | 1 | 4 | 0 | 5 |
| modes-objectives | 3 | 6 | 2 | 11 |
| saves-recovery | 3 | 3 | 1 | 7 |
| menus-hud | 6 | 12 | 6 | 24 |
| localization-accessibility | 3 | 4 | 3 | 10 |
| progression-services | 2 | 2 | 7 | 11 |
| demos-recording | 2 | 6 | 2 | 10 |
| cinematics-media | 0 | 4 | 2 | 6 |
| tools-diagnostics | 1 | 0 | 5 | 6 |
| **Total** | **56** | **75** | **53** | **184** |

## Secondary dependencies

Each listed requirement still occurs only once in the inventory. These are explicit secondary dependencies after the primary classification decision, not additional work items.

| ID | Assigned function | Secondary dependencies | Classification note |
|---|---|---|---|
| `q1.bots.ctf-coop-horde` | ai-navigation | modes-objectives | Bot participation requires mode-specific objective policies; its primary behavior is AI. |
| `q1.content.launch-selection` | mods-vms | content-assets, menus-hud | Provider/gamecode selection spans discovery and launch UI; assigned once to execution selection. |
| `q1.ctf.grapple-observer-vote` | modes-objectives | combat-rosters-equipment, server-browser-admin | One retained row combines grapple, observer and voting requirements; it is not split or duplicated. |
| `q1.events.level-completed-lobby` | progression-services | maps-campaigns | Level completion and lobby return share one row; assigned to external/session lifecycle. |
| `q1.events.prompts` | menus-hud | localization-accessibility | Choice prompts include localized text; assigned to the interactive prompt workflow. |
| `q1.execution.entity-properties` | maps-campaigns | mods-vms, combat-rosters-equipment | Foreign entity fields and target graphs span adapters and roster admission; assigned to authored map behavior. |
| `q1.multiplayer.chat` | networking | menus-hud | Message routing and presentation coexist; assigned to communication behavior. |
| `q1.multiplayer.setup` | server-browser-admin | menus-hud, modes-objectives | Match configuration includes a public setup workflow; assigned to hosting administration. |
| `q1.network.admission-admin` | server-browser-admin | networking | Admission wire behavior and operator policy share one row; assigned to administration. |
| `q1.seats.presentation-ownership` | input-seats | rendering, audio-music, demos-recording, menus-hud | The row explicitly crosses presentation services; its single organizing behavior is seat ownership. |
| `q1.seats.qw-native-extension` | input-seats | networking | Local seat ownership crosses native wire limits; assigned once to seats. |
| `q1.services.addon-discovery` | content-assets | progression-services, menus-hud | Local/online add-on discovery includes service/UI joins; assigned to content discovery. |
| `q2.config.audio-video-input-menus` | menus-hud | console-config, audio-music, rendering, input-seats | One row covers settings across several services; assigned to the public menu workflow. |
| `q2.content.rotation-editor` | server-browser-admin | maps-campaigns, menus-hud | Persisted rotation editing is assigned to server administration. |
| `q2.content.server-map-lists` | server-browser-admin | maps-campaigns, modes-objectives | Map eligibility and selection are assigned to server setup. |
| `q2.content.start-map-discovery` | maps-campaigns | content-assets | Map metadata discovery serves campaign-start resolution. |
| `q2.media.cin-soundtrack` | audio-music | cinematics-media | CIN synchronization remains a cross-media dependency; this row is assigned to its soundtrack behavior. |
| `q2.media.timed-subtitles` | localization-accessibility | cinematics-media | Cinematic scheduling is required, but the visible behavior is subtitles/captions. |
| `q2.network.connectionless-rcon` | server-browser-admin | networking | Connectionless packet support serves status/ping/challenge/rcon administration. |
| `q3.cameras.spline-runtime` | tools-diagnostics | rendering | Spline evaluation and timed camera tooling depend on rendered camera presentation. |
| `q3.content.pure-policy` | networking | content-assets, mods-vms | Pure-policy enforcement belongs to network admission, using package and mod/filesystem identity. |
| `q3.media.subtitles-captions` | localization-accessibility | cinematics-media | Timed media dependency retained; assigned to caption behavior. |
| `q3.presentation.fonts-and-glyphs` | localization-accessibility | rendering | Glyph rendering and legibility share this font requirement. |
| `q3.progression.catalog` | content-assets | progression-services | Arena/bot catalog discovery supports progression but is a content inventory behavior. |
| `q3.progression.podium-postgame` | menus-hud | progression-services, modes-objectives | Postgame display/navigation crosses match progression; assigned to its public presentation workflow. |
| `q3.recording.screenshots-levelshots` | tools-diagnostics | rendering | Screenshot and levelshot capture belongs to tools, with rendered output and frame timing dependencies. |
| `q3.ui.base-demos-cinematics-configs` | menus-hud | demos-recording, cinematics-media, console-config | Retained row explicitly requires menus over multiple services. |
| `q3.ui.base-host-browser-ingame` | menus-hud | server-browser-admin | Host/browser behavior is represented here by its UI row; no backend row is duplicated. |
| `q3.ui.team-arena-skirmish` | menus-hud | modes-objectives, progression-services | Skirmish launch/next-match flow is a UI entry point with mode dependencies. |

## content-assets — 6 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.content.quake64` | Q1 | Identify and launch the required Quake 64 content | Quake64 remains explicitly unresolved: no identified content/dependency/program and complete launch path. |
| `q1.services.addon-discovery` | Q1 | Local and online add-on browsing | Local catalog discovery is implemented, but add-on install/update/remove with progress/error feedback and complete launch management is absent. |
| `q2.content.discovered-addons` | Q2 | Discover installed add-on directories | Installed source/data discovery does not provide executable gameplay for arbitrary Q2 add-ons; runtime dispatch only admits known Q2 programs. |
| `q3.content.demo-product-profiles` | Q3 | Independent prerelease demo product restrictions | Demo-product-specific restrictions and profile/UI behavior are not joined; actual network admission currently sets demoRestricted to false. |
| `q3.formats.ibsp44-compatibility` | Q3 | Observed IBSP44 map compatibility | The Q3 BSP decoder explicitly accepts version 46; the required IBSP44 compatibility path is missing. |
| `q3.progression.catalog` | Q3 | Arena and bot catalogs | Bot catalog loading is joined, but the tier-classified arena selection and authored-opponent launch workflow is not implemented in the common frontend. |

## rendering — 7 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.render.fog-sky-liquids` | Q1 | Fog, skyboxes and liquid presentation | Q1 addon fog events are emitted as q1-composition events but have no application fog consumer; complete server/map fog transitions therefore remain missing. |
| `q1.render.model-effects-particles` | Q1 | Model effects, particles, shadows and transparency | Q1 native presentation projection does not publish raw actor alpha/scale, and complete Q1 shadow/rerelease effect-bit consumers are not joined; particles and beams alone do not complete this row. |
| `q1.video.mode-restart-capture` | Q1 | Video modes, resize, fullscreen and renderer restart | Startup renderer/gamma/resolution choices exist, but changing/restarting the renderer in a live session while retaining input/state is not implemented as a complete application workflow. |
| `q2.config.renderer-restart` | Q2 | Restart or switch renderer within a live session | Startup can recreate display and in-game resizing is supported, but live-session CPU/GL renderer switching with complete world/input/HUD rebuild is not provided. |
| `q2.world.flashlight` | Q2 | Toggle the rerelease flashlight under every host profile | Rerelease player state emits/restores flashlight events, but no application event consumer produces the requested flashlight light/sound. |
| `q3.presentation.materials-cpu-gl` | Q3 | Materials and complete CPU/GL rendering | CPU/GL implement ordinary animated stages, deformation, fog, sky, portals, lighting, shadows and particles. The compound authored-material requirement is incomplete because the actual application shader registry supplies no cinematic provider, so videoMap material stages remain unresolved. |
| `q3.presentation.visual-options-restart` | Q3 | Visual settings, display lifecycle and source hardware profiles | Common graphics options exist, but the complete source hardware-profile/renderer-thread and live restart lifecycle is not joined; Q3 client presentation still receives a generic hardware profile. |

## audio-music — 7 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q2.audio.raw-pcm` | Q2 | Mix cinematic and streamed PCM | The common stream mixer works, but the Q2 cinematic soundtrack producer is not joined to application playback; complete cinematic/streamed workflow is not supplied. |
| `q2.media.cin-soundtrack` | Q2 | Synchronize the CIN soundtrack | Shared media decoders exist, but Q2 campaign/remote cinematic presentation and authored continuation are not joined; the only application cinematic owner is Q3 UI RoQ playback, with no Q2 timed subtitle producer. |
| `q2.music.menu-shuffle` | Q2 | Control menu music and playlist shuffle | Startup does not own a menu-music playlist/shuffle service or persisted shuffle selection. |
| `q2.music.pause-resume-gain` | Q2 | Control music pause, resume, and continuous gain | Continuous gain is joined and the music object can pause, but ApplicationAudio.pauseMusic has no application command/menu caller for the requested pause/resume workflow. |
| `q3.audio.a3d-geometry-contract` | Q3 | Legacy A3D geometry behavior account | The common replacement samples room size/materials for reverb and underwater filtering, but it does not implement per-source geometry occlusion/obstruction required by the legacy A3D spatial contract. This is an implementation gap, independent of audible qualification. |
| `q3.audio.background-music` | Q3 | Background intro/loop music and continuous gain | Actual world/cgame music supports intro/loop, pause, gain and replacement, but the specified menu/postgame music transitions are not joined with those missing product flows. |
| `q3.audio.raw-pcm-output-diagnostics` | Q3 | Raw PCM, output formats and sound diagnostics | PCM ingestion/conversion and application soundinfo/soundlist/play diagnostics are connected. Accepted 0065d73b joins named/default device selection, persisted gains and device restart while retaining queued PCM timing and music. Output remains fixed at 44100 Hz, stereo, 16-bit; selectable output bits/channels/rate and the full source restart/cache workflow remain unqualified. Dummy SDL checks do not qualify physical buffering or audibility. |

## input-seats — 10 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.input.controller-tuning` | Q1 | Controller deadzones, curves and per-seat settings UI | Accepted 36f395ee joins per-seat controller/mouse tuning persistence and reconnect/device-profile fallback. Full per-seat preview and the complete exposed outer-threshold control workflow remain unqualified; persistent application settings are no longer the missing join. |
| `q1.seats.connections-lifecycle` | Q1 | Two to four independent local player connections | Actor/client disconnect and generation reuse work, but local-seat drop currently quits the application and dynamic local join/drop presentation is incomplete. |
| `q1.seats.presentation-ownership` | Q1 | Resolve shared effects, audio, menus and recordings for seats | Effects, listeners and modal input have seat ownership, but recorded-view ownership has no application demo record/playback consumer. |
| `q1.seats.qw-native-extension` | Q1 | Local players with QuakeWorld gameplay and native networking | Accepted 66e6136 supplies a single-seat native QW remote session; 88f84c10 adds dedicated base-protocol-28 hosting. Local graphical QW hosting, split-screen transport extensions and independent multi-seat prediction remain open. |
| `q2.input.binds-keyboard-mouse` | Q2 | Bind keyboard and mouse gameplay controls | Runtime seat routing/tuning/bindings work, but ConfigStore seat/device persistence is not connected to ApplicationInput startup/shutdown; the required restart persistence is unfinished. |
| `q2.input.per-player-tuning` | Q2 | Tune controller axes independently | Runtime seat routing/tuning/bindings work, but ConfigStore seat/device persistence is not connected to ApplicationInput startup/shutdown; the required restart persistence is unfinished. |
| `q2.seats.remote-network` | Q2 | Use multiple local players on a remote server | The native Q2 remote adapter explicitly permits one player per connection; application multi-seat remote admission/prediction is not implemented. |
| `q3.input.joystick-profiles-hotplug` | Q3 | Joystick profiles, thresholds and device lifecycle | SDL controller routing works, but SourceInputState and its Linux/Windows legacy joystick/POV/ball profiles have no application caller. |
| `q3.input.midi-controller` | Q3 | MIDI note input and device configuration | MIDI decoding/device helpers exist without an application-owned MIDI input lifecycle or selected-device configuration. |
| `q3.input.multiple-local-players` | Q3 | Multiple local seats and remote participation | Multiple local seats have independent input/view/audio state, but local seats joining a remote Q3 match are not supported by the current Q2-only remote application. |

## console-config — 5 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.config.commands-console` | Q1 | Console scripts, aliases, history and completion | Command buffering/aliases/exec/wait and console editing are connected. Accepted fc0c15e joins application writeconfig through src/app/bootstrap/capture.ts and src/console/commands.ts, and 36f395ee persists custom bindings across device remaps and restarts. Complete NQ/QW script, history/completion and profile-correct dispatch workflows remain unqualified. |
| `q1.config.persistence-migration` | Q1 | Archived configuration and writable profile migration | Config serialization exists, but complete application archived/per-seat setting writes and old home/per-game migration are not connected. |
| `q2.config.archived-state` | Q2 | Persist binds and archived cvars | ConfigStore can persist binds/cvars, but native application startup/shutdown does not load/save that store for active Q2 seats/profile. |
| `q3.configuration.console-scripts` | Q3 | Console, history, completion and command scripts | Console editing/history, quoting and vstr/wait/echo are joined, but neither application Q3 CommandBuffer supplies readScript; exec therefore reports failure rather than reading the requested mounted script. |
| `q3.configuration.persistence-startup` | Q3 | Archived cvars, bindings and startup configuration | Frontend preferences persist and source cvars survive map changes, but archived source cvar/binding configuration, explicit writeconfig and product/profile startup migration are not fully joined. |

## networking — 10 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.multiplayer.chat` | Q1 | Public, team and private messages | Application explicitly rejects selected Q1 chat commands; team chat/private tell and their local/remote UI routing are unfinished. |
| `q1.network.hosting-lifecycle` | Q1 | Listen and dedicated server lifecycle | Native NQ listen/dedicated hosting and accepted 88f84c10 dedicated base-QW protocol-28 hosting are connected, including donor-client movement, firing and travel. Local graphical QW hosting/joins and the complete interactive dedicated-console/operator workflow remain open; command work after this cutoff is excluded. |
| `q1.network.native-session-negotiation` | Q1 | Negotiate full native session identity | Application native negotiation does not exchange the complete independent gameplay/content/clock/inventory/seat capability schema across Q1 sessions. |
| `q1.network.nq-wire` | Q1 | NetQuake protocols 15, 666 and 999 | Accepted 5a0e1848 joins classic id1 host protocol selection and shared-client negotiation of NQ 15/666/999, explicit capacity limits, alpha/scale, movement, travel and svc_version codec flags. Root passed 9 tests/209 assertions, independent donor servers exercised all three protocols with authoritative movement, and entity updates inside actual UDP payloads matched donor codecs at 9/15/21 bytes. Rerelease/expansion/mod admission, private extensions, static visual-field production, nondefault lerpfinish and full bidirectional native-peer qualification remain open. |
| `q1.network.qw-prediction` | Q1 | QuakeWorld protocol and prediction | Accepted 66e6136 joins native protocol-28 remote admission and shared presentation/prediction; 88f84c10 adds dedicated native QW hosting. An independent donor client exercised authoritative movement, firing and travel. Protocol 29, negotiated extensions, spectator support, other-player two-pass/fractional prediction and full effects remain open. |
| `q1.network.retail-kex-boundary` | Q1 | Separate documented Q1 wire compatibility from retail KEX claims | Retail service interoperability is explicitly bounded, but required native replacement service workflows are not complete. |
| `q2.network.classic-protocol` | Q2 | Preserve stock protocol 34 behavior | Stock protocol framing/snapshots/commands are joined, but the stated complete protocol workflow includes downloads, which native Q2 application transfer does not implement. |
| `q3.content.pure-policy` | Q3 | Pure package checksums and filesystem selection | Server checksum/feed and cp proof verification are joined, and generic pure mount ordering exists; Q3 client-side search-path reset/reordering and proof construction are not joined to a remote application. |
| `q3.network.ipx-transport` | Q3 | Historical IPX transport obligation | No IPX transport is joined to the current application; the UDP/loopback service does not supply the required IPX behavior. |
| `q3.network.snapshots-prediction` | Q3 | Snapshots, deltas and client prediction | The server snapshot path and local-seat prediction run; a Q3 remote-client application path that consumes network snapshots and owns prediction/recovery is not joined. |

## downloads — 1 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.network.downloads` | Q1 | QuakeWorld content download queues and policy | Accepted 66e6136 joins QW sound/model transfer queues and contained admission; 066ab042 adds application skin transfer/display, including an independently verified exact 913-byte skin. Scope remains base qw/id1. Arbitrary mod gamedir admission and application server-host per-category denial policy remain unjoined; complete allowed/denied map/model/sound/skin workflows are not established. |

## server-browser-admin — 20 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.multiplayer.identity` | Q1 | Player names, colors and setup | Accepted 066ab042 joins saved pre-connect QW name/skin/colors/rate and live color updates with custom-skin display; 0c0499c3 retains indexed MDL colors and proper PCX source cropping. Accepted a8f9e2f forwards local Q1 source colors through two-seat update/save/load. Editable local Q1 setup/color console and cross-source appearance ownership remain unjoined, so the required setup/console and independent-seat identity workflow is incomplete. |
| `q1.multiplayer.pause-kick-status` | Q1 | Pause, kick, ping and player status | Kick handling exists, but the complete Q1 authorized pause/ping/status command and operator feedback workflow is not joined. |
| `q1.multiplayer.setup` | Q1 | Configure and launch multiplayer matches | Startup exposes only singleplayer/coop/deathmatch and lacks the complete Q1 CTF/Horde/Rogue team/protocol setup controls. |
| `q1.network.admission-admin` | Q1 | Passwords, spectators, rcon, filtering and flood control | Native Q1 application networking lacks the full player/spectator/password/rcon/IP-filter/flood-protection operator workflow. |
| `q1.network.discovery` | Q1 | Direct connect, LAN search and server browser | Direct NQ transport is connected, but complete LAN/master discovery and a usable server-browser workflow are not application features. |
| `q2.admin.masters-heartbeat` | Q2 | Configure masters and heartbeat publication | The live Q2 server adapter does not schedule master registration/heartbeat publication or expose master configuration. |
| `q2.admin.player-identity` | Q2 | Configure player names, skins, handedness, and view settings | Source userinfo parsing and remote updates exist, but local per-participant name/skin/hand/FOV configuration is not fully bound to active application settings. |
| `q2.admin.spectator-chase` | Q2 | Enter spectator mode and chase active players | Source chase movement and target selection run, but primaryUi reads the spectator own combat/inventory rather than the chased player; required borrowed HUD statistics are not joined. |
| `q2.admin.status-kick` | Q2 | Inspect clients and remove a player | Accepted e06b6ee joins local dedicated status, dumpuser and selected-player kick for classic and rerelease Q2. Complete native transport status columns, UDP kick-reason delivery and required wire/profile qualification remain open. |
| `q2.browser.master-lan` | Q2 | Discover servers from UDP, HTTP, and LAN sources | ServerBrowser discovery/state utilities are not constructed by the startup application, which lacks the required browser/favorite/status UI workflow. |
| `q2.browser.sort-filter` | Q2 | Filter and sort server results | ServerBrowser discovery/state utilities are not constructed by the startup application, which lacks the required browser/favorite/status UI workflow. |
| `q2.browser.status-details` | Q2 | Inspect server rules and player details | ServerBrowser discovery/state utilities are not constructed by the startup application, which lacks the required browser/favorite/status UI workflow. |
| `q2.content.rotation-editor` | Q2 | Edit and persist ordered map rotations | LMCTF reads its maplist, but startup has no ordered rotation editor with persisted membership/shuffle and module-specific launch routing. |
| `q2.content.server-map-lists` | Q2 | Choose maps and inspect mode eligibility | Startup lists selected-product maps, but full Q2 spawn/objective-based mode eligibility filtering and authored map titles are not established by those choices. |
| `q2.network.connectionless-rcon` | Q2 | Process status, ping, challenges, and rcon | The application Q2 connectionless switch handles challenge/ping/connect, but does not implement the required status and authorized rcon execution/reply path. |
| `q3.admin.operator-rcon-filters` | Q3 | Operator controls, rcon, filters and logging | Map/restart/kick and game-side filters exist, but the application Q3 endpoint does not join the complete authenticated rcon/operator diagnostics and logging service. |
| `q3.admin.pause-flood-inactivity` | Q3 | Pause eligibility, command flood control and inactivity | Flood and inactivity policies run, but the application does not join source pause eligibility and paused Q3 server-frame handling required by this compound row. |
| `q3.admin.permissions-cheats-passwords` | Q3 | Password admission and developer command permissions | Password and ordinary cheat policies are joined, but the compound requirement includes the actual levelshot command; its shared capture registration is not called by the application. |
| `q3.discovery.lan-global-favorites` | Q3 | LAN, master lists and favorites | Discovery protocol helpers exist, but LAN/global/favorites listing and refresh are not joined to an application browser. |
| `q3.discovery.ping-status-cache-filters` | Q3 | Ping/status queues, filtering and persistent cache | Ping/status helpers are not connected to the required browser cache, filters, sorting and refresh lifecycle. |

## mods-vms — 6 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.content.launch-selection` | Q1 | Select gameplay separately from content and engine behavior | Launch selection cannot independently choose arbitrary Q1 campaign gamecode on another campaign map; selected foreign Q1 arsenals remain id1-only. |
| `q1.execution.builtin-typescript-gameplay` | Q1 | Run first-party Q1 gameplay in strict TypeScript | Official TypeScript composition exists, but the stated optional external-mod execution is not complete: only pinned id1 QC admission is available and arbitrary programs remain rejected. |
| `q1.execution.nq-qw-host-abi` | Q1 | Keep NetQuake and QuakeWorld gamecode host contracts distinct | Accepted 60bbc638 joins the pinned native QW program through the shared QuakeCSource owner, preserving distinct NQ/QW layouts, callbacks and shared damage authority; NQ retention checks passed. Admission remains restricted to verified programs. The requirement’s external-mod workflow, broader product ABI coverage and QW spectator callbacks remain unqualified. |
| `q2.game.provider-selection` | Q2 | Select base, expansion, CTF, LMCTF, and KEX game providers | Known base/expansion/CTF/LMCTF/RR programs have real dispatch, but unknown native Q2 modules still lack executable guest application integration; rejecting them does not supply that component. |
| `q3.content.mod-selection` | Q3 | Mod discovery, selection and return to base | Installed product selection is available, but arbitrary Q3 fs_game mod selection, restart and role/content reloading are not an implemented application workflow. |
| `q3.execution.qvm-roles` | Q3 | QVM game, cgame and UI execution | QVM parsing/interpreting exists, but application game/cgame/UI roles execute native TypeScript controllers; loading and running the required bytecode roles is not joined. |

## movement-bodies — 2 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.physics.rerelease-gibs-corpses` | Q1 | Rerelease gib and corpse collision semantics | Accepted 98074c6 corrects native authored soldier/dog gib and head construction through existing helpers in source order; root passed 14 tests/301 assertions and actual rerelease head flight/persistence plus gib gravity/bounce/removal. Complete independently selected rerelease corpse-extension collision semantics remain unestablished. |
| `q2.rerelease.q64-movement` | Q2 | Match Q2 64 server movement and prediction | Accepted 3176aee joins selected Q2 movement profiles and source-announced server configuration, including actual authored bio/base travel; root passed 1 test/68 assertions. Rerelease remote-client admission and matching native prediction remain unsupported, so full Q2 64 server/client movement compatibility is not established. |

## ai-navigation — 9 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.bots.combat-traversal` | Q1 | Bot combat, swimming, jumps and monster interactions | Shared bots execute real movement and attacks, but Q1 admission rejects campaign play, leaving the required campaign-monster combat/traversal workflow unjoined. |
| `q1.bots.ctf-coop-horde` | Q1 | Bot objectives and campaign participation | botAdmissionError explicitly rejects Q1 team and campaign objectives, including CTF, coop and Horde. |
| `q1.bots.knowledge-skill` | Q1 | Bot personalities, weapon/item knowledge and skill | Q1 maps currently load q3-baseq3 bot definitions in createBots rather than the active Q1 retail characters/knowledge/chats/team files. |
| `q1.bots.population` | Q1 | Manual bots, autofill and eligibility | Shared bot population is connected only for standard deathmatch on Q1 id1 and uses Q3 bot definitions; required native Q1 personality and broader mode population workflow remains unfinished. |
| `q2.bots.combat-campaign-goals` | Q2 | Execute bot combat and campaign decisions | Shared bots provide combat/item/movement decisions, but complete Q2 authored campaign objective solving is not established; the rerelease guidance hook still reports no-navigation. |
| `q2.navigation.dynamic-obstacles` | Q2 | Update routes for doors, lifts, hazards, and moving floors | Accepted a5fca35 supplies live enabled, locked, destination and hazard observations to shared route validation. Unsupported mover travel is still rejected, so complete dynamic route execution remains unfinished. |
| `q2.navigation.foreign-map-construction` | Q2 | Construct navigation for maps without NAV2 | Constructed graphs drive real foreign-map movement, combat and item access, but admitted shared bots exclude campaign/team objective play. The stated objective navigation component is not completed by the current application join. |
| `q3.bots.aas-reachability-clustering` | Q3 | AAS reachability, clustering, writing and optimization | Runtime AAS routing and generated common graphs exist; the distinct source AAS reachability/cluster generation, optimized AAS writer and read-back operation are not joined. |
| `q3.bots.foreign-map-construction` | Q3 | Navigation construction for foreign maps and moving geometry | Foreign-map navigation construction supports ordinary play, but the application explicitly rejects foreign-map campaign/team objective bot policies; the complete required objective adaptation is missing. |

## combat-rosters-equipment — 11 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.hipnotic.monster-armagon` | Q1 | Hipnotic armagon encounter | Native mission-pack actor behavior is registered, but the requirement also specifies foreign-map integration; the selectable Q1 monster catalog exposes only id1 ordinary species. |
| `q1.hipnotic.monster-gremlin` | Q1 | Hipnotic gremlin encounter | Native mission-pack actor behavior is registered, but the requirement also specifies foreign-map integration; the selectable Q1 monster catalog exposes only id1 ordinary species. |
| `q1.hipnotic.monster-scourge` | Q1 | Hipnotic scourge encounter | Native mission-pack actor behavior is registered, but the requirement also specifies foreign-map integration; the selectable Q1 monster catalog exposes only id1 ordinary species. |
| `q1.mg3.lavasuit` | Q1 | Dawn of the Machine lava suit | item_artifact_lavasuit and its timed environmental immunity are absent from native MG3 pickup/player registration; the ordinary biosuit is not equivalent. |
| `q2.inventory.power-armor` | Q2 | Toggle power armor and consume cells on protection | Shared screen/shield absorption, facing and cell accounting are joined, but the common Q2 HUD does not expose the required active power-armor indicator. |
| `q2.powerup.invulnerability` | Q2 | Activate and expire invulnerability | Protection, source damage flags and expiry run; the current common HUD omits the required invulnerability timer. |
| `q2.powerup.quad` | Q2 | Activate and extend quad damage | Source multiplier, durations, warning/drop behavior run, but the required active quad HUD timer is not populated by ApplicationSeatUi. |
| `q2.rerelease.guardian` | Q2 | Complete the guardian encounter | Boss source attacks/phases/death run, but authored healthbar events are not consumed by the application HUD. |
| `q2.rerelease.instanced-items` | Q2 | Use coop item instancing | Per-player pickup eligibility and checkpoint data exist, but emitted item-visibility events have no application per-seat visibility consumer. |
| `q2.rogue.double-damage` | Q2 | Activate double damage | Damage multiplier and source expiration/warnings run, but the required active HUD timer is absent. |
| `q2.xatrix.quadfire` | Q2 | Activate quad fire | The source cadence modifier and expiry are integrated; the required active HUD timer is absent from the common player HUD. |

## maps-campaigns — 5 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.execution.entity-properties` | Q1 | Preserve foreign entity classes, fields and target graphs | Selected foreign creature admission covers bounded source rosters and rejects unsupported class/placement combinations; every required foreign expansion entity adapter is not provided. |
| `q2.campaign.hub-endings` | Q2 | Complete hubs, objectives, secrets, and endings | Mission gates/targets run, but complete authored intermission/help statistics and Q2 cinematic ending/nextserver presentation are not joined. |
| `q2.campaign.unit-backtracking` | Q2 | Restore revisited levels within a unit | World travel constructs a fresh simulation and carries player/campaign state; there is no visited-level world checkpoint cache restoring killed monsters/movers/pickups on return. |
| `q2.content.native-starts` | Q2 | Launch authored campaign starting maps | Catalog start maps and skill are wired, but authored mapdb start-item/unit metadata is not loaded by the current catalog/application path. |
| `q2.content.start-map-discovery` | Q2 | Resolve mapdb, maplist, and BSP start maps | Current launch catalog has fixed product starts and BSP map discovery; no shared mapdb parser/caller preserves authored unit order and start items. |

## modes-objectives — 11 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.ctf.capture-loop` | Q1 | Rerelease CTF capture, return, drop and scoring | CTF source capture/drop/return logic is installed, but its q1-composition ctf-status/capture events have no application HUD consumer. |
| `q1.ctf.grapple-observer-vote` | Q1 | Rerelease CTF grappling, observers and exit vote | Grapple and observer/vote source callbacks exist, but Q1 targeted prompt/choice events are not consumed by the application UI, leaving the complete observer/vote workflow unfinished. |
| `q1.horde.launch-waves` | Q1 | Horde launch, wave spawning and survivor progression | Native MG1 horde maps can schedule waves, but runtime omits the horde cvar so the manager cannot enable horde-dependent lifecycle/travel; dedicated launch controls and campaign/team bot admission are also missing. |
| `q2.mode.deathball` | Q2 | Play rerelease DeathBall | The source mode module exists, but application match construction selects only standard/CTF/LMCTF and startup exposes no actual Tag/DeathBall launch. |
| `q2.mode.deathmatch-limits` | Q2 | End a deathmatch on authored limits | Source rules exist, but native application construction supplies deathmatchFlags=0/default player rules and does not bind the complete requested limit/option settings to gameplay. |
| `q2.mode.dm-options` | Q2 | Apply classic deathmatch flags | Source rules exist, but native application construction supplies deathmatchFlags=0/default player rules and does not bind the complete requested limit/option settings to gameplay. |
| `q2.mode.rerelease-options` | Q2 | Apply rerelease deathmatch and weapon settings | Source rules exist, but native application construction supplies deathmatchFlags=0/default player rules and does not bind the complete requested limit/option settings to gameplay. |
| `q2.mode.tag` | Q2 | Play Rogue Tag | The source mode module exists, but application match construction selects only standard/CTF/LMCTF and startup exposes no actual Tag/DeathBall launch. |
| `q2.rerelease.squad-respawn-lives` | Q2 | Use squad respawn and cooperative lives | Rerelease source implements squad/lives state, but application construction does not bind selectable rerelease coop options; complete configured waiting/restart workflow is not established. |
| `q3.modes.foreign-objective-adaptation` | Q3 | Objective and spawn adaptation on foreign maps | Foreign-map ordinary movement/combat/bots work, but the application explicitly lacks complete objective-anchor/campaign adaptation for all Q3/TA modes on Q1/Q2 maps. |
| `q3.modes.single-player-arena` | Q3 | Single-player arena match flow | The game-side single-player mode runs, but arena launch, progression completion and return-to-selection flow are not joined. |

## saves-recovery — 7 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.saves.autosave` | Q1 | Timed autosave and recovery | Application consumes Q2 autosave events only; Q1 level-start/timed autosave scheduling and its multiplayer/seat policy are not joined. |
| `q1.saves.classic-v5` | Q1 | Classic version 5 save import and export | Classic save syntax exists, but application save/load is native SaveImage and does not import/export complete classic VM globals/edicts/callbacks; QC saved games remain rejected. |
| `q1.saves.kex-v6` | Q1 | KEX-style version 6 save compatibility | KEX container parsing is not an application retail-save import/export path; complete original fixture compatibility is not established. |
| `q2.save.autosave-transition` | Q2 | Distinguish autosaves from transition snapshots | Autosave events call the common saveGame path, but the full source distinction between transition snapshots and autosave-specific client/field treatment is not implemented. |
| `q2.save.eligibility-paths` | Q2 | Enforce save eligibility and contained slot paths | Startup slots are contained, but the live save command accepts an arbitrary path and lacks the full source eligibility/reserved-current-state policy. |
| `q2.save.poi-health-story` | Q2 | Restore objective and presentation state | Source state is checkpointed and story redraws, but POI and healthbar application consumers are absent so those presentation components cannot resume visibly. |
| `q3.persistence.complete-world-save` | Q3 | Complete unified world saves under Q3 gameplay | Application/shared save still rejects complete Q3 world restoration; session carry does not save entities, missiles, timers, objectives and bot runtime state. |

## menus-hud — 24 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.events.prompts` | Q1 | Localized prompts and choice impulses | Source emits Q1 prompt/clear-prompt events, but Application.sourceActions and the seat UI do not construct/route those dialogs or selection impulses. |
| `q1.ui.hud-inventory` | Q1 | Classic, Hipnotic and Rogue HUD/inventory layouts | Common health/armor/ammo and expansion weapon metadata are displayed, but Q1 CTF status/capture events are ignored, leaving required source scoreboard/objective HUD state incomplete. |
| `q1.ui.options-and-reset` | Q1 | Complete options, binding and reset workflows | Current options cover a subset; language, sound rate, autosave, pickup switching, lookspring/lookstrafe and complete defaults controls are not all joined. |
| `q1.ui.radial-weapon-wheel` | Q1 | Rendered radial weapon selection | A working common radial selector is connected, but the required authored slot data is not: q1 wheel parsing/adaptation has no application caller and UI uses fixed source weapon-registration order. |
| `q1.ui.save-load-menus` | Q1 | Save, load and autosave selection UI | Startup lists native saves and console save/load works, but complete in-game manual save-slot/comments menus and Q1 autosave recovery are absent. |
| `q1.ui.weapon-quickswitch` | Q1 | Weapon-wheel data and quickswitch impulses | The common wheel selects source item IDs, but no application quickswitch/last-weapon eligibility path or authored Q1 wheel-slot/impulse cache adapter is connected. |
| `q2.config.audio-video-input-menus` | Q2 | Apply video, audio, and input settings | Accepted 0065d73b joins named/default audio-device selection and per-product device/effects/music persistence through ConfigStore; 36f395ee joins input assignment, tuning and binding persistence. Actual CPU/GL menu/restart and remote travel checks passed. The complete display/video settings and restart workflow remains unqualified. |
| `q2.hud.boss-health-bars` | Q2 | Display and clear authored boss health bars | Rerelease emits objective/healthbar state, but ApplicationRereleasePresentation does not consume those events; the navigation hook explicitly returns no-navigation. |
| `q2.hud.centerprints-notifications` | Q2 | Queue localized centerprints and notifications | Per-seat Unicode message drawing is joined, but Q2 application centerprints always use instant=true and do not carry required source typewriter/duration policy. |
| `q2.hud.compass-help-path` | Q2 | Draw the compass route to the active objective | Rerelease emits objective/healthbar state, but ApplicationRereleasePresentation does not consume those events; the navigation hook explicitly returns no-navigation. |
| `q2.hud.damage-feedback` | Q2 | Display damage direction and pickup feedback | Source damage blend/kick exists, but full directional HUD indicators and actual pickup icons/timers are not bound in ApplicationSeatUi. |
| `q2.hud.inventory` | Q2 | Open and use the inventory display | The common HUD draws vitals and active weapon status, but does not bind the full Q2 inventory/help/status-layout stream required by this workflow. |
| `q2.hud.poi-stages` | Q2 | Activate and advance objective markers | Rerelease emits objective/healthbar state, but ApplicationRereleasePresentation does not consume those events; the navigation hook explicitly returns no-navigation. |
| `q2.hud.powerup-wheel` | Q2 | Use powerups through the radial wheel | Powerup selection is wired, but required consumable/timer feedback is not populated in the common HUD. |
| `q2.hud.profile-selection` | Q2 | Select the correct classic or rerelease HUD | The common HUD draws vitals and active weapon status, but does not bind the full Q2 inventory/help/status-layout stream required by this workflow. |
| `q2.hud.score-help` | Q2 | Display scoreboards and the help computer | The common HUD draws vitals and active weapon status, but does not bind the full Q2 inventory/help/status-layout stream required by this workflow. |
| `q2.hud.weapon-carousel` | Q2 | Cycle weapons with the carousel | Carousel state exists in SeatWeaponWheel, but application input does not call its cycle path, so the source-style preview/confirmation workflow is unjoined. |
| `q2.hud.weapon-wheel` | Q2 | Select a weapon with the radial wheel | The actual radial wheel is joined to source selection, but ApplicationSeatUi still supplies icon:null for wheel items; required item icons are not finished. |
| `q3.progression.podium-postgame` | Q3 | Podium, postgame and next-match navigation | Native victory-pad entities exist; the ranked postgame UI, award sequence and progression return path remain unjoined. |
| `q3.ui.base-demos-cinematics-configs` | Q3 | Demo, movie and configuration menus | The application has no complete base demos/cinematics/config menu workflow; codec and console helpers alone do not provide these menus. |
| `q3.ui.base-host-browser-ingame` | Q3 | Base hosting, browser and in-game menus | Source commands support many match operations, but the required host/browser/in-game menu workflows are not implemented by the common frontend. |
| `q3.ui.base-settings` | Q3 | Base menus for player, controls and settings | Common settings provide usable controls, but the full base source settings/player-model/configuration menu workflow and apply/restart behavior are not joined. |
| `q3.ui.team-arena-scripts-feeders-visibility` | Q3 | Team Arena scripts, feeders and owner draws | The legacy menu engine and mission HUD are joined, but the complete Team Arena front-end scripts/feeders, server refresh and mod/media application services are not. |
| `q3.ui.team-arena-skirmish` | Q3 | Team Arena skirmish launch and next match | Team Arena skirmish selection, team/map/skill setup and its launch/return workflow are not joined to the frontend. |

## localization-accessibility — 10 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.accessibility.contrast-color` | Q1 | Contrast and color-accessibility settings | High-contrast/reduced-flash toggles exist, but alternate typeface/color-accessibility controls and persisted application preferences are incomplete. |
| `q1.accessibility.subtitles-captions` | Q1 | Timed subtitles and sound captions | CaptionTimeline has no application consumer; actual Q2 SRT resources also depend on currently unsupported OGV playback, and no authored Q1 sound-caption mapping was found. |
| `q1.text.localization-overlays` | Q1 | Localization, fallback and mod overlay precedence | Localization supports overlays/formatting, but application Q1 messages are drawn raw and the active language selector is not bound; finales currently load English only. |
| `q2.accessibility.color-and-captions` | Q2 | Complete readable non-color-only and caption workflows | Caption data/scheduler and HUD support exist but no application media-event producer supplies timed captions; the common HUD initializes captions empty. |
| `q2.accessibility.contrast-typeface` | Q2 | Choose contrast backgrounds and alternate typefaces | High-contrast controls exist, but complete alternate-typeface selection plus persisted preferences is not provided by the current application. |
| `q2.accessibility.independent-scales` | Q2 | Scale menus, HUD, and console independently | HUD/text scale controls exist, but independent menu/HUD/console scale ownership on every actual draw path is not fully wired. |
| `q2.media.timed-subtitles` | Q2 | Display timed cinematic subtitles and captions | Shared media decoders exist, but Q2 campaign/remote cinematic presentation and authored continuation are not joined; the only application cinematic owner is Q3 UI RoQ playback, with no Q2 timed subtitle producer. |
| `q3.media.subtitles-captions` | Q3 | Timed subtitles and captions for supplied media | Caption data/settings helpers are present, but a complete source subtitle/caption event-to-visible-timeline application path is not established. |
| `q3.presentation.accessibility-scales` | Q3 | Readable UI, independent scales and accessibility | Safe areas, HUD scaling and readable source fonts are implemented; the compound accessibility requirement including complete international text and caption presentation is not established in the actual application. |
| `q3.presentation.fonts-and-glyphs` | Q3 | Bitmap, proportional and Team Arena glyph fonts | Bitmap/proportional and DAT fonts are joined; the application constructs RendererFontRegistry without generation services, so the required configurable FreeType generation path remains unavailable. |

## progression-services — 11 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.events.achievements` | Q1 | Achievement persistence and player UI | Achievement events are emitted but there is no durable award store/provider identity or readable application achievement consumer. |
| `q1.events.level-completed-lobby` | Q1 | Level-completed events and return-to-lobby lifecycle | Source completion/return events have no durable progression plus host/join/leave/start lobby lifecycle consumer. |
| `q2.service.achievements` | Q2 | Record authored achievement events durably | The source emits achievement events, but no application achievement consumer provides durable per-participant recording/display. |
| `q2.service.match-report-lobby` | Q2 | Complete match reporting and lobby lifecycle | Local source match rules are implemented, but durable match-report and lobby membership/next-session service workflow is not integrated. |
| `q3.progression.difficulty-records` | Q3 | Difficulty-specific arena records | The application has no joined five-skill best-rank progression store or record-driven arena UI. |
| `q3.progression.medals` | Q3 | Persistent medals and award thresholds | In-match rewards exist, but durable single-player medal accumulation and its progression display are not joined. |
| `q3.progression.reset-and-unlock-commands` | Q3 | Progression reset and explicit unlock commands | Progression reset/unlock commands do not have an application-owned progression record to update. |
| `q3.progression.team-arena-records` | Q3 | Team Arena skirmish scores and best times | Team Arena campaign score/accuracy/medal persistence and postgame record UI are not joined. |
| `q3.progression.tiers-videos-unlocks` | Q3 | Tier completion and movie unlocks | Tier completion, video unlock and final/training progression rules are not joined to the common frontend. |
| `q3.services.authorization-endpoints` | Q3 | CD-key authorization and configurable service endpoints | The actual Q3 admission adapter supplies authorizeAddress as null and immediately answers authorization challenges; the required authorization endpoint lifecycle is not joined. |
| `q3.services.rankings-lifecycle` | Q3 | Ranking login, match lifecycle and submission | Ranking wire codecs exist without a joined ranking account/session/reporting lifecycle. |

## demos-recording — 10 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.demos.nq-record-playback` | Q1 | NetQuake demo recording, playback and timedemo | NQ demo codec/recording library has no application record/playback/timedemo command and camera lifecycle join. |
| `q1.demos.qw-record-spectate` | Q1 | QuakeWorld demos, rerecord and spectator cameras | Accepted 66e6136 provides a live native QW remote session, but demo recording/playback/rerecord workflows and spectator cameras remain unjoined; spectator connections are rejected. |
| `q2.demo.client-recording` | Q2 | Record and replay ordinary demos | Q2 demo/MVD codecs and stream utilities exist without a live application recorder/player/GTV service and corresponding user workflow. |
| `q2.demo.gtv-streaming` | Q2 | Authenticate and stream GTV spectators | Q2 demo/MVD codecs and stream utilities exist without a live application recorder/player/GTV service and corresponding user workflow. |
| `q2.demo.mvd-recording` | Q2 | Record multi-view demos | Q2 demo/MVD codecs and stream utilities exist without a live application recorder/player/GTV service and corresponding user workflow. |
| `q2.demo.protocol-playback` | Q2 | Play supported classic and rerelease demos | Q2 demo/MVD codecs and stream utilities exist without a live application recorder/player/GTV service and corresponding user workflow. |
| `q2.demo.server-recording` | Q2 | Record server demos | Q2 demo/MVD codecs and stream utilities exist without a live application recorder/player/GTV service and corresponding user workflow. |
| `q2.demo.view-controls-seats` | Q2 | Control playback and recorded local viewpoints | Q2 demo/MVD codecs and stream utilities exist without a live application recorder/player/GTV service and corresponding user workflow. |
| `q3.recording.demo-record-playback` | Q3 | Demo recording and legacy playback | Q3 demo codecs exist, but record/playback, snapshot consumption and demo UI/application lifecycle are not joined. |
| `q3.recording.timedemo` | Q3 | Timedemo clocks and performance reporting | There is no joined application timedemo command, playback clock and performance-result workflow. |

## cinematics-media — 6 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q2.media.cin-video` | Q2 | Decode and present classic CIN frames | Shared media decoders exist, but Q2 campaign/remote cinematic presentation and authored continuation are not joined; the only application cinematic owner is Q3 UI RoQ playback, with no Q2 timed subtitle producer. |
| `q2.media.pause-skip-transition` | Q2 | Pause, skip, and finish cinematic transitions | Shared media decoders exist, but Q2 campaign/remote cinematic presentation and authored continuation are not joined; the only application cinematic owner is Q3 UI RoQ playback, with no Q2 timed subtitle producer. |
| `q2.media.rerelease-formats` | Q2 | Play required rerelease and expansion media formats | Shared media decoders exist, but Q2 campaign/remote cinematic presentation and authored continuation are not joined; the only application cinematic owner is Q3 UI RoQ playback, with no Q2 timed subtitle producer. |
| `q2.media.static-pcx` | Q2 | Present static PCX intermission images | Shared media decoders exist, but Q2 campaign/remote cinematic presentation and authored continuation are not joined; the only application cinematic owner is Q3 UI RoQ playback, with no Q2 timed subtitle producer. |
| `q3.media.cinematic-clock-transitions` | Q3 | Cinematic timing, looping, hold and skip | Cgame cinematic slots play actual media, but the full standalone cinematic input/skip/end/nextmap transition workflow is not joined to Application. |
| `q3.media.world-and-menu-video` | Q3 | World material and menu cinematics | Menu cinematic slots are joined, but ApplicationAssets constructs SceneShaderRegistry without playCinematic, leaving world videoMap stages unresolved. CinematicImage also rejects dimension changes instead of resizing the resource. |

## tools-diagnostics — 6 retained open rows

| ID | Family | Original title | Original remaining-work reason |
|---|---|---|---|
| `q1.tools.chase-camera-diagnostics` | Q1 | Runtime chase camera and diagnostic commands | Diagnostic console exists, but a player-visible traced Q1 chase-camera mode is not joined to the application view owner. |
| `q3.cameras.spline-runtime` | Q3 | Spline camera evaluation and timed camera events | Runtime camera splines and their source-authored load/control/interpolation lifecycle are not joined to the application view. |
| `q3.diagnostics.omnitimer` | Q3 | OmniTimer initialization, stamps and reporting | The required OmniTimer runtime/profiling contract has no established application implementation. |
| `q3.diagnostics.runtime-tools` | Q3 | Runtime diagnostic and developer commands | Diagnostic primitives exist, but the complete source runtime diagnostic command set is not registered against the actual application owners. |
| `q3.recording.screenshots-levelshots` | Q3 | Screenshots, levelshots and capture timing | Accepted fc0c15e implements automatic/named/silent screenshot commands, TGA/PNG/JPEG output, source-style 128x128 levelshot downsampling and complete-frame readback through the shared application capture path. Recording capture-clock integration with FPS/timescale and restart/timing behavior remains unfinished; screenshot and levelshot helper absence is no longer the gap. |
| `q3.source-applications.role-accounting` | Q3 | Separate authoring and distribution application roles | Comparison documentation enumerates authoring/runtime roles, but complete runtime-derived obligations from all listed tool/SDK/archive inputs have not been established; this row cannot be completed from file inventory alone. |

Reproduce with `bun docs/functional-targets/group-remaining.ts [input-ledger.json] [output-directory]`. Defaults are `docs/completion-status.json` and `docs/functional-targets`. The script contains the category mapping, explicit per-row overrides, dependency notes and uniqueness/count checks.
