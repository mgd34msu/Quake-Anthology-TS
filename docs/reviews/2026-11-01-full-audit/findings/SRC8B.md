# SRC8B — src/bots/navigation and AAS code against botlib be_aas_*.c, with the originals open

HEAD fcdc8af5. Port paths are relative to the project root. Original paths are relative to `upstream/Quake-III-Arena/code/botlib/`. Nothing from upstream was executed.

## Coverage
**Originals read line by line:** be_aas_reach.c (all 4547), be_aas_cluster.c (all 1545, including the `#if 0` and commented blocks), be_aas_sample.c (all 1394), be_aas_move.c (all 1101), be_aas_optimize.c (all 312), be_aas_file.c (all 582), be_aas_bspq3.c (all 487), be_aas_entity.c (50-437), be_aas_main.c (50-429), be_aas_routealt.c (all 240), be_aas_route.c (40-628 and 1143-2209).

**Port files read in full:** src/bots/navigation: aas.ts 165, aas-cluster.ts 474, aas-optimize.ts 52, aas-prediction-stop.ts 16, aas-reachability.ts 168, aas-reachability-geometry.ts 662, aas-reachability-spatial.ts 288, aas-reachability-special.ts 531, aas-reachability-types.ts 59, aas-write.ts 70, construct.ts 211, estimate-aas.ts 203, estimates.ts 95, graph.ts 138, helpers.ts 50, load.ts 66, movement.ts 65, nav.ts 62, rerelease-path.ts 119, runtime.ts 430, train.ts 31, types.ts 100. Also src/bots/behavior/q3/navigation.ts 336, navigation-services.ts 34, travel/routing.ts 130, src/bots/behavior/library/bsp-entities.ts 388, src/bots/behavior/prediction.ts 68, src/app/bootstrap/simulation/bot-prediction.ts 32, src/compat/qvm/bot-navigation-syscalls.ts 226.

**Sampled:** src/app/bootstrap/simulation/navigation.ts 1-210 (the profile and world, read; the file is the wiring for the port's bot navigation). src/bots/behavior/library/goals.ts 1070-1150 (item init). travel/controller.ts 174-186 and 240-265; travel/ground.ts 150-160. src/bots/navigation/index.ts and entity-binding.ts were not opened beyond the export lines shown by grep (21 and 8 lines, re-exports and a bounds helper).

**Not compared, with reason:**
- be_aas_route.c 628-1142: routing cache freeing, allocation, and the `AAS_WriteRouteCache`/`AAS_ReadRouteCache` file format. Not opened. The port has a 16 MB LRU instead and no route cache file. No finding is claimed either way.
- be_aas_debug.c (777): debug drawing. Not opened. The port's `debugLines` was not compared.
- be_aas_entity.c 1-49, be_aas_main.c 1-49, and the file headers: licence and includes.
- src/bots/behavior/q3/travel/controller.ts, ground.ts, special.ts, and `TravelGraph.select` against be_ai_move.c: outside this scope except the lines named under Sampled. `fuzzyPointReachabilityArea` and `reachabilityArea` are be_ai_move.c functions and were only read, not compared.
- nav.ts, rerelease-path.ts, construct.ts, train.ts: no be_aas counterpart. KEX NAV has no source in upstream. They were read for bugs, not compared.
- AAS_UpdateEntity against `q3/guest-bots.ts`: only lines 74-75 and 133-134 seen. Not compared.

**Experiments:** `<scratchpad>/src8b/reach.ts`, `split.ts`, `items.ts`, run from `<scratchpad>/clean` on `qfiles/q3a/baseq3/pak0.pk3`. The "source rule" baseline in them is the port's own `AasNavigationEstimates` given only the eligibility be_aas_route.c:1345-1349 applies. I compared that class to the C line by line (see Strengths), but no C binary was run. The profile is a literal copy of navigation.ts:29-31, because `botNavigationProfile` needs a live player.

## Strengths
- `AAS_UpdateAreaRoutingCache`, `AAS_UpdatePortalRoutingCache`, and `AAS_AreaRouteToGoalArea` match in estimate-aas.ts line for line, apart from eligibility: reversed-link order, the 128-reachability cap, 16-bit wrap, the FIFO update list, and the unset portal `reachabilities` that yield `firstreachablearea + 0`, the portal-area early return with a zero time, and the "origin only added for non-portal start" rule.
- be_aas_reach.c is a faithful port, including its oddities: int `abs` on float dot products (:2481, :2490), `AAS_Reachability_Jump` returning qfalse after linking (:2371), reuse of `dist` in the nested edge loop (:1148, :1271), both-`if` fall damage at :1578-1585 against `else if` at :2354-2361 and :4287-4294, and the 127-entry trace stack result in `AAS_TraceClientBBox`.
- be_aas_cluster.c, be_aas_optimize.c, and the header XOR and lump layout of be_aas_file.c all match, including the zero-vertex sentinel at be_aas_optimize.c:108. Every `AAS_InitSettings` name and default matches.
- `AAS_TraceAreas` and `AAS_BBoxAreas` match, including prepend order. `AAS_PredictRoute` keeps the source's use of the initial area and origin for time (be_aas_route.c:1848).
- `AAS_RandomGoalArea` has no port, which is correct: its only caller, be_ai_goal.c:1387-1400, is inside a comment. `TRAVELFLAG_NOTTEAM` bits at runtime.ts:286 differ from the dead check at be_aas_route.c:174, but `team` is always null in the production profile (navigation.ts:31), so there is no behaviour to report.

Refuted while checking and not reported: `AAS_GetJumpPadInfo` throwing at aas-reachability-spatial.ts:283 where C goes on with NaN. It is authoring-only (tools/navigation/aas.ts), and no retail trigger_push has its target below its centre (0 of 148 across 31 maps). Signed `AAS_FaceCenter` indexing at be_aas_reach.c:3713, :3848 and :4052 is undefined behaviour in the source and the port's throw is on the same authoring-only path.

## Findings
### SRC8B-001 — Q3 bots may not route through teleporters or jump pads, because the navigation profile omits those travel modes
- **Verification (VERIFY-Y): confirmed-with-changes. Final severity: High.** Live production runtime (`edges.ts`, `live.ts`): capabilities omit teleport and jump-pad; on q3dm17 0/63 teleport and 0/32 jump-pad edges pass `edgeAllowed`, estimates are 0 where the source rule finds all, and select never chose either in any production run. Corrections: "two thirds" is the joint effect with SRC8B-002 (q3dm17 807, this fix alone 1834, both 2355), and the remediation is insufficient because the SRC8C-001 gate still rejects jump-pad edges once granted (q3dm19 `caps`: 17 rejected, 0 chosen). Bots touching a pad by accident are launched and then get `failure` (24/24 on q3dm17).
- Severity: High
- Category: bug
- Location: src/app/bootstrap/simulation/navigation.ts:29-30; src/bots/navigation/runtime.ts:277, :88; src/bots/behavior/q3/travel/controller.ts:251
- Original: botlib/be_aas_route.c:1345-1349, :135-162; game/be_aas.h:69-73 (TFL_DEFAULT includes TFL_TELEPORT and TFL_JUMPPAD)
- Confidence: reproduced at the estimator on retail AAS; the production wiring is traced
- Evidence:
  ```ts
  capabilities: new Set(crouches ? ["walk", "crouch", "jump", "drop", "swim", "water-jump", "ladder", "mover"]
  ```
  ```ts
  if (!profile.capabilities.has(edge.mode) || edge.mode === "unknown" || this.#blocked.has(edge.id)) return false;
  ```
  `aasTravelMode` maps types 10 and 18 to `"teleport"` and `"jump-pad"` (graph.ts:9-10), and `#staticEdgeAllowed` is the eligibility passed to `NavigationEstimates` (runtime.ts:88). The source's only filter is the travel flag, the target's AREA_DISABLED, and the target's contents flags. `botNavigationProfile` is the only production construction of this set for bots, on all four `NavigationRuntime` paths at navigation.ts:153-195. controller.ts:251 also fails the move outright for such a mode. `rocket-jump`, `bfg-jump`, and `grapple` are missing too, and `travelWeapon: () => null` at navigation.ts:202 blocks them a second time, so `bs->tfl |= TFL_ROCKETJUMP` (game/ai_dmnet.c:1688, :1831, :2106, :2199) has no effect.
  Results below use TFL_DEFAULT on 3000 sampled area pairs per map, counting pairs with a nonzero time.

  | Map | Source rule | Port today | Add teleport, jump-pad | Add those and lift SRC8B-002 |
  |---|---|---|---|---|
  | q3dm6 | 2851 | 2162 | 2459 | 2851 |
  | q3dm17 | 2355 | 807 | 1834 | 2355 |
  | q3ctf4 | 2405 | 338 | 972 | 2405 |
  | q3tourney2 | 2394 | 2108 | 2383 | 2394 |

  The last column equals the source rule on every map, so these two causes account for all the lost reachability under default flags. Refutation attempted: I grepped src for any other capability grant and for a Q3-specific profile and found none. The retail test's helper profile at tests/bots/navigation/prediction.ts:18 has the same omission, and retail.test.ts asserts nothing about these modes, so no test catches it.
- Impact: on The Longest Yard, about two thirds of the routes the source finds do not exist. `AAS_AreaTravelTimeToGoalArea` returns 0, so bots discard the goal as unreachable, and on shared pairs the mean time rises from 432 to 648 because of forced detours. Bots never choose a teleporter or jump pad as a route. QVM and native Q3 paths both go through this runtime.
- Remediation: grant the AAS travel modes for the Q3 profile and leave selection to the source travel flags. Add a retail test that asserts a jump pad and a teleporter route on q3dm17.

### SRC8B-002 — A 128-unit drop limit removes walk-off-ledge reachabilities that the source always allows
- **Verification (VERIFY-Y): confirmed. Final severity: High.** runtime.ts:283 with `maximumDrop: 128` is live in production (`maxDrop=128` read from the bot's runtime). be_aas_route.c:1345-1349 has no height test and rs_maxfallheight defaults to 0. `split.ts` reproduced every table value and `reach.ts` the q3dm7, q3dm13, q3dm17 and q3ctf4 drop counts I reran. q3dm19 area 4 to 454 (fall 753): source 1265, production 0; 2631 of 3189 selections there returned none, 19 of 711 with SRC8B-001 and this lifted.
- Severity: High
- Category: bug
- Location: src/bots/navigation/runtime.ts:283; src/app/bootstrap/simulation/navigation.ts:31
- Original: botlib/be_aas_route.c:1345-1349 (no height test); botlib/be_aas_reach.c:1543, :4273 (`rs_maxfallheight`, default "0" at be_aas_move.c:113, limits generation only)
- Confidence: reproduced at the estimator on retail AAS
- Evidence:
  ```ts
  if (edge.mode === "drop" && edge.start.z - edge.end.z > profile.maximumDrop) return false;
  ```
  with `maximumDrop: 128`. Retail AAS holds many larger falls: q3dm6 312 of 432 drop edges exceed 128 (largest 514), q3dm7 529 of 935, q3dm13 230 of 422, q3dm17 147 of 365 (largest 2680), q3ctf4 279 of 609. Fixing this alone, with teleports still absent, gives q3dm6 2523, q3dm17 1094, q3ctf4 609, q3tourney2 2119, against the source and current counts in SRC8B-001. Refutation attempted: the source applies fall cost through `rs_falldamage5` and `rs_falldamage10` in the stored travel time, so the file already prices these falls, and no runtime check exists in be_aas_route.c.
- Impact: bots will not take ordinary ledges and pits on most retail maps, and areas with only a downward exit become dead ends for routing.
- Remediation: do not apply `maximumDrop` to AAS edges. It belongs to the constructed and NAV graphs.

### SRC8B-003 — Items floating above jump pads are dropped from bot goals, including q3dm17 mega health and q3dm18 quad
- **Verification (VERIFY-Y): confirmed. Final severity: Medium.** Live (`items-live.ts`): all 8 suspended q3dm17 items, including mega health, get `bestReachableFromJumpPadArea` 0, and 0 of the first 5 jump-pad admissions pass, so goals.ts:1125 skips them. `items.ts` reproduced 30 items on 9 of 31 maps. `admit` ignores capabilities, so SRC8B-001 does not change this. q3dm18 cannot open in this launch (SRC3Q3), so its quad rests on the entity scan.
- Severity: Medium
- Category: bug
- Location: src/bots/behavior/q3/navigation.ts:277-291; src/bots/behavior/library/goals.ts:1121-1125
- Original: botlib/be_aas_reach.c:290-353 (`AAS_BestReachableFromJumpPadArea`), :213-283, botlib/be_aas_move.c:1014-1026; botlib/be_ai_goal.c:608
- Confidence: traced; the item count is reproduced, and I did not run a live bot load
- Evidence: the source walks `trigger_push` entities, derives launch velocity from the target, simulates ballistic flight with `AAS_ClientMovementHitBBox`, and returns the largest-`AAS_AreaVolume` pad area of the first pad that hits. The port instead loops over AAS jump-pad edges and calls:
  ```ts
  const result = this.runtime.world.admit({ from: edge.start, to: edge.end, mode: edge.mode, hint: edge.hint, entity: edge.entity }, this.runtime.graph.profile);
  ```
  `admit` starts at zero velocity (simulation/navigation.ts:71), sends z command 0 for mode `jump-pad` (:76-77), does not dispatch trigger contacts in prediction (movement.ts:10), and returns "cannot predict" when no player exists (:69-70). A pad launch is therefore not modelled, and admission fails unless the landing is walkable. It also compares box volume rather than `AAS_AreaVolume`, and takes the best over all pads rather than the first hit. On zero, goals.ts:1125 does `continue`, as the source does at be_ai_goal.c:608-611, so the item is not registered. A scan of 31 retail maps finds 30 stationary items with no floor within 32 units: q3ctf2 1, q3ctf4 2 (rocket launcher, BFG), q3dm9 7, q3dm11 1, q3dm12 1, q3dm15 2, q3dm17 8, q3dm18 6 (quad, 2 rocket launchers), q3tourney6 2. Fixing SRC8B-001 does not change this.
- Impact: bots never seek these items on 9 of the 31 maps.
- Remediation: port the source function. Use `getJumpPadInfo`-style velocity and a ballistic box test, and return the largest `aasAreaVolume` for the first pad that hits.

### SRC8B-004 — A bot standing in a disabled area has no route out
- **Verification (VERIFY-Y): confirmed. Final severity: Medium.** `split.ts` rerun: q3dm1 areas 2, 99, 293 disabled give `unreachable` where the source rule gives 791, 758, 762. runtime.ts:282 tests the source node; be_aas_route.c:1347 tests only the entered area, and the only AREA_DISABLED read in routing is that line.
- Severity: Medium
- Category: bug
- Location: src/bots/navigation/runtime.ts:282, :240-241
- Original: botlib/be_aas_route.c:1347; game/ai_dmq3.c:4115 (the stock caller of `AAS_EnableRoutingArea`)
- Confidence: reproduced
- Evidence: the source tests only the entered area:
  ```c
  if (aasworld.areasettings[reach->areanum].areaflags & AREA_DISABLED) continue;
  ```
  The port also tests the source node:
  ```ts
  if (source === null || target === null || !this.#staticNodeAllowed(source, query) || !this.#staticNodeAllowed(target, query)) return false;
  ```
  On q3dm1 with areas 2, 99, and 293 disabled in turn, goal 1928: the source rule gives 791, 758, 762 and the port returns `unreachable` for each. The source lets a bot leave because every link out of the area enters a different, enabled area.
- Impact: `BotEnableActivateGoalAreas` disables areas around activation goals. A bot inside one gets travel time 0 to every goal until the area is re-enabled, so goal selection fails from that position.
- Remediation: check only the target for the disabled state in the estimate path. Keep the source test for `query.disabledAreas` if `route()` needs it.

### SRC8B-005 — `bestReachableArea` differs from `AAS_BestReachableArea` in its fallback box and its floor trace
- **Verification (VERIFY-Y): confirmed. Final severity: Low.** navigation.ts:238 omits the crouch-hull expansion that be_aas_sample.c:1328-1332 applies and aas-reachability-spatial.ts:231 keeps. navigation.ts:233 is a BSP trace with linked entities; be_aas_reach.c:402 is AAS_TraceClientBBox with passent -1. Limited to fallback and mover cases.
- Severity: Low
- Category: bug
- Location: src/bots/behavior/q3/navigation.ts:238, :233
- Original: botlib/be_aas_reach.c:402, :436-444; botlib/be_aas_sample.c:1328-1332
- Confidence: traced
- Evidence: the source fallback calls `AAS_LinkEntityClientBBox`, which expands the box by the crouch hull (`absmins - maxs`, `absmaxs - mins`). The commented lines at be_aas_reach.c:439-440 are redundant with that. The port omits the expansion:
  ```ts
  const areas = this.bboxAreas({ min: add3(origin, bounds.min), max: add3(origin, bounds.max) });
  ```
  The authoring copy does it correctly at aas-reachability-spatial.ts:231. Also, the drop uses `AAS_TraceClientBBox` in the source, which walks AAS areas and ignores entities, and `host.trace(..., -1, 1 | 0x10000)` in the port, which is a BSP trace through `game.world.trace` and so includes linked movers.
- Impact: an item whose origin sits in solid or outside any area can resolve to area 0 and be dropped, and an item above a plat or door can land in a different area. Limited to the fallback and mover cases. I did not count retail hits.
- Remediation: expand the box by the crouch hull, and trace against the AAS tree as `AasReachabilitySpatial.traceClientBBox` already does.

### SRC8B-006 — Alternative route goals and `AAS_AreaInfo` report a floor point where the source reports the area centre
- **Verification (VERIFY-Y): confirmed. Final severity: Low.** navigation.ts:178, :182, :185 and bot-navigation-syscalls.ts:113 use `node.origin`, which graph.ts:67-74 replaces with a floor or reach point. be_aas_routealt.c:171, :179, :189 and be_aas_sample.c:1380 use `areas[].center`. Stock reads only contents and cluster from AreaInfo (ai_dmq3.c, ai_main.c:265).
- Severity: Low
- Category: bug
- Location: src/bots/behavior/q3/navigation.ts:178, :182, :185; src/compat/qvm/bot-navigation-syscalls.ts:113; src/bots/navigation/graph.ts:67-74
- Original: botlib/be_aas_routealt.c:171, :179, :189; botlib/be_aas_sample.c:1380
- Confidence: traced
- Evidence: the source uses `aasworld.areas[...].center` for the cluster mean, the closest-area choice, and the goal origin. `AAS_AreaInfo` copies the same field. The port uses `node.origin`, which graph.ts:67-74 replaces with a traced floor point or a reachability start for grounded areas. `asset.areas[n].center` is available in all these places.
- Impact: CTF alternate route goals can select a different area and carry a different origin. A mod reading `aas_areainfo_t.center` gets a different point. The stock game reads only `contents` at ai_dmq3.c:4220 and :4232, and ai_main.c:265 is diagnostic.
- Remediation: read `center` from the AAS asset in both places.

### SRC8B-007 — Travel time from an invalid area to the same area returns 0 where the source returns 1
- **Verification (VERIFY-Y): confirmed. Final severity: Low.** be_aas_route.c:1596-1601 returns time 1 for equal areas before range tests. navigation.ts:82 and estimates.ts:76 return unreachable first, so (0, 0) yields 0.
- Severity: Low
- Category: bug
- Location: src/bots/behavior/q3/navigation.ts:82; src/bots/navigation/estimates.ts:76
- Original: botlib/be_aas_route.c:1596-1601
- Confidence: traced
- Evidence: the source tests `areanum == goalareanum` before any range test and returns time 1. The port returns `unreachable` first: `if (query.area === 0 || query.goalArea === 0) return { kind: "unreachable" };`, and estimates.ts:76 does the same for other out-of-range values.
- Impact: `trap_AAS_AreaTravelTimeToGoalArea(0, origin, 0, flags)` returns 0 rather than 1, reading as unreachable when a bot and a goal are both outside any area. It needs both to be area 0, so reach is small.
- Remediation: test equality before the range checks.

### SRC8B-008 — Prediction never reports SE_GAP or SE_HITBOUNDINGBOX, and SE_HITGROUND and SE_LEAVEGROUND fire only on a transition
- **Verification (VERIFY-Y): confirmed. Final severity: Low.** bot-prediction.ts:26-29 and aas-prediction-stop.ts:7 never set 64 or 2048, while controller.ts:181 requests 64 as be_aas_move.c:275 does. Ground events are transition-only in the port and state-based at be_aas_move.c:916-944. prediction.ts masks only these flags and adds none.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/simulation/bot-prediction.ts:26-29; src/bots/navigation/aas-prediction-stop.ts:7; src/bots/behavior/q3/travel/controller.ts:181
- Original: botlib/be_aas_move.c:916-974, :736-751, :275
- Confidence: traced
- Evidence: the flags built are 1, 2, 4, 8, 16, 32, 512, and 1024, plus 128, 256, 512, and 4096 from `aasPredictionStop`. Nothing sets 64 or 2048, yet controller.ts:181 asks for 64 as `AAS_JumpReachRunStart` does. The source fires SE_HITGROUND whenever `onground` is true after a frame, and SE_LEAVEGROUND whenever it is false. The port requires a change from the previous frame: `!wasGrounded && grounded ? 1 : wasGrounded && !grounded ? 2 : 0`. The port replays the selected movement provider rather than the source's own loop, which is a stated design, and these are the observable event differences that remain.
- Impact: the stock effect is small. `travelJump` takes only a direction from the run start and replaces the point when an AAS reachability is in use (ground.ts:154-158), and the source's jump predictions leave the ground on frame 0 so the transition rule agrees. A QVM mod requesting these events through syscall 318 gets a different stop. A prediction started on the ground with SE_HITGROUND stops at frame 0 in the source and not in the port.
- Remediation: compute a gap probe for 64 and a box clip for 2048, and fire 1 and 2 from the current state as the source does.

### SRC8B-009 — Two more mod-reachable traps in AAS syscalls: a non-finite or huge origin, and a negative area limit
- **Verification (VERIFY-Y): confirmed. Final severity: Low.** Syscall 316 passes `point(2)` to the throws at estimates.ts:80-81 and estimate-aas.ts:19; be_aas_route.c:489-492 clamps instead. Syscall 308 passes `integer(5)` to aas.ts:125, which throws when negative. A limit of 0 returns empty rather than throwing, while C returns one area (be_aas_sample.c:775), so only negative limits trap. Mod-only.
- Severity: Low
- Category: robustness
- Location: src/bots/navigation/estimates.ts:80-81; src/bots/navigation/estimate-aas.ts:19; src/bots/navigation/aas.ts:125; src/compat/qvm/bot-navigation-syscalls.ts:162, :133
- Original: botlib/be_aas_route.c:489-492; botlib/be_aas_sample.c:737-776
- Confidence: traced to the caller. No stock caller triggers them. Separate from the three in SRC7-006.
- Evidence: `AAS_AreaTravelTime` converts with `(int) dist` and clamps `intdist <= 0` to 1, so a NaN origin yields time 1 on x86. The port throws `Estimate origin must contain finite float32 coordinates` and `AAS estimate distance exceeds source int range`. Syscall 316 passes `point(2)` straight through `areaTravelTimeToGoal` to these with no guard. `AAS_TraceAreas` with `maxareas <= 0` returns after the first area, while `aasTraceAreas` throws `Invalid AAS area limit`, reached from syscall 308 with `integer(5)`. The exception has no outer guard, per APP-001.
- Impact: a mod that passes an uninitialized vector or a bad count ends the process, where the original carried on with a slightly wrong number.
- Remediation: return the source value at the syscall boundary, or clamp inside these functions.

### SRC8B-010 — An oversized integer epair in a map throws where `atoi` returned a value
- **Verification (VERIFY-Y): confirmed. Final severity: Low.** bsp-entities.ts:52-54 throws above int32; goals.ts:1097 calls it for each entity with no guard, before the item class is even checked. be_aas_bspq3.c:338-346 uses atoi. No retail trigger was claimed and none was found.
- Severity: Low
- Category: robustness
- Location: src/bots/behavior/library/bsp-entities.ts:52-54, :250-253; src/bots/behavior/library/goals.ts:1097; also src/bots/navigation/aas-reachability-spatial.ts:30-32
- Original: botlib/be_aas_bspq3.c:338-346
- Confidence: traced. No retail map was found to do this, and I did not build a map to run it.
- Evidence: `AAS_IntForBSPEpairKey` is `*value = atoi(buf)`. The port throws `AAS integer epair conversion exceeds the source-defined int32 range` for any digit run above the int32 range. `initLevelItems` reads `bsp.int(entity, "spawnflags")` for each item with no guard, and syscall 314 reaches the same path from a mod.
- Impact: a custom map with `"spawnflags" "99999999999"` on an item fails bot setup rather than loading. `atoi` overflow is undefined in C, so this is a tolerance difference and not a value difference.
- Remediation: saturate or wrap the value and carry on, since map text is untrusted input.
