# GAPAPP — src/app/bootstrap outside simulation/, network/ and the APP-read files

## Coverage
Scope is 23,824 lines (33,060 in the tree minus the 9,236 lines APP read in full). About 12,330 lines were read line by line. Roughly 11,400 were not. This is a partial review of the scope.

Read in full (12,328 lines): input.ts (1055), startup-menu.ts (973), startup-selection.ts (864), effects.ts (753), audio.ts (671), q3-client.ts (598), character-turntable.ts (549), presentation.ts (540), content.ts (538), prepared-startup.ts (497), presentation-state.ts (465), configuration.ts (448), server-browser.ts (436), presentation-scene.ts (418), mod-presentation.ts (417), mod-presentations.ts (389), assets.ts (366), q3-client/qvm.ts (348), image-settings.ts (274), q3-client/cinematics.ts (270), config-scripts.ts (193), demo-commands.ts (205), demo-recording-commands.ts (170), demo-local-recording.ts (151), startup-saves.ts (135), precache.ts (114), demo-recording.ts (115), server-browser-cache.ts (101), held-weapon.ts (75), demo-playback.ts (58), demo-library.ts (45), qvm-grapple-selection.ts (43), server-browser-addresses.ts (27), server-master-list.ts (27).

Sampled: video-restart.ts (lines 1-92 of 144), remote-seat-view.ts (lines 66-82).

Not read: ui.ts (428), renderer.ts (308), effects/** (796: particles, q2-muzzle, q2-view, q3), audio/** (music.ts 252 and the small helpers), q3-client/** other than qvm.ts and cinematics.ts (assets, client-state, collision, cvars, equipment, guest-collision, overlay, qvm-display, qvm-scalars, scene, services, source, status, userinfo, view, visibility), selected-q3-presentation.ts (223), rerelease-presentation/**, team-arena-*, base-arena-*, q1-*, q2-* helpers, remote-seat-source.ts, remote-seat-pump.ts, remote-seats.ts, server-administration.ts, seat-hud-state.ts, addon-library.ts, capture.ts, startup-config.ts, startup-audio.ts, frontend-preferences.ts, local-lobby.ts, console.ts, component-*.ts, weapon-behavior-*, and the remaining small helpers. The brief's list named q3-client/** and "the small helpers", so these are a real shortfall. No finding below implies those files are clean.

Read outside scope only to complete a trace: audio/bank.ts, content/mounts/paths.ts and mounts/index.ts:328-342, network/q3/discovery.ts:46-65, network/common/endpoint.ts:82-104, network/q1/message.ts, network/q1/quakeworld.ts:424-445, core/cvars/index.ts:448-500, render/scene/resources.ts:28-74, content/q2/base/player/index.ts:167-179, content/q2/base/entities/targets.ts:39-57, network/remote.ts:229-234, network/remote-q3.ts:105, network/remote-q1.ts:149-156, network/q2.ts:478-482, simulation/network-qw.ts:251-259, ui/common/controller.ts:75-86, application.ts and remote-application.ts call sites.

Experiments ran from the clean checkout with HOME pointed at the scratchpad, using <game-data> for corpus runs. Scripts are in the scratchpad's gapapp/ directory. Timings come from one machine.

## Strengths
- Save listing is cached by mtime and size, and malformed saves become a row with a reason rather than an error (startup-saves.ts:89-93, 127-129).
- Optional preloads are isolated per resource (precache.ts:100-109). Undecodable sounds become silence (audio/bank.ts:32-33).
- Recording write failures are contained: the client sink detaches and reports (demo-recording-commands.ts:142-151), and the server sink reports through network/q2.ts:479-482. Command-level recording errors print at startup.ts:1316.
- Character preview caches are bounded (`if (this.scenes.size >= 24) this.scenes.clear()`, character-turntable.ts:513) and rendering stops when not requested (line 536).
- writeQ3BrowserCache validates its own output by re-reading it (server-browser-cache.ts:99), so the app cannot write a cache it would later refuse.
- Master-list download is capped at 1 MiB and 4096 names, with a 4 s abort (server-master-list.ts:18, 25; server-browser.ts:232).
- ConsoleScriptFiles refuses remote-client origins on every read path and waits for reads and writes before retiring (config-scripts.ts:93, 123, 157, 167, 172-178).
- Candidate/publish staging of commands and bindings is consistent (prepared-startup.ts:438-497).
- Suspicions I tested and refuted, so not reported: `play <missing>` is caught and printed (application.ts:4326, remote-application.ts:1768-1792). The QW recording path cannot overflow on entity count, because the frame caps at 64 (simulation/network-qw.ts:256). Per-recipient particle images do not collide, because `register` allocates a distinct ordinal per call (render/scene/resources.ts:28-42). The `sounds` and `retiredOwners` maps are per-world, with owner keys that are few in practice.

## Findings

### GAPAPP-001 — A Q2 player skin of `..` makes the audio frame reject, ending the host or any client that hears that player
- **Verification (VERIFY-D): confirmed. Final severity: High.** audio.ts:548 stores `skin.split("/")[0]` as model; bank.ts:44 builds `#players/<model>/<name>`; normalizeResourcePath (paths.ts:8) throws on `..`/`.`/`//` (verified by running it). play/receive/frame await without try; runs in the fatal step. Skin from unfiltered userinfo. Confirmed.
- Severity: High
- Category: security
- Location: src/app/bootstrap/audio.ts:548, 309-316, 332-335, 355, 469, 587; src/audio/bank.ts:42-45; src/content/mounts/index.ts:335; src/app/bootstrap/network/remote.ts:233; src/app/bootstrap/network/q2-service-presentation.ts:37; src/content/q2/base/player/index.ts:170-173
- Confidence: reproduced (the rejection, against real mounts from the corpus); traced (delivery to the frame loop and process exit; no window was run)
- Evidence: `this.actor(event.actor).model = event.skin.split("/")[0] || "male"` (audio.ts:548) stores a peer-chosen string. `registerSexedSound` builds `#players/${selected}/${name}` (bank.ts:44), and `#open` calls `normalizeResourcePath` (mounts/index.ts:335), which throws. Reproduced with a real q2-classic-baseq2 mount: skin `..` gives `RangeError: Invalid relative resource path: players/../pain100_1.wav`, `.` gives the same shape, and `c:` gives `RangeError: Unsafe archive member path`. `nosuchmodel` and `a//b` correctly fall back to male. Nothing catches on the way out: `play` (355), `receive` (469) and `frame` (587) all await without a try, and the audio frame runs inside the step that APP-001 shows is fatal. Skin sources are unvalidated: the local game accepts any userinfo without `"` or `;` (`const valid = !source.includes('"') && !source.includes(";")`, player/index.ts:170), and a remote client takes the skin from a server config string (remote.ts:233). Only the preload path catches this (precache.ts:107). `this.sounds` also caches the rejected promise under the key (316), so a retry cannot recover.
- Impact: A client on a listen server sets `skin ../x` and takes any damage or jumps; the host process exits. On a public server, one player with that skin ends every other client of this engine when a `*` sound plays for him, assuming the server relays the string (a hostile server can send it directly). This differs from NET-005 and APP-002: the message is well formed, and the sender need not be the server.
- Remediation: Accept only a `[A-Za-z0-9_-]+` model name and fall back to male. Separately, catch rejections in `play` and print, as a missing sound is already treated.

### GAPAPP-002 — A Q3 server force-writes any client cvar, every frame
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** id also force-sets every systeminfo key through `Cvar_Set` (`client/cl_parse.c:363-374`, `qcommon/cvar.c:397`). The port's exclusion of `cl_allowdownload` is stricter than id. The real difference is per-frame reapplication, since id's function runs on systeminfo change. The ioquake3 flag filter is unverifiable here. Source review: SRCQ3
- Severity: Medium
- Category: security
- Location: src/app/bootstrap/q3-client.ts:257-273, 483; src/app/bootstrap/network/remote-q3.ts:105; src/app/bootstrap/remote-application.ts:1350; src/core/cvars/index.ts:448-500
- Confidence: reproduced (registry behavior); traced (server string to registry); persistence for the remote path not traced
- Evidence: `if (name !== undefined && name.length > 0 && value !== undefined && name.toLowerCase() !== "cl_allowdownload") this.cvars.set(name, value, true);` (267). The remote source supplies `systemInfo: () => connection.gameState.get(1) ?? ''` (remote-q3.ts:105), and the registry is `cvars: controls.cvars` (remote-application.ts:1350). `prepare` calls `refreshSystemInfo` every frame (483). Only `cl_allowdownload` is excluded, plus frame-time names when a time owner exists (265). Reproduced with a real CvarRegistry and force=true: an Archive cvar, a ReadOnly cvar, an Init cvar and a Cheat cvar were all overwritten, an unknown name was created, and `archiveCommands` then emitted `seta sensitivity "100"`.
- Impact: A hostile server can change any setting in that registry for the session and the player cannot revert it, because it is re-applied each frame. The set of affected names is whatever lives in that registry, and I did not enumerate it. New names add registry entries that outlive the map. ioquake3 rejects server writes to cvars lacking SYSTEMINFO or SERVER_CREATED flags. The per-frame split and set is also avoidable work.
- Remediation: Apply only when the string changes, and only to cvars flagged as server-settable, ignoring the rest with a warning. See Supplements for the related PLATFORM note.

### GAPAPP-003 — A bad server-list file or a failed UDP bind prevents the whole game from starting
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** server-browser.ts:75,81,87,93,95 reject with no per-file tolerance beyond non-JSON text, and startup.ts:211 closes and rethrows. readDirectServers rejects `{}` at server-browser-addresses.ts:19-20. No fallback path to a disabled browser exists.
- Severity: Medium
- Category: robustness
- Location: src/app/bootstrap/server-browser.ts:75, 81, 87, 93-95, 171; src/app/bootstrap/server-browser-addresses.ts:19-20; src/app/bootstrap/startup.ts:211; remote-application.ts:535; application.ts:2159
- Confidence: reproduced (open rejects); traced (launch abort)
- Evidence: `StartupServerBrowser.open` rethrows after closing the socket: `catch (error) { transport.close(); throw error; }` (95). startup.ts:211 then closes the application and rethrows: `application.browser = await StartupServerBrowser.open(...)` inside `catch (error) { await application.close(); throw error; }`. The tolerant `isJsonText` only forgives non-JSON text (79). Reproduced: a `servers-direct-q1` file containing `{}` makes open reject with `Invalid direct server list`. The same applies to invalid favorites, `servers-cache-q3` shape errors (171) and `UdpTransport.bind` failure (75). FORMATS-013 covers seat settings, not these files.
- Impact: One bad value in a cache for an optional feature, or a sandbox that denies UDP, stops single-player from launching. The message names no file.
- Remediation: Treat browser opening as optional. Skip and report each bad file, and run with the browser disabled if the socket cannot bind.

### GAPAPP-004 — The server browser filters and re-sorts the entire list several times per frame
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** rows() (server-browser.ts:262-282) has no cache and is called at startup-menu.ts:338,935,936. controller.ts:39 documents that factories rerun before each input event and draw, and :75-80 does so. Limited to the browser menu with a large list.
- Severity: Medium
- Category: performance
- Location: src/app/bootstrap/server-browser.ts:262-282; src/app/bootstrap/startup-menu.ts:338, 935-936; src/ui/common/controller.ts:75-86
- Confidence: reproduced (per-call cost with synthetic entries); traced (call count)
- Evidence: `browserControls` calls `browser.rows()` (338) and is a menu factory run from `controller.active()`, which runs on draw and on every input event. `draw` calls `browser.rows()` twice more (935-936). Each call builds a lowercase search string per entry and sorts with `localeCompare`, calling `browserAddress` in the tie-break. Measured per call: 256 entries 0.36 ms (ping) and 2.5 ms (name); 1024 entries 2.3 and 14.4 ms; 4096 entries 8.2 and 79.8 ms.
- Impact: At the 4096-entry cap the menu spends at least about 25 ms per frame sorting by ping and about 240 ms by name, so a large master list makes the UI unusable. NET-024 covers quadratic insertion, which is a separate cost.
- Remediation: Cache rows on a list generation plus filter and sort inputs, precompute lowercase search keys, and use one Intl.Collator.

### GAPAPP-005 — A model missing or malformed in a Q2 map or mod is called optional at preload and then ends the game at first draw
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** Missing is proven: ref_gl/gl_model.c:231 errors only with `crash`, and gl_rmain.c:336-340 draws R_DrawNullModel. "Malformed" is wrong for the original: bad versions call ri.Sys_Error(ERR_DROP) (gl_model.c:863), so the original drops to console rather than drawing nothing. Source review: SRCQ2
- Severity: Medium
- Category: robustness
- Location: src/app/bootstrap/presentation-scene.ts:196, 221; src/app/bootstrap/assets.ts:324-325, 338; src/app/bootstrap/precache.ts:107-108; src/app/bootstrap/effects.ts:623, 688, 718
- Confidence: traced
- Evidence: Preload treats failure as survivable: `options.print(`Optional resource preload skipped: ...`)` (precache.ts:108). The draw path does not: `const asset = await this.assets.model(source.content, source.path);` (presentation-scene.ts:196) has no guard, and assets.ts:325 throws `Model is absent from selected content`. assets.ts:338 removes the failure from the cache, so it would simply fail again. Parse errors from `loadApplicationModel` (334) take the same route. The call chain to the run loop has no catch (APP-001). Q1's original engine treats a missing model as fatal, so this matches Q1, but Q2's R_RegisterModel returns null and the entity draws without a model.
- Impact: A third-party Q2 map or game DLL that references one absent model exits the process when that entity first becomes presented, after loading succeeded and printed a soft warning. I did not run such a mod; the trigger comes from reading the code path.
- Remediation: For Q2, resolve model failures to a retained null asset per path, warn once and skip the entity. Keep the strict behavior only where the source engine has it.

### GAPAPP-006 — One bad line or unresolved host discards an entire master list
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** server-master-list.ts:26 maps directServerText with a throw on whitespace (addresses.ts:12). server-browser.ts:237 uses Promise.all, and addresses are added only after the loop (:241), so one failure discards everything.
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/server-master-list.ts:24-26; src/app/bootstrap/server-browser.ts:236-239
- Confidence: reproduced
- Evidence: `return servers.map(directServerText);` throws on any line containing whitespace or longer than 255 characters. `await Promise.all(names.slice(offset, offset + 16).map(name => resolveAddress(name, ports[protocol], 4)))` rejects the batch on the first failure and the loop stops. Against a local HTTP server: a list containing `1.2.3.5:27500 my favourite server` rejected with `Invalid direct server address`, and a list containing `1.2.3.5:notaport` rejected with `Invalid address port`. Addresses found before the failure are never added, because they are added only after the loop (241). The file header cites ParseMasterPlain as its source; I recall its upstream skipping bad entries but did not check that source here.
- Impact: Public lists routinely carry stale hostnames. One entry whose DNS fails leaves the user with no servers and only one error line.
- Remediation: Skip invalid lines, use Promise.allSettled, add what resolved, and report the skipped count.

### GAPAPP-007 — A listed Q3 server can break favorites and the browser cache, because status size is checked only at save
- **Verification (VERIFY-E): confirmed-with-changes. Final severity: Medium.** The admission gap (server-browser.ts:408-409) and save-time rejection (cache.ts:41-44,99) are real. "Any server in the list" is too broad: cache.ts:95-96 saves only master, secondary-master and favorite entries, so LAN and direct-only entries cannot trigger it. Only Q3 is affected.
- Severity: Medium
- Category: robustness
- Location: src/app/bootstrap/server-browser.ts:408-412, 186, 328-334; src/app/bootstrap/server-browser-cache.ts:41-44, 99; src/network/q3/discovery.ts:49-60
- Confidence: reproduced (the save throw); traced (poll admission)
- Evidence: Poll bounds only `players`, `maxPlayers`, `name.length` and `map.length` (408-409), leaving `rules` and player names unbounded. The saver rejects more than 1024 rules or a player name over 1024 characters (cache.ts:41-46), and `writeQ3BrowserCache` validates the whole list on each save (99). Reproduced: an `infoResponse` with 1106 short rules decodes without error, and writeQ3BrowserCache then throws `Too many browser cache rules`. `favorite()` for Q3 rewrites this whole cache and rolls back on failure (328-334). saveQ3Cache (186) fails the same way.
- Impact: Any server in the list, including one listed by a hostile master, makes Q3 favorite changes and cache saves fail until the entry leaves the list. Retained status is also unbounded per entry up to one datagram, so memory scales as entries times datagram size (not measured).
- Remediation: Apply the cache's limits at admission in poll, and have the saver drop an invalid status rather than fail the file.

### GAPAPP-008 — A lower `svc_time` from a NetQuake server exits the client
- **Verification (VERIFY-Q): confirmed. Final severity: High.** WQ cl_parse.c:775 assigns `cl.mtime[0] = MSG_ReadFloat()` with no monotonic check. Original tolerance holds. Source review: SRCQ1
- Severity: Medium
- Category: robustness
- Location: src/app/bootstrap/effects.ts:252; src/app/bootstrap/network/remote-q1.ts:155-156; src/app/bootstrap/remote-application.ts:2246; src/app/bootstrap/remote-seat-view.ts:149
- Confidence: traced (not run)
- Evidence: `if (this.time !== null && now < this.time) throw new Error("Effect time rewound without replacing its world owner");` (effects.ts:252). remote-q1.ts:156 assigns `this.seconds = message.seconds;` with no monotonic check, and the published time interpolates from it. The call at remote-application.ts:2246 is in the frame path. Q2 derives time from `frame.serverFrame` (network/remote.ts:342), and I did not confirm whether every frame path there rejects a lower frame.
- Impact: A single well-formed message from a hostile or buggy server terminates the client. NET-005 covers malformed datagrams; this one parses correctly. The original client tolerates time moving back.
- Remediation: Treat regression as a reset in the remote path: clamp, or reset effect time, and keep the owner.

### GAPAPP-009 — The Custom Game screen rebuilds a full archive path Set several times per frame
- **Verification (VERIFY-H): confirmed. Final severity: Low.** startup-selection.ts:456-458 rebuilds recursively with no cache; rows reaches it through skins (:695-698). builderLayout (startup-menu.ts:523) is called from :206, :863 and :955. Timing was not re-measured.
- Severity: Low
- Category: performance
- Location: src/app/bootstrap/startup-selection.ts:455-459, 481-485, 500-512, 658-716; src/app/bootstrap/startup-menu.ts:317-319, 523, 721, 863, 955, 609
- Confidence: reproduced (per-call cost with corpus); traced (call count)
- Evidence: `files()` builds `new Set([...product.archives.flatMap(archive => archive.entries.map(entry => entry.path.toLowerCase())), ...])` recursively with no cache (456). `rows()` reaches it through the uncached `skins()` (695-698). `builderLayout` calls `safeRows` once and runs at least three times per frame: the menu factory, draw line 863, and draw line 955. `characterPreview` adds it again in the appearance picker (721, 512). Measured with the corpus: q3-baseq3 `rows()` 1.17 ms per call and `characterPreview()` 0.92 ms per call; q2-classic-baseq2 1.15 and 0.89 ms; q1-classic-id1 0.13 and 0.002 ms. The map dropdown also runs `fitScale` for every entry each build (609), up to 13 layout passes per entry; I did not time that.
- Impact: About 3.5 ms per frame on that screen, about 6 ms in the character picker, plus steady garbage from large Sets. Limited to the menu.
- Remediation: Cache `files(product)` per catalog generation and memoize `rows()` on a selection revision.

### GAPAPP-010 — Character preview runs a per-pixel allocating software rasterizer on the main thread at 25 Hz
- **Verification (VERIFY-H): confirmed. Final severity: Low.** character-turntable.ts:344-345 allocates a closure and two arrays per sample; :357 and :382 allocate per render; :542 renders synchronously at a 40 ms cadence (:53). Timing was not re-measured.
- Severity: Low
- Category: performance
- Location: src/app/bootstrap/character-turntable.ts:340-352, 357, 382-388, 537-542
- Confidence: reproduced (synthetic scene: 5000 triangles, 288x384)
- Evidence: `sampleTexture` allocates two arrays and a closure per sampled pixel: `const wrap = ...; const xs = [wrap(...), ...], ys = [...]` (344-345). Each render allocates pixels, depths and a projected vertex array. Measured 17.1 ms per render on the synthetic scene, at a 40 ms cadence (`TURNTABLE_FRAME_MILLISECONDS`).
- Impact: The picker misses a 16.7 ms frame on each render. It is limited to that screen, and it stops when not visible.
- Remediation: Remove the per-pixel allocations and reuse buffers. A lower preview rate would also be enough.

### GAPAPP-011 — Resizing the window rewrites images.cfg each frame, and a failed write exits
- **Verification (VERIFY-H): confirmed. Final severity: Low.** r_customwidth and r_customheight are Archive cvars (image-settings.ts:86-87), set each frame at :231 and part of signature (:197-198). :238 saves through writeAtomic. Callers at startup.ts:1418, application.ts:4678 and remote-application.ts:1033 have no guard.
- Severity: Low
- Category: robustness
- Location: src/app/bootstrap/image-settings.ts:229-233, 238, 241-242, 262-265, 267-272; src/app/bootstrap/startup.ts:1418; application.ts:4678; remote-application.ts:1033; src/settings/config.ts:186
- Confidence: traced
- Evidence: `applyDisplay` copies the live size into archived cvars each frame (231), so the signature differs whenever the size changes. `refreshDisplay` then calls `save()`, which does an atomic write via `store.dump` (271). `refresh` follows the same path after running `finishImageRefresh` (262-265). None of the three callers guards the rejection. `signature()` itself costs 0.057 ms per call with 64 archived values, which is not a concern.
- Impact: Dragging a window edge performs one atomic file write per changed frame. With a read-only or full settings directory, a resize ends the process. This is the same class as APP-015, at a new and ordinary trigger.
- Remediation: Debounce the save until the size settles, and print on failure.

### GAPAPP-012 — The second refresh for remote peers with separate assets is a no-op, and the first gives them another owner's images
- **Verification (VERIFY-H): confirmed. Final severity: Low.** remote-application.ts:1033 passes peer presentations with frontend assets; image-settings.ts:263 records applied; :242 makes the :1035 peer refresh return early. presentation.ts:166 commits the frontend-derived font into the peer. Traced, not run.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/remote-application.ts:1033-1035; src/app/bootstrap/image-settings.ts:241-242, 263; src/app/bootstrap/remote-seat-view.ts:73-74; src/app/bootstrap/presentation.ts:153-166
- Confidence: traced (not run)
- Evidence: Line 1033 refreshes against `frontend.assets` and passes every non-primary peer's presentation. `refresh` then sets `this.applied = selected` (263). Line 1035 calls refresh again for each peer where `peer.view.assets !== frontend.assets`, but the early return `if (selected === this.applied) return;` (242) means no peer asset is ever updated. Peers own distinct assets when their content differs (remote-seat-view.ts:73-74). Their presentation committed `this.text.font = font` and UI art prepared from frontend assets at 1033.
- Impact: With split-screen remote seats on different content, image policy changes never reach that seat's textures, and its text uses fonts owned by another assets instance, whose retirement it does not control. I did not observe a visible failure.
- Remediation: Track applied state per assets instance, and pass each peer's presentation only with its own assets.

### GAPAPP-013 — Reusing a demo name fails after stopping the active recording, and failed recordings block retries
- **Verification (VERIFY-I): confirmed. Final severity: Low.** demo-recording-commands.ts:68-69 finishes the current recording before DemoRecording.open uses `open(path, "wx")` (demo-recording.ts:58). The same order is at :83-84 and :133-134. abort (demo-recording.ts:109-114) closes without unlinking, so the partial file blocks a retry.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/demo-recording.ts:58, 64, 109-114; src/app/bootstrap/demo-recording-commands.ts:68-69, 83-84, 133-134
- Confidence: traced
- Evidence: `await open(path, "wx")` fails with EEXIST for an existing name. `start` runs `await this.finish();` before `this.open(name, seed)`, so the active recording has already stopped. `open` calls `recording.abort()` on a seed-write failure, which closes without unlinking, so the partial file makes the next attempt fail too. Aborted recordings also stay on disk without a footer.
- Impact: `record foo` run twice stops the running demo, prints an EEXIST error and records nothing. Classic clients overwrite. Disk errors leave truncated demos listed in the library.
- Remediation: Open the new file before finishing the current one, decide on overwrite explicitly, and unlink partial files on abort during open.

### GAPAPP-014 — A Q2 laser removed while active leaves its beam drawn until the map ends
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** The beam is a plain RF_BEAM entity (g_target.c:591; cl_ents.c:927), so it stops on G_FreeEdict. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/effects.ts:511-513, 261-264, 272; src/content/q2/base/entities/targets.ts:39, 57
- Confidence: traced (not run)
- Evidence: `die: event.kind === "beam" ? Number.POSITIVE_INFINITY : ...` (513). The only removals are `visible === false` (511), owner retirement (128) and `beam.die >= now` (272). Flashlights, shadow lights, source lights and tracker pain are all filtered by `liveActors` (261-264); beams are not. The hidden event is emitted only from `laserOff` (targets.ts:57).
- Impact: A `killtarget` on an active target_laser leaves a permanent beam at its last endpoints. In the source engine the beam goes away with the entity.
- Remediation: Drop beams whose actor is not live, at the same place as the other per-actor state.

### GAPAPP-015 — Rejected promises are cached for the owner's lifetime in several content lookups
- **Verification (VERIFY-I): confirmed. Final severity: Low.** content.ts:382, audio.ts:293-294, :314-315, :370 and :409, assets.ts:188, held-weapon.ts:34 and :52, and character-turntable.ts:506 store the pending promise with no eviction. assets.ts:156 shows the evicting pattern.
- Severity: Low
- Category: robustness
- Location: src/app/bootstrap/content.ts:365-383; src/app/bootstrap/audio.ts:293-294, 314-315, 370, 399-409; src/app/bootstrap/assets.ts:188; src/app/bootstrap/held-weapon.ts:30-34, 40-52; src/app/bootstrap/character-turntable.ts:506
- Confidence: traced
- Evidence: `this.scoped.set(content, pending)` (content.ts:382) keeps a rejection, as do `banks`, `sounds`, `playlists`, `footsteps`, `movies`, held-weapon `declarations` and `models`, and turntable `mounts`. ApplicationAssets shows the intended pattern: `const cached = pending.catch(error => { if (this.providers.get(content) === cached) this.providers.delete(content); throw error; })` (assets.ts:156, 338).
- Impact: A transient read failure, such as EMFILE or a removed disk, is permanent until the world is replaced. In the audio paths it repeats on every event, leading to GAPAPP-001's exit path.
- Remediation: Share one cache helper that evicts on rejection.

### GAPAPP-016 — Presenter maps in the world scene never drop retired actors
- **Verification (VERIFY-I): confirmed. Final severity: Low.** presentation-scene.ts:190-192, 244-246, 266-271, 277-279 and 303-305 insert keys containing slot and generation. The only removal is close at :417.
- Severity: Low
- Category: leak
- Location: src/app/bootstrap/presentation-scene.ts:72-73, 190-192, 244-246, 266-271, 277-279, 303-305, 417
- Confidence: traced (retention size not measured)
- Evidence: `this.characters.set(key, presenter)` and `this.selectedWeapons.set(key, presenter)` use keys containing `actor.slot` and `actor.generation`. The only removal is `close()` (417).
- Impact: Retention scales with distinct actor generations in one world, such as players joining and leaving. It is released at the next world. I did not establish whether a respawn produces a new generation, which sets how fast this grows.
- Remediation: Prune against the presented actors at the end of prepare.

### GAPAPP-017 — Connecting to a KEX server through a saved hostname drops its protocol
- **Verification (VERIFY-I): confirmed. Final severity: Low.** server-browser.ts:287 stores direct.remote, which may be a hostname. :348 compares browserAddress(entry.address) to that text and ignores the address resolved at :343, so q2Protocol is absent. startup.ts:1246 then selects q2-classic-baseq2.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/server-browser.ts:286-287, 348-350
- Confidence: traced
- Evidence: `select` sets `this.address = direct?.remote ?? browserAddress(entry.address)`, which can be a hostname. `connection` then looks up `browserAddress(entry.address) === remote`, and the resolved address computed at 343 is not used for this. `q2Protocol` therefore comes back absent.
- Impact: A KEX server selected through a hostname direct entry is contacted as classic Q2 and fails to connect.
- Remediation: Look up the entry with the address already resolved in `connection`.

### GAPAPP-018 — Avoidable per-frame work in the presentation path
- **Verification (VERIFY-I): confirmed-with-changes. Final severity: Low.** effects.ts:323, presentation-scene.ts:340, q3-client.ts:560-561 and audio.ts:298-300 are as described. presentation-scene.ts:349-350 should be dropped: it is memoized by a 10 Hz key at :346-347, so it does not run per frame.
- Severity: Low
- Category: performance
- Location: src/app/bootstrap/effects.ts:323; src/app/bootstrap/presentation-scene.ts:340, 349-350; src/app/bootstrap/q3-client.ts:560-561; src/app/bootstrap/audio.ts:298-300
- Confidence: traced (not profiled)
- Evidence: `Array.from({ length: 256 }, (_, index) => { const value = this.styles.find(...)` runs per effects frame per view even when `staticBrushes` is empty, and recipient effects repeat it. `for (const pass of group.passes) await group.renderer.preload([pass.entity], pass.options)` awaits once per model pass per frame. Q3 builds `new Set(Array.from({ length: areaMask*8 }, ...).filter(...))` per scene. `this.actor()` scans linearly by `equals`.
- Impact: Modest and unmeasured, so this is a cleanup candidate rather than a demonstrated bottleneck. Line 323 is the simplest to remove.
- Remediation: Compute the style table only when static brushes exist, batch the preload, and key actor state by a Map.

### GAPAPP-019 — Duplicated seat and startup logic, plus residue
- **Verification (VERIFY-I): confirmed. Final severity: Low.** input.ts:412-442 repeats :497-547, with differing focus callbacks at :430 versus :518-519. configuration.ts:178-186 differs from prepared-startup.ts:324-332 only in identifier names. `{}` is present at content.ts:140 and :525, and builderLayout spans startup-menu.ts:509-738.
- Severity: Low
- Category: maintainability
- Location: src/app/bootstrap/input.ts:412-442 vs 497-547; src/app/bootstrap/configuration.ts:178-186, 213-251 vs prepared-startup.ts:324-332, 346-378; configuration.ts:364-367 and application settings; src/app/bootstrap/content.ts:140, 525; src/app/bootstrap/startup-menu.ts:509-738
- Confidence: traced
- Evidence: `createJoinedLocal` repeats the constructor's seat setup, including SeatConsole options, the UI callback and SeatHaptics, and the copies already differ: the constructor's focus callback finds the local by id while the joined path closes over haptics. `applyStartupVariables` is identical in both startup files, and the StartupConfig callback bodies are near-copies. `{}` empty statements remain at content.ts:140 and 525. `builderLayout` is one 230-line method mixing layout, state changes and control creation.
- Impact: Fixes must be applied in parallel, the same pattern APP-020 describes.
- Remediation: Extract a seat factory and a shared startup-phase runner, and delete the empty blocks.

### GAPAPP-020 — The riskiest helpers here have no direct tests
- **Verification (VERIFY-I): confirmed-with-changes. Final severity: Low.** The name greps hold, but tests/first-playable/server-browser-masters.test.ts:42-48 exercises fetchServerMasterList indirectly through browser.discover() against a local HTTP master. The gap is hostile or mixed-validity lists, not all coverage. registerSexedSound and refreshSystemInfo have no test references.
- Severity: Low
- Category: test-gap
- Location: tests/first-playable/server-browser-persistence.test.ts, server-browser-masters.test.ts, character-turntable.test.ts; src/app/bootstrap/server-master-list.ts; src/audio/bank.ts:42
- Confidence: traced (grep-based; test bodies not read)
- Evidence: Grep across tests finds no reference to `fetchServerMasterList`, `server-master-list`, `registerSexedSound`, or the systeminfo application in q3-client (`refreshSystemInfo`). The cache functions, StartupServerBrowser and the turntable do have test files.
- Impact: GAPAPP-001, 002 and 006 are unpinned.
- Remediation: Add focused tests alongside the fixes, using hostile skins, hostile systeminfo and mixed-validity lists.

## Supplements
- Supplements PLATFORM (first Strengths section, PLATFORM.md:22): the statement "Q3 systeminfo does not set client cvars (remote-q3.ts:116)" is incorrect. That method does not, but q3-client.ts:267 applies the same string through `source.systemInfo()` (remote-q3.ts:105). See GAPAPP-002.
- Supplements PLATFORM-001: bootstrap/audio.ts keeps a second per-actor table. `actorAudio` gets an entry for each Q2 sound with an actor (audio.ts:298-305, 309) and for each listener, is searched linearly by `equals`, and is cleared only by resetRound or close (657, 667).
- Supplements APP-001: the throw sites at presentation-scene.ts:249, 300, 308 and held-weapon.ts:59, 61 and q3-client/qvm.ts:307-314 are per-frame fatal paths for unsupported weapon, body and camera combinations. I did not confirm whether launch preflight excludes those combinations.
