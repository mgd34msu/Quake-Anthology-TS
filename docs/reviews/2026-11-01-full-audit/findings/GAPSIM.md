# GAPSIM — src/app/bootstrap/simulation/** code not read in round 1 (native Q2 guests, Q3 sources, arsenals, QVM/QC components, bots, prediction, network hosts)
## Coverage
Read in full, line by line: quakec-source.ts 1-255 and 1250-1508; q3/ all 16 files (runtime 718, guest-runtime 619, guest-records 253, guest-bots, guest-spatial, guest-world, guest-movement, guest-player, guest-artifact, host, server-state, player-state, presentation, types, command-policy; index not opened); q3-commands; arsenal/ all 9 files (q3-source 592, q3-source-legacy, q3, q3-ammo-regen, q1, q2, selected, weapon-status, inventory-labels); weapon-slot, weapon-slot-projection, weapon-slot-checkpoint; equipment-runtime, equipment-checkpoint; weapon-behavior-runtime; grapple-runtime, grapple-checkpoint; monster-runtime, monster-checkpoint, monster-navigation, monster-placement, monster-sources, guest-monsters, q2-monster-sources; dropped-pickups; qvm-mod, qvm-grapple-source, qvm-weapon-behavior; rerelease-weapon-behavior, rerelease-weapon-checkpoint, rerelease-guest-player, rerelease-guest-services-contract, rerelease-guest-services, rerelease-guest-source, rerelease-guest-world; classic-guest-files, classic-guest-player, classic-guest-services, classic-guest-source, classic-guest-world; native-mod-host, native-mod-presentation, native-mod-camera, native-mod, native-commands, native-primary-weapons, native-q1-pusher, native-q2-map, native-q2-rerelease-save, native-q2-travel, q2-native-world; network-q1, network-q1-quakec, network-q2-guest, network-q2-rerelease-native, network-q3; bots.ts, bot-world, bot-rerelease, bot-rerelease-world, bot-q1/q2/q3-knowledge, bot-arsenal, bot-assets, bot-commands, bot-knowledge-checkpoint, bot-mover-connections, bot-objectives, bot-prediction, bot-selected-knowledge, navigation; prediction/ all 7 files and prediction.ts; mod-callbacks, mod-client-checkpoint, new-toss, player-checkpoint, player-input-application, player-jump, powerup-timers, provider-frames, q1-fog, q1-punch, q2-rerelease-slide, quakec-character-animation, quakec-client-adapter, quakec-local-messages, quakec-map, quakec-mod, quakec-player-ui, quakec-weapon-behavior, quakeworld-cvars, random, save, shared-quakeworld-movement, source-hosts, source-transition, foreign-q1-world, foreign-q2-world, index.
Sampled: player-movement.ts 1-155 of 177.
Skipped: types.ts (245, declarations only), player-movement.ts 156-177, q3/index.ts (8). Roughly 13.1K of the 13.4K lines in scope were read.
Read outside scope for tracing: network/q2.ts 225-250 and 340-451, network/q3/server.ts 145-160, network/q3/visibility.ts 66-80, q3-client/visibility.ts (grep), compat/q2/classic/host.ts (parts), compat/q2/classic/records.ts (part), compat/q2/classic/combat-binding.ts (part), compat/q2/rerelease/host.ts (parts), compat/qvm/grapple-provider.ts (part), compat/qc/memory.ts (part), bots/behavior/library/goals.ts (part), foundation/event-ring.ts, foundation/bounded-queue.ts, runtime.ts around the call sites cited.
Experiments: two temporary tests in <scratchpad>/clean against retail content, removed afterward. No game window, no network traffic.
## Strengths
- Guest lifecycle is careful. `Q3QvmServerGame` (external-operation counting, input retirement, `dropping` phases), `ClassicGuestWorld` and `RereleaseGuestWorld` (`#busy`, explicit ownership transfer on travel, AggregateError on cleanup) make their state transitions explicit and fail loudly on misuse.
- Component sources are well isolated: QVM and native trajectory components block portal, command and clipboard imports (qvm-weapon-behavior.ts:108,129; rerelease-weapon-behavior.ts:252-253).
- Release handling is systematic. Grapple, hand grenade, arsenal, dropped-pickup, Q1 punch and Q3 selected-source tables all clear on `actors.onRelease`. Rerelease trace surfaces are freed on `rebindWorld` (compat/q2/rerelease/host.ts:200-201).
- Queues are bounded: bot messages use `BoundedQueue(64)` with defined drop-oldest behaviour, QW prediction history is capped at 64 and prediction reports `history-exhausted` rather than diverging.
- Save validation in save.ts, weapon-behavior checkpoints and guest bindings rejects mismatched identity, duplicate slots and foreign actors.
- Native sound and link code matches sources where checked: `classic-guest-services.ts:312-320` (SND_POS rules, `channel &= 7` effect on reliability) and `guest-records.ts:143-180` (SV_LinkEntity solid packing, epsilon, 16-cluster cap).
- `classic-guest-files.ts` opens through a contained parent descriptor with `O_NOFOLLOW`.
## Findings
### GAPSIM-001 — An unauthenticated Q2 `connect` with a long userinfo terminates any server hosting a classic native game DLL
- **Verification (VERIFY-Q): confirmed. Final severity: Critical.** server/sv_main.c:296-297 truncates with strncpy into MAX_INFO_STRING before ClientConnect (:385). Source review: SRCQ2
- Severity: Critical
- Category: security
- Location: src/compat/q2/classic/records.ts:21; src/compat/q2/classic/host.ts:276,288; src/app/bootstrap/simulation/classic-guest-world.ts:194,209; simulation/network-q2-guest.ts:82-90,156; src/network/q2/handshake.ts:122-124; src/app/bootstrap/network/q2.ts:247,389,445; src/app/bootstrap/application.ts:4686
- Confidence: reproduced for `ClassicGuestWorld.connect` and `.userinfo` with retail `xatrix/gamex86.dll` (a 600-character value threw `RangeError: API 3 string exceeds its guest allocation` from both); the socket-to-exit chain is traced, not run over a socket.
- Evidence: `writeClassicString`: `if (text.length + 1 > capacity || text.includes("\0")) throw new RangeError("API 3 string exceeds its guest allocation")`, and `clientConnect` calls it with capacity 512. `readQ2Connect` limits userinfo only for KEX (`userinfo.length > 8192`); the 34 and 1038 path checks only `/["\r\n\0]/`. network-q2-guest.ts:82 wraps admission in `q2GameCallback`, so the RangeError becomes `Q2GameCallbackError`. network/q2.ts:445 is `if (error instanceof Q2GameCallbackError) throw error;`, which leaves `poll`, and application.ts:4686 rethrows out of `run()`. A `char > 255` hits the same throw. The in-game path is the same and needs no `begin`: `case 'userinfo': this.host.userinfo(...)` at network/q2.ts:389 has no phase gate, and network-q2-guest.ts:156 wraps it in `q2GameCallback`. Original SV_ConnectionlessPacket truncates through `strncpy(userinfo, Cmd_Argv(4), sizeof(userinfo)-1)`.
- Impact: A single `getchallenge` plus a `connect 34 <qport> <challenge> "\name\a\pad\aaaa...(600)"` ends the whole server process, with no authentication and no slot. rerelease-guest-world.ts:177 has the same throw for its `userinfo` path at 2048 bytes (traced).
- Remediation: Reject or truncate userinfo at the protocol boundary to the guest capacity, including the `ip` the host appends, and treat these range errors as a peer fault rather than a game callback failure.

### GAPSIM-002 — Classic monster proxies survive map travel, so the first frame frees unrelated edicts in the new level
- **Verification (VERIFY-D): confirmed. Final severity: High.** rebindWorld (classic-guest-services.ts:126) clears configstrings/messages/buffer/resource names but neither `#monsterProxies` nor `#pendingProxies`; the retained proxies are iterated next bind (383-385), and `engine.actors.isLive` is false for the prior level's foreign identities → `freeProxyEdict` on a stale slot now reused by new-map edicts. Silent corruption.
- Severity: High
- Category: bug
- Location: src/app/bootstrap/simulation/classic-guest-services.ts:74-75,126-134,382-386; classic-guest-world.ts:138-142,236-237; src/compat/q2/classic/combat-binding.ts:123-126; src/world/actors/registry.ts:131-134
- Confidence: traced
- Evidence: `rebindWorld` clears configstrings, messages, the buffer and resource names, but neither `#monsterProxies` nor `#pendingProxies`. `travel` keeps the same `ClassicGuestServices` and DLL. On the next frame, `forwardMonsterProxyDamage` runs `if (!engine.actors.isLive(actor)) { try { combat.freeProxyEdict(entry.view); } ...`. The rebound `engine.actors` is the new registry, whose `isLive` returns false for foreign identities (`if (!this.identities.owns(actor)) return false`). `freeProxyEdict` invokes the DLL's G_FreeEdict on `entry.view`, a raw slot from the previous level. By then `spawnEntities` has repopulated edicts, and the new map's selected monsters may have received proxies in the same slots.
- Impact: With selected foreign monsters on a classic native campaign, each level change wipes one source edict per retained proxy of the prior level, up to the slot count: doors, triggers, items or the new level's own monster proxies vanish silently on the first frame. Larger destination maps are the most exposed. Tests do not cover this combination (no test references the proxy API across travel).
- Remediation: Clear both proxy tables in `rebindWorld` without invoking the DLL, because `spawnEntities` already reinitializes the edicts.

### GAPSIM-003 — The native Q3 network host drops a real door area, so 62 of 98 retail doors cull from one side
- **Verification (VERIFY-D): confirmed. Final severity: High.** network-q3.ts:178 `areas = [...new Set(leaves.map(leaf => scene.leafArea(leaf)))]` keeps solid-leaf -1 and takes areas[0]/areas[1], dropping a third real area; the areasConnected adapter (:180) returns false for negatives. The two sibling implementations skip -1 (q3-client/visibility.ts:29, guest-records.ts:164), matching SV_LinkEntity. Reproduced over baseq3: a door's real area is dropped, culling it from one side when closed.
- Severity: High
- Category: bug
- Location: src/app/bootstrap/simulation/network-q3.ts:178-179; src/network/q3/visibility.ts:73; contrast src/app/bootstrap/q3-client/visibility.ts:26-31 and simulation/q3/guest-records.ts:162-167
- Confidence: reproduced for the area lists (temporary test over all 31 maps in baseq3 pak0: 98 `func_door`, 67 with -1 first, 62 where a real area falls outside the first two); the culling step is traced, not rendered.
- Evidence: `areas = [...new Set(leaves.map(leaf => scene.leafArea(leaf)))]` then `areanum: areas[0] ?? -1, areanum2: areas[1] ?? -1`. Solid leaves report area -1, so q3ctf2 door `*19` produces `[-1,1,4]` and link areas are `-1,1`, dropping area 4. The selector does `!areasConnected(area, link.areanum) && !areasConnected(area, link.areanum2)` then `continue`, and the areasConnected adapter returns false for negatives (network-q3.ts:180). The other two implementations skip -1 (`if (area === -1) continue`), matching SV_LinkEntity.
- Impact: For remote clients of a native TS Q3 server, a closed area-portal door whose dropped area is the client's own area leaves the snapshot, since the areas are not connected while the door is closed. The door then disappears from that side, until it opens.
- Remediation: Filter -1 and apply SV_LinkEntity's areanum/areanum2 rule, ideally by sharing one link helper with q3-client/visibility.ts.

### GAPSIM-004 — QVM weapon and grapple components rebuild all targets per mirrored target, which is quadratic in actors per step
- **Verification (VERIFY-D): confirmed-with-changes. Final severity: Medium.** Code is as quoted — refreshTargets (qvm-weapon-behavior.ts:218) and grapple synchronize (qvm-grapple-source.ts:265) call `options.targets()` once then `mirror()` per target, and mirror re-runs the full `targets()` scan (weapon:181, grapple:219), so each is O(A²) per step. But targets() (runtime.ts:3102) and these components run only for selected QVM weapon/grapple behaviors; no retail content drives the A≈352 case (that needs the cross-engine Q1/Q2 config). On native Q3 actor counts the cost is measurable, not "major perf loss." Real defect, limited reach → Medium. ---
- Severity: High
- Category: performance
- Location: src/app/bootstrap/simulation/qvm-weapon-behavior.ts:181,218-222,249; qvm-grapple-source.ts:219,265-267; runtime.ts:3102-3117,3204-3215; compat/qvm/grapple-provider.ts:102,105,119
- Confidence: traced (not measured; no retail content selects these components here)
- Evidence: `refreshTargets` calls `this.options.targets()`, which walks `actors.observations()` with a flatMap doing `bodies.read`, `combat.read` and `playerClient`, per actor. It then calls `this.mirror(target.actor)` for each target, and `mirror` begins with `this.options.targets().find(value => value.actor === actor)`. This repeats per projectile `step`. Each mirror also writes VM memory and may `clientUserinfoChanged`. Grapple does the same in `synchronize`, which `beginFrame`, `fire` and `step` all call, so at least twice per frame. Targets also include every bodied actor, so each one allocates a QVM entity.
- Impact: At A actors and P live projectiles, each frame builds about P×A² target records: at A=352 (Q2 base1 per SIM-014) with 3 projectiles that is about 370,000 records per frame. These components become unusable on Q1 and Q2 maps. Separately, since targets are all bodied actors, a map with more than about 950 actors exhausts G_Spawn, which is a fatal game error (plausible).
- Remediation: Build targets once and pass the entry into `mirror`, and restrict mirroring to actors that traces or radius queries actually touch.

### GAPSIM-005 — QuakeC weapon behavior never retires target entity slots, so long maps hit a fatal 8192 limit
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** quakec-weapon-behavior.ts:104 inserts into slots and no delete exists. free.add occurs only for projectile paths (:141,145,171) and checkpoint restore (:185,200). :121 only zeroes fields, and memory.ts setCount throws above 8192 (:83).
- Severity: Medium
- Category: leak
- Location: src/app/bootstrap/simulation/quakec-weapon-behavior.ts:58-59,83,96-106,112-122; src/compat/qc/memory.ts:46-47; runtime.ts:784-787
- Confidence: traced
- Evidence: `reference` does `slot = this.allocate(); this.slots.set(actor, slot); this.actors.set(slot, actor);`. `refreshTargets` handles departed actors only by zeroing fields: `for (const [actor, slot] of this.slots) if (!live.has(actor)) { ...setFloat(health, 0)... }`. There is no `slots.delete`, no release subscription, and `free` is fed only by projectile close. `targets()` returns every bodied actor. `allocate` calls `setCount(slot + 1)`, and `setCount` throws `RangeError("Invalid QC entity count")` above capacity 8192.
- Impact: Every distinct actor alive during any behavior step, including each gib, item and foreign projectile, permanently consumes a QC entity slot for the map's lifetime. Step cost and checkpoint size grow with it (each step iterates all slots and `findradius` iterates all entities), and a long map eventually throws out of the tick, ending the host. VM-010 covers the separate string-arena growth at line 119.
- Remediation: Subscribe to actor release, delete the mapping and return the slot to `free`.

### GAPSIM-006 — Rerelease bot observation table grows for the map's lifetime and is searched linearly on each lookup
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** bot-rerelease.ts:63-66 scans linearly and inserts. A repository grep shows only set and has on `observations`, with no delete, and :217 writes all rows to checkpoints.
- Severity: Medium
- Category: leak
- Location: src/app/bootstrap/simulation/bot-rerelease.ts:33-34,63-66,175,217; bot-rerelease-world.ts:41,63,89
- Confidence: traced
- Evidence: `identify = actor => { for (const [number, existing] of this.observations) if (existing.equals(actor)) return number; const number = this.nextObservation++; this.observations.set(number, actor); return number; }`. There is no delete site in the file. `entities()` calls it for every linked actor, per bot per think; `trace` calls it per actor hit; `receive` per sound. Actor IDs are generation-unique, so each rocket, gib and item respawn adds a row. All rows are also written to every checkpoint at line 217.
- Impact: Lookup cost grows steadily over a long deathmatch map: bots × actors × observations per frame, plus retained ActorIds and larger saves. It resets only at map change.
- Remediation: Use a `Map<ActorId, number>` for forward lookups, and drop entries on actor release.

### GAPSIM-007 — New client taking a carried slot inherits the previous occupant's Q3 session
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** q3/runtime.ts:651 tests a carry list that nothing consumes, runtime.ts:4170 calls it for every admission, and client-admission.ts:284 skips initializeClient when firstTime is false. disconnectPlayer (:670-673) does not clear the carry.
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/simulation/q3/runtime.ts:649-655,115-120,670-673; src/content/q3/team-arena/client-admission.ts:284
- Confidence: traced
- Evidence: `const restored = this.options.sessionCarry?.clients.some(saved => saved.slot === client) ?? false; const rejected = this.admission.connect(client, !restored, false);`. The carry list is fixed for the whole map and is not consumed on admission or disconnect. client-admission.ts:284 is `if (firstTime || this.host.state.newSession) initializeClient(...)`, otherwise it reads the `session<slot>` cvar, which nothing clears. Original ClientConnect receives firstTime from SV_DirectConnect for each truly new client.
- Impact: After a map change, if a carried player leaves and a stranger joins that slot, the stranger takes the old `sessionTeam`, spectator state and wins and bypasses join logic (team balance, `g_maxGameClients`), and no "connected" message is printed. The issue persists for the rest of the map.
- Remediation: Consume the carry entry on first admission of its slot, and treat later admissions as first-time connects.

### GAPSIM-008 — Rerelease guest allocates a 64 KiB buffer for every sound, print and runtime configstring
- **Verification (VERIFY-E): confirmed. Final severity: Low.** rerelease-guest-services.ts:32 allocates at :199,290,300 as quoted. Measured 7.3 us per allocate-and-slice here, so the finding's 800 per second costs about 6 ms per second (0.6%). This is GC churn, not a meaningful frame cost.
- Severity: Medium
- Category: performance
- Location: src/app/bootstrap/simulation/rerelease-guest-services.ts:32,199,290,300,305
- Confidence: traced (allocation rate estimated)
- Evidence: `function messageBuffer(): SizeBuf { const buffer = new SizeBuf(); SZ_Init(buffer, new Uint8Array(65536), 65536); return buffer; }` is called in `sound`, `print` and `setConfigstring`, which then `buffer.data.slice(0, buffer.cursize)`. Classic uses one 1400-byte buffer (classic-guest-services.ts:93).
- Impact: 65,536 zeroed bytes per sound. At the API2023 40 Hz cadence and 20 sounds per frame that is about 52 MB/s of allocation and zeroing on top of guest cost (GUEST-004/005), for messages of tens of bytes.
- Remediation: Reuse one scratch `SizeBuf`, clearing it per message.

### GAPSIM-009 — `configstrings()` copies the entire table on each call, including per frame and per looping entity
- **Verification (VERIFY-I): confirmed. Final severity: Low.** rerelease-guest-services.ts:174 and classic-guest-services.ts:183 return new Map. All listed single-read and per-frame callers exist (native-mod-presentation.ts:119, network-q2-guest.ts:139, runtime.ts:5749-5750, :7419).
- Severity: Low
- Category: performance
- Location: src/app/bootstrap/simulation/rerelease-guest-services.ts:174; classic-guest-services.ts:183; native-mod-presentation.ts:93,119; native-mod-host.ts:166,219; network-q2-guest.ts:139; network-q2-rerelease-native.ts:167; runtime.ts:5749-5750,7419
- Confidence: traced
- Evidence: `configstrings(): ReadonlyMap<number, string> { return new Map(this.#strings); }`. `native-mod-presentation.ts:119` runs `this.source.configstrings().get(this.layout.sounds + state.sound)` per entity with a loop sound. network-q2-guest.ts:139 runs `world.configstrings().get(29)` every `observe`. runtime.ts:5749 passes a fresh copy for each `playerUi`.
- Impact: Each single-key read copies hundreds to thousands of strings, several times a frame.
- Remediation: Expose `configstring(index)` and return the live read-only map where the caller does not retain it.

### GAPSIM-010 — Q3SelectedSource refreshes every projected actor for each owned actor's step
- **Verification (VERIFY-I): confirmed. Final severity: Low.** arsenal/q3-source.ts:301-307 refreshes all projected actors per step, :286-300 rebuilds the client configstring and netname in refresh, and :499-515 walks numEntities in publish.
- Severity: Low
- Category: performance
- Location: src/app/bootstrap/simulation/arsenal/q3-source.ts:286-300,301-307,470-478,480-491,499-515
- Confidence: traced
- Evidence: `step` runs `for (const [borrowed, slot] of this.projected) if (isLive(borrowed.id)) this.refresh(this.pool.at(slot));`, once per owned rocket or grenade. Client `refresh` parses userinfo twice and rebuilds the presentation configstring through `clientPresentationConfig`. `player()` refreshes on each call, and each `run()` calls `publish()`, which walks `pool.numEntities`. Projection is permanent until actor release and adds every actor a trace hits.
- Impact: Foreign Q3 arsenals on Q1 and Q2 maps cost O(owned × projected) per frame plus string work per client, growing as traces project more doors and monsters.
- Remediation: Refresh once per source frame and update client configstrings only when userinfo changes.

### GAPSIM-011 — Peer-supplied `ip=localhost` disables Q3 snapshot rate limiting
- **Verification (VERIFY-I): confirmed. Final severity: Low.** network/q3.ts:120 stores the raw client string, and network-q3.ts:131 derives local from its `ip` value. server.ts:152 then skips rate limiting. Grep finds `ip` written only at admission (admission.ts:175, :183), and network-q3.ts:194 does not rewrite it on update.
- Severity: Low
- Category: security
- Location: src/app/bootstrap/simulation/network-q3.ts:128,131; src/app/bootstrap/network/q3.ts:120; src/network/q3/server.ts:152; src/network/q3/admission.ts:175
- Confidence: traced
- Evidence: Admission overwrites `ip` on connect, but a later update stores the peer's string as is: `if (name === 'userinfo') { peer.userinfo = argv[1] ?? ''; await q3GameCallback(() => host.userinfo(peer.player, peer.userinfo)); }`. `rate` then returns `local: q3InfoValue(info, 'ip') === 'localhost'`, and the server does `if (rate.local || ...) { this.nextSnapshotTime = (now - 1) | 0; return; }`. Original gates this on the real address (`Sys_IsLANAddress`, `SV_RateMsec`) and restores `ip` only when empty.
- Impact: A remote peer removes its own `rate` and `sv_maxRate` limit and receives a snapshot on every server frame, which amplifies server upload for that peer.
- Remediation: Derive `local` from the peer's transport address and rewrite `ip` on every userinfo update.

### GAPSIM-012 — A queued mod unicast to a player who left before the drain kills the host
- **Verification (VERIFY-I): refuted. Final severity: Info.** The throw exists (native-mod-presentation.ts:156), but the stated sequence cannot occur outside a tick: every transfer drains at its end (native-mod-provider.ts:945 and :971), including entry calls and commands (executeEntry just above :955, and :955-958), before a later disconnect. Disconnect runs its call while entries still hold the actor (native-mod-clients.ts:119-120). Publish defers only while owned.advancing, and no client release during that window was found.
- Severity: Low
- Category: robustness
- Location: src/app/bootstrap/simulation/native-mod-presentation.ts:153-157,166-172; classic-guest-services.ts:266-271
- Confidence: plausible
- Evidence: `unicast` checks `acceptsClient` at queue time, then `recipients` rechecks at drain: `if (actor === null || !this.projection.acceptsClient(message.audience.slot)) throw new Error("Native mod message targets an unavailable destination player");`. `drain` runs in `publish`, so a message queued from a command callback and followed by that player's disconnect in the same poll reaches this throw in the tick. Original SV_Multicast and unicast simply write to that client's buffer.
- Impact: A rare, timing-dependent server exit under native gameplay mods when a player disconnects just after receiving a layout or print.
- Remediation: Drop unicasts whose recipient is gone at drain.

### GAPSIM-013 — Damage from guest code to projected TS monsters is always credited to the world
- **Verification (VERIFY-I): confirmed. Final severity: Low.** classic-guest-services.ts:396-401 credits world, with knockback 0 and meansOfDeath 0, and its comment acknowledges the limitation.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/simulation/classic-guest-services.ts:396-401
- Confidence: traced (the comment acknowledges the limitation)
- Evidence: `// The guest applied this damage internally; its attacker is not observable at this boundary, so the world takes credit.` followed by `attacker: world, inflictor: world, cause: { kind: "q2", meansOfDeath: 0, damageFlags: 0 }`, with `knockback: 0`.
- Impact: Selected foreign monsters hit by native DLL weapons have no attacker to retaliate against and give no kill credit or obituary to the player, and they do not take knockback through this path.
- Remediation: Intercept the DLL's T_Damage entry for proxy edicts so the real attacker reaches shared combat.

### GAPSIM-014 — Bot botlib adapter scans a Map for every `nextEntity` and rebuilds strings for `modelInfo`
- **Verification (VERIFY-I): confirmed. Final severity: Low.** q3/guest-bots.ts:79-82 scans all observations per nextEntity, :83-86 allocates a Uint8Array and TextDecoder per read, and :87-92 walks all BSP entities per modelClassname. goals.ts:1224 and :1240 are the full-pass callers.
- Severity: Low
- Category: performance
- Location: src/app/bootstrap/simulation/q3/guest-bots.ts:50-61,79-93; src/bots/behavior/library/goals.ts:1224,1240
- Confidence: traced
- Evidence: `nextEntity(after)` iterates all observations for each call, so a full pass via `entityNumbers` is O(n²). `modelInfo` scans observations, then `modelClassname` walks all BSP entities, and `bspValue` does `new Uint8Array(1024)` and `new TextDecoder()` per field read, with no cache.
- Impact: Moderate per-frame cost under QVM bots: about 90,000 map steps per pass at 300 entities, plus repeated 1 KiB allocations on every elevator or door travel check.
- Remediation: Keep observations in an array indexed by entity number and cache classname per model after load.

### GAPSIM-015 — Native Q1 actor traces perform an extra point-contents query on each call
- **Verification (VERIFY-I): confirmed. Final severity: Low.** source-hosts.ts:26-34 runs pointContents unconditionally, and :65-68 filters and sorts all observations per nearby. Cost was not measured.
- Severity: Low
- Category: performance
- Location: src/app/bootstrap/simulation/source-hosts.ts:26-34,65-68
- Confidence: traced (not measured)
- Evidence: Every `trace` runs `world.scene.pointContents({ point: trace.end, ... })`, only to compute `sky: ... || contents.kind === "q1" && contents.contents === -6`. That result matters only for hits, but it runs even at fraction 1. The Q2 `nearby` at line 65 filters all observations and sorts them on each call.
- Impact: Extra BSP descent and allocation on all Q1 monster and weapon traces, and full-actor scans per Q2 radius query, in the hot gameplay loop.
- Remediation: Evaluate contents lazily when `fraction < 1`, and use the scene's spatial query for `nearby`.

### GAPSIM-016 — `entitySpans` treats `\"` as an escape, which Quake's parser does not
- **Verification (VERIFY-I): confirmed. Final severity: Low.** Reproduced: for three entities with `"message" "C:\maps\"` in worldspawn, parseQ2Entities finds 3 and filterEntityText returns an empty string. guest-monsters.ts:48 is the backslash test, and only :90-92 has the count check.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/simulation/guest-monsters.ts:42-53,90-92
- Confidence: traced
- Evidence: `if (quoted) { if (char === '"' && text[index - 1] !== "\\") quoted = false; continue; }`. COM_Parse ends a token at the next `"` regardless, and `//` comments are not handled here either. `parseQ2Entities` and this scanner can therefore disagree. Mismatched counts throw "Native monster admission could not segment the authored entities" (a load failure), and `filterEntityText` has no such check, so it can slice wrong spans.
- Impact: A map value ending in a backslash, such as a Windows path in a message, fails to load or hands the guest garbled entities when monster replacement or foreign spawn filtering is active. It is rare in retail content.
- Remediation: Reuse the real tokenizer and record offsets.

### GAPSIM-017 — An unknown guest weapon number throws from the per-frame UI path
- **Verification (VERIFY-I): confirmed. Final severity: Low.** q3/guest-player.ts:20-21 throws from playerUi with no local fallback. Whether the catalog scan can miss a weapon in a real mod remains unestablished.
- Severity: Low
- Category: robustness
- Location: src/app/bootstrap/simulation/q3/guest-player.ts:20-21; simulation/runtime.ts (playerUi callers)
- Confidence: plausible
- Evidence: `if ((active === undefined ? state.weapon !== 0 : active !== null) && weapon === undefined) throw new Error(`Q3 guest weapon ${state.weapon} is missing from its item catalog; this mod needs a qvm-items.json declaration`);`.
- Impact: A QVM mod whose weapon number the catalog scan misses ends the session the first time a player holds it, rather than showing a generic HUD. The message is clear, but the failure is mid-game rather than at load.
- Remediation: Validate at load where possible and render with no weapon status otherwise.

### GAPSIM-018 — QVM component hosts and native network hosts are duplicated by copy
- **Verification (VERIFY-I): confirmed. Final severity: Low.** The cited QVM host ranges measure 0.904 similar (SequenceMatcher). Both network hosts define headnodeVisible, and classic-guest-world.ts:126 and :158 hold the sync and async travel. The limits differ as stated: classic-guest-world.ts:213 (512) versus rerelease-guest-world.ts:177 (2048).
- Severity: Low
- Category: maintainability
- Location: src/app/bootstrap/simulation/qvm-grapple-source.ts:148-175 vs qvm-weapon-behavior.ts:115-140; network-q2-guest.ts vs network-q2-rerelease-native.ts (whole files, including `headnodeVisible`, `playerMessages`, admission); classic-guest-world.ts:126-189 (`travel` and `travelLoading`); rerelease-guest-world.ts:121-155
- Confidence: traced
- Evidence: Spatial services, the entity link math and host checkpoint code are near-identical between the two QVM components. Each native world has its travel sequence written twice in sync and async form. GAPSIM-001 shows the cost: the classic and rerelease hosts diverge in userinfo limits (`512` vs `2048`), with neither validating before the callback wrapper.
- Impact: Fixes such as GAPSIM-004 and GAPSIM-001 need to be applied in pairs, and divergence is hard to see in diffs of very long lines.
- Remediation: Extract a shared QVM component host and shared Q2 guest host core, and express the sync path through the loading path.

## Supplements
- Supplements GUEST-008: GAPSIM-001 is a concrete unauthenticated trigger, reproduced against retail `gamex86.dll`, for "guest faults terminate the host"; the failure occurs in the import-boundary string write, before any guest code runs.
- Supplements SIM-014: The per-client entity rebuild also exists in network-q1.ts:122 (`entities()` plus `simulation.presentations()` and a new Map per player), network-q1-quakec.ts:172, network-q2-guest.ts:124-134 and network-q2-rerelease-native.ts:141-162 (`world.entityStates()` per client, with `entityInfo` read twice per entity, and BigInt effects in rerelease), and in network-q3.ts:177-179 (`boxLeaves` plus two Sets per entity per snapshot).
- Supplements CORE-010: prediction/step.ts:74,91-104 builds numeric operations, closures and a new movement provider per command, plus two snapshot copies, and `SelectedMovementPrediction.replay` runs that for up to 63 commands per call (runtime.ts:66-73).
- Supplements BOTS-007: bot-rerelease-world.ts:46-52 calls `simulation.playerUi` once in `self()` and again via `nativeWeaponItem` for each known weapon, on each `self()` call; bots.ts:450 builds a full `sourceState()` (all entities, all 1024 configstrings) per bot per frame.
- Supplements SIM-001: arsenal/q1.ts:134-136, arsenal/q2.ts:124-126 and arsenal/q3.ts:176-179 are the three throw sites, all reached from `step` with no peer fault boundary.
- Supplements VM-011: The same "resynchronize everything" shape exists in the two other QVM hosts (GAPSIM-004).
