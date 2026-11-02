# GAPQ3B — Q3 logic left unread by GAPQ3: base/game remainder, base/shared, foundation, equipment, presentation helpers

All paths are relative to `src/content/q3/` unless they start with `src/`. HEAD fcdc8af5.

Comparisons with ioquake3 and id's GPL game and cgame are from my memory of that source. It is not in the repository, so I could not diff against it. Reproductions are `gapq3b/repro.ts`, `gapq3b/hang.ts` and `gapq3b/scan_maps.py` in the scratchpad. "Reproduced" means the value, throw or hang was observed at module level with real project modules. No finding was driven through a live server and client. The route from each throw to process exit is stated in its entry.

## Coverage
**Read in full, about 9,700 lines:**
- base/game: save-values 680, save-state 182, utilities 199, misc 116, misc-spawn 169, mover-spawn 292, personal-portal 209, item-motion 213, entities 257, state 249, projectile 147, shader-remaps 106, rankings 704, memory 77, save-reader 63, ballistics-math 56, radius-damage 47, save-callbacks 45, use-participant 29, save-level 28, ground 28, save-module-values 25, grapple 23, level 20, numeric 1
- base: records 285, combat-bridge 172, world-adapter 123, settings 101, map-spawns 62, world 31, index 27, bot-debug 2
- base/shared: items 520, player-state 267, definitions 154, trajectory 88, snapshot-state 73, entity-shared 53, jump-pad 17, entity-state 1, slide-move 1
- team-arena: client-events 126, client-policy 120, foreign-objectives 50, objective-placement 45, movement-host 25, index 14
- foundation: character 267, player-pose 265, animation-config 184, animation 159, assets 121, presentation 116, events 89, weapon-pose 66, movement-hooks 48, weapon-behavior 17, held-weapons 10, index 10
- equipment/*: all 8 files, 209 lines
- q3 root: guest-items 101, product-restriction 31, input-profile 15
- presentation: mark-projector 219, ref-entity 176, scene 154, draw-tools 130, retail-snapshot 72, refdef 50, cgame-body-profile 41, model-access 31, ui-adapters 29, character-resources, movement-host, collision-host, scene-host
- The parts GAPQ3 left open: presentation/media 1-560, presentation/config 1-236, presentation/marks 1-70

**Sampled:** base/shared/direction-byte: the code and the first and last rows only. I did not check rows 15-169 of the 162-entry normal table.

**Skipped:** presentation/index.ts (27 lines, not opened).

**Also read, outside the scope, to trace paths:** `src/app/bootstrap/simulation/q3/runtime.ts` 170-200, 370-390, 524-600; `src/app/bootstrap/simulation/runtime.ts` 3605-3625, 4291-4310, 5488-5503; `src/app/bootstrap/simulation/network-q3.ts` 155-185; `src/world/actors/triggers.ts`; `src/world/actors/body.ts` 108-118, 160-206; `src/world/gameplay/inventory.ts` 308-345; `src/app/bootstrap/match-preflight.ts` 15-28; team-arena/client-think, client-effects and presentation/players and entities excerpts; base/game/mover.ts 300-330.

**Could not reach or verify:**
- Follow mode, trains and NaN movers over a live server with a connected client. The harness stops at module level, and the snapshot route was read, not run.
- What happens to a NaN mover after `world.link` on the server. I did not run the spatial index with it.
- The equipment profiles' digests, entry numbers and field offsets. They are pinned to QVM bytes, and I did not check them against the binaries.
- The ranking key constants. CONTENT1-021 already covers that service as defunct, and I have no source for the numbers beyond memory.
- `JSON.parse` in cgame-body-profile.ts:16 and guest-items.ts:35 on mounted metadata. I did not trace the callers, so I make no claim about whether a bad file is fatal.

**Checked and dropped, so nobody re-reports them:**
- Personal portal source (`CONTENTS_CORPSE | CONTENTS_TRIGGER`) gets role "solid" at world-adapter.ts:90, which looked like it would never touch. Refuted for native players: client-think.ts:126 tests `hit.r.contents & CONTENTS_TRIGGER`.
- `launchItem` interns callbacks lazily, which would break restoring a save with dropped items. Refuted: q3/runtime.ts:174 binds them at construction.
- `media.players`, `media.effects` and similar getters snapshot null handles. Refuted: client.ts:274-277 registers before capture, and a comment says so.
- Missing `G_RegisterCvars` clamp for `g_gametype`. Not a finding: match-preflight.ts:23 and runtime.ts:3614 refuse the value. That is a refusal rather than the source's reset to 0, and only an operator can reach it.
- Unsaved level fields. All `MatchState` fields are covered by `LevelValues` or `captureQ3Level`.
- `G_FreeEntity` slot reuse, `G_Spawn` forced pass, `G_UseTargets`, `G_PickTarget`, `G_FindTeams`, all `SP_func_*`, `TeleportPlayer`, `G_KillBox`, shooters, portal cameras, `G_RunItem`, `LaunchItem`, `G_RunMissile`, `G_MissileImpact`, `G_RadiusDamage`, `ClientEvents`, inactivity timer, intermission think, `BG_CanItemBeGrabbed`, the item table, `BG_EvaluateTrajectory`, `BG_PlayerStateToEntityState`, `BG_TouchJumpPad`, `CG_ParseAnimationFile`, `CG_RunLerpFrame`, `CG_PlayerAngles`, `R_MarkFragments`, `FS_SetRestrictions`, the game cvar table and the cgame cvar table matched my memory of the source, apart from the findings below.

## Strengths
- Save coverage is checked by the compiler for the three largest records. `CompleteCoverage` in save-state.ts:173-182 fails the build when a `GameEntity`, `GameClient` or `PlayerState` field is neither saved nor explicitly excluded. I compared the five record types it does not cover (persistant, team, session, network, level) by hand and found none incomplete.
- All entity callbacks go through a named catalog (save-callbacks.ts). A grep of content/q3 and simulation/q3 found no direct callback assignment outside `resolve`, so Q3 does not share the checkpoint failure in CONTENT2-001.
- Source undefined behavior is usually bounded here. `Think_SetupTrainTargets` on a rho-shaped path hangs in C and gets a named error at mover-spawn.ts:190. `AddRemap` overflows in C and gets a length check.
- `Q3RankingReports` is inert unless attached, so the defunct service costs one closure call.
- Numeric faithfulness is careful throughout: binary32 arithmetic, the `SnapVector` truncation variant, x86 indefinite integer handling and int32 wrap.

## Findings

### GAPQ3B-001 — Spectator follow mode does not move the camera or show the followed player's stats on native Q3 servers
- **Verification (VERIFY-Q): confirmed. Final severity: High.** id copies the whole struct: `ent->client->ps = cl->ps` (`game/g_active.c:1077`), then sets `PMF_FOLLOW` and merges vote flags (:1078-1079). A port that preserves origin, velocity, health and ammo differs on core spectator behavior. Source review: SRCQ3
- Severity: High
- Category: bug
- Location: team-arena/client-policy.ts:75; base/shared/player-state.ts:173-174, 181-184, 214, 219; base/records.ts:113, 245-283; src/app/bootstrap/simulation/network-q3.ts:169-171; src/network/q3/visibility.ts:42
- Confidence: reproduced (state after the copy); traced (snapshot)
- Evidence: `SpectatorClientEndFrame` in C does `ent->client->ps = cl->ps`. The port does `client.ps.copyFrom(followed.ps)`, and the default mode is `stores = "preserve-authority"`. With an authority binding, `const preserve = this.authority !== null && stores === "preserve-authority"` skips origin and velocity (`if (!preserve) { this.origin = ...`), skips health, armor and weapons, and skips ammo (`if (!preserve) copySlots(this.ammo, source.ammo)`). Every production client has an authority: `new GameClient(product, this.playerBinding(slot), ...)` at records.ts:113. Nothing else syncs these fields. `syncQ3Player` copies only view angles and movement state. On the server side, the only other reader of `MoveFlags.FOLLOW` is powerup-timers.ts:60, which handles powerup timers. The remaining readers are client-side (prediction, weapons, HUD), and they trust the snapshot.
  The snapshot reads the same state: `value.copyFrom({ ...ps, origin: ps.origin, velocity: ps.velocity, ... stats: slots(ps.stats), ... ammo: slots(ps.ammo) })`, then `selectQ3SnapshotEntities(state, ...)`, which takes `origin` and `clientNum` from it.
  Output of `gapq3b/repro.ts`, using real `Q3EntityRecords` and `spectatorClientEndFrame`:
  ```
  followed origin {900,-700,50}   follower origin {100,100,100}
  followed velocity {320,0,0}     follower velocity {0,0,0}
  viewangles {10,20,0} clientNum 1 weapon 5 pmFlags FOLLOW true
  health 77 vs 125, armor 42 vs 0, weapons 32 vs 0, ammo[5] 9 vs 0
  ```
- Impact: `follow`, `follownext`, `followprev`, attack-to-cycle and `team follow1/2` leave the spectator at their own position, aimed along the followed player's angles, with PVS computed from the spectator's position. The followed player's entity is excluded from the snapshot because `clientNum` is copied. The HUD shows the spectator's own health, armor, weapons and ammo with the followed player's weapon selected. Tournament spectating and the auto-follow cameras are affected. QVM guests are not, because they use their own state.
- Remediation: Pass an explicit mode that copies these values into the snapshot view without writing the spectator's shared body or inventory. A separate "viewed state" for snapshots fits better than `"replace-authority"`, which would move the spectator's body and overwrite its stores. Add a regression test; no test file names `spectatorClientEndFrame` or `spectatorThink`.

### GAPQ3B-002 — A hostile server can hang a TypeScript cgame client forever with one large pitch value
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** `AngleSubtract` has the same unbounded loop (`game/q_math.c:611-618`), so a retail client hangs on such a value too. This is a faithful port of a real weakness. Source review: SRCQ3
- Severity: Medium
- Category: robustness
- Location: foundation/player-pose.ts:100-105, 124, 129, 224-235; presentation/players.ts:415; presentation/entities.ts:201
- Confidence: reproduced (the hang); traced (wire to pose)
- Evidence: `while (angle > 180) angle = Math.fround(angle - 360);`. Once the magnitude is large enough that subtracting 360 does not change the binary32 value, the loop never ends. `float32()` rejects only non-finite input, so 1e30 passes. `calculatePlayerPose` normalizes yaw with `sourceAngleMod` but not pitch, and `pitchDestination = headAngles.x * 0.75` goes into `swingAngles`, which calls `angleSubtract` at line 124 or 129. GAPMAT-001 established that the delta decoder stores any 32-bit float, and `entity.lerpAngles = evaluateTrajectory(current.apos, state.time)` passes it on for any ET_PLAYER.
  `hang.ts` results: pitch 45 and 1e9 return. 1e30 was killed by `timeout` after 6 seconds (status 124). C has the same loop, so this is faithful, but the C game is not the standard this port is otherwise held to, since it converts other source faults into checks.
- Impact: One entity field from a malicious server freezes the client thread. Unlike GAPMAT-001's exit, the process stays up with no input handled until it is killed. A peer on an honest server cannot cause this, because PM_UpdateViewAngles derives view angles from 16-bit shorts.
- Remediation: Replace the loops with a modulo reduction in `angleSubtract`, or range-check angles at snapshot admission.

### GAPQ3B-003 — A func_train leg shorter than one millisecond produces NaN origins; ioquake3's fix is absent
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Low.** id has no guard: `trDuration = length * 1000 / speed` (`game/g_mover.c:1309`) and `f = 1000.0 / trDuration` (:530, :537). The port therefore matches id, and the absence is not a port divergence. The ioquake3 fix is unverifiable here. The finding's own scan shows no retail map reaches it. Source review: SRCQ3
- Severity: Medium
- Category: bug
- Location: base/game/mover-spawn.ts:173-176; base/game/mover.ts:315-316, 321-322
- Confidence: reproduced (NaN at `setState`, passed to `link`); plausible (effects beyond `link`)
- Evidence: `const duration = floatInt(f32(f32(length3(sub3(entity.pos2, entity.pos1)) * 1000) / speed));` then `delta: scale3(sub3(entity.pos2, entity.pos1), f32(1000 / f32(previous.duration)))`. With duration 0 the scale is Infinity. Coincident corners give `0 * Infinity = NaN`. A short leg gives Infinity in the delta and `Infinity * 0 = NaN` when evaluated at `deltaTime` 0. The repro shows `entity.r.currentOrigin` is `{NaN,NaN,NaN}` when `world.link` is called, and it stays NaN 100 ms later. `InitMover` has a guard (`duration: Math.max(duration, 1)` in `initializeBinary`, mover.ts:398), but `Reached_Train` does not. As I recall, ioquake3 added exactly this guard to `Reached_Train`, setting `trDuration = 1` and `SVF_NOCLIENT` for the "fast move case", with a comment describing corrupted bounds that could jam other movers.
  `scan_maps.py` over 96 retail maps (baseq3, missionpack, lrctf) found 3 func_trains, 24 path_corners and no zero-duration legs. Only custom maps are affected, typically ones using coincident corners or a very high speed to teleport a train.
- Impact: The mover origin and delta become NaN. They go into the collision link and the snapshot. GAPMAT-001 showed a NaN origin exits the TypeScript client in the renderer's light sampling, so I expect this to end connected clients. I did not run that route for a mover, and I did not determine whether the server survives.
- Remediation: Apply the ioquake3 guard in `reachedTrain`: clamp the duration to 1 and set `SVF_NOCLIENT`, clearing it on the next leg.

### GAPQ3B-004 — A path_corner targeting an activator-using entity ends the server, where the QVM game read low memory and carried on
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** `G_UseTargets( next, NULL )` is at `game/g_mover.c:1287`, and handlers read `activator->client` (`game/g_target.c:34,68,143,348`). The "treated as no client" claim now has evidence: the word at VM data address 308, my computed `FOFS(client)`, is 0 in retail `pak8.pk3 vm/qagame.qvm`. Source review: SRCQ3
- Severity: Low
- Category: robustness
- Location: base/game/mover-spawn.ts:167-169; base/game/use-participant.ts:16-19; base/game/targets.ts:92-93, 104, 124, 179, 196, 229, 267, 369, 392, 434-436; base/game/mover.ts:296; src/app/bootstrap/simulation/q3/runtime.ts:586-595; src/app/bootstrap/simulation/runtime.ts:5496
- Confidence: reproduced (the throw); traced (caller chain)
- Evidence: `G_UseTargets( next, NULL )` is the source's call, ported as `useTargets({...}, next, null)`. The handlers then call `requireUseParticipant(activator)`: `if (participant === null) throw new Error("Target handler requires an activator")`. This covers target_give, target_remove_powerups, target_score, target_print, target_push, target_teleporter, target_kill and target_speaker with flag 8. target_relay with team flags has its own throw. In the original QVM, `activator->client` reads near address 0 and yields a value treated as no client, so `target_print` prints to everyone and the others return. A native DLL build would crash instead.
  Caller chain: the first corner fires from `setupTrain`, 100 ms after spawn, through `runThink`. Later corners fire from `part.reached?.(part)` at mover.ts:296. Both run under `runActor`, called from the simulation loop at runtime.ts:5496. There is no try or catch within the 60 lines above that call, which agrees with SIM-012. So this is fatal to the host once the train reaches that corner, unlike a console-path throw.
  The retail scan found no path_corner targeting anything except path_corners, so stock maps do not reach it. `shader-remaps.ts:30-32` is a similar map-data throw for a shader name of 64 or more characters, also with no retail occurrence.
- Impact: A custom map using a train corner to fire `target_print` or similar ends the server at that moment. Only the operator chooses maps, so this is a compatibility defect and not a remote attack.
- Remediation: Treat a null activator as "no client" in these handlers, which matches what the QVM did: print to all, or return.

### GAPQ3B-005 — An animation.cfg with no frame numbers escapes the parser's error class and ends the client
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** `if ( !token ) break` (`cgame/cg_players.c:130`) can never fire, because `COM_ParseExt` returns `com_token` at end of data (`game/q_shared.c`). So the "loops forever in C" claim holds for a file with no frame numbers. Source review: SRCQ3
- Severity: Low
- Category: robustness
- Location: foundation/animation-config.ts:86, 129; presentation/players.ts:557-564, 712-722; presentation/server-commands.ts:306, 160-163
- Confidence: reproduced (error class); traced (caller chain)
- Evidence: `if (previous === cursor.offset) throw new RangeError("CG animation prelude reached the source nonprogress cycle")` and `if (message.length >= 1024) throw new RangeError("CG_Printf exceeds its 1024-byte source buffer")`. The caller handles only one class: `if (!(error instanceof PlayerAnimationParseError)) throw error;`. The repro gives `RangeError parseError=false` for `footsteps boot\nsex m\n`, for a comment-only file and for a 1,020-character unknown token. A truncated frame list correctly gives `PlayerAnimationParseError`.
  Caller chain: `newClientInfo` catches only `SupersededClientLoad`, `server-commands.ts:306` awaits it inside `queue`, and `queue` disposes the runtime and rethrows. GAPQ3-003 traced that route to the run loop with no catch. Loading during `CG_Init` follows the same `load`. In C the first case loops forever.
- Impact: The file must be in the client's mounts, for example a broken custom model pk3. Any peer can then select that model by name, which ends that client, instead of falling back to the default model as other bad animation files do.
- Remediation: Throw `PlayerAnimationParseError` from both sites.

### GAPQ3B-006 — A stopped grenade loses its rotation because `s.time` is never written
- **Verification (VERIFY-Q): refuted. Final severity: Info.** id's stop path is `G_SetOrigin( ent, trace->endpos ); return;` with no `s.time` write (`game/g_missile.c:48-49`). The port matches id 1.32. The recalled line, if it exists anywhere, is later than this release. Source review: SRCQ3
- Severity: Low
- Category: bug
- Location: base/game/projectile.ts:78; base/game/missile.ts:233; presentation/entities.ts:320-322
- Confidence: traced (the source line is from memory)
- Evidence: As I recall, `G_BounceMissile` does `G_SetOrigin( ent, trace->endpos ); ent->s.time = level.time / 4; return;`, so the client's `RotateAroundDirection( ent.axis, s1->time )` continues from the spin angle it had. The port's stop path is `{ host.setOrigin(trace.end); return; }`, and a grep of base/game finds `s.time` written only for score plums (death.ts:116). The client reads it: `else ref.axis = directionAxis(direction, current.time);`.
- Impact: Every grenade snaps to rotation 0 when it comes to rest. This is cosmetic.
- Remediation: Set `s.time = (time / 4) | 0` in the stop branch, through a host method.

### GAPQ3B-007 — Any body or combat write on a freed record silently allocates a new actor
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** `G_RunItem` uses the entity after `G_RunThink` in the same order (`game/g_items.c:991-1008`). The hazard is the port's allocating setter, not the order. Source review: SRCQ3
- Severity: Low
- Category: robustness
- Location: base/records.ts:99, 105, 107, 128-136; base/game/item-motion.ts:142-151; base/game/entities.ts:115-117; base/game/ground.ts:11-13
- Confidence: traced
- Evidence: Bindings use `write: (value) => { host.bodies.write(this.ensureActor(slot), value); }`, and `ensureActor` allocates when `record.actor` is null. `G_RunItem` keeps using the entity after its think: `runThink(entity, time)`, then `pointContents`, then `free` or `bounceItem`. When the 30-second expiry fires in the same frame as a collision, the item is already freed, and `setOrigin` and `traceGround` then write to it. In C that is a harmless write into a zeroed slot. Here it creates an actor with a body, combat state and inventory while `active` stays false. `clearEntities` skips it (`if (entity?.inuse)`), so it lives until the slot is reused or the session closes. The next `G_Spawn` of that slot inherits the body's origin and ground. `free` on the NODROP branch runs twice, which is harmless.
- Impact: The trigger is rare, since a dropped item must still be moving at 30 seconds. Growth is bounded by 1,024 slots per world. The real risk is the hazard itself: the type gives no sign that a setter on a freed record allocates, and a future caller could hit it on a common path.
- Remediation: Return from `runItem` when `entity.inuse` is false after `runThink`, and make binding writes on an inactive record throw or no-op.

### GAPQ3B-008 — Every actor-to-entity lookup scans the 1,024-slot record table
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** No source claim to settle. Not re-tested. Source review: SRCQ3
- Severity: Low
- Category: performance
- Location: base/records.ts:198-205, 216, 239; base/world-adapter.ts:44, 65; base/game/ground.ts:8; src/app/bootstrap/simulation/q3/runtime.ts:587; src/app/bootstrap/simulation/runtime.ts:4293
- Confidence: reproduced (cost); traced (callers)
- Evidence: `this.records.find(record => record.actor?.id.equals(actor))`. It is called for every actor on every tick (`runActor`, then `syncQ3Player` for players), for each actor hit by a trace, per entity in `areaEntities`, per touch, in `combat-bridge.policy` per damage request, and in `groundNumber`. Measured with real records and registry and 400 active entities: 871 ns per hit, 2,402 ns per miss, which foreign actors always take, and 0.35 ms for one sweep of 400 actors. There are 127 references to `nativeByActor` and `byActor` in src.
- Impact: The sweep alone is under 1% of a 50 ms tick, so this is not urgent. It scales as actors times slots, and foreign-actor misses in unified sessions are the costly case.
- Remediation: Keep a map from `actor.slot` to record, updated where `record.actor` changes.

### GAPQ3B-009 — The new defects sit in code with no direct tests
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Low.** Test gap stands. Its follow-mode and train cases remain valid targets, but GAPQ3B-003's case tests a behavior id shares. Source review: SRCQ3
- Severity: Low
- Category: test-gap
- Location: tests/ (grep)
- Confidence: traced
- Evidence: `grep -rl` over tests/ finds no file naming `spectatorClientEndFrame`, `spectatorThink`, `calculatePlayerPose`, `swingAngles` or `runItem`, and none in tests/gameplay/q3 or tests/gameplay/foundation/q3 naming `func_train` or `path_corner`. `tests/ui/hud/powerups.test.ts:80` sets `MoveFlags.FOLLOW` by hand, which skips the copy that fails. A grep cannot rule out coverage reached indirectly through a larger harness.
- Impact: GAPQ3B-001 breaks a whole feature and the suite stays green.
- Remediation: Add a test that a follower's snapshot state equals the followed player's, and one for a zero-length train leg.

### GAPQ3B-010 — Five of eight saved record types have no compile-time coverage check
- **Verification (VERIFY-Q): confirmed. Final severity: Info.** No source claim. Not re-tested. Source review: SRCQ3
- Severity: Info
- Category: maintainability
- Location: base/game/save-state.ts:173-182; base/game/save-values.ts:255, 285, 317, 339, 399
- Confidence: traced
- Evidence: `CompleteCoverage` guards `GameEntity`, `GameClient` and `PlayerState`. `ClientPersistant`, `PlayerTeamState`, `ClientSession`, `EntityStateFields` and `GameLevel` rely on hand-kept `Pick` lists, each repeated across capture, restore and read functions. All five are complete today by my comparison.
- Impact: A field added to one of them would be silently lost on restore. There is no current defect.
- Remediation: Add the same `CompleteCoverage` alias for those five.

## Supplements
- Supplements GAPQ3-001: `followCycle`'s sentinel throw does not need a text command after the first one. `spectatorThink` calls `context.followCycle(entity, 1)` on an attack-button edge (client-policy.ts:60-62) whatever the spectator state. So `team follow1` plus pressing attack with nobody playing reaches it through the user command path, inside the simulation tick rather than `q3GameCallback`. I traced this; I did not run it.
- Supplements GAPMAT-001: a NaN pitch on any ET_PLAYER reaches a further throw at `float32()` in player-pose.ts:88-90. `hang.ts NaN` exits with status 1. This is client-side and needs a hostile server.
- Supplements GAPQ3-009: `itemAt(ps.product, ps.persistentPowerupIndex)` in shared/items.ts:461-462, 481 throws on a server-supplied out-of-range stat, where C reads a neighboring table entry. I did not trace this call to its caller, so treat it as a candidate.
