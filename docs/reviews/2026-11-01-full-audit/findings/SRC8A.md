# SRC8A — Bot library and Q3 game AI compared against the id originals
## Coverage
All comparisons opened `upstream/Quake-III-Arena/code` at HEAD fcdc8af5. **Coverage of the assigned scope is partial. The uncompared list below is exact.**

Port read in full and compared function by function with the original:
- `library/weights.ts` (1084) with `be_ai_weight.c` (912)
- `library/goals.ts` (1493) with `be_ai_goal.c` (from line 50). The save and restore code in goals.ts has no original to compare.
- `library/actions.ts` (344) with `be_ea.c` (508)
- `q3/ai-decision.ts` (1182) with `ai_dmnet.c` (from line 60)
- `q3/ai-combat.ts` (852), `ai-navigation.ts` (773), `ai-orders.ts` (515) with `ai_dmq3.c` (lines 116-5460)
- `q3/ai-team.ts` (449) with `ai_team.c`. Lines 60-330 of the original were checked only for BotSortTeamMatesByTaskPreference; the order functions from line 330 on were compared in full.
- `q3/ai-voice.ts` (225) with `ai_vcmd.c`
- `q3/ai-chat.ts` (391) with `ai_chat.c`
- `q3/ai-command.ts` (799) with `ai_cmd.c`
- `q3/ai-input.ts` (142) with the view and usercmd functions of `ai_main.c`
- `q3/arsenal-knowledge.ts` (156, outside the glob, read because it replaces WP_* tests from `ai_dmq3.c` and `be_ai_weap.c`)

Compared in part:
- `q3/ai-main.ts` lines 30-567 with `ai_main.c` about lines 330-1560. Not compared: the remainder of BotInitLibrary and BotAISetup through the end of `ai_main.c`.
- `library/weapons.ts` lines 623-802 and 1023-1242 with all of `be_ai_weap.c`. Lines 1-622 and 803-1022 not read.
- `library/character.ts` lines 340-489 and 500-854 with `be_ai_char.c` from line 195. Lines 1-339 not read.
- `library/chat.ts` lines 301-321, 374-408, 972-1033, 1094-1150, 1221-1249, 1255-1294 with `be_ai_chat.c` lines 1090-1510 and 2258-2860. The rest of chat.ts not compared.

Not compared:
- `be_ai_move.c` (3610): no port exists under `library/` or `q3/ai-*.ts`. The port is `q3/movement-state.ts` and `q3/travel/**`, outside the assigned globs. Neither side was read.
- `l_precomp.c` (3228), `l_script.c` (1433): only PC_ExpectTokenType (`l_precomp.c:2810-2856`) was opened. The port is `src/ui/common/legacy/script/**`, outside the assigned globs. `library/script-sources.ts` (220) not read.
- `library/chat-data.ts` (973): only lines 626-631. So the synonym, random-string, reply-chat and match-template parsing against `be_ai_chat.c` lines 300-1090, 1510-2258 and 2860-3017 is uncompared.
- `library/bsp-entities.ts`, `call-steps.ts`, `genetic.ts`, `libvars.ts`, `log.ts`, `memory.ts`, `structure.ts`: not read.
- `q3/ai-definitions.ts` (constant values checked only where used), `q3/ai-context.ts` (only 212-240), `q3/ai-state.ts` (only 582-605).

Candidates tried and refuted, so they are not reported:
- `evaluateUndecided` for item goals is correct. RANDOMIZE is defined at `be_interface.h:33`, which enables UNDECIDEDFUZZY at `be_ai_goal.c:50-52`.
- `navigation.area(0)` does not throw (`q3/navigation.ts:67-69`), so the many `reachable(state.areaNum)` and jump-pad calls on area 0 are safe.
- `botChatHitNoKill`'s "requires an enemy client" throw (ai-chat.ts:344): `GameEntity.client` is never reset to null after a disconnect, so a former enemy still has a client.
- `aiNodeSeekActivateEntity`'s "cleared the source activation stack" throw (ai-decision.ts:785): the top of the stack is always in use while the node runs.
- The `weaponInfo` throw in `botAimAtEnemy` and `botCheckAttack` for weapon 0: `chooseWeapon` never returns 0 natively (see SRC8A-003). The remaining route is a bot whose weapon is raising or dropping while `weaponNum` is still 0, which I could not construct in native play.
- `activationWeapon`'s `gravity === 0` filter (arsenal-knowledge.ts:97) removes nothing from id's list: a grep of `botfiles/weapons.c` in baseq3 pak0 found no non-zero gravity. The same check on missionpack returned nothing, and I did not confirm that pak path exists.
- The arsenal `candidates` cache is empty before the first refresh, so `aggression` returns 0 then. Natively a bot holds only the machinegun and gauntlet at that point, and id also returns 0.
- Rankings throws are already refuted in GAPBOTS; the ai-command throws are BOTS-002 and BOTS-003; the quoted-command throw is BOTS-015; the signed-char offset is BOTS-001; the activation chain is BOTS-014; the chaingun aim penalty is GAPBOTS-004; the carrier range clamp is GAPBOTS-003.

## Strengths
- The compared code is a very close translation. Decision nodes, team order tables, voice commands, chat conditions, goal selection and fuzzy evaluation matched branch by branch, including call order for random numbers.
- Source bugs are kept deliberately and often commented: `inventory[INVENTORY_ROCKETS < 10]`, `middle = mins + mins`, the `fs2,fs2` interbreed call, `abs(forward[2])` truncating upmove, int truncation of `enemyvisible`, `WEAPON_OFS(model)` in the projectile table, `lasthurt_client` passed as a means of death, and the 1FCTF `teammates[0]` voice target.
- All order routines in `ai-team.ts`, including each fraction, cap and voice target, matched despite being folded into shared helpers.
- Additions (scripted orders, source pickups, arsenal knowledge) are separated from the translated paths and inactive in native play unless selected.

## Findings
### SRC8A-001 — `bot_report 1` ends the process on the first bot frame where id prints an empty goal name
- **Verification (VERIFY-Y): confirmed-with-changes. Final severity: Medium.** Reproduced live (`crash3.ts`): `bot_report` set, then `addbot`, throws out of `Application.step` at ai-main.ts:94 via :145, :438, director.ts:206. Correction: "with any bot present" is too broad; setting it on a settled bot with a goal did not throw in 60 steps (`crash2.ts`). It needs an empty goal stack with `ltgType` 0, as on a new bot. Cheat-only (ai_main.c:1649).
- Severity: Medium
- Category: robustness
- Location: src/bots/behavior/q3/ai-main.ts:94, :138-146, :438; src/bots/behavior/director.ts:206. Original: code/game/ai_main.c:524-526 (BotSetInfoConfigString default case: `trap_BotGetTopGoal(bs->gs, &goal); trap_BotGoalName(goal.number, ...)`, printed with `"roaming %s"`) and ai_main.c:1399 (BotAIStartFrame `if (bot_report.integer)`).
- Confidence: reproduced (component stub calling `botUpdateInfoConfigStrings` from the clean checkout)
- Evidence: `if (goal === null) throw new Error("BotSetInfoConfigString reads an uninitialized source goal when the goal stack is empty");`. Repro output: `Error BotSetInfoConfigString reads an uninitialized source goal when the goal stack is empty`. Trace: `startFrame` calls `botUpdateInfoConfigStrings` before any AI runs (ai-main.ts:438). Any in-use bot with `ltgType` 0 and an empty goal stack takes the default branch. That is the normal state of a newly added bot and of one just reset by AIEnter_Respawn. `director.frame` has only `try/finally` (director.ts:206), so the error reaches the run loop (APP-001). In C the unset goal number finds no level item, so BotGoalName normally yields "" and the string reads "roaming ".
- Impact: with cheats enabled (`bot_report` is a cheat cvar, ai-main.ts:36, `sv_bot.c:502`), setting `bot_report 1` with any bot present exits the server or game. Reach is limited to cheat-enabled sessions.
- Remediation: when the stack is empty, report "roaming " with an empty name instead of throwing.

### SRC8A-002 — A non-integer number where a botfile requires an integer throws RangeError instead of failing the load
- **Verification (VERIFY-Y): confirmed. Final severity: Medium.** `w.ts` rerun: `case 1.5` and `switch(1.5)` give RangeError, not WeightConfigError (weights.ts:444, lexer.ts:26-32). goals.ts:846 and weapons.ts:1071 rethrow it, so catalog.ts:219's dropClient path is not reached. chat-data.ts:629 throws the same class and `failedWith` is false. C returns qfalse (l_precomp.c:2831-2844). Needs malformed pak content.
- Severity: Medium
- Category: robustness
- Location: src/bots/behavior/library/weights.ts:444; src/ui/common/legacy/script/lexer.ts:26-32; src/bots/behavior/library/goals.ts:846; src/bots/behavior/library/weapons.ts:1071; src/bots/behavior/q3/catalog.ts:219-222; src/bots/behavior/library/chat-data.ts:629. Original: code/botlib/l_precomp.c:2810-2856, be_ai_weight.c:163 and :191-195, be_ai_goal.c:1697-1702, be_ai_weap.c:372-377, be_ai_chat.c BotLoadMatchTemplates.
- Confidence: reproduced for weights.ts; plausible for chat-data.ts (line 629 read, its callers' catches not fully traced)
- Evidence: `if ((token.flags & NumberFlag.Integer) === 0) scriptNumberSubtypeName(NumberFlag.Integer);`. The call's result is discarded, and for Integer alone that helper throws `RangeError("expected numeric subtype diagnostic reads an uninitialized source string")`. Repro with `switch(1) { case 1.5: ...` and with `switch(1.5)`: `RangeError ... WeightConfigError=false`, while `case abc:` gives a proper `WeightConfigError`. `isSourceFailure` (weights.ts:1038-1039) rejects it, `loadItemWeights` and `loadWeights` rethrow anything that is not a weight error, and I found no `catch` in catalog.ts or director.ts. In C, PC_ExpectTokenType formats a message from a partly uninitialized buffer, calls SourceError and returns qfalse. ReadWeightConfig then returns NULL, BotLoadItemWeights prints "couldn't load weights", BotAISetupClient returns false and the bot is dropped. `chat-data.ts:629` uses the same pattern for integer fields in match files.
- Impact: one float literal in a `case` or `switch` of a third-party bot weight file turns a failed `addbot` into a process exit. It requires malformed content in a pak, not network input.
- Remediation: report this as an ordinary script error with a fixed message (`this.fail(...)` in weights.ts) so the load fails through the existing path, and do the same in chat-data.ts.

### SRC8A-003 — `chooseWeapon` falls back to another weapon on a premise the original does not contain
- **Verification (VERIFY-Y): confirmed. Final severity: Info.** arsenal-knowledge.ts:136-142 claims a source gauntlet default. be_ai_weap.c:419-433 starts `bestweapon = 0` and returns it, ai_dmq3.c:1574-1578 selects that value, and grep finds no `BotChooseFightWeapon` in game or botlib.
- Severity: Info
- Category: docs
- Location: src/bots/behavior/q3/arsenal-knowledge.ts:136-142. Original: code/botlib/be_ai_weap.c:419-433, code/game/ai_dmq3.c:1574-1578.
- Confidence: traced
- Evidence: the comment says `Source BotChooseFightWeapon defaults to the gauntlet; weapon 0 has no weapon info.` BotChooseBestFightWeapon starts `bestweapon = 0` and returns 0 when no weight is positive. BotChooseWeapon stores that and calls EA_SelectWeapon with it. The port instead picks an owned melee weapon, then any owned weapon with ammo, then any valid weapon, even an unowned one.
- Impact: none in stock data as far as I can tell, because a gauntlet holder has a positive weight (from memory of the stock weight files, not opened). With a mod whose weights are all zero, the bot requests a different weapon than id would. The comment misattributes the behaviour to id.
- Remediation: correct the comment to say this is a deliberate guard against weapon 0 having no info.
