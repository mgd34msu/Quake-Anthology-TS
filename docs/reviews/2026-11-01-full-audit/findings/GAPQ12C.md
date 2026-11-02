# GAPQ12C — Content and bot code left unread by GAPQ12B and GAPBOTS

Paths start at `src/content/` unless they start with `src/`. HEAD fcdc8af5.

No game C or original QuakeC source exists on this machine. Compiled `progs.dat` from `qfiles/q1/rerelease/{mg1,mg3}` was disassembled for three QC questions (script: `<scratchpad>/gapq12c/qcd.py`). Other source comparisons rely on my memory, and each finding says so.

## Coverage
**Read in full, with no line truncation (about 11,700 lines; `import` lines were skipped in the dump):**
- q2/rerelease/monsters (about 2,500): arachnid, berserk, gladiator, guardian, guncmdr, gunner, index, shambler, supertank, tank, generate-tables, common; base-variants actor, boss2, brain, chick, flipper, floater, flyer, hover, insane, jorg, makron, mutant, parasite, proboscis
- q2/missionpacks/monsters (588): rogue-infantry, rogue-soldier, rogue-variants, soldierh, xatrix-variants
- q2/rerelease (293): view, obituary, types, world-text, debug-shapes
- q2/base/player (462): view, obituary, types, checkpoint, resources
- q1/missionpacks (about 2,500): items, selection, runtime, travel, obituaries, presentation, messages, pickup-rules; monsters gremlin, gremlin-ai, dragon, lavaman, mummy, wrath, scourge, eel, sword, spikemine, paths, helpers, charmed-base; world shooters, rotate-targets, rogue-time, rogue-tag, rogue-pendulum, rogue-misc, rogue-hazards, hipnotic-triggers, hipnotic-train, hipnotic-rotate, hipnotic-particles, campaign, finale-text, common
- q1/addons (about 2,600): base-triggers, brushes, campaign, corpses, effects, field-triggers, lights, rope, travel, context, triggers 80-253; ctf/maps, grapple, travel, types; horde/squads, types; items/common, lavasuit, pickups, upgrades, weapons, commands; monsters startup, index, demodog; ai/controller, path, targets; bosses effects, ghost, oldnew-projectiles, oldnew, orb, registry, sphere-points, szombie; heavy index, lava-man, projectiles, rune-knight, runtime, super-shambler; infected controller, index, species; ordinary army, attack, index, rocket-ogre
- src/bots/navigation (1,061): aas-reachability-geometry, aas-reachability-spatial, aas-reachability-types, aas-optimize
- src/bots/behavior/library/weapons.ts 1-559; character.ts 1-339, 520-754, 815-854 (with GAPBOTS's 340-519 and 755-814, the whole file is now read)

**Lines cut by GAPQ12B's fixed-width reads:** I recomputed every line over each group's width. There are nine, and I read them to the end: gremlin-weapons.ts:112; rogue-teams.ts:20, 90, 98, 119, 121, 140, 157; q1/addons/ctf/index.ts:72. GAPQ12B also named rogue-plats.ts:60, which I read too. A file GAPQ12B's list did not state exactly may have been missed by the recomputation.

**Sampled, only to trace a finding:** src/app/bootstrap/effects.ts (240-275, 314-322, 450, 496-516), src/content/composition/q1/{clients.ts 25-40, runtime.ts 66, 212-218}, q2/foundation/entity-services.ts 221-229, q2/foundation/monsters/index.ts 622-660, src/app/bootstrap/audio.ts 515-535, src/app/bootstrap/simulation/runtime.ts (647, 1086, 1206, 2735), q2/missionpacks/monsters/dabeam.ts, q2/rerelease/monsters/beam.ts, q1/base/monsters.ts 64-73, 159-180, src/bots/behavior/library/weapons.ts 1005-1018, shambler move table.

**Could not reach (nothing claimed):**
- Frame and move tables, as data: q2/rerelease/monsters/tables, q1/missionpacks/monsters/tables, q1/addons/monsters/{demodog-frames, bosses/frames, heavy/tables, infected/frames}. Scripts checked names only (see Strengths).
- q2/foundation/items.ts and movers.ts, q2/base/player/{commands,index}.ts, and q2/rerelease/{players,entities,campaign,checkpoint,goals,index,triggers}.ts were outside the listed scope. I did not recheck them.
- Q1 think/touch dispatch was not re-read this round. Fatal claims rest on APP-001 and on the route GAPQ12B-001 traced.
- src/bots: library/libvars.ts, call-steps.ts, rerelease/data/botdata.ts, data/knowledge-q2.ts beyond 40, q2-exports.ts, q3/navigation-types.ts, q3/travel/types.ts, q3/info.ts. GAPBOTS left these and they were outside this brief.
- No game was run with a window. GAPQ12C-002 and -003 were not seen on screen.

**Comparison limits:** Kex's `sin` builtin could not be inspected, which is why GAPQ12C-004 is `plausible`.

## Strengths
- The port is unusually faithful. Each of these looked like a bug, and each matched the source or was refuted:
  - Compiled `sphere_chunk` also never reschedules, so the idle manager is original behavior.
  - The Orb's `play("wiz_run1")` matches the bytecode and resolves through `monsterFrames` (q1/base/monsters.ts:73).
  - The `-delta.y * 16` lightning side vector and `integerAbs` in the AAS ladder code carry a comment or have the shape of the id quirk they preserve (memory).
  - Mummy's stale `game.basis` before `makeVectors` matches my memory of zombie.qc.
- Throws traced and refuted as reachable:
  - `Makron must be registered before Jorg` (makron.ts:36): index.ts registers Makron first.
  - `Rerelease monster source requires the session random stream` (common.ts:11): runtime.ts:647, 1086 and 1206 give every rerelease runtime that stream, foreign worlds included.
  - `gremlin meleeing with stolen weapon` (gremlin.ts:79): the only melee entries are `checkAttack` with `stoleweapon === 0` and the gorging path, which returns at line 78.
  - Boss `Unknown ... action` defaults: a script found every frame action name has a matching case in ghost, orb, oldnew and szombie.
  - `spawnShubZombie` missing point (szombie.ts:98): the index is always below the eligible count.
  - `Missing Rogue random powerup definition` (items.ts:124): `randomType` always sets a valid name.
- A script found every `setMove` name and every template expansion in the rerelease monster files exists in the tables. `Q2Monsters.register` also validates frame callbacks at composition.
- All closures that reach entity fields in the files read are registered by name, so CONTENT2-001's save failure does not recur here. That covers proboscis, flyer, mutant, berserk, brain eyes, hover, Makron torso, actor and tank stand.
- `Q1AddonContext` and the heavy, boss, infected and demodog stores all drop per-actor state in `onRelease`.
- The shipped `default_c.c` defines all 49 characteristics for every skill, so `character.ts`'s per-read "uninitialized" diagnostic does not grow in normal use.
- AAS reachability, spatial and optimize code runs only from `tools/navigation/aas.ts`. Its throws cannot reach the game.

## Findings

### GAPQ12C-001 — A Rogue tag-mode token holder who disconnects terminates the server
- **Verification (VERIFY-G): confirmed-with-changes. Final severity: High.** Re-ran tag.test.ts and got the throw. Route traced: runtime.ts:217-218 -> simulation/runtime.ts:1285 release -> clients.ts:31 delete; rogue-tag.ts:21 announces with owner still set. Correction: announce (rogue-tag.ts:26) calls playerName inside the host.players() loop, so it throws only if another player remains.
- Severity: High
- Category: robustness
- Location: q1/missionpacks/world/rogue-tag.ts:17,21,26; src/content/composition/q1/runtime.ts:66,217-218; src/content/composition/q1/clients.ts:31,34
- Confidence: reproduced for the throw (`gapq12c/tag.test.ts`, GAPQ12B's fixture with `playerName` mirroring runtime.ts:66 and clients.ts:34, printed `THINK ERR: Error: Q1 source client is not admitted`). The route from a real disconnect is traced. It was not run through the full simulation.
- Evidence: the token's think reads `if (e.owner !== null && g.health(e.owner) > 0) {...}`, then `if (e.owner !== null) this.announce("$qc_lost_token", e.owner);`. `announce` calls `this.hooks.playerName(actor)`, which is `this.clients.require(actor).name`. `require` throws when the record is gone: `if (client === null) throw new Error("Q1 source client is not admitted")`. The record is deleted on release (clients.ts:31). `disconnect` (runtime.ts:217-218) calls `packs.playerDied`, which handles teams and runes only (missionpacks/world/index.ts:60), so nothing clears `token.owner`. `g.health` of a released actor returns 0 (entity-services.ts:359). The think runs every 0.1 s, so the throw comes within 0.1 s of the disconnect. In the fixture, `token.owner` was still set after release.
- Impact: on a Rogue server with `deathmatch` on and `teamplay 3`, the player holding the token leaves and the host ends through the run loop (APP-001). `dmatch_tag_token` is in all 16 shipped Rogue maps I scanned (r1m1-r1m7, r2m1-r2m8, start). Any client can do this on purpose by taking the token and disconnecting.
- Remediation: Clear the token when its owner is released, or have `announce` tolerate an unresolved actor, and then respawn the token.

### GAPQ12C-002 — Every laser beam from dabeam monsters stays drawn until the level ends, and the list grows without bound
- **Verification (VERIFY-Q): confirmed. Final severity: High.** original/xatrix/g_monster.c:78-142 and :145-180: RF_BEAM entity, dabeam_hit sets `think = G_FreeEdict` at +0.1 s, so the beam ends with the entity. Callers m_brain.c:644,660, m_fixbot.c:959, m_soldier.c:1688 all use it. The "from memory" lifetime is now proven. Source review: SRCQ2
- Severity: High
- Category: leak
- Location: q2/missionpacks/monsters/dabeam.ts:33-34 (callers soldierh.ts:45, xatrix-variants.ts:80, fixbot.ts:157); src/app/bootstrap/effects.ts:244-246,272,316-319,511,513; q2/foundation/entity-services.ts:221-229
- Confidence: reproduced for the effects side (`gapq12c/beam.test.ts`: 20 beam events on 20 actors, each released, then `prepare` at t=600 printed `BEAMS after 20 emit+release, 10 minutes later: 20 die: Infinity`). The emit side is traced. It was not seen in a running game.
- Evidence: dabeam emits `{ kind: "beam", actor: entity.actor.id, ..., visible: true }`, then `game.schedule(entity, 0.1, freeQ2Entity)`, and `freeQ2Entity` is `game.remove(entity)`. `remove` emits only `{ kind: "visibility", ... }` and releases the actor. It never emits a beam with `visible: false`. The client stores the beam with `die: event.kind === "beam" ? Number.POSITIVE_INFINITY : ...`. Only three things remove it: a beam event with `!event.visible` for that actor (line 511), a later beam on the same actor (244), and level or owner reset (128, 732). `this.beams.filter(beam => beam.die >= now)` never fires, and line 316 draws every entry each frame. Each dabeam has a new actor, so nothing replaces an old one. `freeMonsterBeam` (rerelease/monsters/beam.ts:35) does send `visible: false`, which shows the protocol this path misses.
- Impact: in The Reckoning and in Ground Zero fixbot welds, every shot from `monster_soldier_lasergun`, every Xatrix brain eye laser and every fixbot weld beam leaves a permanent translucent line. In the original, as I recall it, the beam edict lived 0.1 s. A long firefight adds hundreds of lines and one batch per frame for each, until the next map change. The renderer cost grows with shots fired, on a client process.
- Remediation: Emit `visible: false` from a dedicated dabeam think before freeing, or drop beams in effects when their actor leaves the snapshot, as audio.ts:609 does for loops. The second fix also covers GAPQ12C-003's dead shambler case.

### GAPQ12C-003 — Rerelease shambler lightning stays drawn after the shot, and pain during windup orphans the hand beam
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** The bolt half is proven: rerelease/m_shambler.cpp:306-311 is a one-shot TE_LIGHTNING multicast. The windup half is faithful: PAIN at :195-227 does not free self->beam, and shambler_windup at :70-76 overwrites it, so C orphans the same beam entity. Only die frees it (:510-519). Remove that half or treat it as a deliberate fix. Source review: SRCQ2
- Severity: Medium
- Category: bug
- Location: q2/rerelease/monsters/shambler.ts:18-25,60,82,100; src/app/bootstrap/effects.ts:511,513
- Confidence: traced. The persistence is the mechanism reproduced in GAPQ12C-002. The windup leak's comparison with the C is from memory. `tests/gameplay/q2-rerelease/monsters/monsters.test.ts:320` checks damage only.
- Evidence: `ShamblerCastLightning` emits `{ kind: "beam", actor: entity.actor.id, start, end: trace.end, width: 2, color: 0xffffffff, visible: true }` using the shambler's own actor. `clearBeam` sends `visible: false` only for `beam.actor.id` of `entity.beam`/`entity.beam2`, so no event ever hides the shambler's bolt. The bolt is replaced only by that shambler's next cast and stays after it dies. As I recall the C, this was a one-frame `TE_LIGHTNING`. Separately, `pain` calls `context.setMove("shambler_move_pain")` with no `clearBeam`, and `shambler_lightning_update` appears only in `shambler_attack_magic`. So a shambler hurt during frames 0-4 keeps an un-updated hand beam, and `shambler_windup` overwrites `entity.beam` with a new entity. The old one has no think and stays until the map ends, and its beam stays drawn. The skill check on line 58 covers only smash and swing frames.
- Impact: in the rerelease, each shambler that fires leaves one white line in the level, including corpses. Each interrupted windup adds a stuck line and one entity.
- Remediation: Send the bolt as a short-lived event or a timed beam, and call `clearBeam` when pain interrupts the windup.

### GAPQ12C-004 — MG1 and MG3 func_bob passes degrees to radian `Math.sin`, which would shake platforms instead of bobbing them
- **Verification (VERIFY-Q): confirmed. Final severity: High.** Settled: the source uses degrees. `sin` is QC, not a builtin: quakec_mg1/math.qc:43-48 and quakec_mg3/math.qc:43-48 build `{0, angle, 0}` and return `v_forward_y` from makevectors (both in progs.src:26). func_bob.qc wraps count at 360. q1/addons/brushes.ts:13 passes degrees to radian `Math.sin`/`Math.cos`, so every func_bob jumps instead of bobbing on the many maps the finding lists. Source review: SRCQ1
- Severity: Medium
- Category: bug
- Location: q1/addons/brushes.ts:11-14,15,17,34
- Confidence: plausible. The port matches the shipped call shape, and the units are inferred. I could not inspect Kex's `sin`. There is no test (`grep func_bob tests` finds none), and it was not watched running.
- Evidence: the port has `entity.count = Math.fround(Math.fround(entity.count + angle) % 360); ... Math.fround(Math.sin(entity.count)) ... Math.fround(Math.cos(entity.count))`, with `angularVelocity.x = 360 / wait`. Disassembled `func_bob_GetPositionForAngle` in MG1 `progs.dat` is `count += an; count = mod(count, 360); dd = sin(count); ddc = cos(count)`. So the QC value is an angle in degrees, wrapped at 360, passed straight to the builtin. With the default `wait` 10 and the solid path's 0.05 s step, the port advances 1.8 radians per step. `sin` then runs 0.97, -0.44, -0.77, 0.79, and the default `dest` of 64 units makes the target jump by about 90 units per step at 20 Hz, applied through `velocity = delta * 20`. A smooth bob of `wait` seconds needs degrees. `Math.sin` here is the only one in q1 content, so nothing else settles the question. `func_bob` appears in mg1 (mgdm3 16, mgdm4 8, mge1m1 2, mge1m2 1, mge1m3 2, mge3m1 7, mge4m1 12, mge4m2 13, mge5m1 8, mge5m2 16) and mg3 (dm1 77, map3 8, map6 7, map8 49, secret1 1, secret2 11, secret4 84, secret6 92).
- Impact: if Kex's `sin` takes degrees, these platforms vibrate at speed. They carry and crush players, and `bob_blocked` deals damage. If Kex's `sin` takes radians, the port is correct and this finding should be dropped. Watching mg3 `secret6` once settles it.
- Remediation: Check against the retail executable or one run. If degrees, convert in `bobPosition` and add a test.

### GAPQ12C-005 — Mid-game malformed map text ends the process where QC objerror ended the map
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Low.** objerror does end in Host_Error (WQ pr_cmds.c:88-93) for hiptrain.qc:74, dragon.qc:840 and others. A listen client returns to console, but a dedicated server exits in the original too (host.c:142). `target_lightramp lost its light` (q1/addons/lights.ts:16) has no matching objerror: mg1 lights.qc:182-186 checks only in target_lightramp_init, and a later kill of the light just reads the freed edict in target_lightramp_tick (:140). Source review: SRCQ1
- Severity: Low
- Category: robustness
- Location: q1/missionpacks/world/hipnotic-train.ts:9,11,26; hipnotic-rotate.ts:49,59,62,150; campaign.ts:52,55; q1/missionpacks/monsters/dragon.ts:153; q1/addons/lights.ts:16,32; q1/addons/triggers.ts:216; q1/addons/ctf/maps.ts:11
- Confidence: traced for the throws. These run from think, touch or use callbacks. Their reaching the run loop relies on APP-001 and GAPQ12B-001; I did not re-read the dispatcher. QC behavior is from memory.
- Evidence: `if (corner === undefined) throw new Error(\`hip_train_next: missing ${entity.target}\`)` and `if (entity.target === "") throw new Error("hip_train_next: no next target")` run when a `func_train2` advances. `if (target === undefined) throw new Error("dragon_corner: no target found")` runs on touch. `lights.ts:16` throws "target_lightramp lost its light" if a map kills the light with a `killtarget`. CONTENT1-018 lists throws QC tolerates. These are the QC `objerror` class instead, which in the original dropped to the console rather than ending the program, and which here fire long after spawn. I did not scan shipped maps for these conditions, and the shipped campaigns presumably avoid them.
- Impact: a third-party map with a train chain that ends without a target closes the client or dedicated server the moment the train reaches its end. No exploit is known, and it needs the host to load that map.
- Remediation: Route these through the map-error path that ends the level, or log and stop the entity.

### GAPQ12C-006 — Rerelease gladiator weapon hum is never stopped when it dies
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** rerelease/g_monster.cpp:398 clears `s.sound` each frame and :405-407 apply weapon_sound only with `health > 0`. gladiator.ts:44-55 sends no stop. Confidence upgrades from plausible to traced. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: q2/rerelease/monsters/gladiator.ts:28,44-55,71; src/app/bootstrap/audio.ts:524-529,609
- Confidence: plausible. The looping behavior is traced. Whether the C silences a dead gladiator's `weapon_sound` is from memory, and I am unsure of it.
- Evidence: `initialize` emits `path: "weapons/rg_hum.wav", ... loop: "start"` (and `weapons/phaloop.wav` for `monster_gladb`). `die` sends no `loop: "stop"`, whereas `guardian.die` calls `spinSound(context, false)` and Makron calls `stopLoop`. Audio stops a loop on `loop: "stop"` or when the actor leaves the snapshot (line 609), and a corpse stays in it.
- Impact: dead gladiators keep humming until gibbed or removed.
- Remediation: Compare with m_gladiator.cpp, then stop the loop in `die` if the source does.

### GAPQ12C-007 — Debug weapon dump reads the projectile model at the wrong offset
- **Verification (VERIFY-I): confirmed. Final severity: Low.** weapons.ts:365 uses offset 88 and the record accessor at :452 uses 80. :491 (the weapon record) is the source of 88, and :1011 runs the dump.
- Severity: Low
- Category: bug
- Location: src/bots/behavior/library/weapons.ts:365,453,1011
- Confidence: traced
- Evidence: `dumpField("model", 88, StructureFieldType.String)` in `projectileDumpDefinition`, against the record's own layout `get model(): string { return cell.text(80); }`. `name` occupies 0-79 and `flags` starts at 160. Offset 88 is correct only for `weaponDumpDefinition`, and it looks copied from there. The dump runs from line 1011 when a debug log file is open.
- Impact: bot debug logs print projectile model names missing their first eight bytes. Gameplay is unaffected.
- Remediation: Use offset 80.

### GAPQ12C-008 — `registerQ2RereleaseOrdinaryMonsters` has no caller
- **Verification (VERIFY-Q): confirmed. Final severity: Info.** No source claim. Source review: SRCQ2
- Severity: Info
- Category: dead-code
- Location: q2/rerelease/monsters/index.ts:53-60
- Confidence: traced (grep of `src`; `tests` and `tools` were not searched)
- Evidence: the only match in `src` for `registerQ2RereleaseOrdinaryMonsters(` is its definition. It also holds the only `monster_chick_heat`/`monster_gladb` exclusion rule.
- Impact: a second registration path that is not exercised.
- Remediation: Remove it if tests do not use it.

## Supplements
- Supplements GAPQ12-007 and GAPQ12B-003: more full entity-table copies on hot paths.
  - q1/missionpacks/presentation.ts:34 runs `[...this.game.entities.values()].find(...)` per Hipnotic player per character frame, and the `missionpack_character_state` entity it creates is never removed, so each reconnect adds one.
  - q1/missionpacks/world/shooters.ts:48 runs per player per touch in a Rogue `trigger_push`.
  - q1/addons/field-triggers.ts:25 runs per actor per touch in `trigger_push` for every non-MG3 addon program.
  - q1/missionpacks/world/rogue-hazards.ts:31 runs per player touch in `trigger_earthquake_kill` while the earthquake entity survives.
- Supplements GAPQ12B-001: monster-owned projectiles keep released owners (dragon fireball, lavaman ball, mummy grenade) but do not reach the rune hook, because they fire only with `deathmatch` 0 or spawn-removed monsters. No new trigger there.
