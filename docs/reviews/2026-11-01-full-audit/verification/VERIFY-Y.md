# VERIFY-Y — SRC8A, SRC8B, SRC8C

All cited code was opened in `<scratchpad>/clean` (HEAD fcdc8af5) and in `upstream/Quake-III-Arena/code`. Nothing from upstream was executed. Scripts and outputs are in `<scratchpad>/verifyY/`. See "Production evidence" at the end for SRC8B-001, SRC8B-002 and SRC8C-001.

### SRC8A-001
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Reproduced live (`crash3.ts`): `bot_report` set, then `addbot`, throws out of `Application.step` at ai-main.ts:94 via :145, :438, director.ts:206. Correction: "with any bot present" is too broad; setting it on a settled bot with a goal did not throw in 60 steps (`crash2.ts`). It needs an empty goal stack with `ltgType` 0, as on a new bot. Cheat-only (ai_main.c:1649).

### SRC8A-002
Verdict: confirmed
Corrected severity: Medium
Reason: `w.ts` rerun: `case 1.5` and `switch(1.5)` give RangeError, not WeightConfigError (weights.ts:444, lexer.ts:26-32). goals.ts:846 and weapons.ts:1071 rethrow it, so catalog.ts:219's dropClient path is not reached. chat-data.ts:629 throws the same class and `failedWith` is false. C returns qfalse (l_precomp.c:2831-2844). Needs malformed pak content.

### SRC8A-003
Verdict: confirmed
Corrected severity: Info
Reason: arsenal-knowledge.ts:136-142 claims a source gauntlet default. be_ai_weap.c:419-433 starts `bestweapon = 0` and returns it, ai_dmq3.c:1574-1578 selects that value, and grep finds no `BotChooseFightWeapon` in game or botlib.

### SRC8B-001
Verdict: confirmed-with-changes
Corrected severity: High
Reason: Live production runtime (`edges.ts`, `live.ts`): capabilities omit teleport and jump-pad; on q3dm17 0/63 teleport and 0/32 jump-pad edges pass `edgeAllowed`, estimates are 0 where the source rule finds all, and select never chose either in any production run. Corrections: "two thirds" is the joint effect with SRC8B-002 (q3dm17 807, this fix alone 1834, both 2355), and the remediation is insufficient because the SRC8C-001 gate still rejects jump-pad edges once granted (q3dm19 `caps`: 17 rejected, 0 chosen). Bots touching a pad by accident are launched and then get `failure` (24/24 on q3dm17).

### SRC8B-002
Verdict: confirmed
Corrected severity: High
Reason: runtime.ts:283 with `maximumDrop: 128` is live in production (`maxDrop=128` read from the bot's runtime). be_aas_route.c:1345-1349 has no height test and rs_maxfallheight defaults to 0. `split.ts` reproduced every table value and `reach.ts` the q3dm7, q3dm13, q3dm17 and q3ctf4 drop counts I reran. q3dm19 area 4 to 454 (fall 753): source 1265, production 0; 2631 of 3189 selections there returned none, 19 of 711 with SRC8B-001 and this lifted.

### SRC8B-003
Verdict: confirmed
Corrected severity: Medium
Reason: Live (`items-live.ts`): all 8 suspended q3dm17 items, including mega health, get `bestReachableFromJumpPadArea` 0, and 0 of the first 5 jump-pad admissions pass, so goals.ts:1125 skips them. `items.ts` reproduced 30 items on 9 of 31 maps. `admit` ignores capabilities, so SRC8B-001 does not change this. q3dm18 cannot open in this launch (SRC3Q3), so its quad rests on the entity scan.

### SRC8B-004
Verdict: confirmed
Corrected severity: Medium
Reason: `split.ts` rerun: q3dm1 areas 2, 99, 293 disabled give `unreachable` where the source rule gives 791, 758, 762. runtime.ts:282 tests the source node; be_aas_route.c:1347 tests only the entered area, and the only AREA_DISABLED read in routing is that line.

### SRC8B-005
Verdict: confirmed
Corrected severity: Low
Reason: navigation.ts:238 omits the crouch-hull expansion that be_aas_sample.c:1328-1332 applies and aas-reachability-spatial.ts:231 keeps. navigation.ts:233 is a BSP trace with linked entities; be_aas_reach.c:402 is AAS_TraceClientBBox with passent -1. Limited to fallback and mover cases.

### SRC8B-006
Verdict: confirmed
Corrected severity: Low
Reason: navigation.ts:178, :182, :185 and bot-navigation-syscalls.ts:113 use `node.origin`, which graph.ts:67-74 replaces with a floor or reach point. be_aas_routealt.c:171, :179, :189 and be_aas_sample.c:1380 use `areas[].center`. Stock reads only contents and cluster from AreaInfo (ai_dmq3.c, ai_main.c:265).

### SRC8B-007
Verdict: confirmed
Corrected severity: Low
Reason: be_aas_route.c:1596-1601 returns time 1 for equal areas before range tests. navigation.ts:82 and estimates.ts:76 return unreachable first, so (0, 0) yields 0.

### SRC8B-008
Verdict: confirmed
Corrected severity: Low
Reason: bot-prediction.ts:26-29 and aas-prediction-stop.ts:7 never set 64 or 2048, while controller.ts:181 requests 64 as be_aas_move.c:275 does. Ground events are transition-only in the port and state-based at be_aas_move.c:916-944. prediction.ts masks only these flags and adds none.

### SRC8B-009
Verdict: confirmed
Corrected severity: Low
Reason: Syscall 316 passes `point(2)` to the throws at estimates.ts:80-81 and estimate-aas.ts:19; be_aas_route.c:489-492 clamps instead. Syscall 308 passes `integer(5)` to aas.ts:125, which throws when negative. A limit of 0 returns empty rather than throwing, while C returns one area (be_aas_sample.c:775), so only negative limits trap. Mod-only.

### SRC8B-010
Verdict: confirmed
Corrected severity: Low
Reason: bsp-entities.ts:52-54 throws above int32; goals.ts:1097 calls it for each entity with no guard, before the item class is even checked. be_aas_bspq3.c:338-346 uses atoi. No retail trigger was claimed and none was found.

### SRC8C-001
Verdict: confirmed-with-changes
Corrected severity: High
Reason: Live: q3dm19 select chose 0 of 46 mover edges from their own start with goal beyond them, q3dm14 0 of 4; production chose 0 movers in 3189 selections, and still 0 with SRC8B-001/002 lifted (328 rejected), against 24 with the gate bypassed. Gate also rejects jump pads. Corrections: q3ctf4 has no AAS mover edge, so its bobbing model is no route; a bot that walks onto a bobbing model still rides it (controller.ts:303-305; FUNCBOB in 123/6900 moves); most `failure` churn comes from SRC8B-001/002, not this gate (2631 falls to 19 with the gate still on).

### SRC8C-002
Verdict: confirmed
Corrected severity: Medium
Reason: controller.ts:308 tests door or train; be_ai_move.c:3161 tests FUNC_STATIC or FUNC_DOOR, and be_ai_move.c:537-540 gives func_train no type. Reachable (`staticfloor.ts`): func_static is the floor at 7 grounded area origins on q3dm8 and 24 on q3dm12, 0 on q3dm11. No incident occurred in a 33 s q3dm8 run (1581 moves), so frequency stays unmeasured.

### SRC8C-003
Verdict: confirmed
Corrected severity: Medium
Reason: `air.ts` rerun on q3dm6: C-equivalent true 60/60, port 1/60. controller.ts:192-205 requires a collision path to cross below the goal, while be_ai_move.c:1692-1722 integrates free flight and also returns true from below the goal. The flight outcome was not run.

### SRC8C-004
Verdict: confirmed
Corrected severity: Medium
Reason: navigation.ts:314-326 lacks be_ai_move.c:822-891's `!lastreachnum` return, its teleport and weapon-jump stops, the pad and mover distance exclusion, and the lookahead stop in route building (:303-313 walks the whole route from `pointArea`). ai_dmnet.c:1608 falls to the next branch when C returns false.

### SRC8C-005
Verdict: confirmed
Corrected severity: Low
Reason: navigation.ts:327-335 tests `query.origin` first, has no 20-hop limit, has no unconditional success on reaching the goal area, and traces pass -1 with mask 1. be_ai_move.c:898-968 and :902 differ on each. Only unseen-enemy aim is affected (ai-combat.ts:591).

### SRC8C-006
Verdict: confirmed
Corrected severity: Low
Reason: controller.ts:184-191 simulates at 0.1 s with live velocity and caps at 400. be_aas_move.c:1062-1101 is closed form and fails above phys_maxvelocity, which yields 400 at be_ai_move.c:1661. ground.ts:129-130 uses the simulated value.

### SRC8C-007
Verdict: confirmed
Corrected severity: Low
Reason: controller.ts:68-70 always includes BODY. be_ai_move.c:549-562 and be_aas_sample.c:425-426 use SOLID|PLAYERCLIP, with BODY only at be_ai_move.c:1296. Observed live: one ONTOPOFOBSTACLE on modelindex 0 in 6591 moves on q3dm1 (`live2.ts`).

### SRC8C-008
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The missing test is real (routing.ts:113; be_ai_move.c:569-576), but "small reach" is wrong: the tail does not compensate for do-not-enter, because estimate-aas.ts adds the flag when its start area is do-not-enter (as be_aas_route.c:1624 does). Live q3dm1: 227 of 2165 selections entered a do-not-enter area with neither start nor goal in one, which C rejects; 11 of 30 maps have such edges. Correction: retail has 0 bridge areas, so the TFL_BRIDGE example has no stock case.

### SRC8C-009
Verdict: confirmed
Corrected severity: Low
Reason: `pp.ts` and `pp2.ts` rerun: `$evalint(-3)`, `$evalint(2-5)`, `$evalfloat(0-1.5)`, lone `S(hello)` and `#eval` all fail with `source token profile is unsupported` (preprocessor.ts:1653-1656). C's UnreadSignToken sets type and subtype (l_precomp.c:2424-2441). These are source failures with recovery, and no retail content is affected.

### SRC8C-010
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: `pp2.ts` rerun: `1.` and `$evalfloat(100000.0*100000.0)` give non-source RangeErrors at lexer.ts:1086-1088 and preprocessor.ts:283-287. Severity raised for parity: same throw sites and consequence as UI-004, confirmed Medium in VERIFY-G, with more ordinary triggers. No retail content hits it.

### SRC8C-011
Verdict: confirmed
Corrected severity: Low
Reason: Reproduced live (`crash2.ts`): `serverCommands.consoleCommand(["say", 400 chars])` on a dedicated server with one bot throws `bot chat string has no terminator` out of `Application.step` via chat.ts:275, :993, ai-command.ts:755; 200 chars is fine. Client `say` is capped at 150, so only the console or rcon reaches it.

### SRC8C-012
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: chat-data.ts:703 throws RangeError, `failedWith` is false, and chat.ts:669-674 rethrows; C returns NULL (be_ai_chat.c:740-746). Open question closed by reading: q3/library.ts:130 (not :141) calls `chat.setup`, then director.ts:195, bots.ts:263-272, and application.ts:922 inside `Application.open`, with no catch seen, so one bad `syn.c` fails opening the map (not run). Severity matches SRC8A-002.

## Production evidence

Method: real `Application` from `clean`, `--game q3-baseq3 --dedicated`, three skill 3 bots from `addbot`, AI running for about 35-45 s wall time. Instrumentation wraps `TravelGraph.select` and `SourceBotNavigation.moveToGoal`, and reads the runtime from the bot's own `host.forClient`. `prod` is unmodified. `caps` adds teleport and jump-pad and removes the drop limit in memory. `capsnogate` also bypasses `admitEdge` in `select`. Single short runs, not a statistical study.

| Map, mode | Selections by mode | Rejected by admission | Selections returning none |
|---|---|---|---|
| q3dm17 prod | walk 780 | jump-pad 9, drop 400, walk 2 | 16 |
| q3dm17 capsnogate | walk 658, drop 63, jump-pad 121 | n/a | 0 |
| q3dm19 prod | walk 558 | mover 301, drop 1836, walk 16 | 2631 |
| q3dm19 caps | walk 682, drop 10 | mover 328, jump-pad 17, drop 60, walk 11, jump 2 | 19 |
| q3dm19 capsnogate | walk 399, drop 60, jump-pad 50, mover 24 | n/a | 4 |
| q3tourney2 prod | walk 2840, drop 4 | jump-pad 36, drop 21, walk 53 | 8 |
| q3tourney2 capsnogate | walk 3027, jump-pad 34, drop 31 | n/a | 0 |

Direct `select` from each edge's own start, goal beyond it, for edges where the source rule's first hop is that edge, against the production runtime:
- q3dm17: teleport 0 of 60 tested, jump-pad 0 of 31. `edgeAllowed` passes 0/63 and 0/32.
- q3dm19: jump-pad 0 of 9, mover 0 of 46 (42 another edge, 4 none), drop 6 of 60 (53 none).
- q3dm14: mover 0 of 4. q3tourney6: teleport 0 of 4, jump-pad 0 of 60.
- Sampled q3dm17 first hops under the source rule: teleport 21, jump-pad 10, with 0 preserved in production (`edges.ts`).

Wiring: every production bot navigation comes from `createApplicationBotNavigation` (application.ts:976, :1003), which builds all runtimes with `botNavigationProfile` (navigation.ts:153, :165, :171, :195). The live profile read back was `walk,crouch,jump,drop,swim,water-jump,ladder,mover maxDrop=128`.

Limit of this evidence: no control run traversed a teleporter in its window on q3dm17 or q3tourney2 (q3dm19 has no teleport edges), so production blocking of teleporters is proven but working traversal after a fix is not. Jump pads, lifts and long drops were all exercised in `capsnogate`. The source-rule baseline is the port's estimator with C eligibility, not a C binary.
