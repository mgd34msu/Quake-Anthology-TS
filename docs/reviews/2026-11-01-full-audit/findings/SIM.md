# SIM — src/app/bootstrap/simulation/** (shared simulation runtime, physics, players, network hosts, QC/QVM sources)
## Coverage
Read in full: runtime.ts (8591), physics.ts (740), players.ts (630), network.ts (444), network-qw.ts (263), network-unified.ts (251), events.ts (120), actor-execution.ts (216).
Sampled: quakec-source.ts lines 255-1249 of 1508 (constructor, checkpoint, client lifecycle, QW/NQ state, cheats); bots.ts lines 240-272 plus collection scan; q3/runtime.ts runActor and restart sections; arsenal-intent.ts in full (22). Collection/lifecycle grep (new Map/Set, onRelease, clear, timers) over: grapple-runtime, equipment-runtime, weapon-behavior-runtime, monster-runtime, q3/guest-runtime, q3/guest-records, arsenal/q1,q2,q3,q3-source, weapon-slot, dropped-pickups, native-mod-presentation, qvm-grapple-source, qvm-weapon-behavior, rerelease-weapon-behavior, classic/rerelease-guest-services, quakec-local-messages, network-q1, network-q3, network-q1-quakec, network-q2-guest, bot-world, bot-rerelease.
Read outside scope for tracing: foundation/event-ring.ts, world/actors/body.ts (part), network/unified-server.ts (part), network/qw-server.ts (part), application.ts step/run loop, frame-time.ts (part), compat/qc/memory.ts (part), presentation-host.ts (part).
Skipped (not read beyond the grep above): quakec-source.ts 1250-1508, most of q3/runtime.ts, q3/guest-runtime.ts, arsenal/q3-source.ts, qvm-*, rerelease-*, classic-*, native-mod-*, bot-*, prediction/*, remaining small files. About 15.5K of 28.8K lines were read line by line.
Experiments ran from <scratchpad>/clean against retail content with a temporary test file, since removed.
## Strengths
- No retained world across map cycles: 15 create/step/close cycles each on Q1 e1m1, Q2 base1 and Q3 q3dm1 with one shared content object left 0 `SharedSimulation` and 0 `MovementPlayer` objects in `heapStats().objectTypeCounts`, and a flat heap of 45-61 MB (reproduced). This does not cover retained native Q2 travel, QVM guests or a shared `sourceRegistry`.
- Per-actor cleanup is systematic: `actors.onRelease` at runtime.ts:762-773, physics.ts:111, body.ts:58 and the sub-runtimes clears per-actor tables.
- Earlier findings are fixed. B4: physics.ts:363-375 touches triggers before impact for Q1 and rechecks liveness. B1: network-unified.ts:237 applies `unifiedCommandInBounds`.
- Reviewed SharedPhysics toss, step and push paths match sv_phys.c / g_phys.c in move snapping, rider rotation, block restore, friction constants and the 60-unit stop rule, apart from SIM-017.
- Remote command surface held up: 53 command names × 14 hostile argument lists, plus 9 malformed userinfo strings, through `createUnifiedApplicationServerHost` on Q1, Q2 classic, Q2 rerelease and Q3 produced no throw and no tick failure (reproduced).
- Save restore validates aggressively (recipe equality, client slots, event sequence, saved-source agreement) and fails loudly rather than loading divergent state.
- Output queues are load-sized `EventRing`s with explicit backpressure. Malformed QW and unified peer input is mostly contained to that peer's connection.
## Findings
### SIM-001 — Any admitted unified peer can terminate the host with one bad arsenal intent
- **Verification (VERIFY-A): confirmed. Final severity: Critical.** Reproduced against a REAL `--listen-unified` q1 server. An admitted peer sending one input with `arsenal:{provider:'x:y',weapon:'x:y'}` crashed the process: input() copies arsenal unchecked (network-unified.ts:232-239), prepareArsenalCommand throws "Arsenal command belongs to a different provider" (runtime.ts:4900) inside step → run → exit rc=1 (verifyA/s/..., stack shown in run). Validation missing in input().
- Severity: Critical
- Category: security
- Location: src/app/bootstrap/simulation/runtime.ts:4895,4900; arsenal-intent.ts:13,17; network-unified.ts:232-239; network/unified-control.ts:85-88; network/unified-server.ts:139; application.ts:4629,4686
- Confidence: reproduced (`host.input` then `sim.step` on Q1, Q2, Q3); the application-exit step is traced, not run over sockets
- Evidence: `readArsenal` accepts any namespaced provider and weapon. `input()` checks the command family and bounds but copies `arsenal` through unchecked: `...(arsenal === undefined ? {} : { arsenal })`. The command then reaches `prepareArsenalCommand` inside `step`: `if (intent.provider !== this.weaponProvider.provider) throw new Error("Arsenal command belongs to a different provider")` and `throw new Error("Weapon request is unavailable to this actor")`. Results with `provider:"x:y"` and with `weapon:"q9:nope"`: Q1 and Q2 threw those two messages; Q3 threw "Arsenal command belongs to a different provider" and "Weapon does not belong to the selected Q3 product". The throw happens in the simulation step, outside the per-peer `try` in `poll`, and application.ts:4686 rethrows it out of `run()`.
- Impact: One input datagram from any peer past the handshake ends the server for everyone. A slot-bound request also throws when the weapon is unowned, so a lagging honest client that selects a weapon just after dying can plausibly trigger it.
- Remediation: Validate provider and weapon in `input()` so bad values drop the peer, and make an unowned weapon request a soft refusal in `prepareArsenalCommand` rather than a throw.

### SIM-002 — Q3 worlds never think or move runtime-spawned adjunct actors: DeathBall is frozen and character gibs persist
- **Verification (VERIFY-A): confirmed. Final severity: High.** runtime.ts:5501 `if (this.source.kind === "q3") { ...runActor...; continue; }` executes before scheduler.run/physics.step; q3/runtime.ts:586-589 runActor returns early when `records.byActor` is null. Runtime-spawned adjunct actors (DeathBall, spawnCharacterGib) have no Q3 record, so they never move or expire. Gameplay-correctness + a per-gib growth path until map change. Traced in source; niche cross-engine mode.
- Severity: High
- Category: bug
- Location: src/app/bootstrap/simulation/runtime.ts:5487,5496,5501-5502,4582-4590,6250-6260; q3/runtime.ts:586-589
- Confidence: reproduced for the ball; traced for gibs
- Evidence: `if (this.source.kind === "q3") { this.source.game.runActor(actor); ...; continue; }` runs before `this.scheduler.run(...)` and `this.physics.step(actor, elapsed)`. `runActor` returns at once when `entity === null`, which is the case for an actor with no Q3 record and no execution. On q3dm1 the ball stayed at z=40 for 2 s, and after a write of velocity {300,0,200} it stayed at the same origin for 0.5 s with that velocity retained.
- Impact: Foreign DeathBall on Q3 maps cannot be moved by knockback, so goals cannot be scored in play. The existing test passes only because it teleports the ball. `spawnCharacterGib` actors hit the same branch: a Q2 character on a Q3 map leaves gibs frozen in mid-air, and their expiry think never fires, so actors and `detachedModels` entries grow per gib death until map change.
- Remediation: Before the Q3 branch, dispatch actors that have no Q3 record to the scheduler and `physics.step`.

### SIM-003 — Foreign DeathBall on a Q1 world falls out of the map, and its reset leaves collision at the old position
- **Verification (VERIFY-A): confirmed. Final severity: High.** runtime.ts:6281-6286 resets the ball with `bodies.write(...)` and no following `bodies.link`, so the collision link stays at the goal position; and Q1 spawn has no out-of-world/kill-plane recovery (6250-6256). Author reproduced the fall and the stale link; code confirmed. Exotic-mode gameplay bug, not security.
- Severity: High
- Category: bug
- Location: src/app/bootstrap/simulation/runtime.ts:6250-6256,6281-6286
- Confidence: reproduced (fall on dm1, stale link on q3dm1); root cause of the fall not isolated
- Evidence: On dm1 the ball went from z=20 to z=-1940 in 2 s, then kept falling with no ground contact, consistent with no world collision. There is no out-of-world recovery. Separately, the reset does `this.bodies.write(ball, { ...body, origin: {...home...}, velocity: zero })` with no `bodies.link`. After a goal and the 2 s reset on q3dm1, body origin was (216,1328,40) while the linked origin stayed (212,2360,96) at the goal.
- Impact: The mode cannot be played on Q1 maps. After any goal where physics does not relink, shots and traces hit an invisible ball at the goal while the visible ball is untouchable.
- Remediation: Link after the reset write, then find why the Q1 trace misses the world for this hull and spawn height (check start-solid handling at spawn); add a kill-plane or out-of-world reset.

### SIM-004 — Foreign match state is missing from saves, so restores duplicate objectives and lose the match
- **Verification (VERIFY-C): confirmed. Final severity: Medium.** Save and load through Application (verify/s/sim.ts). Tag on q1 dm3 and q3dm1: `tagToken` is null after restore and 2 token models exist after ticks. Confidence for the auditor's traced modes rises to reproduced: LMCTF on q3dm1 goes from 7 models to 14 (flags and runes doubled), and DeathBall from 1 ball to 2. src/app/bootstrap/simulation/runtime.ts:5824 respawns because the fields are not saved. Attacker-credit and inventory claims were not separately tested.
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/simulation/runtime.ts:309-345,8051-8102,8459-8466,8046,5824
- Confidence: reproduced for Tag; traced for LMCTF, DeathBall, Horde
- Evidence: The `world:simulation` record has no `tagToken`, `tagOwner`, `lmctf*`, `deathball*` or `horde*` field, yet the actors survive through `detachedModels`, and restore rebinds each one with gib callbacks: `this.callbacks.bind(actor, { think: self => this.actors.release(self), touch: null, ...})`. After restoring a Tag save, `tagToken` was null and `detachedModels` held 1 entry; after a few steps there were 2 `models/items/tagtoken/tris.md2` models. `lastAttack` is saved only in the Q3 branch (8046), so attacker credit is also lost on other sources.
- Impact: Loading a Tag, LMCTF or DeathBall save leaves untouchable ghost objectives, re-spawns new ones, forgets token, flag and rune holders and team assignment, while carried `q2:flag` and rune inventory items stay. `assertCheckpointReady` (7962) has no gate that refuses this.
- Remediation: Checkpoint the foreign match state with actor references and rebind touch callbacks on restore, or refuse saves while a foreign match mode is active.

### SIM-005 — Q3 source restart leaves foreign match state pointing at released actors
- **Verification (VERIFY-C): confirmed-with-changes. Final severity: Medium.** Tag and Deathball on q3dm1 report `source-reset` and, after a simulation-level restart with the bot restart calls: Tag has tagToken set but not live, no models after 50 ticks and a stale tagHealth; DeathBall has dbPrepared true and no ball model (verify/s/sim.ts). The LMCTF part is refuted for this launch: sourceRestartPlan returns `replace-world` ("Selected adjunct providers require full world replacement", runtime.ts:7198-7205), so its stale fields go with the replaced world. The full Application.restartSourceRound path was not completed, because the harness client has no admission owner. ## Side observations (not verified findings) - QC mode on e1m1 threw `QcProgramError: Unmatched id1 synchronous damage scope` and on e2m1 threw `QcRuntimeError: unbound builtin objerror (11)` during t5.ts. That script teleports the player, so a harness cause is not excluded. An unbound `objerror` builtin is worth a separate look. - In t2.ts QC mode, the player's z fell from -256 to -392 after the grenade contact at a spot with floor near -280. Likely the dead player falling through the floor; not investigated. - With rules standard, a Rogue map containing horde_manager throws `Q1 official spawn not yet implemented: horde_manager`.
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/simulation/runtime.ts:7198-7237,5824-5825,6122,6270,6288
- Confidence: reproduced for Tag; traced for LMCTF and DeathBall
- Evidence: `sourceRestartPlan` returned `{"kind":"source-reset"}` under Tag rules. `restartSourceRound` releases all actors but resets no foreign state. After restart, re-admission and 10 ticks: token live = false, `detachedModels` size = 0, and `tagHealth` still held the old actor. `tickTag` spawns only when `this.tagToken === null && this.tagOwner === null`, and `tagToken` still holds the released actor. `lmctfPrepared` and `deathballPrepared` also stay true.
- Impact: After `map_restart` on a foreign-mode Q3 server the token, flags, runes or ball never come back, and the match is unplayable until a map change.
- Remediation: Reset all foreign match fields in `restartSourceRound`, or return `replace-world` from `sourceRestartPlan` when a foreign mode is active.

### SIM-006 — Tag token return does not relink, so the trigger stays at the old spot
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** runtime.ts:5828 writes with no link, and body.ts write only updates the snapshot, unlike spawnTagToken's link at :5932. Touch is trigger-based (:5929-5930). The omitted +16 is real: :5928 adds it, :5828 does not, and :5920 supplies only the +24.
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/simulation/runtime.ts:5825-5830; world/actors/body.ts:111-118
- Confidence: reproduced
- Evidence: `if (spot !== null && body !== null) this.bodies.write(this.tagToken, { ...body, origin: spot, velocity: zero });` has no `link`, and `SharedBodyTable.write` does not relink. The token has no motion, so nothing relinks it later. After 32 s on q3dm1 the body z was 8 while the linked origin z was 24. The relocation also omits the +16 applied by `spawnTagToken`.
- Impact: After a 30 s return, the drawn token and its pickup volume are in different places. Pickup happens at the old spot rather than where players see the token.
- Remediation: Call `this.bodies.link(token)` after the write and use the same height offset as spawn.

### SIM-007 — Foreign team and rune tables mishandle disconnects
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** Grep shows no delete or clear for lmctfTeams, deathballTeams, lmctfHealth, lmctfRegenAt or tagHealth, and :6129,:6275 count all entries. :6151 nulls the holder, while spawnLmctfRune is called only at :6116 and :6181, so a departed holder's rune is not respawned.
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/simulation/runtime.ts:6126-6131,6273-6277,6146-6152,323,332,335-336,342,762-773
- Confidence: traced (LMCTF content is unavailable here, so it was not run)
- Evidence: `lmctfTeams`, `deathballTeams`, `lmctfHealth`, `lmctfRegenAt` and `tagHealth` have no delete site and are absent from the release handler. Balance counts every entry: `for (const team of this.lmctfTeams.values()) if (team === 1) red++; else blue++;`. A departed rune holder only does `rune.holder = null`, with no `spawnLmctfRune`, unlike the death branch at 6181.
- Impact: Teams drift out of balance as players churn, because departed players still count. Each rune whose holder disconnects is gone until the next map. The maps grow per join for the map's lifetime, which is a small but real retention on long-running maps.
- Remediation: Delete these entries in the `onRelease` handler and respawn the rune at a spot when its holder leaves.

### SIM-008 — NetQuake `name` and `color` commands grow the QC string arena without limit
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** quakec-source.ts:660 allocates for NetQuake on each call, reached from network-q1-quakec.ts:179-184. memory.ts allocate and reserve have no free path and overflow only at 2 GiB. The QW branch uses setEngine. No command rate limit appears on this path.
- Severity: Medium
- Category: leak
- Location: src/app/bootstrap/simulation/quakec-source.ts:659-660; network-q1-quakec.ts:179-184; compat/qc/memory.ts:99-110,120-124
- Confidence: traced
- Evidence: `this.machine.strings.allocate(values.get("name") ?? "unnamed")` runs on every `setClientInfo`, and both commands reach it. `reserve` only bumps `used` and doubles the arena, with no free path, up to `throw new QcProgramError("string arena overflow")` at 2 GiB. The QW branch instead uses the fixed `setEngine("qw-name:slot", ..., 32)`, and original Quake keeps a fixed per-client name buffer.
- Impact: A connected client can spam `name x` or `color 1` to consume memory for the map's lifetime; the arena is also written into saves. Reaching 2 GiB would throw a QC program error.
- Remediation: Use a per-slot `setEngine` entry for NetQuake netname as well.

### SIM-009 — QuakeWorld `setinfo` has no size limit, which can block later joiners
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** QW/client/common.c:2029 limits keys and values to under 64 characters, :2038 and :2050 cap the total, and MAX_INFO_STRING is 196 (common.h:31). The port has none. Source review: SRCQ1
- Severity: Medium
- Category: security
- Location: src/app/bootstrap/simulation/network-qw.ts:225-229,64-72,118-123
- Confidence: traced
- Evidence: `if (key === undefined || value === undefined || key.startsWith('*') || /[\\"\n\r]/.test(key + value)) return; ... client.info.set(key, value)` limits neither key length, value length nor total size, and each change queues a reliable broadcast. `spawnMessages` encodes each full `userinfo` into `new SizeBuf(1400)`, and SizeBuf throws "Quake message overflow" because overflow is not allowed. Original QW caps keys, values and the info string.
- Impact: One client can grow its info map for the whole connection, amplify reliable traffic to all peers, and, past about 1400 bytes, make `spawn` throw for every later joiner, so nobody else can enter. The server survives because qw-server.ts:286 disconnects the joiner.
- Remediation: Enforce native info-string limits for key, value and total length, and reject the update when exceeded.

### SIM-010 — Dedicated Q1 sources tick at up to 250 Hz, with no `sys_ticrate` or 72 Hz cap
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** WQ host.c:505 caps at 72 Hz, host.c:60 sets sys_ticrate 0.05, and sys_linux.c:411-419 and sys_win.c:862 pace dedicated servers. Source review: SRCQ1
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/application.ts:4698,4701; frame-time.ts:65-68; simulation/runtime.ts:5158-5162,5174
- Confidence: traced
- Evidence: `if (elapsed < 4) { await Bun.sleep(4 - elapsed); continue; }` is the only limiter in `run()`. The Q1 dialect returns `Math.max(1, Math.min(100, scaled))`, and for Q1 `fixed === null`, so every application step is one source frame of that length. A repository grep for `sys_ticrate` and `host_maxfps` found nothing. Original Quake dedicated servers tick at `sys_ticrate` (0.05 s) and `Host_FilterTime` caps at 72 Hz.
- Impact: Dedicated Q1 servers can spend up to about 12× the original tick count on simulation and QC. Quake's frame-dependent behavior can differ from the original at these rates. Graphical cases were not evaluated, since vsync may bound them.
- Remediation: Accumulate host time for NetQuake sources and step at `sys_ticrate` when dedicated and at no more than 72 Hz otherwise.

### SIM-011 — QuakeC disconnect skips equipment shutdown
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** runtime.ts:7308-7311 returns before :7313-7314, while the q2-native branch at :7306 makes both calls. The skipped calls are certain. The reconnect effect remains plausible, as the finding states, and it applies only to mixed QC compositions.
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/simulation/runtime.ts:7308-7314,762-773
- Confidence: traced for the skipped calls; plausible for the reconnect effect
- Evidence: The QuakeC branch runs `disconnectClient`, `this.playerStates.delete(player.actor)`, `return undefined;`, which returns before `this.grapple?.release(actor); this.stepHandGrenade(player.actor.id, "removing");`. Other sources reach those calls or their equivalents. Reserved QC slots do not necessarily release their actor, so the `onRelease` cleanup does not necessarily run.
- Impact: In mixed QC compositions a departing client can leave its hook or held grenade live, and per-actor tables (`weaponSlots`, `selectedPickupBindings`, selected arsenal) can stay bound to the slot for the next occupant.
- Remediation: Run the same equipment release before the QC branch and clear per-actor adjunct state when the reserved slot is vacated.

### SIM-012 — Any exception in a tick ends the whole host
- Severity: Medium
- Category: robustness
- Location: src/app/bootstrap/application.ts:4685-4689,4701; simulation/events.ts:55-57; quakec-source.ts:301; runtime.ts:5147,5307,1436,1595
- Confidence: traced
- Evidence: `step` has a `finally` for its own flags but no fault boundary around a client or actor turn. application.ts:4686 rethrows unless `fatalWorldFailure` is set. Hard throws in the tick include event exhaustion ("Simulation event capacity exhausted"), "NetQuake source output overflow", and "Command targets an unadmitted player" for a command whose player was released earlier in the same frame. Original NetQuake drops datagram overflow rather than aborting.
- Impact: A single mod or content defect, or transient overload, takes down all players instead of the offending client or entity. Failing loudly is a deliberate and defensible design for integrity; the cost falls on long-running public servers.
- Remediation: Drop stale commands quietly, drop unreliable output on overflow, and for dedicated hosts add a world-replacement recovery boundary with logging.

### SIM-013 — NetQuake message routing re-encodes the whole queue for every message
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** quakec-source.ts:299-300 re-encodes every live routed batch on each new batch, and presentation-host.ts:364 allocates SizeBuf(8000) per call (message.ts:10 allocates at construction). Not measured.
- Severity: Medium
- Category: performance
- Location: src/app/bootstrap/simulation/quakec-source.ts:298-302; compat/qc/presentation-host.ts:363-370
- Confidence: traced (not measured)
- Evidence: Each routed batch runs `let queued = 0; this.netQuakeRouted.forEachLive(entry => { queued += this.messages.captureNetQuakeMessages(entry.messages).length; });`, and `captureNetQuakeMessages` allocates `new SizeBuf(8000)` per call. Work is O(n²) in batches per tick, and each step allocates an 8 KB buffer. At n=100 that is about 5,050 buffers, roughly 40 MB of churn in one tick.
- Impact: Busy native NetQuake servers pay a quadratic encode and heavy GC cost exactly when traffic peaks. It also allows the overflow throw in SIM-012.
- Remediation: Track a running byte total, adding each batch's encoded size once and clearing it on drain.

### SIM-014 — Q2 network host rebuilds all entity state per client per frame
- **Verification (VERIFY-J): confirmed. Final severity: Low.** network.ts:381 calls visibleEntities(player, entityStates(protocol), origin) per client frame. :92-99 rebuilds presentations and states, :143-147 rebuilds byNumber and fat leaves. :153 state.solid mutates the record, as noted.
- Severity: Low
- Category: performance
- Location: src/app/bootstrap/simulation/network.ts:92-99,143-147,381
- Confidence: traced for the structure; the presentation cost is measured
- Evidence: `frame` calls `visibleEntities(player, entityStates(protocol), origin)`. Each call runs `simulation.presentations()`, builds a Map, allocates one `EntityStateT` per entity, builds `byNumber`, and queries `boxLeaves` per entity. `presentations()` alone took a median 0.219 ms at 352 actors on base1.
- Impact: Cost scales as clients × entities and allocates per client, although the server-side entity state is the same for all clients. Noticeable at high client counts, not a problem at low ones.
- Remediation: Build entity states once per frame and protocol, then filter per client. `state.solid = 0` at line 153 needs per-client handling first because it mutates the shared record.

### SIM-015 — Per-tick allocation and repeated sorting in the shared loop
- **Verification (VERIFY-J): confirmed-with-changes. Final severity: Low.** Behaviour holds at physics.ts:399-402,471 and runtime.ts:4019,5595-5601,8561-8580,7347-7358. The citation 4733-4737 is wrong (it is q2WeaponInput): playerClient is at runtime.ts:6733-6737. The linear scans there apply to q2-native and q3-qvm sources only.
- Severity: Low
- Category: performance
- Location: src/app/bootstrap/simulation/physics.ts:399-402,471; runtime.ts:4019,4733-4737,5595-5601,8561-8580,7347-7358
- Confidence: reproduced (timing); allocation counts not measured
- Evidence: `candidates()` does `observations().map().sort().flatMap()` for each moving pusher, 0.100 ms at 352 actors. `orderedActorTurns` rebuilds and sorts all turns whenever `actors.revision` changes, including mid-turn. `players()` copies and sorts on every call, `playerClient` scans linearly, and `snapshot` and `capturePresentationSnapshot` allocate per actor per tick. Measured median idle `step`: Q2 base1 3.08 ms (352 actors), Q1 e1m1 3.27 ms (160), Q3 q3dm1 0.48 ms (69).
- Impact: Costs are moderate against 25-100 ms tick budgets, so this is not an urgent frame-time problem. It adds GC pressure at higher rates (see SIM-010) and in mover-heavy maps.
- Remediation: Keep a source-ordered actor list updated on allocation and release, and cache `players()` per revision.

### SIM-016 — Foreign Q1 adjunct campaign flags and cvars are not saved
- **Verification (VERIFY-J): confirmed. Final severity: Low.** runtime.ts:1818-1833 saves neither adjunctCampaign nor cvars. Flags do change at runtime through addons (content/q1/addons/campaign.ts:93, commands.ts:71), so the gap is live; the primary campaign is saved separately at runtime.ts:8066.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/simulation/runtime.ts:1266-1270,1273,1295,1818-1833
- Confidence: traced
- Evidence: `adjunctCampaign` and the local `CvarRegistry` are created per world, can be changed by source calls (`adjunctCampaign.flags = flags`, `cvars.set(...)`), and `captureForeignQ1World` stores only `reference, edition, program, frame, random, entities`.
- Impact: After restore, Q1 adjunct logic that reads changed server flags or cvars on a foreign map sees defaults.
- Remediation: Add both to `ForeignQ1WorldCheckpoint`.

### SIM-017 — Shared physics deviates from source in zero-fraction toss and Q2 ground check
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** g_phys.c:713 pushes once per SV_Physics_Toss. g_monster.c:175-178 M_CheckGround copies endpos and zeroes velocity[2]. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/simulation/physics.ts:713-734,668-671
- Confidence: traced
- Evidence: After a zero-fraction hit the loop retries up to 3 more times in one step: `if (trace.fraction > 0 || bump >= 3 || !this.live(actor)) break; trace = this.pushEntity(...)`. Original SV_Physics_Toss makes a single push per frame; the comment documents this as a deliberate fix for hanging items. `pushEntity` fires impact and trigger callbacks on each retry, for every family. In the Q2 step path, `M_CheckGround` also copies `trace.endpos` to origin and zeroes `velocity[2]`, while line 670 sets only `ground`.
- Impact: Grenades and items wedged in corners can fire several touch callbacks per step, including QC touch functions and bounce sounds, and move differently from the originals. Q2 steppers can keep residual vertical velocity on landing.
- Remediation: Limit the retry to non-callback sliding or to an opt-in compatibility flag; snap origin and zero `velocity.z` in the Q2 ground check.

### SIM-018 — `runtime.ts` is an unmaintainable god object with duplicated subsystems
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** Rechecked 8591 lines, 759 `source.kind`, 272 lines over 200 characters, 5 over 400, longest 943. `var sliceTouches` is at :7091 and imports after the class at :8556-8557. The method and field counts and duplicate ranges were not recounted.
- Severity: Medium
- Category: maintainability
- Location: src/app/bootstrap/simulation/runtime.ts (whole file); 1368-1482 vs 1565-1626; 1272-1297 vs 3639-3668; selectedPlayer at 1277-1282 vs 3644-3649; 8121-8143 vs 8151-8174; 5765-6300; 7091; 8556-8557
- Confidence: traced (metrics from grep/awk)
- Evidence: 8591 lines, one class with 161 field declarations and about 332 methods; 759 `source.kind` references; 272 lines over 200 characters (5 over 400, longest 943). The `step` method spans 5123-5585 with a 370-line boundary loop body. Duplicates include two `validatePlacement`/`resume`/`setRoute` monster admission hosts, two Q1 composition service objects and sync/async native restore paths. Foreign Tag, LMCTF, DeathBall and Horde rules (about 540 lines) live inside the class, and every defect in SIM-002 to SIM-007 comes from that placement: their state bypasses the per-actor release, save and restart paths everything else follows. Also `var sliceTouches` in a `finally` (7091) and imports placed after the class (8556).
- Impact: Lifecycle work must be repeated by hand per field, so omissions like SIM-004, SIM-005 and SIM-007 are easy to make and hard to review. Line length defeats diff review and blame.
- Remediation: Extract a `ForeignMatchRules` component with its own release, checkpoint and restart contract, replace `source.kind` chains with a per-source strategy interface, and share the monster admission and Q1 service builders.

### SIM-019 — Foreign match tests skip the failing paths
- **Verification (VERIFY-J): confirmed. Final severity: Low.** foreign-deathball.test.ts:58-62 writes the ball to the goal directly. checkpoint/restore/disconnect grep is 0 in all three files. foreign-lmctf.test.ts:108 waits for a carrier to clear, but no reset-after-goal or token-return assertion exists.
- Severity: Low
- Category: test-gap
- Location: tests/first-playable/application/foreign-deathball.test.ts:58-62; foreign-tag.test.ts; foreign-lmctf.test.ts
- Confidence: traced
- Evidence: The DeathBall test moves the ball with `sim.bodies.write(...)` to the goal instead of through physics, and runs only on a Q3 world. A grep of the three files finds no `checkpoint`, `restore` or `disconnect`, and no reset-after-goal or token-return assertion.
- Impact: SIM-002 to SIM-007 ship with green tests.
- Remediation: Add per-family tests for ball motion, goal-reset linkage, save and restore, source restart and holder disconnect.

### SIM-020 — Unified host treats any remote command exception as a host failure
- Severity: Info
- Category: robustness
- Location: src/app/bootstrap/network/unified-server.ts:129-130,163; simulation/network-unified.ts:226-231
- Confidence: traced; no trigger found by fuzzing
- Evidence: `else if (control.kind === 'command') hostCall(() => this.host.command(player, control.name, control.args));` wraps errors in `UnifiedHostFailure`, and poll rethrows the cause. The fuzz listed under Strengths found no throwing input with cheats disabled, but cheat-enabled and mod-provided paths contain explicit throws (for example quakec-source.ts:814,857,864, which this host does not reach today).
- Impact: Any future throwing command handler becomes a remote server kill, as in SIM-001.
- Remediation: Treat command-handler errors as a peer fault unless the error is explicitly marked as host corruption.
