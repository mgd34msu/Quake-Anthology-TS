# SRC4Q1A — Q1 addon monsters against MG1 and MG3 QuakeC

## Coverage
Paths below are relative to src/content/q1/addons/monsters unless they say otherwise. QC paths are relative to upstream/quake-rerelease-qc.

Read in full, no line truncation: all 41 files under src/content/q1/addons/monsters (3,583 lines by `wc -l`; the assignment estimated about 4,100): ai/ (controller, index, path, targets), bosses/ (effects, final, ghost, oldnew, oldnew-children, oldnew-projectiles, orb, registry, sacrifice, sphere-points, szombie, frames/final, frames/ghost, frames/oldnew, frames/orb, frames/szombie), heavy/ (index, lava-man, projectiles, rune-knight, runtime, super-shambler, tables/mg3_lavaman, tables/mg3_rknight, tables/mg3_super_shambler), infected/ (controller, frames, index, species), ordinary/ (army, attack, index, rocket-ogre), demodog, demodog-frames, index, startup.

QC read in full: quakec_mg3/ai.qc, monsters.qc, monsters/mg3_lavaman.qc (from line 60), mg3_rknight.qc, mg3_super_shambler.qc, mg3_demodog.qc, mg3_orb.qc, mg3_player_ghost.qc, mg3_sacrifice.qc, mg3_shub_zombie.qc, mg3_oldone_new.qc, boss_final.qc, and all five infected files.

QC read in part: quakec_mg3/fight.qc (all but the header), combat.qc (Killed, T_Damage), weapons.qc (grenades, launch_spike, LightningDamage), triggers.qc (tdeath, tfog), subs.qc, math.qc, defs.qc constants, soldier.qc (from line 90), ogre.qc, tarbaby.qc spawn and slime lines, boss.qc spawn and pain, spawn functions of the other ordinary monsters. quakec_mg1/monsters.qc in full, MG1 boss.qc, combat.qc and zombie.qc in part.

Compared by `diff` against quakec/monsters, not line by line: MG3 soldier, dog, knight, hknight, enforcer, demon, shalrath, wizard, zombie, fish, tarbaby, shambler. Each diff was capped at 70 filtered lines, so the tail of the larger ones was not seen. MG1 ai.qc was compared to MG3 ai.qc the same way, also capped at 70 lines.

Not compared:
- Base frame tables and base actions (base/frames.ts, base/monster-actions.ts) for ordinary MG1 and MG3 monsters, frame by frame. They are out of scope; only the differences above were checked.
- ai/path.ts has no QC to compare against. walkpathtogoal is engine code that is not in the release, so I checked only the return codes and call contract.
- bosses/sphere-points.ts was sampled against get_org (about 20 entries, including the out-of-order 0 and 19), not all 100.
- Frame tables were checked by computing frame numbers from the QC `$frame` lists and comparing operations, not by a script.
- MG1 monster files other than boss.qc and zombie.qc were checked by grep only.
- The MG1 Horde paths (src/content/q1/addons/horde) are not in this scope.

Reproductions: scratchpad/src4q1a/a.test.ts and b.test.ts, run from clean. They use a copy of the harness in tests/gameplay/q1-addons/common.test.ts. Its combat policy does not run the addon damage-source effects, so damage-rule findings below are `traced`, not `reproduced`. Entity counts come from src2q1/ents-rr.json (retail rerelease paks).

## Strengths
- Frame tables match the QC `$frame` order and operations for lavaman, rknight, super shambler, orb, ghost (including the source's reuse of CORPSEFRAME_PLAYER_5 on diee9), szombie, oldone, final boss, demodog, army and the hell knight corpse rise.
- MG3 FindTarget, range, infront, ai_run and CheckAttack are ported closely in ai/controller.ts, including the near-sighted ranges, the orb's rear eye and the corpse FoundTarget gate.
- The fragile source details survive: LightningDamage's unnormalized side offset, the `spawn_szombie` indexing quirk, the sphere_chunk manager that fires once, the `phase 3 -> wave2` reuse, and the infected kill-count and double monster_death_use behavior.
- Every controller has checkpoint capture, restore and clone, and releases its state through `actors.onRelease`. No per-map growth was found in this scope.
- Spawning all 45 MG1 and MG3 maps at all four skills found only one fatal gap (001).

## Findings

### SRC4Q1A-001 — `monster_slime` is not implemented, so MG3 boss, map8, map6 and secret2 fail to spawn
- **Verification (VERIFY-T): confirmed. Final severity: High.** `monster_slime` is absent from src and tests; MG3 tarbaby.qc:392-401 defines it; spawns.ts:175 throws and foundation/runtime.ts:82 rethrows without foreignWorld. Six entities and flags match, so the Normal-or-harder failure pattern is consistent with skill inhibit bits.
- Severity: High
- Category: bug
- Location: index.ts:15-21; ordinary/index.ts:110-121; src/content/q1/foundation/spawns.ts:175; src/content/q1/foundation/runtime.ts:82; QC quakec_mg3/monsters/tarbaby.qc:392-401
- Confidence: reproduced at `spawnMap`. I did not trace how the app handles the rejected load. Native MG3 was not seen to set `foreignWorld` in the q1 composition files, but that grep was narrow.
- Evidence: `grep monster_slime` over src and tests has no hits. `spawnMapActor` ends in `default: throw new UnknownQ1SpawnError`, and runtime.ts:82 rethrows it unless `foreignWorld === true`. Six entities exist: boss.bsp 3 (flags 768, 768, 1280), map6 1 (768), map8 1 (256), secret2 1 (66316). b.test.ts output: `mg3 skill 1 maps/boss.bsp THREW Error: Q1 official spawn not yet implemented: monster_slime`. It also fails for map8 at skill 1, 2, 3; boss at 1, 2, 3; map6 and secret2 at 2, 3. No other classname in any MG1 or MG3 map fails.
- Impact: MG3 cannot reach its final boss arena or map8 at Normal or harder. Only skill 0 is clean. Per APP-001 the exception may end the process if the load runs on a run loop.
- Remediation: Port monster_slime and the tarbaby slime paths (`.slime`, SlimeMissileTouch, SlimeStartCheck, split on death). Until then, map admission should not be fatal for one monster class.

### SRC4Q1A-002 — MG1 and MG3 `monster_army` and `monster_dog` skip InitMonster: 186 trigger-spawned monsters are present from map load
- **Verification (VERIFY-T): confirmed. Final severity: High.** ad/monsters/ordinary/index.ts:110-115 loops baseSpecies, which lacks army and dog; spawns.ts:174 keeps foundation spawnMonster, and foundation/monsters.ts has no bit 4 test. MG1 monsters.qc:32,:145,:214 honor it. Counts 35, 17, 108, 26 = 186, and 543 total, match.
- Severity: High
- Category: bug
- Location: ordinary/index.ts:110-115; src/content/q1/base/species.ts:5,27-40; src/content/q1/foundation/spawns.ts:174; src/content/q1/foundation/monsters.ts:184-226; QC quakec_mg3/monsters/soldier.qc:272-300, dog.qc:348-372, monsters.qc:261-305
- Confidence: reproduced
- Evidence: `registerOrdinaryAddonMonsters` loops over `baseSpecies`, which has no army or dog (`BaseSpecies` union at species.ts:5), so these classes keep the foundation `spawnMonster`. It never reads spawnflags 4. Output with `spawnflags: "4"`: `mg3 monster_army model= "progs/soldier.mdl" solid= slidebox next 0.3 use monster_use`, against `mg3 monster_knight model= "" solid= none next -1 use mg3:ordinary:start`. Counts with bit 4: MG1 army 35, dog 17; MG3 army 108, dog 26.
- Impact: Closet and ambush grunts and dogs stand visible and solid from map load, wake early, block paths, and never teleport in. Their triggers do nothing useful. The same bypass loses StartMonster and MG AI for all 543 of these monsters: MONSTER_WAITWALK (2), MONSTER_ATTACK_FRIEND (4), near-sighted (2), contents damage, FindTarget, and army's `skill > 2` flinch roll. Dog height is also wrong: foundation top z is 40, while MONSTER_SIZE_LARGE in both programs (MG1 dog.qc:379) gives 64 (VEC_HULL2_MAX).
- Remediation: Register army and dog through the ordinary controller. `armySpecies`, `armyActions`, `armyAttack` and the dog branch in `mg3OrdinaryAttack` (never reached today, ordinary/attack.ts:12) already exist for this.

### SRC4Q1A-003 — A Shub zombie grenade that hits a wall throws, because SUB_Remove has no touch handler
- **Verification (VERIFY-T): confirmed. Final severity: High.** szombie.ts:116 calls named.touch(entity, "SUB_Remove"); entity-services.ts:112 registers it as action only, and callbacks.ts:54-55 throws. Source is MG3 mg3_shub_zombie.qc:670-673. It is the only such call among the SUB_Remove references.
- Severity: High
- Category: robustness
- Location: bosses/szombie.ts:116; src/content/q1/foundation/entity-services.ts:112; src/content/q1/foundation/callbacks.ts (`touch`); QC quakec_mg3/monsters/mg3_shub_zombie.qc:670-673
- Confidence: reproduced for the throw. The path to process exit relies on APP-001.
- Evidence: `entity.touch = game.named.touch(entity, "SUB_Remove");`. The registry entry is `this.named.register("SUB_Remove", { action: ... })`, and `touch()` does `if (handler === undefined) throw new Error("Q1 callback is not touch: ...")`. Output: `szombie grenade THREW: Error: Q1 callback is not touch: SUB_Remove`. This is the only such call in src.
- Impact: Every Shub zombie grenade that misses and lands on non-damageable geometry raises inside a touch callback. In the monster_oldone_new fight zombies spawn continuously and throw at range, so this happens within seconds. An exception reaching the run loop ends the process.
- Remediation: Add a `touch` handler to the SUB_Remove registration, or a dedicated touch callback that removes the entity. Add a test that lands a grenade on world.

### SRC4Q1A-004 — MG1's killable Chthon is not implemented, so the mgend boss is the 3 HP undamageable id1 boss
- **Verification (VERIFY-T): confirmed. Final severity: High.** ordinary/index.ts:111 skips boss; base/monsters.ts:430-435 sets undamageable with health 1 or 3. MG1 boss.qc:313-323,:467-501 and combat.qc:261-275 are as cited; BOSS_KILLABLE and boss_counter handling are absent; mgend has flag 2 with target boss_counter.
- Severity: High
- Category: bug
- Location: ordinary/index.ts:111; src/content/q1/base/monsters.ts:430-435; QC quakec_mg1/monsters/boss.qc:56,193,210,313-323,467-501; quakec_mg1/combat.qc:261-275
- Confidence: reproduced for the health and damage. The map's outcome is traced from its entity data only.
- Evidence: `if (spec.species === "boss" || spec.species === "oldone") continue;` leaves `monster_boss` on the base class, whose `awake` sets `entity.damageable = false` and health 1 or 3. mgend.bsp has `monster_boss` with `spawnflags 2`, `target boss_counter`. QC sets 4000 HP, DAMAGE_AIM, boss_pain, SUB_Freeze/SUB_Unfreeze on shock frames, and fires targets at first hit and the 1/3 and 2/3 thresholds; combat.qc accepts only lightning-gun damage. No TS code reads BOSS_KILLABLE. Output: `mg1 boss health 3 damageable false`, `after 500 dmg 3`.
- Impact: MG1's final boss cannot be damaged with the lightning gun, `boss_counter` never receives its signals, and the finale scripting does not run as authored. The end of the episode is likely unreachable by the intended route. I did not play the map.
- Remediation: Add an MG1 boss controller for BOSS_KILLABLE, including the T_Damage lightning-only rule. The MG3 boss.qc has the same flag and a different damage rule, though no MG3 map uses it on `monster_boss`.

### SRC4Q1A-005 — Small MG monsters are 8 units too tall: source hull top is 32, TS uses 40
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** MG3 defs.qc:357-358, MG1 defs.qc:355 and monsters.qc:116 use z 32 for MONSTER_SIZE_SMALL; startup.ts:10, ordinary/index.ts:17 and army.ts:10 use 40.
- Severity: Medium
- Category: bug
- Location: startup.ts:10; ordinary/index.ts:17; ordinary/army.ts:10; heavy/rune-knight.ts:60; QC quakec_mg3/defs.qc:357-358, quakec_mg1/defs.qc:355, quakec_mg3/monsters.qc:147, quakec_mg1/monsters.qc StartMonster
- Confidence: traced
- Evidence: StartMonster: `if(self.state == MONSTER_SIZE_SMALL) setsize (self, VEC_HULL_MIN, VEC_HULL_MAX);`, with `VEC_HULL_MAX = '16 16 32'`. TS: `const small = { min: {..., z: -24 }, max: { x: 16, y: 16, z: 40 } };`. The id1 monsters used an explicit 40 at spawn; the MG InitMonster path does not. Boss zombies and ghosts in this scope correctly use 32, and the crucified zombie's explicit 40 is correct.
- Impact: Every small MG1 and MG3 monster (knights, hell knights, enforcers, scrags, zombies, tarbabies, fish, rune knights, infected army and knights) has a box 8 units higher. Shots pass above a QC monster's head but hit in TS, and splash centers shift up 4 units. Per CORE-002, the exact 32x32x56 size selects hull 1, but 32x32x64 takes the slower derived-cell path with different collision.
- Remediation: Use 32 in the MG startup bounds and species overrides.

### SRC4Q1A-006 — Rocket ogres never retaliate: a sleeping one hit by the player goes back to sleep
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** ordinary/index.ts:72-78 rocket branch has no retaliate, and MG3 combat.qc:331-345 reacts in T_Damage. 126 rocket ogres match.
- Severity: Medium
- Category: bug
- Location: ordinary/index.ts:72-78; QC quakec_mg3/combat.qc T_Damage "react to the damage" block, quakec_mg3/monsters/ogre.qc:403-450
- Confidence: reproduced
- Evidence: `if (this.spec.model !== "ogre_rocket") return super.pain(attacker, damage);` is followed by a rocket-only body with no `this.retaliate(attacker)`. Every other pain override calls it. Output: `monster_ogre_rocket enemy after hit: false`, `monster_ogre enemy after hit: true`.
- Impact: 126 rocket ogres in MG3. One shot from outside its sight does not get angry, plays a pain frame, runs with no enemy, and returns to stand. They also never infight when hit by other monsters. They can be killed without response from behind cover.
- Remediation: Call `this.retaliate(attacker)` first in the rocket branch.

### SRC4Q1A-007 — Two `Math.cos` calls take radians where QC `cos` takes degrees: blaster spirals and sacrifice bobbing become noise
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** MG3 math.qc:53-58 takes degrees; sacrifice.ts:19 and oldnew-children.ts:74 pass the same expressions to radian Math.cos. These are the only two Math.cos sites under ad/monsters.
- Severity: Medium
- Category: bug
- Location: bosses/oldnew-children.ts:74; bosses/sacrifice.ts:19; QC quakec_mg3/math.qc (`cos`), monsters/mg3_oldone_new.qc:980,1224, monsters/mg3_sacrifice.qc:96
- Confidence: reproduced for the sacrifice; traced for the blaster, which is the same expression
- Evidence: QC `cos` is `vector a = {0, angle, 0}; makevectors(a); return v_forward_x;`, which takes degrees. TS: `Math.cos(entity.count * 15) * 0.5 * entity.number("aflag")` and `Math.cos(entity.count * 90) * 16`. Output on eight ticks: `TS sacrifice z 85.4,110.6,95.3,98,108.4,86.7,115.8,84.5`, `QC would be 115.8,115.2,114.3,112.9,111.3,109.4,107.3,104.9`.
- Impact: The hanging sacrifice in map8 jitters up to 30 units every tick rather than bobbing with a 4 second period. Armed eyes (blaster, vortex) in the Shub fight fire a scattered spray rather than the authored 4.8 second sweep, which changes how the attack is dodged. Same defect class as GAPQ12C-004, at different sites.
- Remediation: Convert with `* Math.PI / 180` in binary32, or add one shared QC `cos` helper for all addon code.

### SRC4Q1A-008 — Trigger-spawned monsters do not set force_retouch, so telefrag misses anything standing still
- **Verification (VERIFY-T): confirmed-with-changes. Final severity: Low.** startup.ts:38-42 omits forceRetouch, unlike spawns.ts:393 and MG3 triggers.qc:528-543. Change: the stationary-player case is wrong. netquake.ts:404 links with touch every frame, as WQ sv_phys.c does, so tdeath_touch still fires and the monster dies. Only monster-on-idle-monster overlap survives (runtime.ts:5483 is the retouch path).
- Severity: Medium
- Category: bug
- Location: startup.ts:38-42; src/content/q1/foundation/spawns.ts:387-394; QC quakec_mg3/triggers.qc:528-543, quakec_mg3/monsters.qc:176-183
- Confidence: reproduced for the flag; traced for the effect, following foundation/README.md's account of `forceRetouch`
- Evidence: startup.ts builds its own teledeath and never sets `game.forceRetouch`. QC `spawn_tdeath` ends with `force_retouch = 2; // make sure even still objects get hit`, and the shared `spawnTeledeath` already does this. Output: `mg3 forceRetouch after start 0 teledeath 1`. About 1,980 entities carry the flag, MG1 739 and MG3 1,241. That count includes the 186 in 002, which do not reach this path, and a few non-InitMonster classes such as ghosts.
- Impact: A monster spawning on a stationary player should kill itself through tdeath_touch's non-player-owner path, and a monster on a stationary monster should kill that monster. In TS both survive overlapped, so a player can be stuck in a solid monster, and stacked spawns remain.
- Remediation: Call `spawnTeledeath(game, monster.origin, entity.actor.id)` in place of the inline copy.

### SRC4Q1A-009 — MONSTER_SPAWNED_TFOG is silent because it emits only the visual effect
- **Verification (VERIFY-T): confirmed. Final severity: Low.** startup.ts:41 emits only the effect; MG3 triggers.qc:459-471 also schedules play_teleport, as spawns.ts:380-385 does. Bit 16 count is 124 MG1 and 268 MG3 before filtering on bit 4; the difference from the finding's 123 is not material.
- Severity: Low
- Category: bug
- Location: startup.ts:41; src/content/q1/foundation/spawns.ts:380-385; QC quakec_mg3/triggers.qc:459-471
- Confidence: traced
- Evidence: `if ((entity.spawnflags & 16) !== 0) game.effect("teleport", monster.origin);`. QC `spawn_tfog` also spawns an entity whose think is `play_teleport`. Other files in this scope use `spawnTeleportFog`, which has both.
- Impact: Up to 391 monsters (123 MG1, 268 MG3, before excluding any in 002) teleport in with no sound, removing the audio cue for an ambush behind the player.
- Remediation: Call `spawnTeleportFog`.

### SRC4Q1A-010 — Hell knight corpses ignore damage and do not rise
- **Verification (VERIFY-T): confirmed. Final severity: Low.** infected/controller.ts:37 sets pain null for corpses and base/monsters.ts:283-291 retaliates only from pain, while MG3 combat.qc:331-345 reacts regardless. MG3 monsters.qc:68-75 invisibility branch has no port equivalent. 13 infected corpses is consistent with 20 total flagged minus 7 plain hell knights.
- Severity: Low
- Category: bug
- Location: infected/controller.ts:37; src/content/q1/base/monsters.ts:283-291,422-429; QC quakec_mg3/combat.qc T_Damage reaction block, quakec_mg3/monsters.qc:68-75, quakec_mg3/ai.qc:486-493
- Confidence: reproduced for damage; traced for the invisibility branch
- Evidence: `entity.pain = spec.stand.startsWith("hknight_corpse") ? null : ...`. TS runs retaliation inside `pain`, so no callback means no retaliation. QC reacts in T_Damage independently of th_pain: `self.enemy = attacker; FoundTarget ();`, whose HuntTarget sets `think = th_run`, the corpse's rise. Output: `corpse enemy after hit false health 240`. Separately, QC monster_use has `if (activator.items & IT_INVISIBILITY) { if corpse: self.th_run(); return; }`, which BaseMonster.use does not have.
- Impact: 13 corpses in MG3 take splash damage silently where the source rises and attacks. A corpse wave triggered by an invisible player stays down.
- Remediation: Use a corpse pain callback that only retaliates, and add the invisibility branch in Q1Infected.use.

### SRC4Q1A-011 — The lava man's damage rule is missing
- **Verification (VERIFY-T): confirmed. Final severity: Low.** MG3 combat.qc:259-268 scales lava man damage; bosses/final.ts:211-220 tests only the final boss, and the only damage source registrations are oldnew.ts:120 and final.ts:211. 2 lava men on map2b.
- Severity: Low
- Category: bug
- Location: bosses/final.ts:211-220; heavy/lava-man.ts; QC quakec_mg3/combat.qc `if (targ.classname == "monster_lava_man")`
- Confidence: traced. The harness does not run damage-source effects, so its printed `1250 -> 1150` proves nothing here. The evidence is that no rule exists.
- Evidence: QC returns early if the attacker is monster_boss, and applies `take *= 0.8` unless the weapon is lightning or laser. `grep monster_lava_man` finds rules in the boss, orb and rock paths, but `registerDamageSourceEffects("mg3:final", ...)` tests `bosses.has(entity.actor)`, which holds only for `monster_boss_final`.
- Impact: The 2 lava men in MG3 take 25% more than authored from most weapons. The attacker-is-boss exemption matters little on retail data, because the killable form of the boss in boss.bsp uses rocks that are removed on contact with a lava man and radius damage that skips them.
- Remediation: Add a lava man source effect in lava-man.ts mirroring the combat.qc block.

### SRC4Q1A-012 — Final boss and armed eyes skip T_Damage's FoundTarget reaction
- **Verification (VERIFY-T): confirmed. Final severity: Low.** final.ts:67-78 overrides pain without retaliate; armedEye (oldnew-children.ts:28-34) sets no pain, and eye_pain at :24,:56 belongs to the other eye. Sources are MG3 combat.qc:331-345 and mg3_oldone_new.qc:909,:1193.
- Severity: Low
- Category: bug
- Location: bosses/final.ts:67-78; bosses/oldnew-children.ts:28-34; QC quakec_mg3/combat.qc T_Damage reaction block, monsters/mg3_oldone_new.qc:909,1193
- Confidence: reproduced for the boss; traced for the eyes
- Evidence: `Q1FinalBoss.pain` overrides base `pain` and drops `retaliate`. Output: `final hit by knight enemy is player? true`. In QC this retargets, restarts at `th_run = boss_final_missile1` (clearing boss_immune), and sets attack_finished +1 s, which suppresses pain frames. Armed eyes have `flags = FL_MONSTER | FL_FLY` and `th_run = blast`, so in QC a first hit starts firing 0.1 s later, cutting the 2 second warmup. TS gives them no pain callback.
- Impact: In coop or with infighting the boss keeps its target and attack rhythm. In single player, shooting a blaster or vortex no longer makes it fire early.
- Remediation: Call `retaliate` in the boss. Add a retaliate-only pain to armed eyes, with `spec.run` equivalent to `blast`.

### SRC4Q1A-013 — The base `play` guard drops the final boss's upgrade when its target dies during a shock animation
- **Verification (VERIFY-T): confirmed. Final severity: Low.** base/monsters.ts:66-71 redirects when the enemy is ineligible, and final.ts:55-58 delegates to it. MG3 boss_final.qc:228-230,:419-421 reach upgrade unconditionally, while the port runs upgrade only at the shock10 action (final.ts:86).
- Severity: Low
- Category: bug
- Location: src/content/q1/base/monsters.ts:66-71; bosses/final.ts:55-58,86,120-131; QC monsters/boss_final.qc:228-230,410-421
- Confidence: traced
- Evidence: Supplements SRCQ1-005 with a new consequence. Each frame `play` runs `if (health > 0 && enemy !== null && !monsterTargetEligible(...))` and then `this.play(... spec.stand ...)`. QC boss frames have no such exit, so shocka10 and shockb10 always reach `boss_final_upgrade`. Q1Oldnew has the same exposure, moving from walk or thrash to idle when QC would continue.
- Impact: In coop, a player's death during the 1 second shock skips `entity.wait++`. Wave and arena-teleport steps then shift by one, and with two skips the spiral stage is lost.
- Remediation: Bypass the guard for scripted boss controllers, or have the boss override it with `boss_final_face` behavior.

### SRC4Q1A-014 — Ordinary MG3 monsters still drop backpacks, which the source removed
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** Every MG3 monster DropBackpack is commented out (enforcer.qc:353,:370; ogre.qc:456,:473; soldier.qc:224,:237), while MG1's are live. rocket-ogre.ts:11-14 strips only rocket ogres; base actions at monster-actions.ts:114,:128 and foundation/monsters.ts:93 still drop.
- Severity: Medium
- Category: bug
- Location: ordinary/rocket-ogre.ts:11-14; ordinary/index.ts:61-64; src/content/q1/base/monster-actions.ts:114,128; src/content/q1/foundation/monsters.ts:93; QC quakec_mg3/monsters/ogre.qc:455, soldier.qc `army_die3`
- Confidence: traced
- Evidence: MG3 QC has no live DropBackpack call in any monster file: `// AY Oct 25 2025, Ogres no longer drop backpacks`. The MG1 files still have them. TS removes `ogre_die3` and `ogre_bdie3` actions only in `rocketOgreFrames`. Plain ogres and enforcers run `dropBackpack` from base actions, and grunts run `game.dropShells`. SRC3Q1B-011 covers Horde only.
- Impact: Up to 273 ogres, 407 enforcers and 236 grunts in MG3 give ammo the authors removed, which changes the resource balance of the campaign, most visibly on Nightmare and Bloody Nightmare.
- Remediation: Add MG3 frame overrides for those actions on every ordinary class, not only the rocket ogre.

### SRC4Q1A-015 — Bloody Nightmare and MG3 Nightmare changes to ordinary monsters are not ported
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** `Laser_TouchAlt`, `w_spike2`, `shalrath_dot`, `nightmare_attack` are absent from src. BLOODY_NIGHTMARE_ACTIVE in monster code is limited to final, rune-knight and super-shambler. Read hknight.qc:108, enforcer.qc:192, soldier.qc:171, MG1 demon.qc:348 against monster-actions.ts:29-35.
- Severity: Medium
- Category: bug
- Location: ordinary/index.ts:61-97; src/content/q1/base/monster-actions.ts:29-40; QC listed below
- Confidence: traced. Among monster code, `grep -l BLOODY_NIGHTMARE_ACTIVE` over src/content/q1 lists only bosses/final.ts, heavy/rune-knight.ts and heavy/super-shambler.ts; the other hits are campaign, commands, items, travel and triggers. Grep for `Laser_TouchAlt`, `w_spike2`, `shalrath_dot` and `nightmare_attack` finds nothing.
- Evidence, all in quakec_mg3/monsters:
  - hknight.qc:108 spike speed 500.
  - enforcer.qc:192 extra Laser_TouchAlt shot; enforcer.qc:310 and soldier.qc:171 `skill > 2` flinch rolls for non-infected monsters.
  - wizard.qc:232 extra w_spike2 shots.
  - shalrath.qc:174,205,220 trails and delayed homing; shalrath.qc:226 `skill == 3` speed 285.
  - ogre.qc:89,331 double grenade volley and arcs.
  - shambler.qc:138,181,203,213,311 `nightmare_attack_check` forcing lightning after a run of melee, used at `skill > 2`, not only in Bloody Nightmare.
  - hknight.qc `self.infected` muzzle offset.
  - demon.qc and dog.qc `other.takedamage && self.attack_finished < time`, also in MG1 (demon.qc:348, dog.qc:91). TS `monsterJumpTouch` has no such gate, so the leap can hit on repeated touches.
- Impact: Bloody Nightmare, a discoverable MG3 mode the code otherwise supports, is much easier than authored. MG3 Nightmare shamblers do not break melee loops with lightning. Fiends can deal jump damage repeatedly in one leap.
- Remediation: Port these into MG3 frame or action overrides in ordinary/, keyed on `readFlags()` and skill.

### SRC4Q1A-016 — MG1 ordinary monsters run id1 AI, not MG1's: no contents damage, no near-sighted logic, no Horde pathing
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** ordinary/index.ts:32-43 MG1 class extends BaseMonster; checkContentsDamage and the allowPathFind reader (ai/controller.ts:106,:182) exist only in Mg3Monster. MG1 ai.qc:233-242 and progs.src:12 enable contents damage. The Horde pathing consequence remains unverified at the mission layer, as the finding says.
- Severity: Medium
- Category: bug
- Location: ordinary/index.ts:32-43,98-100; ai/controller.ts:15,106-115; QC quakec_mg1/progs.src:12, quakec_mg1/ai.qc:234,784-812
- Confidence: traced
- Evidence: `context.program === "mg3" ? new Q1Mg3OrdinaryMonster(...) : new Q1OrdinaryMonster(...)`, and the MG1 class extends BaseMonster. `checkContentsDamage` exists only in Mg3Monster. MG1 defines MONSTERS_AWARE_OF_CONTENTS and has CheckContentsDamage, the ranges, the vision cone, MONSTER_ATTACK_FRIEND in FindTarget, and `ai_pathtogoal`. TS sets `allowPathFind` and `combat_style` on MG1 monsters at ordinary/index.ts:55-56, and nothing reads them.
- Impact: MG1 monsters are unharmed in slime and lava. Attack-friend scripting (14 ordinary monsters in mge4m2, mge5m1, mge5m2) works only at startup, not after a kill, and Horde monsters do not path when the player is out of sight, unless the Horde mission layer covers this. I did not check that layer.
- Remediation: Share the MG1 and MG3 AI policy in one class, with the differences (SightSound entries, orb, corpses) keyed on program.

### SRC4Q1A-017 — `monster_use` semantics are shared across programs and resolved too early
- **Verification (VERIFY-T): confirmed. Final severity: Low.** MG1 monsters.qc:52-69,:101-106 and MG3 monsters.qc:59-100 are as cited; Q1OrdinaryMonster.use (ordinary/index.ts:38) applies the MG3 substitution to MG1 before flag tests, and startup.ts:74 adds the check to MG1 walking. Both bosses lack a use override.
- Severity: Low
- Category: bug
- Location: startup.ts:66-68,73-76; ordinary/index.ts:38; bosses/oldnew.ts:25 (no `use` override); bosses/final.ts:52; QC quakec_mg1/monsters.qc:52-69,101-106, quakec_mg3/monsters.qc:59-100,127-137
- Confidence: reproduced for MG1; traced for the others
- Evidence:
  - MG1: `if (activator.classname != "player") return;`. TS applies `mg3MonsterActivator` there too. Output: `mg1 monster used by non-player: enemy set true`.
  - MG1 `monster_begin_walking` has no health or enemy check, but the shared callback at startup.ts:74 does.
  - MG3 tests invisibility and notarget on the original activator before substituting. TS substitutes first, so a non-player activator with an invisible first player does nothing where QC wakes the monster.
  - Final boss and Shub set `monster_use` but keep raw BaseMonster.use, which returns for a non-player activator where MG3 finds a player.
- Impact: Chain-triggered monsters wake wrongly in MG1, and in MG3 they fail to wake in the two narrower cases.
- Remediation: Branch by program, check flags on the original activator, and apply the MG3 activator rule to the two bosses.

### SRC4Q1A-018 — Shub zombies and the Shub boss use id1 AI rather than MG3's
- **Verification (VERIFY-T): confirmed. Final severity: Low.** szombie.ts:22 extends BaseMonster, so no contents check (MG3 ai.qc:713,:734,:964). base/monsters.ts:180 walks along angles.y where MG3 ai.qc:699-702 uses ideal_yaw.
- Severity: Low
- Category: bug
- Location: bosses/szombie.ts:22; bosses/oldnew.ts:25; src/content/q1/base/monsters.ts:135-148,180; QC quakec_mg3/ai.qc:699-702,732-744,962-965
- Confidence: traced
- Evidence: `class Q1ShubZombie extends BaseMonster`, while QC uses the common ai_run and ai_stand. Differences: no RETURN_IF_DIED_FROM_CONTENTS_DAMAGE, so these zombies are unharmed in slime and lava. `ai("painforward")` walks along `angles.y`; QC `walkmove (self.ideal_yaw, dist)`. Base FindTarget replaces MG3's.
- Impact: A zombie that enters slime or lava takes no damage, and its stagger direction drifts during pain frames. I did not check whether the retail spawn points are near liquid.
- Remediation: Extend Mg3Monster, as Q1Orb and heavy monsters do.

### SRC4Q1A-019 — The lava man's run frames use LavaManCheckAttack where QC falls through to generic CheckAttack
- **Verification (VERIFY-T): confirmed. Final severity: Low.** MG3 ai.qc:815-834 has no lava man entry and mg3_lavaman.qc:217-225 then runs ai_run, reaching generic CheckAttack. heavy/lava-man.ts:78 with heavy/runtime.ts:48-51 replaces it.
- Severity: Low
- Category: bug
- Location: heavy/lava-man.ts:78; heavy/runtime.ts:48-51; QC quakec_mg3/ai.qc:815-834, quakec_mg3/fight.qc:76-148
- Confidence: traced
- Evidence: `attack: checkAttack` feeds `Q1HeavyMonster.tryAttack`, reached from `ai_run`. QC `CheckAnyAttack` has no monster_lava_man entry, so `lavaman_run` calls LavaManCheckAttack and then ai_run's generic CheckAttack, where range 0 fires `th_melee` regardless of attack_finished.
- Impact: Within 120 units the QC lava man restarts its throw from run frames without waiting on the cooldown. TS waits, so it is less dangerous up close.
- Remediation: Remove the `attack` entry so `tryAttack` reaches `checkAttack`; keep the explicit call in `think`.

### SRC4Q1A-020 — A killed ghost stays damageable and touchable, so its death animation restarts
- **Verification (VERIFY-T): confirmed. Final severity: Low.** MG3 combat.qc Killed clears takedamage and touch before th_die; ghost.ts:33 die only plays the death frames, and ghost.ts:52-56 clears touch only on its own touch path. 0 ghosts have a target.
- Severity: Low
- Category: bug
- Location: bosses/ghost.ts:33,52-56; QC quakec_mg3/combat.qc Killed
- Confidence: reproduced
- Evidence: `override die(_attacker) { return this.play(this.entity.text("ghost.death")); }`. QC Killed sets `self.takedamage = DAMAGE_NO; self.touch = SUB_Null;` first. Output: `ghost after kill damageable true touch mg3:ghost:touch`, and `frame before second hit 72 after 70`.
- Impact: Sustained fire holds a ghost in its first death frames, delays its removal and replays its death sound.
- Remediation: Clear `damageable` and `touch` in `die`. No retail ghost has a target, so monster_death_use is not needed for the shipped maps.

### SRC4Q1A-021 — Smaller Shub attack drifts
- **Verification (VERIFY-T): confirmed. Final severity: Low.** MG3 mg3_oldone_new.qc:757-761,:822,:880 are as cited against oldnew-children.ts:19,:100,:109.
- Severity: Low
- Category: bug
- Location: bosses/oldnew-children.ts:19,100,109; QC quakec_mg3/monsters/mg3_oldone_new.qc:757-761,822,880
- Confidence: traced
- Evidence:
  - Swiper start: QC `sound (self, CHAN_AUTO, "weapons/lstart.wav", ...)` on the boss. TS `game.sound(entity, "weapons/lstart.wav", "weapon")` on the swiper, whose `weapons/lhit.wav` uses the same entity and channel 25 ms later, cutting the start sound off.
  - Spam shot: QC removes only inside `if (other.health)`. TS `return game.remove(entity)` also removes on non-world entities with no health, such as doors and platforms.
- Impact: The swipe loses its opening sound, and spam shots landing on brush entities disappear where the source leaves them in place.
- Remediation: Use channel "auto" on the owner; move the remove inside the health check.

### SRC4Q1A-022 — Smaller final-boss and sacrifice drifts
- **Verification (VERIFY-T): confirmed. Final severity: Low.** final.ts:202 clears bit 1 where MG3 boss_final.qc:337-338 clears FL_ONGROUND; boss_final.qc:459-461 double counts. All sacrifices use MOVETYPE_STEP, so Killed runs monster_death_use then sacrifice_gib; 10 flag-0 sacrifices on map8 have targets. sacrifice.ts:9-14 fires once.
- Severity: Low
- Category: bug
- Location: bosses/final.ts:79-82,108,202; bosses/sacrifice.ts:9-14; QC monsters/boss_final.qc:337-338,459-464; quakec_mg3/combat.qc Killed; monsters/mg3_sacrifice.qc:34
- Confidence: traced
- Evidence:
  - `entity.movementFlags &= ~1` clears FL_FLY, not FL_ONGROUND (512), in bossTeleport. The body's `ground: null` covers most of it, so the flag can stay set.
  - QC counts the final boss twice (Killed, then `killed_monsters + 1` in death10) with a total of 1. TS counts once. The TS result looks more correct but differs on the end screen.
  - A killed non-crucified sacrifice fires its target twice in QC (monster_death_use, then SUB_UseTargets in th_die), with the attacker as activator. TS fires once with a stale `entity.activator`. Map8 has 10 sacrifices with targets.
- Impact: Small. The sacrifice count matters only if a target is a counter. I did not check those targets.
- Remediation: Use FL_ONGROUND. Decide per item whether to keep the source's double count, and pass the attacker as activator in the sacrifice die callback.

### SRC4Q1A-023 — Dead ported code in the boss files
- **Verification (VERIFY-T): confirmed. Final severity: Info.** Searched each name under ad/monsters: launchOrbMissile, spawnHomingFlame, meleeCheck and missileSpawner have no callers beyond a registration that nothing names; spawn_sphere and Rock_Death reference only their own registration; rknight_melee and supsham_missile have no frame reference. ## SRC4Q1B
- Severity: Info
- Category: dead-code
- Location: bosses/orb.ts:116-122; bosses/szombie.ts:101-108,118-123; bosses/final.ts:142-155,244-247; bosses/oldnew-projectiles.ts:68-82; ordinary/attack.ts:12 (the dog branch); heavy/rune-knight.ts:43-49; heavy/super-shambler.ts:92
- Confidence: traced
- Evidence: `launchOrbMissile`, `spawnHomingFlame`, `homing_flame_think`, `meleeCheck`, `missileSpawner`, `Rock_Death`, `spawn_sphere`, `rknight_melee` and `supsham_missile` have no live caller. Most are faithful to dead QC; `th_die = Rock_Death` and the `spawn_homing_flame` call are commented out at source. The dog branch is dead only because of 002.
- Impact: About 60 dense lines to maintain with no behavior. `missileSpawner` has a zero velocity that would look like a bug if anything used it.
- Remediation: Delete them, or keep a one-line note of what the source left unused.

## Supplements
- Supplements CORE-002: MG monsters are the case where source sizes do match hull 1 exactly (see 005), so the TS 40-unit top forces the slow path on maps where QC has none.
