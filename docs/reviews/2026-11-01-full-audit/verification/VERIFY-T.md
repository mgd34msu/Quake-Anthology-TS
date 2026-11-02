# VERIFY-T — SRC2Q1, SRC3Q1A, SRC3Q1B, SRC4Q1A, SRC4Q1B

Paths: `q1/` = src/content/q1/; `mp/` = q1/missionpacks/; `ad/` = q1/addons/; `RR`, `HIP`, `ROG`, `MG1`, `MG3`, `CTF` = upstream/quake-rerelease-qc/{quakec,quakec_hipnotic,quakec_rogue,quakec_mg1,quakec_mg3,quakec_ctf}; `WQ` = upstream/Quake/WinQuake. Port read at <scratchpad>/clean, HEAD fcdc8af5 (project HEAD confirmed; `clean` itself is not a git checkout).

Method: cited port and QC lines opened and map counts recomputed from src2q1/ents-*.json. Nothing from upstream/ was executed. One component run: <scratchpad>/verifyT/due.ts (thinkCallbackTime with a zero due time). Reachability check that applies to all MG, Rogue, Hipnotic and CTF findings: built-in products run the native TypeScript program unless `--progs` is given or a custom mod ships progs.dat (src/app/bootstrap/content.ts:168-173).

Limits: the reproductions the finding authors reported (door.test.ts, builtins.test.ts, src4q1a a/b tests) were not rerun; their code paths were read instead. Not independently recomputed: spike mine counts in SRC3Q1A-006, destination counts in SRC3Q1A-011, HIP rotfish.qc:223, and the individual QC line cites inside the long lists of SRC4Q1A-015 beyond those named below. Evidence in the multi-part Low findings was checked item by item only where the block says so.

## SRC2Q1

### SRC2Q1-001
Verdict: confirmed
Corrected severity: High
Reason: q1/foundation/movers.ts:42,:89 always derive movedir from angles; MG1 doors.qc:528-533 and buttons.qc:252-257 use the map vector. Counts match (MG1 154+8, MG3 447+85); mge1m1 `*19` has `movedir 0 0 256`. No func_door or func_button replacement reads the key (ad/context.ts:121 is triggers only).

### SRC2Q1-002
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: ROG knight.qc:279-306,:355-376 are as cited and `statue`, `knight_pause` occur nowhere in src. Change: 3 of the 35 flagged entities have no targetname, and the source returns early for those, so 32 are the triggered set. One map with no crash or progress block, so Medium rather than High.

### SRC2Q1-003
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: ROG zombie.qc:74-77,:650-693 are as cited; counts 40, 94, 9 match. Change: the claim that the port tests only bit 1 is too narrow. monsters.ts:378 tests bit 1 for crucifixion, but ambush uses `spawnflags & 3` (monsters.ts:137), which is why bit 2 zombies are deaf. The impact stands.

### SRC2Q1-004
Verdict: confirmed
Corrected severity: Medium
Reason: ROG ogre.qc:140-150,:490-508 are as cited; 27 of 238 flagged. Under mp/, ogre classnames occur only in monsters/paths.ts:44, obituaries.ts:34, gremlin.ts:69 and hipnotic-spawn.ts:41, so no Rogue ogre definition exists.

### SRC2Q1-005
Verdict: confirmed
Corrected severity: Medium
Reason: ROG tarbaby.qc:255-285,:316-345 give skins, health tiers and mitosis; q1/base/species.ts:36 is one fixed definition, and `mitosis`, `mytosis` are absent from src. 33 Spawn confirmed.

### SRC2Q1-006
Verdict: confirmed
Corrected severity: Medium
Reason: MG1 doors.qc:97-100, MG3 doors.qc:58,:71,:519 are as cited; `speed2` is absent from src and door_blocked always reverses (movers.ts:189-192). Counts: speed2 92, crusher 38 (25 with wait >= 0, the only ones where reversal differs), nonsolid 16 on secret2.

### SRC2Q1-007
Verdict: confirmed
Corrected severity: Medium
Reason: MG1 buttons.qc:229-232,:87-145 have the key gate; movers.ts:84-95 and the `button_touch` callback fire for any player. Counts MG1 12, MG3 8. No add-on replaces func_button (horde wraps only func_door, ad/horde/index.ts:68).

### SRC2Q1-008
Verdict: confirmed
Corrected severity: Low
Reason: MG1 subs.qc:447-457 and doors.qc:445 resolve per-entity worldtype; movers.ts:38,:136-140 and pickups.ts:78-79 use only game.worldType. Counts 37 doors, 7 keys match.

### SRC2Q1-009
Verdict: confirmed
Corrected severity: Medium
Reason: RR items.qc:198 prints; q1/foundation/pickups.ts:392-416 emits sound and effect only, and the file has no game.message call. `kind: "pickup"` events are Q2-only, and effects.ts:426 is the flash. `$qc_got_quad` is used only by mp/world/rogue-tag.ts.

### SRC2Q1-010
Verdict: confirmed
Corrected severity: Medium
Reason: RR client.qc:1245-1258, weapons.qc:1351-1358, combat.qc:205-212 are as cited. In q1/ the base powerup sounds appear only in precache lists (pickups.ts:330-342, precache-world.ts:41), apart from gremlin.ts:55. Expiry is a silent delete at entity-services.ts:520-523.

### SRC2Q1-011
Verdict: confirmed
Corrected severity: Medium
Reason: RR client.qc:1147-1148 is as cited. netquake.ts waterMove (:205-225) applies engine friction only; a search of src/movement/q1, q1/ and composition finds no equivalent term (mp/player.ts:99 is a wetsuit boost). `0.8` in netquake.ts:331 is ideal pitch.

### SRC2Q1-012
Verdict: confirmed
Corrected severity: Low
Reason: RR client.qc:1108-1145 resets dmgtime after first-contact damage; entity-services.ts:541-547 never resets hazardAt. q1/base/player.ts:264 `environment` has the reset but has no caller.

### SRC2Q1-013
Verdict: confirmed
Corrected severity: Medium
Reason: RR misc.qc:272-273 vs q1/foundation/spawns.ts:79. Grounding requires SOLID_BSP (WQ sv_phys.c:284), and port isBsp resolves through isBrush (simulation/players.ts:400) while actor-execution.ts:68 maps bbox to box. canDamage (entity-services.ts:450-453) takes the non-push branch where RR combat.qc:39-41 uses the center.

### SRC2Q1-014
Verdict: confirmed
Corrected severity: Low
Reason: RR subs.qc:255-261 plays talk.wav; entity-services.ts:401 only sends the message, and no talk.wav reference exists on this path.

### SRC2Q1-015
Verdict: confirmed
Corrected severity: Low
Reason: V101 client.qc:1351-1384 tests watertype before FL_MONSTER; q1/base/rules.ts:135-142 runs the classic monster and trap branch ahead of the water lines.

### SRC2Q1-016
Verdict: confirmed
Corrected severity: Low
Reason: MG3 client.qc:1955-2001 and MG1 client.qc:1961 before :2026 are monsters-first; CTF client.qc:1500-1502,:1679-1681 carry the keys. Those keys are absent from src, and only packs override the obituary (composition/q1/runtime.ts:193).

### SRC2Q1-017
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: All four omissions hold (ROG client.qc:505-511,:1370-1377; lava_wpn.qc:84; combat.qc:113-117). Change: the suicide cap is not team-play only. ClientKill's test is unconditional and client.qc:1659 resets the count at connect, while rogue-teams.ts:64-65 covers only the color-change path.

### SRC2Q1-018
Verdict: confirmed
Corrected severity: Low
Reason: HIP monsters/zombie.qc:74,:489,:560-563 and rotfish.qc:158-170 are as cited; `zombie_lay` is absent from src and fish has gibHealth -Infinity (species.ts:37). 8 lying zombies on hip2m4.

### SRC2Q1-019
Verdict: confirmed
Corrected severity: Low
Reason: RR client.qc:562-570 falls to info_player_start at list end; rules.ts:47-51 wraps through `entities.find(coopPoint)` first.

### SRC2Q1-020
Verdict: confirmed
Corrected severity: Low
Reason: RR client.qc:1203-1204 includes coop; composition/q1/runtime.ts:148 gates on deathmatch only.

### SRC2Q1-021
Verdict: confirmed
Corrected severity: Low
Reason: RR player.qc:177-195 runs four frames per swing; q1/base/player.ts:187-190 uses count 6 and animates as an attack. Pain gate is RR player.qc:389.

### SRC2Q1-022
Verdict: confirmed
Corrected severity: Low
Reason: RR misc.qc:454-455,:474 remove the parent at split and only time-limit otherwise; map-entities.ts:84-85 keeps the parent and adds a contents cull.

### SRC2Q1-023
Verdict: confirmed
Corrected severity: Low
Reason: Checked each item: RR doors.qc:132-133,:281-284; buttons.qc:70,:79,:164-165; triggers.qc:90-95,:639-640; client.qc:314,:642-656 against movers.ts:90,:139,:145, spawns.ts:370-373, entity-services.ts:600, rules.ts:54. All hold. The PUSH_ONCE wording should read dead non-grenade touchers.

## SRC3Q1A

### SRC3Q1A-001
Verdict: confirmed
Corrected severity: Medium
Reason: HIP weapons.qc:1007 gates on wetsuit, used by weapons.qc:1088, shambler.qc:240, hipgrem.qc:1347. Port checks exist only in hipnotic-weapons.ts:141 and hipnotic-hazards.ts:34; foundation/weapons.ts:144 and gremlin-weapons.ts:84 have none, and `"electric"` has no reader.

### SRC3Q1A-002
Verdict: confirmed
Corrected severity: Low
Reason: The misplaced else is exact at mp/world/rogue-time.ts:42-43 against ROG timemach.qc:112-133. Effect is purely visual, in one ending sequence, so Low rather than Medium.

### SRC3Q1A-003
Verdict: confirmed
Corrected severity: Medium
Reason: ROG items.qc:513,:525-573 grant bonus ammo on leave. mp/pickup-rules.ts:13-34 has no weaponAmmoGrant, and the only implementation is ad/ctf/arsenal.ts:78.

### SRC3Q1A-004
Verdict: confirmed
Corrected severity: Low
Reason: Sites hipnotic-weapons.ts:90, rogue-weapons.ts:77,:110, player.ts:46, lavaman.ts:63 end effect then remove, while each original ends in BecomeExplosion. effects.ts:474 draws no sprite; lavaman.ts:63 doubles the effect. Cosmetic only, so Low.

### SRC3Q1A-005
Verdict: confirmed
Corrected severity: Low
Reason: ROG mult_wpn.qc:39-44,:487-492 write TE_EXPLOSION2 with 230,5 and 244,3; rogue-weapons.ts:77,:193 use the plain explosion effect.

### SRC3Q1A-006
Verdict: confirmed
Corrected severity: Low
Reason: Every cited original tests FL_MONSTER; the five port sites test a monster controller. trap_spike_mine (hipnotic-hazards.ts:112) and item_time_machine (rogue-time.ts:48) set flag 32 with no controller.

### SRC3Q1A-007
Verdict: confirmed
Corrected severity: Low
Reason: HIP hipitems.qc:387,:571,:698,:791,:821 assign deathtype; the strings are absent from src. Composition isMonster is flag based (composition/q1/runtime.ts:126), so a mine reaches obituaries.ts:77-80 with an empty key, as claimed.

### SRC3Q1A-008
Verdict: confirmed
Corrected severity: Low
Reason: HIP combat.qc:235-242 plays `hipitems/empathy2.wav`; `empathy2` occurs in src only as the obituary key.

### SRC3Q1A-009
Verdict: confirmed
Corrected severity: Low
Reason: HIP weapons.qc:812-820 calls placebullethole; `s_bullet` and `bullethole` are absent from src.

### SRC3Q1A-010
Verdict: refuted
Corrected severity: Info
Reason: hipnotic-hazards.ts:114 yields due = fround(t + (0 - t)) = 0, and scheduler.ts:52 returns not-due for `due.value <= 0`, matching WQ sv_phys.c:130. Scheduling replaces the pending think (scheduler.ts:105), so the trap stops as in the source. Ran thinkCallbackTime with due 0: null for q1-netquake and q1-quakeworld.

### SRC3Q1A-011
Verdict: confirmed
Corrected severity: Low
Reason: ROG s_wrath.qc:83 and items.qc:88 leave think set permanently in QC; entity-services.ts:313 clears it before each callback, so overlord.ts:16 sees only pending thinks.

### SRC3Q1A-012
Verdict: confirmed
Corrected severity: Low
Reason: HIP player.qc:299,:306 fire from frame functions; hipnotic-weapons.ts:128-133,:147-149 schedule a separate entity and test only for null player or body.

### SRC3Q1A-013
Verdict: confirmed
Corrected severity: Low
Reason: HIP hipgrem.qc:738,:1787 run in a think where `other` is world, so T_Heal (items.qc:100-115) refuses; gremlin.ts:72 heals against entity.maxHealth.

### SRC3Q1A-014
Verdict: confirmed
Corrected severity: Low
Reason: Checked each item: ROG weapons.qc:154-156, s_wrath.qc:326, morph.qc:151, dmatch.qc:159-164, sphere.qc:48-57; HIP client.qc:1336-1350, hiptrig.qc:44. All differ as stated at overlord.ts:68, morph.ts:31, rogue-tag.ts:35, player.ts:89,:96,:162, hipnotic-triggers.ts:44, hipnotic-weapons.ts:198.

## SRC3Q1B

### SRC3Q1B-001
Verdict: confirmed
Corrected severity: High
Reason: MG3 items.qc:66-75,:101-106,:121,:135-138 and defs.qc:707 are as cited. spawnPickup and placeItem (pickups.ts:315,:420-426) have no gates; startMg3Item (ad/items/common.ts:9-15) covers MG3-authored classes only. Recount matches: 43 spawned, 40 rune-gated, 73+2 no-drop, 2 coop-only; hub supershotgun flags 3932160.

### SRC3Q1B-002
Verdict: confirmed
Corrected severity: High
Reason: MG3 triggers.qc:552,:652-656 and MG1 triggers.qc:530 are as cited; spawns.ts:205 has no flag test, and base-triggers.ts:40-43 delegates to it. Map entities match exactly: mge5m2 voidtele (7), boss tele_a (6), tele_b and tele_c (14), tele_b2 and tele_c2 (15).

### SRC3Q1B-003
Verdict: confirmed
Corrected severity: Medium
Reason: RR defs.qc:683-684,:749 declare varargs ex_ prints; presentation-host.ts:127-131,:157 join them through machine.ts:183-187, and q1-localization.ts:44 returns the raw value. Reach is `--progs` or custom mods only (content.ts:168-173), which the finding states.

### SRC3Q1B-004
Verdict: confirmed
Corrected severity: Medium
Reason: WQ pr_cmds.c:299-303,:330-334 warn and return; presentation-host.ts:164 calls vm.fail for a non-client, while the QW branch prints. No shipped call was shown to hit this, which limits it to mods.

### SRC3Q1B-005
Verdict: confirmed
Corrected severity: Low
Reason: WQ pr_cmds.c:1036-1049 with progs.h:112 means "" matches; builtins.ts:152 skips offset 0 and entity-services.ts:388 returns []. RR ai.qc:145-152 consequence holds; counts MG3 29, MG1 8, Hipnotic 3, Rogue 2 match. It affects only unalerted monsters reaching a route end, and the rerelease engine cannot be checked, so Low.

### SRC3Q1B-006
Verdict: confirmed
Corrected severity: Low
Reason: The four names occur only in builtins.ts:10-12,:36-38; machine.ts:189 missingBuiltins has no caller, and machine.ts:198-200 fails with `unbound builtin`. WQ pr_cmds.c:81-94 prints the diagnostic the port loses.

### SRC3Q1B-007
Verdict: confirmed
Corrected severity: Low
Reason: WQ sv_main.c:1146 and pr_cmds.c:245-250 accept ""; mod-provider.ts:269-274 returns null for it and spatial-host.ts:42-43 fails, while quakec-source.ts:276 special-cases it.

### SRC3Q1B-008
Verdict: confirmed
Corrected severity: Medium
Reason: MG3 triggers.qc:603-606, client.qc:417,:850-852 push fog; `fog_info` occurs only in ad/effects.ts:155. Counts 16 teleport destinations and 67 spawn points (45+22) match.

### SRC3Q1B-009
Verdict: confirmed
Corrected severity: Medium
Reason: MG1 items.qc:1148-1151,:1164-1167 use 5 seconds in Horde; ad/horde/loot.ts:128 spawns the base item, whose take calls givePowerup with default 30 (pickups.ts:91, entity-services.ts:668). q1/base and q1/foundation contain no horde handling.

### SRC3Q1B-010
Verdict: confirmed
Corrected severity: Medium
Reason: MG1 client.qc:622-626 runs PlayerDie; composition/q1/runtime.ts:273-276 notices then calls requestRespawn, and ad/horde/index.ts:239-243 returns true with no effect while anyone lives, or restarts when solo.

### SRC3Q1B-011
Verdict: confirmed
Corrected severity: Low
Reason: MG1 items.qc:1362-1364 returns in Horde; composition/q1/runtime.ts:246-250 gates on single player only, and base/monster-actions.ts:114,:128 call dropBackpack directly.

### SRC3Q1B-012
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Reaggro half refuted: MG1 combat.qc:308 is `aggro_time + AGGRO_MIN + (random()*AGGRO_ADD < time)`, nonzero whenever aggro_time is set, so the ignore branch is unreachable and monsters retarget on every hit in the source too. Spawn half stands: MG1 client.qc:699-723 has no port equivalent (composition/q1/runtime.ts:231-235).

### SRC3Q1B-013
Verdict: confirmed
Corrected severity: Low
Reason: MG3 subs.qc:329,:341-348, triggers.qc:285,:308 are as cited; entity-services.ts:395-401 and ad/triggers.ts:20-21 ignore the bit. 3 counters on map6 and 10 monsters match.

### SRC3Q1B-014
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Upgraded from plausible after reading the path: MG3 weapons.qc:623-630,:682 deal direct self.dmg, while foundation/weapons.ts grenade touch only explodes with no direct hit. Change: monster_boss occurs on no MG3 map, so the practical target is the single monster_oldone_new.

### SRC3Q1B-015
Verdict: confirmed
Corrected severity: Low
Reason: MG3 items.qc:169,:244 use cap 500 against pickups.ts:33-34's 250. MG3 items.qc:38-39 run draught_fx on regen; ad/items/common.ts:41 calls plain SUB_regen and ad/items/pickups.ts ring spawn skips the effect for flag 4. 2 flagged rings.

### SRC3Q1B-016
Verdict: confirmed
Corrected severity: Info
Reason: spatial-host.ts:91 comment contradicts WQ pr_cmds.c:142-144.

## SRC4Q1A

### SRC4Q1A-001
Verdict: confirmed
Corrected severity: High
Reason: `monster_slime` is absent from src and tests; MG3 tarbaby.qc:392-401 defines it; spawns.ts:175 throws and foundation/runtime.ts:82 rethrows without foreignWorld. Six entities and flags match, so the Normal-or-harder failure pattern is consistent with skill inhibit bits.

### SRC4Q1A-002
Verdict: confirmed
Corrected severity: High
Reason: ad/monsters/ordinary/index.ts:110-115 loops baseSpecies, which lacks army and dog; spawns.ts:174 keeps foundation spawnMonster, and foundation/monsters.ts has no bit 4 test. MG1 monsters.qc:32,:145,:214 honor it. Counts 35, 17, 108, 26 = 186, and 543 total, match.

### SRC4Q1A-003
Verdict: confirmed
Corrected severity: High
Reason: szombie.ts:116 calls named.touch(entity, "SUB_Remove"); entity-services.ts:112 registers it as action only, and callbacks.ts:54-55 throws. Source is MG3 mg3_shub_zombie.qc:670-673. It is the only such call among the SUB_Remove references.

### SRC4Q1A-004
Verdict: confirmed
Corrected severity: High
Reason: ordinary/index.ts:111 skips boss; base/monsters.ts:430-435 sets undamageable with health 1 or 3. MG1 boss.qc:313-323,:467-501 and combat.qc:261-275 are as cited; BOSS_KILLABLE and boss_counter handling are absent; mgend has flag 2 with target boss_counter.

### SRC4Q1A-005
Verdict: confirmed
Corrected severity: Medium
Reason: MG3 defs.qc:357-358, MG1 defs.qc:355 and monsters.qc:116 use z 32 for MONSTER_SIZE_SMALL; startup.ts:10, ordinary/index.ts:17 and army.ts:10 use 40.

### SRC4Q1A-006
Verdict: confirmed
Corrected severity: Medium
Reason: ordinary/index.ts:72-78 rocket branch has no retaliate, and MG3 combat.qc:331-345 reacts in T_Damage. 126 rocket ogres match.

### SRC4Q1A-007
Verdict: confirmed
Corrected severity: Medium
Reason: MG3 math.qc:53-58 takes degrees; sacrifice.ts:19 and oldnew-children.ts:74 pass the same expressions to radian Math.cos. These are the only two Math.cos sites under ad/monsters.

### SRC4Q1A-008
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: startup.ts:38-42 omits forceRetouch, unlike spawns.ts:393 and MG3 triggers.qc:528-543. Change: the stationary-player case is wrong. netquake.ts:404 links with touch every frame, as WQ sv_phys.c does, so tdeath_touch still fires and the monster dies. Only monster-on-idle-monster overlap survives (runtime.ts:5483 is the retouch path).

### SRC4Q1A-009
Verdict: confirmed
Corrected severity: Low
Reason: startup.ts:41 emits only the effect; MG3 triggers.qc:459-471 also schedules play_teleport, as spawns.ts:380-385 does. Bit 16 count is 124 MG1 and 268 MG3 before filtering on bit 4; the difference from the finding's 123 is not material.

### SRC4Q1A-010
Verdict: confirmed
Corrected severity: Low
Reason: infected/controller.ts:37 sets pain null for corpses and base/monsters.ts:283-291 retaliates only from pain, while MG3 combat.qc:331-345 reacts regardless. MG3 monsters.qc:68-75 invisibility branch has no port equivalent. 13 infected corpses is consistent with 20 total flagged minus 7 plain hell knights.

### SRC4Q1A-011
Verdict: confirmed
Corrected severity: Low
Reason: MG3 combat.qc:259-268 scales lava man damage; bosses/final.ts:211-220 tests only the final boss, and the only damage source registrations are oldnew.ts:120 and final.ts:211. 2 lava men on map2b.

### SRC4Q1A-012
Verdict: confirmed
Corrected severity: Low
Reason: final.ts:67-78 overrides pain without retaliate; armedEye (oldnew-children.ts:28-34) sets no pain, and eye_pain at :24,:56 belongs to the other eye. Sources are MG3 combat.qc:331-345 and mg3_oldone_new.qc:909,:1193.

### SRC4Q1A-013
Verdict: confirmed
Corrected severity: Low
Reason: base/monsters.ts:66-71 redirects when the enemy is ineligible, and final.ts:55-58 delegates to it. MG3 boss_final.qc:228-230,:419-421 reach upgrade unconditionally, while the port runs upgrade only at the shock10 action (final.ts:86).

### SRC4Q1A-014
Verdict: confirmed
Corrected severity: Medium
Reason: Every MG3 monster DropBackpack is commented out (enforcer.qc:353,:370; ogre.qc:456,:473; soldier.qc:224,:237), while MG1's are live. rocket-ogre.ts:11-14 strips only rocket ogres; base actions at monster-actions.ts:114,:128 and foundation/monsters.ts:93 still drop.

### SRC4Q1A-015
Verdict: confirmed
Corrected severity: Medium
Reason: `Laser_TouchAlt`, `w_spike2`, `shalrath_dot`, `nightmare_attack` are absent from src. BLOODY_NIGHTMARE_ACTIVE in monster code is limited to final, rune-knight and super-shambler. Read hknight.qc:108, enforcer.qc:192, soldier.qc:171, MG1 demon.qc:348 against monster-actions.ts:29-35.

### SRC4Q1A-016
Verdict: confirmed
Corrected severity: Medium
Reason: ordinary/index.ts:32-43 MG1 class extends BaseMonster; checkContentsDamage and the allowPathFind reader (ai/controller.ts:106,:182) exist only in Mg3Monster. MG1 ai.qc:233-242 and progs.src:12 enable contents damage. The Horde pathing consequence remains unverified at the mission layer, as the finding says.

### SRC4Q1A-017
Verdict: confirmed
Corrected severity: Low
Reason: MG1 monsters.qc:52-69,:101-106 and MG3 monsters.qc:59-100 are as cited; Q1OrdinaryMonster.use (ordinary/index.ts:38) applies the MG3 substitution to MG1 before flag tests, and startup.ts:74 adds the check to MG1 walking. Both bosses lack a use override.

### SRC4Q1A-018
Verdict: confirmed
Corrected severity: Low
Reason: szombie.ts:22 extends BaseMonster, so no contents check (MG3 ai.qc:713,:734,:964). base/monsters.ts:180 walks along angles.y where MG3 ai.qc:699-702 uses ideal_yaw.

### SRC4Q1A-019
Verdict: confirmed
Corrected severity: Low
Reason: MG3 ai.qc:815-834 has no lava man entry and mg3_lavaman.qc:217-225 then runs ai_run, reaching generic CheckAttack. heavy/lava-man.ts:78 with heavy/runtime.ts:48-51 replaces it.

### SRC4Q1A-020
Verdict: confirmed
Corrected severity: Low
Reason: MG3 combat.qc Killed clears takedamage and touch before th_die; ghost.ts:33 die only plays the death frames, and ghost.ts:52-56 clears touch only on its own touch path. 0 ghosts have a target.

### SRC4Q1A-021
Verdict: confirmed
Corrected severity: Low
Reason: MG3 mg3_oldone_new.qc:757-761,:822,:880 are as cited against oldnew-children.ts:19,:100,:109.

### SRC4Q1A-022
Verdict: confirmed
Corrected severity: Low
Reason: final.ts:202 clears bit 1 where MG3 boss_final.qc:337-338 clears FL_ONGROUND; boss_final.qc:459-461 double counts. All sacrifices use MOVETYPE_STEP, so Killed runs monster_death_use then sacrifice_gib; 10 flag-0 sacrifices on map8 have targets. sacrifice.ts:9-14 fires once.

### SRC4Q1A-023
Verdict: confirmed
Corrected severity: Info
Reason: Searched each name under ad/monsters: launchOrbMissile, spawnHomingFlame, meleeCheck and missileSpawner have no callers beyond a registration that nothing names; spawn_sphere and Rock_Death reference only their own registration; rknight_melee and supsham_missile have no frame reference.

## SRC4Q1B

### SRC4Q1B-001
Verdict: confirmed
Corrected severity: High
Reason: MG3 client.qc:681,:948-952,:1038-1075,:1100-1101 are as cited; spawns.ts:253-258 activates every point and removes the trigger, and rules.ts:47-51 allows all points before any fire. Recount: 45 triggers on 12 maps, no models, 176 of 228 gated, mge2m2 7 and 28.

### SRC4Q1B-002
Verdict: confirmed
Corrected severity: Medium
Reason: MG3 items.qc:232-236,:285-306 are as cited; pickups.ts:409-414 consumes coop items once and ignores wait. MG1 1,219 and MG3 2,752 match (MG3 includes 413 shards). Coop matches vanilla id1 behavior and blocks nothing, so Medium rather than High; `wait` applies in all modes.

### SRC4Q1B-003
Verdict: confirmed
Corrected severity: Medium
Reason: MG3 items.qc:91-98,:127-133 hide and bind; ad/campaign.ts:156-167 stores the flag, sets trigger and model, binds no use. map8 sigil flags 136, targetname rune.

### SRC4Q1B-004
Verdict: confirmed
Corrected severity: Medium
Reason: CTF teamplay.qc:755-758,:846-847 reselect; ad/ctf/drops.ts:41-47 ignores the consume result. runtime.ts:1293 weaponChanged only recopies, and activeWeapon derives from state.weapon (runtime.ts:4643). fireWeapon sends base weapons to fireBaseWeapon (weapons.ts:149-161), which has no ownership test, unlike fireRegisteredWeapon.

### SRC4Q1B-005
Verdict: confirmed
Corrected severity: Medium
Reason: CTF items.qc:1356-1358 and teamplay.qc:683-684 are as cited; drops.ts:50-55 touch has no owner or time test and no message, while the weapon touch at :58 has its test. Bounds overlap the thrower (drops.ts:24-30).

### SRC4Q1B-006
Verdict: confirmed
Corrected severity: Medium
Reason: CTF client.qc:1453-1460 credits the owner and returns; spawns.ts:351 makes the teledeath entity the attacker, runtime.ts:195 bypasses obituary.score, and scoring.ts:33 penalizes the victim.

### SRC4Q1B-007
Verdict: confirmed
Corrected severity: Medium
Reason: MG3 items.qc:997-1005 give 20 and 10; pickups.ts:64 gives 12 and 6 with no MG3 rule; MG1 keeps 12 and 6. Counts 152, 95 big match.

### SRC4Q1B-008
Verdict: confirmed
Corrected severity: Medium
Reason: MG3 items.qc:660-665 fires targets before the leave test; pickups.ts:404 skips weapons on leave, while ad/items/pickups.ts:48-50 follows the source for its own items. 15 weapons with targets match.

### SRC4Q1B-009
Verdict: confirmed
Corrected severity: Low
Reason: CTF client.qc:1440-1449 clears the enemies' timers; lastHurtCarrier has writes at flags.ts:43, index.ts:32, runes.ts:80 and the read at scoring.ts:47, and none on carrier death.

### SRC4Q1B-010
Verdict: confirmed
Corrected severity: Low
Reason: CTF client.qc:174-177 resets four timers; ad/ctf/index.ts:32 resets one. The other three have no reset in ad/ctf and default to 0 (flags.ts:41-42).

### SRC4Q1B-011
Verdict: confirmed
Corrected severity: Low
Reason: CTF teamplay.qc:1010-1014,:1066-1070 require a real team relation; flags.ts:44,:57 use a two-way ternary, so a null team takes the else branch.

### SRC4Q1B-012
Verdict: confirmed
Corrected severity: Low
Reason: CTF client.qc:226-244,:252,:314,:417 route through GotoNextMap in deathmatch, and :404-408 gates the print. ad/ctf/maps.ts:40,:55,:61-63 honor the map and print unconditionally. Likely a sensible divergence, as the finding says.

### SRC4Q1B-013
Verdict: confirmed
Corrected severity: Low
Reason: CTF client.qc:534-549 rotates deathmatch points; ad/ctf/teams.ts:50-51 returns the first for empty team spot lists. 14 maps in the ctf archive lack info_player_team1.

### SRC4Q1B-014
Verdict: confirmed
Corrected severity: Low
Reason: MG3 weapons.qc:586-612,:638-640 and both progs.src:9 are as cited; foundation/weapons.ts:83-84,:96 schedule only a 2.5 s explode and play bounce unconditionally.

### SRC4Q1B-015
Verdict: confirmed
Corrected severity: Low
Reason: MG3 weapons.qc:384 includes the super shambler; foundation/weapons.ts:114 tests monster_shambler only. The entity keeps classname monster_super_shambler (heavy/super-shambler.ts:93,:105), so the halving never applies.

### SRC4Q1B-016
Verdict: confirmed
Corrected severity: Low
Reason: MG3 player.qc:259,:264 fire from frames; ad/items/weapons.ts:60-65,:95-98 schedule a separate entity and test only null.

### SRC4Q1B-017
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: MG3 client.qc:1150-1168 is as cited and `mgdm` is absent from src/content and src/app. Change: only mgdm1 is wrong, repeating via rules.ts:211. The triggers on mgdm2, 3 and 4 point to mgdm3, 4 and 1, which is the authored rotation, so the claim about the others is false.

### SRC4Q1B-018
Verdict: confirmed
Corrected severity: Low
Reason: WQ pr_cmds.c:888-906 skips SOLID_NOT and builds the chain highest entity first; CTF observ.qc:235 stops at the first match; ad/ctf/observer.ts:52-57 iterates ascending with no solid test.
