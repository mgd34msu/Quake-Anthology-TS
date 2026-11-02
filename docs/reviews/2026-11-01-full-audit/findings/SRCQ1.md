# SRCQ1 — Q1/QW/QuakeC findings settled against the original source, plus direct port comparison

Paths: `up/` = `<scratchpad>/upstream/`; `RR` = `up/quake-rerelease-qc/quakec`; `V101` = `up/Quake-Tools/qcc/v101qc`; `WQ` = `up/Quake/WinQuake`; `QW` = `up/Quake/QW`. Port paths are at HEAD fcdc8af5, relative to the repository root, unless they start with `q1/`, which means `src/content/q1/`.

Nothing from `upstream/` was executed. One read-only parse of `qfiles/q1/id1/PAK0.PAK` progs.dat was run to settle CONTENT1-012. One component reproduction was run from `clean` (`<scratchpad>/srcq1/startsolid.test.ts`).

## Coverage
Original, read in full:
- WQ: sv_user.c 30-460, sv_phys.c 30-1340, sv_move.c.
- WQ, the functions cited here: world.c SV_HullForEntity, SV_ClipMoveToEntity, SV_ClipToLinks, SV_Move; pr_cmds.c PF_findradius, PF_checkclient, PF_objerror; pr_edict.c ED_Free; pr_exec.c load and return ops; host.c Host_Error and Host_FilterTime.
- QW/client/pmove.c, and QW/server/sv_user.c SV_RunCmd.
- RR: ai.qc 200-713, fight.qc 1-425, combat.qc 90-290, subs.qc SUB_AttackFinished.

Original, partly compared:
- RR monsters/rottweiler.qc and grunt.qc were read only for the leap, touch and check functions.
- RR weapons.qc was checked at the lines cited, by grep and reading. Other functions were compared from what I knew of the file, not line by line.
- RR monsters/*.qc pain, attack and frame functions were compared from what I knew of the files, not re-opened line by line, except zombie paine and tarbaby die. Treat agreement there as weaker evidence. The frame tables are not re-covered because TABLES already did them.

Port, read in full: src/movement/q1/{common,netquake,quakeworld,monsters,pusher,player-actions,water-transition}.ts, swept-body.ts, src/world/collision/q1/{hull,index}.ts, src/world/collision/index.ts #trace, simulation/physics.ts, simulation/actor-execution.ts (1-171), q1/base/{monsters,monster-actions,projectiles}.ts, q1/foundation/{monsters,weapons}.ts, entity-services.ts 395-530 and 672-712, world/gameplay/q1-aim.ts.

**Not compared:**
- Q3 and Q2 parts of shared findings: CONTENT1-020 and -021 (Q3), the Q2 half of SIM-017, GAPSIM-016 (Q2 entity text), all Q2 `GAPQ12*` and `source-check` IDs (other reviewers).
- RR client.qc beyond the sound lines and obituary; player.qc animation; items.qc other than T_Heal and health_touch; triggers.qc other than push and hurt; plats.qc, doors.qc and buttons.qc mover logic against foundation/movers.ts.
- Mission-pack and MG monster logic against their .qc, except the IDs settled below.
- WQ net and client protocol code beyond the cited lines.
- world/geometry/q1-solid (the derived-cell path has no original counterpart).
- The QuakeC host builtins as a whole; only findradius and movetogoal were read.
- `quakeWorld.read` / `readQuakeWorldState` was located but not read, which limits SRCQ1-008.

## Strengths
- netquake.ts, quakeworld.ts, movement/q1/monsters.ts, pusher.ts and hull.ts track sv_user.c, sv_phys.c, pmove.c, sv_move.c and world.c closely, including source quirks: the player SOLID_BSP test in SV_WalkMove, waterlevel = contents in SV_CheckWaterTransition, the 215 chase constant, the unsnapped NudgePosition base, and PM_AirAccelerate using `accelerate`. Apart from the items below I found no behavioral mismatch in them.
- q1/base/monster-actions.ts and the pain table agree with the QC as far as I compared them, and monsters.ts start() even preserves the unconditional `th_stand()` quirk after `th_walk()`.

## Verdicts

### CONTENT1-001
Verdict: confirmed
Corrected severity: High
Reason: RR ai.qc:305-310 sets `client = sight_entity` and returns TRUE early when `client.enemy == self.enemy`; visibility and range run against that monster (ai.qc:327-344), and only ai.qc:349-358 swaps to `client.enemy`. V101 has the same logic. q1/base/monsters.ts:137-138 and foundation/monsters.ts:56 start from `sightEntity.monster.enemy`.

### CONTENT1-002
Verdict: confirmed
Corrected severity: Medium
Reason: RR combat.qc:255-261 and V101 combat.qc:219 set `pain_finished = time + 5` after every `th_pain` on skill 3. q1/base/monsters.ts:290-335 has no such rule; foundation/monsters.ts:263 has it only for army.

### CONTENT1-003
Verdict: confirmed
Corrected severity: Medium
Reason: Port composition fault; no original counterpart, since horde exists only in RR quakec_mg1/horde.qc. The earlier reproduction stands. Not source-dependent.

### CONTENT1-004
Verdict: confirmed
Corrected severity: Medium
Reason: RR client.qc:1736-1738 prints `attacker.killstring`, set e.g. at monsters/grunt.qc:317 and misc.qc:199. Port writers use "killstring" (q1/base/monsters.ts:382) and the reader uses "kill_string" (composition/q1/runtime.ts:209).

### CONTENT1-005
Verdict: confirmed
Corrected severity: Medium
Reason: RR client.qc:1075-1077 (gasp), :1101 (outwater), :1135-1141 (inlava, inh2o, slimbrn2) run per frame in the live path. A grep for `.environment(` under src finds no caller.

### CONTENT1-006
Verdict: confirmed
Corrected severity: Medium
Reason: RR ai.qc:265-269 publishes sight_entity only when `self.enemy.classname == "player"`, and ai.qc:350-357 rejects non-player targets. foundation/monsters.ts:51 publishes unconditionally.

### CONTENT1-007
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: No interrupt exists in QC; ai_run alone handles a dead enemy (RR ai.qc:650-667), and zombie.qc:374-388 only sets or restores solid inside paine10/12. Correction: "only splash can hurt it" is a port-only effect, because PF_findradius skips SOLID_NOT (WQ pr_cmds.c:898); see SRCQ1-002. The interrupt also fires on notarget, which QC never checks for an existing enemy; see SRCQ1-005.

### CONTENT1-008
Verdict: confirmed
Corrected severity: Medium
Reason: Maintainability, port-only. The QC has one implementation path (RR monsters/grunt.qc, rottweiler.qc on ai.qc). SRCQ1-003, -004 and -005 are further drift in the second copy.

### CONTENT1-009
Verdict: confirmed
Corrected severity: Low
Reason: RR monsters/rottweiler.qc Dog_JumpTouch (lines 84-115) has the `!checkbottom && FL_ONGROUND` branch that restarts dog_leap1. foundation/monsters.ts:234-236 has only the grounded branch, and dog_leap9 loops on itself in QC too.

### CONTENT1-010
Verdict: refuted
Corrected severity: Info
Reason: Source-faithful. up/quake-rerelease-qc/quakec_ctf/teamplay.qc:1041-1044 prints `$qc_ks_blue_picked_up` in both the blue and red branches; no red string is used. q1/addons/ctf/flags.ts:53 matches.

### CONTENT1-011
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Painforward is confirmed (RR ai.qc:399 uses `ideal_yaw`; q1/base/monsters.ts:180 uses angles.y). HuntTarget on oldenemy is confirmed (ai.qc:654-658). The megahealth item is refuted: RR items.qc:187-188 and V101 items.qc:178-179 return at `health >= 250` before T_Heal, which matches foundation/pickups.ts:33.

### CONTENT1-012
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Classic has the bug: V101 misc.qc:197 and up/Quake/qw-qc/misc.qc both have `self.speed == 1000`, and id1 PAK0 progs misc_fireball has LOAD_F speed, NOT, IFNOT, then EQ_F with a discarded result. Rerelease fixed it (RR misc.qc:201-202 `self.speed = 1000`). So q1/base/map-entities.ts:164 is right for rerelease and wrong only for classic and QW editions.

### CONTENT1-013
Verdict: confirmed
Corrected severity: Low
Reason: RR triggers.qc:629-635 plays windfly with the fly_sound limiter; RR doors.qc:228-231 plays misc/talk.wav with the message. foundation/spawns.ts:125 only precaches, and foundation/movers.ts:131 only shows the message.

### CONTENT1-014
Verdict: confirmed
Corrected severity: Low
Reason: RR player.qc:179, :184 and :189 fire W_FireAxe from the axe frame functions, which player death frames replace. foundation/weapons.ts:215-226 checks neither health nor intermission. RR weapons.qc W_FireAxe has no guard because the frame chain provides one.

### CONTENT1-015
Verdict: confirmed
Corrected severity: Low
Reason: QC caches `self.goalentity` and `movetarget` at start (RR ai.qc:238, monsters.qc start functions). The port's q1/base/monsters.ts:149-152 re-finds on each call. Performance only; no behavior claim.

### CONTENT1-016
Verdict: confirmed
Corrected severity: Low
Reason: Port-only maintainability; not source-dependent.

### CONTENT1-017
Verdict: confirmed
Corrected severity: Low
Reason: Port-only dead code; not source-dependent.

### CONTENT1-018
Verdict: confirmed
Corrected severity: Low
Reason: RR monsters/chthon.qc:381-385 does `dprint` and return, while q1/base/provider.ts:124 throws. item_backpack has no spawn function in RR items.qc (:1429 only sets a classname at drop), so a map-placed one prints "No spawn function" and is freed (WQ pr_edict.c:966), whereas foundation/pickups.ts:92-98 accepts it and throws on a bad key.

### CONTENT1-019
Verdict: confirmed
Corrected severity: Low
Reason: Test gap; not source-dependent.

### CORE-001
Verdict: confirmed
Corrected severity: High
Reason: WQ world.c:843-844 and QW/server/world.c:746 skip a zero-size candidate when the mover has size. src/world/collision/index.ts #trace has no size test.

### CORE-002
Verdict: confirmed
Corrected severity: High
Reason: WQ world.c:147-153 selects by `size[0]` only. RR monsters/{grunt,knight,hellknight,enforcer,zombie,scrag,spawn}.qc use 32x32x64, rottweiler.qc:373 uses 64x64x64 and rotfish.qc:205 uses 32x32x48. None match src/world/collision/q1/index.ts:112 exact-dimension lookup, so all take the derived path.

### VM-002
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: WQ pr_exec.c:571-582 reads without a free check. Correction: fields are not "cleared". ED_Free (pr_edict.c:122-139) zeroes only model, takedamage, modelindex, colormap, skin, frame, origin, angles and solid, and sets nextthink to -1. `health`, `absmin` and others keep their last values, so the remediation's "return zeroed words" would also differ from id: `self.enemy.health` on a freed edict returns the old health.

### VM-007
Verdict: confirmed
Corrected severity: Medium
Reason: WQ pr_exec.c:639-642 copies a, a+1 and a+2 with no bound.

### VM-012
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: PF_WriteByte forwards verbatim (WQ pr_cmds.c:1539-1542), so split messages are legal. Correction: "client-side no-op" is wrong for the stock engine; an unknown TE hits `Sys_Error("CL_ParseTEnt: bad type")` (WQ cl_tent.c:291). The fatal-on-server behavior and the stuck buffer are still port faults.

### GAPCOMPAT-001
Verdict: confirmed
Corrected severity: High
Reason: The QC statements hold: RR triggers.qc:623-627 writes `other.velocity` when `health > 0`, and :592-595 calls T_Damage on any takedamage target. Foreign actors are a port feature with no original counterpart, so the throw is a port fault.

### GAPCOMPAT-002
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason:
- The throw and SV_MoveToGoal's lack of a check are right (WQ sv_move.c:402-424).
- The cited scenario is wrong. ThrowHead reuses self with `nextthink = -1` (RR player.qc:538-542, V101 player.qc:448), so heads are never freed. Barrel attackers are `self.enemy` (RR misc.qc:244).
- A real route: a tarbaby hits others with `T_RadiusDamage(self, self, ...)` (monsters/spawn.qc:185) and is freed by BecomeExplosion (RR weapons.qc:337). A patroller that became its enemy then calls movetogoal on a freed goal.
- Also, the freed goal is not fully zeroed: origin is, but absmin is not (pr_edict.c:133), and SV_CloseEnough reads absmin.

### GAPCOMPAT-007
Verdict: confirmed
Corrected severity: Medium
Reason: No engine rule forbids these patterns; T_Damage is plain QC (RR combat.qc:141-264). A grep of the whole rerelease QC tree finds no `attacker.health`, so no upstream program shows that example pattern; the risk stays with third-party mods.

### GAPCOMPAT-015
Verdict: confirmed
Corrected severity: Low
Reason: Port-only maintainability; not source-dependent.

### SIM-009
Verdict: confirmed
Corrected severity: Medium
Reason: QW/client/common.c:2029 limits keys and values to under 64 characters, :2038 and :2050 cap the total, and MAX_INFO_STRING is 196 (common.h:31). The port has none.

### SIM-010
Verdict: confirmed
Corrected severity: Medium
Reason: WQ host.c:505 caps at 72 Hz, host.c:60 sets sys_ticrate 0.05, and sys_linux.c:411-419 and sys_win.c:862 pace dedicated servers.

### SIM-017
Verdict: confirmed
Corrected severity: Low
Reason: Q1 half only. WQ SV_Physics_Toss makes one SV_PushEntity (sv_phys.c:1303), whereas physics.ts:719-734 retries and re-fires touch. The Q2 half was not compared here.

### T1-001
Verdict: confirmed
Corrected severity: High
Reason: QW/server/sv_user.c:1520-1527 runs PlayerPostThink in SV_PostRunCmd, and up/Quake/qw-qc/client.qc:1183 calls W_WeaponFrame from it, so skipping it stops all firing.

### GAPAPP-008
Verdict: confirmed
Corrected severity: High
Reason: WQ cl_parse.c:775 assigns `cl.mtime[0] = MSG_ReadFloat()` with no monotonic check. Original tolerance holds.

### GAPNET-001
Verdict: confirmed
Corrected severity: High
Reason: QW/client/cl_ents.c:327-374 counts only written entries (`newindex`), with no transient union. Even on overflow the original calls Host_EndGame, not process exit.

### NET-006
Verdict: confirmed-with-changes
Corrected severity: High
Reason: For Q1, the original QW has no msec budget either (sv_user.c:1380-1415 only chops and clamps), so "no budget" alone matches QW and is not a deviation. The real QW deviation is the command count: sv_user.c:1609-1610 returns on a second clc_move in a packet, while app/bootstrap/network/qw-server.ts:234-241 processes every decoded move. The Q2 half was not compared here.

### APP-001
Verdict: confirmed-with-changes
Corrected severity: High
Reason: A listen client recovers in Host_Error, but a dedicated server exits by design: WQ host.c:142 `Sys_Error ("Host_Error...")`, likewise Host_EndGame host.c:104. So "closes a dedicated server" on a QC error matches the original; the deviation for dedicated servers is the number of new throw paths, not the absence of recovery.

### PLATFORM-010
Verdict: confirmed
Corrected severity: Medium
Reason: WQ sound.h:130 sets MAX_CHANNELS 128, and SND_PickChannel returns NULL when none can be stolen (snd_dma.c:384-385).

### CORE-005
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The finding says the originals had undefined overflow here. For buffer overflow that is wrong: WQ cmd.c:92-96 prints "Cbuf_AddText: overflow" and drops. The over-long-line case was not checked.

### CORE-011
Verdict: confirmed
Corrected severity: Low
Reason: WQ cmd.c:641 and :184 re-insert alias text in an unbudgeted Cbuf_Execute loop, so the original also hangs as the finding states.

### TABLES-006
Verdict: confirmed
Corrected severity: Low
Reason: The cause is visible in the source. V101 knight.qc:50 lists `attackb1` twice and V101 oldone.qc:47 lists `shake12` twice, which shifts later frames by one. RR monsters/knight.qc:46 and shub.qc:50 removed the duplicates.

### GAPQ12-003
Verdict: confirmed
Corrected severity: High
Reason: WQ host_cmd.c:1528-1534 gates only on deathmatch, then switches on `t[0]`; empty or unknown arguments do nothing. The port throws.

### GAPQ12-006
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Source-faithful, not a port omission. quakec_mg3/weapons.qc:1571-1739 (100-105, 111-122, 219, 222, 223, 227, 228) and quakec_mg1/weapons.qc:1457 (219) are ungated in ImpulseCommands; the cheats_allowed test exists only in the cheat command (mg3 :1230, mg1 :1179). Remains a hardening option on a public server.

### GAPQ12-015
Verdict: confirmed
Corrected severity: Info
Reason: quakec_hipnotic/hipmisc.qc:219-223 calls `localcmd(self.message)`. Faithful.

### GAPQ12B-001
Verdict: confirmed
Corrected severity: High
Reason: quakec_rogue/combat.qc:184-185 runs RuneApplyBlack in deathmatch, and runes.qc:188-193 reads `who.rune` from an edict that persists, so no fault is possible. The port throw is a port fault.

### GAPQ12B-003
Verdict: confirmed
Corrected severity: Medium
Reason: Performance, port-only; QC keeps these as entity fields.

### GAPQ12B-006
Verdict: refuted
Corrected severity: Info
Reason: Source-faithful. quakec_rogue/teamplay.qc:1498 and :1523 both test `self.steam == flag1.team`, including in the flag2 branch, so q1/missionpacks/world/rogue-teams.ts:96 reproduces the source bug.

### GAPQ12B-007
Verdict: refuted
Corrected severity: Info
Reason: Source-faithful. quakec_mg1/horde.qc:1677-1681 returns 0 with no living players, and Countdown at :1792-1793 just returns with no reschedule. The port's q1/addons/horde/index.ts:39-41 matches.

### GAPQ12B-008
Verdict: refuted
Corrected severity: Info
Reason: Source-faithful. quakec_rogue/morph.qc:544-545 does `setorigin(theChild, ...); droptofloor();` with self still the parent.

### GAPQ12C-004
Verdict: confirmed
Corrected severity: High
Reason: Settled: the source uses degrees. `sin` is QC, not a builtin: quakec_mg1/math.qc:43-48 and quakec_mg3/math.qc:43-48 build `{0, angle, 0}` and return `v_forward_y` from makevectors (both in progs.src:26). func_bob.qc wraps count at 360. q1/addons/brushes.ts:13 passes degrees to radian `Math.sin`/`Math.cos`, so every func_bob jumps instead of bobbing on the many maps the finding lists.

### GAPQ12C-005
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: objerror does end in Host_Error (WQ pr_cmds.c:88-93) for hiptrain.qc:74, dragon.qc:840 and others. A listen client returns to console, but a dedicated server exits in the original too (host.c:142). `target_lightramp lost its light` (q1/addons/lights.ts:16) has no matching objerror: mg1 lights.qc:182-186 checks only in target_lightramp_init, and a later kill of the light just reads the freed edict in target_lightramp_tick (:140).

## New findings

### SRCQ1-001 — Q1 entities that start inside a solid never touch it, so point-blank rockets and monster missiles pass through targets
- **Verification (VERIFY-R): confirmed. Final severity: High.** Reran: monster at x=30 and x=24 give fraction 1, allSolid, hit actor, touches 0; x=44 gives touches 1. physics.ts:367 gates impact on `fraction !== 1`; WQ sv_phys.c:426 uses `if (trace.ent)`; netquake.ts:103 has it right. Scope note: for a player rocket (weapons.ts:201, +8 forward) on a 32-wide monster, the band is 32-39 units from the player, since 32 is contact. Enforcer laser (enforcer.qc:129) band against a player is 32-46.
- Severity: High
- Category: bug
- Location: src/app/bootstrap/simulation/physics.ts:367, :712
- Confidence: reproduced
- Evidence: WQ sv_phys.c:426 fires SV_Impact on `if (trace.ent)`, and world.c:799-800 sets `trace.ent` on `fraction < 1 || startsolid`. The port has `if (trace.fraction !== 1) { ... this.impact(actor, trace); }`. src/movement/q1/netquake.ts:103 gets this right using `trace.hit.kind !== "none"`. Reproduction (`srcq1/startsolid.test.ts`): a zero-size fly-missile at x=0, 1000 u/s, and a monster at x=30 with -16..16 bounds gave `fraction 1 startSolid true allSolid true hit actor touches 0`. With the monster at x=44 it gave `touches 1`.
- Impact: W_FireRocket starts 8 units forward (RR weapons.qc:424) and monsters clip missiles at +/-15 (world.c:943-946), so a rocket fired at any monster within about 39 units never explodes on it and flies through. This is the common melee-range rocket shot. Enforcer lasers (30 forward) and Hell Knight spikes (20 forward) likewise pass through an adjacent player. It affects native Q1, QuakeC and mod actors, since all use SharedPhysics for missiles. The original explodes on the first frame.
- Remediation: For the Q1 family, call impact when `trace.hit.kind !== "none"`, before the fraction check. Add this case to physics.test.ts.

### SRCQ1-002 — Native radius damage hits SOLID_NOT targets, so downed zombies can be gibbed by explosions
- **Verification (VERIFY-R): confirmed. Final severity: Medium.** entity-services.ts:455-462 checks only canTakeDamage and iterates ascending. WQ pr_cmds.c:898 skips SOLID_NOT and prepends to the chain, so highest slot first. spatial-host.ts:69 shows the QC host has the check; frames.ts:1114 is the zombie_paine10 row.
- Severity: Medium
- Category: bug
- Location: src/content/q1/foundation/entity-services.ts:457-465
- Confidence: traced
- Evidence: T_RadiusDamage iterates findradius (RR combat.qc:277), and PF_findradius has `if (ent->v.solid == SOLID_NOT) continue;` (WQ pr_cmds.c:898). The loop here checks only `canTakeDamage`. Zombie paine10 sets SOLID_NOT and keeps takedamage (RR monsters/zombie.qc:374-376), and the q1/base/frames.ts zombie_paine10 row sets solid none the same way. The QC host has the check (src/compat/qc/spatial-host.ts:69), so only TS Q1 is affected. Order also differs: findradius builds its chain in reverse, so the highest slot is damaged first (pr_cmds.c:905-906), while the port goes in ascending order.
- Impact: In the original a downed zombie is immune until it rises, which is how the monster is meant to be fought. In the port a rocket or grenade gibs it while it is down. Reversed order changes which target's death and RNG happen first.
- Remediation: Skip `solid === "none"` targets and iterate in descending source order.

### SRCQ1-003 — Dog leap switches to toss physics; QC keeps MOVETYPE_STEP
- **Verification (VERIFY-R): confirmed. Final severity: Low.** foundation/monsters.ts:161 sets `toss`. rottweiler.qc:365 is the only movetype assignment, and :185-186 only clear FL_ONGROUND. WQ sv_phys.c:1476-1490 is the step path with the dland2 sound.
- Severity: Low
- Category: bug
- Location: src/content/q1/foundation/monsters.ts:161, :235
- Confidence: traced
- Evidence: RR monsters/rottweiler.qc:176-187 only clears FL_ONGROUND and sets velocity; :365 is the only movetype assignment (STEP). The port sets `entity.movement = "toss"`. SV_Physics_Step uses SV_FlyMove, which sets FL_ONGROUND before SV_Impact (sv_phys.c:281-300) and plays demon/dland2.wav (:1488). Toss sets ground after impact and stops dead (sv_phys.c:1323, SV_Physics_Toss).
- Impact: Dogs land with no thud, do not slide along what they hit, and the touch callback sees different ground state. This is part of why CONTENT1-009's branch cannot simply be copied.
- Remediation: Keep `step`, as q1/base/monster-actions.ts jump() does for fiends.

### SRCQ1-004 — Classic Nightmare grunts and dogs keep attack delays the source removes
- **Verification (VERIFY-R): confirmed. Final severity: Low.** foundation/monsters.ts:49 and :85 write attackFinished unconditionally and have no edition check. V101 subs.qc:319 gates on `skill != 3`; RR subs.qc comments it out; q1/base/monsters.ts:223 honors the difference.
- Severity: Low
- Category: bug
- Location: src/content/q1/foundation/monsters.ts:49, :85
- Confidence: traced
- Evidence: V101 subs.qc:315-320 has `if (skill != 3) self.attack_finished = time + normal;`, while RR subs.qc:313 comments that out. BaseMonster honors this (q1/base/monsters.ts:223). Foundation always writes `monster.attackFinished = game.time + 1` and `+ 1 + random`.
- Impact: In the classic edition on Nightmare, grunts fire at normal cadence rather than with no delay, while every other monster follows the rule.
- Remediation: Share the edition-aware `attackFinished`.

### SRCQ1-005 — Awake monsters drop their enemy on notarget, and foundation AI has small further drifts
- **Verification (VERIFY-R): confirmed. Final severity: Low.** target.ts `monsterTargetEligible` includes `!notarget`, used at base/monsters.ts:66,:185 and foundation:108. RR ai.qc:650 tests health only, and :321 reads notarget in FindTarget. Drifts hold: foundation:62 origin distance vs ai.qc:174-175; retaliate writes oldEnemy before the attacker check vs combat.qc:241-246; `monster.enemy ?? attacker` vs combat.qc:102.
- Severity: Low
- Category: bug
- Location: src/content/monsters/target.ts (monsterTargetEligible); q1/base/monsters.ts:66, :185; q1/foundation/monsters.ts:62, :108, :239-243, :278
- Confidence: traced
- Evidence: RR ai.qc:650 tests only `self.enemy.health <= 0`; FL_NOTARGET is read only in FindTarget (:321) and monster_use. monsterTargetEligible includes `!notarget`, so toggling notarget makes chasing monsters forget. Foundation-only drifts:
  - Distance uses origin to origin, not view_ofs to view_ofs (ai.qc:174-177).
  - retaliate has no `attacker != world` test and writes oldEnemy before the `attacker != self.enemy` check (combat.qc:239-247).
  - The death activator is `monster.enemy ?? attacker`, where QC sets `self.enemy = attacker` first (combat.qc:102).
- Impact: Notarget behaves differently, and a monster's death targets can credit the old enemy instead of the killer in coop.
- Remediation: Remove notarget from the running check, and fold grunts and dogs into BaseMonster (CONTENT1-008).

### SRCQ1-006 — SV_SetIdealPitch integer steps became floats
- **Verification (VERIFY-R): confirmed. Final severity: Low.** WQ sv_user.c:60 declares `int step, dir, steps` and truncates at `step = z[j] - z[j-1]`. netquake.ts idealPitch keeps float step and direction, so sub-1-unit slopes count and dir is non-integral.
- Severity: Low
- Category: bug
- Location: src/movement/q1/netquake.ts:309-332 (`idealPitch`)
- Confidence: traced
- Evidence: WQ sv_user.c:60 declares `int step, dir, steps;`, so `step = z[j] - z[j-1]` truncates and `-dir * scale` uses an integer. The port keeps float `step` and `direction`. Slopes with under 1 unit per probe are ignored by C, but count here, and `dir` values differ (7.34 versus 7).
- Impact: Different auto-centered view pitch (lookspring) on ramps and shallow stairs.
- Remediation: Truncate `step` with toInt32 before the comparisons.

### SRCQ1-007 — Small weapon presentation and origin deviations
- **Verification (VERIFY-R): confirmed. Final severity: Low.** All four hold: weapons.ts:55 vs RR weapons.qc:262 with WQ world.c:433 absmin padding; weapons.ts:80 ZERO grenade angles vs :604; axe trace.end at :222-223 vs :65; the `velocity_z + 400` branch (:462) is absent from weapons.ts:139-146.
- Severity: Low
- Category: bug
- Location: src/content/q1/foundation/weapons.ts:55, :80, :222-223, :139-146
- Confidence: traced
- Evidence:
  - The bullet source uses `origin.z + min.z + size*0.7`, where QC uses `absmin_z` (RR weapons.qc:262), and SV_LinkEdict pads absmin by 1, so shots start 1 unit higher than the original.
  - Grenades launch with zero angles, where QC sets vectoangles (:604).
  - Axe blood and puff use `trace.end`, where QC uses `trace_endpos - v_forward*4` (:65).
  - LightningDamage's `velocity_z + 400` branch (:462) is absent. It needs `self` and stale `other` both players, so it rarely fires, and I did not establish how often in DM.
- Impact: Slight hit differences with grazing shots, and cosmetic differences.
- Remediation: Use linked absmin and apply the offsets.

### SRCQ1-008 — QW server move axes may use the previous command's angles
- **Verification (VERIFY-R): confirmed-with-changes. Final severity: Low.** QC path refuted: quakec-source.ts:1111 writes `v_angle` from the command in pre-think, and :1080 reads it back. Native path stands, now traced: players.ts:331 takes `body.angles`, :352 stores the previous command's angles, and quakeworld.ts:281-282 seeds only for prediction, against sv_user.c:1392,:1431. Reach is only worlds where runtime.ts:4092 supplies no `quakeWorld` host (native TS, mixed QC).
- Severity: Low
- Category: bug
- Location: src/movement/q1/quakeworld.ts:281-283; src/app/bootstrap/simulation/players.ts (readMovementState q1-quakeworld branch)
- Confidence: plausible
- Evidence: QW SV_RunCmd copies `ucmd->angles` to v_angle unless fixangle (sv_user.c:1392) and then `VectorCopy(v_angle, pmove.angles)` (:1431), so forward and right come from the current command. The port only seeds angles for `execution === "prediction"` and otherwise reads `state.angles`, which players.ts takes from `body.angles`. `quakeWorld.read` may correct this for the QC path; I did not read `readQuakeWorldState`. The native TS Q1 path with `--movement qw` has no such read.
- Impact: If true, server movement lags view turns by one command and disagrees with client prediction, causing small corrections while turning.
- Remediation: Compare a turning command in prediction and authoritative mode. If they differ, seed from `command.angles` when not fixangle.

### SRCQ1-009 — A Q1 entity resting on a removed entity falls; the original stays put
- **Verification (VERIFY-R): confirmed. Final severity: Low.** physics.ts:651 clears ground when the ground actor is not live, for every family. WQ sv_phys.c:1284-1285 returns on FL_ONGROUND without looking at groundentity.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/simulation/physics.ts:651
- Confidence: traced
- Evidence: `state.ground !== null && (!isLive(state.ground) || family !== "q1" && ...)` clears ground for all families. WQ SV_Physics_Toss (sv_phys.c:1284) returns on FL_ONGROUND regardless of groundentity, and SV_Physics_Step likewise never rechecks.
- Impact: Backpacks and items on a killtargeted brush fall in the port and hang in the air in the original. This is arguably an improvement, but it is undocumented.
- Remediation: Gate on family, or record it as a deliberate deviation.
