# VERIFY-R — refutation pass over SRCQ1, SRCQ2 and SRCQ3 new findings

HEAD fcdc8af5; `clean/src` matches the project `src` (`diff -rq` empty). Reran `srcq1/startsolid.test.ts`, `srcq2/exp1.ts` and `srcq2/exp2.ts` from `clean`; all output matched the findings. Added two throwaway component checks: city1 trigger_push dump, and point traces against zero-size and explobox boxes (both deleted after running). Retail DLL read from the existing `baseq2.dis`. Nothing from `upstream/` was executed. No native DLL was run end to end.

### SRCQ1-001
Verdict: confirmed
Corrected severity: High
Reason: Reran: monster at x=30 and x=24 give fraction 1, allSolid, hit actor, touches 0; x=44 gives touches 1. physics.ts:367 gates impact on `fraction !== 1`; WQ sv_phys.c:426 uses `if (trace.ent)`; netquake.ts:103 has it right.
Scope note: for a player rocket (weapons.ts:201, +8 forward) on a 32-wide monster, the band is 32-39 units from the player, since 32 is contact. Enforcer laser (enforcer.qc:129) band against a player is 32-46.

### SRCQ1-002
Verdict: confirmed
Corrected severity: Medium
Reason: entity-services.ts:455-462 checks only canTakeDamage and iterates ascending. WQ pr_cmds.c:898 skips SOLID_NOT and prepends to the chain, so highest slot first. spatial-host.ts:69 shows the QC host has the check; frames.ts:1114 is the zombie_paine10 row.

### SRCQ1-003
Verdict: confirmed
Corrected severity: Low
Reason: foundation/monsters.ts:161 sets `toss`. rottweiler.qc:365 is the only movetype assignment, and :185-186 only clear FL_ONGROUND. WQ sv_phys.c:1476-1490 is the step path with the dland2 sound.

### SRCQ1-004
Verdict: confirmed
Corrected severity: Low
Reason: foundation/monsters.ts:49 and :85 write attackFinished unconditionally and have no edition check. V101 subs.qc:319 gates on `skill != 3`; RR subs.qc comments it out; q1/base/monsters.ts:223 honors the difference.

### SRCQ1-005
Verdict: confirmed
Corrected severity: Low
Reason: target.ts `monsterTargetEligible` includes `!notarget`, used at base/monsters.ts:66,:185 and foundation:108. RR ai.qc:650 tests health only, and :321 reads notarget in FindTarget. Drifts hold: foundation:62 origin distance vs ai.qc:174-175; retaliate writes oldEnemy before the attacker check vs combat.qc:241-246; `monster.enemy ?? attacker` vs combat.qc:102.

### SRCQ1-006
Verdict: confirmed
Corrected severity: Low
Reason: WQ sv_user.c:60 declares `int step, dir, steps` and truncates at `step = z[j] - z[j-1]`. netquake.ts idealPitch keeps float step and direction, so sub-1-unit slopes count and dir is non-integral.

### SRCQ1-007
Verdict: confirmed
Corrected severity: Low
Reason: All four hold: weapons.ts:55 vs RR weapons.qc:262 with WQ world.c:433 absmin padding; weapons.ts:80 ZERO grenade angles vs :604; axe trace.end at :222-223 vs :65; the `velocity_z + 400` branch (:462) is absent from weapons.ts:139-146.

### SRCQ1-008
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: QC path refuted: quakec-source.ts:1111 writes `v_angle` from the command in pre-think, and :1080 reads it back. Native path stands, now traced: players.ts:331 takes `body.angles`, :352 stores the previous command's angles, and quakeworld.ts:281-282 seeds only for prediction, against sv_user.c:1392,:1431. Reach is only worlds where runtime.ts:4092 supplies no `quakeWorld` host (native TS, mixed QC).

### SRCQ1-009
Verdict: confirmed
Corrected severity: Low
Reason: physics.ts:651 clears ground when the ground actor is not live, for every family. WQ sv_phys.c:1284-1285 returns on FL_ONGROUND without looking at groundentity.

### SRCQ2-001
Verdict: confirmed
Corrected severity: High
Reason: Reran exp2.ts on retail data: train.bsp lump lacks portal 1, style 1 is targeted by func_door *69 and *70, and setAreaPortalState throws; xsewer2 style 3 likewise. q2.ts:295-297 vs cmodel.c:1655, which rejects only `> numareaportals`. xsewer2's trigger_always has spawnflags 1792 (not easy, medium or hard), so it is deathmatch-only, as stated. No guard at runtime.ts:2752 or movers.ts:197. Door-to-exit is traced, not run.

### SRCQ2-002
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Mechanism reproduced (exp1: MASK_OPAQUE and MASK_SOLID point traces hit the corpse), index.ts:176-181,:200 vs sv_world.c:547-549. Impact is overstated, and exp1's corpse box is live-sized (max z 32). Real corpses are short: common.ts:60 and m_soldier.c:887 use max z -8, 16 units above the floor, so eye-to-eye lines on level ground (about 46+ above floor) pass over them. Sight loss needs ledge or stair geometry or a tall corpse (m_supertank.c:586). CanDamage from floor-level explosions (entity-services.ts:367-378) is the likely real effect.

### SRCQ2-003
Verdict: confirmed
Corrected severity: Medium
Reason: Reran exp1: world floor 200 to 31, monster-box floor stays 200. body.ts:80 `surface: null`; classic.ts:116 and rerelease.ts:314 need a truthy surface; cmodel.c:740 and :1363 guarantee nullsurface. p_move.cpp:564 has the same test.

### SRCQ2-004
Verdict: confirmed
Corrected severity: Low
Reason: Reran exp1: start in monster with wall at x=50 gives fraction 0.1666, hit world. index.ts:218-221 vs sv_world.c:566-577; sv_world.c has the world `fraction == 0` return and index.ts:160 does not. pmove.c:698 is the ground rule cited.

### SRCQ2-005
Verdict: confirmed
Corrected severity: Medium
Reason: q2.ts:195 clamps before comparing, vs cmodel.c:1061-1067,:1084-1089. I checked exp1's transcription against that code; it is faithful, and 44932 of 400000 differ. Those traces are adversarial, so this is not a field rate; a difference needs raw f <= -1, meaning a start inside epsilon and an inward move smaller than the remaining margin. Merged policy confirmed at source-hosts.ts:54,:59,:62 and physics.ts:294, with q2.ts:212-215 vs cmodel.c:1077-1082 and :926.

### SRCQ2-006
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: x87.ts:69 is 0x37f, resultFormat at :74-76 honors precision control, and sys_win.c:655 sets _PC_24 each frame. Severity lowered: the stated effect is low-bit differences that rarely affect play, and 24-bit is Windows-specific. baseq2.dis has no `fninit`, but its `fldcw` sites were not traced, so the CRT caveat remains.

### SRCQ2-007
Verdict: confirmed
Corrected severity: Medium
Reason: triggers.ts:21 is unconditional and fields.ts:73-75 yields +X for zero angles. g_trigger.c:25-26 leaves movedir zero; rerelease g_trigger.cpp:16-17 keys on `angle`. My dump of retail city1 shows *36 (speed 150) and *56 (speed 200) with angle 0 and spawnflags 2048. Reachability in play was not checked.

### SRCQ2-008
Verdict: confirmed
Corrected severity: Low
Reason: entity-services.ts:322-325 hardcodes talk1, vs g_utils.c:203-206. targets.ts triggerMultiple has no `sounds` handling, vs g_trigger.c:120-125. targets.ts:303 plays the noise only on self.

### SRCQ2-009
Verdict: confirmed
Corrected severity: Low
Reason: Grep of all `src` outside content/q2/rerelease finds no `pc_up` or `i_help`. targets.ts:299 only emits a help event, vs p_view.c:825-830 and p_hud.c:514-515.

### SRCQ2-010
Verdict: confirmed
Corrected severity: Low
Reason: view.ts:117 has no deathmatch branch, vs p_hud.c:488-504, and network.ts:226 sends it as stat 13.

### SRCQ2-011
Verdict: confirmed
Corrected severity: Low
Reason: view.ts:6 clamp lets the floor win and :44 passes `count * 0.5, 50`; p_view.c:177-180 applies the ceiling last. Count 200 gives 100 against 50.

### SRCQ2-012
Verdict: confirmed
Corrected severity: Low
Reason: triggers.ts:86 tests bit 8; g_trigger.c:570 tests SVF_DEADMONSTER, bit 2 (actor-execution.ts:73, rerelease/triggers.ts:130). runtime.ts:2634 isMonster reads only bit 4, so it does not filter corpses first.

### SRCQ2-013
Verdict: confirmed
Corrected severity: Low
Reason: movers.ts:533-537 removes with no effect; g_func.c:1081-1085 calls BecomeExplosion1.

### SRCQ2-014
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: source-hosts.ts:48-49 has no area test, vs sv_game.c:251-252. One citation is wrong: perception.ts:246 calls areasConnected right after :245, so that site does not rely on the import alone. The exposed callers are rerelease/index.ts:277, rerelease/entities.ts:324 and third-party DLLs. Retail claim holds: g_ai.c:550 is the only inPVS or inPHS call in Quake-2/game.

### SRCQ2-015
Verdict: confirmed
Corrected severity: Low
Reason: frames.ts throws plain Error on unordered numbers and on removal without a source. cl_ents.c:442-447 prints and advances, and has no ordering error. MAX_EDICTS exists only on the write side (message.ts:201), vs cl_ents.c:416.

### SRCQ2-016
Verdict: confirmed
Corrected severity: Low
Reason: vanilla.ts:250 stores signed MSG_ReadLong, message.ts:234 `< 256` is then true, and q_shared.h:1148 is unsigned. Flow corrected: q2-client-receiver.ts:62 re-encodes decoded frames. demo-local-recording.ts:133 encodes local host frames, not decoded ones. classic-guest-services.ts:327 uses getUint32, so native direct serving is unaffected.

### SRCQ2-017
Verdict: confirmed-with-changes
Corrected severity: High
Reason: Crash path holds: host.ts:404 leaves surface 0; retail DLL 0x20017f5a-0x20017fd3 tests null only for the sky flag, then calls strncmp on it, where `repnz scas` reads address 0; memory.ts:631 faults. Stated trigger refuted: rockets, grenades and bolts are zero-size (g_weapon.c:367,:505,:633), enter equals leave, and my check got 0 hits in 200000 lines through a zero box.
Real trigger: an explobox after death. barrel_delay (g_misc.c:966-972) clears takedamage for 0.2 s while staying SOLID_BBOX; health 10 dies to 3 shotgun pellets, so later pellets in the same blast reach the branch (19984 of 20000 such lines hit with null surface). 144 exploboxes in 22 retail maps, single-player and coop only (g_misc.c:976 frees them in deathmatch). Miss-case ent 0 is also real but rare: g_weapon.c:684 and :111 dereference with no fraction guard. Not run against the DLL.

### SRCQ3-001
Verdict: confirmed
Corrected severity: Low
Reason: Grep of `content/q3` finds no player-death write of `enemy`; combat.ts and death.ts have no reference. g_combat.c:506,:1059 set it and g_cmds.c:1100 reads it; commands.ts:480 is the port's read.

### SRCQ3-002
Verdict: confirmed
Corrected severity: Low
Reason: material.ts:1421 fails zero-stage shaders, :600-602 yields defaulted, shaders.ts:398 swaps in the default. tr_shader.c:2473-2475 defaults only on parse failure and :2270-2273 handles stage 0. The retail pak scan was not rerun.

### SRCQ3-003
Verdict: confirmed
Corrected severity: Low
Reason: interpreter.ts:1100-1104 throws and copies bytes; memory.ts:55 is copyWithin. vm_x86.c:1018-1037 uses `Constant4() >> 2`, masked pointers and forward `rep movsd`. The retail block-copy scan was not rerun.

### SRCQ3-004
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: Extended to all six: x87 unordered sets C0, C2 and C3. From vm_x86.c:805-871, EQF, LTF and LEF branch on NaN and NEF does not, so all four differ from operations.ts:99-104 (false, false, false, true). GTF and GEF do not branch and match the port. The title's "float branches" holds for four of six.

### SRCQ3-005
Verdict: confirmed
Corrected severity: Low
Reason: move.ts:210-219 and :493 have no product or mode gate, and :480 runs the extra trace every step. bg_pmove.c:1976-1994 has no ladder branch. The retail shader scan was not rerun.

### SRCQ3-006
Verdict: confirmed
Corrected severity: Info
Reason: move.ts:384 captures previous bounds, and :407-412 refuses an expansion onto allSolid; body-shape.ts:4-8 is the test. A dead-to-alive call expands from dead bounds, and an ordinary stand-up does spend a second trace. No runtime case built, and no retail route found, as the finding says.

### SRCQ3-007
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: Holds for the interpreter only: vm_interpreted.c:214 passes unknown opcodes at load. id's JIT also rejects them: vm_x86.c:1048 raises ERR_DROP `bad opcode`. So image.ts:157 matches compiled behavior except for drop timing. The `dataLength % 4` check at image.ts:191 has no counterpart in vm.c:509-516.
