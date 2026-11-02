# GAPAPP2 — Round 2 gap review: remaining src/app/bootstrap helpers and unread network files
## Coverage
Audited at HEAD fcdc8af5. The scope list is `<scratchpad>/gapapp2/list.txt`: 153 files, 12,990 lines. It was computed by removing what APP, GAPAPP, NET and GAPNET report as read in full. `src/app/bootstrap/simulation/**` is out of scope.

Read in full, line by line (all 153 files):
- ui.ts, renderer.ts, renderer-diagnostics.ts, render-settings.ts.
- effects/: particles, q2-muzzle, q2-view, q3. audio/: music, q2-events, commands, menu, output-settings, playlist, playlist-settings, q3. audio-settings.ts.
- q3-client/: assets, client-state, collision, cvars, equipment, guest-collision, overlay, qvm-display, qvm-scalars, scene, services, source, status, userinfo, view, visibility.
- selected-q3-presentation.ts, rerelease-presentation.ts, rerelease-presentation/fog.ts, seat-hud-state.ts, server-administration.ts, addon-library.ts.
- application-tools, authored-start, base-arena-* (6 files), campaign-cinematic, campaign-unit, capture, client-bootstrap, component-* (7 files), console, controller-settings, cvar-archives, diagnostic-tools, finale, frame-clock, frame-time, frontend-preferences, game-prompt, gtv-commands, image-reader, index, input-devices, keys, loading, local-lobby, local-seat-change, match-modes, match-preflight, menu-art, menu-font, model-loader, mod-selection, native-held-weapon, native-q2-client, original-save, player-death, player-progress, player-progress-library, player-service-status, player-userinfo.
- q1-client-commands, q1-client-settings, q1-fog, q1-localization, q1-service-presentation, q1-session-actions, q1-source-cvars, q1-wheel, q2-client-commands, q2-console, q2-damage-blend, q2-localization, q2-match-reports, q2-match-ui, q2-native-hud, q2-travel, q3-common-cvars, q3-map-command, q3-product, q3-rankings, q3-selected-weapon.
- remote-components, remote-seat-identities, remote-seat-pump, remote-seat-source, remote-seats, remote-seat-view, save-requests, shared-setting-cvars, sound-captions, startup-audio, startup-commands, startup-config, startup-input-profile, startup-source, startup-timing, team-arena-* (5 files), video-restart, view-settings, weapon-behavior-selection, weapon-behavior-tool, weapon-behavior-tool-options, weapon-hud, weapon-view.
- network/: index, q1-types, q2-remote-view, q2-rerelease-hud-events, q2-service-presentation, q3-client-content, q3-types, qw-camera, qw-server-types, qw-types, remote-q1 (390, previously sampled), remote-world, types, unified-component-publication, unified-native-components, unified-native-consumer, unified-types.

Sampled or skipped in scope: none. Limits on that reading: the q2-muzzle.ts and q2-events.ts tables were read for structure and failure behavior, and I did not compare each value with the original sources. The weapon-behavior tool is CLI-only and got a lighter logic check.

Read outside scope only to complete a trace: foundation/event-ring.ts head, content/mounts/paths.ts, mounts/index.ts:328-350, compat/qvm/file-syscalls.ts:128-150 and 218-252, compat/qvm/client-render-syscalls.ts:47, render/scene/textures.ts:130-270, audio/bank.ts:50-55, audio/engine.ts:55-66, content/q3/presentation/resources.ts:60-160, players.ts:443-444 and 520-540, local-entities.ts:107-126, network/q3/visibility.ts:42-82, network/q2/connectionless.ts:158-197, core/commands/index.ts:466-470 and 675-697, ui/hud/q2-native.ts:60-85, content/catalog/addons.ts:65-116, media/playback.ts:183-195, application.ts and remote-application.ts call sites.

Experiments are `<scratchpad>/gapapp2/exp1.ts` to `exp4.ts`, run from the clean checkout with HOME under the scratchpad and the corpus at <game-data>. No window was opened and no full client or server ran, so each "delivery to the run loop" statement below is traced, not observed. Timings come from one machine.

## Strengths
- Lifetime discipline is strong. renderer.ts, video-restart.ts, remote-seat-source.ts, remote-seat-view.ts and selected-q3-presentation.ts use prepare/publish/discard phases and collect cleanup failures into AggregateError without losing the original.
- `loading.ts` and `remote-seat-pump.ts` handle rejection and retirement races carefully and leave no floating rejection.
- `q2-travel.ts`, `campaign-cinematic.ts:54`, `team-arena-demo.ts` and `original-save.ts:54` validate paths before use. The same is not true of the paths in GAPAPP2-001 and -002.
- `registerQ3ModelRequest` and `registerQ3ShaderRequest` (q3-client/assets.ts:21-32) are the correct pattern for untrusted names: an invalid path becomes a default result.
- `effects/particles.ts` respects its 4096 cap in every loop, including trails with huge or infinite lengths. I tried to break `q1Trail` and `q2DiminishingTrail` by reading them and could not produce an unbounded loop.
- Limited rcon is not injectable through `;`. `executeCommandAsync` treats the line as one command (reproduced: `status;secret` runs nothing, and `status x;secret` passes `x;secret` as an argument).
- QW sounds missing on the client are tolerated end to end (remote-seat-source and remote-qw.ts:163-165), which refuted a candidate finding at remote-q1.ts:212-214.
- `UnifiedComponentPublisher` throws are caught per peer at unified-server.ts:242, so they drop one client rather than ending the server.

## Findings
### GAPAPP2-001 — A Q3 player model containing `//` or `/./` makes the QVM file open reject, ending clients that run the original cgame
- **Verification (VERIFY-Q): confirmed. Final severity: High.** The model is split at the first slash (`cgame/cg_players.c:974-981`), and id's file open filters only `..` and `::` (`qcommon/files.c:1054`), so an odd spelling is a miss, not a fault. Source review: SRCQ3
- Severity: High
- Category: security
- Location: src/compat/qvm/file-syscalls.ts:138-139; src/content/mounts/index.ts:335; src/content/mounts/paths.ts:4-11; src/app/bootstrap/q3-client/assets.ts:133-134; src/compat/qvm/client-render-syscalls.ts:47; src/app/bootstrap/q3-client.ts:495
- Confidence: reproduced (the rejection, with real q3-baseq3 mounts); traced for the cgame path; no full client was run
- Evidence: `QvmFiles.open` filters only one spelling: `if (path.includes("..") || path.includes("::") || path.includes("q3key")) { ... }` followed by `await this.services.mounts.open(path)`. `normalizeResourcePath` throws on any empty or `.` segment. Reproduced: `files.open("models/players/sarge/lower_/x//y.skin", null)` and `lower_x/./y.skin` give `RangeError: Invalid relative resource path`, while the `..` form correctly returns 0. Delivery: the port at players.ts:443-444 splits the model at the first slash (`path.indexOf("/")`), which I take to mirror the original cgame, so `model "sarge//x//y"` gives model `sarge` and skin `/x//y`. The model files load, then the skin lookup builds `models/players/sarge/lower_/x//y.skin`. The retail vm/cgame.qvm in pak8.pk3 contains the format strings `models/players/%s%s/%s_%s.%s` (checked). The FS_FOPENFILE syscall has no catch, and q3-client.ts:495 rethrows frame failures. The neighbouring host method has the same gap: `skin: async path => { ... provider.mounts.open(path)` (assets.ts:133) has no guard, unlike model and shader at lines 21-32, and `client-render-syscalls.ts:47` passes `""` for a null name, so `trap_R_RegisterSkin` with an empty or malformed name also rejects. The original returns 0 there.
- Impact: Any player on a Q3 server sets one userinfo string. The server relays it in CS_PLAYERS, and each client of this engine running a QVM cgame exits when it loads that player's info. The sender needs no server privileges. This is the Q3 counterpart of GAPAPP-001, through a different path filter.
- Remediation: Make the QVM open treat an invalid path as not found by catching RangeError, and wrap the `skin` host method like its siblings. See the root-cause note in Supplements.

### GAPAPP2-002 — Picture, sky and music names with `..` or `//` reject during the frame and end the process
- **Verification (VERIFY-D): confirmed. Final severity: High.** textures.ts:177 `reader.read(path)` is outside the try at :180; bank.ts:51 `content.open(path)` precedes the try at :53. Both throw via normalizeResourcePath on server-supplied sky/pic/music/skin names during frame prep with no catch. Confirmed.
- Severity: High
- Category: security
- Location: src/render/scene/textures.ts:176-177; src/audio/bank.ts:50-55; src/app/bootstrap/q2-native-hud.ts:36-37; src/ui/hud/q2-native.ts:60-61, 85; src/app/bootstrap/q1-service-presentation.ts:91-93; src/app/bootstrap/network/remote-q1.ts:193-194; src/app/bootstrap/rerelease-presentation.ts:174; src/app/bootstrap/audio/music.ts:231-239, 248; src/app/bootstrap/q3-client/services.ts:64; src/app/bootstrap/presentation.ts:245, 358, 371
- Confidence: reproduced (each rejection, against real q2 and q3 mounts); traced (delivery)
- Evidence: The texture loader's "cannot be decoded is skipped" guard begins after the read: `const asset = await this.reader.read(path);` (177) sits outside the `try`. `openMusic` guards only the decoder: `const opened = await this.content.open(path);` (51) precedes `try { return openPcmBytes(...)`. Reproduced: `textures.load("pics/../x.pcx")`, `"pics/a//b.pcx"` and `"env/../x"` throw RangeError where `"pics/nosuch.pcx"` returns null. `ApplicationQ2NativeHud.prepare` with layout `xv 0 yv 0 picn ../../etc/x` throws `Invalid relative resource path: pics/../../etc/x.png`. `Q1ServicePresentation.prepare` with skybox `../x` throws for `gfx/env/../xrt.tga`. `openMusic("music/../x.wav")` and `"music/a//b.wav"` throw. Sources of these names: FitzQuake `svc_skybox` from a remote server (remote-q1.ts:194); Q3 CS_MUSIC through `startBackgroundTrack` (services.ts:64); a worldspawn `music` or `sounds` key (music.ts:17-21); rerelease sky events; and the native Q2 HUD, where `client` layout tokens build `/players/${skin}_i.pcx` from a player's config string (q2-native.ts:60-61). presentation.ts:358 and :371 await these without a catch.
- Impact: A hostile NetQuake or Q3 server ends a connected client with one message. A map with `"music" "music//track"` ends the game for anyone who loads it, though the original engines tolerate that spelling. On a listen server running a native Q2 DLL, a peer with skin `../x` ends the host when the scoreboard layout shows him, assuming the DLL relays the skin as the original does. Unified servers can do the same through replicated HUD layouts (unified-native-components.ts:81). The remote classic Q2 path does not use this HUD: `nativeLayout` (remote.ts:154) has no reader.
- Remediation: Move the read inside the existing `try` in the texture loader and return null from `openMusic` for an invalid path. Both changes are one line and cover every caller above.

### GAPAPP2-003 — A Q2 point of interest or pickup whose picture is absent or absolute ends the game
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** weapon-hud.ts:65 throws on a null texture and is reached from seat-hud-state.ts:58,66,71 through ui.ts:132 with no catch. The unset-index throw is at q2-rerelease-hud-events.ts:15-17. Limited to rerelease content.
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/weapon-hud.ts:64-65; src/app/bootstrap/seat-hud-state.ts:58, 66, 71; src/app/bootstrap/ui.ts:132; src/app/bootstrap/network/q2-rerelease-hud-events.ts:15-17
- Confidence: reproduced (`load` rejects and the rejection is cached); traced (delivery)
- Evidence: `if (texture === null) throw new Error(`Weapon HUD image missing: ${key}`);` turns a normal miss into a rejection, and the helper built for weapon icons is also used for game-supplied pictures: `poi.image = await icons.load({ kind: "image", resource: { content: poi.content, path: `pics/${poi.path}.pcx` } });`. Reproduced: `Weapon HUD image missing: q2-x/pics/nosuch.pcx/`, and a second call returns the same cached rejection. World load accepts absolute image names (`image.startsWith("/")`, remote-application.ts:1238), but this path concatenates them into `pics//foo.pcx`, which throws through GAPAPP2-002. The unset index case is also fatal: `throw new Error("Q2 POI image " + value.image + " has no configstring")`, reproduced.
- Impact: A rerelease mod or server that references a picture the client lacks, added after world load, ends the session instead of drawing nothing. Offline, this comes from the mod's own game DLL. q2repro falls back to a missing-image handle.
- Remediation: Have `load` report absence as null for the POI, pickup and damage paths, and skip the draw. Honor the leading `/` as world load does.

### GAPAPP2-004 — A negative `cl_avidemo` or `timescale` raises RangeError in the frame clock and ends the process
- **Verification (VERIFY-E): confirmed. Final severity: High.** diagnostic-tools.ts:30 throws per frame and application.ts:1341 registers cl_avidemo with flags 0. The hostile path holds: q3-client.ts:267 writes the owner adopted at remote-application.ts:1395, which is the registry read at :2154-2157, and that step's catch rethrows. One systeminfo string from an untrusted server exits the client.
- Severity: Medium
- Category: robustness
- Location: src/app/bootstrap/diagnostic-tools.ts:30; src/app/bootstrap/frame-time.ts:63-64, 80-81; src/app/bootstrap/application-tools.ts:63-67; src/app/bootstrap/application.ts:4557-4560; src/app/bootstrap/remote-application.ts:2155-2159; src/app/bootstrap/remote-seats.ts:42
- Confidence: reproduced (real CvarRegistry and real functions); traced (run loop has no catch, per APP-001)
- Evidence: `if (![elapsed, options.fps, options.timescale].every(Number.isFinite) || elapsed < 0 || options.fps < 0 || options.timescale < 0) throw new RangeError("Invalid capture clock");` runs every frame on values read straight from cvars. Reproduced results: q1-netquake `timescale -1` stores and throws; q2-classic and q3 `cl_avidemo -1` and `timescale -1` store and throw; q2 and q3 `timescale 1e999` throw `Frame time controls must be finite`; q3 `timescale 1e30` throws `Undefined native common float-to-int time conversion`. Q1 registers timescale with no cheat flag (frame-time.ts:45), and application.ts:1341 registers `cl_avidemo` with flags 0, so neither needs cheats. My script set Q2 and Q3 `timescale` through an unprotected registry, so cheat enforcement on those two was not exercised.
- Impact: One console typo ends a session, and a QuakeC `cvar_set` or a script does the same. A hostile Q3 server can send `\cl_avidemo\-1` in systeminfo, because GAPAPP-002's force-write excludes only `cl_allowdownload` and the frame-time names, and that ends the client immediately. Unsaved progress is lost.
- Remediation: Clamp or ignore invalid values with a warning instead of throwing, or reject them with `bindValue` validation at set time.

### GAPAPP2-005 — Q2 record translation throws on values the original client ignores
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** The sound half is proven: cl_parse.c:634 returns on an empty precache slot. The flash half is wrong about the original: cl_fx.c:446-448 indexes monster_flash_offset with no bounds check, reading out of bounds rather than ignoring the value. Dropping it is still right, but it is not parity. Source review: SRCQ2
- Severity: Medium
- Category: robustness
- Location: src/app/bootstrap/network/q2-service-presentation.ts:63-64, 76; src/app/bootstrap/native-q2-client.ts:41; src/content/q2/foundation/monsters/muzzle.ts:579; src/app/bootstrap/effects/particles.ts:103-104; src/network/q1/netquake.ts:154
- Confidence: reproduced (the throws); traced for the remote path; the local native caller's handling was not traced
- Evidence: `if (path === undefined) throw new Error(`Q2 sound ${event.sound.index} has no configstring`);`. Reproduced with index 0. As I recall it, the original returns early when the precache slot is null, and a game can call `gi.sound` with index 0 because `gi.soundindex("")` returns 0. `muzzleOffset("classic", 240)` throws `Monster source table index 240 outside 212`, and `muzzleOffset("rerelease", 1000)` throws `outside 290`, on a wire-supplied flash, while audio.ts:538 and effects.ts:541 already treat an unknown flash as non-fatal. The same class exists in Q1: `q1ColorExplosion` throws on `colorLength` 0, and netquake.ts:154 decodes that byte unvalidated. `translateQ2ServiceRecords` is also the path for local game DLL messages (native-q2-client.ts:41).
- Impact: These messages are well formed, so this is narrower than NET-005's malformed datagram. A modded server or native DLL issuing a zero sound index or an extended flash ends the client. Colored explosion with length 0 divides by zero in the original too, so that one is parity with a crash, not a regression.
- Remediation: Drop the record and print once, matching the handling at audio.ts:538.

### GAPAPP2-006 — The caption tracker keeps every played voice for the world's lifetime under a QVM cgame
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** sound-captions.ts:18-22 subscribes unconditionally, the only deletion is in prepare (:27), and ui.ts:117-121 returns before the only call at :135. Bounded by world replacement, as the finding states.
- Severity: Medium
- Category: leak
- Location: src/app/bootstrap/sound-captions.ts:18-23, 25-28; src/app/bootstrap/ui.ts:117-121, 135; src/app/bootstrap/application.ts:1987, 3007, 3878
- Confidence: reproduced (retention); traced (the guest condition)
- Evidence: The constructor subscribes unconditionally: `if (event.kind === "start") this.voices.set(event.voiceId, { event, captions: null, language: "", stopSample: null });`. The only deletion is in `prepare`, and the only caller is ui.ts:135, which the guest branch returns before reaching: `if (this.guestUi) { ... return; }`. `guestUi` is `sourceClient?.kind === "qvm"` at all three local construction sites. Reproduced: 200,000 start and stop pairs with no `prepare` left `voices.size` at 200000, and one `prepare` then reduced it to 0.
- Impact: Under a local QVM cgame, one Map entry and event object accumulate per sound played, until `ui.close` at world replacement. Growth scales with sound events, for example 36,000 entries over 20 minutes at 30 sounds per second. A long hosted session on one map keeps growing. The entries also pin their sound assets past their use. Remote seats are unaffected because their `guestUi` is false.
- Remediation: Do not subscribe when `guestUi` is true, or delete on the `stop` event once `captions` is null.

### GAPAPP2-007 — Local-entity lookup rebuilds and freezes the active list for each reference each frame
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** effects/q3.ts:151 calls activeEntities() per reference, and local-entities.ts:117-121 allocates and freezes a new array each call. :180 and :198 are as quoted. The timing was not re-measured.
- Severity: Medium
- Category: performance
- Location: src/app/bootstrap/effects/q3.ts:151, 180, 198; src/content/q3/presentation/local-entities.ts:23, 117-121
- Confidence: traced; the timing is a synthetic model of the same operations, not a game profile
- Evidence: `const owner = this.effects.pool.activeEntities().find(local => local.refEntity === ref)` runs in `addRefEntity`, and `activeEntities()` allocates a new array by walking the list and calling `Object.freeze`. The result is used only for `owner?.radius`. The pool holds up to 512 entries. A synthetic loop of list, freeze and find per reference took 0.73 ms per frame at 64 entries, 8.58 ms at 256 and 31.17 ms at 512. `frame` also builds `new Map(this.models.map(...))` per view, and calls `renderer.prepare([model], ...)` once per model.
- Impact: Gib showers and smoke bursts are the cases that raise the count, so the frame time spike coincides with heavy action. Near the cap this cost alone can exceed a 16 ms frame.
- Remediation: Pass the owning local entity through `addEntities`, or keep a per-frame WeakMap from reference to radius.

### GAPAPP2-008 — Each source-sync Q3 asset owner reads, digests and retains every sound in the mount plan
- **Verification (VERIFY-I): confirmed. Final severity: Low.** q3-client/assets.ts:80-84 reads and retains every matching file for non-guest-async owners, and selected-q3-presentation.ts:94 creates a source-sync owner. An independent listing of baseq3 pk3s gives 598 sounds and 42.9 MiB, matching the finding.
- Severity: Low
- Category: performance
- Location: src/app/bootstrap/q3-client/assets.ts:80-84, 144; src/app/bootstrap/selected-q3-presentation.ts:94
- Confidence: reproduced (size and time for one mount plan)
- Evidence: `const synchronous = mode === "guest-async" ? [] : [...result.names].filter(path => /\.(?:menu|hud|txt|cfg|voice|vc|h)$/i.test(path) || /^sound\/.*\.(?:wav|ogg)$/i.test(path));` then `result.retained.set(path, opened)`. On q3-baseq3 from the corpus this is 685 files and 43.2 MB, of which 598 sounds are 42.9 MB. It took 214 ms with a warm page cache and added 43 MB of RSS. `selected-q3-presentation.ts:94` creates one owner per seat and per source generation.
- Impact: About 43 MB per owner and a load stall at each creation, larger with installed sound packs. Combined with the orchestrator's map-travel leak, an owner retained in an old world keeps these bytes as well. A mod package with many sounds scales this directly.
- Remediation: Share one retained table per mount plan across owners, or read sounds on first `sound()` request where the caller can await.

### GAPAPP2-009 — Native Q2 HUD picture tables grow with layout names and each new name costs file probes in the frame
- **Verification (VERIFY-I): confirmed. Final severity: Low.** q2-native-hud.ts:33-43 loads each new layout name and stores misses in ids and pictures. Only clear (:18) removes entries, and it runs on content change (:22).
- Severity: Low
- Category: leak
- Location: src/app/bootstrap/q2-native-hud.ts:33-43, 18, 22
- Confidence: reproduced (timing and growth, one machine)
- Evidence: `names` comes from layout operations, and each new one is loaded: `this.ids.set(name, id); this.pictures.set(id, { kind: "image", name: path, image });`. Misses are stored too, and only `clear()` removes entries, which runs on content change or image refresh. Reproduced with real q2 mounts: 40 unique `picn` names added 40 table entries and took 24.7 ms in one `prepare`, because each probes every image extension.
- Impact: A game module or unified server that varies picture names per layout causes a frame stall and table growth for the world. This belongs with GAPNET-006's class of unbounded client state. It is not a crash on its own.
- Remediation: Cap distinct names per world and stop loading past the cap, printing once.

### GAPAPP2-010 — Remaining per-frame allocation in UI and client helpers
- **Verification (VERIFY-I): confirmed. Final severity: Low.** ui.ts:136-142, q3-client/source.ts:75-76, q3-client/visibility.ts:20, :51 and :64-68, rerelease-presentation.ts:112 and :210-212, and effects/particles.ts:32 all allocate as stated. The finding's own measurements correctly keep this at Low.
- Severity: Low
- Category: performance
- Location: src/app/bootstrap/ui.ts:136-142; src/app/bootstrap/q2-native-hud.ts:32-33; src/app/bootstrap/rerelease-presentation.ts:112, 210-212; src/app/bootstrap/q3-client/source.ts:75-76; src/app/bootstrap/q3-client/visibility.ts:20, 51, 64-68; src/app/bootstrap/q3-client/scene.ts:36, 66; src/app/bootstrap/effects/particles.ts:28-32; src/app/bootstrap/network/remote-q1.ts:357-358; src/app/bootstrap/selected-q3-presentation.ts:149
- Confidence: traced; particles timing reproduced
- Evidence: `await Promise.all(ui.items.filter(...).map(async item => { const icons = await assetsOwner.prepare({ ...status, item: item.id }); ...` runs per seat per frame even when every icon is cached. `q3-client/source.ts:75` allocates a 1024-element array per seat per `receive`. `visibility.ts:51` allocates an `EntityStateRecord` for each entity number gap, and `:64-68` computes a PVS byte with eight `clusterVisible` calls per cluster test. `rerelease-presentation.ts:210-212` re-localizes the story per frame and copies a Map each time. `q2.unshift(sample)` in particles.ts:32 is quadratic, but measured only 1.49 ms at the 4096 cap, against 0.63 ms for the Q1 path.
- Impact: Individually modest, and the particle figure shows these are not bottlenecks in isolation. They add to APP-014 and GAPAPP-018, and they raise GC pressure.
- Remediation: Skip icon preparation when the owned item set is unchanged, reuse the configstring array, and build PVS lookups from the cluster bitset directly.

### GAPAPP2-011 — Parsable but out-of-range settings files stop the launch
- **Verification (VERIFY-I): confirmed. Final severity: Low.** audio-settings.ts:12-16 throws for effectsVolume above 1, and view-settings.ts:30 throws for FOV above 160. configuration.ts:366 is outside any try, and the catch at :441-447 only cleans up and rethrows. server-administration.ts:56 is an unguarded JSON.parse.
- Severity: Low
- Category: robustness
- Location: src/app/bootstrap/audio-settings.ts:12-16, 25-29; src/app/bootstrap/view-settings.ts:42-48, 30; src/app/bootstrap/cvar-archives.ts:15-22; src/app/bootstrap/player-progress.ts:35-42; src/app/bootstrap/server-administration.ts:56-62; src/app/bootstrap/configuration.ts:366, 377, 389
- Confidence: traced
- Evidence: Comments state the policy, then the next line reverses its effect for the user: "Text that is not JSON behaves like the absent document; parsed values still face the preferences validation below." `preferences` throws `Invalid audio preferences` for `effectsVolume` above 1, and `setFieldOfView` throws RangeError for `fieldOfView` 170 in view.json. configuration.ts awaits these with no catch. `ServerOperatorState.open` uses an unguarded `JSON.parse` (line 56), so its handling differs from the others.
- Impact: A hand edit, or a file from another version, makes the game refuse to start with a crash entry, while a fully corrupt file starts fine. The player must find and delete the file. For the server filter file, failing closed is defensible, but the other files hold only preferences.
- Remediation: For preferences, print a warning and use defaults. Keep the strict behavior only for the operator's IP filter list.

### GAPAPP2-012 — Optional mod files are treated as fatal in frame paths
- **Verification (VERIFY-I): confirmed. Final severity: Low.** q1-wheel.ts:42 (from ui.ts:131), native-held-weapon.ts:33 (from presentation-scene.ts:241), q3-selected-weapon.ts:36 and :102, and finale.ts:44 all throw on these conditions with no local fallback. As the finding says, whether launch preflight excludes the held-weapon case is unestablished.
- Severity: Low
- Category: robustness
- Location: src/app/bootstrap/q1-wheel.ts:41-42; src/app/bootstrap/native-held-weapon.ts:32-33; src/app/bootstrap/q3-selected-weapon.ts:35-36, 102; src/app/bootstrap/finale.ts:43-44
- Confidence: traced
- Evidence: `if (parsed.errors.length !== 0) throw new Error(`Invalid authored weapon wheel: ${parsed.errors.join("; ")}`);` runs from `ui.prepare` on a mod's `wwheel.txt`. `if (definition === null) throw new Error(`Native held model ... requires ${path}`);` applies to any carrier digest outside the built-in table, so a custom player model plus a selected arsenal reaches it through presentation-scene.ts:241. `Selected Q3 hands model has no ${tagName}` throws per frame. `Quake finale picture is absent` throws from `prepare`.
- Impact: One bad line in an optional file, or one custom model, ends the session rather than losing a cosmetic. I did not confirm whether launch preflight excludes the held-weapon combination, as GAPAPP's APP-001 supplement also noted.
- Remediation: Report and fall back: default wheel, no held model, no banner.

### GAPAPP2-013 — "Remove installed add-on" and updates never free disk space
- **Verification (VERIFY-I): confirmed. Final severity: Low.** addon-library.ts:210-215 only creates a tombstone. The rm calls at :181 and :192-197 target tombstones or staging, and content/catalog/addons.ts:111-116 only tests the tombstone. No purge path exists.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/addon-library.ts:92, 173, 181, 192-197, 210-215; src/content/catalog/addons.ts:111-116
- Confidence: traced
- Evidence: `hide` only creates a tombstone file: `store.open(`.addons/removed/${this.contentParent}/${directory}`, "write")`. Every `rm` in the file targets a tombstone or the staging directory (180, 185, 190, 195). The UI reports `Removed ${item.title}`, and each update hides the previous directory. Downloaded archives stay in `.addons/<sha256>.zip` as well. I found no purge elsewhere in the catalog code.
- Impact: Every removed or superseded package stays on disk permanently, invisible to the player, who has no way to reclaim the space from the UI.
- Remediation: Delete the directory after the catalog refresh succeeds, keeping the tombstone only until then, and offer cache cleanup.

### GAPAPP2-014 — Add-on catalog refresh can block the browser indefinitely
- **Verification (VERIFY-I): confirmed-with-changes. Final severity: Low.** The blocking is real (addon-library.ts:61, :80, :56), but "indefinitely" is wrong. Measured: this Bun's fetch against a silent local listener rejected with TimeoutError after 300.0 s, so the menu blocks for about 5 minutes per stall. The Cancel gap and the dropped cancel promises stand.
- Severity: Low
- Category: robustness
- Location: src/app/bootstrap/addon-library.ts:56, 61, 80, 217
- Confidence: traced
- Evidence: `await fetch(quaddictedCatalogUrl, { signal: this.abort.signal })` has no timeout, and `abort` fires only in `close`. While it is pending, `activate` returns at once: `if (this.pending !== null) return;`. The Cancel action only cancels the download queue: `this.cancelled = true; this.queue?.cancel();`, whose returned promise is also dropped at lines 56 and 217 without a catch.
- Impact: A stalled connection leaves the add-on menu unresponsive for local play and removal until the OS gives up, and a rejection from `cancel` would be unhandled.
- Remediation: Use `AbortSignal.any` with a timeout, let Cancel abort the fetch, and catch the cancel promise.

### GAPAPP2-015 — Small correctness defects in music and effects
- **Verification (VERIFY-I): confirmed. Final severity: Low.** music.ts:75 replaces the record that a pending startTrack holds, and :249-250 writes to the stale copy. A rejecting openTrack at :248 leaves intro open. effects/q3.ts:52, :56, :124-125, :151 and :223 show bloodOwners is never written.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/audio/music.ts:75, 218, 248-250; src/app/bootstrap/effects/q3.ts:52, 124, 151, 185, 223
- Confidence: traced
- Evidence: `select` replaces the record (`this.current = { ...this.current, source, fallback }`) while a pending `startTrack` holds the old object, so its later `current.looping = loop !== null` updates a stale copy and `cd info` reports the wrong state. At line 248, a rejection from `await open(loopName)` leaves the already opened `intro` stream unclosed, which GAPAPP2-002's paths can trigger. Separately, `bloodOwners` in Q3ApplicationEffects is created, read and deleted from, and never written (the only uses are the five listed), so `hiddenFor` is always undefined and the "hide this blood from its owner" logic at line 185 is dead.
- Impact: A wrong status line, one leaked decoder stream per failure, and a player seeing his own blood explosion if that source event is ever routed here. I found no caller supplying a blood owner.
- Remediation: Mutate the record in place in `select`, close `intro` in a `try`, and either wire up or delete `bloodOwners`.

### GAPAPP2-016 — The riskiest paths found here have no direct tests
- **Verification (VERIFY-I): confirmed. Final severity: Low.** Re-running the name grep gives exactly the stated counts: q2-native-hud 0, selected-q3-presentation 0, and the other six 1 each.
- Severity: Low
- Category: test-gap
- Location: tests/ (grep by module name)
- Confidence: traced (a name grep only; a test may reach a module indirectly)
- Evidence: Files in tests/ naming each module: q2-native-hud 0, selected-q3-presentation 0, sound-captions 1, seat-hud-state 1, weapon-hud 1, q2-service-presentation 1, addon-library 1, server-administration 1. I did not read those tests, so I cannot say what they assert. None of my reproductions above depended on an existing test case.
- Impact: The invalid-path cases in GAPAPP2-001 and -002, the guest branch in GAPAPP2-006 and the negative cvar values in GAPAPP2-004 are one-line tests that would have caught these defects.
- Remediation: Add table tests of `//`, `/./`, `..` and empty names across every mount-backed loader.

## Supplements
- Supplements GAPAPP-001: the root cause is general. `MountedContent.open` throws for any path that `normalizeResourcePath` rejects, while the original engines treat such a name as a plain miss. GAPAPP-001, GAPAPP2-001 and GAPAPP2-002 are all this one contract, so returning null from `open` (keeping the throw for the write path) would close them together and also cover call sites nobody has audited.
- Supplements GAPAPP-002: the forced cvar is not only a settings problem. `\cl_avidemo\-1` ends the client on the next frame (GAPAPP2-004).
- Supplements GAPAPP-015: more caches keep rejections: game-prompt.ts:59-63, q1-localization.ts:23-36, finale.ts:39-50, native-held-weapon.ts:29-36, q3-selected-weapon.ts:34-39 and 44, weapon-hud.ts:46-47 (reproduced), rerelease-presentation.ts:167-168. menu-art.ts:17-20 and rerelease-presentation.ts:161 show the correct eviction pattern.
- Supplements APP-010: gtv-commands.ts:16-18, 22-25 and 29-34, diagnostic-tools.ts:22, 24 and 71, renderer-diagnostics.ts:37 and 43, and save-requests.ts:4-5 and 10 report usage errors by throwing. startup.ts handles `mvdconnect` per APP-010's remediation note, but I did not trace each of the others through the borrowed dispatch path, so their reach is unconfirmed.
