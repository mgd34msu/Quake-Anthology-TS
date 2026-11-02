# SRC8C — Remaining bot library, Q3 travel and script preprocessor code against the id originals

HEAD fcdc8af5. Port paths are relative to the project root. Original paths are relative to `upstream/Quake-III-Arena/code/`. Nothing from upstream was executed; `.pk3` files were only read as data. Experiments are in `<scratchpad>/src8c/` and ran from `<scratchpad>/clean` with HOME and XDG under the scratchpad and SDL dummy drivers.

## Coverage
**Compared, both sides read:**
- `q3/movement-state.ts` (348), `q3/travel/controller.ts` (385), `ground.ts` (229), `routing.ts` (130), `special.ts` (393), `types.ts` (67), plus `q3/navigation.ts` (336), `navigation-types.ts` (140) and `navigation-services.ts` (34), with `botlib/be_ai_move.c` lines 40-3610 in full. `AAS_AgainstLadder` and part of `AAS_OnGround` in `be_aas_move.c:123-197` were also opened. `AAS_PointInsideFace` was compared from memory, not opened.
- `q3/ai-main.ts` (567) with `game/ai_main.c` 1370-1695. This closes the part SRC8A left open.
- `q3/ai-state.ts` (877) and `q3/ai-context.ts` (242). The memset ranges in `resetDecisionState` were checked against the `BotResetState` field list from memory of `ai_main.c`; that function was not reopened because SRC8A compared it.
- `library/chat.ts` (1294) and `library/chat-data.ts` (973) with `botlib/be_ai_chat.c` 50-3017 in full.
- `library/weapons.ts` 1-622 and 803-1027 with `be_ai_weap.c` 50-380. SRC8A compared the rest.
- `library/character.ts` 1-345 with `be_ai_char.c` 50-199, and the `Characteristic` enum with `game/chars.h`.
- `library/genetic.ts` (184) with `be_ai_gen.c`; `libvars.ts` (320) with `l_libvar.c`; `log.ts` (226) with `l_log.c`; `structure.ts` (425) with `l_struct.c`. All in full on both sides.
- `library/call-steps.ts` (37): read. It has no original.
- `ui/common/legacy/script/lexer.ts` (1223) with `l_script.c` 240-1010.
- `ui/common/legacy/script/preprocessor.ts` 280-1956 with `l_precomp.c` 304-500, 664-1320, 1623-2170, 2443-2790 and 3158-3184.
- `library/script-sources.ts` (220) with the parts of `l_precomp.c` above. Its handle functions were compared only for `PC_ReadTokenHandle`.

**Compared in part:**
- `library/bsp-entities.ts` 40-300 with `be_aas_bspq3.c` from `AAS_NextBSPEntity` on. Lines 300-388 (the parse loop) were not read by me. SRC8B read this file in full.
- `library/memory.ts` 40-120 of 159. `l_memory.c` was only grepped for its IDs, so this is a check of heap and hunk free behaviour, not a line comparison.

**Not compared, exact list:**
- `l_script.c` 1-240 and 1010-1433 (checks, skip helpers, `StripQuotes`, script loading). The port's `readSigned*`, `stripQuotes`, and skip helpers were read but have no opened counterpart.
- `l_precomp.c` 1-304, 500-664, 1320-1623, 2170-2443, 2790-3158, 3184-3228. This includes `PC_Directive_if_def`, `else`, `endif`, `elif`, `PC_DollarEvaluate`, `PC_DefineFromString`, `PC_CopyDefine`, `LoadSourceFile`, `FreeSource`. Conditionals were exercised only by the script in `src8c/pp.ts`, and their expected results come from my memory of those functions.
- `preprocessor.ts` 1-279 (types and helpers).
- `ui/common/legacy/script/memory.ts` (298), `precomp-memory.ts` (235), `source-memory.ts` (334), `token-memory.ts` (280): not read. They model C layouts and have no direct original.
- `l_memory.c` body.

**Ran:** `src8c/admit.ts` (live `Application` on q3dm1, q3dm6, q3dm19, q3tourney6), `src8c/air.ts` (q3dm1, q3dm6), `src8c/pp.ts` and `pp2.ts` (preprocessor and chat component tests), `src8c/scan.py` and `grep2.py` (retail entity and script scans).

## Strengths
- The per-travel-type action routines match branch by branch, including source oddities: `abs()` truncation in `BotTravel_Elevator`, `dir` rather than `hordir` in `BotFinishTravel_FuncBobbing`, the doubled `ONTOPOF_FUNCBOB` test, `tries[1]` reading the first avoid spot in `BotResetLastAvoidReach`, and the discarded distance in `BotAvoidSpots`.
- `be_ai_chat.c` is a very close translation. `StringsMatch`, synonym replacement, `BotExpandChatMessage`, reply selection (including the bug where `--num` runs before the time test), the warning checks in `BotCheckValidReplyChatKeySet`, list insertion order, and the order of random draws all match.
- `l_precomp.c` expression evaluation matches in operator handling, priorities and reduction order, including the `++` report without error, the integer divide-by-zero test in float mode, and the `#elif` that ignores earlier branches. Empty-define expansion ending the read, nested `(` being dropped from macro arguments, and `#error` firing in skipped code are all kept.
- `genetic.ts`, `libvars.ts`, `log.ts`, and `structure.ts` have no behavioural mismatch in normal input. The unused weighted draw in `GeneticSelection` is kept. The `BotAISetup`, `BotInitLibrary`, and `BotAIStartFrame` remainder of `ai_main.c` matches.

Candidates tried and refuted, so not reported:
- `travelFlagForType` ignoring team bits matches the `tfl & TRAVELFLAG_NOTTEAM1` bug at `be_aas_route.c:174-177`.
- `runtime.ts:286` team checks: `team` is always null in production, as SRC8B found.
- `genetic.ts` `undefined-random-index`: C reads out of bounds there, and the only caller checks `kind`.
- Non-integer `max_weaponinfo`: `library.ts` truncates before `sourceCapacity`.
- `capacity()` treating 0 as 32 differs from C only for a value that would load no weapons.
- `messageText`, `appendVariables`, and the encoded-message throws in chat-data: each stands in for a C buffer overflow, and stock data stays well under 256 bytes.
- Teleporter, jump-pad, rocket-jump, BFG-jump, and grapple refusal in `travel()` and `edgeAllowed` is SRC8B-001. The 128-unit drop rule is SRC8B-002. Neither is repeated here.

## Findings
### SRC8C-001 — Reachability selection runs a simulated traversal the original does not have, so every lift and func_bobbing route is rejected
- **Verification (VERIFY-Y): confirmed-with-changes. Final severity: High.** Live: q3dm19 select chose 0 of 46 mover edges from their own start with goal beyond them, q3dm14 0 of 4; production chose 0 movers in 3189 selections, and still 0 with SRC8B-001/002 lifted (328 rejected), against 24 with the gate bypassed. Gate also rejects jump pads. Corrections: q3ctf4 has no AAS mover edge, so its bobbing model is no route; a bot that walks onto a bobbing model still rides it (controller.ts:303-305; FUNCBOB in 123/6900 moves); most `failure` churn comes from SRC8B-001/002, not this gate (2631 falls to 19 with the gate still on).
- Severity: High
- Category: bug
- Location: src/bots/behavior/q3/travel/routing.ts:124-126; src/bots/navigation/runtime.ts:347-389, :260-262; src/bots/navigation/movement.ts:42-59; src/app/bootstrap/simulation/navigation.ts:71-77; also src/bots/behavior/q3/travel/controller.ts:160, :333
- Original: botlib/be_ai_move.c:744-815 (`BotGetReachabilityToGoal`), :1049-1092 (`BotCheckBarrierJump`), :3219 (the only validity test on a retained reachability)
- Confidence: reproduced on retail maps in a live Application with one bot, using the bot's own `forClient` runtime
- Evidence: C picks the lowest-time reachability and returns it. The port sorts candidates and returns the first that passes a movement simulation:
  ```ts
  if (this.runtime.admitEdge(candidate.edge, state.origin).admitted) return { reachability: this.handle(candidate.edge), flags };
  ```
  `#traverseEdge` applies the nav2/nav3 elevator handling only to non-AAS edges (runtime.ts:356), so an AAS mover edge is simulated as a walk toward `edge.end`. The simulation starts at zero velocity (navigation.ts:71), has no moving movers, slows on approach (`Math.min(400, distance * 20)`, navigation.ts:75), and must end within 8 units and grounded (movement.ts:56). `admitEdge` from the edge's own start point, for edges that already pass `edgeAllowed`, up to 40 per mode:

  | Map | mover rejected | jump rejected | jump rejected with a 160-unit walkable run-up | walk rejected | drop rejected |
  |---|---|---|---|---|---|
  | q3dm19 | 40/40 | 10/10 | not reported | 0/40 | 4/40 |
  | q3tourney6 | 2/2 | 34/40 | 23/40 | 0/40 | 0/40 |
  | q3dm6 | none on map | 35/40 | 8/40 | 6/40 | 5/40 |
  | q3dm1 | none on map | 12/12 | 0/6 | 0/40 | 0/40 |

  q3dm19's rejected mover samples rise 1084 units, which a walking prediction cannot do. Refutation attempted: `mover` is in the capability set, so this is not SRC8B-001. No other code path selects a new reachability, and the estimator does not apply this gate, so the route still names these edges while `select` refuses them. The same simulation also gates barrier jumps (controller.ts:160), and `edgeAllowed` with live contents, hazard and clearance checks can drop a reachability already in use (controller.ts:333, runtime.ts:260-262). A bot in slime or lava has `TFL_SLIME|TFL_LAVA` set in C (ai_dmnet.c:1472) and can route onward; here `(medium & 6) !== 0` rejects any target whose node origin is in those contents.
- Impact: bots do not board func_bobbing or func_plat on retail maps (q3dm19 has 12 bobbing models, q3tourney6 3, q3dm14 and q3ctf4 1 each). They take a worse route or get `moveresult.failure` while the route estimate still says the goal is reachable, which churns goals. Jump choice depends on how far the bot stands from the start. Each call also costs time: 7 to 24 ms mean per `admitEdge` in this run (q3dm19 130 calls in 956 ms, q3dm6 120 in 2907 ms), and it happens on every area change for each bot.
- Remediation: for AAS graphs, return the lowest-time candidate as C does, and limit admission to the non-AAS graphs that need it. Apply the same split to `checkBarrierJump` and the `edgeAllowed` test on the retained reachability.

### SRC8C-002 — Standing on a func_static stops the bot as an obstacle, and the door-bridge case is given to func_train instead
- **Verification (VERIFY-Y): confirmed. Final severity: Medium.** controller.ts:308 tests door or train; be_ai_move.c:3161 tests FUNC_STATIC or FUNC_DOOR, and be_ai_move.c:537-540 gives func_train no type. Reachable (`staticfloor.ts`): func_static is the floor at 7 grounded area origins on q3dm8 and 24 on q3dm12, 0 on q3dm11. No incident occurred in a 33 s q3dm8 run (1581 moves), so frequency stays unmeasured.
- Severity: Medium
- Category: bug
- Location: src/bots/behavior/q3/travel/controller.ts:308-315; src/bots/behavior/q3/navigation-services.ts:28-29; src/app/bootstrap/simulation/q3/guest-bots.ts:57-58
- Original: botlib/be_ai_move.c:3161-3180, :537-540 (`BotSetBrushModelTypes`), :101-104
- Confidence: traced; retail counts reproduced. No bot was placed on one, and I did not measure how often a bot stands on these models.
- Evidence: C treats `MODELTYPE_FUNC_STATIC || MODELTYPE_FUNC_DOOR` as a possible bridge and continues if the area has reachabilities. Any other model, including func_train, which has no modeltype, is blocked. The port:
  ```ts
  } else if (model?.kind === "door" || model?.kind === "train") {
  ```
  `kind` is `"static"` for func_static and `"train"` for func_train, so `"static"` falls to the `else` that sets `blocked`, `ONTOPOFOBSTACLE` and returns before any movement. The `BotTravelModel` kind union shows this is not a naming accident: both values exist. Scan of baseq3 pak0 entity lumps: func_static with a model appears on q3ctf2 (20), q3dm8 (15), q3dm11 (5), q3tourney3 (4), q3dm12 (3), q3dm10 (1), q3tourney6 (1). func_train appears on none of the 31 maps.
- Impact: on those maps a bot on a func_static surface gets no move command from `BotMoveToGoal` that frame and is left to `BotAIBlocked`'s avoidance, every frame while it stands there. On a func_train it walks on, where C treats it as an obstacle.
- Remediation: test for `"door"` or `"static"`, leaving `"train"` to the blocked branch.

### SRC8C-003 — Air control depends on a collision-simulated path crossing below the goal, so it almost never engages
- **Verification (VERIFY-Y): confirmed. Final severity: Medium.** `air.ts` rerun on q3dm6: C-equivalent true 60/60, port 1/60. controller.ts:192-205 requires a collision path to cross below the goal, while be_ai_move.c:1692-1722 integrates free flight and also returns true from below the goal. The flight outcome was not run.
- Severity: Medium
- Category: bug
- Location: src/bots/behavior/q3/travel/controller.ts:192-205; callers src/bots/behavior/q3/travel/ground.ts:144, :223, src/bots/behavior/q3/travel/special.ts:388
- Original: botlib/be_ai_move.c:1692-1722 (`BotAirControl`)
- Confidence: reproduced for the engagement counts (`src8c/air.ts`, with a C-equivalent copy of `BotAirControl`); the flight outcome is traced, not run
- Evidence: C integrates a free ballistic path with no collision and returns true as soon as `vel[2] < 0 && org[2] + vel[2] < goal[2]`, then scales back to the goal height. The port replays player movement with collision and requires a strict crossing:
  ```ts
  if (next.z < previous.z && previous.z >= goal.z && next.z < goal.z) {
  ```
  A reachability end is a standing point, so the simulated player lands on it: `landZminusEnd` was 0.13 in the samples, and the path never goes below `goal.z`. The `previous.z >= goal.z` test also removes C's result for a bot already below the goal. Results on walk-off-ledge edges with a matching velocity: q3dm1 C true 14/14, port 3/14; q3dm6 C true 60/60, port 1/60. Where C engaged, its speed was 0 to 43 and the direction aimed at the goal. Where the port does not engage, callers use the horizontal direction to the reachability end at speed 400.
- Impact: bots steer in the air at full speed toward the end point in `BotFinishTravel_WalkOffLedge`, `_JumpPad` and `_WeaponJump`, rather than trimming their predicted landing. That should mean more overshoot on narrow landings. Each airborne think also runs up to 50 movement frames with collision where C does 50 additions.
- Remediation: port the ballistic loop directly, using `sv_gravity`. `svGravity` is already set up in movement-state.ts:332, and no travel code reads its value.

### SRC8C-004 — `movementViewTarget` is a different algorithm from `BotMovementViewTarget`
- **Verification (VERIFY-Y): confirmed. Final severity: Medium.** navigation.ts:314-326 lacks be_ai_move.c:822-891's `!lastreachnum` return, its teleport and weapon-jump stops, the pad and mover distance exclusion, and the lookahead stop in route building (:303-313 walks the whole route from `pointArea`). ai_dmnet.c:1608 falls to the next branch when C returns false.
- Severity: Medium
- Category: bug
- Location: src/bots/behavior/q3/navigation.ts:303-326; callers src/bots/behavior/q3/ai-decision.ts:73-75, :801, :848, :953, :1057, :1075
- Original: botlib/be_ai_move.c:822-891; game/ai_dmnet.c:1608
- Confidence: traced
- Evidence: differences from C:
  - C returns false when `!ms->lastreachnum`, which is the state `BotMoveInGoalArea` sets. The port has no such test, so in the goal area its route is `[origin]` and it returns true with the goal origin. C then falls to the next branch (`moveresult.movedir` or a random look).
  - C returns at `TRAVEL_TELEPORT`, `ROCKETJUMP` and `BFGJUMP`, "never look beyond". The port adds the far end of every edge to the path.
  - C does not count distance across jump pads, elevators and func_bobbing. The port counts them, using the straight line to the far end.
  - C walks from `lastreachnum` using `BotGetReachabilityToGoal` with the avoid state. The port re-estimates from `pointArea(state.origin)`, which can name a different hop than the one being travelled, and an airborne bot may be in area 0.
  - C stops at the 300-unit lookahead. `estimatedPoints` builds the whole route to the goal first.
- Impact: bots look in a different direction while roaming and seeking goals. The aim of the hop in progress can be replaced, and once SRC8B-001 is fixed bots will look through a teleporter toward its exit. The route walk runs for each bot on each think that reaches this branch and scales with route length.
- Remediation: port `BotMovementViewTarget` and `BotAddToTarget` over `TravelGraph.select` with `lastReachability` as the start.

### SRC8C-005 — `predictVisiblePosition` tests the start point, has no hop limit, and does not succeed on reaching the goal area
- **Verification (VERIFY-Y): confirmed. Final severity: Low.** navigation.ts:327-335 tests `query.origin` first, has no 20-hop limit, has no unconditional success on reaching the goal area, and traces pass -1 with mask 1. be_ai_move.c:898-968 and :902 differ on each. Only unseen-enemy aim is affected (ai-combat.ts:591).
- Severity: Low
- Category: bug
- Location: src/bots/behavior/q3/navigation.ts:327-335; caller src/bots/behavior/q3/ai-combat.ts:591
- Original: botlib/be_ai_move.c:912-968, :898-905; game/ai_dmq3.c:3494
- Confidence: traced
- Evidence: `estimatedPoints` puts `query.origin` first, so the port can return the enemy's last position itself. C tests only `reach.start` and `reach.end` of each hop. When `area === goal.area` C skips the loop and returns false; the port tests the origin and can return true. C returns `reach.end` unconditionally once `reach.areanum == goal->areanum`; the port returns false unless a trace passes. C stops after 20 hops. C's trace ignores `goal->entitynum` with `CONTENTS_SOLID|CONTENTS_PLAYERCLIP`; the port uses pass -1 with `CONTENTS_SOLID` only, so player clip does not block it.
- Impact: for skill above 0.5 with rocket, grenade or BFG, the corner-shot aim point can differ. With a target at the last enemy position, the bot aims 20 units below where the enemy was rather than at the next point on its predicted path. Only affects unseen-enemy aim.
- Remediation: port the C loop over `TravelGraph.select` with an empty avoid list.

### SRC8C-006 — The walk-off-ledge speed comes from a movement simulation instead of `AAS_HorizontalVelocityForJump`
- **Verification (VERIFY-Y): confirmed. Final severity: Low.** controller.ts:184-191 simulates at 0.1 s with live velocity and caps at 400. be_aas_move.c:1062-1101 is closed form and fails above phys_maxvelocity, which yields 400 at be_ai_move.c:1661. ground.ts:129-130 uses the simulated value.
- Severity: Low
- Category: bug
- Location: src/bots/behavior/q3/travel/controller.ts:184-191; src/bots/behavior/q3/travel/ground.ts:129-130
- Original: botlib/be_aas_move.c:1062-1101; botlib/be_ai_move.c:1661
- Confidence: traced
- Evidence: C is closed form: horizontal distance divided by `sqrt(height / (0.5 * gravity))`, and it fails (speed 400) when above `phys_maxvelocity`. The port simulates at 0.1 s steps with the bot's current horizontal velocity and a 400 command, then uses `distance / prediction.seconds` capped at 400. So the time is quantized to 0.1 s, depends on the live velocity, and collision can change it. A result between 320 and 400 is used where C would use 400.
- Impact: a different approach speed at ledges with a horizontal offset of 20 units or more. It runs a simulation per think where C does one square root.
- Remediation: use the source formula. `sv_gravity` and `phys_maxvelocity` are already available as settings.

### SRC8C-007 — Travel traces also hit player bodies, where the AAS traces and `BotOnTopOfEntity` do not
- **Verification (VERIFY-Y): confirmed. Final severity: Low.** controller.ts:68-70 always includes BODY. be_ai_move.c:549-562 and be_aas_sample.c:425-426 use SOLID|PLAYERCLIP, with BODY only at be_ai_move.c:1296. Observed live: one ONTOPOFOBSTACLE on modelindex 0 in 6591 moves on q3dm1 (`live2.ts`).
- Severity: Low
- Category: bug
- Location: src/bots/behavior/q3/travel/controller.ts:68-70, :72-75, :115-116, :133, :152
- Original: botlib/be_ai_move.c:549-562, :1296 (only `BotCheckBlocked` uses `CONTENTS_BODY`); botlib/be_aas_sample.c:425-426, :449-475; botlib/be_aas_move.c:185-197
- Confidence: traced
- Evidence: `traceBox` always passes `SOLID | PLAYERCLIP | BODY`. C's `BotOnTopOfEntity` uses `CONTENTS_SOLID|CONTENTS_PLAYERCLIP`. `AAS_TraceClientBBox`, used by `AAS_OnGround`, `BotGapDistance` and `BotCheckBarrierJump`, walks the AAS tree and tests linked entities with the same two contents. The port's trace is also a BSP trace rather than an AAS tree trace, which is a design choice and applies to all of these.
- Impact: a bot on another player's head is `blocked` with `ONTOPOFOBSTACLE` and returns without moving, because modelindex 0 has no model info. In C it does not see the player and keeps travelling. `onGround` also becomes true on a player, and gap and barrier probes can see a player as floor.
- Remediation: use `SOLID | PLAYERCLIP` in `traceBox`, keeping `BODY` only in `checkBlocked`.

### SRC8C-008 — `BotValidTravel`'s area-contents test is missing from selection, which also changes the jump-pad recovery
- **Verification (VERIFY-Y): confirmed-with-changes. Final severity: Medium.** The missing test is real (routing.ts:113; be_ai_move.c:569-576), but "small reach" is wrong: the tail does not compensate for do-not-enter, because estimate-aas.ts adds the flag when its start area is do-not-enter (as be_aas_route.c:1624 does). Live q3dm1: 227 of 2165 selections entered a do-not-enter area with neither start nor goal in one, which C rejects; 11 of 30 maps have such edges. Correction: retail has 0 bridge areas, so the TFL_BRIDGE example has no stock case.
- Severity: Low
- Category: bug
- Location: src/bots/behavior/q3/travel/routing.ts:113, :116-118; src/bots/behavior/q3/travel/controller.ts:357-359
- Original: botlib/be_ai_move.c:569-576, :792, :3415-3440; botlib/be_aas_route.c:392
- Confidence: traced
- Evidence: C rejects a reachability if `AAS_AreaContentsTravelFlags(reach->areanum) & ~travelflags`. The port tests only the travel type. For the normal case the route tail mostly compensates, except when the target is the goal area: `estimate` returns 1 for `area === goal` before any contents test (estimate-aas.ts:156), so a goal area with `TFL_BRIDGE` contents is enterable here and not in C. For the airborne jump-pad recovery, C passes `movetravelflags = TFL_JUMPPAD`. Every area has an air, water, slime or lava contents flag, so C's first call always returns 0 and the fallback takes the first jump-pad reachability in the area. The port's `select` can succeed there and takes the lowest time instead, and it requires the type to be in both flag sets. It also uses `state.origin` where C passes `end` for the avoid-spot test.
- Impact: a different jump-pad reachability in an area with several, and entry into a bridge-flagged goal area. Small reach.
- Remediation: add the contents test to `select`, and pass the start point as a parameter.

### SRC8C-009 — Three tokens that read normally in C fail the source read: the sign from `$evalint`, a lone stringized macro, and `#eval`
- **Verification (VERIFY-Y): confirmed. Final severity: Low.** `pp.ts` and `pp2.ts` rerun: `$evalint(-3)`, `$evalint(2-5)`, `$evalfloat(0-1.5)`, lone `S(hello)` and `#eval` all fail with `source token profile is unsupported` (preprocessor.ts:1653-1656). C's UnreadSignToken sets type and subtype (l_precomp.c:2424-2441). These are source failures with recovery, and no retail content is affected.
- Severity: Low
- Category: bug
- Location: src/ui/common/legacy/script/preprocessor.ts:1653-1656, :1563, :1649-1650, :764-768
- Original: botlib/l_precomp.c:2424-2441 (`UnreadSignToken`), :461-482, :2548-2570
- Confidence: reproduced (`src8c/pp.ts`, `pp2.ts`)
- Evidence: `evaluateDirective` marks the sign token `uninitialized` for both forms, and `currentRecord` turns that into a failure:
  ```ts
  this.tokenMetadata.set(sign, { kind: "uninitialized", reason: "evaluation sign token leaves numeric fields uninitialized" });
  ```
  `$evalint(-3)`, `$evalint(2-5)`, and `$evalfloat(0-1.5)` all fail with `source token profile is unsupported`. In C the sign token has `type` and `subtype = P_SUB` set and the number token is fully defined for the `$` form; no consumer reads a punctuation token's numeric fields, so the read works. `#define S(x) #x` then `S(hello)` also fails, yet `"a" S(b) "c"` works because concatenation rewrites the token. In C the stringized token's `string` and `type` are set and consumers of `TT_STRING` read only `string`. `#eval` numeric fields really are garbage in C, so failing there is defensible, but the `string` is valid and `ReadString`-style consumers are not affected there. Scan of the installed baseq3, missionpack, and lrctf paks: `$eval` appears only in botfiles (4 files per pak), none with a leading minus, and no stringize or `#eval` is used.
- Impact: a mod bot file or menu with a negative `$eval` result or a lone `#x` macro fails to load where the original loads. No retail content is affected. A file whose `$evalint(A-B)` is negative for only some defines fails only for those.
- Remediation: give the sign token defined metadata in both forms, and give a stringized token defined zero numeric fields.

### SRC8C-010 — A float with a trailing dot, or a large `$evalfloat`, reaches the non-source `RangeError` paths
- **Verification (VERIFY-Y): confirmed-with-changes. Final severity: Medium.** `pp2.ts` rerun: `1.` and `$evalfloat(100000.0*100000.0)` give non-source RangeErrors at lexer.ts:1086-1088 and preprocessor.ts:283-287. Severity raised for parity: same throw sites and consequence as UI-004, confirmed Medium in VERIFY-G, with more ordinary triggers. No retail content hits it.
- Severity: Low
- Category: robustness
- Location: src/ui/common/legacy/script/lexer.ts:1076, :1086-1088; src/ui/common/legacy/script/preprocessor.ts:283-287, :516
- Original: botlib/l_script.c:556-621 (`NumberValue`, `*intvalue = (unsigned long) *floatvalue`); botlib/l_precomp.c:2003, :2020 (integer and float channels computed together)
- Confidence: reproduced (`src8c/pp2.ts`)
- Evidence: these are the same throw sites as UI-004, with triggers it does not name, so they are much more ordinary than its examples. `x 1. y` gives `NON-SOURCE RangeError: NumberValue floating conversion exceeds the source unsigned-long range`: the kept C quirk reads the NUL as a digit, so `1.` evaluates to -3.8, and the negative value hits the range check. C just converts and carries on with -3.8. `$evalfloat(100000.0*100000.0)` gives `NON-SOURCE RangeError: preprocessor operation exceeds the source signed-long range`, because the unused integer channel overflows while the float result is valid. C wraps the integer and returns 1e10. A scan of the installed paks found no trailing-dot number outside strings and comments.
- Impact: as for UI-004, a mod menu or bot file aborts its load past the parser's recovery, here on a plausible literal rather than an extreme one.
- Remediation: fix with UI-004. Do not range-check the conversion, and do not check the integer channel when evaluating in float mode.

### SRC8C-011 — A server print of 256 bytes or more throws out of the bot frame
- **Verification (VERIFY-Y): confirmed. Final severity: Low.** Reproduced live (`crash2.ts`): `serverCommands.consoleCommand(["say", 400 chars])` on a dedicated server with one bot throws `bot chat string has no terminator` out of `Application.step` via chat.ts:275, :993, ai-command.ts:755; 200 chars is fine. Client `say` is capped at 150, so only the console or rcon reaches it.
- Severity: Low
- Category: robustness
- Location: src/bots/behavior/library/chat.ts:992-993, :272-277, :915, :222; src/bots/behavior/q3/ai-main.ts:413; src/bots/behavior/q3/ai-command.ts:755; src/content/q3/team-arena/server-commands.ts:253-254
- Original: botlib/be_ai_chat.c:345, :1439-1442
- Confidence: reproduced at the component (`src8c/pp2.ts`: length 255 ok; 256 and 300 give `RangeError: bot chat string has no terminator before allocation end`); traced to the frame
- Evidence: `queueConsoleMessage` stores up to 256 bytes with no terminator, as `strncpy` does. `findMatch` copies them into a 256-byte buffer, then `chatCString` throws when it finds no NUL. C's `strlen` runs on into the next field and does not stop the game. Path: on a dedicated server any unrecognised console or rcon line, or `say`, becomes `print "server: ..."` (server-commands.ts:253-254), reaches the `getConsoleMessage` loop at ai-main.ts:406, then `botCheckConsoleMessages`, `botMatchMessage`, and `findMatch`. There is no catch from `startFrame` up to the run loop (SRC8A-001 traced `director.frame`). `unifyWhiteSpaces` shortens the text if it has runs of spaces, so the line needs about 245 characters that survive it. I found no client-reachable print this long: `say` is limited to 150 bytes and the vote prints use a name.
- Impact: a long server-console or rcon line ends the process while a bot is connected. Rcon access already allows `quit`, so this is mainly an operator accident.
- Remediation: terminate at byte 255 in `findMatchInto`, or have `chatCString` take the bounded length.

### SRC8C-012 — An unbalanced context brace in `syn.c` throws out of bot setup where C returns no synonyms
- **Verification (VERIFY-Y): confirmed-with-changes. Final severity: Medium.** chat-data.ts:703 throws RangeError, `failedWith` is false, and chat.ts:669-674 rethrows; C returns NULL (be_ai_chat.c:740-746). Open question closed by reading: q3/library.ts:130 (not :141) calls `chat.setup`, then director.ts:195, bots.ts:263-272, and application.ts:922 inside `Application.open`, with no catch seen, so one bad `syn.c` fails opening the map (not run). Severity matches SRC8A-002. ## Production evidence Method: real `Application` from `clean`, `--game q3-baseq3 --dedicated`, three skill 3 bots from `addbot`, AI running for about 35-45 s wall time. Instrumentation wraps `TravelGraph.select` and `SourceBotNavigation.moveToGoal`, and reads the runtime from the bot's own `host.forClient`. `prod` is unmodified. `caps` adds teleport and jump-pad and removes the drop limit in memory. `capsnogate` also bypasses `admitEdge` in `select`. Single short runs, not a statistical study. | Map, mode | Selections by mode | Rejected by admission | Selections returning none | |---|---|---|---| | q3dm17 prod | walk 780 | jump-pad 9, drop 400, walk 2 | 16 | | q3dm17 capsnogate | walk 658, drop 63, jump-pad 121 | n/a | 0 | | q3dm19 prod | walk 558 | mover 301, drop 1836, walk 16 | 2631 | | q3dm19 caps | walk 682, drop 10 | mover 328, jump-pad 17, drop 60, walk 11, jump 2 | 19 | | q3dm19 capsnogate | walk 399, drop 60, jump-pad 50, mover 24 | n/a | 4 | | q3tourney2 prod | walk 2840, drop 4 | jump-pad 36, drop 21, walk 53 | 8 | | q3tourney2 capsnogate | walk 3027, jump-pad 34, drop 31 | n/a | 0 | Direct `select` from each edge's own start, goal beyond it, for edges where the source rule's first hop is that edge, against the production runtime: - q3dm17: teleport 0 of 60 tested, jump-pad 0 of 31. `edgeAllowed` passes 0/63 and 0/32. - q3dm19: jump-pad 0 of 9, mover 0 of 46 (42 another edge, 4 none), drop 6 of 60 (53 none). - q3dm14: mover 0 of 4. q3tourney6: teleport 0 of 4, jump-pad 0 of 60. - Sampled q3dm17 first hops under the source rule: teleport 21, jump-pad 10, with 0 preserved in production (`edges.ts`). Wiring: every production bot navigation comes from `createApplicationBotNavigation` (application.ts:976, :1003), which builds all runtimes with `botNavigationProfile` (navigation.ts:153, :165, :171, :195). The live profile read back was `walk,crouch,jump,drop,swim,water-jump,ladder,mover maxDrop=128`. Limit of this evidence: no control run traversed a teleporter in its window on q3dm17 or q3tourney2 (q3dm19 has no teleport edges), so production blocking of teleporters is proven but working traversal after a fix is not. Jump pads, lifts and long drops were all exercised in `capsnogate`. The source-rule baseline is the port's estimator with C eligibility, not a C binary.
- Severity: Low
- Category: robustness
- Location: src/bots/behavior/library/chat-data.ts:703; src/bots/behavior/library/chat.ts:669-674; src/bots/behavior/q3/library.ts:141; src/bots/behavior/director.ts:195; src/app/bootstrap/simulation/bots.ts:263-272
- Original: botlib/be_ai_chat.c:740-746
- Confidence: traced
- Evidence: `if (contexts.length !== 0) throw new RangeError("BotLoadSynonyms reports a missing context brace through its freed source");`. This is not `this.fail`, so `parser.failedWith(error)` is false and `load` rethrows it. `bots.ts:263-272` cleans up and rethrows too. C calls `SourceError` on the freed source, which is undefined behaviour but returns `NULL`, and the bots run without synonyms. Same class as SRC8A-002, different site. I did not trace the rethrow above the `ApplicationBots` constructor, so whether the failure ends the process or only fails the bot transport is open.
- Impact: one missing `}` in a mod's `syn.c` fails the bot setup for the whole map rather than disabling synonyms.
- Remediation: report through `this.fail` and let the existing path publish an empty list.
