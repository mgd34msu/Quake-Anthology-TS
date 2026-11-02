# GAPBOTS — Line-by-line read of the src/bots code that BOTS round 1 sampled or skipped

## Coverage
HEAD fcdc8af5. About 11,700 lines read line by line this round.

Read in full:
- q3 (7,923 lines): ai-decision.ts 1182, ai-definitions.ts 347, ai-combat.ts 852, ai-navigation.ts 773, ai-state.ts 877, ai-command.ts 799, ai-team.ts 449, ai-orders.ts 515, ai-chat.ts 391, ai-voice.ts 225, ai-context.ts 242, observations.ts 110, ai-input.ts 142, source-game.ts 81, game-host.ts 126, navigation-services.ts 34, arsenal-knowledge.ts 156, travel/ground.ts 229, travel/special.ts 393
- library (1,837 lines): goals.ts 1493, actions.ts 344
- navigation (1,319 lines): aas-reachability.ts 168, aas-reachability-special.ts 531, aas-cluster.ts 474, train.ts 31, helpers.ts 50, movement.ts 65
- rerelease: world.ts 196, data/knowledge.ts 110-557 (completes round 1's 1-110)

Read in part:
- library/weapons.ts 560-1242 of 1242 (config binding, parser, WeaponAi logic). The first 559 lines of cell and struct views were not read.
- library/character.ts 340-519 and 755-814 of 854 (load, bounded getters, interpolation, cache). The file parser was not read.
- library/bsp-entities.ts 150-388 (completes round 1's 1-150). rerelease/profile.ts 55-95, same range as round 1.
- travel/controller.ts, read again at 112-140 and 292-310 to trace mover paths. Round 1 read it in full.

Not read, so nothing is claimed about them:
- navigation/aas-reachability-geometry.ts 662, aas-reachability-spatial.ts 288, aas-reachability-types.ts 59, aas-optimize.ts 52. Only tools/navigation/aas.ts builds reachability, so these do not run in the game.
- library/libvars.ts 320, library/call-steps.ts 37, weapons.ts 1-559, about 614 lines of character.ts
- rerelease/data/botdata.ts 1038 (mostly data tables), data/knowledge-q2.ts beyond line 40, q2-exports.ts
- q3/navigation-types.ts 140, q3/travel/types.ts 67, q3/info.ts 6

Rerelease brain.ts was read in full in round 1, so it was not read again.

Method and its limit: no botlib or game C source exists on this machine. `find` found no be_ai_*.c or ai_dm*.c, and ~/Projects/quake-anthology-c is a port of this TypeScript, so it cannot serve as a reference. Comparisons with ai_dmnet.c, ai_dmq3.c, ai_cmd.c, ai_team.c, ai_vcmd.c, ai_chat.c, ai_main.c, be_ai_goal.c, be_ai_move.c, be_ea.c, be_aas_reach.c and be_aas_cluster.c rely on my recollection of those files. Each port finding says how much of it depends on that recollection.

Experiments are in `<scratchpad>/gapbots/`, run against `<scratchpad>/clean`: suicidal.ts, perf.ts, perf2.ts, scan.py (read-only scan of <game-data>/q3a).

Candidates I tried to confirm and dropped:
- Thrown errors in botIsFirstInRankings, botIsLastInRankings and the ranked-client helper (ai-chat.ts:57,69,82) and in botClientTravelTimeToGoal (ai-team.ts:58), which C reaches with an unchecked BotAI_GetClientState. I suspected a client that is still connecting. Refuted for the native runtime: `admitPlayer` calls `admission.connect` then `admission.begin` in one step (src/app/bootstrap/simulation/q3/runtime.ts:652-654), and disconnect clears the configstring (client-admission.ts:365), so a slot with a configstring always has a present entity.
- Bots sending `vtaunt` in baseq3 team games (ai-chat.ts:222,232,255,287,357), which I recall as MISSIONPACK-only in C. The baseq3 cgame discards the resulting `vchat` (presentation/server-commands.ts:371-372), so nothing observable changes.
- Q2 `gameMode` starting from "dm" while `BotGameType.Deathmatch` is "deathmatch" (knowledge.ts:328). brain.ts:1117-1132 tests only team and coop types, and Q2 sets `hasTeams` explicitly.

## Strengths
- The port is close to line-for-line. In ai-decision, ai-combat, ai-navigation, ai-orders, ai-team, ai-command, ai-voice, ai-chat, ai-input, goals, actions, travel/ground, travel/special, aas-reachability-special and aas-cluster, I found two logic differences from my recollection of the source (GAPBOTS-003, GAPBOTS-004) and one missing statement (GAPBOTS-001).
- Source quirks are kept on purpose and commented, for example `inventory[INVENTORY_ROCKETS < 10]` (ai-combat.ts:378), the `i+1` in NumPlayersOnSameTeam (ai-command.ts:146), integer `abs()` in BotTravel_Elevator (special.ts:26), `mins + mins` in BotItemGoalInVisButNotVisible (goals.ts:1282), and the int-truncated visibility float (ai-combat.ts:546).
- Inherited C undefined behavior becomes an explicit failure rather than garbage. That is good for correctness, though under APP-001 each such throw ends the process.
- Goal, weapon and character loaders use generation and revision checks, so a shutdown during a load cannot publish stale state.
- A scan of the 100 retail BSPs under qfiles/q3a found no func_plat or func_bobbing with a spawn filter key, so GAPBOTS-002 does not fire on retail content.

## Findings

### GAPBOTS-001 — The suicidal-fight flag is never cleared, so one "no way out" stops a bot retreating from fights until the map ends
- **Verification (VERIFY-Q): refuted. Final severity: Info.** The recalled clear does not exist. `AIEnter_Battle_Fight` has no `bs->flags &= ~BFL_FIGHTSUICIDAL`. The whole game has one setter (`game/ai_dmnet.c:1978`) and one reader (:2126); the flag only resets through `BotResetState` (for example `AIEnter_Intermission`, :1133). The latch is id's behavior, faithfully ported. Whether to fix it is a design choice, not a port defect. Source review: SRCQ3
- Severity: Medium
- Category: bug
- Location: src/bots/behavior/q3/ai-decision.ts:279-288, 1014 (flag defined at ai-definitions.ts:20)
- Confidence: reproduced (the latch, with `gapbots/suicidal.ts`). That C clears the flag is from memory of ai_dmnet.c.
- Evidence:
  ```ts
  export function aiEnterBattleFight(context, state, reason) {
    botRecordNodeSwitch(context, state, "battle fight", "", reason);
    context.library.moveStates.resetLastAvoidReach(state.ms);
    state.aiNode = "battle-fight";
  }
  export function aiEnterBattleSuicidalFight(context, state, reason) {
    aiEnterBattleFight(context, state, reason);
    state.flags |= BotFlag.FIGHTSUICIDAL;
  }
  ```
  As I recall ai_dmnet.c, `AIEnter_Battle_Fight` ends with `bs->flags &= ~BFL_FIGHTSUICIDAL;` and only `AIEnter_Battle_SuicidalFight` sets it. Whatever the source says, the TS has one setter (line 287), one reader (line 1014) and no clear anywhere: `grep -rn FIGHTSUICIDAL src tests` returns only those two lines plus the definition. Only `resetDecisionState` clears it, through the byte fill at intermission. The script printed `FIGHTSUICIDAL = true` after seek-ltg, after a normal `aiEnterBattleFight`, after `aiEnterRespawn`, and after the next life's fight.
- Impact: the setter runs when `botLongTermGoal(..., retreat=true)` returns false (line 1108), which happens when the bot has no item goal available. From then until intermission, `aiNodeBattleFight` skips its "wants to retreat" exit at line 1014 for that bot, including across deaths. In CTF, a flag carrier that entered a fight stays in it instead of running home. Bots low on health stop disengaging. The seek-ltg entry path at line 919 still retreats, so the effect is partial, and it builds up over a long map.
- Remediation: add `state.flags &= ~BotFlag.FIGHTSUICIDAL` to `aiEnterBattleFight` before the suicidal variant sets it. Add a transition test for it.

### GAPBOTS-002 — A func_bobbing reachability whose entity is absent ends the process where C printed a message and continued
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** `BotFuncBobStartEnd` prints and returns with `origin` untouched (`botlib/be_ai_move.c:2270-2276`), and callers use their local (:2329, :2487). The port's throw replaces use of an uninitialized value. Source review: SRCQ3
- Severity: Medium
- Category: robustness
- Location: src/bots/behavior/q3/travel/special.ts:110-112, 136, 170, 209; also 18 (spawn filter at src/content/q3/base/game/spawn.ts:198-206; model lookup at navigation-services.ts:23-32)
- Confidence: traced. Retail content does not trigger it (scan.py: 100 maps, 0 filtered movers). No custom map was run.
- Evidence:
  ```ts
  if (origin === null) {
    context.print(1, `BotFuncBobStartEnd: no entity with model ${model}\n`);
    return { start: vec3(0, 0, 0), end: vec3(0, 0, 0), origin: null };
  }
  ...
  if (bob.origin === null) throw new Error("BotTravel_FuncBobbing consumes an undefined mover origin");
  ```
  `funcBobStartEnd` prints the source's diagnostic and returns, then the caller throws at line 170 once the bot is more than 64 units from `reach.end`, which is the normal approach. `modelInfo` returns null when no present entity has that inline model. `spawn.ts:198-206` removes entities with `notfree`, `notteam` or a non-matching `gametype` key, while the AAS file is built from the BSP and keeps the reachability. `TravelFlags.FUNCBOB` is in the default travel flags (`DEFAULT: 0x011c0fbe` includes `FUNCBOB: 0x01000000`, navigation-types.ts:21,23), and only q3tourney6 and mpq3tourney6 strip it (ai-navigation.ts:423,446). No outer guard exists (APP-001, BOTS-001). The elevator path is safer: `onMover` and `moverDown` tolerate null (controller.ts:119-131), so the bot just waits, though `finishTravelElevator` can still reach the throw at special.ts:18.
- Impact: a custom map with a gametype-filtered func_bobbing and an AAS file that routes across it kills the server when the first bot paths over it in that game type. The C code printed a message and used an undefined origin.
- Remediation: treat a missing mover as a failed reachability (set `result.failure`, or clear `reachabilityTime`) rather than throwing. This also replaces the undefined origin with defined behavior.

### GAPBOTS-003 — BotNearbyGoal's "carrier near base" range clamp covers only CTF
- **Verification (VERIFY-Q): refuted. Final severity: Info.** The condition is `if (BotCTFCarryingFlag(bs))` alone (`game/ai_dmnet.c:197`), with no 1FCTF or Harvester alternatives and no `MISSIONPACK` branch. The port matches. Source review: SRCQ3
- Severity: Low
- Category: bug
- Location: src/bots/behavior/q3/ai-decision.ts:138
- Confidence: plausible (depends on my recollection of ai_dmnet.c)
- Evidence:
  ```ts
  if (botCTFCarryingFlag(context, state) && travelTime(context, state, state.teamGoal, TravelFlags.DEFAULT) < 300) range = 50;
  ```
  As I recall the source, the condition is `BotCTFCarryingFlag(bs) || Bot1FCTFCarryingFlag(bs) || BotHarvesterCarryingCubes(bs)` with the last two under `#ifdef MISSIONPACK`. Nearby code keeps those alternatives (`carryingObjective`, ai-combat.ts:224-227).
- Impact: Team Arena only. `objectiveNearbyRange` already returns 50 for a 1FCTF carrier, so the visible change is a Harvester cube carrier within 3 seconds of the base using range 80 instead of 50, and detouring slightly more.
- Remediation: use `carryingObjective` here after checking against the source.

### GAPBOTS-004 — The aim-distance penalty is selected by "instant hit, not melee" rather than the source's four weapons, so the chaingun gets it too
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** The source names exactly four weapons: machinegun, shotgun, lightning, railgun (`game/ai_dmq3.c:3516-3519`). The chaingun is not among them, so the port's speed test does differ on Team Arena. Source review: SRCQ3
- Severity: Low
- Category: bug
- Location: src/bots/behavior/q3/ai-combat.ts:600-602
- Confidence: traced for the TS. The source list is from memory of ai_dmq3.c.
- Evidence:
  ```ts
  if (weapon.speed === 0 && !context.game.knowledge.tactics(state.weaponNum).melee) {
    aimAccuracy = f(aimAccuracy * f(f(0.6) + f(f(Math.min(length3(direction), 150) / 150) * f(0.4))));
  }
  ```
  As I recall, C tests `WP_MACHINEGUN || WP_SHOTGUN || WP_LIGHTNING || WP_RAILGUN`. The generalization was presumably made to support foreign arsenals, and it also captures WP_CHAINGUN and any other zero-speed weapon in Team Arena.
- Impact: Team Arena bots using the chaingun at close range lose up to 40% aim accuracy relative to the source. This is a small balance shift, with no effect in baseq3.
- Remediation: when `personalityRole` is a native weapon, test the four source roles, and use the speed test only for roleless foreign weapons.

### GAPBOTS-005 — Source pickup goal bindings grow for the whole map, and each candidate scans all of them
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** No source claim to settle. Not re-tested. Source review: SRCQ3
- Severity: Low
- Category: leak
- Location: src/bots/behavior/library/goals.ts:1365, 1372-1376 (cleared only at 981, 1067, 1073)
- Confidence: traced
- Evidence:
  ```ts
  let binding = [...this.sourceGoals.values()].find(binding => binding.actor.equals(current.actor));
  ...
  const number = this.nextSourceGoal--;
  this.sourceGoals.set(number, binding);
  ```
  A binding is added for each distinct pickup actor offered as a candidate and is removed only by `shutdown`, `rebindWorld` or `initLevelItems`. Actors of removed items keep their entries. `checkpoint` also serializes all of them (goals.ts:656).
- Impact: applies only when an arsenal binding supplies `pickups` (source-game.ts:22). Retention scales with dropped and respawned pickup actors per map, and `chooseItem` cost grows with candidates times bindings, running up to every 0.5 seconds per bot from seek-ltg. Save size grows as well. The reset at map change bounds it to one map, which is why this is Low.
- Remediation: index bindings by actor key, and remove a binding when `inspect` reports its actor gone.

### GAPBOTS-006 — Every bot-side entity query deep-copies EntityState and PlayerState, including 1,024 slots per botlib frame
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** No source claim to settle. Not re-tested. Source review: SRCQ3
- Severity: Low
- Category: performance
- Location: src/bots/behavior/q3/source-game.ts:56-58; ai-main.ts:467, 499; ai-combat.ts:68-71; navigation-services.ts:16-32; observations.ts:86-88
- Confidence: traced for the call sites. The per-operation costs are reproduced by micro-benchmark (`gapbots/perf.ts`, `perf2.ts`). No full frame profile was taken.
- Evidence:
  ```ts
  entity: number => {
    const entity = source.pool.at(number), client = entity.client;
    const observedState = entity.s.copy(), playerState = client?.ps.copy() ?? null;
  ```
  The copies happen before any caller can test `present`. `entityObservation` calls this for all `MAX_GENTITIES` slots each botlib frame and only then discards absent ones (ai-main.ts:467, 499-500). `entityIsDead` calls it per client in `botFindEnemy`, only to read `pmType`. `modelInfo` scans all slots on each `onMover`, `moverDown` or `moverBottomCenter` call, and `entityType(number)` copies a whole state to read one field in `grappleState`. Measured: `EntityState.copy` 1.00 us, `PlayerState.copy` 1.38 us, `observations.invalidate()` 61 us per frame (it reallocates 1,024 records with an object spread, observations.ts:86-88). `new BotGoalState` costs 2.13 us and `new BotActivateGoal` 7.28 us, because each builds accessor properties and a DataView for one think.
- Impact: about 1 ms of copying per botlib frame before any AI runs, plus roughly 2.4 us per client for each bot's dead check. That is modest against a 50 ms tick, but it is steady garbage on a process that runs for hours, and the source reads these fields in place.
- Remediation: split a cheap `present` and field accessor from the detached copy, and copy only on request. Have `invalidate` flip a generation or mutate in place.

### GAPBOTS-007 — A bot_* cvar longer than 255 characters throws from the bot frame
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** `Cvar_Update` raises ERR_DROP at the same bound (`qcommon/cvar.c:871-875`, `game/q_shared.h:968`), which ends the map and not the process. Source review: SRCQ3
- Severity: Low
- Category: robustness
- Location: src/bots/behavior/q3/ai-context.ts:65 (polled at ai-main.ts:437; same check at src/core/cvars/index.ts:122)
- Confidence: traced. Not run. I did not confirm whether every console path permits a value this long.
- Evidence:
  ```ts
  if (source.value.length > 255) throw new RangeError("Bot cvar value exceeds source storage");
  ```
  `startFrame` calls `update()` on ten `bot_*` cvars each frame. In the real engine I recall the equivalent being `Com_Error(ERR_DROP)`, which ends the map but not the process.
- Impact: an operator or rcon user who sets such a cvar to an over-long string ends the process on the next frame (APP-001). It requires console or rcon access, so it is an operational hazard rather than a remote attack.
- Remediation: truncate like Q_strncpyz or reject the value at the cvar registry.

### GAPBOTS-008 — The decision network has no transition tests
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Low.** The test gap is real, but its motivating defect, GAPBOTS-001, is refuted. A transition test must not assert a clear that id never performs. Source review: SRCQ3
- Severity: Low
- Category: test-gap
- Location: src/bots/behavior/q3/ai-decision.ts; tests/bots/behavior/
- Confidence: traced
- Evidence: `grep -n "FIGHTSUICIDAL\|aiEnterBattleSuicidal\|aiEnterBattleFight" -r tests` returns nothing. tests/bots/behavior holds 2,149 lines, focused on save and restore, arenas, restarts and moving geometry. GAPBOTS-001 survived because no test drives a node sequence and asserts on flags.
- Impact: port errors in node transitions show up only as subtly wrong bot behavior.
- Remediation: add table-driven tests with a stub context that drive the `aiEnter*` and `aiNode*` sequences. `gapbots/suicidal.ts` shows how small the stub can be.

## Supplements
- Supplements BOTS-013: `createBotArsenalKnowledge.refresh` (arsenal-knowledge.ts:73, 93) rebuilds the candidate list on every `weaponInfo` and `chooseWeapon` call. For native Q3 that means a `weaponConfigView` and `freezeWeapon` for each weapon (source-game.ts:48-50), several times per fighting think (`botAttackMove`, `botAimAtEnemy`, `botCheckAttack`, `botChooseWeapon`). Separately, `updateEntityItems` runs `findLevelItem` per item entity (goals.ts:1243, 1248), allocating a `LevelItem` per list step.
- Supplements BOTS-017: `BotGoalLibrary.reported` (goals.ts:634, 1484) and `WeaponAi.reported` (weapons.ts:875, 1239) also append without a bound and are serialized by `checkpoint` (goals.ts:651, weapons.ts:908).
- Supplements BOTS-014: `botGetActivateGoal` can disable activation areas and then `continue` when `time === 0` (ai-navigation.ts:516-518). If the search then returns 0, `botAIBlocked` re-enables them (line 581), but `botAIPredictObstacles` has no else branch (line 614), and its local `activation` is discarded with the areas still disabled in routing. This matches my recollection of the C, so it is an inherited defect rather than a port error.
