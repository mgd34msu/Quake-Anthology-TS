# SRCQ3 — Quake 3 and botlib findings settled against id's 1.32 source, plus a direct port comparison

Source: `upstream/Quake-III-Arena/code/` (id 1.32 release, read only, nothing executed). Port: `clean/src` at HEAD fcdc8af5. Original paths below are relative to `code/`.
ioquake3 is not in this tree. Every ioquake3 claim in the catalog is therefore marked unverifiable here. What can be settled is that the fix is absent from id's code.
Retail data read for evidence: `baseq3/pak4.pk3 botfiles/match.c`, `baseq3/pak8.pk3 vm/{qagame,cgame,ui}.qvm`, shader scripts and BSP shader lumps from `baseq3/pak0.pk3`, shader scripts from `baseq3/pak8.pk3` and `missionpack/pak0.pk3`.

A verdict of `confirmed` with "No source claim" means the entry makes no statement about the original, so the source cannot settle it. Those entries were not re-tested at HEAD.

## Coverage

### Part 1
Every GAPQ3, GAPQ3B and GAPBOTS entry has a block. So do the Q3 and botlib entries in BOTS, plus UI-003, UI-025, CONTENT1-020, LEFT-001, GAPMAT-001 and the Q3 IDs from `source-check-*.txt`. A search of the other finding files added GAPAPP-002, GAPAPP2-001, GAPCOMPAT-009, GAPCOMPAT-011, CORE-005, CORE-019, NET-008, VM-004, VM-005 and VM-018.

Not settled:
- **source-check IDs for other games, out of scope:** TABLES-009, CONTENT1-012, GAPCOMPAT-001, GAPCOMPAT-002, GAPCOMPAT-010, GAPAPP2-005, VM-007, CORE-002, all GAPQ12*, CONTENT2-*, GUEST-010, GUEST-019. GAPAPP-006 was also not settled. It concerns master-list parsing, and I did not check it against a Q3 original.
- **BOTS rerelease and navigation entries, no id Q3 counterpart:** BOTS-004, 005, 007, 008, 011, 012, 016, 018, 019, 020, 021, 022.
- **Q3-adjacent entries not opened against source:** LEFT-004, LEFT-005 (the 1.16n legacy cgame is not in this 1.32 tree), GAPAPP2-002, GAPNET-007 (the unified protocol has no original), VM-003, VM-017, VM-020. My keyword search for finding-file claims was a regex, so a Q3 claim phrased unusually could have been missed.

### Part 2: compared
- **Movement:** `move.ts`, `slide-move.ts`, `swept-body.ts`, `weapon.ts`, `view.ts`, `jump-pad.ts`, `postures.ts`, `animation.ts`, `provider.ts`, `prediction.ts` against all of `game/bg_pmove.c`, all of `game/bg_slidemove.c`, all of `cgame/cg_predict.c`, and `BG_TouchJumpPad`. The EntityEvent and PlayerAnimation enums were compared to `bg_public.h` by script. MoveFlags and CommandButtons were compared by eye against `game/bg_public.h:143-157` and `game/q_shared.h:1225-1242`, and all values match. The `base/game/grapple.ts` motion was also compared.
- **Collision:** `world.ts` and `model.ts` read in full. Compared against `CM_TraceThroughBrush`, `CM_TraceThroughTree`, the head of `CM_Trace`, `CM_TestCapsuleInCapsule` (start only), and `cm_patch.c` lines 1240-1594 (patch traces and position test).
- **Game:** `combat.ts`, `death.ts` (lines 100-380), `radius-damage.ts`, `base/combat-bridge.ts`, `world/gameplay/policies.ts:258-305` against `player_die`, `CheckArmor`, `G_Damage`, `CanDamage`, `G_RadiusDamage`, and the weapon-drop parts of `TossClientItems` in `g_combat.c`. `ballistics-math.ts` numbers against `fire_plasma`, `fire_grenade`, `fire_rocket`, `fire_bfg` in `g_missile.c`.
- **QVM:** `operations.ts`, the opcode loop in `interpreter.ts`, `parseQvm` in `image.ts` against `vm_interpreted.c` lines 300-640, 709-735 and 826-889, `vm.c` lines 480-562, and selected `vm_x86.c` cases.
- **Materials:** keyword coverage of `material.ts`, its `animMap` and sort parsing, and `material-finish.ts:299-363` against `ParseSort`, `animMap`, `FinishShader`, and the limits in `tr_local.h`.

### Part 2: NOT compared
- **Collision:** `cm_test.c` vs `topology.ts`; `cm_load.c` vs `map-resource.ts` and `map-loader.ts`; `cm_patch.c` lines 88-1239 (grid and facet generation) vs `patch.ts` before `positionInPatch`; `cm_polylib.c` vs `polylib.ts`; `clip-models.ts`; `checksum.ts`. In `cm_trace.c`: the capsule sweep functions (sphere, cylinder, capsule through capsule), most of `CM_TestCapsuleInCapsule`, `CM_TraceBoundingBoxThroughCapsule`, and `CM_TransformedBoxTrace`. `model.ts` was read, but its capsule logic has no open-source check behind it.
- **Game:** `g_mover.c` beyond `Reached_Train` and `SetMoverState`, vs `mover.ts`, `mover-spawn.ts`; `g_trigger.c` vs `triggers.ts`; `g_target.c` beyond the use functions in the verdicts, vs `targets.ts`; `g_misc.c`; `g_items.c` beyond `G_RunItem`, vs `item-pickup.ts`, `item-lifecycle.ts`, `item-motion.ts`; `g_weapon.c` control flow (`hitscan.ts` and `weapon.ts` were read or grepped for constants only, with no line-by-line compare); `g_missile.c` control flow vs `missile.ts`; `g_spawn.c`, `g_utils.c`, `g_mem.c`; `g_rankings.c`. Also everything under `team-arena/`, which holds the ports of `g_active.c`, `g_client.c`, `g_cmds.c`, `g_main.c`, `g_team.c`, `g_session.c`, `g_arenas.c` and `g_svcmds.c`. Those were checked only where a verdict cites them. `ClientThink_real`'s pmove setup was not compared.
- **QVM:** the remaining float and unsigned branch cases in `vm_interpreted.c`, the `VM_CallInterpreted` entry frame vs the port's call setup, syscall bridging, and `vm.c` symbols and restart.
- **Materials:** `ParseStage` details, `ParseTexMod`, `ParseDeform`, `ParseSkyParms`, fog parms, `CollapseMultitexture`, `ComputeStageIteratorFunc`, `VertexLightingCollapse`, `R_FindShader`'s implicit shader generation, `ScanAndLoadShaderFiles`, and all of `tr_shade.c` and `tr_shade_calc.c`. The `infoParms` table has no port counterpart to compare in `material.ts`, which stores surfaceparm names as strings.

### Other comparison limits
No retail chat line was run end to end through the bot path. Template shape findings below are traced by hand against the real `match.c`. All new findings are traced by reading unless stated otherwise.

## Strengths
- Movement is the most faithful area found. No gameplay deviation turned up in `bg_pmove.c`, `bg_slidemove.c` or `cg_predict.c` apart from the two deliberate extensions in SRCQ3-005 and SRCQ3-006. This covers friction, acceleration, step logic, clip-plane logic, crash land, the jitter fix, weapon timing, and error decay.
- Brush and patch traces match `cm_trace.c` and `cm_patch.c` term for term in the parts compared, including keeping the previous plane's type and signbits after a patch hit.
- The QVM keeps source bugs on purpose, such as the interpreter's `OP_BCOM` writing `opStack[-1]` (`vm_interpreted.c:827`).
- Several findings written from memory turned out to be correct, including the signed-char match offset, ten-level activation chain, four-weapon aim penalty, and `$modlist`. Two were not (GAPBOTS-001, GAPBOTS-003), and neither was a port error. A third, GAPQ3B-006, also described behavior id's code does not have.

# Verdicts

### GAPQ3-001
Verdict: confirmed-with-changes
Corrected severity: Critical
Reason: The three source faults are real: `game/g_cmds.c:1183` uses `>` so order 7 indexes past the 7-entry `gc_orders` (:1160-1168), and `SanitizeString` steps over the NUL at :163-165. The follow case is not undefined behavior in id: from `spectatorClient == -1` the loop at :772-797 never equals `original`, so with nobody to follow id's server hangs forever. The port's exit replaces a hang there, and replaces survivable reads in the other two.

### GAPQ3-002
Verdict: confirmed
Corrected severity: Critical
Reason: id 1.32 filters only `;` (`game/g_cmds.c:1242`). The newline claim holds: `MSG_ReadString` rewrites only `%` and values above 127 (`qcommon/msg.c:440-444`), and a quoted token copies anything but `"` (`qcommon/cmd.c:498-502`). A passed vote is appended raw (`game/g_main.c:1515`), and a pass needs `voteYes > numVotingClients/2` (:1524). So this is inherited from id, not a port regression. The ioquake3 fix is unverifiable here.

### GAPQ3-003
Verdict: confirmed
Corrected severity: High
Reason: `TEAM_MAXOVERLAY` is 32 (`game/bg_public.h:557`), `sortedTeamPlayers` has that size (`cgame/cg_draw.c:38`), `CG_ParseTeamInfo` has no bound (`cgame/cg_servercmds.c:120-125`), the server sends up to 32 (`game/g_team.c:1081`), and drawing clamps to 8 (`cgame/cg_draw.c:868`). The port's limit of 8 at the parse step has no source counterpart.

### GAPQ3-004
Verdict: confirmed
Corrected severity: High
Reason: `ClientConnect` filters `ip` for every client including bots (`game/g_client.c:918-919`). `""` skips the loop, so `in` reads uninitialized `m[4]` (`game/g_svcmds.c:181,186,197`), and only real connections receive an `ip` key (`server/sv_client.c:292,317`). The source reads indeterminate bytes and continues.

### GAPQ3-005
Verdict: confirmed
Corrected severity: Medium
Reason: The missing wrap is id's: `cg.voiceChatBufferOut++` (`cgame/cg_servercmds.c:871`) and `cg.soundBufferOut++` (`cgame/cg_view.c:732`), while the drains use modulo (:848, :746).

### GAPQ3-006
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: `CG_Missile` only indexes `cg_weapons` (`cgame/cg_ents.c:412-415`), and `CG_MissileHitWall` has a tolerant default case (`cgame/cg_weapons.c:1752` onward). But `CG_RegisterWeapon` does call `CG_Error("Couldn't find weapon")` (`cgame/cg_weapons.c:633`), so an unknown weapon reaching it also ends the session in id through ERR_DROP. The difference is disconnect versus process exit, not tolerance versus failure, on that path.

### GAPQ3-007
Verdict: confirmed
Corrected severity: Low
Reason: No source claim; port lifecycle only. Not re-tested.

### GAPQ3-008
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The statement "C reads past the array" is wrong for index 8. The source array has 32 slots (`game/bg_public.h:557`, `cgame/cg_draw.c:38`), and `CG_NextOrder_f` reads inside it (`cgame/cg_consolecmds.c:257`). The throw exists only because the port sized its tuple to 8 (`content/q3/presentation/state.ts:159`), the same root as GAPQ3-003.

### GAPQ3-009
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Opened and confirmed as tolerant in id: gametype (`cgame/cg_servercmds.c:149`), flag status `s[0]-'0'` (:210), team `atoi` (`cgame/cg_players.c:925`), skull trail indexed with no guard (`cgame/cg_players.c:1768`), and ERR_DROP handling (`client/cl_cgame.c:422`). Not opened: the `Invalid view weapon team` and HUD `curWeapon` originals.

### GAPQ3-010
Verdict: confirmed
Corrected severity: Medium
Reason: No source claim. Supplemental scene sessions have no id counterpart. Not re-tested.

### GAPQ3-011
Verdict: confirmed
Corrected severity: Low
Reason: `CG_LoadClientInfo` ends with the reset loop (`cgame/cg_players.c:726-734`).

### GAPQ3-012
Verdict: confirmed
Corrected severity: Low
Reason: The source calls `trap_CM_TempBoxModel` per solid (`cgame/cg_predict.c:119`), and `CM_TempBoxModel` (`qcommon/cm_load.c:798`) works on the static `box_model` and `box_brush` (`qcommon/cm_load.c:67,69`). So id allocates nothing per trace, as the finding says.

### GAPQ3-013
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: `CG_FileExists` only opens: `trap_FS_FOpenFile( filename, 0, FS_READ )` and tests the length (`cgame/cg_players.c:297-305`). The limit exists (`MAX_MOD_KNOWN` 1024, `renderer/tr_local.h:757`), but "stop this with a drop" is wrong at that site: the allocator returns NULL (`renderer/tr_model.c:57-58`). I did not read its caller.

### GAPQ3-014
Verdict: confirmed
Corrected severity: Low
Reason: No source claim; test gap only.

### GAPQ3B-001
Verdict: confirmed
Corrected severity: High
Reason: id copies the whole struct: `ent->client->ps = cl->ps` (`game/g_active.c:1077`), then sets `PMF_FOLLOW` and merges vote flags (:1078-1079). A port that preserves origin, velocity, health and ammo differs on core spectator behavior.

### GAPQ3B-002
Verdict: confirmed
Corrected severity: Medium
Reason: `AngleSubtract` has the same unbounded loop (`game/q_math.c:611-618`), so a retail client hangs on such a value too. This is a faithful port of a real weakness.

### GAPQ3B-003
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: id has no guard: `trDuration = length * 1000 / speed` (`game/g_mover.c:1309`) and `f = 1000.0 / trDuration` (:530, :537). The port therefore matches id, and the absence is not a port divergence. The ioquake3 fix is unverifiable here. The finding's own scan shows no retail map reaches it.

### GAPQ3B-004
Verdict: confirmed
Corrected severity: Low
Reason: `G_UseTargets( next, NULL )` is at `game/g_mover.c:1287`, and handlers read `activator->client` (`game/g_target.c:34,68,143,348`). The "treated as no client" claim now has evidence: the word at VM data address 308, my computed `FOFS(client)`, is 0 in retail `pak8.pk3 vm/qagame.qvm`.

### GAPQ3B-005
Verdict: confirmed
Corrected severity: Low
Reason: `if ( !token ) break` (`cgame/cg_players.c:130`) can never fire, because `COM_ParseExt` returns `com_token` at end of data (`game/q_shared.c`). So the "loops forever in C" claim holds for a file with no frame numbers.

### GAPQ3B-006
Verdict: refuted
Corrected severity: Info
Reason: id's stop path is `G_SetOrigin( ent, trace->endpos ); return;` with no `s.time` write (`game/g_missile.c:48-49`). The port matches id 1.32. The recalled line, if it exists anywhere, is later than this release.

### GAPQ3B-007
Verdict: confirmed
Corrected severity: Low
Reason: `G_RunItem` uses the entity after `G_RunThink` in the same order (`game/g_items.c:991-1008`). The hazard is the port's allocating setter, not the order.

### GAPQ3B-008
Verdict: confirmed
Corrected severity: Low
Reason: No source claim to settle. Not re-tested.

### GAPQ3B-009
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Test gap stands. Its follow-mode and train cases remain valid targets, but GAPQ3B-003's case tests a behavior id shares.

### GAPQ3B-010
Verdict: confirmed
Corrected severity: Info
Reason: No source claim. Not re-tested.

### GAPBOTS-001
Verdict: refuted
Corrected severity: Info
Reason: The recalled clear does not exist. `AIEnter_Battle_Fight` has no `bs->flags &= ~BFL_FIGHTSUICIDAL`. The whole game has one setter (`game/ai_dmnet.c:1978`) and one reader (:2126); the flag only resets through `BotResetState` (for example `AIEnter_Intermission`, :1133). The latch is id's behavior, faithfully ported. Whether to fix it is a design choice, not a port defect.

### GAPBOTS-002
Verdict: confirmed
Corrected severity: Medium
Reason: `BotFuncBobStartEnd` prints and returns with `origin` untouched (`botlib/be_ai_move.c:2270-2276`), and callers use their local (:2329, :2487). The port's throw replaces use of an uninitialized value.

### GAPBOTS-003
Verdict: refuted
Corrected severity: Info
Reason: The condition is `if (BotCTFCarryingFlag(bs))` alone (`game/ai_dmnet.c:197`), with no 1FCTF or Harvester alternatives and no `MISSIONPACK` branch. The port matches.

### GAPBOTS-004
Verdict: confirmed
Corrected severity: Low
Reason: The source names exactly four weapons: machinegun, shotgun, lightning, railgun (`game/ai_dmq3.c:3516-3519`). The chaingun is not among them, so the port's speed test does differ on Team Arena.

### GAPBOTS-005
Verdict: confirmed
Corrected severity: Low
Reason: No source claim to settle. Not re-tested.

### GAPBOTS-006
Verdict: confirmed
Corrected severity: Low
Reason: No source claim to settle. Not re-tested.

### GAPBOTS-007
Verdict: confirmed
Corrected severity: Low
Reason: `Cvar_Update` raises ERR_DROP at the same bound (`qcommon/cvar.c:871-875`, `game/q_shared.h:968`), which ends the map and not the process.

### GAPBOTS-008
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The test gap is real, but its motivating defect, GAPBOTS-001, is refuted. A transition test must not assert a clear that id never performs.

### BOTS-001
Verdict: confirmed-with-changes
Corrected severity: Critical
Reason: The offset is `char` (`game/be_ai_chat.h:57`). `BotMatchVariable` treats a negative offset as empty (`botlib/be_ai_chat.c`), so C carries on. The open question is settled: retail `pak4.pk3 botfiles/match.c:32` is `EC"("|EC"[", NETNAME, ..., ADDRESSEE, " help "|" meet ", TEAMMATE`, and `BotMatchMessage` tests that context (`game/ai_cmd.c:1804-1806`). The route is team chat or `tell`, since only those produce the `EC"("` or `EC"["` prefix. Plain `say` matches only the reply template, whose variables start early (`match.c:300`). Traced by hand, not run with the real file.

### BOTS-002
Verdict: confirmed-with-changes
Corrected severity: Critical
Reason: The heap leak is id's: the replaced waypoint is unlinked and never freed (`game/ai_cmd.c:1203-1208`). `BotCreateWayPoint` warns and returns NULL (`game/ai_dmq3.c:2125-2127`), then `cp->next` is written (`game/ai_cmd.c:1212`). Correction: in a QVM that write goes to masked low memory and does not crash; only a DLL build crashes. Template confirmed at `match.c:212-215`, so it needs team chat or `tell` in a team gametype (`ai_cmd.c:1181`) with a position in a valid area (:1191-1198).

### BOTS-003
Verdict: confirmed
Corrected severity: High
Reason: `netname` is uninitialized on the "someone else" branch and read at `game/ai_cmd.c:564-565`. `BotMatch_LeadTheWay` has the same shape and tests the stale `bs->teamgoal` (:1668-1671).

### BOTS-006
Verdict: confirmed
Corrected severity: Medium
Reason: No statement about the original that needs settling. Not re-tested.

### BOTS-009
Verdict: confirmed
Corrected severity: Medium
Reason: id checks only ident, version and BSP checksum (`botlib/be_aas_file.c:362-388`), so the parser gap exists in id too. The port's parser checks more than id's does, but not this.

### BOTS-010
Verdict: confirmed
Corrected severity: Medium
Reason: Same header-only checks in id (`botlib/be_aas_file.c:362-388`). The defect is against the port's own `load.ts` contract, not against id.

### BOTS-013
Verdict: confirmed
Corrected severity: Medium
Reason: No source claim to settle. Not re-tested.

### BOTS-014
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The loop bound is as recalled (`for (i = 0; i >= 0 && i < 10;)`), ending at `return 0` (`game/ai_dmq3.c:4339`). Addition: at i=9 id first writes `targetname[10]`, one row past the array (:4162, :4330), and `cur_entities[10]` (:4332), then exits. So C has a stack overrun on the way out, then returns "no activator".

### BOTS-015
Verdict: confirmed
Corrected severity: Low
Reason: With short args, `memmove` and `args[strlen(args)-1] = 0` stay inside `buf[1024]` (`game/ai_main.c:963,991-1008`), and the bot keeps going.

### BOTS-017
Verdict: confirmed
Corrected severity: Low
Reason: No source claim to settle. Not re-tested.

### BOTS-023
Verdict: confirmed
Corrected severity: Medium
Reason: Test gap stands. The retail template shapes above can now seed the tests directly.

### UI-003
Verdict: confirmed
Corrected severity: High
Reason: `menu->items[menu->cursorItem]` runs with cursorItem -1 before the `while` condition ends the loop (`ui/ui_shared.c:2449-2457`). `items[-1]` is the last word of `disableColor` (`ui/ui_shared.h:269-270`). `Item_SetFocus` also returns false for an already focused item (`ui/ui_shared.c:1347`), as the finding states.

### UI-025
Verdict: confirmed
Corrected severity: Info
Reason: The literal is in id's code: `(value != 0) ? "FIXME" : "FIXME"` (`ui/ui_shared.c:3448`), with the `value` read at :3424. Confidence can move from plausible to traced.

### CONTENT1-020
Verdict: confirmed
Corrected severity: Info
Reason: `cgame/cg_ents.c:681-692` computes angular deltas, applies only translation, and ends in the quoted FIXME.

### LEFT-001
Verdict: confirmed
Corrected severity: Critical
Reason: QVM `sscanf` always writes all destinations (`game/bg_lib.c:1299-1319`). `_atof` leaves its pointer past the NUL after a final digit (`game/bg_lib.c:884-911`), so the next read uses stale bytes in the same `buf`. Called at `game/ai_cmd.c:1189` and `game/g_spawn.c:68`. Template confirmed at `match.c:213`, reached by team chat or `tell`. C continues; the port throws.

### GAPMAT-001
Verdict: confirmed
Corrected severity: High
Reason: `RE_AddRefEntityToScene` checks only reType and count (`renderer/tr_scene.c:207-223`), and a search of `renderer/*.c` for `isnan` or `IS_NAN` found none. Rail length converts to int with no exit (`renderer/tr_surface.c:469-473`). "The original had no such exit" holds. The ioquake3 NaN drop is unverifiable here.

### GAPCOMPAT-003
Verdict: confirmed
Corrected severity: High
Reason: `CL_GetSnapshot` prints a developer message and truncates to `MAX_ENTITIES_IN_SNAPSHOT` (`client/cl_cgame.c:151-154`).

### GAPCOMPAT-009
Verdict: confirmed
Corrected severity: Low
Reason: Q3 part only: the one-second hold-off is at `game/g_utils.c:406`, with a forced second pass. Q2 half not settled here.

### GAPCOMPAT-011
Verdict: confirmed
Corrected severity: Low
Reason: `Com_Memcpy( tr.refdef.text, fd->text, ... )` copies opaque bytes (`renderer/tr_scene.c:307`).

### VM-004
Verdict: confirmed
Corrected severity: High
Reason: `CG_ERROR` and `G_ERROR` are ERR_DROP (`client/cl_cgame.c:422-423`, `server/sv_game.c:322-323`).

### VM-005
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: `FS_CheckFilenameIsMutable` is absent from id's tree, so id has this exposure too. The port matches id here; the finding is a hardening gap, not a divergence.

### VM-006
Verdict: confirmed-with-changes
Corrected severity: High
Reason: Reach is wider than the finding says. `FS_GetFileList` handles `$modlist` (`qcommon/files.c:2014-2015`). Stock q3_ui calls it from the Mods menu (`q3_ui/ui_mods.c:167`), and also from `UI_TeamArenaExists` (`q3_ui/ui_menu.c:238-246`), which `UI_MainMenu` (:269) calls at :368. Retail `pak8.pk3 vm/ui.qvm` contains the string. The port throws at `compat/qvm/file-syscalls.ts:211`, so activating the stock main menu rejects, not only opening Mods. I did not trace whether the port's startup ever activates `UIMENU_MAIN` on a QVM UI; `compat/qvm/ui.ts:11` maps it.

### VM-008
Verdict: confirmed
Corrected severity: Medium
Reason: The JIT emits `shl`, `sar`, `shr` by `cl`, which x86 hardware masks to 5 bits (`qcommon/vm_x86.c:948-961`). The interpreter uses plain C shifts (`qcommon/vm_interpreted.c:830-840`).

### VM-018
Verdict: confirmed
Corrected severity: Low
Reason: id's data size comes from the header and goes through `Hunk_Alloc` (`qcommon/vm.c:520-526`), which has a limit the port lacks.

### NET-008
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: id has no rate limit either (`server/sv_main.c:307,520`), and `SVC_RateLimit` is absent from this tree. Hardening gap, not a divergence.

### NET-015
Verdict: confirmed
Corrected severity: Medium
Reason: id takes the source address as the new server: `clc.serverAddress = from` with the proxy comment (`client/cl_main.c:1797-1799`). The port's comment is accurate, and the weakness is inherited.

### GAPAPP-002
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: id also force-sets every systeminfo key through `Cvar_Set` (`client/cl_parse.c:363-374`, `qcommon/cvar.c:397`). The port's exclusion of `cl_allowdownload` is stricter than id. The real difference is per-frame reapplication, since id's function runs on systeminfo change. The ioquake3 flag filter is unverifiable here.

### GAPAPP2-001
Verdict: confirmed
Corrected severity: High
Reason: The model is split at the first slash (`cgame/cg_players.c:974-981`), and id's file open filters only `..` and `::` (`qcommon/files.c:1054`), so an odd spelling is a miss, not a fault.

### CORE-005
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Q3 part only: `Cbuf_AddText` prints "overflow" and discards (`qcommon/cmd.c:93-96`), so "the originals had undefined overflow" is false for Q3. Q1 and Q2 are not settled here.

### CORE-019
Verdict: confirmed
Corrected severity: Info
Reason: Q3 part only: `Pmove` and `PmoveSingle` validate no command ranges (`game/bg_pmove.c:1836-2068`). The checks at `movement/q3/move.ts:509-512` are port additions.

## New findings

### SRCQ3-001 — `self->enemy = attacker` is not ported, so Team Arena `vtaunt` never insults your killer
- **Verification (VERIFY-R): confirmed. Final severity: Low.** Grep of `content/q3` finds no player-death write of `enemy`; combat.ts and death.ts have no reference. g_combat.c:506,:1059 set it and g_cmds.c:1100 reads it; commands.ts:480 is the port's read.
- Severity: Low
- Category: bug
- Location: src/content/q3/base/game/death.ts (playerDie, around the obituary block); src/content/q3/team-arena/commands.ts:480-481
- Confidence: traced
- Evidence: id sets the field twice: `self->enemy = attacker;` (`game/g_combat.c:506`) and `targ->enemy = attacker;` (`game/g_combat.c:1059`). `Cmd_VoiceTaunt_f` reads it: `if (ent->enemy && ent->enemy->client && ent->enemy->client->lastkilled_client == ent->s.number)` (`game/g_cmds.c:1100`). The port has that read at commands.ts:480, `entity.enemy.client.lastKilledClient === entity.s.number`. A search for `.enemy = ` in `content/q3` finds only targets.ts:351, missile.ts:311 and :322, misc-spawn.ts:124, the save restore, and the null at commands.ts:481. None sets it for a player on death.
- Impact: The `death_insult` branch can never run for a client, so `vtaunt` falls through to the later taunt cases. The `targ->enemy` write in `G_Damage` applies to every damaged entity that dies, which I did not trace for non-clients. This is cosmetic.
- Remediation: Set `self.enemy` from the attacker in `playerDie`, or in the damage reaction before `die` runs.

### SRCQ3-002 — A shader with no stages falls back to the default material, where id draws nothing
- **Verification (VERIFY-V): refuted. Final severity: Info.** The SRC2Q3 supplement holds and this overturns VERIFY-R's "confirmed". tr_shader.c:1599-1601 makes `ParseShader` return false for zero stages unless sky or fog, so :2473-2476 sets `defaultShader` and tr_bsp.c:291-292 returns `tr.defaultShader`; id draws the default, not nothing, and :2270-2273 is only reached for sky and fog. The port matches: material.ts:1421 (surfaceparm lowercased at :1350), shaders.ts:79, and :359 returns null like `RE_RegisterShader` returning 0 (:2709). Only the wording of the port's message at :1421 is inaccurate.
- Severity: Low
- Category: bug
- Location: src/materials/material.ts:1421, :600-602; src/render/scene/shaders.ts:79, :398
- Confidence: traced (not rendered)
- Evidence: `if (stages.length === 0 && sky === null && !surfaceParms.includes("fog")) this.fail("Shader has no stages and is neither sky nor fog; source uses an implicit material");`. A rejected terminal becomes `kind: "defaulted"`, and `return record?.defaulted === true ? this.sourceMaterials.default : material;`. id only defaults when `ParseShader` fails (`renderer/tr_shader.c:2473-2475`). A zero-stage body parses successfully, and `FinishShader` handles it: "fogonly shaders don't have any normal passes", `if ( stage == 0 ) shader.sort = SS_FOG;` (`renderer/tr_shader.c:2270-2273`). The port's message about an implicit material is wrong for a shader that has a text definition. `RE_RegisterShader` also returns 0 for a default shader (`renderer/tr_shader.c:2709`), so a registration result may differ too; I did not trace the port's handle return for this case.
- Impact: Script scan: `pak0.pk3` has 57 zero-stage shaders that are neither sky nor fog. BSP scan: 13 of them are used by pak0 maps, and all 13 carry `surfaceparm nodraw`, so retail maps do not show this. A custom map or model that uses a zero-stage shader on a drawn surface shows the default material where the original draws no passes.
- Remediation: Accept a zero-stage definition in the parser and let `finishShader` give it sort 7, which it already does at material-finish.ts:363.

### SRCQ3-003 — "Compiled" `OP_BLOCK_COPY` follows ioquake3's design, not id's JIT
- **Verification (VERIFY-R): confirmed. Final severity: Low.** interpreter.ts:1100-1104 throws and copies bytes; memory.ts:55 is copyWithin. vm_x86.c:1018-1037 uses `Constant4() >> 2`, masked pointers and forward `rep movsd`. The retail block-copy scan was not rerun.
- Severity: Low
- Category: bug
- Location: src/compat/qvm/interpreter.ts:1100-1104
- Confidence: traced for the difference; reproduced for the retail scan
- Evidence: Port: `if (count < 0 || source < 0 || destination < 0 || source + count > this.dataMask || destination + count > this.dataMask) throw new CommonError("drop", "OP_BLOCK_COPY out of range");`, then `copyBytes(destination, source, count)`, with the comment "ioquake's VM_BlockCopy checks bounds and copies bytes". id's x86 JIT has `// FIXME: range check`, loads `Constant4() >> 2` into ecx, masks both pointers, and runs `rep movsd` (`qcommon/vm_x86.c:1018-1037`). So id differs in three ways: a count not divisible by 4 copies whole words only, pointers are masked and do not raise an error, and the copy always runs forward, where `copyWithin` behaves like memmove.
- Impact: Scan of retail `pak8.pk3` QVMs: qagame 328, cgame 263, ui 39 block copies, none with a count not divisible by 4. Retail behavior is unaffected on the count path. A mod with a byte-sized struct copy, an out-of-range pointer or an overlapping forward copy behaves differently from id and can drop where id continued.
- Remediation: Mask pointers and copy forward by words when emulating id's compiled semantics, and keep ioquake's rule only behind an explicit profile.

### SRCQ3-004 — Float branches use IEEE NaN rules under "compiled" semantics, unlike id's JIT
- **Verification (VERIFY-R): confirmed-with-changes. Final severity: Info.** Extended to all six: x87 unordered sets C0, C2 and C3. From vm_x86.c:805-871, EQF, LTF and LEF branch on NaN and NEF does not, so all four differ from operations.ts:99-104 (false, false, false, true). GTF and GEF do not branch and match the port. The title's "float branches" holds for four of six.
- Severity: Info
- Category: bug
- Location: src/compat/qvm/operations.ts:86, :99-104
- Confidence: traced for OP_EQF only; I did not open the other five JIT float branches
- Evidence: id's JIT implements `OP_EQF` as `fcomp`, `fnstsw ax`, `test ah,0x40`, then branch when set (`qcommon/vm_x86.c:805-812`). An x87 unordered compare sets C3, so EQF on NaN takes the branch. The port returns `bitsToFloat32(left) === bitsToFloat32(right)`, which is false, as in the interpreter (`qcommon/vm_interpreted.c:709-710`). So the port's branches match `vm_interpreted.c` and not the JIT that `QvmModule`'s "compiled" label refers to.
- Impact: Only NaN comparisons differ. NaN is rare in game logic, but the port does let server-supplied NaN into the system (GAPMAT-001). Related to VM-020's labeling note.
- Remediation: Record which engine each operation matches. Emulate x87 unordered results only if a mod is found to need them.

### SRCQ3-005 — The ladder extension is active on stock Q3 movement with no profile gate
- **Verification (VERIFY-R): confirmed. Final severity: Low.** move.ts:210-219 and :493 have no product or mode gate, and :480 runs the extra trace every step. bg_pmove.c:1976-1994 has no ladder branch. The retail shader scan was not rerun.
- Severity: Low
- Category: bug
- Location: src/movement/q3/move.ts:210-219, :480, :493
- Confidence: traced; retail scan reproduced
- Evidence: `if (trace.fraction < 1 && trace.kind === "q3" && (trace.surfaceFlags & SURF_LADDER) !== 0) this.ladder = true;`, then `else if (this.ladder) this.ladderMove();`. id's dispatch has no ladder move (`game/bg_pmove.c:1976-1994`), although the flag exists (`game/surfaceflags.h:65`) and shaders can set it (`renderer/tr_shader.c:1346`). The code comment calls this deliberate, and nothing checks product or mode. It also adds one trace per pmove step.
- Impact: `surfaceparm ladder` occurs 0 times in the shader scripts of `baseq3/pak0.pk3`, `baseq3/pak8.pk3` and `missionpack/pak0.pk3`, so retail content is unaffected. A custom Q3 map with that surfaceparm plays differently under this engine than under id's. A client using this provider to predict against an id server would mispredict on those surfaces.
- Remediation: Enable the ladder only under a unified-rules profile, and skip the trace otherwise.

### SRCQ3-006 — Hull expansion can be refused where id always applies the new hull
- **Verification (VERIFY-R): confirmed. Final severity: Info.** move.ts:384 captures previous bounds, and :407-412 refuses an expansion onto allSolid; body-shape.ts:4-8 is the test. A dead-to-alive call expands from dead bounds, and an ordinary stand-up does spend a second trace. No runtime case built, and no retail route found, as the finding says.
- Severity: Info
- Category: bug
- Location: src/movement/q3/move.ts:406-412; src/movement/body-shape.ts:4-8
- Confidence: plausible (no runtime case built)
- Evidence: `const accepted = movementBounds(previousBounds, requested, ...); ... if (accepted !== requested) { ps.pmFlags = ...previousDuck; ps.viewheight = ... }`. id sets `maxs[2]` from the flags with no test beyond the stand-up check (`game/bg_pmove.c:1284-1309`). A dead-to-alive transition expands from `maxs[2] = -8` to 32. If that position overlaps a solid, id applies the hull and lets `PM_CorrectAllSolid` handle it, where the port keeps the old hull until the position is clear.
- Impact: Only when a respawn or an externally set posture lands in solid. I found no retail route. It also spends a second trace on each ordinary stand-up.
- Remediation: Apply the test only when `bodyBounds` from a client output is in use.

### SRCQ3-007 — The QVM loader rejects images id would load
- **Verification (VERIFY-R): confirmed-with-changes. Final severity: Info.** Holds for the interpreter only: vm_interpreted.c:214 passes unknown opcodes at load. id's JIT also rejects them: vm_x86.c:1048 raises ERR_DROP `bad opcode`. So image.ts:157 matches compiled behavior except for drop timing. The `dataLength % 4` check at image.ts:191 has no counterpart in vm.c:509-516.
- Severity: Info
- Category: robustness
- Location: src/compat/qvm/image.ts:157 and the `parseQvm` header checks
- Confidence: traced
- Evidence: `throw new BinaryError(reader.source, reader.offset - 1, "unknown QVM opcode ...")`, and `if (dataLength < 0 || dataLength % 4 !== 0) throw ...`. id's validation is magic and non-negative lengths with `codeLength > 0` (`qcommon/vm.c:509-516`). `VM_PrepareInterpreter` has a default case that takes unknown opcodes as operand-free (`qcommon/vm_interpreted.c:214`).
- Impact: Fails closed with a clear error. q3asm output should not reach it. I did not test a corpus of third-party mods.
- Remediation: None needed unless a real mod is rejected.
