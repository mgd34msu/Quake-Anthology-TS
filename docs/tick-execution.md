# What runs in a gameplay cycle

This map follows the current original Quake II rerelease DLL path, the path behind the measured native performance problem. Q1/QW, Q2 classic and Q3 preserve their own source order and cadence; they share the surrounding application services. A simulation tick and a rendered frame are different operations. One application/input batch can contain several overdue simulation ticks.

The original rerelease tick interval here is 25 ms, or 40 ticks per simulated second. Classic native Q2 uses 100 ms. Installed `563f0a99` completed 400 native ticks in the complete 495-entity base1 workload. Ticks 331–350, before CPU profiling, measured medians of 41.23 ms inside native RunFrame and 45.55 ms per application step. Earlier portions encountered another CPU workload. RunFrame includes engine callbacks invoked by the DLL. These are separate medians, not an additive phase profile or rendered FPS. Native execution remains over budget.

## Once per application/input batch

1. Complete pending player retirement, save/load operations, world transitions and owned video restarts at safe boundaries.
2. Advance startup scripts, poll input and dispatch queued bindings, console commands and source commands.
3. Handle an active cinematic separately from gameplay.
4. Poll incoming network traffic and receive remote commands.
5. Check pause state, source time controls and capture timing; advance the host clock when unpaused.
6. Apply changed user information and update selected-arsenal input routing.
7. Build local movement, aim and action commands.
8. Enter the guarded simulation batch. For each native local command, project equipment/grapple state, source movement modifiers and selected pose, then invoke the original ClientThink. Remote source commands enter through their wire endpoint.
9. Add elapsed time to the source accumulator. Execute every due source tick in the original order.

ClientThink includes the original player-command processing. It is not repeated for each overdue world tick unless the original accepted command stream calls for it.

## Once per native simulation tick

| Order | Work | Owner |
|---|---|---|
| 1 | Advance source frame/time and selected-component time. | Shared simulation |
| 2 | Advance selected Q1 punch/recoil when present. | Shared selected-player state |
| 3 | Set equipment clocks; update grapple and offhand player state; advance due independent equipment actors; reconcile weapon slots. | Selected equipment owners |
| 4 | Start selected Q1 weapon/provider frame callbacks when present. | Selected arsenal |
| 5 | Advance the native service frame and retire stale entity links. | Native world services |
| 6 | Refresh imported cvars; run original PrepFrame; reconcile actor lifetimes. PrepFrame clears transient entity events and hit-marker stats and updates intermission flags. | DLL host and original game |
| 7 | Refresh imported cvars again and synchronize foreign actors into the native world. | DLL host and cross-game adapter |
| 8 | Enter original RunFrame through the guest ABI/interpreter. | Shared native execution |
| 9 | Check source cvars/debug state, advance original level time, process intermission/exit/restart rules and cooperative respawn state. | Original game |
| 10 | Traverse source entity slots in source order, including world and clients; skip inactive entities according to source rules. | Original game |
| 11 | For each live entity, retain previous position where required, recheck a moved supporting ground entity and update entity state. | Original game and collision imports |
| 12 | Run ClientBeginServerFrame for clients. For other entities run prethink, brush animation and the appropriate movement routine: stationary, noclip, walking/stepping, pushing, flying, tossing or bouncing. | Original game |
| 13 | Within those routines, execute due think/AI/animation callbacks, movement and gravity, collision traces, floor/water checks, touches, blocked callbacks, pickups, projectiles, damage, deaths and authored triggers as applicable. | Original source callbacks and shared world imports |
| 14 | Check match-end and password rules and complete cooperative respawn bookkeeping. | Original game |
| 15 | Build player end-of-frame state, including view, damage feedback, weapon/player stats and HUD-related state. | Original ClientEndServerFrame |
| 16 | Update campaign time, process deferred monster pain, finish original frame state and perform match reports only when due. | Original game |
| 17 | Reconcile native actor creation/removal and publish current source visibility, appearance and entity events. | Native host/services |
| 18 | Finish selected offhand grenade state and run due selected Q1/Q2/Q3 weapon/projectile actors at their own cadence; commit attachments and reconcile weapon slots. | Shared composition and selected providers |
| 19 | Enter frame-exit and advance active mod component callbacks. | Shared simulation/mod owner |
| 20 | At a publication boundary, construct a complete snapshot and drain simulation events. | Shared simulation/session |

The original game can request multiple internal frames through its own `g_frames_per_frame`; that setting remains source-owned. Individual actors do only their applicable work. A dormant entity does not fire a weapon or run navigation just because it has a slot.

Throughout native execution, the interpreter fetches or reuses decoded instructions, checks live code/memory access, reads/writes registers and flags, executes branches and arithmetic, handles call/return state, invokes engine imports and preserves instruction/fault boundaries. Those costs occur inside the stages above; they are not a separate extra gameplay pass.

## Publication, rendering and audio

Between completed catch-up ticks, a graphical native session may publish and present the completed state. Otherwise these happen at batch completion:

1. Deliver the completed snapshot/events to seats. Drain fresh native messages while retaining the full batch for transport and recording.
2. Decode source messages, localization, HUD/client state and component outputs for each recipient.
3. Prepare world/entity effects, models, animation poses, lights, particles, view weapons and required media resources.
4. Update client prediction and camera/presentation state where applicable; prepare source and component HUD/cgame output.
5. Render each local seat and submit/swap the graphics frame.
6. Update listener positions, spatial audio, source effects, loops and music.
7. Poll/queue additional input and yield between completed native ticks. Dispatch gameplay commands only at their original batch boundaries.

At final batch completion, publish network/demo output, process transition intents and source/application requests, drain recording/capture, refresh changed graphics settings, advance autosave scheduling and complete due lobby/progression work. Saving itself runs only when requested/due at a safe boundary, not on every tick.

## Current CPU profile

A CPU sample profile on source `b72b9ad6`, before the vector-read change above, captured 3,885 samples across 50 warmed steps. The complete original base1 workload had one idle player, Q2 movement/model and Q3 weapons. Approximately 154,000 instructions execute per native tick, with 507 nested guest calls per step. Rendering and physical audio are absent from this dedicated workload.

Each sample below belongs to one category. Milliseconds are estimates normalized to the unprofiled 74.66 ms application median, not separately measured phase timers. Profiling raised the application median to 82.88 ms, so the sample proportions are approximate.

| Work | CPU share | Estimated ms/step |
|---|---:|---:|
| Interpreter dispatch, decoded operations, registers and arithmetic | 53.56% | 39.98 |
| Guest memory mapping, permissions, address validation and byte access | 19.42% | 14.50 |
| Native call argument/result conversion and CPU preservation | 11.71% | 8.75 |
| Reading native entity fields into engine vectors and records | 5.02% | 3.74 |
| Other rerelease integration and engine imports | 4.39% | 3.28 |
| Simulation coordination and publication | 1.30% | 0.97 |
| Shared body snapshots, ownership and links | 0.99% | 0.74 |
| Collision and scene-query calculations | 0.89% | 0.66 |
| Other application/world work and runtime | 2.73% | 2.04 |

The largest individual costs within those categories are interpreter dispatch (6.98 ms), memory-mapping lookup (6.52), prepared instruction execution (3.77), operand-address calculation (2.95), SSE moves/logic (2.39), entity snapshot copying (2.19), address-range validation (1.75), and cached-code validation (1.66). They are already included in the table. The local profile and driver are `/tmp/quake-native-current.cpuprofile` and `/tmp/quake-native-current-profile.ts`.

## Measured costs

A separate instrumented run on `72794d58` measured 50 ticks after 50 warm-up ticks in the complete original retail `base1` world: one idle connected player, Q2 movement/model and selected Q3 weapons, with 495 entity records retained. These are per-tick means from nested timing, not the medians above or a rendered FPS measurement.

| Phase | Calls per tick | Mean time per tick |
|---|---:|---:|
| Original RunFrame, including its imports | 1 | 75.24 ms |
| RunFrame excluding timed engine imports | 1 | 55.57 ms |
| BoxEdicts, including original filter callbacks | 38.26 | 15.50 ms |
| Collision traces | 87.42 | 1.94 ms |
| Point-contents queries | 59.32 | 0.82 ms |
| Entity relinking | 10.38 | 0.49 ms |
| Original PrepFrame | 1 | 1.01 ms |
| Entity publication | 1 | 2.39 ms |
| Actor lifetime reconciliation | 2 | 0.96 ms |
| Imported cvar refresh | 2 | 0.53 ms |

RunFrame includes the box, trace, contents and link rows. Do not add those rows to its inclusive total. PrepFrame, publication, reconciliation and refresh occur around it. Input/ClientThink, snapshot construction and the remaining application work are outside this table; rendering and physical audio are absent from this dedicated workload.

A second run split box-query work further. It measured about 507 candidate-address conversions per tick, 508 nested guest calls, 2.95 ms finding/copying spatial candidates, 1.67 ms resolving source addresses, and 12.07 ms inside nested guest calls. Most nested calls are the original box filters; the selected-weapon callback also uses nested entry. Total inclusive BoxEdicts time was 16.84 ms. This points to repeated guest-call setup and filter execution as the larger opportunity, rather than spatial traversal alone. Original rerelease monster dodge checks query nearby entities and execute the supplied original filter on each candidate.

The second run has a different random world evolution and additional instrumentation. Its absolute timings are attribution evidence, not a before/after optimization result. Both retain all entity records. A candidate must be compared separately on the same complete workload before claiming a speedup.

Local reproducible drivers/results: `.artifacts/resume-20260925/q1-pusher-translation/stage-profile.ts`, `stage-costs.json`, `stage-result.json`, `query-profile.ts`, `query-costs.json` and `query-result.json`. They load the exact archived `72794d58` source and the installed original `game_x64.dll`; no source replacement or entity reduction is used.

## Cost of the 16 user-facing steps

A further local profile split the original frame at inspected retail DLL instruction boundaries and timed the actual think/touch/use/pain/death pointers held by live entities. Host wrappers measure the surrounding work. It used the same archived `72794d58`, complete `base1`, Q2 movement/model, Q3 weapons and idle connected player, measuring 50 ticks after 50 warm-up ticks. All 495 entity records remained present.

These are approximate per-tick means in milliseconds. Nested callbacks are charged separately from their callers. AI callbacks retain any movement/collision work they call directly; row 8 is physics outside those callbacks. This gives an additive runtime attribution, not independent subsystems with universally separate execution.

| Step | Work | Mean ms/tick |
|---|---|---:|
| 1 | Advance clocks | 0.005 |
| 2 | Recoil, equipment and selected provider frame entry | 0.009 |
| 3 | Refresh cvars, clear transient events and reconcile before the frame | 1.67 |
| 4 | Refresh frame cvars and synchronize foreign actors | 0.23 |
| 5 | Original frame entry, intermission/restart/cooperative rules and call overhead | 0.11 |
| 6 | Traverse entities, previous positions, ground checks and state updates | 12.48 |
| 7 | Player frame start and think/AI/animation callbacks | 39.59 |
| 8 | Remaining physics, movement and collision work | 18.59 |
| 9 | Touch/use/damage/death callbacks | 1.38 |
| 10 | Match rules and cooperative bookkeeping | 0.03 |
| 11 | Player end-of-frame view, feedback, stats and HUD state | 2.07 |
| 12 | Campaign/deferred-pain traversal and frame-end work | 1.46 |
| 13 | Entity lifetime reconciliation and publication | 2.60 |
| 14 | Selected equipment/projectile frame completion and slot reconciliation | 0.19 |
| 15 | Frame-exit phase and extra mod callbacks | <0.01 estimated; no extra mods active |
| 16 | Snapshot construction/publication data | 2.45 |

The measured rows total 82.87 ms; native rows 5–12 total 75.72 ms. The complete application step averaged 84.96 ms, including remaining application work and diagnostic hook discovery outside the timed native frame. These values are profiling results, not an optimization comparison or rendered FPS. Active combat and different maps/mods can change the distribution. Steps 7, 8 and 6 account for about 85% of the listed work.

Reproduction and raw values are local: `.artifacts/resume-20260925/tick-sixteen/profile.ts`, `result.json`, `profile.log` and `runframe.asm`. The profiler qualifies the retail artifact digest, preserves original instruction bytes, and accounts for nested interpreter returns. No production profiling framework was added.

## Inside steps 7, 8 and 6

Further profiling used the same complete retail `base1` workload and archived `72794d58` source. The final pass measured 50 ticks after 50 warm-up ticks, kept all 495 entity records, and timed original function entries, returns and engine imports. The retail DLL digest is `sha256:045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd`.

These deeper observers add overhead and the original world evolves differently between runs. The final instrumented totals were 45.78 ms for step 7, 21.76 ms for step 8 and 15.85 ms for step 6. They identify costs; they are not an optimization comparison with the earlier 39.59/18.59/12.48 ms measurements.

The following rows are exclusive except where stated. Nested functions/imports are subtracted so the rows within each step can be added.

| Step | Specific work | Mean ms/tick |
|---|---|---:|
| 7 | Execute original monster dodge filter instructions | 6.09 |
| 7 | Enter/leave those filter calls, outside CPU execution | 5.96 |
| 7 | Remaining box-query work, including other filters and candidate/address handling | 4.87 |
| 7 | FindTarget target-selection logic | 4.46 |
| 7 | SV_movestep step handling | 4.05 |
| 7 | M_CheckBottom floor-support checks | 2.83 |
| 7 | Engine collision trace imports | 2.11 |
| 7 | M_MoveToGoal movement decisions | 1.75 |
| 7 | SV_StepDirection direction/step handling | 1.63 |
| 7 | M_MoveFrame animation bookkeeping | 1.09 |
| 7 | Remaining think, ground/water/effect work, imports and observer overhead | 10.93 |
| 8 | Dispatch entities with MOVETYPE_NONE | 6.11 |
| 8 | SV_Push moving-brush logic | 5.88 |
| 8 | SV_Physics_Step handling outside nested functions | 2.44 |
| 8 | SV_RunThink scheduling checks outside actual think callbacks | 2.06 |
| 8 | Remaining physics dispatch, contents, toss, relinking and observer overhead | 5.26 |
| 6 | Entity_UpdateState excluding its angle-vector calculation | 7.83 |
| 6 | AngleVectors called by monster state updates, including its helpers | 2.12 |
| 6 | Remaining frame traversal, field upkeep and observer overhead | 5.90 |

### What drives those costs

- **Dodge filters:** about 503 nested calls per tick, each executing only 30 original instructions in this idle workload. Their 12.05 ms total divides almost equally between execution and call entry/exit. Most candidates immediately fail the original projectile/flags check. This is repeated callback overhead, not hundreds of expensive path searches. BoxEdicts totals 16.92 ms including these calls and other query work.
- **Monster walking:** nine `ai_walk` calls and six `ai_stand` calls per tick. Walking reaches `M_MoveToGoal`, `SV_StepDirection`, `SV_movestep` and `M_CheckBottom`. Target selection also runs from both walking and standing. The cost previously labeled animation includes this movement and decision-making; updating animation frames alone costs about 1.1 ms.
- **Moving brushes:** `SV_Push` runs about 3.94 times per tick, principally for three Strogg ships and one rotating brush. It costs 6.39 ms including its nested work. The original routine scans the edict array for each pusher, rejecting inactive, immobile, unlinked and non-overlapping candidates before detailed collision checks. With 495 records, that is roughly 1,950 candidate visits per tick when each scan completes. The source loop and the measured function cost identify a hot path; that visit count is an estimate, not a separate loop counter.
- **Entities without movement:** 405 active entities use MOVETYPE_NONE, including 89 speakers, 57 path corners, 54 info markers, 37 dynamic lights and 33 timers. Their dispatch costs accumulate even when no think callback is due. `SV_RunThink` performs about 470 checks per tick across the physics types. Its 2.06 ms is separate from actual callbacks and the dispatch row.
- **State upkeep:** about 492 `Entity_UpdateState` calls per tick cost 9.95 ms including angle calculations. The original DLL updates flags, health, mover state, endpoints and other exposed state. Monster state updates perform 32 `AngleVectors` calls per tick. This state remains observable even without bot players; it cannot simply be disabled.

### Shared runtime costs

An independent CPU sampling run used the same source/workload without the detailed native function observers. Its measured window was 50 ticks, about 4.44 seconds and 4,289 samples. About 67.5% of sampled time was inside the CPU execution loop, including its children.

Largest individual exclusive samples included:

| Runtime work | Share of sampled time |
|---|---:|
| Managed CPU loop itself | 11.5% |
| Guest memory mapping/access lookup | 7.2% |
| Typed-array buffer access | 4.2% |
| BigInt width normalization | 4.0% |
| Managed integer block execution itself | 3.7% |
| Object freezing | 3.5% |
| Canonical address checks | 3.4% |
| 64-bit memory reads | 3.4% |
| Effective operand address calculation | 3.0% |
| Typed-array set/slice/subarray combined | 7.2% |

These sample percentages cover the complete measured application workload. They are distinct from the per-function timers and are not percentages of only steps 7, 8 or 6. Inclusive sample percentages overlap their children and must not be added to exclusive percentages.

The implementation explains the repeated costs. `GuestCallRunner.invokeSteps` captures processor state and creates an ABI adapter for every nested call. Argument/call layouts are planned in both the adapter and runner; entry, return and engine callbacks perform further encoding and planning. Managed CPU execution repeatedly calculates guest addresses and validates memory access. Instructions outside eligible integer blocks also pass through the individual-instruction path and register checkpointing. Floating-point/vector instructions and copies contribute there.

Fixed-signature ABI planning is now cached across calls, with signature-change checks and ordinary planning for mutable aggregate layouts or additional variadic arguments. Rerelease player appearance also retains its weapon-model list until relevant configstrings change. The two complete native workload pairs measured about 1% less native-call time, with overlapping whole-application timings. See [measurements and caching rules](functional-targets/performance.md#current-evidence-and-remaining-work).

Code-page versions now avoid rereading unchanged instruction bytes when all writes remain observable. Native integer normalization and ABI conversion allocate less, and safe isolated instructions use the managed block executor. Next, reduce operand-address calculation and memory-access overhead, including the exact vector operations used by movement and state copies. Preserve nested-call restoration, faults, memory permissions, original writes, instruction budgets and source ordering. These changes can benefit arbitrary native mods; replacing named game functions or skipping AI/physics work would not meet that requirement. Entity/cvar diff tracking remains separate work because original DLL writes must invalidate retained state.

Local evidence is under `.artifacts/resume-20260925/tick-hotspots/`: `walking.ts`, `walking-details.json`, `walking-result.json`, `attribution.json`, `cpu-profile.ts`, `engine.cpuprofile` and `cpu-summary.json`. Earlier `profile`, `subfunctions` and `animation` drivers/results retain the intermediate splits. Original indirect animation targets were observed at the DLL call sites and checked against their active saved move names and the retained original source. These diagnostic scripts remain local; no production profiling framework was added.

## Optimization targets

The measured order is native instruction execution first, then repeated nested DLL calls, then spatial candidate/body/address work and unchanged entity publication. Reconciliation and cvar refresh are smaller costs. Compare each candidate on a matched complete workload; retain it only when the result improves without changing source behavior.

| Candidate | Waste to investigate | Constraint |
|---|---|---|
| Native execution | Remaining dispatch, operand, register, memory and call-boundary overhead. | Execute original instructions with exact faults, values and side effects. |
| Nested original callbacks | Repeated ABI planning, argument setup and processor-state copying for hundreds of small filter calls. | Preserve arbitrary original callbacks, nested calls, register restoration, memory side effects, faults and instruction budgets. |
| Repeated entity synchronization | Full lifetime reconciliation after both PrepFrame and RunFrame, foreign projection, publication and later snapshot reads. | Track original writes/lifetimes; preserve callback-visible state, entity reuse and restoration. |
| Collision imports | Repeated candidate collection, body decoding, broadphase lookup and repeated geometry work. | Preserve every potentially colliding actor and the exact trace/ordering semantics. |
| Unchanged source data | Repeated cvar refresh, model/resource lookup, appearance construction and unchanged publications. | Invalidate on actual source changes, relocation and restore; do not cache away events. |
| Selected components | Whole-registry traversal for small equipment/projectile subsets and repeated sorting/reconciliation. | Keep source slot order and dynamically spawned/removed actors correct. |
| Presentation | Repeated snapshot/model/pose preparation, allocation and renderer waiting. | Retain required image/audio quality and every simulation tick. |

These are optimization targets, not demonstrated speedups. The measured native call dominates the current dedicated workload; optimizing only menus or rendering cannot solve that bottleneck. Q1 `end` is a separate live workload and must be profiled separately rather than assigned the DLL measurement.

## Source locations

- [Application batch and presentation](../src/app/bootstrap/application.ts)
- [Native tick and selected components](../src/app/bootstrap/simulation/runtime.ts)
- [Native world frame](../src/app/bootstrap/simulation/rerelease-guest-world.ts)
- [Native host callbacks and reconciliation](../src/compat/q2/rerelease/host.ts)
- [Source publication and engine imports](../src/app/bootstrap/simulation/rerelease-guest-services.ts)

Original game order was checked against the local retained `qsrc/quake2-rerelease-dll/rerelease/g_main.cpp`, `g_phys.cpp` and the public API2023 wrapper.
