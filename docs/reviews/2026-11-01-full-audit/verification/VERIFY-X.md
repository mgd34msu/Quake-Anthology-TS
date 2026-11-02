# VERIFY-X — verification of SRC7, and settlement of the comparisons SRC7 and SRC3Q3 made from memory

HEAD fcdc8af5, read from `<scratchpad>/clean`; ten of the cited port files were compared with `cmp` against the project and are identical. Port paths are relative to `src/`. C paths are relative to `upstream/Quake-III-Arena/code/` unless another tree is named. Nothing from upstream was executed. Rerun here: `src7/dontavoid.ts` (pak8 qagame), `src7/token.ts`. New: `verifyx/test.ts`.

### SRC7-001
Verdict: confirmed
Corrected severity: High
Reason: bot-library-syscalls.ts:154 returns 0 on null; botlib/be_ai_goal.c:863,:904 return -1; game/ai_dmq3.c:2545 loops on `num >= 0`. goals.ts:1184-1185 returns null for index 0 because numbers start at 1 (:1131), and removeFromAvoidGoals (:949) and readQvmBotGoal cannot throw on stale data.
Rerun on retail pak8 bytecode: `levelCalls: 5000, removes: 5000, first: [0,0,0,0,0]`. The only instruction budget (interpreter.ts:914-916) is for counter evaluation. The match-level step stays traced, as the finding says.

### SRC7-002
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: browser-view.ts:223,:270 throw; cl_main.c:3176 ignores the send and Sys_SendPacket only prints (unix/unix_net.c:243-248, win32/win_net.c:359-372), now read instead of recalled. Only trap 69 and trap 82 end the client; the console `ping` and `serverstatus` paths are caught and printed (remote-application.ts:986,:991, catch at the end of that handler), so q3_ui's `ping` command is not affected.
Correction: not "about once a second". ui_main.c:5925-5933 skips the call only when `wait` is set, so with a known server count it runs every frame.

### SRC7-003
Verdict: confirmed
Corrected severity: Low
Reason: foundation/monsters/index.ts:384 falls back to `this.blocked`, and :763-775 runs plat logic for every species. Listing `monsterinfo.blocked` over RR2 and RQ2 `m_*` reproduces both lists exactly (m_shambler.cpp:586 is nullptr); RR2 m_move.cpp:1087,:1234 and RQ2 m_move.c:725 test for null.
`grep blocked` is empty on the port's brain, flipper, floater, jorg and shambler files, and types.ts:197 makes the callback optional.

### SRC7-004
Verdict: confirmed
Corrected severity: Low
Reason: RR2 g_monster.cpp:190-222 starts at `in_point + mins.z + 1` and returns WATER_NONE on a non-water first probe, so a floor in range passes rogue/g_rogue_newai.cpp's `waterlevel > WATER_WAIST`. common.ts:144 tests only the third probe (`+49`, floor+25 for mins.z -24) and index.ts:756 tests floor+48.
With no floor in range all three probes are water and both sides refuse, so the difference is limited to the case the finding describes.

### SRC7-005
Verdict: confirmed
Corrected severity: Low
Reason: reproduced with 1024 and 2000 characters: `RangeError: token_t string lacks a terminator` from token-memory.ts:181, raised in `publish` at client-script-syscalls.ts:127, after the catch at :124. 1023 characters reads normally, and a long string returns read 0. C now opened: botlib/l_script.c:534-538 errors with `string[1023]` set and unterminated, and l_precomp.c:3169 `strcpy`s it, so the finding's undefined-behaviour description is right.

### SRC7-006
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: two traps throw, not three. BOTLIB_TEST is refuted: `verifyx/test.ts` shows both bot dispatchers return null for code 208, and guest-runtime.ts:365 then reaches `disabledBot`, whose :379 returns 0 with or without bots attached. The other two stand: bot-navigation-syscalls.ts:166,:221.
Corrections: AAS_PresenceTypeBoundingBox is botlib/be_aas_sample.c:73-89, not be_aas_move.c (PRT_FATAL only prints, server/sv_bot.c:158). g_cmds.c:1580 is inside a comment, so stock code has no live AAS_PointReachabilityAreaIndex caller. SRC7's Strength "every BOTLIB trap but one is handled" should read every trap.

### SRC7-007
Verdict: confirmed
Corrected severity: Low
Reason: quakec/combat.qc sets `pain_finished = time + 5` after `th_pain` returns on skill 3, including army_pain's early return (monsters/grunt.qc:182-183). Port returns at foundation/monsters.ts:257 before the update at :263.

### SRC7-008
Verdict: confirmed
Corrected severity: Low
Reason: QW server/pr_cmds.c:803 is `Con_Printf`, WinQuake pr_cmds.c:920 is `Con_DPrintf`. quakec-source.ts:317 and mod-environment.ts:35 gate on `developer` for both, and both files can tell QuakeWorld apart (quakec-source.ts:260, mod-environment.ts:22).

### SRC7-009
Verdict: confirmed
Corrected severity: Info
Reason: RR2 g_ai.cpp:895-903 uses 5/355 under AI_PATHING; common.ts:131 uses 45/315. A search of `blockedCheckJump(` finds `kind` only on the definition line, so no caller passes a `"path"` navigation and the branch is unreachable.

### SRC7-010
Verdict: confirmed
Corrected severity: Info
Reason: `G_RankWeaponTime` appears only at its definition (game/g_rankings.c:642) across `game/*.c` and `*.h`, and no `G_Rank*` call exists outside g_rankings.c. q3-rankings.ts:83-87 calls `weaponTime` (rankings.ts:664) on each weapon change.

## Settlement of the comparisons made from memory

Each of these was opened this round and read against the port.

| Item | C | Port | Result |
|---|---|---|---|
| CL_GetPing | client/cl_main.c:2910-2941 | browser-view.ts `getPing` | Matches, including `max(100, cl_maxPing)` and publishing `.time` rather than elapsed time. Ping value +1 matches cl_main.c:2535 |
| CL_GetPingInfo | cl_main.c:2968-2978 | `sourcePingInfo`, client-browser-syscalls.ts case 49 | Matches |
| CL_ClearPing, CL_GetPingQueueCount | cl_main.c:2986-3018 | `clearPing`, `getPingQueueCount` | Matches |
| CL_GetFreePing, CL_Ping_f | cl_main.c:3022-3107 | `ping` | Matches: 500 ms rules, oldest slot, first on a tie. Differs only on send failure (SRC7-002) |
| CL_UpdateVisiblePings_f | cl_main.c:3113-3214 | `updateVisiblePings` | Matches except X-001. Overflow pop order and untouched `visible` match |
| CL_ServerStatus | cl_main.c:2655-2710 | `serverStatus` | Matches except X-002. Slot choice (cl_main.c:2625-2645) matches `statusSlot` |
| CL_ServerStatus_f, response printing | cl_main.c:3220-3247, :2718-2790 | `serverStatusCommand`, `poll`, `statusText` | Matches: format strings, 8191-byte limit, separators |
| fire_nail | game/g_missile.c:721-761 | ballistics-math.ts `q3NailVelocity`, missile.ts:480-487 | Matches: draw order (angle, u, r, speed), 8192*16, 555+random*1800, SnapVector, trTime = level.time, damage 20, 10000 ms, MOD_NAIL 23, and 15 shots at g_weapon.c:32 |
| PS_ReadName | botlib/l_script.c:526-549 | ui/common/legacy/script/lexer.ts:940-953 | Matches. The limit is reached after storing the 1024th byte, on both sides |
| AAS_PresenceTypeBoundingBox | botlib/be_aas_sample.c:73-89 | bot-navigation-syscalls.ts:123-128 | Case 305 matches. Case 318 is SRC7-006 |
| AAS_PointReachabilityAreaIndex | botlib/be_aas_sample.c:266-301 | bot-navigation-syscalls.ts:210-222 | Matches except the portal throw (SRC7-006). The C really does index `portals[-cluster]` with the already reassigned, positive cluster |
| PC_LoadSourceHandle, PC_FreeSourceHandle, PC_ReadTokenHandle, PC_SourceFileAndLine | botlib/l_precomp.c:3116-3197 | client-script-syscalls.ts, script-record.ts | Matches: slots 1 to 63, 0 on failure, free returns 0 or 1, StripDoubleQuotes, field order. `filename.slice(0, 64)` was not compared with `source_t.filename`; it only affects a diagnostic string |
| R_InitFogTable | renderer/tr_image.c:1953-1965 | fog.ts `FOG_TABLE` | Matches. sqrt stands in for `pow(x, 0.5)`, assigned to float |
| R_FogFactor | tr_image.c:1976-2000 | fog.ts `fogFactor` | Matches line for line |
| R_CreateFogImage | tr_image.c:2009-2042 | fog.ts `createFogTexture`, render/scene/world.ts:202 | Matches, 256x32, RGB 255, alpha `255*d`, clamp |
| R_LoadFogs | renderer/tr_bsp.c:1529-1617 | fog.ts `prepareFogVolume` | Matches. The port omits `tr.identityLight`, but overbright bits are fixed at 0 and no production caller sets identityLight, which equals id's non-overbright case. It also rejects a brush with under six sides where id checks only the global side count; that needs a malformed BSP |
| qsort | game/bg_lib.c:40-190 | team-arena/match.ts:108-165 | Matches: thresholds 7 and 40, med3, partition, insertion fallback, tail iteration |
| BoxOnPlaneSide fast path | game/q_math.c:745-758 (SRC7's path omits `game/`) | presentation/mark-projector.ts:57-65, core/math.ts:739 | Matches the C, with PlaneTypeForNormal at q_shared.h:1006. Note: the x86 asm at q_math.c:811-1042 reads only signbits and has no axial path, so an id386 build returns 3 where the C returns 2 at max == dist. The port follows the C branch |
| Bullet endpoint | game/g_weapon.c:173-178 | ballistics-math.ts:7-12 | Matches, including the crandom order (u first) |
| Shotgun endpoint | game/g_weapon.c:332-344, :358-360, bg_public.h:38-39 | ballistics-math.ts:13-23, hitscan.ts:187-192 | Matches: Q_crandom seed sequence (q_math.c:143-154), PerpendicularVector, snapped origin2, `rand() & 255` |

Also checked: SRC7's Supplement is correct. foundation/monsters.ts:96 walks along `angles.y`, where quakec/ai.qc `ai_painforward` uses `ideal_yaw`.

## New mismatches

### X-001 — Visible-ping scan stops at the first row after the queue fills, where id stops only at a row needing a ping
- Severity: Info
- Category: bug
- Location: network/q3/browser-view.ts:229
- Original: client/cl_main.c:3154, :3182
- Confidence: traced
- Evidence: Port: `if (count >= 32) break;` runs first for every row. C tests `slots >= MAX_PINGREQUESTS` only inside `server[i].ping == -1`, so `ping == 0` rows after the queue fills still take an address from the global overflow list in the same call.
- Impact: Global-list overflow replacement can start one or more refresh passes later. Final contents are unaffected as long as passes continue, because a later pass reaches those rows once a slot frees.
- Remediation: Move the check into the `ping === -1` path.

### X-002 — Resetting one server status request frees the slot and forgets its result, where id only marks it retrieved
- Severity: Info
- Category: bug
- Location: network/q3/browser-view.ts:277-281
- Original: client/cl_main.c:2672-2677; ui/ui_main.c:3909-3911, :4109, :4178
- Confidence: traced
- Evidence: C: `serverStatus = CL_GetServerStatus( to ); if ( !serverStatusString ) { serverStatus->retrieved = qtrue; return qfalse; }`, keeping the address and string. A later query for that address returns the cached string at once. For an address with no slot, C marks whichever slot CL_GetServerStatus picks, including the oldest. Port: matching slot only, and it releases the handle and clears the address, so the next query sends a new `getstatus` and returns 0 first. No slot is marked for an unmatched address.
- Impact: Team Arena's find-player and status panels can send one more request and show fresher data where id shows a cached result. The port's result is arguably better, and the UI recovers either way.
- Remediation: None needed unless exact behaviour is wanted; if so, set `retrieved` only and keep the address and handle.
