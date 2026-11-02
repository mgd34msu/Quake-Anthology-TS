# BOTS — Bot behavior, botlib port, AAS/NAV navigation (src/bots/**, tools/navigation/*)

## Coverage
Scope is 29,920 lines in 94+2 files. HEAD fcdc8af5.

Read in full (about 13,300 lines):
- navigation: aas.ts, aas-write.ts, runtime.ts, load.ts, graph.ts, types.ts, construct.ts, estimate-aas.ts, estimates.ts, rerelease-path.ts, nav.ts
- tools/navigation: aas.ts, inspect.ts
- behavior: director.ts, population.ts, prediction.ts, orders.ts, assets.ts
- rerelease: brain.ts (1991), nav.ts, rng.ts, aim.ts, senses.ts, path-follow.ts, checkpoint.ts, index.ts, data/blockparse.ts, data/source-files.ts, data/knowledge-q1.ts
- library: chat.ts (1294), chat-data.ts (973), weights.ts (1084), structure.ts, script-sources.ts, memory.ts, log.ts, genetic.ts
- q3: ai-main.ts, navigation.ts, movement-state.ts, catalog.ts, library.ts, travel/routing.ts, travel/controller.ts

Sampled (read specific ranges or grep-driven):
- library/goals.ts (1285-1409 plus a loop/throw scan of the rest, 1493 total), library/bsp-entities.ts (1-150 of 388)
- q3/ai-command.ts (150-300, 488-540, 668-696, 745-799 of 799), ai-combat.ts (640-700 of 852), ai-navigation.ts (120-155, 465-560 of 773), ai-chat.ts (1-120 of 391), ai-team.ts (100-125), ai-voice.ts (1-60, 196-225), ai-orders.ts (60-80), observations.ts (1-60), ai-context.ts (225-242)
- rerelease/data/botdata.ts (head plus a line sample, 1038), data/knowledge.ts (1-110 of 557), data/knowledge-q2.ts (1-40), profile.ts (55-95), q2-exports.ts (head)
- navigation/aas-cluster.ts (1-40 plus a loop/throw scan, 474)

Skipped except for scripted scans (Math.random, module state, throw sites, symbol usage):
- q3/ai-decision.ts (1182), ai-state.ts (877), ai-definitions.ts (347), ai-input.ts, source-game.ts, game-host.ts, travel/ground.ts (229), travel/special.ts (393)
- library/character.ts (854), weapons.ts (1242), actions.ts (344), libvars.ts (320)
- navigation/aas-reachability*.ts (1708, authoring tool only), aas-optimize.ts, train.ts, movement.ts, helpers.ts

Adjacent files outside scope, read to trace callers and guards: src/app/bootstrap/simulation/bots.ts (195-640), bot-rerelease.ts (140-175), bot-rerelease-world.ts (50-100), bot-assets.ts, navigation.ts (145-175), src/main.ts (78-92), src/core/binary/index.ts (60-125).

Experiments: scripts in `<scratchpad>/bots-scripts/` run against `<scratchpad>/clean`: chat.ts, aas.ts, nav.ts, reach.ts, brain.ts, cp.ts. No retail bot data was available (no corpus environment variable is set), so templates in retail `botfiles/match.c` could not be opened. Findings that depend on them say so.

## Strengths
- Determinism: no `Math.random`, `Date.now` or `performance.now` anywhere in src/bots or tools/navigation (the only grep hit is a comment in rng.ts). Q3 uses the simulation RNG, and rerelease uses one checkpointed Xorshift32 per bot.
- AAS and NAV parsers check lump ranges, record strides, finite floats and index references before use. `BinaryReader.bytes` copies, so version 5 header decoding does not mutate caller bytes (I suspected it did; refuted). parseKexNavigation bounds counts by file length and requires full consumption.
- AAS area and portal caches (estimate-aas.ts) are a faithful relaxation of be_aas_route.c with a 16 MB LRU. Travel flags, travel modes and lump layouts match the original constants as I recall them; the id source was not available to diff.
- Script file access goes through an in-memory asset map (script-sources.ts), so `#include` cannot escape to the filesystem. The bot log uses `basename` under a fixed directory (bots.ts).
- Map lifecycle is clean: library state is owned per director, BotMemory is disposed at shutdown, and `resetForLevel` clears all per-map brain maps. I looked for growth across maps in brain, chat and weights and found none. The chat `consoleMessageCells` and `initialChats` maps are not cleared on shutdown, but the library is single-use, so this is not a leak.
- The rerelease brain documents its reasoning against measured regressions, and blockparse.ts never throws on malformed text.

## Findings

### BOTS-001 — A single remote chat message can throw out of the bot frame through the signed-char match offset port
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Critical.** The offset is `char` (`game/be_ai_chat.h:57`). `BotMatchVariable` treats a negative offset as empty (`botlib/be_ai_chat.c`), so C carries on. The open question is settled: retail `pak4.pk3 botfiles/match.c:32` is `EC"("|EC"[", NETNAME, ..., ADDRESSEE, " help "|" meet ", TEAMMATE`, and `BotMatchMessage` tests that context (`game/ai_cmd.c:1804-1806`). The route is team chat or `tell`, since only those produce the `EC"("` or `EC"["` prefix. Plain `say` matches only the reply template, whose variables start early (`match.c:300`). Traced by hand, not run with the real file. Source review: SRCQ3
- Severity: Critical
- Category: bug
- Location: src/bots/behavior/library/chat.ts:378, :403 (callers src/bots/behavior/q3/ai-combat.ts:659, :665, src/bots/behavior/q3/ai-command.ts:755, src/compat/qvm/bot-library-syscalls.ts:180)
- Confidence: reproduced at library level with a synthetic template; retail template shape not verified
- Evidence:
  `capture(match, piece.variable).offset = (pointer << 24) >> 24;` then, for a template ending in a variable, `if (variable.offset < 0) throw new RangeError("source signed-char match offset overflow");`.
  Script bots-scripts/chat.ts with template `0, ": ", 1, " help ", 2` and input `"bob: " + "a".repeat(130) + " help z"` printed `len 142 THROW RangeError source signed-char match offset overflow`.
  Trace: `chat "..."` server command, ai-main.ts:413 queueConsoleMessage, botCheckConsoleMessages, botMatchMessage, findMatch, stringsMatch. Say text is allowed 150 characters (src/content/q3/team-arena/commands.ts:32 `MAX_SAY_TEXT = 150`), so a variable can start past offset 127. Nothing catches this: GameAi.startFrame, SourceBotDirector.frame (try/finally only), runtime.ts:5253, Application.run, then main.ts writes a crash log and exits. The C original stored a negative `char` and kept running. The port made it fatal.
- Impact: any connected client says one long line on a server running native Q3 bots and the server process ends. This needs a retail match.c template that ends in a variable after filler text. Id's `ADDRESSEE, " help ", TEAMMATE` style templates have that shape as I recall them; I could not open the file. The QVM syscall path uses the same function.
- Remediation: treat the negative offset as an absent variable, matching publicCapture at chat.ts:292, instead of throwing. Audit the other chat paths that throw on peer-derived text.

### BOTS-002 — Any player can crash a team-game server by exhausting the 128 waypoint heap with checkpoint chats
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Critical.** The heap leak is id's: the replaced waypoint is unlinked and never freed (`game/ai_cmd.c:1203-1208`). `BotCreateWayPoint` warns and returns NULL (`game/ai_dmq3.c:2125-2127`), then `cp->next` is written (`game/ai_cmd.c:1212`). Correction: in a QVM that write goes to masked low memory and does not crash; only a DLL build crashes. Template confirmed at `match.c:212-215`, so it needs team chat or `tell` in a team gametype (`ai_cmd.c:1181`) with a position in a valid area (:1191-1198). Source review: SRCQ3
- Severity: Critical
- Category: bug
- Location: src/bots/behavior/q3/ai-command.ts:515-522, :499-505; src/bots/behavior/q3/ai-navigation.ts:120-122; src/bots/behavior/q3/ai-definitions.ts:10
- Confidence: reproduced (cp.ts drives botMatchCheckPoint with a stub context)
- Evidence:
  `const checkpoint = botCreateWayPoint(context, name, position, area); if (checkpoint === null) throw new Error("BotMatch_CheckPoint exhausted the source waypoint heap");`.
  A replaced checkpoint is unlinked and marked `old.inuse = false` but never returned to `freeWaypoints` (lines 515-520), so repeating the same name still consumes the heap. There is no same-team or addressed-to-bot check before creation (499-505); the sender name comes from the message text. Script output: `threw after 128 identical-name checkpoints: BotMatch_CheckPoint exhausted the source waypoint heap`. The heap is shared per GameAi, and each bot processes the message, so N bots reach it in 128/N messages.
- Impact: in any team gametype with native bots, one client sends a few dozen `checkpoint` chats and the same uncaught path as BOTS-001 ends the process. This needs the retail `checkpoint ... is at gps ...` match template, which I could not open. The C source dereferenced NULL here, so this is an inherited crash that remains reachable.
- Remediation: return `old` to the free list. On exhaustion, warn and return instead of throwing.

### BOTS-003 — Help and lead-the-way chat commands throw where the C source read an uninitialized buffer
- **Verification (VERIFY-Q): confirmed. Final severity: High.** `netname` is uninitialized on the "someone else" branch and read at `game/ai_cmd.c:564-565`. `BotMatch_LeadTheWay` has the same shape and tests the stale `bs->teamgoal` (:1668-1671). Source review: SRCQ3
- Severity: High
- Category: bug
- Location: src/bots/behavior/q3/ai-command.ts:288, :687 (also the guards at :273, :285, :678)
- Confidence: traced
- Evidence:
  In botMatchHelpAccompany, the "someone else" branch (lines 266-271) leaves `netname = null`. If `locate` fails (ai-command.ts:243-254: entity observation invalid or area 0), line 283 picks `whereis`, then line 288 runs `if (netname === null) throw new Error("BotMatch_HelpAccompany reads an uninitialized source reply recipient");`.
  In botMatchLeadTheWay, when the teammate text resolves to the bot itself, `other = false` and `netname` stays null. Line 685 tests the stale `state.teamGoal.entity`, and line 687 then throws.
- Impact: a teammate says `<bot> help <teammate>` while that teammate is unlinked or inside solid, for example still connecting, and the server exits. The reach is narrower than BOTS-001 and team games only. The converted "uninitialized source" guards turn undefined behavior into process death on peer input.
- Remediation: fetch NETNAME unconditionally before the reply, which is what the source's intent requires, and remove these throws.

### BOTS-004 — Rerelease bots re-run the full route search every frame while the goal has no path
- **Verification (VERIFY-A): confirmed. Final severity: High.** brain.ts:1876 `stale = path===null || !pathValid || now-plannedAt>REPLAN`; :1900 `if (path===null) plannedAt=now` is a no-op because `path===null` keeps stale true next frame, so an unplannable combat goal (goalEntityId -1) replans a full reverse scan every frame. No think-stagger (bot-rerelease.ts:158). Perf.
- Severity: High
- Category: performance
- Location: src/bots/behavior/rerelease/brain.ts:1876, :1897-1899, :715; src/bots/behavior/rerelease/nav.ts:96-110; src/bots/navigation/runtime.ts:408-418
- Confidence: reproduced (brain.ts stub, nav.ts synthetic graph)
- Evidence:
  `const stale = this.state.pathState.path === null || !nav.pathValid(...) || now - plannedAt > REPLAN_SECONDS;`. Line 1899 sets `plannedAt = now` on failure, but the `path === null` test makes that pacing a no-op. Line 715 only abandons entity goals; combat goals (`aw.lastKnownOrigin`), objective homes and regroup points have `goalEntityId === -1`.
  Stub output: `100 thinks, unplannable combat goal: planPath calls 100`.
  One planPath on a 4900-node grid with zero-cost stubs took 17 ms and made 4900 `avoid` pointContents calls (a new memo each plan, brain.ts:1845), 4942 traces and 4901 hazard checks. An unreachable route took 10 ms. Bots with a valid path also replan fully every 2 seconds.
- Impact: bots fighting a target with no graph route (enemy across a gap or off-graph) each cost a full graph scan per server frame on top of real trace costs. A handful of bots can overrun the frame budget. There is no think stagger either (bot-rerelease.ts:158 thinks every bot every frame, unlike Q3's bot_thinktime).
- Remediation: pace failed plans with `plannedAt`, cache node hazard contents per map, and stagger planning across bots.

### BOTS-005 — The non-AAS estimate cache has a count cap but no byte cap, and each client has its own
- **Verification (VERIFY-A): confirmed. Final severity: High.** estimates.ts:71 caps `caches` at 128 entries by COUNT only, each a Map with one entry per reachable node (up to 100000 per construct.ts:112); navigation.ts:162-166 `forClient` builds a fresh NavigationRuntime per client, so caches, incoming-edge maps and the 16 MB AAS LRU are per-bot and not shared. Growth scales with bots × nodes × distinct goals, retained for the map. Leak/unbounded-growth confirmed in source.
- Severity: High
- Category: leak
- Location: src/bots/navigation/estimates.ts:42, :54-74; src/app/bootstrap/simulation/navigation.ts:162-166; src/bots/navigation/estimate-aas.ts:71
- Confidence: reproduced for per-runtime size; per-client multiplication traced
- Evidence:
  `this.caches.set(key, tails); if (this.caches.size > 128) {...}` stores a `Map<number, Tail>` with one entry per reachable node. nav.ts measured `tails: 128 goals 4900 nodes ... heap MB 93.0`. construct.ts:112 allows graphs up to 100000 nodes. `forClient` builds `new NavigationRuntime(...)` per client, so each bot holds its own cache, its own `edges` Map (estimate-aas.ts:66) and its own 16 MB AAS LRU, rebuilt when the player or locomotion changes.
- Impact: Q3-AI bots on Q1/Q2 maps with NAV or constructed graphs reach 128 distinct goals quickly (items plus enemy areas). At 4900 nodes that is about 93 MB per bot, or 750 MB with 8 bots, retained for the map. A constructed graph can be much larger. On AAS maps, up to 16 MB times bot count with no route sharing, unlike botlib's single cache. Each miss is also a full reverse Dijkstra with no early exit.
- Remediation: cap by bytes as the AAS cache does and store dense typed arrays. Share estimate caches across clients with identical profiles.

### BOTS-006 — Reachability lookup scans all graph edges on every call
- **Verification (VERIFY-S): confirmed. Final severity: Low.** VERIFY-G's cost ruling stands. The source review made no statement about it.
- Severity: Medium
- Category: performance
- Location: src/bots/behavior/q3/travel/routing.ts:93; src/bots/behavior/q3/travel/controller.ts:301, :303, :322, :329, :349, :362; src/bots/behavior/q3/navigation.ts:268
- Confidence: reproduced (reach.ts)
- Evidence:
  `const edge = this.runtime.graph.edges.find(candidate => this.handle(candidate) === number);`. moveToGoal calls `reachability()` at least 3 times per think on the ground path. Measured: 10k edges 46.7 µs per call, 30k 75.6 µs, 60k 198.6 µs. navigation.ts:268 and controller.ts:303 add more linear scans whenever a bot stands on a mover.
- Impact: with 16 bots at 10 Hz on a 30k-reachability map this is about 36 ms of CPU per second before any real work. Edge id equals the reachability index on AAS graphs, so the scan is unnecessary.
- Remediation: index edges by id in NavigationRuntime and edges by mover model once at construction.

### BOTS-007 — Rerelease senses trace to every enemy before testing the view cone, and world views are rebuilt per bot
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** brain.ts:1035-1039 traces per live player/monster before cone use; senses.ts:107 and :133 consume lineOfSight only with a FOV flag. Allocation counts not measured.
- Severity: Medium
- Category: performance
- Location: src/bots/behavior/rerelease/brain.ts:1035-1039, :1068, :639, :1655, :1719, :1863; src/app/bootstrap/simulation/bot-rerelease-world.ts:50-62, :78-97
- Confidence: traced
- Evidence:
  `const geom = evaluateSightGeometry(...); const sightTrace = world.traceLine(self.eye, ent.center); const clear = geom.withinInvisRange && (...)`. The trace runs even when neither cone contains the target, though senseStep only uses lineOfSight with inSightFov or inWeaponFov (senses.ts).
  `world.entities()` allocates about 5 objects per actor for each bot each frame. `world.self()` rebuilds weapon and ammo tables with inventory searches and is called several times per think.
- Impact: coop maps with 100 monsters and 8 bots cost 800 traces and about 4000 object allocations per frame from senses alone.
- Remediation: test both cones before tracing, share one frame's entity snapshot across bots, and cache `self()` within a think.

### BOTS-008 — Movement is projected onto the pre-turn view, and the comment describing the correction has no code under it
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** path-follow.ts:359-360 projects before brain.ts:964 aimStep; the comment at brain.ts:977-984 has no code, then section 7 begins; bot-commands.ts passes fields unchanged. 18 degrees per frame is 360 deg/s at 50 ms.
- Severity: Medium
- Category: bug
- Location: src/bots/behavior/rerelease/brain.ts:964-965, :977-984; src/bots/behavior/rerelease/path-follow.ts:359-360, :395-402; src/app/bootstrap/simulation/bot-commands.ts:7-29
- Confidence: reproduced (brain.ts stub)
- Evidence:
  The comment says forwardmove and sidemove "were projected onto the view the bot held when the frame began ... Left uncorrected the world direction comes out rotated", then section 7 starts with no rotation code. rereleaseBotCommand passes the fields through unchanged. Measured with an explicit goal at +90 degrees, as view yaw:world-direction error per frame: `17:17 35:18 53:18 70:17 82:12 88:6 91:3 ...`, worst 18 degrees at 360 deg/s. Error grows with skill speed (nightmare clamps at 720 deg/s per aim.ts).
- Impact: bots drift off route during every turn. This matches the failure the comment describes: walking into the wall beside the route. It feeds the stuck and wedge machinery that the file spends hundreds of lines on. gapAhead (brain.ts:1468) also evaluates the unrotated direction, so the lava guard probes the wrong line while turning.
- Remediation: rotate the move vector by the yaw change after aimStep, or compute aim before projecting. Delete the comment if the correction is intentionally absent.

### BOTS-009 — AAS parser accepts files that hang or amplify after parsing
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** id checks only ident, version and BSP checksum (`botlib/be_aas_file.c:362-388`), so the parser gap exists in id too. The port's parser checks more than id's does, but not this. Source review: SRCQ3
- Severity: Medium
- Category: security
- Location: src/bots/navigation/aas.ts:92-97, :147-163; src/bots/navigation/graph.ts:64-78; src/bots/navigation/estimate-aas.ts:41-44
- Confidence: reproduced (aas.ts)
- Evidence:
  Node children are only range-checked, so a DAG with both children pointing to the next node passes. aasBBoxAreas has no visited set and the depth check only bounds path length. Measured: file bytes 548, depth 18, 56 ms; 620 bytes, depth 24, 622 ms; 644 bytes, depth 26, 2368 ms (exponential). bboxAreas is reached from q3/ai-navigation.ts:473 and q3/navigation.ts:238.
  `settings` reach ranges may overlap: 2000 areas sharing 2000 reaches is a 240 KB file producing 3,998,000 edges in 1025 ms, quadratic in file size, and crossings (estimate-aas.ts:41) multiply further.
- Impact: a crafted AAS in a pk3 that matches the BSP checksum stalls map load or a bot frame indefinitely, or exhausts memory. A depth of 40 nodes is under 1 KB. The checksum is computable by the attacker.
- Remediation: require each non-root node to have exactly one parent, and reject overlapping reach ranges or cap total edges at the reachability count.

### BOTS-010 — Unvalidated AAS fields fail at runtime, contradicting the load.ts "counts as absent" contract
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** Same header-only checks in id (`botlib/be_aas_file.c:362-388`). The defect is against the port's own `load.ts` contract, not against id. Source review: SRCQ3
- Severity: Medium
- Category: robustness
- Location: src/bots/navigation/aas.ts:76-102; src/bots/navigation/load.ts:43-49, :58-59; src/bots/navigation/runtime.ts:84; src/bots/navigation/estimate-aas.ts:83-88, :94-96
- Confidence: traced; parser acceptance reproduced (aas.ts output `1-node parsed ok`, `bad cluster parsed ok 999`)
- Evidence:
  `settings.cluster`, `settings.clusterArea` and `portal.clusterAreas` are never validated, and there is no minimum node count. A parsed file with cluster 999 throws from `at(this.asset.portals, ...)` or `at(updates, goalIndex)` inside bot think. With fewer than 2 nodes, aasPointArea throws "Missing AAS BSP node/plane" (aas.ts:116). Overlapping reach ranges produce duplicate edge ids that throw at runtime.ts:84, which is outside preloadNavigation's try. The comment at load.ts:43-45 says a corrupt file "counts as absent".
- Impact: a truncated or stale AAS kills the map or the running server mid-match instead of falling back to constructed navigation.
- Remediation: validate cluster and portal references in parseAas, and move graph construction into the fallback guard.

### BOTS-011 — Monster path queries use a linear-scan queue and an unmemoized live edge check
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** rerelease-path.ts:72-86 linear-min plus splice queue with edgeAllowed per relaxation; `nearest` (:52-64) traces candidates in scan order. Per-query timing not re-run; call frequency still unmeasured.
- Severity: Medium
- Category: performance
- Location: src/bots/navigation/rerelease-path.ts:52-64, :72-86; callers src/compat/q2/rerelease/navigation.ts:49, src/app/bootstrap/simulation/runtime.ts:3792
- Confidence: reproduced for cost per query; call frequency plausible
- Evidence:
  `for (let index = 1; index < queue.length; index++) ...; queue.splice(best, 1)` is O(V²), and every relaxed edge calls `runtime.edgeAllowed(edge)`. Measured at 4900 nodes with zero-cost stubs: 26.5 ms, 19361 traces, 19318 contents and 19318 hazard queries for a single query. `nearest` traces every candidate in radius in scan order.
- Impact: Q2 rerelease guest monsters calling GetPathToGoal repeatedly pay this per request. A level with many pathing monsters can stall the frame. NavigationRuntime already has a heap and an admission memo that this path does not use.
- Remediation: reuse the runtime heap and per-query memoization, or cache paths per goal node within a frame.

### BOTS-012 — Bot asset loader reads every file under bots/, including all .nav files, per map
- **Verification (VERIFY-G): confirmed-with-changes. Final severity: Low.** assets.ts:58-66 filter matches bots/navigation. Size now measured from paks: Q2 rerelease 174 .nav files, 3.31 MB; Q1 rerelease 51 files, 0.69 MB. That is a few MB per load plus hashing, not a meaningful memory cost.
- Severity: Medium
- Category: performance
- Location: src/bots/behavior/assets.ts:58-66, :24 (`bytes.slice()`), :27-37; src/app/bootstrap/simulation/bot-assets.ts:15-35; src/bots/navigation/load.ts:37-40
- Confidence: traced for the content; size plausible (retail pak not available)
- Evidence:
  `orderedPaths.filter(path => /^(botfiles|bots)\//i.test(path) ...)` matches `bots/navigation/<map>.nav`. Navigation reads through `resources.open` (load.ts:40) and never through BotAssetFiles. Each file is copied, retained for the map, and hashed on every `provenance()` call. loadApplicationBotAssets can run the loader up to 3 times per map.
- Impact: extra map-change time and RSS scale with every navigation file in the mounted products, on a machine where memory is the stated constraint.
- Remediation: exclude `bots/navigation/` and restrict to the extensions the bot readers use.

### BOTS-013 — Botlib byte emulation allocates a view on every field access in hot evaluation paths
- **Verification (VERIFY-S): confirmed. Final severity: Low.** VERIFY-G's cost ruling stands. The source review made no statement about it.
- Severity: Medium
- Category: performance
- Location: src/bots/behavior/library/weights.ts:77-80, :191-207, :543-562; src/bots/behavior/library/memory.ts:88-93; src/bots/behavior/library/chat-data.ts:318; src/bots/behavior/library/goals.ts:1300-1316, :1404
- Confidence: reproduced (bots-scripts/chat.ts timing)
- Evidence:
  Every FuzzySeparator getter calls `allocationView`, which reads `allocation.bytes` (a new `subarray` from memory.ts:91) and creates a new `DataView`. Measured 3619 ns per `evaluate` on a two-level switch. chooseItem runs `evaluateUndecided` per level item per bot through a generator and `new LevelItem` per node. movement-state.ts:23-32 already caches its view, so the fix pattern exists in the repo.
- Impact: steady GC churn and roughly 3.6 µs times items times bots per item selection, plus similar costs in weapon selection and chat graph walks.
- Remediation: cache the DataView per allocation as moveData does, or decode weight trees into plain objects after load and write back only for save.

### BOTS-014 — A target_relay chain in map data becomes a fatal exception
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** The loop bound is as recalled (`for (i = 0; i >= 0 && i < 10;)`), ending at `return 0` (`game/ai_dmq3.c:4339`). Addition: at i=9 id first writes `targetname[10]`, one row past the array (:4162, :4330), and `cur_entities[10]` (:4332), then exits. So C has a stack overrun on the way out, then returns "no activator". Source review: SRCQ3
- Severity: Medium
- Category: robustness
- Location: src/bots/behavior/q3/ai-navigation.ts:527
- Confidence: traced for the throw; the source's loop bound is from memory
- Evidence:
  `if (depth + 1 >= 10) throw new RangeError("BotGetActivateGoal activation chain exceeds the source ten-level target allocation");`. target_relay and target_delay push their targetname with no cycle detection, so a relay targeting itself reaches this. As I recall it, the original's `for (i = 0; i >= 0 && i < 10;)` ends the search instead.
- Impact: a custom map with a relay loop or long chain crashes the server the first time a bot is blocked by the associated door.
- Remediation: return 0 (no activator) when the depth limit is reached.

### BOTS-015 — BotAI throws on a short console command after color stripping
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** With short args, `memmove` and `args[strlen(args)-1] = 0` stay inside `buf[1024]` (`game/ai_main.c:963,991-1008`), and the bot keeps going. Source review: SRCQ3
- Severity: Low
- Category: robustness
- Location: src/bots/behavior/q3/ai-main.ts:408-413
- Confidence: traced
- Evidence:
  `if (argumentsText.length < 2) throw new Error("BotAI reads outside the source quoted server command buffer");`. `print ^1` or `print x` reaches this because removeColorEscapeSequences can consume the whole argument. Stock chat formatting always quotes and prefixes a name, so I found no peer path that produces it. A game or mod that emits a short unquoted `print` does.
- Impact: process exit on game-module output that the original tolerated.
- Remediation: skip the command.

### BOTS-016 — Check-six recomputes the look direction every frame despite the comment saying it is captured once
- **Verification (VERIFY-H): confirmed. Final severity: Low.** brain.ts:957 computes aim.yaw + 180 every frame in the window. Only checkSixUntil and checkSixNextAt exist (:372-373), so the "Captured ONCE" comment at :1973-1977 describes state that does not exist.
- Severity: Low
- Category: bug
- Location: src/bots/behavior/rerelease/brain.ts:956-958, :1973-1977
- Confidence: reproduced (nav.ts aim loop)
- Evidence:
  The comment says "Captured ONCE, here. Recomputing '180 degrees from where I am facing' on every frame ... pirouettes", but no captured field exists in BotBrainMemory, and line 957 computes `this.state.aim.yaw + 180` each frame. At 720 deg/s over 0.5 s the yaw sweeps 216 degrees where a captured direction sweeps 180. The ideal never settles.
- Impact: bots spin at max speed for the window instead of looking back, and per BOTS-008 their movement direction rotates with it.
- Remediation: store the target yaw when the window opens.

### BOTS-017 — Chat diagnostics accumulate without bound and are saved
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** No source claim to settle. Not re-tested. Source review: SRCQ3
- Severity: Low
- Category: leak
- Location: src/bots/behavior/library/chat.ts:411, :620-623, :425, :906, :1112, :1127
- Confidence: traced
- Evidence:
  `this.issues.push(issue)` runs on every report, including runtime errors such as `empty console message heap` and invalid chat expansion. `checkpoint` structuredClones the array. The only clear is the library lifetime. goals.ts:1484 has the same pattern.
- Impact: bounded by map lifetime, but the growth is driven by runtime messages and inflates saves on long matches.
- Remediation: use a capped ring or do not retain runtime diagnostics.

### BOTS-018 — `nav.nodes` rebuilds the full view array on each access
- **Verification (VERIFY-H): confirmed. Final severity: Low.** nav.ts:91 maps on each getter read and brain.ts:1781 reads it in an up-to-8 loop. nav.ts:98 calls nodeView per node only because brain.ts:1846 always sets caps.avoid. The optional call would otherwise skip it.
- Severity: Low
- Category: performance
- Location: src/bots/behavior/rerelease/nav.ts:91; src/bots/behavior/rerelease/brain.ts:1781; src/bots/behavior/rerelease/nav.ts:98
- Confidence: reproduced (nav.ts: about 186 µs per access at 4900 nodes)
- Evidence:
  `get nodes(): readonly NavGraphNodeT[] { return this.runtime.graph.nodes.map(nodeView); }`. roamGoal indexes it up to 8 times per roam pick. planPath also allocates one view per node per plan.
- Impact: avoidable allocation on each roam selection and plan.
- Remediation: build the array once.

### BOTS-019 — CTF logic emits the wrong chat and leaves stale goal identity
- **Verification (VERIFY-H): confirmed. Final severity: Low.** brain.ts:1282 has no carrier test. selectGoal resets goalEntityId at :1632, but objectiveGoal then sets the carrier at :1301 and returns null at :1303. The combat and roam branches do not clear it, so :715-716 can rest the carrier and :1366 skips restStaticGoal.
- Severity: Low
- Category: bug
- Location: src/bots/behavior/rerelease/brain.ts:1282-1284, :1301-1303, :1299-1300
- Confidence: traced
- Evidence:
  Line 1282 fires `ctf_attacking_enemy_carrier` for any enemy player target, with no `carryingObjective` test. Line 1301 sets `goalEntityId = ourCarrier.id` and `goalIsLive = true`, then line 1303 may `return null`, so the later fallback goal runs with the carrier's identity. A failed plan then records the carrier in `unreachableUntil`, and restStaticGoal is skipped for a real static goal.
- Impact: misleading team chat, and occasional misattributed goal rest.
- Remediation: gate the chat on the carrier flag and set goal identity only when the goal is returned.

### BOTS-020 — Duplicated logic between navigation paths and bot families
- **Verification (VERIFY-H): confirmed. Final severity: Low.** Heaps differ only by field name (runtime.ts:25-54, estimates.ts:9-36). graph.ts:9 maps AAS 4 (barrier) and 5 (jump) both to "jump", and nav.ts:67 treats 5 as BarrierJump, so AAS jumps invert on rerelease bots. load.ts:37-38 makes AAS reachable for Q1/Q2 maps.
- Severity: Low
- Category: maintainability
- Location: src/bots/navigation/runtime.ts:25-54 and estimates.ts:9-36 (identical binary heaps); runtime.ts:314, estimates.ts:54, rerelease-path.ts:72 (three shortest-path searches); nav.ts:62, rerelease-path.ts:26, travel/routing.ts:61, graph.ts:117 (four TravelMode switch tables); weights.ts:503, genetic.ts:50, chat.ts:295 (same masked random); weights.ts:243/253 and structure.ts:77/81 (same helpers)
- Confidence: traced
- Evidence:
  `at()` is defined in 7 files in src/bots. Numeric flags are inlined with no names in runtime.ts:243-244, :286, :293 and nav.ts:67-71. The jump-type test `sourceTravelType === 5` appears in nav.ts:67 and rerelease-path.ts:28 and means barrier jump for KEX but plain jump for AAS, so the Q1/Q2 AAS fallback in load.ts:37-38 maps it the wrong way in rerelease nav.ts.
- Impact: fixes such as BOTS-011 must be repeated, and the format-dependent constant is a live trap.
- Remediation: export one heap and one travel vocabulary from navigation, and name the source flag constants.

### BOTS-021 — Hand-written settings parser could be table-driven
- **Verification (VERIFY-H): confirmed. Final severity: Info.** 101 case labels in 1038 lines; botdata.ts:798-801, 900-903 match. No defect is shown, only a refactoring opportunity.
- Severity: Low
- Category: maintainability
- Location: src/bots/behavior/rerelease/data/botdata.ts:798-801, :900-903, :960 (101 `case` labels in 1038 lines)
- Confidence: traced (sampled)
- Evidence:
  `case "aiming.max_acceleration": { const n = num(); if (n !== undefined) settings.aiming.maxAcceleration = n; break; }` repeats per key. The record classes already declare the fields.
- Impact: every schema key costs 4-5 lines, and mismatches are easy to miss.
- Remediation: declare a key-to-field table and generate the switch behavior from it.

### BOTS-022 — Dead or vestigial code
- **Verification (VERIFY-H): confirmed. Final severity: Low.** The six named methods each have exactly one occurrence across src and tests. The stuckCount doc at path-follow.ts:171 contradicts brain.ts:36-40 and :735. brain.ts:957 destructure, :1204 `now > 0`, the :1508 orphan comment and runtime.ts:248-255 all match.
- Severity: Low
- Category: dead-code
- Location: src/bots/behavior/library/memory.ts:138, :155; chat.ts:513, :587; rerelease/brain.ts:596, :611, :957, :1204, :1509, :1981; rerelease/path-follow.ts:171, :174; navigation/runtime.ts:248-255
- Confidence: traced (scripted symbol counts, then opened)
- Evidence:
  `printMemoryLabels`, `dumpMemory`, `dumpConfiguration`, `printReplyChatKeys`, `awarenessOf` and `currentPathIndex` have no callers in src or tests. `followPath` takes unused `_rng`, and `wantsUse` unused `_world`. `stuckCount` is documented as "which the brain uses to escalate", but the brain uses `stuckTrips`. `const { forward } = { forward: bvec(...) }` is a no-op destructure, `&& now > 0` is vestigial, and an orphan doc comment sits at brain.ts:1508. `#nodeAllowed` is a pass-through wrapper.
- Impact: misleading API surface and docs.
- Remediation: remove them, keeping any debug dumps that are deliberately ported behind a real command.

### BOTS-023 — No tests for peer-driven chat limits or malformed AAS
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** Test gap stands. The retail template shapes above can now seed the tests directly. Source review: SRCQ3
- Severity: Medium
- Category: test-gap
- Location: tests/bots/behavior/library/source-behavior.test.ts, tests/bots/navigation/aas-authoring.test.ts, tests/bots/behavior/state.test.ts
- Confidence: traced (grep)
- Evidence:
  `grep -rln "signed-char\|exhausted the source waypoint\|Cyclic AAS\|invalid AAS lump\|area/settings counts" tests` returns nothing. No test covers chat longer than 127 characters, repeated checkpoints, or rejection of a malformed AAS.
- Impact: BOTS-001, -002, -009 and -010 went undetected, and these are the only bot inputs that come from peers or third-party files.
- Remediation: add these cases, and a test that feeds long and malformed chat through the whole console message path with bots active.
