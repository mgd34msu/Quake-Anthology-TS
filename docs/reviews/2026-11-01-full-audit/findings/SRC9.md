# SRC9 — The SRC8B and SRC8C not-compared lists, with the id originals open

HEAD fcdc8af5. Port paths are relative to the project root. Original paths are relative to `upstream/Quake-III-Arena/code/`. Nothing from upstream was executed. `.pk3` files were read only as data.

## Coverage
**Originals read line by line:**
- `botlib/be_aas_route.c` 628-1142.
- `botlib/be_aas_debug.c`, all 777 lines.
- `botlib/be_aas_entity.c` 50-437.
- `botlib/l_script.c` 30-240 and 1010-1433.
- `botlib/l_precomp.c` 30-304, 500-664, 1320-1623, 2170-2443, 2790-3158 and 3184-3228.
- `botlib/l_memory.c` 30-463, both the `MEMORYMANEGER` branch and the default branch.
- `botlib/be_aas_bspq3.c` 50-487.
- `COM_Compress` in `game/q_shared.c:315-381`.

**Originals opened as consumers, for the throw and value traces:**
- `botlib/be_ai_goal.c` 955-1115 and 1630-1668.
- `botlib/be_interface.c` 104-112 and 285-291.
- `game/ai_dmnet.c` 212-243 and 598-612.
- `game/ai_dmq3.c` 3335-3360 and 3395-3445.
- `game/ai_main.c` 1460-1560.
- `server/sv_bot.c` 253-277.

**Port files read in full:**
- `src/app/bootstrap/simulation/q3/guest-bots.ts` (145).
- `src/bots/navigation/index.ts` (21) and `entity-binding.ts` (8).
- `src/ui/common/legacy/script/lexer.ts` (1223), `preprocessor.ts` (1956), `memory.ts` (298), `precomp-memory.ts` (235), `source-memory.ts` (334) and `token-memory.ts` (280).
- `src/bots/behavior/library/bsp-entities.ts` (388) and `memory.ts` (159).

**Port files read in part:**
- `src/bots/behavior/q3/observations.ts` 1-110.
- `src/bots/behavior/library/goals.ts` 1205-1300 and 1342-1348.
- `src/bots/behavior/library/script-sources.ts` 95-112 and 170-205.
- `src/compat/qvm/bot-library-syscalls.ts` 30-60 and :138.
- `src/compat/qvm/bot-navigation-syscalls.ts` 110-122.
- `src/compat/qvm/bot-navigation-records.ts` 205-263.
- `src/compat/qvm/client-script-syscalls.ts` 60-90.
- `src/bots/navigation/estimate-aas.ts` cache lines 53-81.
- `src/content/q3/presentation/mission-hud.ts` 80-84, 252-255 and 294-302.
- `src/ui/common/legacy/menu.ts` 950-985 and 1282-1293.

**Not compared, with reason:**
- `be_aas_debug.c`: read, but the port has no counterpart to compare against (SRC9-007).
- `be_aas_route.c` 934-1134 (route cache file format): read, but the port has no file format to compare against (SRC9-006).
- `AAS_LinkEntityClientBBox`, `AAS_UnlinkFromAreas` and `AAS_BSPLinkEntity` inside `AAS_UpdateEntity`: the port has no AAS or BSP entity link lists. The port traces through the BSP, which SRC8C-007 already records as a design point. I did not compare the area links further.
- `AAS_NearestEntity` and `AAS_BestReachableEntityArea`: read, with no callers in `botlib`, `game` or `server` beyond their own file, so there is nothing to compare.
- `navigation/index.ts` is re-exports only. `entity-binding.ts` is a NAV2 helper with no Q3 original.
- `lexer.ts` counterpart of `l_script.c` 240-1010 and `preprocessor.ts` counterpart of the other `l_precomp.c` ranges: re-read for context only. SRC8C compared them.
- `be_aas_entity.c` and `l_*.c` licence headers (lines 1-30 or 1-49).
- The `DEBUG_EVAL` and `PC_PrintDefineHashTable` log text was read, not run. The `MEMDEBUG` label format in `memory.ts` has no default-build counterpart.

**Ran**, from `<scratchpad>/clean` with HOME and XDG under the scratchpad and SDL dummy drivers:
- `src9/live.ts`, unmodified, with 4 bots.
- `src9/live2.ts`, unmodified with 1 bot, and with the throw patched in memory with 4 bots.
- `src9/live3.ts`, patched in memory, with 8 bots added one at a time.
- `src9/pp.ts`, the preprocessor at component level.
- A scan of the 14 installed `.pk3` files for `.rcd` files and for compress-sensitive script text.

All the live runs use the shipped LRCTF `vm/qagame.qvm` on q3ctf1, launched as a dedicated server bound to 127.0.0.1, the same launch as `tests/first-playable/application/q3-guest.test.ts:31`.

## Strengths
- `SourceScriptStorage.compress` matches `COM_Compress` byte for byte, including double-quote-only string handling and the unmoved `end_p`. As a result `EndOfScript` stays false at the terminator of a compressed script, and the "missing #endif" warning and pop do not fire, as in C (`src9/pp.ts`).
- `#if`, `#ifdef`, `#ifndef`, `#elif`, `#else` and `#endif` match `PC_Directive_*`, including the indent's owning script. `PC_DollarEvaluate` matches too, including ignoring what the first token is.
- `PC_DefineFromString` and global defines match. `A 1` then `A 2` gives 1, because the newest-first list is prepended into the hash, as in C.
- `PC_CopyDefine`, `FreeSource` order, `PC_NameHash` with signed characters, and `PC_SetIncludePath` with an empty path all match.
- `AAS_ParseBSPEntities`, `AAS_ValueForBSPEpairKey`, `AAS_VectorForBSPEpairKey` and `AAS_NextBSPEntity` match, including prepend order, 127-byte truncation, the entity text's NUL inside its length, no compress for memory scripts, and `sscanf` stopping at the first bad field.
- `BotMemory` matches the default `l_memory.c` build. The prefix ID decides whether a free does anything, so hunk frees are no-ops, and the debug printers stay silent unless a profile is present.
- The TypeScript game's entity table is correct: `BotEntityObservations.update(number, null, ...)` returns and keeps the record (`observations.ts:92`). SRC9-001 and SRC9-002 exist only in the guest copy.

Candidates tried and refuted, so not reported:
- High-byte entity text making `byteString` throw (`bsp-entities.ts:40`): `decode.ts:146` uses `fixedByteString`, so characters stay at or below 255.
- `ScriptGlobalDefines.remove` reaching a freed ID: this mirrors the C dangling pointer, and no production code calls it.
- `availableMemory()` throwing without a host: no production caller. `be_aas_route.c:1620` has no counterpart, because the port's cache has a byte cap instead.
- `resetHunk`, `dumpMemory` and `memoryByteSize` have no production callers. This is vestigial and already covered in kind by BOTS-022.
- `AasBspEntities.allocations` growing on reload: the stock game does not reload on restart (`BotAILoadMap`), and the guest runtime loads once per world.
- `stripQuotes` throwing on a lone quote: no reachable token has that shape.
- A `$evalint` at end of file gives "nothing to evaluate" rather than "no leading (": the same result, so only the message differs.
- A 303 read of a NULLed entity leading to NaN through `BotAimAtEnemy` after an enemy leaves: `BotEntityVisible` tests `valid` first in the stock fight node, as I recall it, and that function was not opened in this review. I do not claim this path.

## Findings
### SRC9-001 — Any QVM game with bots ends the process when a bot's item goal has been taken and its spot is in view
- **Verification (VERIFY-ZZ): confirmed. Final severity: High.** The crash is reproduced on a dedicated server, and no hostile input is needed. It needs an opt-in QVM mod plus bots, and peers can't add bots; built-in q3-baseq3 and q3-missionpack are unaffected. This report reserves Critical for what a remote peer can do in a realistic configuration, so it is High. VERIFY-Z judged it Critical as a normal-use crash and called that a close call. Anyone running a QVM mod with bots should treat it as a blocker.
- Severity: Critical
- Category: bug
- Location: src/app/bootstrap/simulation/q3/guest-bots.ts:72, :98; src/bots/behavior/library/goals.ts:1285; src/compat/qvm/bot-library-syscalls.ts:138; src/app/bootstrap/application.ts:4701 (run loop, per APP-001)
- Original: botlib/be_aas_entity.c:77-87; botlib/be_ai_goal.c:1655-1664; game/ai_dmnet.c:235, :604; game/ai_main.c:1464-1482; game/g_items.c:535
- Confidence: reproduced. Live run with shipped LRCTF bytecode and no test doubles. It reached `app.step` as a rejection. From there to process exit is the APP-001 trace.
- Evidence: C keeps the entity record when the game passes a NULL state: `AAS_UpdateEntity(entnum, NULL)` only unlinks it. `BotItemGoalInVisButNotVisible` depends on that, because reading a not-recently-updated record is how it detects a taken item:
  ```c
  AAS_EntityInfo(goal->entitynum, &entinfo);
  //if (!entinfo.valid) return qtrue;
  if (entinfo.ltime < AAS_Time() - 0.5)
      return qtrue;
  ```
  The guest port deletes the record, and the goal-world accessor throws when the record is missing:
  ```ts
  if (pointer === 0) { this.observations.delete(number); return 0; }
  entityInfo: number => { const info = this.observations.get(number); if (info === undefined) throw new Error(`Bot entity ${number} is not observed`); return info; },
  ```
  `goals.ts:1285` reads `this.world.host.entityInfo(goal.entity).lastUpdateTime`.

  The trigger is ordinary play. A pickup sets `SVF_NOCLIENT` (`g_items.c:535`), so the next `BotAIStartFrame` passes NULL (`ai_main.c:1472`). A bot whose goal is that item runs `BotReachedGoal`, whose trap at `ai_dmnet.c:235` reaches this line once the goal point is in view.

  Results on q3ctf1:

  | Run | Result |
  |---|---|
  | Unmodified, 4 bots | `Bot entity 124 is not observed` at frame 43, 2.15 simulated seconds |
  | Unmodified, 1 bot | `Bot entity 243 is not observed` at frame 527, 26.35 simulated seconds |
  | Throw patched in memory, 4 bots, 1400 frames | No throw; 73 reads hit a missing record, across 27 entities |
  | Throw patched in memory, 8 bots, about 100 simulated seconds | No throw |

  The stack is `entityInfo`, `itemGoalInVisButNotVisible`, `qvmBotLibrarySyscall`, `Q3GuestBots.syscall`, `Q3QvmServerGame.host`, `hostCall`, interpreter, then `app.step`. No frame catches it. Refutation attempted:
  - The TypeScript game does not hit this, because `director.ts:139` reads `BotEntityObservations`, which keeps records. This is why `q3-baseq3` is unaffected.
  - `q3-guest.test.ts:70-77` adds one bot and stops as soon as it moves, so no test reaches this path. `tests/bots/behavior/library/source-behavior.test.ts:105` has a fixture that throws on a missing entity in the same way.
- Impact: a dedicated or listen server running a QVM mod (LRCTF is the shipped case) with bots exits within seconds, dropping every client. Nothing hostile is needed. It also hides SRC7-001 in practice, since a match rarely lasts long enough to reach a powerup respawn.
- Remediation: keep the record when the state is NULL and mark it invalid, as `BotEntityObservations` does, and have `entityInfo` return a zero record for a never-seen number. Add a live guest test with bots that runs past an item pickup.

### SRC9-002 — Deleting the record also loses `update_time`, `lastvisorigin`, `number` and the stale fields that id's code reads
- **Verification (VERIFY-Z): confirmed-with-changes. Final severity: Medium.** guest-bots.ts:74-75 gives interval 0 and `lastVisibleOrigin === origin` after a delete or on first sight; be_aas_entity.c:89,:93 use the stale slot. Rerun of `live3.ts`: 140 zero-interval client reads and 0 NaN traces, the same as SRC9. Items 2 and 3 stand as written (goals.ts:1242, bot-navigation-syscalls.ts:118, be_aas_entity.c:341-349). Correction, the consequence is understated: a NaN aim point does not just misaim, it ends the process. world/collision/q3/world.ts:325 throws `RangeError: trace requires finite coordinates`, where C has no such guard. Fault injection in `zero.ts`, forcing the port's zero-interval record on every client read of the LRCTF bytecode (with the SRC9-001 throw patched), threw that RangeError at frame 410 through server-game-syscalls.ts:80. That proves the consequence, not its frequency. `nan.ts`: a NaN trace throws at start or end; a NaN velocity into prediction does not throw. Correction, the stated cause is wrong: SRC9 says NaN was absent "probably because new players hold the machinegun", but `wi` at ai_dmq3.c:3389 is the aiming bot's weapon. The real narrowing is :3395 (dist <= 100, or a stale `enemyorigin` from :3352-3356) plus a one-update window. The NaN in `enemyvelocity` is harmless (only :3364 compares it); the live path is :3432 to the trace at :3506 or the ground-target trace. Severity: stays Medium because natural reach is unproven. Two uninjected runs gave 0 throws: `live3.ts` (140 reads) and `zero.ts churn` (8 bots, 43 remove-and-add cycles, 2117 reads, 67.55 simulated seconds). SRC9-001 currently masks it. Raise to High if it is ever seen uninjected. The SRC9-001 remediation removes it only if never-seen slots also start from a zero record.
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/simulation/q3/guest-bots.ts:46-48, :52, :72, :74-75, :105; src/compat/qvm/bot-navigation-syscalls.ts:116-120; consumers src/bots/behavior/library/goals.ts:1226, :1242
- Original: botlib/be_aas_entity.c:89, :93, :171-187, :212-220, :261-279, :341-349; botlib/be_ai_goal.c:983-985, :1049-1051; game/ai_dmq3.c:3349-3350, :3409, :3432
- Confidence: reproduced that the QVM receives `update_time` 0 for clients (`src9/live3.ts`). The NaN and goal consequences are traced. No NaN reached a trace in that run.
- Evidence: separate from the throw in SRC9-001, and it remains if only that throw is fixed. C computes `ent->i.update_time = AAS_Time() - ent->i.ltime` and `VectorCopy(ent->i.origin, ent->i.lastvisorigin)` from whatever the slot last held. The port uses a fallback once the record is gone:
  ```ts
  lastVisibleOrigin: previous?.origin ?? state.origin,
  lastUpdateTime: time, updateInterval: time - (previous?.lastUpdateTime ?? time)
  ```
  1. **Zero interval.** In C, `update_time` is the positive gap since the last update. Here it is 0 on the first update after a NULL or on first sight. `ai_dmq3.c:3350` then computes `VectorScale(zero, 1 / 0)`, which is NaN in `enemyvelocity`, and `:3432` computes `0 / 0`, which is a NaN `speed`, so `VectorMA` makes `bestorigin` NaN for a projectile weapon at aim skill above 0.4. `live3.ts` counted 140 AAS_EntityInfo reads of a valid client with interval 0 in about 100 simulated seconds with 8 bots joining. A spectator joining, or a bot added in another bot's view, is the case. The run recorded 0 NaN trace endpoints, probably because new players hold the machinegun, which has no projectile speed. So the exposure is real but was not observed through to a NaN trace.
  2. **First-frame "still moving" test.** `be_ai_goal.c:1049-1051` skips an item whose origin differs from `lastvisorigin`. In C a new occupant of a slot usually differs from the stale origin, so a just-dropped item is skipped until it stops. Here `origin === lastVisibleOrigin` on its first frame, so `goals.ts:1242` accepts it and allocates a level item at the launch point, with its goal area taken from there. `moveItem` corrects it after landing.
  3. **NULLed reads.** C returns stale fields with `valid == 0` and `number == entnum` (`AAS_InvalidateEntities` sets it). The port zero-fills 140 bytes (`bot-navigation-syscalls.ts:118`), so `number` reads 0, which is client 0. `AAS_EntityModelindex` and `AAS_EntityType` return 0. `modelInfo` requires a live valid record, while `AAS_OriginOfMoverWithModelNum` scans invalid entities too and uses the last known origin, so an unlinked mover gives `null` here where C has an origin.
- Impact: bots can get a NaN aim point against a player who just appeared, dropped weapons become goals for the length of their fall, and a mod reading `entinfo.number` for a departed entity gets client 0. No retail consumer of the zero fill was found to misbehave.
- Remediation: the fix in SRC9-001 resolves all three. A never-seen slot should start with origin zero and `ltime` zero, as `emptyInfo` does.

### SRC9-003 — The guest entity table is never invalidated per frame, and `BotLibUpdateEntity`'s guards are missing
- **Verification (VERIFY-Z): confirmed. Final severity: Low.** bot-library-syscalls.ts:54 calls library.ts:141-145, which only stores the time, and guest-bots.ts:71-75,:81 never clear `valid`; be_aas_main.c:242-244 invalidates each frame. Guards are absent at bot-library-syscalls.ts:56 (be_interface.c:285-291, be_aas_entity.c:69-73). ai_main.c:1456-1526 updates or NULLs every entity right after start frame, so the stock game sees no difference. Addition: when not initialized, library.ts:142 throws where C returns BLERR_LIBRARYNOTSETUP. No stock path reaches it.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/simulation/q3/guest-bots.ts:71-75, :79-83; src/compat/qvm/bot-library-syscalls.ts:54, :56
- Original: botlib/be_aas_main.c:242-244; botlib/be_aas_entity.c:69-73, :341-349; botlib/be_interface.c:104-112, :285-291
- Confidence: traced
- Evidence: `AAS_StartFrame` runs `AAS_UnlinkInvalidEntities` and `AAS_InvalidateEntities`, so an entity the game does not update this frame is invalid. `BOTLIB_START_FRAME` goes straight to `library.startFrame`. Nothing in the guest clears `valid`, so a record stays valid until a NULL arrives, and `nextEntity` keeps returning it. C also returns `BLERR_LIBRARYNOTSETUP`, `BLERR_INVALIDENTITYNUMBER` or `BLERR_NOAASFILE`. The port returns 0 and stores any number in the Map. Refutation: stock `BotAIStartFrame` touches all `MAX_GENTITIES` with a state or NULL on each library frame (`ai_main.c:1462-1526`) and ignores the result, so the stock game sees no difference.
- Impact: only a mod that skips entities in that loop or reads the return value. It would see stale entities as live, with items and players still listed. The Map is bounded only by the numbers the mod passes.
- Remediation: invalidate in the guest's start-frame handling, using `BotEntityObservations.invalidate`, and apply the three guards.

### SRC9-004 — Mission HUD menus are read without `COM_Compress`, so comment and literal handling differs from `trap_PC_LoadSource`
- **Verification (VERIFY-Z): confirmed. Final severity: Low.** mission-hud.ts:80-84,:252-255 build plain text, and :295-299 pass it to loadMenuDefinitions, whose only production caller is that site; script-sources.ts:186 and client-script-syscalls.ts:78 compress, as does l_script.c:1367. Rerun of `pp.ts` reproduces all three table rows. New differential (`menus.ts`): 49 retail missionpack `ui/*.menu` files, with includes resolved, give 0 token and 0 diagnostic differences between plain and compressed, so retail is unaffected as claimed.
- Severity: Low
- Category: bug
- Location: src/content/q3/presentation/mission-hud.ts:80-84, :252-255, :297-299; src/ui/common/legacy/menu.ts:1285
- Original: botlib/l_script.c:1367; game/q_shared.c:315-381; cgame/cg_main.c:1374, :1376
- Confidence: reproduced at the preprocessor (`src9/pp.ts`). The mission HUD wiring is traced and was not run.
- Evidence: every other file path compresses (`script-sources.ts:186`, `client-script-syscalls.ts:78`). `scriptSource` builds `{ path, text }`, and the HUD resolver returns that for both the root and includes. C's cgame loads these through `PC_LoadSource`, which compresses.

  | Input | Port, plain text (HUD path) | With compress (C behaviour) |
  |---|---|---|
  | `#define X 1 /* a\n b */ 2`, then `X` | `2 1` | `1 2` |
  | `a '//' b` | `a '//' b c` | error: newline inside string |
  | `#ifdef Q\nz\n` with no `#endif` | warning "missing #endif" | no warning |

  Line numbers also differ, since C counts compressed lines. A scan of 519 `ui/`, `botfiles/` and `scripts/` text files across all installed paks found no `#define` with an unterminated comment on its line. The only single-quote `//` hits are in `botfiles/syn.c`, which uses the compressed path and is unaffected, so retail content does not differ.
- Impact: a mod HUD with a multi-line comment on a `#define` line expands differently, and one with `'//'` parses here where it fails in the original.
- Remediation: run the HUD bytes through `allocateScriptSource` and `compress`, as `client-script-syscalls.ts` does.

### SRC9-005 — A rotated brush entity reports its authored bounds where `AAS_UpdateEntity` reports radius bounds
- **Verification (VERIFY-Z): confirmed. Final severity: Info.** guest-bots.ts:73-74 copies state bounds; be_aas_entity.c:114-125 and sv_bot.c:262-273 use radius bounds when any angle is nonzero. sv_game.c:135-138 confirms r.mins comes from CM_ModelBounds, so unrotated models agree. :125-136 leaves other solids alone as stated. The only consumers found are BotEntityVisible (ai_dmq3.c:2834,:2918-2919) and guest-bots.ts:56.
- Severity: Info
- Category: bug
- Location: src/app/bootstrap/simulation/q3/guest-bots.ts:73-74, :56
- Original: botlib/be_aas_entity.c:114-125; server/sv_bot.c:262-273; game/ai_dmq3.c:2834, :2918-2919
- Confidence: traced
- Evidence: for `SOLID_BSP`, C ignores `state->mins` and `state->maxs` and calls `AAS_BSPModelMinsMaxsOrigin`, which returns `-radius` to `+radius` when any angle is nonzero. The port copies the state. The two agree for an unrotated model, because `r.mins` comes from the same `CM_ModelBounds`. C also leaves mins, maxs and angles alone for a solid value that is neither `SOLID_BBOX` nor `SOLID_BSP`. Stock code sets one of the two.
- Impact: `BotEntityVisible`'s sample points differ for a rotating or pendulum brush. No stock bot goal targets one, and I found no retail case.
- Remediation: for `solid === SOLID_BSP`, take the bounds from the model when the angles are nonzero.

### SRC9-006 — The route cache file has no port, so `bot_saveroutingcache` does nothing and clears itself
- **Verification (VERIFY-Z): confirmed. Final severity: Info.** `saveroutingcache`, `max_routingcache` and `.rcd` appear in src only at bots/behavior/q3/ai-main.ts:36,:259,:437,:449, so the variable is set and never read; be_aas_main.c:269-272 and be_aas_route.c:1241 have no counterpart. estimate-aas.ts:69-76 is a 16 MB LRU that evicts any entry, where be_aas_route.c:701-702 spares portal area caches. ai_main.c:1647 is CVAR_CHEAT. A recursive scan of 17 pk3 files under q3a (SRC9 counted 14) found 0 `.rcd`.
- Severity: Info
- Category: docs
- Location: src/bots/behavior/q3/ai-main.ts:36, :259, :449; src/bots/navigation/estimate-aas.ts:68-76
- Original: botlib/be_aas_route.c:695-727, :934-1134, :1241, :1243; botlib/be_aas_main.c:269-272; game/ai_main.c:1428-1430
- Confidence: traced
- Evidence: the cvar is forwarded to the `saveroutingcache` library variable, and nothing reads that variable, so no `.rcd` is written. `AAS_ReadRouteCache` has no counterpart, and 0 of the 14 installed paks hold a `.rcd`. The port's cache differs in three ways that cost time only: a fixed 16 MB rather than the `max_routingcache` library variable (default 4096 KB), LRU by map order rather than `time_next`, and it can evict area caches leading to a portal, which `AAS_FreeOldestCache` never frees. Results are pure functions of the area, goal and flags, so routes do not change.
- Impact: a user setting the cvar gets no file and no message. A custom map's `.rcd` is ignored, and its first routes are computed on demand. `bot_saveroutingcache` is marked as a cheat cvar in the original and is rarely used.
- Remediation: print that the cache is unsupported when the cvar is set, or remove the forwarding. No format port is needed.

### SRC9-007 — `be_aas_debug.c` has no port, so botlib debug drawing and the `visualize` prediction argument have no effect
- **Verification (VERIFY-Z): confirmed-with-changes. Final severity: Info.** the conclusion holds. There is no AAS_Show, AAS_Draw or AAS_DebugLine in src, BOTLIB_TEST returns 0 (guest-runtime.ts:379), `trap_BotLibTest` has no caller, the only AAS_PredictClientMovement caller passes qfalse (ai_dmq3.c:3416-3419), and be_ai_move.c:3346-3348 is `#ifdef`-gated. Correction: "no `DebugPolygon` code exists in src" is false as written. Hits are world/collision/q3/patch.ts:18, render/cpu/triangle-kernel.ts:4, content/q3/base/bot-debug.ts:2 and `debugLine` at content/q3/base/game/utilities.ts:60. These are collision, renderer and game-side helpers, not be_aas_debug.c.
- Severity: Info
- Category: docs
- Location: no `AAS_Show*`, `AAS_Draw*`, `AAS_DebugLine` or `DebugPolygon` code exists in src (grep); src/compat/qvm/bot-navigation-syscalls.ts:169 (syscall 318 decodes `visualize`)
- Original: botlib/be_aas_debug.c (all); botlib/be_aas_move.c:659, :807; botlib/be_ai_move.c:3346-3348; botlib/be_interface.c:351-352, :446-509
- Confidence: traced by grep. The port's `debugLines` in `simulation/runtime.ts` and `debug/` belong to the rerelease shape events and are unrelated.
- Evidence: the original's callers are the `BotExportTest` paths, the `#ifdef DEBUG_AI_MOVE` block in `BotMoveToGoal`, and `AAS_PredictClientMovement` when `visualize` is true. The stock game passes `qfalse`, and `trap_BotLibTest` is defined but never called. This is a developer feature with no gameplay effect.
- Impact: a map or bot author cannot see AAS areas or reachabilities through the port.
- Remediation: none needed for parity. If wanted, feed these through the existing `WorldDebugLineStore`.
