# CORE — Core math/commands, foundation, contracts, world collision, movement
## Coverage
Read in full: src/core/math.ts (1124), src/core/commands/index.ts (1024), commands/text.ts (149), commands/filter.ts (72), core/numeric.ts (482); all of src/foundation (1540 total: index, handles, cleanup, stamp, arena, pool, binary, strings, bounded-queue, id-index, vec, sys-queue, event-ring); movement: swept-body (131), body-shape (14), client-outputs (24), q1/netquake (440), q1/quakeworld (341), q1/common (158), q1/result (34), q1/player-actions (41), q1/pusher (145), q1/monsters (226), q1/water-transition (8), q2/classic (668), q2/rerelease (960), q2/index (227), q2/swept (58), q2/math (61), q2/types (81), q2/view (31), q2/dimensions (9), q3/move (536), q3/slide-move (104), q3/provider (178), q3/prediction (239), q3/view (12), q3/jump-pad (30), q3/postures (17); world: collision/index (260), collision/contents (132), collision/body (82), collision/q1/index (301), collision/q1/hull (119), collision/q2 (372), collision/q3/model (358), collision/q3/world (478), collision/q3/index (78), collision/q3/clip-models (159), spatial/index (158), scheduler (215), actors/registry (297), actors/triggers (32), geometry/q1-solid/index (41).
Sampled: core/cvars/index.ts lines 1-234 plus a throw scan (821); core/info-string.ts (42); collision/q3/topology.ts lines 1-62 (281); collision/q3/patch.ts grep only (512); q3/weapon.ts lines 1-50 (151); contracts/** by scripted export/importer survey plus contracts/movement.ts:274-298 (4429 total, not read line by line); world/** Map/Set field scan for growth.
Skipped: q1/types, q1/index, q3/animation, q3/constants, q3/types, q3/index; collision/q3/polylib, map-resource, map-loader, checksum, settings; collision/media (only callers read); geometry/q1-solid clipspace/polyhedron/sweep; actors/body, callbacks, source-slots; world/session/** (about 2000 lines); world/gameplay/** (about 1900 lines, including authority.ts 820); core common-parse, md4, binary, q3-cd-key, q3-product-policy, omnitimer, random, cvars/numbers,mirror,info.
Movement fidelity was compared against id source from memory plus src/compat/q2/classic/pmove.c in the sibling C project; no copy of rerelease p_move.cpp or WinQuake sv_phys.c is on this machine. Fidelity claims below are limited to places I am confident of.
Experiments: exp/{q1,misc,pm,loop}.ts, run against the clean HEAD checkout. contracts.py is the export survey.
## Strengths
- Movement ports are very close to the originals. I walked SV_FlyMove, SV_WalkMove, SV_TryUnstick, SV_WallFriction, SV_CheckStuck, SV_Physics_Toss, SV_movestep, SV_CheckBottom, SV_NewChaseDir, SV_PushMove; QW PM_FlyMove, PM_GroundMove, NudgePosition, JumpButton, CheckWaterJump; Q2 Pmove and step/ground logic; Q3 PmoveSingle, PM_SlideMove, PM_StepSlideMove, PM_GroundTrace, PM_CrashLand, PM_Footsteps. No divergence found in those except CORE-006. Source quirks are deliberately retained and commented (NudgePosition unsnapped base, 215 southwest constant, pml.origin aliasing in rerelease duplicate-plane recovery).
- sweepBody unifies five bump-solver variants with explicit policy fields and they map correctly to each original's behavior (original vs last-progress velocity, sequential clip, paired Q3 planes).
- Hull traversal (SV_RecursiveHullCheck, CM_RecursiveHullCheck, CM_TraceThroughTree/Brush, CM_TestBoxInBrush, SV_ClipMoveToEntityList merge rules) matches source including epsilon handling, staged binary32 and the 2048 non-axial offset.
- Finding B1 is fixed: unifiedCommandInBounds (src/app/bootstrap/network/unified-control.ts:63-66) is enforced at src/app/bootstrap/simulation/network-unified.ts:237.
- Remote Q1, QW and Q2 stufftext is allow-listed rather than fed to CommandBuffer (remote-q1.ts:242, qw-client.ts:141, q2-client-receiver.ts:105), which removes the classic hostile-server command channel.
- Numeric operations are cached per profile, so per-trace createNumericOperations calls are cheap (numeric.ts:101-110). Q1 clip-cell cache is a correctly accounted LRU (q1/index.ts:191-223). Q2 and Q3 readers reject BSP node cycles at load. Spatial index mirrors the area-node tree with no growth beyond actor slots.
- math.ts offers *Into helpers with correct alias handling, verified by reading each.
## Findings
### CORE-001 — Q1 traces do not apply "points never interact", so zero-size missiles block player movement
- **Verification (VERIFY-Q): confirmed. Final severity: High.** WQ world.c:843-844 and QW/server/world.c:746 skip a zero-size candidate when the mover has size. src/world/collision/index.ts #trace has no size test. Source review: SRCQ1
- Severity: High
- Category: bug
- Location: src/world/collision/index.ts:168-204; src/world/collision/body.ts:21-28; src/compat/qc/actor-state.ts:23-31; src/app/bootstrap/simulation/actor-execution.ts:62-70
- Confidence: reproduced (scene level), traced (QC collision mapping)
- Evidence: SV_ClipToLinks skips an entity with `if (clip->passedict && clip->passedict->v.size[0] && !touch->v.size[0]) continue; // points never interact`. #trace has no equivalent; a grep for any size test finds none. actor-state.ts:28 maps QC `solid === 2` to "box" regardless of size, and body.ts:23 expands the zero-size box by the mover's hull. Reproduction: player box swept through a linked zero-size Q1 actor returned `fraction 0.4198, hit actor`; expected fraction 1.
- Impact: In Q1 family games, rockets, nails and grenades (SOLID_BBOX with size 0) from other owners become player-sized obstacles. A player walks into another player's resting grenade and stops on it, and SV_Impact-style touch fires from the player's move instead of the projectile's. This alters deathmatch and monster-projectile behavior. Monster movement is affected the same way.
- Remediation: In the Q1 policy branch, skip the candidate when the pass actor has non-zero x extent and the candidate has zero x extent. Add a fixture beside tests/world/collision/q1/collision.test.ts.
### CORE-002 — Native Q1 sizes other than exact hull dimensions bypass clip hulls, changing monster collision and costing 13x or more per trace
- **Verification (VERIFY-Q): confirmed. Final severity: High.** WQ world.c:147-153 selects by `size[0]` only. RR monsters/{grunt,knight,hellknight,enforcer,zombie,scrag,spawn}.qc use 32x32x64, rottweiler.qc:373 uses 64x64x64 and rotfish.qc:205 uses 32x32x48. None match src/world/collision/q1/index.ts:112 exact-dimension lookup, so all take the derived path. Source review: SRCQ1
- Severity: High
- Category: bug
- Location: src/world/collision/q1/index.ts:108-115, 129-177; src/movement/q1/monsters.ts:39-43; src/compat/qc/spatial-host.ts:81-82
- Confidence: reproduced
- Evidence: SV_HullForEntity chooses by width only: `if (size[0] < 3) hulls[0]; else if (size[0] <= 32) hulls[1]; else hulls[2]`. TS requires all three dimensions to match: `Q1_HULL_BOUNDS.findIndex(hull => equal(dimensions(hull), size))`. Every Q1 caller passes `hull: null`, only remote-qw.ts:97 passes a hull. progs106 soldiers, knights, zombies and scrags use 32x32x64, dogs 64x64x64 (sizes from memory of the QC). Reproduction with a corridor whose hull 1 ceiling is z=68: 32x32x56 box stops at 67.97; the 32x32x64 soldier box stops at 59.97; forcing `hull: 1` gives 67.97. Timing on a two-node map: 0.69 us native vs 9.15 us derived; real maps split many more cells and also derive clip cells.
- Impact: Monsters and QC droptofloor use the derived-cell path rather than the map's compiled clip hull, so a monster blocked or passable in the original can differ, for example under low ceilings and at clip brushes. Every such monster trace takes the slow path, on the most trace-heavy actors in a Q1 level.
- Remediation: For native Q1 geometry with a Q1 movement policy, select hull by source width rule and keep the offset computation at line 119. Reserve the derived path for foreign geometry or an explicit policy flag; tests at collision.test.ts:145 cover "foreign boxes" and need that flag.
### CORE-003 — createQ1Hulls rebuilds the full drawing-node table for every submodel
- **Verification (VERIFY-G): confirmed-with-changes. Final severity: Medium.** hull.ts:25-34 rebuilds `drawing` per call; index.ts:62-66 caches per model. Correction: this is per-map excess memory freed at map change, not a session leak; recategorize as performance/memory. The 195 MiB measurement not re-run.
- Severity: Medium
- Category: leak
- Location: src/world/collision/q1/hull.ts:25-34; src/world/collision/q1/index.ts:62-66
- Confidence: reproduced
- Evidence: `const drawing = map.nodes.map(node => { ... })` runs per createQ1Hulls call and the result is cached per model in `this.hulls`, although every model indexes the same node array. Measured: 100 models over 30,000 nodes added 195 MiB and 373 ms, about 65 bytes per node per model.
- Impact: Retention scales with nodes times solid brush models traced. A stock map costs tens of MB. A large custom BSP2 map with 200k nodes and 500 models would approach 6.5 GB and fail. Allocation arrives as lazy hitches when each door or platform is first traced. Freed at map change.
- Remediation: Build `drawing` once per geometry and share it among models, varying only firstClipnode.
### CORE-004 — BSPX BRUSHLIST path clips every brush of the model on every non-native trace
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** index.ts:178-190 authored branch never tests brush.bounds against envelope and clips every brush; `brushList.find/some` runs per trace. Limited to BSPX BRUSHLIST maps.
- Severity: Medium
- Category: performance
- Location: src/world/collision/q1/index.ts:178-190
- Confidence: traced
- Evidence: `for (const brush of authored.brushes) { ... let cell = boxCell(brush.bounds); for (const plane of brush.planes) { cell = clipCell(cell, plane); ...` The `envelope` parameter is used only in the non-authored branch, and brush.bounds is never tested against it. Line 179 and 145 also run `brushList?.find` per trace.
- Impact: O(brushes x sides) polyhedron clipping with allocation per trace. Combined with CORE-002, every monster trace on a BRUSHLIST map pays it. Thousands of brushes at several traces per monster per frame becomes frame-dominant.
- Remediation: Reject brushes whose bounds miss the envelope before building a cell, and cache built cells per brush.
### CORE-005 — CommandBuffer reports source overflows as uncaught exceptions that end the process
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** Q3 part only: `Cbuf_AddText` prints "overflow" and discards (`qcommon/cmd.c:93-96`), so "the originals had undefined overflow" is false for Q3. Q1 and Q2 are not settled here. Source review: SRCQ3
- Severity: Medium
- Category: robustness
- Location: src/core/commands/index.ts:559, 573, 649, 894, 1017; src/core/commands/text.ts:9, 80, 83; callers src/app/bootstrap/application.ts:4401, 4476, 4693-4704, src/app/bootstrap/input.ts:766
- Confidence: reproduced (throw), traced (propagation)
- Evidence: `if (first.dialect !== "q3") throw new RangeError("Command line overflows source line buffer");`. Reproduced in q1-netquake and q2-classic with a 1100-character line, and `append("echo €\n")` throws "Command text requires source bytes". Local QC stuffcmd reaches append through application.ts:4401; executeAsync at 4476 has no guard; the step catch rethrows for a non-fatal world (about line 4686) and run() has no catch. Q3 truncates instead (line 650), showing the alternative exists.
- Impact: A config with one long line, a QC mod's oversized stuffcmd, or a long alias takes down the client with a RangeError rather than a console message. The originals had undefined overflow here, so strictness is defensible, but a process exit is the wrong failure for text input. Console-typed input was not traced end to end.
- Remediation: Catch these errors at the drain boundary, print the source-style message, and discard the offending line.
### CORE-006 — Q2 classic pmove uses player-solid mask for dead players
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** p_client.c:1537-1543 selects MASK_DEADSOLID when `pm_passent->health <= 0`. movement/q2/index.ts:134 is unconditional. cl_pred.c CL_PMTrace uses MASK_PLAYERSOLID, so prediction should keep it. Only the TS base path is affected; native DLLs call their own PM_trace through compat/q2/classic/pmove.ts. Source review: SRCQ2
- Severity: Medium
- Category: bug
- Location: src/movement/q2/index.ts:134; src/movement/q2/types.ts:73
- Confidence: traced
- Evidence: `trace: (start, mins, maxs, end) => scene.trace(start, mins, maxs, end, MASK_CLASSIC_PLAYERSOLID)` is unconditional. Original p_client.c PM_trace: `if (pm_passent->health > 0) ... MASK_PLAYERSOLID else ... MASK_DEADSOLID`. The rerelease port handles this (rerelease.ts:244-247). input.environment.health is available. Provider is used server-side at app/bootstrap/simulation/player-movement.ts:97.
- Impact: Dead players in classic Q2 collide with monsters and bodies while sliding or falling, where the original lets them pass.
- Remediation: Select MASK_DEADSOLID for authoritative execution when health <= 0, leaving prediction as the client source does.
### CORE-007 — Q1 reader accepts cyclic clipnodes; failure surfaces mid-game as a thrown trace error
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** q1-map/index.ts:162-164 range-checks clipnodes only; Q2 reader:248 and Q3 decode:208 fail cycles at load; hull.ts:66 and :86 throw only at runtime. Stall length still unmeasured.
- Severity: Medium
- Category: robustness
- Location: src/formats/q1-map/index.ts:162-164; src/world/collision/q1/hull.ts:66, 86
- Confidence: traced
- Evidence: Load validation is range only: `index(child.index, map.clipnodes.length, ...)`. Q2 (formats/q2-map/reader.ts:248) and Q3 (formats/q3-map/decode.ts:208) fail cycles at load. Runtime guards `throw new RangeError("Cycle in Quake trace hull")` fire only after recursing to depth clipnodes.length, and crossing segments branch before that bound.
- Impact: A malformed or server-supplied BSP loads successfully, then throws or stalls for a long time in the first affected trace rather than failing cleanly at load. Worst-case stall length is estimated, not measured.
- Remediation: Run the Q2 style acyclic check over each hull's clipnodes and over drawing nodes at load.
### CORE-008 — Per-trace allocation throughout the shared collision path
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** contents.ts:72-80 loops 32 bits, called per trace at q2.ts:161 and q3/index.ts:52, :62; body.ts:10-17 builds hull objects per call. Remaining sites sampled; whole-game share still unmeasured.
- Severity: Medium
- Category: performance
- Location: src/world/collision/contents.ts:72-80 (called per trace from q2.ts:161, q3/index.ts:52); src/world/collision/body.ts:10-17, 32-33; src/world/collision/q3/world.ts:132, 354-405; src/world/collision/q3/model.ts:89, 110; src/world/collision/q1/index.ts:269; src/world/collision/index.ts:168-204
- Confidence: traced
- Evidence: geometryMask loops 32 bits through convertContents on every trace, even when policy and geometry family match and the mask is unchanged. traceActorBody builds six planes and six clipnodes (Q1) or a new TemporaryCollisionModel with new CollisionCounters (Q3 path) per candidate actor. `expansion` allocates a vec3 per brush side per trace. Q1 boxLeaves recomputes `center` and `extents` objects inside the per-node loop. #trace allocates a query array, walks triggers as well as solids when actor collision is bound, and snapshots each candidate.
- Impact: Traces are the hottest engine path, and this produces continuous GC pressure scaling with brush sides and nearby actors. Whole-game share was not measured.
- Remediation: Return contentsMask directly when families match, compute expansions by scalar arithmetic, hoist boxLeaves values, reuse one box hull, and use a solid-only visitor in place of query().
### CORE-009 — StampSet epoch wrap check can never fire
- **Verification (VERIFY-H): confirmed. Final severity: Low.** Re-run from clean: begin at 0xffffffff gives epoch 4294967296, and mark(1) returns true twice. stamp.ts:22-23 cannot observe zero.
- Severity: Low
- Category: bug
- Location: src/foundation/stamp.ts:21-27
- Confidence: reproduced
- Evidence: `this.currentEpoch++; if (this.currentEpoch === 0) {...}` is a JS number, so it reaches 4294967296 and the Uint32Array stores 0. Reproduced: after begin() at 0xffffffff, epoch is 4294967296 and `mark(1)` returns true twice.
- Impact: After 2^32 begin() calls on one instance, deduplication is off permanently. Instances live per map, so this needs a single map running about a day at 50k traces per second. Q2 then retests brushes; render/scene/visibility.ts also uses StampSet and its effect was not traced.
- Remediation: Compare against 0xffffffff before incrementing and re-zero the marks there.
### CORE-010 — pmove implementations rebuild closures, and in classic a class, per command
- **Verification (VERIFY-H): confirmed. Final severity: Low.** classic.ts:11-14 builds math and declares a class inside the call; swept.ts:26 calls createMovementMath per sweep and :46-55 converts at each callback. The timing was not re-measured.
- Severity: Low
- Category: performance
- Location: src/movement/q2/classic.ts:10-14; src/movement/q2/rerelease.ts:22, 53-60, 958-960; src/movement/q2/swept.ts:26; src/movement/q2/index.ts:123; src/movement/q1/common.ts:22
- Confidence: reproduced
- Evidence: pmoveClassic declares `class PmlT` and about 30 functions in its body, and sweepQ2Body calls createMovementMath on each slide. Tuple and object conversion occurs for every math callback in swept.ts:46-55. Measured 7.43 us per command with a stub trace against 0.61 us of fixture cost.
- Impact: Small per player, roughly 0.5 ms per second per client at 60 Hz, but it is constant garbage and fresh class shapes on a hot path, and exceeds what the math needs.
- Remediation: Hoist helpers to module scope over a reusable state object.
### CORE-011 — Unbounded alias recursion hangs the main thread in Q1 dialects
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** WQ cmd.c:641 and :184 re-insert alias text in an unbudgeted Cbuf_Execute loop, so the original also hangs as the finding states. Source review: SRCQ1
- Severity: Low
- Category: robustness
- Location: src/core/commands/index.ts:793-795, 617-658
- Confidence: reproduced
- Evidence: Only Q2 counts expansions: `if (isQ2(...) && ++this.aliasCount === 16)`. `alias a "a"` then `a` under q1-netquake did not return within 6 s (killed by timeout, exit 124); the same input under q2-classic returned normally. Q3 `vstr` self-reference takes the same unbudgeted path by reading (not run). Original Q1 also hangs.
- Impact: A config or a local mod's stuffcmd freezes the client or a dedicated server. Remote stufftext cannot reach this path. Batches are budgeted (128 dispatches), so rcon is covered.
- Remediation: Apply a per-drain dispatch budget that prints and discards on overflow.
### CORE-012 — EventRing is a poor fit as the command deque
- **Verification (VERIFY-H): confirmed. Final severity: Low.** event-ring.ts:141, 326 and 349 reach slots.fill(null) over capacity 32768 (commands/index.ts:87). pendingText is a concatenating getter (:397) read at :549.
- Severity: Low
- Category: performance
- Location: src/core/commands/index.ts:87-93, 562-563, 746; src/foundation/event-ring.ts:137-143, 320-329, 348-357
- Confidence: reproduced
- Evidence: CHUNK_RING_CAPACITY is 32768 slots. prepend and removeAtOffset call reset(), which runs `this.slots.fill(null)` over full capacity regardless of live count. beginBatch allocates two new rings. Measured: 7.0 us per command, 17.4 us per alias, 63.8 us per executeBatch. pendingText also re-concatenates on each append (index.ts:549).
- Impact: Tolerable at console rates. Cursors, leases and stats go unused, and the ring costs more than a small array deque.
- Remediation: Use a plain array deque for command chunks.
### CORE-013 — retiredClients and retiredProducers only grow
- **Verification (VERIFY-H): confirmed. Final severity: Low.** commands/index.ts:363 and :369 add with no removal; :293-294 share the sets; :318 is linear. Callers of discardClient are local only (input.ts:340, application.ts:3785).
- Severity: Low
- Category: leak
- Location: src/core/commands/index.ts:157-159, 293-294, 314-320, 363, 369
- Confidence: reproduced (cost), traced (retention)
- Evidence: Entries are added at lines 363 and 369 with no removal, and sets are shared into replacement buffers at 293-294. retiredClient scans linearly using `equals`. With 100k entries one remote-source append and execute went from 6.0 us to 419.5 us. discardClient call sites are local-seat retirement only (app/bootstrap/input.ts:340, application.ts:3785), so network peers do not feed it.
- Impact: Growth follows local seat and mod presentation churn, so it is small in practice. Refuted as a remote-driven leak.
- Remediation: Prune an entry once no queued work references it, or key by a client number.
### CORE-014 — Actor slot allocation scans from zero
- **Verification (VERIFY-H): confirmed. Final severity: Low.** registry.ts:61 runs findIndex from slot zero per allocation.
- Severity: Low
- Category: performance
- Location: src/world/actors/registry.ts:61
- Confidence: traced
- Evidence: `let index = this.slots.findIndex(slot => slot.actor === null);` runs per allocation, with an array-wide scan in a closure. `ownedBy` and `observations` also flatMap all slots.
- Impact: Linear in occupied low slots for every projectile or gib spawn, quadratic over map load. Lowest-free-slot order may be intended behavior.
- Remediation: Keep a low-water free-slot hint that preserves lowest-free ordering.
### CORE-015 — "Allocation-free" math helpers allocate
- **Verification (VERIFY-H): confirmed. Final severity: Low.** math.ts:611-615 documents allocation-free; :619-640 allocates objects and arrays each call; :875-876 points to the unused vector store.
- Severity: Low
- Category: docs
- Location: src/core/math.ts:611-615, 619-640, 651
- Confidence: traced
- Evidence: rotatePointAroundVectorRuleInto, documented as "Allocation-free", allocates `radial`, `vertical`, `basis`, `zRotation`, `inverse`, `temporary` and `rotation` per call, plus two vec3 under the vm rule. math.ts:875-876 also directs readers to "the foundation vector store", which no production code uses (see CORE-016).
- Impact: A caller choosing the Into form for a hot path gets no saving.
- Remediation: Use module-level scratch or correct the comment.
### CORE-016 — Five foundation modules are unused in production
- **Verification (VERIFY-H): confirmed. Final severity: Low.** packActorKey, actorKeyOf, FixedPool, SysEventQueue, createVec3Store and ByteArena have no src references outside foundation. The five files total 593 lines. cleanup.ts add and push are identical.
- Severity: Low
- Category: dead-code
- Location: src/foundation/handles.ts (42), pool.ts (74), arena.ts (65), sys-queue.ts (227), vec.ts (185)
- Confidence: traced
- Evidence: packActorKey, actorKeyOf, FixedPool, SysEventQueue and createVec3Store appear only in foundation and tests. ByteArena is used only by sys-queue. Headers describe them as mirrors of a C foundation. By contrast EventRing (39 importers), BoundedQueue (14), CleanupStack (33) and StampSet (4) earn their place; IdIndex and StringTable have real users. CleanupStack add and push are duplicates.
- Impact: 593 lines plus tests are maintained without use, and they advertise an actor-key and vector-store architecture the engine does not use.
- Remediation: Delete them, or adopt them where allocation findings like CORE-008 would benefit.
### CORE-017 — FrameScheduler.advance is test-only and quadratic
- **Verification (VERIFY-H): confirmed. Final severity: Low.** scheduler.ts:168-175 rescans per iteration. Scheduler .advance calls occur only in tests/core/scheduler.test.ts.
- Severity: Low
- Category: dead-code
- Location: src/world/scheduler.ts:155-184
- Confidence: traced
- Evidence: Each loop iteration rescans `this.scheduled.values()` to find the next thinker. A grep finds calls only in tests/core/scheduler.test.ts; production uses run() per actor through executeActor. Tests therefore exercise traversal semantics production does not take.
- Impact: Misleading API and test coverage, with an O(N squared) trap if adopted.
- Remediation: Remove it, or sort once and have production use it.
### CORE-018 — Contract surface: unused exports, runtime-specific files, and a leaky trace type
- **Verification (VERIFY-H): confirmed-with-changes. Final severity: Low.** All 11 exports occur in one file; 12 of 42 contract files are runtime-specific; scene.ts has 90 exports; contents.ts:93 sniffs contents; the inversions exist. Correction: contracts/scene.ts is imported by 162 src files, or 209 with tests, not 174.
- Severity: Low
- Category: maintainability
- Location: src/contracts/common.ts (CvarPolicy), content.ts (ModuleRole), execution.ts (SourceGameLifecycle), gameplay.ts (CampaignController, MatchController), protocol.ts (SeatUserCommand, NetworkDelivery, ProtocolSupport), ui.ts (LegacyUiFeeder, HudProvider), world.ts (ClientAdmission); src/world/collision/q1/index.ts:22; src/world/collision/contents.ts:93; src/movement/q3/move.ts:7; src/core/cvars/index.ts:1; src/core/common-parse.ts:1
- Confidence: traced
- Evidence: Those 11 exports occur in exactly one file across src and tests. 12 of 42 contract files are runtime specific (qvm-*, native-*, qc-*). scene.ts has 90 exports and 174 importers. The Q1 TraceResult omits `contents`, so Q1Collision adds it through an intersection type and adaptTraceResult sniffs it: `'contents' in result && typeof result.contents === 'number'`. Layering inversions: movement imports content (`q3GrappleVelocity`), and core imports persistence (SaveReader).
- Impact: The contract layer does not fully describe its data, and dependency direction is not enforced by structure. No runtime defect found.
- Remediation: Delete the unused exports, add `contents` to the Q1 trace variant, move grapple velocity into movement, and split scene.ts by query, geometry and trace.
### CORE-019 — Movement providers still throw on command range inside simulation
- **Verification (VERIFY-Q): confirmed. Final severity: Info.** Q3 part only: `Pmove` and `PmoveSingle` validate no command ranges (`game/bg_pmove.c:1836-2068`). The checks at `movement/q3/move.ts:509-512` are port additions. Source review: SRCQ3
- Severity: Info
- Category: robustness
- Location: src/movement/q1/quakeworld.ts:17, 323; src/movement/q2/index.ts:30; src/movement/q3/move.ts:509-514
- Confidence: traced
- Evidence: B1 is closed at the unified boundary, and wire protocols decode bytes. However Q2 validates after `application.begin` may replace the command (q2/index.ts:108, 122), so a mod input callback returning an out-of-range duration throws in the simulation step. Q3 validates only the initial command, so mod-altered axes are not checked at all (provider.ts:122). Whether mod outputs are bounded upstream was not traced (world/session/mod-client-input.ts unread).
- Impact: Asymmetric validation between families; a defect only if mod outputs are unbounded upstream.
- Remediation: Validate mod command output at one shared boundary and keep provider checks as assertions.
