# SRCQ2 — Quake 2 and rerelease claims settled against original source; core ports compared to originals

HEAD fcdc8af5. Original paths: `Quake-2/...` and `quake2-rerelease-dll/{original,rerelease}/...` under `<scratchpad>/upstream/` (read only, nothing executed from it). Port paths are relative to the project root unless they start with `<scratchpad>`. Experiments ran from `<scratchpad>/clean`; scripts are in `<scratchpad>/srcq2/` (exp1.ts, exp2.ts, scan.py, scan2.py).

## Coverage
**Compared line by line, port against original:**
- src/movement/q2/classic.ts (668), swept.ts, view.ts, math.ts, dimensions.ts, index.ts (227), plus src/world/swept-body.ts by contract only, against Quake-2/qcommon/pmove.c (all 1360) and Quake-2/game/p_client.c PM_trace.
- src/movement/q2/rerelease.ts (960) against quake2-rerelease-dll/rerelease/p_move.cpp (lines 24-1708).
- src/world/collision/q2.ts (372), body.ts traceQ2Box, index.ts #trace and pointContents, contents.ts against Quake-2/qcommon/cmodel.c 560-1769 and Quake-2/server/sv_world.c (SV_Trace, SV_ClipMoveToEntities, SV_PointContents).
- src/compat/q2/classic/layout.ts (146), records.ts (170), pmove.ts (130) against Quake-2/game/game.h (all) and q_shared.h structs. Every offset was recomputed by hand.
- src/network/q2/message.ts (523), codecs/vanilla.ts (416), frames.ts (152), constants.ts against qcommon/common.c MSG_*, qcommon.h opcode and bit tables, client/cl_ents.c, server/sv_ents.c.
- src/content/q2/base/player/view.ts, environment.ts, index.ts 300-520 against p_view.c, p_hud.c G_SetStats, p_client.c.
- src/content/q2/base/entities/triggers.ts, targets.ts, foundation/targets.ts against g_trigger.c, g_target.c, g_func.c timer, g_utils.c G_UseTargets, G_SetMovedir.

**Sampled:**
- src/compat/q2/classic/host.ts 120-330 (imports and exports against sv_game.c PF_*).
- src/compat/q2/rerelease/layouts.ts and api.ts: entity_state_t, sv_entity_t, edict_shared_t and game_export_t order were checked against rerelease/game.h 1379-1412, 1753-1810, 2059-2149. pmove_t, player_state_t, gclient_t, the private prefix and the cgame tables were not line-checked.
- src/network/q2/server-messages.ts 1-140, temp-entities.ts (case list only), server-write.ts 1-125.
- src/content/q2/foundation/movers.ts, monsters/index.ts, ai.ts, soldier.ts, entity-services.ts 300-345, only around cited IDs.
- src/bots/behavior/rerelease/q2-exports.ts head against rerelease/bots/bot_exports.cpp head.

**Not compared (no claim either way):**
- src/content/q2/base/player/commands.ts, character.ts, spawns.ts remainder, obituary.ts, index.ts outside 300-520, against g_cmds.c, p_client.c remainder.
- src/content/q2/base/entities/movers.ts, scenery.ts, turrets.ts against g_func.c, g_misc.c, g_turret.c.
- src/content/q2/base/monsters/* and all move tables against m_*.c. TABLES compared these to DLLs. Only the rows cited below were opened in source.
- src/content/q2/foundation/weapons/*, items.ts against p_weapon.c, g_weapon.c, g_items.c, except the lines cited below.
- Q2 protocol variants: codecs/r1q2.ts, q2pro.ts, q2repro.ts, kexdemo.ts, kex-write.ts, mvd.ts, gtv.ts, channel.ts, handshake.ts (no original in the upstream tree except channel against net_chan.c, which was not done). server-messages.ts past line 140, client-messages.ts, server-write.ts past line 125, temp-entity field layouts against cl_tent.c.
- Client presentation against cl_view.c, cl_fx.c, cl_tent.c, cl_scrn.c, ref_gl, except lines cited.
- src/world/swept-body.ts was not read in full; duplicate-plane behavior was checked through the option values passed by rerelease.ts:182-186.

**Not settled by these sources (no verdict given):**
- GUEST-019: PE linker behavior, not game source.
- GUEST-016, GUEST-020: depend on the DLLs' statically linked CRT, which is not in the tree.
- BOTS-004, BOTS-007, BOTS-008, BOTS-011: the rerelease bot brain is not in the source. rerelease/bots/bot_think.cpp:11-23 has empty Bot_BeginFrame and Bot_EndFrame, and the AI lives in the closed engine, so the port's brain has no original to diff.
- GAPQ12-005, GAPQ12-012: LMCTF is not in the tree.
- CONTENT2-016: rerelease has no horde code (case-insensitive grep over rerelease/*.cpp and *.h finds none), so Q2Horde is a port feature.
- Out of this key's scope: source-check IDs GAPQ3-*, GAPQ3B-*, GAPBOTS-*, BOTS-001/013/014 (Q3 botlib), GAPCOMPAT-001/002/003, CORE-002, VM-*, CONTENT1-012, UI-*, NET-015, GAPMAT-001 and GAPAPP-006 concern Q1, Q3 or no game source, and were not settled here.

## Strengths
- src/movement/q2/classic.ts is a faithful port of pmove.c, including PM_InitialSnapPosition order, jitter order, the walking `velocity[2]` handling and the ladder clamps. The only mismatches found are in what its trace callback feeds it (SRCQ2-003, CORE-006).
- src/movement/q2/rerelease.ts matches p_move.cpp in every function, including the off-by-one `std::sort` end (p_move.cpp:146 at rerelease.ts:145), XY-only duplicate-plane nudge and the stair-clip trace.
- Classic layout, import order and export offsets all match game.h. Edict prefix 260, player_state_t 184, client prefix 188, pmove_t 240, trace_t 56, import table 176, export table 80.
- message.ts and vanilla.ts match common.c and cl_ents.c field for field, with all opcode and bit tables equal to qcommon.h.

## Verdicts

### CONTENT2-001
Verdict: confirmed
Corrected severity: High
Reason: The original saves functions by table, so it cannot fail here. p_client.c:108-117 and :137-162 set named think SP_CreateCoopSpots/SP_FixCoopSpots on `security` and the same 14 coop maps the port lists; the port's lambdas are the only divergence.

### CONTENT2-002
Verdict: confirmed
Corrected severity: Medium
Reason: m_hover.c:520-528 is a named hover_deadthink with its deadline in `self->timestamp` (:537). The port's closure and local deadline differ.

### CONTENT2-003
Verdict: confirmed
Corrected severity: High
Reason: g_weapon.c:47 requires `tr.ent->monsterinfo.dodge`. Only brain, chick, gunner, infantry, medic and soldier set it (m_brain.c:660, m_chick.c:666, m_gunner.c:616, m_infantry.c:595, m_medic.c:755, m_soldier.c:1223); tank, gladiator, berserk, mutant, supertank, makron and jorg set NULL, and floater and hover have it commented out. The port's fallback at foundation/monsters/index.ts:676-680 runs for all others.

### CONTENT2-004
Verdict: confirmed
Corrected severity: Medium
Reason: g_combat.c:508-514: `if (!(aiflags & AI_DUCKED) && take) { pain(...); if (skill == 3) pain_debounce_time = level.time + 5; }`. index.ts:157-163 has neither condition.

### CONTENT2-005
Verdict: confirmed
Corrected severity: Medium
Reason: g_func.c:1461-1471 has the non-living branch (100000 damage, then BecomeExplosion1) before the debounce and dmg checks. movers.ts:582-588 omits it.

### CONTENT2-006
Verdict: confirmed
Corrected severity: Low
Reason: SP_func_button (g_func.c:763) sets no `blocked` and no `dmg`. movers.ts:280 and :311 give buttons both.

### CONTENT2-007
Verdict: confirmed
Corrected severity: Low
Reason: m_soldier.c:1166 `self->s.skinnum |= 1` runs on every regular death. soldier.ts:162-165 has no equivalent for classic.

### CONTENT2-008
Verdict: confirmed
Corrected severity: Low
Reason: m_soldier.c:1152-1155: 3 sm_meat, 1 chest, head2. soldier.ts:155-157 throws 2 bone, 4 sm_meat, head2 in the classic branch.

### CONTENT2-009
Verdict: confirmed
Corrected severity: Low
Reason: g_monster.c:511-520 clears `self->item = NULL` after Drop_Item. index.ts:644-648 reads the spawn value each first death.

### CONTENT2-010
Verdict: confirmed
Corrected severity: Low
Reason: g_combat.c:105-109 has both the coop `resp.score++` and `targ->owner = attacker`. index.ts:637 has neither.

### CONTENT2-011
Verdict: confirmed
Corrected severity: Low
Reason: m_move.c:369-370 tests the raw `angles[YAW] - ideal_yaw` (also original/xatrix/m_move.c:381-382, original/rogue/m_move.c:631-634). Rerelease uses FacingIdeal instead. ai.ts:214 wraps for all editions, so it is wrong only for classic.

### CONTENT2-012
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: m_move.c:444 and original/rogue/m_move.c:709 are `(rand()&3)&1`; rerelease/m_move.cpp:1073 is `brandom()`. All are 1/2. ai.ts:233 gives 3/4 for every non-rogue rule, so rerelease without Rogue is also wrong, not only base.

### CONTENT2-013
Verdict: confirmed
Corrected severity: Low
Reason: g_trigger.c:338 and :346 play on `activator`; targets.ts:259 plays on self. g_target.c:178-180 is the mine3 hack. g_target.c:292 is the exit broadcast. Neither exists in the port.

### CONTENT2-014
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The original also never frees mynoise (p_weapon.c:78-95; ClientDisconnect at p_client.c:1504 does not touch it), but the pointers live on the reused client edict, so the count is bounded by 2 x maxclients. The port's per-actor pair grows with reconnects, which is the real difference. The "orphaned" wording alone would also describe the original.

### CONTENT2-015
Verdict: confirmed
Corrected severity: Low
Reason: rerelease/g_monster.cpp:847-853 gates on dodge_time and uses gi.BoxEdicts over absmin-512..absmax+512. The port's full entity scan has no original counterpart; the proposed remedy matches the source.

### CONTENT2-016
Verdict: confirmed
Corrected severity: Low
Reason: No source claim; port-only feature. See Coverage.

### CONTENT2-017
Verdict: confirmed
Corrected severity: Info
Reason: The source-data claims hold: m_boss2.c declares boss2_move_fidget at original/baseq2/m_boss2.c:213, m_actor.c:134 declares actor_move_run as run02-run07 and m_float.c:238 declares floater_move_activate as actvat01-31.

### CONTENT2-018
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The flyer part is faithful dead code, not a port defect: m_flyer.c:497 flyer_setstart has no table reference in the source either (only the prototype at :47), and `static int nextmove` (:33) is only written there. Keep or drop by choice. The ballistics, bodyOf and import claims have no source angle and stand.

### CONTENT2-019
Verdict: confirmed
Corrected severity: Low
Reason: No source claim.

### CORE-006
Verdict: confirmed
Corrected severity: Low
Reason: p_client.c:1537-1543 selects MASK_DEADSOLID when `pm_passent->health <= 0`. movement/q2/index.ts:134 is unconditional. cl_pred.c CL_PMTrace uses MASK_PLAYERSOLID, so prediction should keep it. Only the TS base path is affected; native DLLs call their own PM_trace through compat/q2/classic/pmove.ts.

### GAPQ12-001
Verdict: confirmed
Corrected severity: High
Reason: client/cl_parse.c:430-437 falls back to players/male when RegisterModel fails, and :445-461 falls back on skin. The original cannot exit here.

### GAPQ12-002
Verdict: confirmed
Corrected severity: High
Reason: original/xatrix/p_weapon.c:1636-1690 and original/rogue/p_weapon.c:615-668 decrement with no check. original/rogue/g_items.c:807-826 guards only `AMMO_GRENADES`. The original goes negative and never faults.

### GAPQ12-004
Verdict: confirmed
Corrected severity: Medium
Reason: original/ctf/g_ctf.c:3092 CTFJoinTeam is reached only through menu entries, and original/ctf/g_cmds.c:508-511 opens the join menu only for CTF_NOTEAM. No client command names a menu action.

### GAPQ12-008
Verdict: confirmed
Corrected severity: Low
Reason: original/xatrix/p_client.c:438-441 tests DF_QUADFIRE_DROP (q_shared.h:1017, 0x10000) with `quadfire_framenum > framenum + 10`, in classic. composition/q2/index.ts:161-162 gates it on rerelease.

### GAPQ12-009
Verdict: confirmed
Corrected severity: Low
Reason: original/rogue/g_sphere.c:359-363 and :462-465 assign `wait = time + 15` in the doppleganger branch, shortening from 30. spheres.ts:122,130 use Math.max.

### GAPQ12-010
Verdict: confirmed
Corrected severity: Low
Reason: rerelease/p_client.cpp:3731-3736 copies once and sets resp.spectator; :1626 skips the copy while it is set; :2250 clears it inside PutClientInServer, after respawn's test. The port clears before calling respawn.

### GAPQ12-011
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The buffer is 256 bytes, not 1024: original/ctf/g_ctf.c:2462 and rerelease/ctf/g_ctf.cpp:2136. So the original also truncates team chat at 254 bytes where the port keeps 1023. The loop stops only when output fills, so expansion cost is bounded by that limit, tighter than the finding states.

### GAPQ12-013
Verdict: confirmed
Corrected severity: Low
Reason: No source claim.

### GAPQ12-014
Verdict: refuted
Corrected severity: Info
Reason: original/rogue/dm_ball.c:439 has `//	self->s.modelindex = 0;` commented out in DBall_BallDie, and the ball stays drawn while non-solid. The port is faithful. The inference that C cleared the model was wrong.

### GAPQ12B-004
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: original/xatrix/m_fixbot.c:724-736 and :1066-1076 dereference goalentity unchecked. A freed edict is stale but valid, as claimed, so the port's throw is stricter there. However the source also sets goalentity to NULL (:319, :341, :511), where C crashes, so the fallback should cover that case, too.

### GAPQ12B-005
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The recollection is wrong in detail: rerelease/g_monster.cpp:705-713 has no max(0, ...). It refunds only after gibbing (`health <= gib_health`, comment at :704) and then clears commander. The port refunds on first death, before any revive, at foundation/monsters/index.ts:633. That is the real defect, and it can drive monsterUsed negative as described. The remedy should be refund on gib and clear, not clamp.

### GAPQ12C-002
Verdict: confirmed
Corrected severity: High
Reason: original/xatrix/g_monster.c:78-142 and :145-180: RF_BEAM entity, dabeam_hit sets `think = G_FreeEdict` at +0.1 s, so the beam ends with the entity. Callers m_brain.c:644,660, m_fixbot.c:959, m_soldier.c:1688 all use it. The "from memory" lifetime is now proven.

### GAPQ12C-003
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The bolt half is proven: rerelease/m_shambler.cpp:306-311 is a one-shot TE_LIGHTNING multicast. The windup half is faithful: PAIN at :195-227 does not free self->beam, and shambler_windup at :70-76 overwrites it, so C orphans the same beam entity. Only die frees it (:510-519). Remove that half or treat it as a deliberate fix.

### GAPQ12C-006
Verdict: confirmed
Corrected severity: Low
Reason: rerelease/g_monster.cpp:398 clears `s.sound` each frame and :405-407 apply weapon_sound only with `health > 0`. gladiator.ts:44-55 sends no stop. Confidence upgrades from plausible to traced.

### GAPQ12C-008
Verdict: confirmed
Corrected severity: Info
Reason: No source claim.

### GAPCOMPAT-LAYOUTS
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: Strength claim. Classic edict_t, trace_t, pmove_t, player_state_t, game_import_t and game_export_t are proven by recomputation against game.h:68-254 and q_shared.h. Rerelease entity_state_t, sv_entity_t, edict_shared_t and game_export_t order (game.h:1379-1412, 1753-1810, 2059-2149) agree. Remaining API2023 records were not line-checked here. TAB2's "from memory" caveat on layout.ts is closed.

### GAPCOMPAT-009
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: g_utils.c:430 requires `freetime < 2 || time - freetime > 0.5`, so the hold-off is real after the first 2 s of level time and absent before. :438 confirms gi.error. Q3's 1 s value was not checked here.

### GAPCOMPAT-010
Verdict: confirmed
Corrected severity: Low
Reason: g_cmds.c:34-37 returns the whole skin when there is no `/`. combat-binding.ts:94 yields empty for DF_SKINTEAMS. The model branch is correct.

### GUEST-010
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The throw stands. The retail DLL sources show no client-derived format: baseq2, ctf, rogue and xatrix pass only fixed godmode and notarget strings (g_cmds.c:324,353,385 and siblings). The one exception is map text, original/rogue/g_newfnc.c:149 `gi.centerprintf(other, self->message)`, so a `%` in a Rogue map message hits this. The remote trigger applies to third-party DLLs only. All conversions in those sources pass the regex.

### GUEST-STRENGTH-FPCW
Verdict: refuted
Corrected severity: Medium
Reason: Strength claim that 0x37f matches Sys_SetFPCW. win32/rw_imp.c:417-450 only derives masks for ref_soft. win32/sys_win.c:655 runs `_controlfp(_PC_24, _MCW_PC)` before every Qcommon_Frame. See SRCQ2-006.

### TABLES-002
Verdict: confirmed
Corrected severity: Medium
Reason: original/rogue/m_boss2.c:302-303, :329-330 (10, comment "normally all 8's"), :355-356, :372-373, :394-395 (2) and :407 (-5, comment "was -20"). The source explains the DLL data.

### TABLES-005
Verdict: confirmed
Corrected severity: Low
Reason: original/baseq2/g_items.c:1413 has world_model_flags 0 for ammo_grenades. items.ts:46 has `rotate: true`.

### TABLES-007
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: The Xatrix source agrees with the port: original/xatrix/m_flash.c:132-133 has row 57 as 24.8 and :227-228 has row 98 as 31.5*1.2, 9.6*1.2, 10.1*1.2, with the old values commented out. The difference exists only against the 1998 corpus DLL, which predates that fix. Whether to match that build is a choice, not a defect.

### TABLES-009
Verdict: refuted
Corrected severity: Info
Reason: ref_gl/gl_mesh.c:764-770 and :385-390 reset out-of-range frames to 0. prepare.ts:46-47 does the same for q2-md2, as VERIFY already found. Source-side detail: gl_mesh.c:773-778 resets `frame`, not `oldframe`, on a bad oldframe, but R_CullAliasModel at :391-395 has already cleared oldframe.

### GAPAPP-005
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Missing is proven: ref_gl/gl_model.c:231 errors only with `crash`, and gl_rmain.c:336-340 draws R_DrawNullModel. "Malformed" is wrong for the original: bad versions call ri.Sys_Error(ERR_DROP) (gl_model.c:863), so the original drops to console rather than drawing nothing.

### GAPAPP-014
Verdict: confirmed
Corrected severity: Low
Reason: The beam is a plain RF_BEAM entity (g_target.c:591; cl_ents.c:927), so it stops on G_FreeEdict.

### GAPAPP2-005
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The sound half is proven: cl_parse.c:634 returns on an empty precache slot. The flash half is wrong about the original: cl_fx.c:446-448 indexes monster_flash_offset with no bounds check, reading out of bounds rather than ignoring the value. Dropping it is still right, but it is not parity.

### GAPSIM-001
Verdict: confirmed
Corrected severity: Critical
Reason: server/sv_main.c:296-297 truncates with strncpy into MAX_INFO_STRING before ClientConnect (:385).

### SIM-017
Verdict: confirmed
Corrected severity: Low
Reason: g_phys.c:713 pushes once per SV_Physics_Toss. g_monster.c:175-178 M_CheckGround copies endpos and zeroes velocity[2].

### APP-011
Verdict: confirmed
Corrected severity: Medium
Reason: server/sv_main.c:741-746 "never get more than one tic behind" clamps svs.realtime to sv.time.

### DOCS3-006
Verdict: confirmed
Corrected severity: Low
Reason: p_client.c:959 `body->s = ent->s`, and cl_ents.c:936 maps modelindex 255 through clientinfo. Only the source half is settled; the TS run was not performed.

### NET-010
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The 15 bits, absent expiry and capacity eviction are original: sv_main.c:235-252 `rand() & 0x7fff` with oldest-slot replacement, and :322 replies "Bad challenge". This is inherited weakness, not a port regression. The hardening advice stands.

### NET-017
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Plain strcmp with no throttle is original (sv_main.c Rcon_Validate). Inherited, not a regression.

### T2C-007
Verdict: confirmed
Corrected severity: Low
Reason: sv_ccmds.c:657-659 forbids deathmatch saves. original/ctf/p_client.c:1190 calls KillBox. The test comment is accurate about the source.

## New findings

### SRCQ2-001 — Toggling a func_areaportal whose portal has no lump entry throws, on retail base and Xatrix maps
- **Verification (VERIFY-R): confirmed. Final severity: High.** Reran exp2.ts on retail data: train.bsp lump lacks portal 1, style 1 is targeted by func_door *69 and *70, and setAreaPortalState throws; xsewer2 style 3 likewise. q2.ts:295-297 vs cmodel.c:1655, which rejects only `> numareaportals`. xsewer2's trigger_always has spawnflags 1792 (not easy, medium or hard), so it is deathmatch-only, as stated. No guard at runtime.ts:2752 or movers.ts:197. Door-to-exit is traced, not run.
- Severity: High
- Category: bug
- Location: src/world/collision/q2.ts:295-297; src/world/collision/index.ts:118-123; src/app/bootstrap/simulation/runtime.ts:2752; src/content/q2/foundation/movers.ts:197; src/content/q2/foundation/targets.ts:325; src/compat/q2/classic/host.ts:358
- Confidence: reproduced for the throw on retail geometry (`srcq2/exp2.ts`); door-to-throw path traced, not run through the full simulation
- Evidence: `if (!this.geometry.areaPortals.some(value => value.portal === portal)) throw new RangeError(\`Unknown Q2 area portal ${portal}\`)`. The original only rejects numbers above the count: cmodel.c:1655 `if (portalnum > numareaportals) Com_Error`, then `portalopen[portalnum] = open`. Unlisted portals are legal and inert. `scan2.py` found 10 of 1161 retail func_areaportal entities with a style missing from the lump. Output of exp2.ts: `maps/train.bsp areaPortals [0,4,5,4,2,3,5,2,3]`, portal entity `style 1 targetname t432`, targeted by two `func_door` (`*69`, `*70`), `setAreaPortalState THROWS: RangeError: Unknown Q2 area portal 1`. Also `xatrix/maps/xsewer2.bsp` style 3 (t135, targeted by func_door `*34` and, in deathmatch, a trigger_always), and LMCTF xmap06, xmap12, lmctf18. runtime.ts:2752 has no guard: `setAreaPortal: (portal, open) => { this.areaPortals.set(portal, open); this.scene.setAreaPortalState(portal, open); ...`. Native DLLs reach it too through host.ts:358.
- Impact: In the shipped campaign map `train`, using either door exits the process per APP-001, for TS and native classic worlds alike. Xatrix `xsewer2` has the same fault, and its deathmatch trigger_always fires it at map start.
- Remediation: Accept any portal number in range of the source's count check and keep it in `#openPortals`. Report out-of-range numbers as a map error instead of a process exit.

### SRCQ2-002 — Any Q2 point trace hits corpses regardless of mask, so corpses block sight and splash damage
- **Verification (VERIFY-R): confirmed-with-changes. Final severity: Medium.** Mechanism reproduced (exp1: MASK_OPAQUE and MASK_SOLID point traces hit the corpse), index.ts:176-181,:200 vs sv_world.c:547-549. Impact is overstated, and exp1's corpse box is live-sized (max z 32). Real corpses are short: common.ts:60 and m_soldier.c:887 use max z -8, 16 units above the floor, so eye-to-eye lines on level ground (about 46+ above floor) pass over them. Sight loss needs ledge or stair geometry or a tall corpse (m_supertank.c:586). CanDamage from floor-level explosions (entity-services.ts:367-378) is the likely real effect.
- Severity: High
- Category: bug
- Location: src/world/collision/index.ts:176-181, :200; src/world/collision/body.ts:65-81; callers src/content/q2/foundation/monsters/ai.ts:49 (`visible`, MASK_OPAQUE), entity-services.ts:367-378 (`canDamage`), monsters/perception.ts:33; src/compat/q2/classic/host.ts:379
- Confidence: reproduced at the scene level (`srcq2/exp1.ts`); gameplay consequence traced
- Evidence: `const corpsePoint = corpse && pointLike;` then `if (!corpsePoint && (... (actorContents(collision, query.policy.kind) & query.policy.contentsMask) === 0)) continue;`, and traceQ2Box has no mask test. The original skips them: sv_world.c:547-549 `if (!(clip->contentmask & CONTENTS_DEADMONSTER) && (touch->svflags & SVF_DEADMONSTER)) continue;`. exp1.ts on a corpse between start and end: `corpse point trace MASK_OPAQUE fraction 0.2799 hit actor`, `MASK_SOLID fraction 0.2799 hit actor`, while `corpse box trace MASK_OPAQUE fraction 1 hit none`. The original's visible() uses MASK_OPAQUE (g_ai.c:297), CanDamage uses MASK_SOLID (g_combat.c:42-57) and the M_CheckAttack line check omits DEADMONSTER (g_ai.c:621). The code comment states the purpose: foreign corpses must be gibbable. That purpose is already met for Q2 by MASK_SHOT containing DEADMONSTER.
- Impact: In Q2 worlds, including native DLLs, a corpse between a monster and a player makes visible() false, so monsters lose sight and stop attacking through corpses. Radius damage does not reach targets shielded only by a corpse, and player-trail sight tests are affected the same way. Corpses accumulate in normal play, so this changes combat throughout a level.
- Remediation: Apply the corpse exception only when the query's family differs from the corpse's family, or only when the mask includes the corpse bit, and keep sv_world.c's skip for same-family queries.

### SRCQ2-003 — A box actor returns a null surface, so standing on a monster, player or box entity has no ground friction
- **Verification (VERIFY-R): confirmed. Final severity: Medium.** Reran exp1: world floor 200 to 31, monster-box floor stays 200. body.ts:80 `surface: null`; classic.ts:116 and rerelease.ts:314 need a truthy surface; cmodel.c:740 and :1363 guarantee nullsurface. p_move.cpp:564 has the same test.
- Severity: Medium
- Category: bug
- Location: src/world/collision/body.ts:80 (`surface: null`); src/world/collision/q2.ts:163,198; src/movement/q2/index.ts:26; src/movement/q2/classic.ts:116; src/movement/q2/rerelease.ts:314
- Confidence: reproduced (`srcq2/exp1.ts`)
- Evidence: The original never returns NULL: cmodel.c:1363 defaults `trace.surface = &nullsurface.c`, and cmodel.c:740 gives box-hull sides `&nullsurface`, so `pml.groundsurface` is non-null with flags 0 and friction applies (pmove.c:365). The port's PM_Friction requires a truthy surface. exp1.ts with velocity 200 after 15 16 ms frames: `world-floor velocity x 31`, `monster-box-floor velocity x 200`. The same null arises for a startsolid world trace (q2.ts:163). contents.ts already notes "Q2 ground friction requires a surface" for foreign geometry, but the native box path was missed.
- Impact: Players slide without friction on top of monsters, other players and exploboxes, in classic and rerelease TS movement. Native classic worlds lose it too: compat/q2/classic/host.ts traceBytes leaves the surface pointer 0 when `trace.surface` is null, and compat/q2/classic/pmove.ts:97-100 reads that back as a null surface. The original's DLLs always receive a non-null pointer on server traces. See SRCQ2-017 for the crash this causes.
- Remediation: Return a shared empty surface from traceQ2Box and for Q2 traces with no brush surface, matching nullsurface.

### SRCQ2-004 — Entity startsolid does not replace the trace, and world fraction 0 does not stop entity clipping
- **Verification (VERIFY-R): confirmed. Final severity: Low.** Reran exp1: start in monster with wall at x=50 gives fraction 0.1666, hit world. index.ts:218-221 vs sv_world.c:566-577; sv_world.c has the world `fraction == 0` return and index.ts:160 does not. pmove.c:698 is the ground rule cited.
- Severity: Low
- Category: bug
- Location: src/world/collision/index.ts:160, :218-221
- Confidence: reproduced for the results (`srcq2/exp1.ts`); rule traced
- Evidence: sv_world.c:566-577: `if (trace.allsolid || trace.startsolid || trace.fraction < clip->trace.fraction) { trace.ent = touch; ... clip->trace = trace; ...}`, so starting inside a box actor replaces the result, even with a nearer world hit. sv_world.c:638 returns at world `fraction == 0`. Port: `else if (hit.allSolid || hit.fraction < result.fraction || query.policy.kind === 'q1' && hit.startSolid) ... else if (hit.startSolid) result = { ...result, startSolid: true };`, and line 160 returns early only for allSolid or Q3. exp1.ts: starting in a monster with a wall at x=50 gives `fraction 0.1666 startSolid true hit "world"`. The original gives fraction 1, ent monster. The comment at index.ts:217 describes Q3's rule.
- Impact: Movement overlapping another actor differs. In PM_CatagorizePosition, the original's `trace.ent` is the overlapped actor with startsolid, which counts as ground (pmove.c:698). The port can see no entity and call it airborne when no world hit exists. Rare outside telefrag-free overlap and spawn stacking.
- Remediation: Use the sv_world.c rule for Q2 policies and return at world fraction 0. If the current behavior is kept as safer, record it as a deliberate divergence.

### SRCQ2-005 — Classic traces use q2repro clip rules: clamped enter fraction, and game traces use the rerelease "merged" policy
- **Verification (VERIFY-R): confirmed. Final severity: Medium.** q2.ts:195 clamps before comparing, vs cmodel.c:1061-1067,:1084-1089. I checked exp1's transcription against that code; it is faithful, and 44932 of 400000 differ. Those traces are adversarial, so this is not a field rate; a difference needs raw f <= -1, meaning a start inside epsilon and an inward move smaller than the remaining margin. Merged policy confirmed at source-hosts.ts:54,:59,:62 and physics.ts:294, with q2.ts:212-215 vs cmodel.c:1077-1082 and :926.
- Severity: Medium
- Category: bug
- Location: src/world/collision/q2.ts:195; src/world/collision/body.ts:63, :76; src/app/bootstrap/simulation/source-hosts.ts:54, :59, :62; src/app/bootstrap/simulation/physics.ts:294
- Confidence: reproduced for the clip rule (`srcq2/exp1.ts`, differential against a cmodel.c transcription, float32, adversarial grazing traces on one cube); traced for the policy
- Evidence: q2.ts:195 `const f = Math.max(0, n.divide(n.subtract(d1, epsilon), n.subtract(d1, d2)));`. cmodel.c:1061-1067 compares the raw value, and :1084-1089 requires `enterfrac > -1` and clamps only after selection. Result: a start within epsilon moving almost parallel gets raw f <= -1, which is no hit in the original and fraction 0 in the port, and when two planes clamp to 0 the first wins, not the largest raw f. exp1.ts: of 400000 grazing traces, 44932 differ on hit or no hit and 38439 differ on plane. Example start x 64.0166 end x 64.0094 on a face at 64: cmodel 1, port 0. Movement passes `stored` for classic (movement/q2/index.ts:35), but f is unconditional. Separately, content and physics always pass `leafContents: "merged"` even for classic worlds, so allsolid sweeps return fraction 0 (q2.ts:212-215; the original leaves fraction 1, cmodel.c:1077-1082), leaf early-out uses merged contents, and pointContents returns merged (source-hosts.ts:62; the original returns stored, cmodel.c:926). Also a refutation of the CORE strength "matches source including epsilon handling" for Q2.
- Impact: Classic movement on non-axial surfaces, where snapped origins fall inside the epsilon, can stop or pick a different plane from the original. Axial walls are not affected because origins sit on a 1/8 grid. Classic content traces from inside solids report differently, for example visible() from inside a brush.
- Remediation: Gate the clamp on the merged policy and keep raw f for stored. Pass `stored` from source-hosts and physics when the edition is classic.

### SRCQ2-006 — Guest x87 starts at 64-bit precision; retail Windows game code runs at 24-bit
- **Verification (VERIFY-R): confirmed-with-changes. Final severity: Low.** x87.ts:69 is 0x37f, resultFormat at :74-76 honors precision control, and sys_win.c:655 sets _PC_24 each frame. Severity lowered: the stated effect is low-bit differences that rarely affect play, and 24-bit is Windows-specific. baseq2.dis has no `fninit`, but its `fldcw` sites were not traced, so the CRT caveat remains.
- Severity: Medium
- Category: bug
- Location: src/guest/floating-point/x87.ts:69
- Confidence: traced for the original's control word and the port's default; effect on specific results not measured. Other writers of the control word in the classic guest setup were not exhaustively excluded beyond the grep for 0x37f, 0x27f and 0x07f
- Evidence: `state.controlWord = 0x37f`. win32/sys_win.c:655 `_controlfp( _PC_24, _MCW_PC );` immediately before `Qcommon_Frame (time);` each frame, so RunFrame, ClientThink and Pmove-adjacent DLL code ran with single-precision x87 rounding on the retail Windows build. A grep of Quake-2/game and quake2-rerelease-dll/original finds no _controlfp, _fpreset or fldcw, so the DLL source does not change it; its CRT was not inspected. contracts/numeric.ts:5 already models `precisionBits: 24 | 53 | 64`. Round-1 GUEST's strength relied on Sys_SetFPCW, which only computes rounding-mode masks for ref_soft (win32/rw_imp.c:444 onward).
- Impact: Chained x87 expressions in a classic DLL, such as DotProduct results and vector math before a store, keep more precision than the shipped game. Results can differ in low bits, which matters for replay comparison and marginal float comparisons, but rarely for play.
- Remediation: Initialize classic guest calls to 0x07f, after checking the DLL's CRT startup behavior under the emulator, and add a differential check with a captured retail trace.

### SRCQ2-007 — trigger_push with angle 0 launches along +X in classic; the original has a zero direction
- **Verification (VERIFY-R): confirmed. Final severity: Medium.** triggers.ts:21 is unconditional and fields.ts:73-75 yields +X for zero angles. g_trigger.c:25-26 leaves movedir zero; rerelease g_trigger.cpp:16-17 keys on `angle`. My dump of retail city1 shows *36 (speed 150) and *56 (speed 200) with angle 0 and spawnflags 2048. Reachability in play was not checked.
- Severity: Medium
- Category: bug
- Location: src/content/q2/base/entities/triggers.ts:21
- Confidence: traced; retail data confirmed by scan (`srcq2/scan.py`, `scan2.py`). The map location's reachability in play was not checked
- Evidence: `entity.visible = false; entity.movedir = movedir(game.body(entity).angles);` is unconditional, and foundation/fields.ts:73 returns +X for zero angles. The original: g_trigger.c:25-26 `if (!VectorCompare (self->s.angles, vec3_origin)) G_SetMovedir(...)`, so movedir stays zero and trigger_push_touch sets velocity to zero. SP_trigger_monsterjump's `angles[YAW] = 360` hack exists for this reason, and the port kept that. The rerelease differs deliberately: rerelease/g_trigger.cpp:16-17 also sets the direction when `angle` was specified. Retail: baseq2 `maps/city1.bsp` has two (`*36` speed 150, `*56` speed 200, `angle 0`, spawnflags 2048).
- Impact: In classic city1, these brushes stop the player in the original and throw the player east at 1500-2000 units/s here. Rerelease with key absent has the same defect in the other direction, a push where the source has none.
- Remediation: Set movedir only when angles are nonzero for classic, and when the key was specified or angles are nonzero for rerelease.

### SRCQ2-008 — G_UseTargets always plays talk1, ignoring noise_index
- **Verification (VERIFY-R): confirmed. Final severity: Low.** entity-services.ts:322-325 hardcodes talk1, vs g_utils.c:203-206. targets.ts triggerMultiple has no `sounds` handling, vs g_trigger.c:120-125. targets.ts:303 plays the noise only on self.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/entity-services.ts:322-325; src/content/q2/foundation/targets.ts:21-34
- Confidence: traced
- Evidence: g_utils.c:203-206: `if (ent->noise_index) gi.sound (activator, CHAN_AUTO, ent->noise_index, ...); else ... talk1`. The port emits `misc/talk1.wav` unconditionally. SP_trigger_multiple's sounds table (g_trigger.c, secret, talk, trigger1) is not ported: targets.ts triggerMultiple never reads `sounds`. target_secret and target_goal set noise_index from `noise` (g_target.c:154-180).
- Impact: Every secret with a message plays talk1 where the original plays secret.wav on the activator, and authored `sounds` on trigger_once or trigger_multiple are silent or wrong (retail use: rerelease e3/lab_e3, lmctf06, lmctf25).
- Remediation: Carry a noise path on the source entity, set it from `noise` and `sounds`, and use it in useTargets.

### SRCQ2-009 — Classic has no help-computer beep or help icon
- **Verification (VERIFY-R): confirmed. Final severity: Low.** Grep of all `src` outside content/q2/rerelease finds no `pc_up` or `i_help`. targets.ts:299 only emits a help event, vs p_view.c:825-830 and p_hud.c:514-515.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/targets.ts:299 (`use_target_help`); src/content/q2/base/player/view.ts; only src/content/q2/rerelease/goals.ts:101 plays it
- Confidence: traced by grep over content/q2/base and foundation (`pc_up`, `helpchanged`, `i_help`, no hits there)
- Evidence: p_view.c:825-830 beeps `misc/pc_up.wav` up to three times when `pers.helpchanged` is set, and p_hud.c:514-515 sets STAT_HELPICON `i_help`. g_target.c use_target_help increments game.helpchanged.
- Impact: Classic TS campaigns give no notice that the objective changed.
- Remediation: Port the counter, beep and icon for the classic edition.

### SRCQ2-010 — Single-player death and intermission set STAT_LAYOUTS bit 1, which the original sets only in deathmatch
- **Verification (VERIFY-R): confirmed. Final severity: Low.** view.ts:117 has no deathmatch branch, vs p_hud.c:488-504, and network.ts:226 sends it as stat 13.
- Severity: Low
- Category: bug
- Location: src/content/q2/base/player/view.ts:117
- Confidence: traced; not seen on screen
- Evidence: p_hud.c:488-504: deathmatch uses `health <= 0 || intermissiontime || showscores`; otherwise only `showscores || showhelp`. Port: `layouts: (state.showScores || state.showHelp || health <= 0 || intermission ? 1 : 0) | ...` for all modes.
- Impact: A dead single-player or coop client draws its last layout string, such as the help computer, over the view.
- Remediation: Branch on deathmatch as the source does.

### SRCQ2-011 — View kick has no 50 ceiling once count exceeds 100
- **Verification (VERIFY-R): confirmed. Final severity: Low.** view.ts:6 clamp lets the floor win and :44 passes `count * 0.5, 50`; p_view.c:177-180 applies the ceiling last. Count 200 gives 100 against 50.
- Severity: Low
- Category: bug
- Location: src/content/q2/base/player/view.ts:44, :6
- Confidence: traced
- Evidence: p_view.c:177-180: `if (kick < count*0.5) kick = count*0.5; if (kick > 50) kick = 50;`, where the ceiling runs last. Port: `clamp(value, count * 0.5, 50)` with `clamp = Math.max(minimum, Math.min(maximum, value))`, so the floor wins. With count 200 the port gives 100.
- Impact: A surviving player taking over 100 points in a frame gets up to double the view roll and pitch kick. Cosmetic.
- Remediation: Apply the two limits in source order.

### SRCQ2-012 — trigger_monsterjump tests the wrong server flag for dead monsters
- **Verification (VERIFY-R): confirmed. Final severity: Low.** triggers.ts:86 tests bit 8; g_trigger.c:570 tests SVF_DEADMONSTER, bit 2 (actor-execution.ts:73, rerelease/triggers.ts:130). runtime.ts:2634 isMonster reads only bit 4, so it does not filter corpses first.
- Severity: Low
- Category: bug
- Location: src/content/q2/base/entities/triggers.ts:86
- Confidence: traced
- Evidence: `(other.serverFlags & 8) !== 0`. The source tests SVF_DEADMONSTER (g_trigger.c:570), which is 0x2 (game.h, svflags), and actor-execution.ts:73 reads `serverFlags & 2` as deadMonster. 8 is SVF_PLAYER in the rerelease and undefined in classic.
- Impact: Corpses moving through the trigger are thrown like live monsters.
- Remediation: Test bit 2.

### SRCQ2-013 — Door crush removal has no explosion
- **Verification (VERIFY-R): confirmed. Final severity: Low.** movers.ts:533-537 removes with no effect; g_func.c:1081-1085 calls BecomeExplosion1.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/movers.ts:533-537
- Confidence: traced
- Evidence: g_func.c:1076-1087 calls `BecomeExplosion1(other)`, and g_misc.c BecomeExplosion1 writes TE_EXPLOSION1 before freeing. Port: `const victim = services.entity(other); if (victim !== null) services.remove(victim);`. CONTENT2-005's remedy says to copy this branch for trains, so it should be fixed in the same change.
- Impact: Objects crushed by doors vanish with no effect.
- Remediation: Emit `q2:explosion1` before removal.

### SRCQ2-014 — inPVS and inPHS ignore area connectivity for TS and classic native hosts
- **Verification (VERIFY-R): confirmed-with-changes. Final severity: Low.** source-hosts.ts:48-49 has no area test, vs sv_game.c:251-252. One citation is wrong: perception.ts:246 calls areasConnected right after :245, so that site does not rely on the import alone. The exposed callers are rerelease/index.ts:277, rerelease/entities.ts:324 and third-party DLLs. Retail claim holds: g_ai.c:550 is the only inPVS or inPHS call in Quake-2/game.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/simulation/source-hosts.ts:48-49, :63; src/compat/q2/classic/host.ts:356-357
- Confidence: traced
- Evidence: sv_game.c:251-252 and :281-282: `if (!CM_AreasConnected (area1, area2)) return false; // a door blocks hearing`. Port: only `clusterVisible(...)`. Retail DLLs call only gi.inPHS (g_ai.c:550 and siblings) and follow with their own AreasConnected check (g_ai.c:563), so retail behavior is preserved for FindTarget. foundation/monsters/perception.ts:245 and third-party DLLs rely on the import alone.
- Impact: Third-party DLLs and the TS rerelease helpers treat closed doors as open for these queries.
- Remediation: Add the area check to `visible`.

### SRCQ2-015 — Frame reader throws on U_REMOVE and ordering faults the original tolerates
- **Verification (VERIFY-R): confirmed. Final severity: Low.** frames.ts throws plain Error on unordered numbers and on removal without a source. cl_ents.c:442-447 prints and advances, and has no ordering error. MAX_EDICTS exists only on the write side (message.ts:201), vs cl_ents.c:416.
- Severity: Low
- Category: robustness
- Location: src/network/q2/frames.ts:113, :126
- Confidence: traced
- Evidence: cl_ents.c CL_ParsePacketEntities prints `U_REMOVE: oldnum != newnum` and continues, and has no ordering error, with only `newnum >= MAX_EDICTS` as ERR_DROP. Port: `throw new Error('Unordered Q2 entity delta')` and `throw new Error('Q2 entity removal has no delta source')`. These are plain Error, not ComError, and the port has no MAX_EDICTS check at this layer. The source also advances oldindex on a mismatch; the port does not.
- Impact: A buggy or hostile server's frame ends the client under NET-005's routing instead of printing. Reach is the same as NET-005, but the message is well formed, and this is a specific additional trigger.
- Remediation: Print and skip, or raise ComError(ERR_DROP) and handle it as a drop.

### SRCQ2-016 — Reencoding a decoded entity with effects bit 31 loses the high bits
- **Verification (VERIFY-R): confirmed. Final severity: Low.** vanilla.ts:250 stores signed MSG_ReadLong, message.ts:234 `< 256` is then true, and q_shared.h:1148 is unsigned. Flow corrected: q2-client-receiver.ts:62 re-encodes decoded frames. demo-local-recording.ts:133 encodes local host frames, not decoded ones. classic-guest-services.ts:327 uses getUint32, so native direct serving is unaffected.
- Severity: Low
- Category: bug
- Location: src/network/q2/message.ts (MSG_ReadLong, MSG_WriteDeltaEntity); src/network/q2/state.ts:58; src/network/q2/codecs/vanilla.ts readDeltaEntity; callers src/app/bootstrap/network/q2-client-receiver.ts, demo-local-recording.ts
- Confidence: traced for the sign and the branch; recording flow was identified by grep only
- Evidence: q_shared.h:586-587 `EF_TRACKERTRAIL 0x80000000`, and entity_state_t.effects is `unsigned int`. `to->effects < 256` is false for it in C. In the port, `MSG_ReadLong` returns signed int32 into `effects = 0`, so the value is negative, `to.effects < 256` is true, and U_EFFECTS8 writes one byte.
- Impact: A demo or relay reencoded from received Rogue frames drops the flag and other effects bits for that entity. Direct play is unaffected.
- Remediation: Store `effects >>> 0` on read, and compare unsigned on write.

### SRCQ2-017 — Native classic DLLs get a null trace surface on box actors, so bullets hitting a projectile dereference address 0
- **Verification (VERIFY-R): confirmed-with-changes. Final severity: High.** Crash path holds: host.ts:404 leaves surface 0; retail DLL 0x20017f5a-0x20017fd3 tests null only for the sky flag, then calls strncmp on it, where `repnz scas` reads address 0; memory.ts:631 faults. Stated trigger refuted: rockets, grenades and bolts are zero-size (g_weapon.c:367,:505,:633), enter equals leave, and my check got 0 hits in 200000 lines through a zero box. Real trigger: an explobox after death. barrel_delay (g_misc.c:966-972) clears takedamage for 0.2 s while staying SOLID_BBOX; health 10 dies to 3 shotgun pellets, so later pellets in the same blast reach the branch (19984 of 20000 such lines hit with null surface). 144 exploboxes in 22 retail maps, single-player and coop only (g_misc.c:976 frees them in deathmatch). Miss-case ent 0 is also real but rare: g_weapon.c:684 and :111 dereference with no fraction guard. Not run against the DLL.
- Severity: High
- Category: bug
- Location: src/compat/q2/classic/host.ts traceBytes (surface written only `if (trace.surface !== null)`, ent written as 0 for no hit); src/world/collision/body.ts:80; src/app/bootstrap/simulation/classic-guest-services.ts:246
- Confidence: traced through source and port; not run against a DLL. That the emulator faults on address 0 rests on GUEST-008 and on no mapping being made at 0, which was not separately tested
- Evidence: The original's trace_t.surface is never NULL on the server: cmodel.c:1363 and :740. Base game code relies on it. original/baseq2/g_weapon.c:219-229 in fire_lead: the sky test guards a null, then `if (tr.fraction < 1.0) { if (tr.ent->takedamage) ... else { if (strncmp (tr.surface->name, "sky", 3) != 0)`, with no guard on that second use. Rockets, grenades and bolts are SOLID_BBOX with takedamage 0. classic-guest-services.ts:246 gives them contents 0x2000000, which MASK_SHOT includes, and traceQ2Box returns `surface: null`, so bytes 44-47 stay 0. Own projectiles are skipped by the owner rule, but another player's or a monster's are not. The same applies to any non-damageable box actor. A related difference: on a miss the port writes ent 0 where sv_world.c:637 sets the world edict; other DLL paths that read `tr.ent` on fraction 1 were not audited.
- Impact: With a native gamex86.dll, a machinegun, shotgun or chaingun pellet hitting a gunner's grenade, a tank's rocket or another player's rocket makes the guest read address 0. Per GUEST-008, a guest fault ends the process. That is ordinary combat in coop and deathmatch. fire_lead is shared by baseq2, ctf, xatrix and rogue sources.
- Remediation: Give traceBytes one mapped empty csurface_t, write it whenever `trace.surface` is null, and write the world edict for a miss, matching SV_Trace. SRCQ2-003's fix then covers both paths.

## Summary of IDs
New findings by severity: High 3 (001, 002, 017), Medium 4 (003, 005, 006, 007), Low 10 (004, 008-016). Refuted: GAPQ12-014, TABLES-009, GUEST strength on Sys_SetFPCW. Severity lowered or framing corrected: NET-010, NET-017, TABLES-007, CONTENT2-018, GAPQ12C-003, GAPQ12B-005, GAPQ12-011.
