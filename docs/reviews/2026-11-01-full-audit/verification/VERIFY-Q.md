# VERIFY-Q — verdicts settled against the original id Software source (extracted from SRCQ1, SRCQ2, SRCQ3)
### CONTENT1-001
Verdict: confirmed
Corrected severity: High
Reason: RR ai.qc:305-310 sets `client = sight_entity` and returns TRUE early when `client.enemy == self.enemy`; visibility and range run against that monster (ai.qc:327-344), and only ai.qc:349-358 swaps to `client.enemy`. V101 has the same logic. q1/base/monsters.ts:137-138 and foundation/monsters.ts:56 start from `sightEntity.monster.enemy`.
Source review: SRCQ1

### CONTENT1-002
Verdict: confirmed
Corrected severity: Medium
Reason: RR combat.qc:255-261 and V101 combat.qc:219 set `pain_finished = time + 5` after every `th_pain` on skill 3. q1/base/monsters.ts:290-335 has no such rule; foundation/monsters.ts:263 has it only for army.
Source review: SRCQ1

### CONTENT1-003
Verdict: confirmed
Corrected severity: Medium
Reason: Port composition fault; no original counterpart, since horde exists only in RR quakec_mg1/horde.qc. The earlier reproduction stands. Not source-dependent.
Source review: SRCQ1

### CONTENT1-004
Verdict: confirmed
Corrected severity: Medium
Reason: RR client.qc:1736-1738 prints `attacker.killstring`, set e.g. at monsters/grunt.qc:317 and misc.qc:199. Port writers use "killstring" (q1/base/monsters.ts:382) and the reader uses "kill_string" (composition/q1/runtime.ts:209).
Source review: SRCQ1

### CONTENT1-005
Verdict: confirmed
Corrected severity: Medium
Reason: RR client.qc:1075-1077 (gasp), :1101 (outwater), :1135-1141 (inlava, inh2o, slimbrn2) run per frame in the live path. A grep for `.environment(` under src finds no caller.
Source review: SRCQ1

### CONTENT1-006
Verdict: confirmed
Corrected severity: Medium
Reason: RR ai.qc:265-269 publishes sight_entity only when `self.enemy.classname == "player"`, and ai.qc:350-357 rejects non-player targets. foundation/monsters.ts:51 publishes unconditionally.
Source review: SRCQ1

### CONTENT1-007
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: No interrupt exists in QC; ai_run alone handles a dead enemy (RR ai.qc:650-667), and zombie.qc:374-388 only sets or restores solid inside paine10/12. Correction: "only splash can hurt it" is a port-only effect, because PF_findradius skips SOLID_NOT (WQ pr_cmds.c:898); see SRCQ1-002. The interrupt also fires on notarget, which QC never checks for an existing enemy; see SRCQ1-005.
Source review: SRCQ1

### CONTENT1-008
Verdict: confirmed
Corrected severity: Medium
Reason: Maintainability, port-only. The QC has one implementation path (RR monsters/grunt.qc, rottweiler.qc on ai.qc). SRCQ1-003, -004 and -005 are further drift in the second copy.
Source review: SRCQ1

### CONTENT1-009
Verdict: confirmed
Corrected severity: Low
Reason: RR monsters/rottweiler.qc Dog_JumpTouch (lines 84-115) has the `!checkbottom && FL_ONGROUND` branch that restarts dog_leap1. foundation/monsters.ts:234-236 has only the grounded branch, and dog_leap9 loops on itself in QC too.
Source review: SRCQ1

### CONTENT1-010
Verdict: refuted
Corrected severity: Info
Reason: Source-faithful. up/quake-rerelease-qc/quakec_ctf/teamplay.qc:1041-1044 prints `$qc_ks_blue_picked_up` in both the blue and red branches; no red string is used. q1/addons/ctf/flags.ts:53 matches.
Source review: SRCQ1

### CONTENT1-011
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Painforward is confirmed (RR ai.qc:399 uses `ideal_yaw`; q1/base/monsters.ts:180 uses angles.y). HuntTarget on oldenemy is confirmed (ai.qc:654-658). The megahealth item is refuted: RR items.qc:187-188 and V101 items.qc:178-179 return at `health >= 250` before T_Heal, which matches foundation/pickups.ts:33.
Source review: SRCQ1

### CONTENT1-012
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Classic has the bug: V101 misc.qc:197 and up/Quake/qw-qc/misc.qc both have `self.speed == 1000`, and id1 PAK0 progs misc_fireball has LOAD_F speed, NOT, IFNOT, then EQ_F with a discarded result. Rerelease fixed it (RR misc.qc:201-202 `self.speed = 1000`). So q1/base/map-entities.ts:164 is right for rerelease and wrong only for classic and QW editions.
Source review: SRCQ1

### CONTENT1-013
Verdict: confirmed
Corrected severity: Low
Reason: RR triggers.qc:629-635 plays windfly with the fly_sound limiter; RR doors.qc:228-231 plays misc/talk.wav with the message. foundation/spawns.ts:125 only precaches, and foundation/movers.ts:131 only shows the message.
Source review: SRCQ1

### CONTENT1-014
Verdict: confirmed
Corrected severity: Low
Reason: RR player.qc:179, :184 and :189 fire W_FireAxe from the axe frame functions, which player death frames replace. foundation/weapons.ts:215-226 checks neither health nor intermission. RR weapons.qc W_FireAxe has no guard because the frame chain provides one.
Source review: SRCQ1

### CONTENT1-015
Verdict: confirmed
Corrected severity: Low
Reason: QC caches `self.goalentity` and `movetarget` at start (RR ai.qc:238, monsters.qc start functions). The port's q1/base/monsters.ts:149-152 re-finds on each call. Performance only; no behavior claim.
Source review: SRCQ1

### CONTENT1-016
Verdict: confirmed
Corrected severity: Low
Reason: Port-only maintainability; not source-dependent.
Source review: SRCQ1

### CONTENT1-017
Verdict: confirmed
Corrected severity: Low
Reason: Port-only dead code; not source-dependent.
Source review: SRCQ1

### CONTENT1-018
Verdict: confirmed
Corrected severity: Low
Reason: RR monsters/chthon.qc:381-385 does `dprint` and return, while q1/base/provider.ts:124 throws. item_backpack has no spawn function in RR items.qc (:1429 only sets a classname at drop), so a map-placed one prints "No spawn function" and is freed (WQ pr_edict.c:966), whereas foundation/pickups.ts:92-98 accepts it and throws on a bad key.
Source review: SRCQ1

### CONTENT1-019
Verdict: confirmed
Corrected severity: Low
Reason: Test gap; not source-dependent.
Source review: SRCQ1

### CORE-001
Verdict: confirmed
Corrected severity: High
Reason: WQ world.c:843-844 and QW/server/world.c:746 skip a zero-size candidate when the mover has size. src/world/collision/index.ts #trace has no size test.
Source review: SRCQ1

### CORE-002
Verdict: confirmed
Corrected severity: High
Reason: WQ world.c:147-153 selects by `size[0]` only. RR monsters/{grunt,knight,hellknight,enforcer,zombie,scrag,spawn}.qc use 32x32x64, rottweiler.qc:373 uses 64x64x64 and rotfish.qc:205 uses 32x32x48. None match src/world/collision/q1/index.ts:112 exact-dimension lookup, so all take the derived path.
Source review: SRCQ1

### VM-002
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: WQ pr_exec.c:571-582 reads without a free check. Correction: fields are not "cleared". ED_Free (pr_edict.c:122-139) zeroes only model, takedamage, modelindex, colormap, skin, frame, origin, angles and solid, and sets nextthink to -1. `health`, `absmin` and others keep their last values, so the remediation's "return zeroed words" would also differ from id: `self.enemy.health` on a freed edict returns the old health.
Source review: SRCQ1

### VM-007
Verdict: confirmed
Corrected severity: Medium
Reason: WQ pr_exec.c:639-642 copies a, a+1 and a+2 with no bound.
Source review: SRCQ1

### VM-012
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: PF_WriteByte forwards verbatim (WQ pr_cmds.c:1539-1542), so split messages are legal. Correction: "client-side no-op" is wrong for the stock engine; an unknown TE hits `Sys_Error("CL_ParseTEnt: bad type")` (WQ cl_tent.c:291). The fatal-on-server behavior and the stuck buffer are still port faults.
Source review: SRCQ1

### GAPCOMPAT-001
Verdict: confirmed
Corrected severity: High
Reason: The QC statements hold: RR triggers.qc:623-627 writes `other.velocity` when `health > 0`, and :592-595 calls T_Damage on any takedamage target. Foreign actors are a port feature with no original counterpart, so the throw is a port fault.
Source review: SRCQ1

### GAPCOMPAT-002
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason:
- The throw and SV_MoveToGoal's lack of a check are right (WQ sv_move.c:402-424).
- The cited scenario is wrong. ThrowHead reuses self with `nextthink = -1` (RR player.qc:538-542, V101 player.qc:448), so heads are never freed. Barrel attackers are `self.enemy` (RR misc.qc:244).
- A real route: a tarbaby hits others with `T_RadiusDamage(self, self, ...)` (monsters/spawn.qc:185) and is freed by BecomeExplosion (RR weapons.qc:337). A patroller that became its enemy then calls movetogoal on a freed goal.
- Also, the freed goal is not fully zeroed: origin is, but absmin is not (pr_edict.c:133), and SV_CloseEnough reads absmin.
Source review: SRCQ1

### GAPCOMPAT-007
Verdict: confirmed
Corrected severity: Medium
Reason: No engine rule forbids these patterns; T_Damage is plain QC (RR combat.qc:141-264). A grep of the whole rerelease QC tree finds no `attacker.health`, so no upstream program shows that example pattern; the risk stays with third-party mods.
Source review: SRCQ1

### GAPCOMPAT-015
Verdict: confirmed
Corrected severity: Low
Reason: Port-only maintainability; not source-dependent.
Source review: SRCQ1

### SIM-009
Verdict: confirmed
Corrected severity: Medium
Reason: QW/client/common.c:2029 limits keys and values to under 64 characters, :2038 and :2050 cap the total, and MAX_INFO_STRING is 196 (common.h:31). The port has none.
Source review: SRCQ1

### SIM-010
Verdict: confirmed
Corrected severity: Medium
Reason: WQ host.c:505 caps at 72 Hz, host.c:60 sets sys_ticrate 0.05, and sys_linux.c:411-419 and sys_win.c:862 pace dedicated servers.
Source review: SRCQ1

### SIM-017
Verdict: confirmed
Corrected severity: Low
Reason: Q1 half only. WQ SV_Physics_Toss makes one SV_PushEntity (sv_phys.c:1303), whereas physics.ts:719-734 retries and re-fires touch. The Q2 half was not compared here.
Source review: SRCQ1

### T1-001
Verdict: confirmed
Corrected severity: High
Reason: QW/server/sv_user.c:1520-1527 runs PlayerPostThink in SV_PostRunCmd, and up/Quake/qw-qc/client.qc:1183 calls W_WeaponFrame from it, so skipping it stops all firing.
Source review: SRCQ1

### GAPAPP-008
Verdict: confirmed
Corrected severity: High
Reason: WQ cl_parse.c:775 assigns `cl.mtime[0] = MSG_ReadFloat()` with no monotonic check. Original tolerance holds.
Source review: SRCQ1

### GAPNET-001
Verdict: confirmed
Corrected severity: High
Reason: QW/client/cl_ents.c:327-374 counts only written entries (`newindex`), with no transient union. Even on overflow the original calls Host_EndGame, not process exit.
Source review: SRCQ1

### NET-006
Verdict: confirmed-with-changes
Corrected severity: High
Reason: For Q1, the original QW has no msec budget either (sv_user.c:1380-1415 only chops and clamps), so "no budget" alone matches QW and is not a deviation. The real QW deviation is the command count: sv_user.c:1609-1610 returns on a second clc_move in a packet, while app/bootstrap/network/qw-server.ts:234-241 processes every decoded move. The Q2 half was not compared here.
Source review: SRCQ1

### APP-001
Verdict: confirmed-with-changes
Corrected severity: High
Reason: A listen client recovers in Host_Error, but a dedicated server exits by design: WQ host.c:142 `Sys_Error ("Host_Error...")`, likewise Host_EndGame host.c:104. So "closes a dedicated server" on a QC error matches the original; the deviation for dedicated servers is the number of new throw paths, not the absence of recovery.
Source review: SRCQ1

### PLATFORM-010
Verdict: confirmed
Corrected severity: Medium
Reason: WQ sound.h:130 sets MAX_CHANNELS 128, and SND_PickChannel returns NULL when none can be stolen (snd_dma.c:384-385).
Source review: SRCQ1

### CORE-005
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The finding says the originals had undefined overflow here. For buffer overflow that is wrong: WQ cmd.c:92-96 prints "Cbuf_AddText: overflow" and drops. The over-long-line case was not checked.
Source review: SRCQ1

### CORE-011
Verdict: confirmed
Corrected severity: Low
Reason: WQ cmd.c:641 and :184 re-insert alias text in an unbudgeted Cbuf_Execute loop, so the original also hangs as the finding states.
Source review: SRCQ1

### TABLES-006
Verdict: confirmed
Corrected severity: Low
Reason: The cause is visible in the source. V101 knight.qc:50 lists `attackb1` twice and V101 oldone.qc:47 lists `shake12` twice, which shifts later frames by one. RR monsters/knight.qc:46 and shub.qc:50 removed the duplicates.
Source review: SRCQ1

### GAPQ12-003
Verdict: confirmed
Corrected severity: High
Reason: WQ host_cmd.c:1528-1534 gates only on deathmatch, then switches on `t[0]`; empty or unknown arguments do nothing. The port throws.
Source review: SRCQ1

### GAPQ12-006
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Source-faithful, not a port omission. quakec_mg3/weapons.qc:1571-1739 (100-105, 111-122, 219, 222, 223, 227, 228) and quakec_mg1/weapons.qc:1457 (219) are ungated in ImpulseCommands; the cheats_allowed test exists only in the cheat command (mg3 :1230, mg1 :1179). Remains a hardening option on a public server.
Source review: SRCQ1

### GAPQ12-015
Verdict: confirmed
Corrected severity: Info
Reason: quakec_hipnotic/hipmisc.qc:219-223 calls `localcmd(self.message)`. Faithful.
Source review: SRCQ1

### GAPQ12B-001
Verdict: confirmed
Corrected severity: High
Reason: quakec_rogue/combat.qc:184-185 runs RuneApplyBlack in deathmatch, and runes.qc:188-193 reads `who.rune` from an edict that persists, so no fault is possible. The port throw is a port fault.
Source review: SRCQ1

### GAPQ12B-003
Verdict: confirmed
Corrected severity: Medium
Reason: Performance, port-only; QC keeps these as entity fields.
Source review: SRCQ1

### GAPQ12B-006
Verdict: refuted
Corrected severity: Info
Reason: Source-faithful. quakec_rogue/teamplay.qc:1498 and :1523 both test `self.steam == flag1.team`, including in the flag2 branch, so q1/missionpacks/world/rogue-teams.ts:96 reproduces the source bug.
Source review: SRCQ1

### GAPQ12B-007
Verdict: refuted
Corrected severity: Info
Reason: Source-faithful. quakec_mg1/horde.qc:1677-1681 returns 0 with no living players, and Countdown at :1792-1793 just returns with no reschedule. The port's q1/addons/horde/index.ts:39-41 matches.
Source review: SRCQ1

### GAPQ12B-008
Verdict: refuted
Corrected severity: Info
Reason: Source-faithful. quakec_rogue/morph.qc:544-545 does `setorigin(theChild, ...); droptofloor();` with self still the parent.
Source review: SRCQ1

### GAPQ12C-004
Verdict: confirmed
Corrected severity: High
Reason: Settled: the source uses degrees. `sin` is QC, not a builtin: quakec_mg1/math.qc:43-48 and quakec_mg3/math.qc:43-48 build `{0, angle, 0}` and return `v_forward_y` from makevectors (both in progs.src:26). func_bob.qc wraps count at 360. q1/addons/brushes.ts:13 passes degrees to radian `Math.sin`/`Math.cos`, so every func_bob jumps instead of bobbing on the many maps the finding lists.
Source review: SRCQ1

### GAPQ12C-005
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: objerror does end in Host_Error (WQ pr_cmds.c:88-93) for hiptrain.qc:74, dragon.qc:840 and others. A listen client returns to console, but a dedicated server exits in the original too (host.c:142). `target_lightramp lost its light` (q1/addons/lights.ts:16) has no matching objerror: mg1 lights.qc:182-186 checks only in target_lightramp_init, and a later kill of the light just reads the freed edict in target_lightramp_tick (:140).
Source review: SRCQ1

### CONTENT2-001
Verdict: confirmed
Corrected severity: High
Reason: The original saves functions by table, so it cannot fail here. p_client.c:108-117 and :137-162 set named think SP_CreateCoopSpots/SP_FixCoopSpots on `security` and the same 14 coop maps the port lists; the port's lambdas are the only divergence.
Source review: SRCQ2

### CONTENT2-002
Verdict: confirmed
Corrected severity: Medium
Reason: m_hover.c:520-528 is a named hover_deadthink with its deadline in `self->timestamp` (:537). The port's closure and local deadline differ.
Source review: SRCQ2

### CONTENT2-003
Verdict: confirmed
Corrected severity: High
Reason: g_weapon.c:47 requires `tr.ent->monsterinfo.dodge`. Only brain, chick, gunner, infantry, medic and soldier set it (m_brain.c:660, m_chick.c:666, m_gunner.c:616, m_infantry.c:595, m_medic.c:755, m_soldier.c:1223); tank, gladiator, berserk, mutant, supertank, makron and jorg set NULL, and floater and hover have it commented out. The port's fallback at foundation/monsters/index.ts:676-680 runs for all others.
Source review: SRCQ2

### CONTENT2-004
Verdict: confirmed
Corrected severity: Medium
Reason: g_combat.c:508-514: `if (!(aiflags & AI_DUCKED) && take) { pain(...); if (skill == 3) pain_debounce_time = level.time + 5; }`. index.ts:157-163 has neither condition.
Source review: SRCQ2

### CONTENT2-005
Verdict: confirmed
Corrected severity: Medium
Reason: g_func.c:1461-1471 has the non-living branch (100000 damage, then BecomeExplosion1) before the debounce and dmg checks. movers.ts:582-588 omits it.
Source review: SRCQ2

### CONTENT2-006
Verdict: confirmed
Corrected severity: Low
Reason: SP_func_button (g_func.c:763) sets no `blocked` and no `dmg`. movers.ts:280 and :311 give buttons both.
Source review: SRCQ2

### CONTENT2-007
Verdict: confirmed
Corrected severity: Low
Reason: m_soldier.c:1166 `self->s.skinnum |= 1` runs on every regular death. soldier.ts:162-165 has no equivalent for classic.
Source review: SRCQ2

### CONTENT2-008
Verdict: confirmed
Corrected severity: Low
Reason: m_soldier.c:1152-1155: 3 sm_meat, 1 chest, head2. soldier.ts:155-157 throws 2 bone, 4 sm_meat, head2 in the classic branch.
Source review: SRCQ2

### CONTENT2-009
Verdict: confirmed
Corrected severity: Low
Reason: g_monster.c:511-520 clears `self->item = NULL` after Drop_Item. index.ts:644-648 reads the spawn value each first death.
Source review: SRCQ2

### CONTENT2-010
Verdict: confirmed
Corrected severity: Low
Reason: g_combat.c:105-109 has both the coop `resp.score++` and `targ->owner = attacker`. index.ts:637 has neither.
Source review: SRCQ2

### CONTENT2-011
Verdict: confirmed
Corrected severity: Low
Reason: m_move.c:369-370 tests the raw `angles[YAW] - ideal_yaw` (also original/xatrix/m_move.c:381-382, original/rogue/m_move.c:631-634). Rerelease uses FacingIdeal instead. ai.ts:214 wraps for all editions, so it is wrong only for classic.
Source review: SRCQ2

### CONTENT2-012
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: m_move.c:444 and original/rogue/m_move.c:709 are `(rand()&3)&1`; rerelease/m_move.cpp:1073 is `brandom()`. All are 1/2. ai.ts:233 gives 3/4 for every non-rogue rule, so rerelease without Rogue is also wrong, not only base.
Source review: SRCQ2

### CONTENT2-013
Verdict: confirmed
Corrected severity: Low
Reason: g_trigger.c:338 and :346 play on `activator`; targets.ts:259 plays on self. g_target.c:178-180 is the mine3 hack. g_target.c:292 is the exit broadcast. Neither exists in the port.
Source review: SRCQ2

### CONTENT2-014
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The original also never frees mynoise (p_weapon.c:78-95; ClientDisconnect at p_client.c:1504 does not touch it), but the pointers live on the reused client edict, so the count is bounded by 2 x maxclients. The port's per-actor pair grows with reconnects, which is the real difference. The "orphaned" wording alone would also describe the original.
Source review: SRCQ2

### CONTENT2-015
Verdict: confirmed
Corrected severity: Low
Reason: rerelease/g_monster.cpp:847-853 gates on dodge_time and uses gi.BoxEdicts over absmin-512..absmax+512. The port's full entity scan has no original counterpart; the proposed remedy matches the source.
Source review: SRCQ2

### CONTENT2-016
Verdict: confirmed
Corrected severity: Low
Reason: No source claim; port-only feature. See Coverage.
Source review: SRCQ2

### CONTENT2-017
Verdict: confirmed
Corrected severity: Info
Reason: The source-data claims hold: m_boss2.c declares boss2_move_fidget at original/baseq2/m_boss2.c:213, m_actor.c:134 declares actor_move_run as run02-run07 and m_float.c:238 declares floater_move_activate as actvat01-31.
Source review: SRCQ2

### CONTENT2-018
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The flyer part is faithful dead code, not a port defect: m_flyer.c:497 flyer_setstart has no table reference in the source either (only the prototype at :47), and `static int nextmove` (:33) is only written there. Keep or drop by choice. The ballistics, bodyOf and import claims have no source angle and stand.
Source review: SRCQ2

### CONTENT2-019
Verdict: confirmed
Corrected severity: Low
Reason: No source claim.
Source review: SRCQ2

### CORE-006
Verdict: confirmed
Corrected severity: Low
Reason: p_client.c:1537-1543 selects MASK_DEADSOLID when `pm_passent->health <= 0`. movement/q2/index.ts:134 is unconditional. cl_pred.c CL_PMTrace uses MASK_PLAYERSOLID, so prediction should keep it. Only the TS base path is affected; native DLLs call their own PM_trace through compat/q2/classic/pmove.ts.
Source review: SRCQ2

### GAPQ12-001
Verdict: confirmed
Corrected severity: High
Reason: client/cl_parse.c:430-437 falls back to players/male when RegisterModel fails, and :445-461 falls back on skin. The original cannot exit here.
Source review: SRCQ2

### GAPQ12-002
Verdict: confirmed
Corrected severity: High
Reason: original/xatrix/p_weapon.c:1636-1690 and original/rogue/p_weapon.c:615-668 decrement with no check. original/rogue/g_items.c:807-826 guards only `AMMO_GRENADES`. The original goes negative and never faults.
Source review: SRCQ2

### GAPQ12-004
Verdict: confirmed
Corrected severity: Medium
Reason: original/ctf/g_ctf.c:3092 CTFJoinTeam is reached only through menu entries, and original/ctf/g_cmds.c:508-511 opens the join menu only for CTF_NOTEAM. No client command names a menu action.
Source review: SRCQ2

### GAPQ12-008
Verdict: confirmed
Corrected severity: Low
Reason: original/xatrix/p_client.c:438-441 tests DF_QUADFIRE_DROP (q_shared.h:1017, 0x10000) with `quadfire_framenum > framenum + 10`, in classic. composition/q2/index.ts:161-162 gates it on rerelease.
Source review: SRCQ2

### GAPQ12-009
Verdict: confirmed
Corrected severity: Low
Reason: original/rogue/g_sphere.c:359-363 and :462-465 assign `wait = time + 15` in the doppleganger branch, shortening from 30. spheres.ts:122,130 use Math.max.
Source review: SRCQ2

### GAPQ12-010
Verdict: confirmed
Corrected severity: Low
Reason: rerelease/p_client.cpp:3731-3736 copies once and sets resp.spectator; :1626 skips the copy while it is set; :2250 clears it inside PutClientInServer, after respawn's test. The port clears before calling respawn.
Source review: SRCQ2

### GAPQ12-011
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The buffer is 256 bytes, not 1024: original/ctf/g_ctf.c:2462 and rerelease/ctf/g_ctf.cpp:2136. So the original also truncates team chat at 254 bytes where the port keeps 1023. The loop stops only when output fills, so expansion cost is bounded by that limit, tighter than the finding states.
Source review: SRCQ2

### GAPQ12-013
Verdict: confirmed
Corrected severity: Low
Reason: No source claim.
Source review: SRCQ2

### GAPQ12-014
Verdict: refuted
Corrected severity: Info
Reason: original/rogue/dm_ball.c:439 has `//	self->s.modelindex = 0;` commented out in DBall_BallDie, and the ball stays drawn while non-solid. The port is faithful. The inference that C cleared the model was wrong.
Source review: SRCQ2

### GAPQ12B-004
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: original/xatrix/m_fixbot.c:724-736 and :1066-1076 dereference goalentity unchecked. A freed edict is stale but valid, as claimed, so the port's throw is stricter there. However the source also sets goalentity to NULL (:319, :341, :511), where C crashes, so the fallback should cover that case, too.
Source review: SRCQ2

### GAPQ12B-005
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The recollection is wrong in detail: rerelease/g_monster.cpp:705-713 has no max(0, ...). It refunds only after gibbing (`health <= gib_health`, comment at :704) and then clears commander. The port refunds on first death, before any revive, at foundation/monsters/index.ts:633. That is the real defect, and it can drive monsterUsed negative as described. The remedy should be refund on gib and clear, not clamp.
Source review: SRCQ2

### GAPQ12C-002
Verdict: confirmed
Corrected severity: High
Reason: original/xatrix/g_monster.c:78-142 and :145-180: RF_BEAM entity, dabeam_hit sets `think = G_FreeEdict` at +0.1 s, so the beam ends with the entity. Callers m_brain.c:644,660, m_fixbot.c:959, m_soldier.c:1688 all use it. The "from memory" lifetime is now proven.
Source review: SRCQ2

### GAPQ12C-003
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The bolt half is proven: rerelease/m_shambler.cpp:306-311 is a one-shot TE_LIGHTNING multicast. The windup half is faithful: PAIN at :195-227 does not free self->beam, and shambler_windup at :70-76 overwrites it, so C orphans the same beam entity. Only die frees it (:510-519). Remove that half or treat it as a deliberate fix.
Source review: SRCQ2

### GAPQ12C-006
Verdict: confirmed
Corrected severity: Low
Reason: rerelease/g_monster.cpp:398 clears `s.sound` each frame and :405-407 apply weapon_sound only with `health > 0`. gladiator.ts:44-55 sends no stop. Confidence upgrades from plausible to traced.
Source review: SRCQ2

### GAPQ12C-008
Verdict: confirmed
Corrected severity: Info
Reason: No source claim.
Source review: SRCQ2

### GAPCOMPAT-009
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: g_utils.c:430 requires `freetime < 2 || time - freetime > 0.5`, so the hold-off is real after the first 2 s of level time and absent before. :438 confirms gi.error. Q3's 1 s value was not checked here.
Source review: SRCQ2

### GAPCOMPAT-010
Verdict: confirmed
Corrected severity: Low
Reason: g_cmds.c:34-37 returns the whole skin when there is no `/`. combat-binding.ts:94 yields empty for DF_SKINTEAMS. The model branch is correct.
Source review: SRCQ2

### GUEST-010
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The throw stands. The retail DLL sources show no client-derived format: baseq2, ctf, rogue and xatrix pass only fixed godmode and notarget strings (g_cmds.c:324,353,385 and siblings). The one exception is map text, original/rogue/g_newfnc.c:149 `gi.centerprintf(other, self->message)`, so a `%` in a Rogue map message hits this. The remote trigger applies to third-party DLLs only. All conversions in those sources pass the regex.
Source review: SRCQ2

### TABLES-002
Verdict: confirmed
Corrected severity: Medium
Reason: original/rogue/m_boss2.c:302-303, :329-330 (10, comment "normally all 8's"), :355-356, :372-373, :394-395 (2) and :407 (-5, comment "was -20"). The source explains the DLL data.
Source review: SRCQ2

### TABLES-005
Verdict: confirmed
Corrected severity: Low
Reason: original/baseq2/g_items.c:1413 has world_model_flags 0 for ammo_grenades. items.ts:46 has `rotate: true`.
Source review: SRCQ2

### TABLES-007
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: The Xatrix source agrees with the port: original/xatrix/m_flash.c:132-133 has row 57 as 24.8 and :227-228 has row 98 as 31.5*1.2, 9.6*1.2, 10.1*1.2, with the old values commented out. The difference exists only against the 1998 corpus DLL, which predates that fix. Whether to match that build is a choice, not a defect.
Source review: SRCQ2

### TABLES-009
Verdict: refuted
Corrected severity: Info
Reason: ref_gl/gl_mesh.c:764-770 and :385-390 reset out-of-range frames to 0. prepare.ts:46-47 does the same for q2-md2, as VERIFY already found. Source-side detail: gl_mesh.c:773-778 resets `frame`, not `oldframe`, on a bad oldframe, but R_CullAliasModel at :391-395 has already cleared oldframe.
Source review: SRCQ2

### GAPAPP-005
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Missing is proven: ref_gl/gl_model.c:231 errors only with `crash`, and gl_rmain.c:336-340 draws R_DrawNullModel. "Malformed" is wrong for the original: bad versions call ri.Sys_Error(ERR_DROP) (gl_model.c:863), so the original drops to console rather than drawing nothing.
Source review: SRCQ2

### GAPAPP-014
Verdict: confirmed
Corrected severity: Low
Reason: The beam is a plain RF_BEAM entity (g_target.c:591; cl_ents.c:927), so it stops on G_FreeEdict.
Source review: SRCQ2

### GAPAPP2-005
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The sound half is proven: cl_parse.c:634 returns on an empty precache slot. The flash half is wrong about the original: cl_fx.c:446-448 indexes monster_flash_offset with no bounds check, reading out of bounds rather than ignoring the value. Dropping it is still right, but it is not parity.
Source review: SRCQ2

### GAPSIM-001
Verdict: confirmed
Corrected severity: Critical
Reason: server/sv_main.c:296-297 truncates with strncpy into MAX_INFO_STRING before ClientConnect (:385).
Source review: SRCQ2

### SIM-017
Verdict: confirmed
Corrected severity: Low
Reason: g_phys.c:713 pushes once per SV_Physics_Toss. g_monster.c:175-178 M_CheckGround copies endpos and zeroes velocity[2].
Source review: SRCQ2

### APP-011
Verdict: confirmed
Corrected severity: Medium
Reason: server/sv_main.c:741-746 "never get more than one tic behind" clamps svs.realtime to sv.time.
Source review: SRCQ2

### DOCS3-006
Verdict: confirmed
Corrected severity: Low
Reason: p_client.c:959 `body->s = ent->s`, and cl_ents.c:936 maps modelindex 255 through clientinfo. Only the source half is settled; the TS run was not performed.
Source review: SRCQ2

### NET-010
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The 15 bits, absent expiry and capacity eviction are original: sv_main.c:235-252 `rand() & 0x7fff` with oldest-slot replacement, and :322 replies "Bad challenge". This is inherited weakness, not a port regression. The hardening advice stands.
Source review: SRCQ2

### NET-017
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Plain strcmp with no throttle is original (sv_main.c Rcon_Validate). Inherited, not a regression.
Source review: SRCQ2

### T2C-007
Verdict: confirmed
Corrected severity: Low
Reason: sv_ccmds.c:657-659 forbids deathmatch saves. original/ctf/p_client.c:1190 calls KillBox. The test comment is accurate about the source.
Source review: SRCQ2

### GAPQ3-001
Verdict: confirmed-with-changes
Corrected severity: Critical
Reason: The three source faults are real: `game/g_cmds.c:1183` uses `>` so order 7 indexes past the 7-entry `gc_orders` (:1160-1168), and `SanitizeString` steps over the NUL at :163-165. The follow case is not undefined behavior in id: from `spectatorClient == -1` the loop at :772-797 never equals `original`, so with nobody to follow id's server hangs forever. The port's exit replaces a hang there, and replaces survivable reads in the other two.
Source review: SRCQ3

### GAPQ3-002
Verdict: confirmed
Corrected severity: Critical
Reason: id 1.32 filters only `;` (`game/g_cmds.c:1242`). The newline claim holds: `MSG_ReadString` rewrites only `%` and values above 127 (`qcommon/msg.c:440-444`), and a quoted token copies anything but `"` (`qcommon/cmd.c:498-502`). A passed vote is appended raw (`game/g_main.c:1515`), and a pass needs `voteYes > numVotingClients/2` (:1524). So this is inherited from id, not a port regression. The ioquake3 fix is unverifiable here.
Source review: SRCQ3

### GAPQ3-003
Verdict: confirmed
Corrected severity: High
Reason: `TEAM_MAXOVERLAY` is 32 (`game/bg_public.h:557`), `sortedTeamPlayers` has that size (`cgame/cg_draw.c:38`), `CG_ParseTeamInfo` has no bound (`cgame/cg_servercmds.c:120-125`), the server sends up to 32 (`game/g_team.c:1081`), and drawing clamps to 8 (`cgame/cg_draw.c:868`). The port's limit of 8 at the parse step has no source counterpart.
Source review: SRCQ3

### GAPQ3-004
Verdict: confirmed
Corrected severity: High
Reason: `ClientConnect` filters `ip` for every client including bots (`game/g_client.c:918-919`). `""` skips the loop, so `in` reads uninitialized `m[4]` (`game/g_svcmds.c:181,186,197`), and only real connections receive an `ip` key (`server/sv_client.c:292,317`). The source reads indeterminate bytes and continues.
Source review: SRCQ3

### GAPQ3-005
Verdict: confirmed
Corrected severity: Medium
Reason: The missing wrap is id's: `cg.voiceChatBufferOut++` (`cgame/cg_servercmds.c:871`) and `cg.soundBufferOut++` (`cgame/cg_view.c:732`), while the drains use modulo (:848, :746).
Source review: SRCQ3

### GAPQ3-006
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: `CG_Missile` only indexes `cg_weapons` (`cgame/cg_ents.c:412-415`), and `CG_MissileHitWall` has a tolerant default case (`cgame/cg_weapons.c:1752` onward). But `CG_RegisterWeapon` does call `CG_Error("Couldn't find weapon")` (`cgame/cg_weapons.c:633`), so an unknown weapon reaching it also ends the session in id through ERR_DROP. The difference is disconnect versus process exit, not tolerance versus failure, on that path.
Source review: SRCQ3

### GAPQ3-007
Verdict: confirmed
Corrected severity: Low
Reason: No source claim; port lifecycle only. Not re-tested.
Source review: SRCQ3

### GAPQ3-008
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The statement "C reads past the array" is wrong for index 8. The source array has 32 slots (`game/bg_public.h:557`, `cgame/cg_draw.c:38`), and `CG_NextOrder_f` reads inside it (`cgame/cg_consolecmds.c:257`). The throw exists only because the port sized its tuple to 8 (`content/q3/presentation/state.ts:159`), the same root as GAPQ3-003.
Source review: SRCQ3

### GAPQ3-009
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Opened and confirmed as tolerant in id: gametype (`cgame/cg_servercmds.c:149`), flag status `s[0]-'0'` (:210), team `atoi` (`cgame/cg_players.c:925`), skull trail indexed with no guard (`cgame/cg_players.c:1768`), and ERR_DROP handling (`client/cl_cgame.c:422`). Not opened: the `Invalid view weapon team` and HUD `curWeapon` originals.
Source review: SRCQ3

### GAPQ3-010
Verdict: confirmed
Corrected severity: Medium
Reason: No source claim. Supplemental scene sessions have no id counterpart. Not re-tested.
Source review: SRCQ3

### GAPQ3-011
Verdict: confirmed
Corrected severity: Low
Reason: `CG_LoadClientInfo` ends with the reset loop (`cgame/cg_players.c:726-734`).
Source review: SRCQ3

### GAPQ3-012
Verdict: confirmed
Corrected severity: Low
Reason: The source calls `trap_CM_TempBoxModel` per solid (`cgame/cg_predict.c:119`), and `CM_TempBoxModel` (`qcommon/cm_load.c:798`) works on the static `box_model` and `box_brush` (`qcommon/cm_load.c:67,69`). So id allocates nothing per trace, as the finding says.
Source review: SRCQ3

### GAPQ3-013
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: `CG_FileExists` only opens: `trap_FS_FOpenFile( filename, 0, FS_READ )` and tests the length (`cgame/cg_players.c:297-305`). The limit exists (`MAX_MOD_KNOWN` 1024, `renderer/tr_local.h:757`), but "stop this with a drop" is wrong at that site: the allocator returns NULL (`renderer/tr_model.c:57-58`). I did not read its caller.
Source review: SRCQ3

### GAPQ3-014
Verdict: confirmed
Corrected severity: Low
Reason: No source claim; test gap only.
Source review: SRCQ3

### GAPQ3B-001
Verdict: confirmed
Corrected severity: High
Reason: id copies the whole struct: `ent->client->ps = cl->ps` (`game/g_active.c:1077`), then sets `PMF_FOLLOW` and merges vote flags (:1078-1079). A port that preserves origin, velocity, health and ammo differs on core spectator behavior.
Source review: SRCQ3

### GAPQ3B-002
Verdict: confirmed
Corrected severity: Medium
Reason: `AngleSubtract` has the same unbounded loop (`game/q_math.c:611-618`), so a retail client hangs on such a value too. This is a faithful port of a real weakness.
Source review: SRCQ3

### GAPQ3B-003
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: id has no guard: `trDuration = length * 1000 / speed` (`game/g_mover.c:1309`) and `f = 1000.0 / trDuration` (:530, :537). The port therefore matches id, and the absence is not a port divergence. The ioquake3 fix is unverifiable here. The finding's own scan shows no retail map reaches it.
Source review: SRCQ3

### GAPQ3B-004
Verdict: confirmed
Corrected severity: Low
Reason: `G_UseTargets( next, NULL )` is at `game/g_mover.c:1287`, and handlers read `activator->client` (`game/g_target.c:34,68,143,348`). The "treated as no client" claim now has evidence: the word at VM data address 308, my computed `FOFS(client)`, is 0 in retail `pak8.pk3 vm/qagame.qvm`.
Source review: SRCQ3

### GAPQ3B-005
Verdict: confirmed
Corrected severity: Low
Reason: `if ( !token ) break` (`cgame/cg_players.c:130`) can never fire, because `COM_ParseExt` returns `com_token` at end of data (`game/q_shared.c`). So the "loops forever in C" claim holds for a file with no frame numbers.
Source review: SRCQ3

### GAPQ3B-006
Verdict: refuted
Corrected severity: Info
Reason: id's stop path is `G_SetOrigin( ent, trace->endpos ); return;` with no `s.time` write (`game/g_missile.c:48-49`). The port matches id 1.32. The recalled line, if it exists anywhere, is later than this release.
Source review: SRCQ3

### GAPQ3B-007
Verdict: confirmed
Corrected severity: Low
Reason: `G_RunItem` uses the entity after `G_RunThink` in the same order (`game/g_items.c:991-1008`). The hazard is the port's allocating setter, not the order.
Source review: SRCQ3

### GAPQ3B-008
Verdict: confirmed
Corrected severity: Low
Reason: No source claim to settle. Not re-tested.
Source review: SRCQ3

### GAPQ3B-009
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Test gap stands. Its follow-mode and train cases remain valid targets, but GAPQ3B-003's case tests a behavior id shares.
Source review: SRCQ3

### GAPQ3B-010
Verdict: confirmed
Corrected severity: Info
Reason: No source claim. Not re-tested.
Source review: SRCQ3

### GAPBOTS-001
Verdict: refuted
Corrected severity: Info
Reason: The recalled clear does not exist. `AIEnter_Battle_Fight` has no `bs->flags &= ~BFL_FIGHTSUICIDAL`. The whole game has one setter (`game/ai_dmnet.c:1978`) and one reader (:2126); the flag only resets through `BotResetState` (for example `AIEnter_Intermission`, :1133). The latch is id's behavior, faithfully ported. Whether to fix it is a design choice, not a port defect.
Source review: SRCQ3

### GAPBOTS-002
Verdict: confirmed
Corrected severity: Medium
Reason: `BotFuncBobStartEnd` prints and returns with `origin` untouched (`botlib/be_ai_move.c:2270-2276`), and callers use their local (:2329, :2487). The port's throw replaces use of an uninitialized value.
Source review: SRCQ3

### GAPBOTS-003
Verdict: refuted
Corrected severity: Info
Reason: The condition is `if (BotCTFCarryingFlag(bs))` alone (`game/ai_dmnet.c:197`), with no 1FCTF or Harvester alternatives and no `MISSIONPACK` branch. The port matches.
Source review: SRCQ3

### GAPBOTS-004
Verdict: confirmed
Corrected severity: Low
Reason: The source names exactly four weapons: machinegun, shotgun, lightning, railgun (`game/ai_dmq3.c:3516-3519`). The chaingun is not among them, so the port's speed test does differ on Team Arena.
Source review: SRCQ3

### GAPBOTS-005
Verdict: confirmed
Corrected severity: Low
Reason: No source claim to settle. Not re-tested.
Source review: SRCQ3

### GAPBOTS-006
Verdict: confirmed
Corrected severity: Low
Reason: No source claim to settle. Not re-tested.
Source review: SRCQ3

### GAPBOTS-007
Verdict: confirmed
Corrected severity: Low
Reason: `Cvar_Update` raises ERR_DROP at the same bound (`qcommon/cvar.c:871-875`, `game/q_shared.h:968`), which ends the map and not the process.
Source review: SRCQ3

### GAPBOTS-008
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The test gap is real, but its motivating defect, GAPBOTS-001, is refuted. A transition test must not assert a clear that id never performs.
Source review: SRCQ3

### BOTS-001
Verdict: confirmed-with-changes
Corrected severity: Critical
Reason: The offset is `char` (`game/be_ai_chat.h:57`). `BotMatchVariable` treats a negative offset as empty (`botlib/be_ai_chat.c`), so C carries on. The open question is settled: retail `pak4.pk3 botfiles/match.c:32` is `EC"("|EC"[", NETNAME, ..., ADDRESSEE, " help "|" meet ", TEAMMATE`, and `BotMatchMessage` tests that context (`game/ai_cmd.c:1804-1806`). The route is team chat or `tell`, since only those produce the `EC"("` or `EC"["` prefix. Plain `say` matches only the reply template, whose variables start early (`match.c:300`). Traced by hand, not run with the real file.
Source review: SRCQ3

### BOTS-002
Verdict: confirmed-with-changes
Corrected severity: Critical
Reason: The heap leak is id's: the replaced waypoint is unlinked and never freed (`game/ai_cmd.c:1203-1208`). `BotCreateWayPoint` warns and returns NULL (`game/ai_dmq3.c:2125-2127`), then `cp->next` is written (`game/ai_cmd.c:1212`). Correction: in a QVM that write goes to masked low memory and does not crash; only a DLL build crashes. Template confirmed at `match.c:212-215`, so it needs team chat or `tell` in a team gametype (`ai_cmd.c:1181`) with a position in a valid area (:1191-1198).
Source review: SRCQ3

### BOTS-003
Verdict: confirmed
Corrected severity: High
Reason: `netname` is uninitialized on the "someone else" branch and read at `game/ai_cmd.c:564-565`. `BotMatch_LeadTheWay` has the same shape and tests the stale `bs->teamgoal` (:1668-1671).
Source review: SRCQ3

### BOTS-006
Verdict: confirmed
Corrected severity: Medium
Reason: No statement about the original that needs settling. Not re-tested.
Source review: SRCQ3

### BOTS-009
Verdict: confirmed
Corrected severity: Medium
Reason: id checks only ident, version and BSP checksum (`botlib/be_aas_file.c:362-388`), so the parser gap exists in id too. The port's parser checks more than id's does, but not this.
Source review: SRCQ3

### BOTS-010
Verdict: confirmed
Corrected severity: Medium
Reason: Same header-only checks in id (`botlib/be_aas_file.c:362-388`). The defect is against the port's own `load.ts` contract, not against id.
Source review: SRCQ3

### BOTS-013
Verdict: confirmed
Corrected severity: Medium
Reason: No source claim to settle. Not re-tested.
Source review: SRCQ3

### BOTS-014
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The loop bound is as recalled (`for (i = 0; i >= 0 && i < 10;)`), ending at `return 0` (`game/ai_dmq3.c:4339`). Addition: at i=9 id first writes `targetname[10]`, one row past the array (:4162, :4330), and `cur_entities[10]` (:4332), then exits. So C has a stack overrun on the way out, then returns "no activator".
Source review: SRCQ3

### BOTS-015
Verdict: confirmed
Corrected severity: Low
Reason: With short args, `memmove` and `args[strlen(args)-1] = 0` stay inside `buf[1024]` (`game/ai_main.c:963,991-1008`), and the bot keeps going.
Source review: SRCQ3

### BOTS-017
Verdict: confirmed
Corrected severity: Low
Reason: No source claim to settle. Not re-tested.
Source review: SRCQ3

### BOTS-023
Verdict: confirmed
Corrected severity: Medium
Reason: Test gap stands. The retail template shapes above can now seed the tests directly.
Source review: SRCQ3

### UI-003
Verdict: confirmed
Corrected severity: High
Reason: `menu->items[menu->cursorItem]` runs with cursorItem -1 before the `while` condition ends the loop (`ui/ui_shared.c:2449-2457`). `items[-1]` is the last word of `disableColor` (`ui/ui_shared.h:269-270`). `Item_SetFocus` also returns false for an already focused item (`ui/ui_shared.c:1347`), as the finding states.
Source review: SRCQ3

### UI-025
Verdict: confirmed
Corrected severity: Info
Reason: The literal is in id's code: `(value != 0) ? "FIXME" : "FIXME"` (`ui/ui_shared.c:3448`), with the `value` read at :3424. Confidence can move from plausible to traced.
Source review: SRCQ3

### CONTENT1-020
Verdict: confirmed
Corrected severity: Info
Reason: `cgame/cg_ents.c:681-692` computes angular deltas, applies only translation, and ends in the quoted FIXME.
Source review: SRCQ3

### LEFT-001
Verdict: confirmed
Corrected severity: Critical
Reason: QVM `sscanf` always writes all destinations (`game/bg_lib.c:1299-1319`). `_atof` leaves its pointer past the NUL after a final digit (`game/bg_lib.c:884-911`), so the next read uses stale bytes in the same `buf`. Called at `game/ai_cmd.c:1189` and `game/g_spawn.c:68`. Template confirmed at `match.c:213`, reached by team chat or `tell`. C continues; the port throws.
Source review: SRCQ3

### GAPMAT-001
Verdict: confirmed
Corrected severity: High
Reason: `RE_AddRefEntityToScene` checks only reType and count (`renderer/tr_scene.c:207-223`), and a search of `renderer/*.c` for `isnan` or `IS_NAN` found none. Rail length converts to int with no exit (`renderer/tr_surface.c:469-473`). "The original had no such exit" holds. The ioquake3 NaN drop is unverifiable here.
Source review: SRCQ3

### GAPCOMPAT-003
Verdict: confirmed
Corrected severity: High
Reason: `CL_GetSnapshot` prints a developer message and truncates to `MAX_ENTITIES_IN_SNAPSHOT` (`client/cl_cgame.c:151-154`).
Source review: SRCQ3

### GAPCOMPAT-009
Verdict: confirmed
Corrected severity: Low
Reason: Q3 part only: the one-second hold-off is at `game/g_utils.c:406`, with a forced second pass. Q2 half not settled here.
Source review: SRCQ3

### GAPCOMPAT-011
Verdict: confirmed
Corrected severity: Low
Reason: `Com_Memcpy( tr.refdef.text, fd->text, ... )` copies opaque bytes (`renderer/tr_scene.c:307`).
Source review: SRCQ3

### VM-004
Verdict: confirmed
Corrected severity: High
Reason: `CG_ERROR` and `G_ERROR` are ERR_DROP (`client/cl_cgame.c:422-423`, `server/sv_game.c:322-323`).
Source review: SRCQ3

### VM-005
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: `FS_CheckFilenameIsMutable` is absent from id's tree, so id has this exposure too. The port matches id here; the finding is a hardening gap, not a divergence.
Source review: SRCQ3

### VM-006
Verdict: confirmed-with-changes
Corrected severity: High
Reason: Reach is wider than the finding says. `FS_GetFileList` handles `$modlist` (`qcommon/files.c:2014-2015`). Stock q3_ui calls it from the Mods menu (`q3_ui/ui_mods.c:167`), and also from `UI_TeamArenaExists` (`q3_ui/ui_menu.c:238-246`), which `UI_MainMenu` (:269) calls at :368. Retail `pak8.pk3 vm/ui.qvm` contains the string. The port throws at `compat/qvm/file-syscalls.ts:211`, so activating the stock main menu rejects, not only opening Mods. I did not trace whether the port's startup ever activates `UIMENU_MAIN` on a QVM UI; `compat/qvm/ui.ts:11` maps it.
Source review: SRCQ3

### VM-008
Verdict: confirmed
Corrected severity: Medium
Reason: The JIT emits `shl`, `sar`, `shr` by `cl`, which x86 hardware masks to 5 bits (`qcommon/vm_x86.c:948-961`). The interpreter uses plain C shifts (`qcommon/vm_interpreted.c:830-840`).
Source review: SRCQ3

### VM-018
Verdict: confirmed
Corrected severity: Low
Reason: id's data size comes from the header and goes through `Hunk_Alloc` (`qcommon/vm.c:520-526`), which has a limit the port lacks.
Source review: SRCQ3

### NET-008
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: id has no rate limit either (`server/sv_main.c:307,520`), and `SVC_RateLimit` is absent from this tree. Hardening gap, not a divergence.
Source review: SRCQ3

### NET-015
Verdict: confirmed
Corrected severity: Medium
Reason: id takes the source address as the new server: `clc.serverAddress = from` with the proxy comment (`client/cl_main.c:1797-1799`). The port's comment is accurate, and the weakness is inherited.
Source review: SRCQ3

### GAPAPP-002
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: id also force-sets every systeminfo key through `Cvar_Set` (`client/cl_parse.c:363-374`, `qcommon/cvar.c:397`). The port's exclusion of `cl_allowdownload` is stricter than id. The real difference is per-frame reapplication, since id's function runs on systeminfo change. The ioquake3 flag filter is unverifiable here.
Source review: SRCQ3

### GAPAPP2-001
Verdict: confirmed
Corrected severity: High
Reason: The model is split at the first slash (`cgame/cg_players.c:974-981`), and id's file open filters only `..` and `::` (`qcommon/files.c:1054`), so an odd spelling is a miss, not a fault.
Source review: SRCQ3

### CORE-005
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Q3 part only: `Cbuf_AddText` prints "overflow" and discards (`qcommon/cmd.c:93-96`), so "the originals had undefined overflow" is false for Q3. Q1 and Q2 are not settled here.
Source review: SRCQ3

### CORE-019
Verdict: confirmed
Corrected severity: Info
Reason: Q3 part only: `Pmove` and `PmoveSingle` validate no command ranges (`game/bg_pmove.c:1836-2068`). The checks at `movement/q3/move.ts:509-512` are port additions.
Source review: SRCQ3

