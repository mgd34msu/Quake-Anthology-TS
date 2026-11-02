# SRC7 — Items still not compared after SRC6, SRC5, SRC4Q1B and SRC3Q3, against upstream/

HEAD fcdc8af5, read from `<scratchpad>/clean`. Port paths are relative to `src/`. Original paths are relative to `<scratchpad>/upstream/`: `Q3` = `Quake-III-Arena/code`, `RR2` = `quake2-rerelease-dll/rerelease`, `RQ2` = `quake2-rerelease-dll/original/rogue`, `ID1` = `quake-rerelease-qc/quakec`, `QW` = `Quake/QW/server`, `WQ` = `Quake/WinQuake`. Nothing from upstream was executed. Retail data was read from `qfiles`. Scripts are in `<scratchpad>/src7/`. Nothing was rendered, and no windowed or networked session was run.

## Coverage

### Items from SRC6's Coverage
| Item | Status | Result |
|---|---|---|
| BOTLIB trap shapes: `compat/qvm/bot-library-syscalls.ts` (199 lines), `bot-navigation-syscalls.ts` (226), `legacy-bot-syscalls.ts` (54), `bot-navigation-records.ts` (264), `script-record.ts` (68) | Read in full. Compared against every `BOTLIB_*` case in Q3 `server/sv_game.c:459-822` and the PASSFLOAT positions in Q3 `game/g_syscalls.c`. Struct layouts checked against `game/botlib.h`, `be_ai_goal.h`, `be_ai_move.h`, `be_ai_weap.h`. `src7/enum.ts` lists unhandled traps: only `BOTLIB_TEST` | SRC7-001, SRC7-006 |
| Trap return values | Compared for `BotGetLevelItemGoal`, `BotGetMapLocationGoal`, `BotGetNextCampSpotGoal`, `StringContains`, `BotFindMatch`, `BotMatchVariable`, `BotLoadChatFile`, `AAS_EnableRoutingArea`, `AAS_AreaInfo`, `AAS_PresenceTypeBoundingBox`, `AAS_PointReachabilityAreaIndex`, `AAS_PredictRoute` | SRC7-001, SRC7-006 |
| botlib internals behind the traps | **Not compared** beyond the functions named above and chat length paths. These are BOTS and GAPBOTS material, and this scope was argument shapes | None |
| `client-browser-syscalls.ts` (all 107 lines, so 1-59 too) and `network/q3/browser-view.ts` (all 351) | Read in full against Q3 `client/cl_ui.c` LAN functions. `CL_GetPing`, `CL_GetPingInfo`, `CL_UpdateVisiblePings_f`, `CL_ServerStatus` were compared from my recollection of `cl_main.c`, because I did not open that file this round. Treat those four as unverified | SRC7-002. `resolved === null` is LEFT-004 |
| `client-script-syscalls.ts` (all 158), both roles | Read in full against `cl_ui.c:1066-1075`, `cl_cgame.c:642-651`, and the PC handle functions as recalled from `botlib/l_precomp.c`. Token output exercised by `src7/token.ts` | SRC7-005 |
| Bodies of `blocked_checkjump`, `blocked_checkplat` | Compared, both editions: `rerelease/monsters/common.ts:85-105`, `:120-162`, inline copy `foundation/monsters/index.ts:739-776`, against RR2 `rogue/g_rogue_newai.cpp:14-260`, RQ2 `g_newai.c`, RR2 `g_monster.cpp:190-225`, `g_ai.cpp:895-903` | SRC7-003, SRC7-004, SRC7-009 |
| Army and dog tables | Compared. `src7/frames8.py` against `missionpacks/monsters/tables/grunt.ts`, `tables/rottweiler.ts`, `addons/monsters/demodog-frames.ts`, the `army_*` rows of `addons/monsters/infected/frames.ts`. `foundation/monsters.ts` (all 317 lines, the id1 army and dog) read by hand against ID1 `monsters/grunt.qc`, `monsters/rottweiler.qc`, `fight.qc:253-298` | See Strengths. SRC7-007 |
| Q3 shadow logic | Logic compared: all of Q3 `renderer/tr_shadows.c` against `render/gl/renderer.ts:463-515`, `render/cpu/rasterizer.ts:742-772`, `materials/deform.ts:27-41`. **Pixel output was not established** | No new finding. SRC3Q3-005 stands: silhouette building (`R_AddEdgeDef`, `R_RenderShadowEdges`, `RB_ShadowTessEnd`) has no port, only the backend operations |

### SRC3Q3 not-compared list, what SRC5 and SRC6 left
| Item | Status | Result |
|---|---|---|
| `qsort` in `match.ts` from recollection | Now compared, Q3 `game/bg_lib.c:40-190` against `team-arena/match.ts:108-165` | Matches |
| Bullet, shotgun and nail endpoints from recollection | Now compared, Q3 `g_weapon.c` `Bullet_Fire`, `ShotgunPattern`, `bg_public.h:38-39` against `base/game/ballistics-math.ts:7-46`. `fire_nail` was from recollection | Matches, including the crandom order |
| `BoxOnPlaneSide` fast path from recollection | Now compared, Q3 `q_math.c:745-758` against `mark-projector.ts:57-65`, `core/math.ts:739` | Matches |
| `g_rankings.c:490-990`, script only | Now read, against `base/game/rankings.ts`. `src7/rank.py` also compares case labels, keys and arguments | SRC7-010 |
| R_LoadFogs gradient tail | Compared, `tr_bsp.c` against `materials/fog.ts:34-44` | Matches |
| GL and CPU shadow backends | See above | None |
| `kind: "unavailable"` bot path | No original, per SRC5 Part B | None |

### SRC4Q1B not-compared list, what SRC5 and SRC6 left
| Item | Status | Result |
|---|---|---|
| `q1/quakec` pinned statement numbers | Partly. `src7/pins.ts` loads retail `id1/PAK0.PAK` `progs.dat` and `qw/qwprogs.dat`: both digests match the pins. All damage statements (8 and 9) match exactly by opcode and operands. All environment sites (9 and 19) are call opcodes, without checking the call target. **Not checked:** pins in `id1-attacks`, `id1-pickups`, `id1-projectiles`, `armor-stage`, `weapon-stage` | None |
| `q1/addons/monsters/**`, MG1 `monster_boss` gates | SRC4Q1A-004 (boss) and SRC4Q1A, SRC6 for the rest cover them. Not re-read | None |
| QW `pr_cmds.c` remainder | Compared, full `diff -bwB` against WQ `pr_cmds.c` read to line 1420. Write destinations checked against `compat/qc/presentation-host.ts:290-302` | SRC7-008 |
| qw-qc logic | **Not compared.** It runs as `qwprogs.dat` in the VM, so there is no port to diff | None |

### Checked, not reported
- `resolved === null` throwing in `addServer` and `removeServer` is LEFT-004.
- `weaponInfoBytes`: 552 and 208 bytes match `weaponinfo_t` and `projectileinfo_t`.
- `aas_predictroute_t.numareas` is never written by the port, but `AAS_PredictRoute` never writes it either.
- `BOTLIB_LOAD_MAP` throws on a name mismatch, but `mapName` and the guest's `mapname` cvar have the same origin (`guest-runtime.ts:218`, `server-state.ts:75`).
- `writeQvmScriptToken`'s safe-integer throw is dead: the value comes from a `getUint32`. `99999999999999999999` reads as int 1661992959, not a throw.
- `body.ground === platform.actor.id` at `index.ts:773` uses identity where `common.ts:99` uses `.equals`. `registry.ts:70` creates one id per allocation, so it holds in play, as `:732` also assumes. `registry.ts:210-237` builds new ids on restore, so it may be false until the next ground write after a load. I did not trace that further and do not report it.
- Port heights omit SV_LinkEdict's 1-unit absmin and absmax expansion (`Quake-2/server/sv_world.c:252`). This shifts `blocked_*` thresholds by 1 or 2 units. Too small to report.
- CPU `shadow-finish` keeps the stencil, where GL retains DECR like id. Nothing reads the stencil after the finish in a view.
- `tests/compat/qc/weapon-stage.test.ts` failed one test here only because it reads a Copper `progs.dat` under `$HOME`, which the audit HOME lacks.

## Strengths
- **Trap numbering and arguments.** Every BOTLIB trap but one is handled, and each uses the right words, float positions and pointer order, including the 13-word `AAS_PredictClientMovement`, 11-word `AAS_PredictRoute`, and `BotReplyChat`'s eight variables.
- **Records.** `bot_goal_t` 56, `bot_initmove_t` 68, `bot_moveresult_t` 52, `bot_entitystate_t` 112, `aas_entityinfo_t` 140, `aas_areainfo_t` 52, `aas_clientmove_t` 84, `aas_predictroute_t` 36, `aas_altroutegoal_t` 24 stride, `bot_match_t` 328, `bot_consolemessage_t` 276, `pc_token_t` 1040 all match, with partial writes preserved (`level-item`, `location`).
- **LAN traps.** Source codes, capacities, `-1` from `LAN_GetServerPing`, `-1` from `LAN_AddServer`, sort keys, sort direction, `bot` for an empty address, and the source's pending `-1` server count are faithful.
- **Army and dog tables.** `frames8.py`: ID1 and HIP `grunt.qc` 103 of 103, `rottweiler.qc` 86 of 86, MG3 `mg3_demodog.qc` 86 of 86, and MG3 `soldier.qc` 82 of 82 shared rows: 0 frame and 0 next-frame differences. The only flagged rows are `ai_back(N)` actions, and `charmed-base.ts:27` registers those four distances. The hand-written `foundation/monsters.ts` sequences match every frame number and distance by reading.
- **`blocked_checkjump` and `blocked_checkplat`.** Thresholds (16 classic, 18 rerelease), the classic `self->mins[2] - maxDown - 1` quirk, masks, `face_wall` and `monster_jump_start` are all preserved per edition.
- **Shadow backends.** Stencil functions, ops, cull order for mirrors, blend, depth state and the projection deform match `tr_shadows.c` line for line, including the double-promoted VectorMA.
- **Rankings.** All ten functions from `G_RankPlayerDie` to `G_RankReward` match in case labels, keys and accumulate flags.

## Supplements
- Supplements CONTENT1 and SRCQ1 painforward: `foundation/monsters.ts:96` has the same `angles.y` for army and dog `ai_painforward`, where ID1 `ai.qc:399` uses `ideal_yaw`.
- Corrects SRC6-019's wording: the default at `foundation/monsters/index.ts:384` handles more than infantry and soldier. See SRC7-003.

## Findings

### SRC7-001 — A missing level item returns 0 instead of -1, so a powerup respawn hangs the process in any QVM mod with bots
- **Verification (VERIFY-X): confirmed. Final severity: High.** bot-library-syscalls.ts:154 returns 0 on null; botlib/be_ai_goal.c:863,:904 return -1; game/ai_dmq3.c:2545 loops on `num >= 0`. goals.ts:1184-1185 returns null for index 0 because numbers start at 1 (:1131), and removeFromAvoidGoals (:949) and readQvmBotGoal cannot throw on stale data. Rerun on retail pak8 bytecode: `levelCalls: 5000, removes: 5000, first: [0,0,0,0,0]`. The only instruction budget (interpreter.ts:914-916) is for counter evaluation. The match-level step stays traced, as the finding says.
- Severity: High
- Category: bug
- Location: compat/qvm/bot-library-syscalls.ts:149-155; bots/behavior/library/goals.ts:1179-1196
- Original: Q3 botlib/be_ai_goal.c:863, :904; game/ai_dmq3.c:2540-2549, :2559-2563, :4861-4862; game/g_items.c:381-388
- Confidence: reproduced for the trap and the loop (`src7/dontavoid.ts`, real interpreter and retail bytecode). Not run through a full match with AAS. That last step is traced.
- Evidence: Id returns -1 both when `itemconfig` is missing and when the list ends. The port shares one branch for two traps: `if (result === null) return 0; writeQvmBotGoal(...); return location ? 1 : result.number;`. 0 is correct for `BotGetMapLocationGoal` only. `BotDontAvoid` is:
  ```c
  num = trap_BotGetLevelItemGoal(-1, itemname, &goal);
  while(num >= 0) {
      trap_BotRemoveFromAvoidGoals(bs->gs, goal.number);
      num = trap_BotGetLevelItemGoal(num, itemname, &goal);
  }
  ```
  Every walk ends in null, which is 0, and 0 satisfies `num >= 0`. The next call has index 0, `findLevelItem` finds no item, `goals.ts:1185` returns null, and the trap returns 0 again, forever. Running function 37296 of retail `pak8.pk3` `vm/qagame.qvm` (BotDontAvoid, located by its two traps) with the real trap decoder: `levelCalls: 5000, removes: 5000, first: [0,0,0,0,0]`, stopped only by my own throw.
  Refutation attempts: the interpreter loop (`interpreter.ts:913`) has an instruction budget only for counter evaluation, so nothing breaks the loop. `RespawnItem` sends `EV_GLOBAL_SOUND` unless the item sets `speed`, so this is the default. `BotCheckEvents` calls `BotGoForPowerups` on that sound for every bot that processes the snapshot, and it calls `BotDontAvoid` five times.
  The same return also defeats the `< 0` warnings at `ai_dmq3.c:5134-5168` and `:5406-5436`. The `i > 0` loops in `ai_cmd.c:165`, `:1492` are unaffected.
- Impact: With a guest qagame (`content.ts:146`, any discovered Q3 mod), bots enabled and any powerup on the map, the simulation thread spins with no error at the first powerup respawn. This is not an exception, so APP-001's exit does not even run: a server or client freezes until killed. The TypeScript bot path is not affected because it uses `null` directly.
- Remediation: Return -1 for a null level-item result and keep 0 for the map-location trap. Add a trap-level test that walks a name to the end of the list.

### SRC7-002 — A failed ping or status send ends the client, where id ignores send failures
- **Verification (VERIFY-X): confirmed-with-changes. Final severity: Medium.** browser-view.ts:223,:270 throw; cl_main.c:3176 ignores the send and Sys_SendPacket only prints (unix/unix_net.c:243-248, win32/win_net.c:359-372), now read instead of recalled. Only trap 69 and trap 82 end the client; the console `ping` and `serverstatus` paths are caught and printed (remote-application.ts:986,:991, catch at the end of that handler), so q3_ui's `ping` command is not affected. Correction: not "about once a second". ui_main.c:5925-5933 skips the call only when `wait` is set, so with a known server count it runs every frame.
- Severity: Medium
- Category: robustness
- Location: network/q3/browser-view.ts:220-224, :267-271; network/common/transport.ts:116-121; compat/qvm/client-browser-syscalls.ts:73, :86-91; app/bootstrap/server-browser.ts:69-70
- Original: Q3 ui/ui_main.c:5932; client/cl_ui.c:1006-1014 (`CL_UpdateVisiblePings_f` and `NET_OutOfBandPrint` as recalled, `cl_main.c` not opened)
- Confidence: traced
- Evidence: `if (slot.handle === null) { slot.address = null; throw new Error("Could not send Q3 ping"); }`, and the same for status. `handle` is null when `transport.send` returns false (`discovery.ts:121-124`). `UdpTransport.send` returns false after 9 consecutive send errors (`transport.ts:116-121`): `if (attempt >= 8) return false;`. An unreachable network makes each attempt fail. `case 69` (line 73) calls `updateVisiblePings` synchronously. Neither that file nor `q3-client/qvm.ts` catches, as LEFT-004 found for the same path. Team Arena calls this trap from `UI_DoServerRefresh` (`ui_main.c:638`, `:5932`), about once a second during a refresh.
  Refutation attempt: LEFT-004's trigger is address resolution, and no entry in the catalog names these two throws. NET-level send failure findings concern `unified-client.ts`.
- Impact: Dropping the network while the Team Arena server browser refreshes ends the client under APP-001. Id's send would print a warning and the ping would time out. Not run: this needs a windowed UI and a network fault.
- Remediation: Leave the slot pending and let it time out, as a lost packet would.

### SRC7-003 — Monsters with no source blocked callback still trigger plats through the port's default
- **Verification (VERIFY-X): confirmed. Final severity: Low.** foundation/monsters/index.ts:384 falls back to `this.blocked`, and :763-775 runs plat logic for every species. Listing `monsterinfo.blocked` over RR2 and RQ2 `m_*` reproduces both lists exactly (m_shambler.cpp:586 is nullptr); RR2 m_move.cpp:1087,:1234 and RQ2 m_move.c:725 test for null. `grep blocked` is empty on the port's brain, flipper, floater, jorg and shambler files, and types.ts:197 makes the callback optional.
- Severity: Low
- Category: bug
- Location: content/q2/foundation/monsters/index.ts:384, :739-776; content/q2/foundation/monsters/perception.ts:428; content/q2/foundation/monsters/ai.ts:236
- Original: RR2 m_move.cpp:1087, :1234; RQ2 m_move.c:725; `monsterinfo.blocked` assignments in RR2 and RQ2 m_*.c
- Confidence: traced
- Evidence: `blocked: distance => definition.blocked?.(context, distance) ?? this.blocked(context, distance)`. The default guards only its jump branch by `state.kind === "infantry"` and the soldier early return. From `:763` on, it runs the plat logic for every species. Id calls nothing when `monsterinfo.blocked` is null. Rerelease with no callback: actor, arachnid, boss2, jorg, makron, boss3, brain, flipper, float, guardian, hover, insane, carrier, turret, widow2, fixbot, and shambler (`m_shambler.cpp:586` sets it to `nullptr`). Classic Rogue with no callback: actor, boss2, jorg, makron, boss3, brain, carrier, flipper, insane, turret, widow2. `grep blocked` on the port's `base-variants/brain.ts`, `flipper.ts`, `floater.ts`, `insane.ts`, `actor.ts`, `jorg.ts`, `makron.ts`, `boss2.ts` and `rerelease/monsters/shambler.ts` is empty. `missionpacks/monsters/widow2.ts` uses the word only for its own `source.blocked` field.
  Refutation attempt: both call sites are edition-gated, but neither checks for a source callback.
- Impact: A blocked brain, shambler or flying monster with its enemy above or below can use a `func_plat` under it, raising or lowering a plat id's monster would leave alone. The return true also skips the rest of that chase step.
- Remediation: Apply the default only to infantry and soldier, and make the fallback false for the rest.

### SRC7-004 — Rerelease jump-down refuses water about 25 units deep; id's check tests a point under the floor and lets it through
- **Verification (VERIFY-X): confirmed. Final severity: Low.** RR2 g_monster.cpp:190-222 starts at `in_point + mins.z + 1` and returns WATER_NONE on a non-water first probe, so a floor in range passes rogue/g_rogue_newai.cpp's `waterlevel > WATER_WAIST`. common.ts:144 tests only the third probe (`+49`, floor+25 for mins.z -24) and index.ts:756 tests floor+48. With no floor in range all three probes are water and both sides refuse, so the difference is limited to the case the finding describes.
- Severity: Low
- Category: bug
- Location: content/q2/rerelease/monsters/common.ts:143-145; content/q2/foundation/monsters/index.ts:755-756
- Original: RR2 rogue/g_rogue_newai.cpp blocked_checkjump water block; g_monster.cpp:190-225
- Confidence: traced
- Evidence: Id calls `M_CatagorizePosition(self, deep.endpos, waterlevel, watertype)` and refuses at `waterlevel > WATER_WAIST`. That function starts at `in_point[2] + self->mins[2] + 1`, and `deep.endpos` is the floor from a point trace. With `mins.z` -24 the first probe is 23 units under the floor, usually solid, so `!(cont & MASK_WATER)` returns WATER_NONE. Only a trace with no floor inside the drop range gets WATER_UNDER.
  The port skips the first two probes: `common.ts:144` tests only `deep.end.z + bounds.min.z + 49`, which is floor + 25. The inline infantry copy at `index.ts:756` uses `deep.end + 48`, a different threshold.
- Impact: In the rerelease provider, monsters chasing a player into a pool with a floor in drop range stay on the ledge if the water is over about 25 units deep (48 for infantry). Id's monsters jump in.
- Remediation: Port the three probes as id wrote them and call one helper from both sites.

### SRC7-005 — A script name token of 1024 or more characters throws out of a PC read trap
- **Verification (VERIFY-X): confirmed. Final severity: Low.** reproduced with 1024 and 2000 characters: `RangeError: token_t string lacks a terminator` from token-memory.ts:181, raised in `publish` at client-script-syscalls.ts:127, after the catch at :124. 1023 characters reads normally, and a long string returns read 0. C now opened: botlib/l_script.c:534-538 errors with `string[1023]` set and unterminated, and l_precomp.c:3169 `strcpy`s it, so the finding's undefined-behaviour description is right.
- Severity: Low
- Category: robustness
- Location: ui/common/legacy/script/token-memory.ts:181; compat/qvm/client-script-syscalls.ts:116-130
- Original: Q3 botlib/l_script.c PS_ReadName and l_precomp.c PC_ReadTokenHandle, as recalled
- Confidence: reproduced (`src7/token.ts`, through `qvmClientScriptSyscall`)
- Evidence: Input of 2000 `a` characters prints `name longer than MAX_TOKEN = 1024`, then `THROW RangeError: token_t string lacks a terminator within its 1024-byte field`. The same length as a string or a number returns read 0 cleanly. `read` catches only `reader.isSourceFailure(error)`, so this rejects the UI syscall. Id's `PS_ReadName` returns with `string[1023]` unterminated, and `strcpy` then overruns, so the source is undefined behaviour here, not a clean error.
- Impact: A malformed menu or script in a mod pk3 ends the client under APP-001 rather than failing the parse. Reach is data files only. The qagame read path uses a different result call and was not run.
- Remediation: Terminate the token at the limit on this error path, as the string path does, and return read 0.

### SRC7-006 — Three bot traps are fatal where id continues, reachable only from a mod
- **Verification (VERIFY-X): confirmed-with-changes. Final severity: Low.** two traps throw, not three. BOTLIB_TEST is refuted: `verifyx/test.ts` shows both bot dispatchers return null for code 208, and guest-runtime.ts:365 then reaches `disabledBot`, whose :379 returns 0 with or without bots attached. The other two stand: bot-navigation-syscalls.ts:166,:221. Corrections: AAS_PresenceTypeBoundingBox is botlib/be_aas_sample.c:73-89, not be_aas_move.c (PRT_FATAL only prints, server/sv_bot.c:158). g_cmds.c:1580 is inside a comment, so stock code has no live AAS_PointReachabilityAreaIndex caller. SRC7's Strength "every BOTLIB trap but one is handled" should read every trap.
- Severity: Low
- Category: robustness
- Location: compat/qvm/bot-navigation-syscalls.ts:166, :221; app/bootstrap/simulation/q3/guest-runtime.ts:365
- Original: Q3 botlib/be_aas_move.c `AAS_PresenceTypeBoundingBox` as recalled; botlib/be_aas_sample.c:266-301; server/sv_game.c BOTLIB_TEST
- Confidence: traced to the caller. No stock caller triggers them.
- Evidence:
  - `throw new RangeError("QVM movement prediction requires a supported presence type")`. Id prints PRT_FATAL, which only prints, and uses index 2. Case 305 in the same file has the source behaviour. Stock caller: `ai_dmq3.c:3416` passes PRESENCE_CROUCH.
  - `throw new RangeError("AAS_PointReachabilityAreaIndex source reuses frontcluster as a negative portal index")` for any origin in a portal area. Id reads a wrong portal without crashing, which is itself out of bounds. Stock callers: `g_cmds.c:1580` passes NULL and `g_active.c:1187` is commented out.
  - `BOTLIB_TEST` (208) reaches `rejectQvmSyscall`. Stock game code defines `trap_BotLibTest` (`g_syscalls.c:264`) but never calls it.
  The throw propagates through `Q3QvmServerGame`'s syscall (`guest-runtime.ts:362-368`, rethrow) to the frame.
- Impact: A mod calling these with those arguments ends the server under APP-001.
- Remediation: Print and continue. Use case 305's fallback, return 0 for the portal case, and return 0 for the test trap.

### SRC7-007 — Nightmare grunt hits during pain cooldown do not extend it
- **Verification (VERIFY-X): confirmed. Final severity: Low.** quakec/combat.qc sets `pain_finished = time + 5` after `th_pain` returns on skill 3, including army_pain's early return (monsters/grunt.qc:182-183). Port returns at foundation/monsters.ts:257 before the update at :263.
- Severity: Low
- Category: bug
- Location: content/q1/foundation/monsters.ts:257, :263
- Original: ID1 combat.qc:257-260; monsters/grunt.qc `army_pain`
- Confidence: traced. SRCQ1 notes the rule is missing in `base/monsters.ts` and present here for army. This is the separate timing difference in the copy that has it.
- Evidence: Port: `if (monster.painFinished > game.time) return undefined;` precedes `if (game.options.skill === 3) monster.painFinished = game.time + 5;`. QC sets `pain_finished = time + 5` in T_Damage after `th_pain` returns, including when `army_pain` returned early. So on skill 3 QC's window moves forward on every hit, and the port's only when a pain animation starts.
- Impact: A grunt under sustained fire on Nightmare flinches again every 5 seconds in the port. In QC it stays out of pain frames for as long as hits keep arriving under 5 seconds apart.
- Remediation: Apply the skill 3 update on every damaged call, after the pain branch.

### SRC7-008 — QuakeWorld `dprint` is gated on `developer`; QW prints it always
- **Verification (VERIFY-X): confirmed. Final severity: Low.** QW server/pr_cmds.c:803 is `Con_Printf`, WinQuake pr_cmds.c:920 is `Con_DPrintf`. quakec-source.ts:317 and mod-environment.ts:35 gate on `developer` for both, and both files can tell QuakeWorld apart (quakec-source.ts:260, mod-environment.ts:22).
- Severity: Low
- Category: bug
- Location: app/bootstrap/simulation/quakec-source.ts:317; compat/qc/mod-environment.ts:35
- Original: QW pr_cmds.c PF_dprint `Con_Printf ("%s",PF_VarString(0));`; WQ pr_cmds.c:920 `Con_DPrintf`
- Confidence: traced
- Evidence: `host.set("dprint", vm => { if (this.cvars.variableValue("developer") !== 0) options.print(vm.varString(0)); });`, with no check of `binding.kind`, though the same class uses it at `:260-263`. SRC6's QW list did not include `dprint`.
- Impact: QuakeWorld QC debug messages do not reach a default dedicated server console. Behaviour is otherwise unchanged.
- Remediation: Print unconditionally when the binding is QuakeWorld.

### SRC7-009 — Pathing jump uses the 45 degree FacingIdeal; id uses 5 when AI_PATHING is set
- **Verification (VERIFY-X): confirmed. Final severity: Info.** RR2 g_ai.cpp:895-903 uses 5/355 under AI_PATHING; common.ts:131 uses 45/315. A search of `blockedCheckJump(` finds `kind` only on the definition line, so no caller passes a `"path"` navigation and the branch is unreachable.
- Severity: Info
- Category: dead-code
- Location: content/q2/rerelease/monsters/common.ts:126-133, :131
- Original: RR2 g_ai.cpp:895-903
- Confidence: traced
- Evidence: Port: `if (delta > 45 && delta < 315) { changeYaw(context); return "turn"; }` inside `navigation.kind === "path"`. Id: `if (aiflags & AI_PATHING) return !(delta > 5 && delta < 355);`. No caller passes a `"path"` navigation, so this branch is unreachable today, consistent with SRC5's note that pathing is never assigned.
- Impact: None now. It becomes wrong if path following is added.
- Remediation: Use the 5 degree test when the branch goes live.

### SRC7-010 — Port reports weapon time keys that id's game never sends
- **Verification (VERIFY-X): confirmed. Final severity: Info.** `G_RankWeaponTime` appears only at its definition (game/g_rankings.c:642) across `game/*.c` and `*.h`, and no `G_Rank*` call exists outside g_rankings.c. q3-rankings.ts:83-87 calls `weaponTime` (rankings.ts:664) on each weapon change. ## Settlement of the comparisons made from memory Each of these was opened this round and read against the port. | Item | C | Port | Result | |---|---|---|---| | CL_GetPing | client/cl_main.c:2910-2941 | browser-view.ts `getPing` | Matches, including `max(100, cl_maxPing)` and publishing `.time` rather than elapsed time. Ping value +1 matches cl_main.c:2535 | | CL_GetPingInfo | cl_main.c:2968-2978 | `sourcePingInfo`, client-browser-syscalls.ts case 49 | Matches | | CL_ClearPing, CL_GetPingQueueCount | cl_main.c:2986-3018 | `clearPing`, `getPingQueueCount` | Matches | | CL_GetFreePing, CL_Ping_f | cl_main.c:3022-3107 | `ping` | Matches: 500 ms rules, oldest slot, first on a tie. Differs only on send failure (SRC7-002) | | CL_UpdateVisiblePings_f | cl_main.c:3113-3214 | `updateVisiblePings` | Matches except X-001. Overflow pop order and untouched `visible` match | | CL_ServerStatus | cl_main.c:2655-2710 | `serverStatus` | Matches except X-002. Slot choice (cl_main.c:2625-2645) matches `statusSlot` | | CL_ServerStatus_f, response printing | cl_main.c:3220-3247, :2718-2790 | `serverStatusCommand`, `poll`, `statusText` | Matches: format strings, 8191-byte limit, separators | | fire_nail | game/g_missile.c:721-761 | ballistics-math.ts `q3NailVelocity`, missile.ts:480-487 | Matches: draw order (angle, u, r, speed), 8192*16, 555+random*1800, SnapVector, trTime = level.time, damage 20, 10000 ms, MOD_NAIL 23, and 15 shots at g_weapon.c:32 | | PS_ReadName | botlib/l_script.c:526-549 | ui/common/legacy/script/lexer.ts:940-953 | Matches. The limit is reached after storing the 1024th byte, on both sides | | AAS_PresenceTypeBoundingBox | botlib/be_aas_sample.c:73-89 | bot-navigation-syscalls.ts:123-128 | Case 305 matches. Case 318 is SRC7-006 | | AAS_PointReachabilityAreaIndex | botlib/be_aas_sample.c:266-301 | bot-navigation-syscalls.ts:210-222 | Matches except the portal throw (SRC7-006). The C really does index `portals[-cluster]` with the already reassigned, positive cluster | | PC_LoadSourceHandle, PC_FreeSourceHandle, PC_ReadTokenHandle, PC_SourceFileAndLine | botlib/l_precomp.c:3116-3197 | client-script-syscalls.ts, script-record.ts | Matches: slots 1 to 63, 0 on failure, free returns 0 or 1, StripDoubleQuotes, field order. `filename.slice(0, 64)` was not compared with `source_t.filename`; it only affects a diagnostic string | | R_InitFogTable | renderer/tr_image.c:1953-1965 | fog.ts `FOG_TABLE` | Matches. sqrt stands in for `pow(x, 0.5)`, assigned to float | | R_FogFactor | tr_image.c:1976-2000 | fog.ts `fogFactor` | Matches line for line | | R_CreateFogImage | tr_image.c:2009-2042 | fog.ts `createFogTexture`, render/scene/world.ts:202 | Matches, 256x32, RGB 255, alpha `255*d`, clamp | | R_LoadFogs | renderer/tr_bsp.c:1529-1617 | fog.ts `prepareFogVolume` | Matches. The port omits `tr.identityLight`, but overbright bits are fixed at 0 and no production caller sets identityLight, which equals id's non-overbright case. It also rejects a brush with under six sides where id checks only the global side count; that needs a malformed BSP | | qsort | game/bg_lib.c:40-190 | team-arena/match.ts:108-165 | Matches: thresholds 7 and 40, med3, partition, insertion fallback, tail iteration | | BoxOnPlaneSide fast path | game/q_math.c:745-758 (SRC7's path omits `game/`) | presentation/mark-projector.ts:57-65, core/math.ts:739 | Matches the C, with PlaneTypeForNormal at q_shared.h:1006. Note: the x86 asm at q_math.c:811-1042 reads only signbits and has no axial path, so an id386 build returns 3 where the C returns 2 at max == dist. The port follows the C branch | | Bullet endpoint | game/g_weapon.c:173-178 | ballistics-math.ts:7-12 | Matches, including the crandom order (u first) | | Shotgun endpoint | game/g_weapon.c:332-344, :358-360, bg_public.h:38-39 | ballistics-math.ts:13-23, hitscan.ts:187-192 | Matches: Q_crandom seed sequence (q_math.c:143-154), PerpendicularVector, snapped origin2, `rand() & 255` | Also checked: SRC7's Supplement is correct. foundation/monsters.ts:96 walks along `angles.y`, where quakec/ai.qc `ai_painforward` uses `ideal_yaw`. ## New mismatches
- Severity: Info
- Category: bug
- Location: app/bootstrap/q3-rankings.ts:83-87; content/q3/base/game/rankings.ts `weaponTime`
- Original: Q3 game/g_rankings.c:642-655
- Confidence: traced by search
- Evidence: `grep G_RankWeaponTime game/*.c` finds the definition only, so in id's source the function has no caller and `weapon_change_time` is never reset. The port calls `weaponTime` from its frame on each weapon change, with its own `since` timestamp.
- Impact: With an active rankings service, the report stream has extra `QGR_KEY_TIME*` integers. No public service exists, so this is not visible in normal use.
- Remediation: Remove the call, or keep it and mark it as deliberate.
