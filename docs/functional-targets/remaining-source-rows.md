# Retained remaining requirements by function

> **Re-derived table (2026-11-02).** These are the 184 rows the 2026-09-15 ledger retained as open. Each was re-checked against the code at HEAD and now carries a current state and reason; the original reasons were replaced (they remain in git history and the stale-reason audit, see [../completion-status.md](../completion-status.md)). The generator that produced the grouping (`group-remaining.ts`) was deleted because its input `docs/completion-status.json` no longer exists, so the grouping itself is a historical artifact. The JSON next to this file carries the same current state in `currentState`, `currentReason` and `currentPaths`.


Retained assessment cutoff: `167bfbf19d06625ac2b350120647686e3e0170e9`. Input: `docs/completion-status.json`, SHA-256 `0aff45642441dff7ffd9010566d39e89a0a32e74bf922215822efd0c4b159231`. Mechanical grouping of the retained open implementation verdicts of the 2026-09-15 ledger; the grouping and function counts below are as of that ledger, while each row's state and reason were re-derived against the code on 2026-11-02. Primary functional placements do not assign common-engine versus source-extension architecture. Secondary dependencies are reported separately and never counted as additional rows. Input provenance is identified by path, assessment cutoff and SHA-256; no repository revision is inferred from an arbitrary input file.

Every original ID, title and source family is preserved below. The JSON additionally preserves the original reasons, basis and source paths.

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

## Current state (2026-11-02)

Of the 184 retained rows, 164 are closed (the code at HEAD implements the requirement), 20 remain open with a current gap, 0 are open owner questions and 0 are descoped. The per-function tables below give each row's state. The completion table in [../completion-status.md](../completion-status.md) carries the same verdicts and source paths.

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

## content-assets — 6 retained rows (6 closed, 0 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.content.quake64` | Q1 | Identify and launch the required Quake 64 content | closed | Quake 64 products (classic, rerelease, QuakeWorld) are catalogued with content directory, base product, required archives, program and map witness with no unresolved reason, and discovery of the q64 content directory is tested. |
| `q1.services.addon-discovery` | Q1 | Local and online add-on browsing | closed | The add-on library lists installed and Quaddicted catalog packages and offers install, update, remove and play, with status and error feedback. |
| `q2.content.discovered-addons` | Q2 | Discover installed add-on directories | closed | Non-stock Q2 add-ons that ship gamex86.dll or game_x64.dll are discovered by the catalog and selected for native guest execution, so runtime dispatch is not limited to known programs. |
| `q3.content.demo-product-profiles` | Q3 | Independent prerelease demo product restrictions | closed | Demo-product restriction is applied: demo mount restriction, fs_restrict, demoRestricted in server and client admission, and a demo sv_keywords entry. |
| `q3.formats.ibsp44-compatibility` | Q3 | Observed IBSP44 map compatibility | closed | normalizeQ3Bsp converts IBSP44 maps to the version-46 layout before parsing and classifyBsp accepts versions 44 and 46; tests cover IBSP44 decoding and hostile-input rejection. |
| `q3.progression.catalog` | Q3 | Arena and bot catalogs | closed | The base arena catalog is read from mounted content and arenaSelection builds a tier-classified, availability-aware arena list in startup and in-game menus that launches the chosen map at a chosen skill. |

## rendering — 7 retained rows (7 closed, 0 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.render.fog-sky-liquids` | Q1 | Fog, skyboxes and liquid presentation | closed | Q1 addon fog events are consumed by a presentation fog owner and Q1MapFog, with map worldspawn fog, transitions and save/restore, and the fog is passed into the scene frame. |
| `q1.render.model-effects-particles` | Q1 | Model effects, particles, shadows and transparency | closed | The Q1 presentation projection publishes raw actor alpha and scale (with clamping), the scene applies them and shadow casting, and the effect-bit consumers (trails, dlights, particles) are joined. |
| `q1.video.mode-restart-capture` | Q1 | Video modes, resize, fullscreen and renderer restart | closed | vid_restart [cpu&#124;gl] restarts the renderer between source frames on the retained client and republishes the window to input, with rollback on failure. |
| `q2.config.renderer-restart` | Q2 | Restart or switch renderer within a live session | closed | vid_restart [cpu&#124;gl] and the Apply renderer setting switch the renderer in a live session through ApplicationVideoRestart, which republishes the window and rebuilds presentation. |
| `q2.world.flashlight` | Q2 | Toggle the rerelease flashlight under every host profile | closed | Flashlight events are consumed by the effects layer, which keeps a per-actor flashlight scene light; toggling in the rerelease module also plays the on/off sounds. |
| `q3.presentation.materials-cpu-gl` | Q3 | Materials and complete CPU/GL rendering | closed | The application shader registry supplies a materialMovie provider that resolves videoMap stages through MaterialCinematic, with fallback when the movie is absent; the rest of the CPU/GL material pipeline was already listed as implemented. |
| `q3.presentation.visual-options-restart` | Q3 | Visual settings, display lifecycle and source hardware profiles | closed | vid_restart is registered by ApplicationVideoRestart with cpu/gl backend switch and r_smp worker option, and the Q3 client derives its hardware class from the live renderer string via the five-class q3Hardware classifier (only ragepro vs generic reaches effects). |

## audio-music — 7 retained rows (7 closed, 0 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q2.audio.raw-pcm` | Q2 | Mix cinematic and streamed PCM | closed | Cinematic soundtrack blocks are mixed through a per-cinematic RawAudioStream lane in the shared mixer from CampaignCinematic, and a test asserts campaign cinematic PCM reaches the world audience. |
| `q2.media.cin-soundtrack` | Q2 | Synchronize the CIN soundtrack | closed | The CIN soundtrack is decoded with the video, queued on the cinematic's own mixer lane and paused, checkpointed and resumed with the picture clock; tests assert PCM output and pause behaviour. |
| `q2.music.menu-shuffle` | Q2 | Control menu music and playlist shuffle | closed | Frontend menu music is owned by StartupAudio with an archived music_menu_track choice, and the archived music_shuffle toggle drives the Q2 gameplay playlist shuffle; a test exercises both bindings. |
| `q2.music.pause-resume-gain` | Q2 | Control music pause, resume, and continuous gain | closed | Music pause and resume run through the cd pause and cd resume commands and source pause events, and music gain is a continuous setter; a startup test checks pause, resume and gain preservation. |
| `q3.audio.a3d-geometry-contract` | Q3 | Legacy A3D geometry behavior account | closed | Per-source geometry transmission (trace-based obstruction with thickness attenuation) is applied by the engine when s_geometryAcoustics is on; it is a documented replacement policy, not A3D SDK math. |
| `q3.audio.background-music` | Q3 | Background intro/loop music and continuous gain | closed | World/cgame intro-loop music, frontend menu track selection through the shared mixer, and the win/loss postgame music command (music music/win&#124;loss) issued on base-arena completion are all wired. |
| `q3.audio.raw-pcm-output-diagnostics` | Q3 | Raw PCM, output formats and sound diagnostics | closed | Output format is selectable through s_outputRate/s_outputBits/s_outputChannels (s_khz alias) applied by snd_restart, and soundinfo/soundlist/play report the real device format; physical audibility is not claimed. |

## input-seats — 10 retained rows (9 closed, 1 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.input.controller-tuning` | Q1 | Controller deadzones, curves and per-seat settings UI | closed | Per-seat controller and mouse tuning UI exposes deadzone shape, deadzone, exponent and outer threshold for both sticks, with persistence and device-profile fallback. |
| `q1.seats.connections-lifecycle` | Q1 | Two to four independent local player connections | closed | local_join and local_drop add and remove seats at runtime with UI buttons and staged presentation; a drop quits only when every local seat leaves and no lobby exists, otherwise it returns to the lobby. |
| `q1.seats.presentation-ownership` | Q1 | Resolve shared effects, audio, menus and recordings for seats | closed | Effects, listeners and modal input are seat-owned, and local demo recording is bound to a specific recorded seat (recordingSeat) with its own view angles. |
| `q1.seats.qw-native-extension` | Q1 | Local players with QuakeWorld gameplay and native networking | open | Native QW remote play accepts one to four seats and QW plays locally on the shared simulation, but non-dedicated graphical QW hosting for wire clients is rejected (native QW serving requires dedicated deathmatch); split-screen transport extensions and multi-seat prediction were not verified. |
| `q2.input.binds-keyboard-mouse` | Q2 | Bind keyboard and mouse gameplay controls | closed | Bindings are persisted per seat through ConfigStore.saveSeat on save and reloaded at startup; keyboard and mouse bindings and mouse settings survive restart in tests. |
| `q2.input.per-player-tuning` | Q2 | Tune controller axes independently | closed | ApplicationInput loads per-seat input documents at startup and saveSettings writes bindings, gamepad tuning, mouse tuning and controller selection per seat, plus archived input cvars; tests exercise reload. |
| `q2.seats.remote-network` | Q2 | Use multiple local players on a remote server | closed | RemoteApplication adds up to four local seats, each with its own native Q2 channel and connection, and the host admits split seats; the one-player-per-connection check is the adapter design, not a missing feature. |
| `q3.input.joystick-profiles-hotplug` | Q3 | Joystick profiles, thresholds and device lifecycle | closed | InputDevices owns a SourceInputState (Linux/Windows joystick profiles, hat/ball keys, device add/remove handling), publishes it to the input router and restarts it on in_joystick/profile/seat changes. |
| `q3.input.midi-controller` | Q3 | MIDI note input and device configuration | closed | InputDevices runs SourceMidiInput with in_midi, device, channel and seat cvars, a settings menu with device choices, midiinfo and restart handling, and releases keys on reassign/disconnect/focus loss. |
| `q3.input.multiple-local-players` | Q3 | Multiple local seats and remote participation | closed | Remote application now supports one to four graphical local seats joining a remote match, with a Q3 remote seat view building an ApplicationQ3Client per seat. |

## console-config — 5 retained rows (5 closed, 0 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.config.commands-console` | Q1 | Console scripts, aliases, history and completion | closed | Command buffer, aliases, exec, wait, console editing, history and completion are connected, writeconfig is joined, and tests cover shared aliases and completion. |
| `q1.config.persistence-migration` | Q1 | Archived configuration and writable profile migration | closed | Archived cvars and per-seat input settings are written, and ConsoleScriptFiles reads legacy home and per-game config files (newest wins) without overwriting seat archives. |
| `q2.config.archived-state` | Q2 | Persist binds and archived cvars | closed | Startup loads per-seat, movement and product cvar archives through loadCvarArchive and the application saves them back, covering binds and archived cvars. |
| `q3.configuration.console-scripts` | Q3 | Console, history, completion and command scripts | closed | The application input, prepared-startup and configuration command buffers all supply readScript backed by ConsoleScriptFiles (user and mounted scopes), so exec reads the requested script. |
| `q3.configuration.persistence-startup` | Q3 | Archived cvars, bindings and startup configuration | closed | q3config.cfg archive load, writeconfig, autoexec and safe-mode handling are joined in the startup configuration owner and prepared startup; frontend preferences persist separately. |

## networking — 10 retained rows (5 closed, 5 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.multiplayer.chat` | Q1 | Public, team and private messages | open | Local Q1 say and say_team are implemented, but private tell has no Q1 implementation (the UI target argument is passed to say and would be appended to the text), so private messages are missing. |
| `q1.network.hosting-lifecycle` | Q1 | Listen and dedicated server lifecycle | open | NQ listen and dedicated plus dedicated QW hosting are joined, but QW hosting is rejected unless dedicated deathmatch, so a local graphical QW host or join-in-place is not available. |
| `q1.network.native-session-negotiation` | Q1 | Negotiate full native session identity | closed | The unified native session offer carries the full composition identity (normalized recipe including execution, ordering clock and content mounts, snapshot schema) and the client replies with a matching digest and userinfo before admission; Q1 recipes are tested. |
| `q1.network.nq-wire` | Q1 | NetQuake protocols 15, 666 and 999 | open | NQ 15, 666 and 999 host and client wire are joined and tested, but native hosting still requires Q1 character presentation, rerelease messages use the known-retail set unless private, and extensions beyond the listed codec flags are not implemented. |
| `q1.network.qw-prediction` | Q1 | QuakeWorld protocol and prediction | open | Protocol 28 remote and dedicated hosting work with spectator cameras, but protocol 29 is replay-only (the lobby rejects it live), there is no extension negotiation, and no other-player prediction path was found. |
| `q1.network.retail-kex-boundary` | Q1 | Separate documented Q1 wire compatibility from retail KEX claims | open | Boundary documented in docs/protocol.md ("Retail online services are not part of the wire"). Remaining: the rerelease Quake session layer (Steam/Xbox party lobby) is not implemented; the binaries (rerelease/quake_x64_steam.exe, PartyWin.dll) are present but not disassembled, and an online lobby cannot be exercised offline. |
| `q2.network.classic-protocol` | Q2 | Preserve stock protocol 34 behavior | closed | Protocol 34 server and client downloads are implemented (Q2PeerDownload, HTTP download queue, permission policy), alongside the framing and command paths. |
| `q3.content.pure-policy` | Q3 | Pure package checksums and filesystem selection | closed | Remote Q3 clients parse sv_pure/sv_paks, build the pure mount policy, reset content on change and construct referenced-pure proofs that require actually loaded cgame/ui modules. |
| `q3.network.ipx-transport` | Q3 | Historical IPX transport obligation | closed | IPX transport ships for Q3 server and client (DOSBox relay or native AF_IPX via --ipx-dosbox/--ipx-native) with LAN-only behavior; no master heartbeat over IPX. |
| `q3.network.snapshots-prediction` | Q3 | Snapshots, deltas and client prediction | closed | The Q3 remote client consumes network snapshots and owns presentation prediction with capture on snapshot and map restart. |

## downloads — 1 retained rows (1 closed, 0 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.network.downloads` | Q1 | QuakeWorld content download queues and policy | closed | QW sound, model, map and skin transfers are joined, the server enforces allow_download and per-category cvars, and mod gamedirs are admitted as safe single-directory selections; a native UDP test covers every category. |

## server-browser-admin — 20 retained rows (18 closed, 2 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.multiplayer.identity` | Q1 | Player names, colors and setup | closed | Q1 name and color are set through name/color console commands and the settings UI, mapped to userinfo for each local seat, with saved QW pre-connect identity and live color updates. |
| `q1.multiplayer.pause-kick-status` | Q1 | Pause, kick, ping and player status | closed | Q1 pause, status, ping and kick are registered and handled with operator feedback; pause is authorized by pausable and the requesting origin. |
| `q1.multiplayer.setup` | Q1 | Configure and launch multiplayer matches | closed | Startup offers single player, coop and deathmatch, match rules including Horde, CTF products, protocol and hosting profile selection, seats, and a host server-settings menu with map rotation and profiles. |
| `q1.network.admission-admin` | Q1 | Passwords, spectators, rcon, filtering and flood control | closed | QW hosting enforces player and spectator passwords, maxspectators, rcon, IP filter commands (addip, removeip, listip) and chat flood protection; NQ hosts apply the IP reject filter. |
| `q1.network.discovery` | Q1 | Direct connect, LAN search and server browser | closed | The startup server browser supports direct connect, LAN broadcast search for NQ and QW, HTTP master lists, filters, sorting and a details view. |
| `q2.admin.masters-heartbeat` | Q2 | Configure masters and heartbeat publication | closed | The Q2 server adapter sends master heartbeats on a schedule and at shutdown to masters from the administration owner, which also exposes master configuration. |
| `q2.admin.player-identity` | Q2 | Configure player names, skins, handedness, and view settings | closed | Per-seat name, skin, hand and fov cvars are registered as userinfo, exposed in the settings menu, and changes are published to the running simulation or native guest each frame. |
| `q2.admin.spectator-chase` | Q2 | Enter spectator mode and chase active players | closed | primaryUi redirects to the chased player's combat, inventory and HUD state when a spectator has a chase target, and a test covers the chase HUD. |
| `q2.admin.status-kick` | Q2 | Inspect clients and remove a player | open | Local status prints only slot, score, ping and name and dumpuser works; kick now delivers its reason over UDP to peers, but the stock status columns (address, last message, qport) are absent and wire/profile qualification of the whole path is unverified. |
| `q2.browser.master-lan` | Q2 | Discover servers from UDP, HTTP, and LAN sources | closed | StartupServerBrowser constructs a ServerBrowser per protocol including Q2 and is opened by startup, with master, LAN and favorite discovery sources. |
| `q2.browser.sort-filter` | Q2 | Filter and sort server results | closed | The browser supports text filter, favorites-only, hide empty and full, and ping, name, map and player-count sort orders. |
| `q2.browser.status-details` | Q2 | Inspect server rules and player details | closed | The browser details view lists server name, map, player count, per-player name, score and ping, and sorted server rules from the status response. |
| `q2.content.rotation-editor` | Q2 | Edit and persist ordered map rotations | closed | The in-game server settings menu has an ordered rotation editor (add, reorder, remove) with a rerelease shuffle toggle, backed by sv_maplist/g_map_list, saved in server profiles and consumed by the Q2 player module at map end. |
| `q2.content.server-map-lists` | Q2 | Choose maps and inspect mode eligibility | open | Authored titles are shown for mapdb starts, but for Q2 (and Q3) maps the startup list accepts every BSP without checking spawn points or objectives; only Q1 maps are filtered by info_player classes, so mode eligibility filtering is missing. |
| `q2.network.connectionless-rcon` | Q2 | Process status, ping, challenges, and rcon | closed | The Q2 connectionless switch handles status, info, ping, getchallenge, connect and authorized rcon with replies, backed by the server administration owner. |
| `q3.admin.operator-rcon-filters` | Q3 | Operator controls, rcon, filters and logging | closed | The Q3 endpoint handles authenticated rcon through RconService, and the application joins operator filters, setmaster/heartbeat, kick/map/restart and G_LogPrintf logging to g_log with g_logSync. |
| `q3.admin.pause-flood-inactivity` | Q3 | Pause eligibility, command flood control and inactivity | closed | SV_CheckPaused eligibility (one connected human) drives sv_paused and halts the Q3 server frame; flood and inactivity policies also run. |
| `q3.admin.permissions-cheats-passwords` | Q3 | Password admission and developer command permissions | closed | Password admission and cheat policy are joined, and the levelshot capture is now called: a clientLevelShot server command queues screenshot levelshot, which the capture service writes as a 128x128 TGA. |
| `q3.discovery.lan-global-favorites` | Q3 | LAN, master lists and favorites | closed | The startup server browser joins LAN, primary and secondary master lists, and persisted favorites with refresh and a master-list fetch. |
| `q3.discovery.ping-status-cache-filters` | Q3 | Ping/status queues, filtering and persistent cache | closed | The browser owns ping/status queries, a persisted Q3 cache, text and favorites filters, and eight sort orders, with tests for each. |

## mods-vms — 6 retained rows (6 closed, 0 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.content.launch-selection` | Q1 | Select gameplay separately from content and engine behavior | closed | Launch selection separates game/gamecode product, map content, movement, character, weapons and monsters; the campaign gamecode follows the selected product while geometry follows mapProduct, and selected Q1 arsenals cover id1, hipnotic, rogue, dopa, mg1 and mg3 on any map. |
| `q1.execution.builtin-typescript-gameplay` | Q1 | Run first-party Q1 gameplay in strict TypeScript | closed | First-party Q1 gameplay (id1, mission packs, addons, CTF, horde) runs as strict TypeScript through the Q1 source composition; external QuakeC execution is a separate optional path. |
| `q1.execution.nq-qw-host-abi` | Q1 | Keep NetQuake and QuakeWorld gamecode host contracts distinct | closed | NetQuake and QuakeWorld run through one QuakeC source with separate host bindings (entity layout and edict limits, aim defaults, message services, 32-client QW cap, spectator connect/think/disconnect callbacks); arbitrary external programs are still not admitted, which is a separate compatibility limit. |
| `q2.game.provider-selection` | Q2 | Select base, expansion, CTF, LMCTF, and KEX game providers | closed | Base, expansion, CTF, LMCTF and rerelease programs dispatch to real providers, and unknown Q2 add-ons with a native game library run through the prepared native guest path. |
| `q3.content.mod-selection` | Q3 | Mod discovery, selection and return to base | closed | Q3 mod directories with vm/qagame.qvm are discovered as catalog products, selectable at startup and run as QVM guests; base product return is a normal selection. Live set fs_game plus restart is not supported (rejected at startup). |
| `q3.execution.qvm-roles` | Q3 | QVM game, cgame and UI execution | closed | Game, cgame and UI QVM roles all run: Q3QvmServerGame is built by the runtime and the q3 client creates QvmApplicationScalars, QvmCgame and QvmUi. |

## movement-bodies — 2 retained rows (2 closed, 0 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.physics.rerelease-gibs-corpses` | Q1 | Rerelease gib and corpse collision semantics | closed | Rerelease edition marks Q1 corpses as box solids with a corpse flag; traces hit them with point or zero-size shapes but never block sized bodies, and gib/head construction and bounce movement are in place. |
| `q2.rerelease.q64-movement` | Q2 | Match Q2 64 server movement and prediction | closed | The server publishes the n64 physics config and rerelease protocol admission is supported, and the remote client builds its prediction profile from the received n64 setting so native prediction matches. |

## ai-navigation — 9 retained rows (7 closed, 2 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.bots.combat-traversal` | Q1 | Bot combat, swimming, jumps and monster interactions | closed | The rerelease bot service drives real movement, combat and traversal in singleplayer, coop and deathmatch Q1 worlds; the legacy admission restriction applies only to the Q3-definition fallback. |
| `q1.bots.ctf-coop-horde` | Q1 | Bot objectives and campaign participation | closed | Rerelease bot objectives report Q1 CTF, coop and horde game types with team and flag-carrier hooks; the botAdmissionError rejection now applies only to classic-data legacy bots. |
| `q1.bots.knowledge-skill` | Q1 | Bot personalities, weapon/item knowledge and skill | closed | Q1 maps load the rerelease Quake 1 bot knowledge, characters and localization (with sibling lookup of the installed rerelease product); baseq3 definitions are used only for Q3 maps or when no rerelease bot data is installed. |
| `q1.bots.population` | Q1 | Manual bots, autofill and eligibility | closed | Where Q1 rerelease bot definitions are installed, the native Q1 bot service handles manual and autofill bots without the id1-deathmatch limit; classic-only installs fall back to the restricted legacy policy (deathmatch, id1, no teamplay). |
| `q2.bots.combat-campaign-goals` | Q2 | Execute bot combat and campaign decisions | closed | Bots receive objective data for Q2 CTF, LMCTF, Tag, DeathBall and coop/campaign points of interest, and the rerelease guidance returns a path whenever native navigation is loaded. |
| `q2.navigation.dynamic-obstacles` | Q2 | Update routes for doors, lifts, hazards, and moving floors | open | Live door/plat enabled and locked state, destinations, hazard volumes, elevators and train routes feed route validation; only trains and nav-type-6 elevators get dedicated mover traversal, other moving-floor mover edges fall back to generic walk prediction and are rejected if not admitted. Full coverage of every mover type was not verified. |
| `q2.navigation.foreign-map-construction` | Q2 | Construct navigation for maps without NAV2 | closed | Constructed graphs drive bot movement, combat and item access on maps without NAV2, and admitted bots now include the CTF, Tag, DeathBall and coop objective play via the shared objective binding. |
| `q3.bots.aas-reachability-clustering` | Q3 | AAS reachability, clustering, writing and optimization | open | Ports of AAS reachability, clustering, optimization and writing exist and are round-trip tested, but nothing in the application calls them; navigation loads a shipped .aas/.nav or falls back to sampled construction. |
| `q3.bots.foreign-map-construction` | Q3 | Navigation construction for foreign maps and moving geometry | closed | Navigation is constructed for Q1, Q2 and Q3 worlds with a world adapter covering doors, plats, trains and hazards of each source; botAdmissionError no longer rejects foreign maps. Remaining objective-mode gaps belong to q3.modes.foreign-objective-adaptation. |

## combat-rosters-equipment — 11 retained rows (11 closed, 0 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.hipnotic.monster-armagon` | Q1 | Hipnotic armagon encounter | closed | Native Armagon behavior is registered and offered as a selectable hipnotic monster; the expansion test places it as a replacement on a foreign map with save continuation. Authored bosses on foreign maps are deliberately kept map-defined. |
| `q1.hipnotic.monster-gremlin` | Q1 | Hipnotic gremlin encounter | closed | Native Hipnotic gremlin behavior is registered, the monster catalog now offers it as a hipnotic/rogue-style source, and selected-monster admission includes monster_gremlin; tests place it on a foreign Q2 map and verify save continuation. |
| `q1.hipnotic.monster-scourge` | Q1 | Hipnotic scourge encounter | closed | Native Hipnotic scourge behavior is registered, the monster catalog now offers it as a hipnotic/rogue-style source, and selected-monster admission includes monster_scourge; tests place it on a foreign Q2 map and verify save continuation. |
| `q1.mg3.lavasuit` | Q1 | Dawn of the Machine lava suit | closed | item_artifact_lavasuit is registered with a 30-second timed powerup, wearing-out warnings, HUD timer, save/restore, and lava/slime immunity in the damage path. |
| `q2.inventory.power-armor` | Q2 | Toggle power armor and consume cells on protection | closed | Toggle, absorption and cell accounting run, and the common HUD adds a prompt line showing active power screen or shield and remaining cells (text, not the original armor icon). |
| `q2.powerup.invulnerability` | Q2 | Activate and expire invulnerability | closed | Invulnerability remaining time is in the Q2 powerup timer list and reaches the HUD timer renderer. |
| `q2.powerup.quad` | Q2 | Activate and extend quad damage | closed | Quad Damage is included in the Q2 powerup timer list that ApplicationSeatUi passes to the HUD timer renderer. |
| `q2.rerelease.guardian` | Q2 | Complete the guardian encounter | closed | Boss healthbar events are consumed by the per-seat HUD state (localized name, fraction, visibility) and drawn as HUD health bars. |
| `q2.rerelease.instanced-items` | Q2 | Use coop item instancing | closed | Item-visibility events are consumed by the rerelease presentation, and the presentation scene hides items per local seat using that state. |
| `q2.rogue.double-damage` | Q2 | Activate double damage | closed | Double Damage remaining time is in the Q2 powerup timer list and reaches the HUD timer renderer; multiplier and expiry live in the mission pack items. |
| `q2.xatrix.quadfire` | Q2 | Activate quad fire | closed | DualFire Damage remaining time is in the Q2 powerup timer list and reaches the HUD timer renderer; modifier and expiry live in the mission pack items. |

## maps-campaigns — 5 retained rows (4 closed, 1 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.execution.entity-properties` | Q1 | Preserve foreign entity classes, fields and target graphs | open | Selected-monster admission only preserves ordinary authored classes and plain spawn flags; other authored classes or flags (bosses, dormant/triggered monsters) throw 'does not yet preserve authored obligations', and foreign spawn text with unimplemented classes throws rather than being carried through. |
| `q2.campaign.hub-endings` | Q2 | Complete hubs, objectives, secrets, and endings | closed | End-of-unit reports list per-level kills and secrets, the help computer and objectives reach the HUD, and campaign cinematics plus nextserver travel are joined and exercised by a mixed-campaign test. |
| `q2.campaign.unit-backtracking` | Q2 | Restore revisited levels within a unit | closed | CampaignUnit retains departed world bytes and restores them on revisit, and native classic and rerelease guests keep a visited-level map restored on return in single-player. |
| `q2.content.native-starts` | Q2 | Launch authored campaign starting maps | closed | Rerelease mapdb.json is parsed into ordered authored starts including start items; application launch loads them and applies the start items to the simulation. |
| `q2.content.start-map-discovery` | Q2 | Resolve mapdb, maplist, and BSP start maps | closed | The catalog loads mapdb.json through a shared parser that keeps authored unit order and start items, startup lists those starts first, and BSP discovery and the maplist file path cover the rest. |

## modes-objectives — 11 retained rows (10 closed, 1 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.ctf.capture-loop` | Q1 | Rerelease CTF capture, return, drop and scoring | closed | CTF capture/drop/return logic is installed and its ctf-status and ctf-capture events are consumed by the seat HUD state (score, flag state, runes, capture banner). |
| `q1.ctf.grapple-observer-vote` | Q1 | Rerelease CTF grappling, observers and exit vote | closed | Observer team prompts and vote exits are consumed by the seat game-prompt menu which sends the chosen impulse; a first-playable test drives the team prompt, observer promotion and prompt clearing. |
| `q1.horde.launch-waves` | Q1 | Horde launch, wave spawning and survivor progression | closed | Horde is a launch preset and --rules option; the runtime sets the horde cvar and adjoins the MG1 horde addon on any Q1 program, so waves, lifecycle and travel run on authored horde maps. |
| `q2.mode.deathball` | Q2 | Play rerelease DeathBall | closed | Match selection supports q2:deathball, startup builds DeathBall presets and accepts --rules deathball, and foreign-world DeathBall also runs in the runtime. |
| `q2.mode.deathmatch-limits` | Q2 | End a deathmatch on authored limits | closed | Native Q2 deathmatch construction binds dmflags, timelimit and fraglimit cvars to the live rules, and the player module ends the match on time or frag limit. |
| `q2.mode.dm-options` | Q2 | Apply classic deathmatch flags | closed | Native Q2 construction derives deathmatchFlags from dmflags (and rerelease g_dm_* cvars) and passes them to the game, with read/write service so in-game changes persist. |
| `q2.mode.rerelease-options` | Q2 | Apply rerelease deathmatch and weapon settings | closed | Rerelease deathmatch and weapon cvars (instant switch, weapons stay, infinite ammo, no-items, force respawn, etc.) are registered, bound to rules and merged into dmflags at construction. |
| `q2.mode.tag` | Q2 | Play Rogue Tag | closed | Match selection supports q2:tag, startup builds Tag presets and accepts --rules tag, and foreign-world Tag also runs in the runtime. |
| `q2.rerelease.squad-respawn-lives` | Q2 | Use squad respawn and cooperative lives | closed | Rerelease coop options (squad respawn, instanced items, lives, life count) are bound to g_coop_* cvars that feed the live rules object, and the player module runs the lives, waiting and coop respawn flow. |
| `q3.modes.foreign-objective-adaptation` | Q3 | Objective and spawn adaptation on foreign maps | open | Only Q2-style flag and team spawn classnames are translated to Q3 roles; the runtime never passes explicit objective placements, so 1FCTF, Overload and Harvester (and CTF on Q1 or flagless Q2 maps) fail with missing-objectives instead of being adapted. |
| `q3.modes.single-player-arena` | Q3 | Single-player arena match flow | closed | Base arena single-player flow is joined: catalog-driven selection with unlock gating, spmap launch at chosen skill, completion recording, and retry/next return paths in the application. |

## saves-recovery — 7 retained rows (5 closed, 2 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.saves.autosave` | Q1 | Timed autosave and recovery | open | Level-start autosave is joined for Q1 source worlds (singleplayer, sv_autosave), but the registered sv_autosave_interval cvar is never read, so no timed autosave exists, and multiplayer or seat policy is not addressed. |
| `q1.saves.classic-v5` | Q1 | Classic version 5 save import and export | closed | save <name> v5 exports and load imports the original NetQuake version 5 format for an idle singleplayer QuakeC source world; mixed compositions are refused with a message. |
| `q1.saves.kex-v6` | Q1 | KEX-style version 6 save compatibility | closed | save <name> v6 exports the KEX-style version 6 header with game directories, and load imports it through the same original-save path. Retail v6 fixtures are not in the tree, so compatibility rests on the format codec tests. |
| `q2.save.autosave-transition` | Q2 | Distinguish autosaves from transition snapshots | open | Autosaves go through the common saveGame path (autosaveLevel, sv_autosave) but the native guest capture hard-codes autosave false for both rerelease and classic originals, so the source autosave flag and autosave-specific client treatment are never exercised; SavePurpose transition/autosave only gates eligibility. |
| `q2.save.eligibility-paths` | Q2 | Enforce save eligibility and contained slot paths | closed | The live save command resolves its name inside the save directory, saveGame applies saveUnavailable eligibility (no deathmatch, intermission, dead player or network authority) and writeContainedSave rejects escapes and the reserved current slot; a test covers these. |
| `q2.save.poi-health-story` | Q2 | Restore objective and presentation state | closed | The rerelease module checkpoints story, POI, health bars and mission state, and restore re-emits sky, story, fog and POI presentation while health bars re-emit every player frame; a gameplay test covers resumePresentation. |
| `q3.persistence.complete-world-save` | Q3 | Complete unified world saves under Q3 gameplay | closed | Q3 world saves capture q3:native game memory, world:q3-runtime (arsenals, movement, last attacks), bots and simulation state, with a restore path; a persistence test covers it. Tag/LMCTF/DeathBall foreign-match state on other families is still rejected, which is outside this row. |

## menus-hud — 24 retained rows (20 closed, 4 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.events.prompts` | Q1 | Localized prompts and choice impulses | closed | Q1 prompt and clear-prompt events are routed to a paged seat prompt menu that sends the chosen impulse. |
| `q1.ui.hud-inventory` | Q1 | Classic, Hipnotic and Rogue HUD/inventory layouts | closed | The seat HUD state consumes Q1 ctf-status and ctf-capture events and shows team scores, flag state, runes and capture banners alongside health, armor, ammo and expansion weapons. |
| `q1.ui.options-and-reset` | Q1 | Complete options, binding and reset workflows | closed | Settings cover language, output sample rate, autosave, pickup weapon switching, lookspring, lookstrafe and restore-defaults for settings and bindings. |
| `q1.ui.radial-weapon-wheel` | Q1 | Rendered radial weapon selection | closed | The application reads the authored wwheel.txt for rerelease Q1 products, parses it, maps slot impulses to items and feeds the radial selector; invalid files fall back to the default wheel. |
| `q1.ui.save-load-menus` | Q1 | Save, load and autosave selection UI | closed | In-game Save and Load menus with named slots and overwrite exist, startup lists native saves, and Q1 single-player level autosave (autosave.sav) is written on load; the timed autosave interval cvar has no reader. |
| `q1.ui.weapon-quickswitch` | Q1 | Weapon-wheel data and quickswitch impulses | closed | An authored Q1 weapon wheel adapter maps wheel slots to exact source items and expansion impulses, and impulses 1-8, 10 and 12 plus weapnext/weapprev/use are wired through the application. |
| `q2.config.audio-video-input-menus` | Q2 | Apply video, audio, and input settings | closed | Settings menus apply display (renderer, fullscreen, resolution, vsync, brightness), audio and input settings live, with ConfigStore persistence for audio and input; the old gap was a qualification status, not missing code. The GL restart test is gated behind QUAKE_GL_SMOKE. |
| `q2.hud.boss-health-bars` | Q2 | Display and clear authored boss health bars | closed | The rerelease module emits healthbar events every player frame (including a clearing event) and SeatSourceHud keeps them per slot and seat and draws them in the HUD. |
| `q2.hud.centerprints-notifications` | Q2 | Queue localized centerprints and notifications | open | Per-seat localized centerprints and notifications are drawn, but no Q2 local emitter sets instant or durationSeconds, so local centerprints always fall to instant with a five second hold; the typewriter policy is only honoured on the network service path. |
| `q2.hud.compass-help-path` | Q2 | Draw the compass route to the active objective | closed | help-path events are consumed by SeatSourceHud and drawn as the compass route in the common HUD, with source-time lifetime; navigation returns a path when native navigation exists. |
| `q2.hud.damage-feedback` | Q2 | Display damage direction and pickup feedback | closed | Directional damage indicators (with the pickup damage picture) and pickup icons with a three second timer are bound through SeatSourceHud into the HUD; damage blend and kick also exist. |
| `q2.hud.inventory` | Q2 | Open and use the inventory display | closed | svc_inventory is bound to the native inventory layout and to an inventory menu opened by the source inventory event, with selected-row and use bindings. |
| `q2.hud.poi-stages` | Q2 | Activate and advance objective markers | closed | SeatSourceHud consumes poi, keyed-poi and remove-poi events, loads their pictures and publishes them as source points; the module checkpoints poi stage state. |
| `q2.hud.powerup-wheel` | Q2 | Use powerups through the radial wheel | open | Powerup selection, counts and active timers work, but wheelIcons is filled only for weapon items, so powerup wheel entries have icon null and draw as text labels instead of item art. |
| `q2.hud.profile-selection` | Q2 | Select the correct classic or rerelease HUD | closed | The Q2 native HUD layout stream is driven by the protocol identity (classic vs rerelease/kex) and is prepared and drawn from the application presentation path; tests cover both grammars. |
| `q2.hud.score-help` | Q2 | Display scoreboards and the help computer | closed | Scoreboard rows, the help computer and end-of-unit report are consumed by SeatSourceHud and the native svc_layout path, and are drawn through the common and native HUD; tests cover both. |
| `q2.hud.weapon-carousel` | Q2 | Cycle weapons with the carousel | closed | weapnext and weapprev call ApplicationSeatUi.cycleWeapon for the rerelease dialect, which drives SeatWeaponWheel.cycle with timed preview, attack confirmation and a weapon lock. |
| `q2.hud.weapon-wheel` | Q2 | Select a weapon with the radial wheel | closed | The wheel is joined to source selection and ApplicationSeatUi now loads per-weapon icons into wheelIcons and passes them to wheel items. |
| `q3.progression.podium-postgame` | Q3 | Podium, postgame and next-match navigation | closed | The spPostgame command is parsed into a podium, awards and unlocked-movie result, persisted, and shown by the base arena menu with retry/next/main controls; Team Arena postgame feeds the results menu with next/retry/quit. |
| `q3.ui.base-demos-cinematics-configs` | Q3 | Demo, movie and configuration menus | closed | Startup menu exposes Demos, Movies and Configurations library menus backed by demo listing/playback, mounted video listing and config library services. |
| `q3.ui.base-host-browser-ingame` | Q3 | Base hosting, browser and in-game menus | closed | Common frontend provides a Host a game menu, the shared server browser with favorites/sort/filter, and a Q3 in-game match menu (team, vote, callvote, addbot, kick). It is a common-frontend equivalent, not a port of the original ui.qvm layout. |
| `q3.ui.base-settings` | Q3 | Base menus for player, controls and settings | open | Common settings cover bindings, audio, video basics, accessibility and character model, but the Q3 setup menus (graphics quality, network rate, full player setup, apply/restart behavior) are not present in the common frontend; no r_picmip, rate or cl_maxpackets controls exist. |
| `q3.ui.team-arena-scripts-feeders-visibility` | Q3 | Team Arena scripts, feeders and owner draws | open | The legacy menu runtime loads Team Arena scripts only for the mission HUD (ui/testhud.menu); the Team Arena front-end menus (ui/menus.txt, feeders, server refresh, mod/media services) are replaced by common frontend menus rather than executed. |
| `q3.ui.team-arena-skirmish` | Q3 | Team Arena skirmish launch and next match | closed | Team Arena skirmish levels 1-5 are built in startup selection (player/opponent teams, map, skill) and launched through the application; the results menu offers next, retry, demo and quit. |

## localization-accessibility — 10 retained rows (10 closed, 0 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.accessibility.contrast-color` | Q1 | Contrast and color-accessibility settings | closed | Settings expose high-contrast, reduced-flash, bold typeface and blue-yellow or monochrome color modes, persisted per seat through shared settings and applied to the HUD and menu fonts and skin colors. |
| `q1.accessibility.subtitles-captions` | Q1 | Timed subtitles and sound captions | closed | Timed sidecar captions (SRT/VTT) are consumed by the seat HUD for sound voices and cinematics, selected by language; OGV playback exists. Q1 captions come from source-authored sidecars, not a separate mapping table. |
| `q1.text.localization-overlays` | Q1 | Localization, fallback and mod overlay precedence | closed | Q1 messages are resolved through Q1MessageLocalization with ordered base, fallback and mod overlay tables, bound to the selected language; the finale shares the same instance, so it is not English-only. |
| `q2.accessibility.color-and-captions` | Q2 | Complete readable non-color-only and caption workflows | closed | SeatSoundCaptions follows actual mixer voices and sidecars into the HUD captions list, and cinematic subtitles are produced by SeatMediaCaptions; color modes are non-color-only alternatives. |
| `q2.accessibility.contrast-typeface` | Q2 | Choose contrast backgrounds and alternate typefaces | closed | High contrast, blue-yellow and monochrome color modes and a bold alternate typeface are settings bindings per seat, stored in archived cvars and applied to HUD and menu fonts; a test covers persistence. |
| `q2.accessibility.independent-scales` | Q2 | Scale menus, HUD, and console independently | closed | Per-seat archived hudScale, textScale and menuScale cvars feed the HUD, the in-game and startup menus, and the console uses its own archived con_scale. |
| `q2.media.timed-subtitles` | Q2 | Display timed cinematic subtitles and captions | closed | Offline, remote and startup cinematics pass a SeatMediaCaptions producer into CampaignCinematic, which draws timed subtitle and sound captions over the picture using the seat's caption preference and language. |
| `q3.media.subtitles-captions` | Q3 | Timed subtitles and captions for supplied media | closed | Screen cinematic captions and sound captions flow from caption data through SeatMediaCaptions to the seat UI captionCommands timeline renderer, gated by the captions preference. |
| `q3.presentation.accessibility-scales` | Q3 | Readable UI, independent scales and accessibility | closed | Per-seat HUD, text and menu scales, high contrast, colour modes, reduced flashes, captions toggle and language selection are archived cvar settings with a persistence test, and captions render through the seat UI. |
| `q3.presentation.fonts-and-glyphs` | Q3 | Bitmap, proportional and Team Arena glyph fonts | closed | The application constructs RendererFontRegistry with generation services (generated atlas registration, font-data saving, user-directory export), so the FreeType generation path is available alongside bitmap and DAT fonts. |

## progression-services — 11 retained rows (10 closed, 1 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.events.achievements` | Q1 | Achievement persistence and player UI | closed | Q1 achievement events are recorded in a durable player-progress store and shown through the Achievements and progress library menu. |
| `q1.events.level-completed-lobby` | Q1 | Level-completed events and return-to-lobby lifecycle | closed | Level-completed events are recorded as durable progress and application completion calls returnToLobby on the local lobby service, with host, join, leave and readiness handled by the lobby. |
| `q2.service.achievements` | Q2 | Record authored achievement events durably | closed | Q1 and Q2 rerelease achievement events are recorded per participant in a durable PlayerProgressStore and shown in the player progress library. |
| `q2.service.match-report-lobby` | Q2 | Complete match reporting and lobby lifecycle | closed | Q2 match reports are built and recorded durably at match end and the local lobby service handles return-to-lobby and next session. |
| `q3.progression.difficulty-records` | Q3 | Difficulty-specific arena records | closed | BaseArenaProgression stores best rank per arena in g_spScores1 to g_spScores5 archive cvars and the selection menu shows the best rank and skill per arena. |
| `q3.progression.medals` | Q3 | Persistent medals and award thresholds | closed | Postgame results accumulate medal counts in the archived g_spAwards cvar with source thresholds, and the progress menu displays them. |
| `q3.progression.reset-and-unlock-commands` | Q3 | Progression reset and explicit unlock commands | closed | BaseArenaProgression owns the g_spScores/g_spAwards/g_spVideos archive cvars with reset, unlockLevels and unlockMedals; the application routes arena-reset, arena-unlock (iamacheater) and arena-medals to it and saves the source archive. |
| `q3.progression.team-arena-records` | Q3 | Team Arena skirmish scores and best times | closed | The Team Arena postgame command computes score, time and bonuses and writes the native games/<map>_<type>.game record on a new high score; ui_score cvars drive the results menu. |
| `q3.progression.tiers-videos-unlocks` | Q3 | Tier completion and movie unlocks | closed | Tier completion, training and final ordering, and movie unlocks via g_spVideos are implemented in BaseArenaProgression and driven by the application postgame hook. |
| `q3.services.authorization-endpoints` | Q3 | CD-key authorization and configurable service endpoints | closed | Q3ServerAuthorization resolves authorize.quake3arena.com, caches the endpoint as authorizeAddress and sends getIpAuthorize with sv_strictAuth; IPX is excluded and a client-side authorization counterpart exists. |
| `q3.services.rankings-lifecycle` | Q3 | Ranking login, match lifecycle and submission | open | Rank wire codecs and an application q3-rankings.ts exist, but no ranking login, match-lifecycle or submission service was verified as joined to a real or configurable endpoint; not fully traced. |

## demos-recording — 10 retained rows (10 closed, 0 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.demos.nq-record-playback` | Q1 | NetQuake demo recording, playback and timedemo | closed | playdemo, timedemo, record, stop and rerecord are registered for .dem recordings, with local NetQuake recording and playback through the demo library. |
| `q1.demos.qw-record-spectate` | Q1 | QuakeWorld demos, rerecord and spectator cameras | closed | QuakeWorld .qwd record, playback and rerecord are joined through the demo commands, and the remote QW client has a spectator camera with teleport and chase tracking. |
| `q2.demo.client-recording` | Q2 | Record and replay ordinary demos | closed | The record and stop commands record Q2 client demos from a live Q2 source through ClientDemoRecording and the local recording feed. |
| `q2.demo.gtv-streaming` | Q2 | Authenticate and stream GTV spectators | closed | mvdconnect and mvdisconnect authenticate to a GTV server and GtvRemoteSource streams MVD data into the remote application. |
| `q2.demo.mvd-recording` | Q2 | Record multi-view demos | closed | mvdrecord and mvdstop record the hosted Q2 world as a native multiview demo through the MVD recording feed. |
| `q2.demo.protocol-playback` | Q2 | Play supported classic and rerelease demos | closed | playdemo plays dm2 demos including KEX 2022 and 2023 headers, and MVD files, through Q2DemoPlayback into the remote application. |
| `q2.demo.server-recording` | Q2 | Record server demos | closed | serverrecord and serverstop record classic Q2 server entity footage from the hosted source. |
| `q2.demo.view-controls-seats` | Q2 | Control playback and recorded local viewpoints | closed | Demo playback has demopause, follow and chase player selection for MVD and GTV, and recorded KEX viewpoints preserve per-seat identities. |
| `q3.recording.demo-record-playback` | Q3 | Demo recording and legacy playback | closed | Q3 demos are recorded from a live local server (gamestate seed and snapshots) and played back through q3-demo/recorded-source via the demo command with clock handling. |
| `q3.recording.timedemo` | Q3 | Timedemo clocks and performance reporting | closed | Q3 uses the source timedemo cvar: RecordedRemoteSource honours it, the Q3 demo clock runs unthrottled, and end-of-demo timing is printed via demoTimingText. The timedemo command itself is registered only for Q1/QW, matching source. |

## cinematics-media — 6 retained rows (6 closed, 0 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q2.media.cin-video` | Q2 | Decode and present classic CIN frames | closed | CampaignCinematic decodes and presents CIN (with OGV fallback), is used by the offline Q2 campaign, remote server requests and the startup frontend; a test plays, skips and completes unit CINs. |
| `q2.media.pause-skip-transition` | Q2 | Pause, skip, and finish cinematic transitions | closed | Cinematics pause (clock and audio), skip on input after one second and complete into the next travel target or quit via the movie completion hook; a test covers pause, skip, completion and failure fallthrough. |
| `q2.media.rerelease-formats` | Q2 | Play required rerelease and expansion media formats | closed | The shared cinematic path plays CIN, RoQ and OGV (Ogg Vorbis/Theora demux) and falls back from .cin to .ogv for rerelease content; decoder tests cover all three. |
| `q2.media.static-pcx` | Q2 | Present static PCX intermission images | closed | CampaignCinematic accepts .pcx names via cinematicPcx as held stills with skip, and the Q2 travel grammar routes picture destinations to it. |
| `q3.media.cinematic-clock-transitions` | Q3 | Cinematic timing, looping, hold and skip | closed | The cinematic command opens a system cinematic with loop/hold/silent modes, skip and stop handles, and on completion queues the nextmap command and clears it. |
| `q3.media.world-and-menu-video` | Q3 | World material and menu cinematics | closed | ApplicationAssets passes materialMovie as the SceneShaderRegistry cinematic provider so videoMap stages resolve, and CinematicImage reallocates on frame dimension change. |

## tools-diagnostics — 6 retained rows (5 closed, 1 open, 0 descoped)

| ID | Family | Original title | Current state | Current reason |
|---|---|---|---|---|
| `q1.tools.chase-camera-diagnostics` | Q1 | Runtime chase camera and diagnostic commands | closed | The presentation view owner applies a traced Q1 chase camera from the viewsize chase settings to the local view, and the chase cvars toggle it. |
| `q3.cameras.spline-runtime` | Q3 | Spline camera evaluation and timed camera events | closed | ApplicationSplineCamera registers load/save/control camera commands and its apply hook is passed into every WorldSeatPresentation view; tests cover spline evaluation and the workflow. |
| `q3.diagnostics.omnitimer` | Q3 | OmniTimer initialization, stamps and reporting | closed | OmniTimer is a core runtime profiler owned by ApplicationTools, with timers on/off/reset/report/stamps and timerstamp commands and async measurement hooks. |
| `q3.diagnostics.runtime-tools` | Q3 | Runtime diagnostic and developer commands | closed | ApplicationTools registers timers, timerstamp, meminfo, path, dir, touchFile, resourceinfo, frameinfo and renderer diagnostics (imagelist, shaderlist, modellist, skinlist, modelist, gfxinfo) against the live owners, alongside cmdlist/cvarlist/soundinfo/midiinfo. Exhaustive comparison with every source developer command was not done. |
| `q3.recording.screenshots-levelshots` | Q3 | Screenshots, levelshots and capture timing | closed | Screenshot/levelshot commands and formats ship, and capture frames are timed from cl_avidemo, timescale and cl_forceavidemo in both the local and remote applications. |
| `q3.source-applications.role-accounting` | Q3 | Separate authoring and distribution application roles | open | Remaining: no Quake III map compiler (q3map), QVM assembler (q3asm/lcc) or SDK/archive packer exists in the repository; the AAS compile role is tools/navigation/aas.ts and the runtime roles are implemented. Not started: a q3asm-compatible assembler would be a new tool. |

This table was produced by a one-off script that is no longer in the tree (see the note at the top).
