# Performance and fidelity acceptance

Performance is a primary requirement of the shared engine. Every functional target owns its runtime cost, loading cost, memory use, and effect on responsiveness. Improvements must preserve required behavior across native and mixed configurations.

## What qualifies as an optimization

Remove work that has no effect on the required result: repeated parsing, discarded geometry, duplicate transforms, redundant device state changes, unnecessary copying, or avoidable waits. Reuse immutable data at its actual owner. Use spatial acceleration and batching when they preserve visibility, ordering, collision, and material semantics. Bound caches by retained bytes or geometry as well as entry count, and verify invalidation and teardown.

Lower resolution, reduced texture or model detail, missing lights or effects, shorter visibility, approximate collision, fewer AI updates, weaker network validation, and reduced audio quality do not satisfy this requirement. Quality controls may remain user options; comparisons must hold those options constant. Intentional source timing, numerical behavior, and protocol contracts still apply.

Moving work off the main thread qualifies only if the measured result improves and ownership, cancellation, output order, latency, and total resource cost remain correct. Moving a hitch from gameplay to loading must be reported as a tradeoff with both measurements.

## Required comparison

Use the evidence below for the behavior and costs affected by a change. It is not an exhaustive all-workload gate for every unit. Prioritize working implementation and measured performance, with focused checks proportional to the change. Live playthrough feedback will guide further code and test changes; fuller hardening follows. This sequencing does not relax fidelity or native compatibility requirements, or justify claims beyond the paths actually checked.

| Evidence | Required record |
|---|---|
| Inputs | Exact source/build, assets, map, recipe, renderer, resolution, quality settings, device/driver, presentation mode, and environment. |
| Work | Identical simulation timesteps, seed, commands, and number of steps. Record final state and observable events so skipped work cannot look faster. Use a separate real-time interactive run to assess input latency and presentation. |
| Timing | Warm-up policy, startup and first-use latency, total work duration, median/p95/p99 frame times, maximum stall, and counts above the stated hitch thresholds. Report repeated alternating baseline/candidate runs and their spread. |
| Stage costs | Simulation, collision, AI, model preparation, render submission, uploads, and presentation waits where relevant. State which timers are nested; do not sum inclusive timers. Measure instrumentation overhead separately. |
| Memory | Allocations or construction counts where measurable, retained memory, cache bytes, collection pauses, and growth after repeated travel/restart/load. Report the method and its limits. |
| Fidelity | Relevant state/trace/command comparisons, corresponding rendered frames, and audio output checks. Record any permitted numerical tolerance and why it cannot affect required behavior. |
| Outcome | Measured improvement and remaining bottleneck, or rejection. Keep failed and inconclusive experiments with their inputs; do not ship added complexity on a speculative benefit. |

Equal wall-clock durations alone are insufficient when different frame rates execute different simulation work. FPS alone also hides hitches. A repeatable CPU replay can isolate an algorithm, but it cannot establish smooth gameplay or the user's desktop presentation performance.

For a 60 Hz reference workload the whole-frame budget is 16.67 ms; for 120 Hz it is 8.33 ms. Choose and record the applicable hardware/workload budget before acceptance. Report how often it is missed, alongside stalls over 50 ms and 100 ms. These are evaluation budgets, not claims that current builds achieve them. Also measure control responsiveness during loading, compilation, downloads, and saves.

## Workloads and fidelity checks

| Workload | What must remain correct |
|---|---|
| Native Q1, Q2, Q3 and required expansion scenes | Authored materials, animation, lighting, audio, gameplay timing, and source movement. Include both renderers; backend timings remain separate. |
| Mixed Q1 world with Q2 monsters and Q3 equipment, plus Q2/Q3 worlds with foreign content | Collision, placement, relative model scale, attacks, animation, effects, and selected rules. The currently slow Q1 mixed route is a starting workload, not the entire matrix. |
| Busy combat and first-use events | Enemy grenades, explosions, particles, dynamic lights, sound bursts, weapon switching/wheel, and newly encountered assets. Verify damage and event counts, not just a static scene. |
| Campaign and session changes | Switch chains, exits, revisits, save/load, death recovery, connection changes, and repeated transitions. No leaks, duplicated work, frozen input, or delayed audio. |
| Network play and multiple local seats | Native packet/prediction semantics, per-seat input and views, load contention, download progress, and cancellation. No reduction in authoritative work to improve a local frame result. |

Collision changes require complete trace results and error behavior, not just matching hit fractions. Rendering changes require triangle/surface order, UV seams, interpolation, lighting, transparency and visibility to remain correct. Compare prepared geometry where appropriate, then inspect corresponding CPU/GL frames. Audio changes require correct events, positions, gains, timing, and PCM delivery; dummy-device output alone does not prove physical audibility.

## Current evidence and remaining work

The earlier isolated mixed-game route measured about 14 FPS, with simulation and presentation waits each around 27 ms per frame and total render work around 11 ms, including about 5 ms of submission. Those nested timings describe that historical workload, not the current installed binary or the user's desktop bottleneck.

A separate [5bbc933 fixed-work profile](../../.artifacts/resume-20260915/current-stage-cost5bbc/RESULT.md) measured 65.108 ms mean application time over 140 steps after 16 warm-up steps. Presentation averaged 26.986 ms, simulation 16.503 ms and model preparation 7.469 ms. The spans overlap and must not be summed; instrumentation overhead was uncalibrated. The presentation span does not distinguish gamma processing, GPU/driver synchronization and swap waiting. This workload is separate from the installed Q2 public run and does not establish gameplay FPS. Renderer restart and alias optimization remain unfinished.

Accepted body storage change `91fe177` removes binding callbacks for locally owned actor bodies. Two alternating fixed-work pairs reduced aggregate simulation elapsed by **6.055%** and application elapsed by **1.586%**. Geometry, state/events and complete query results matched the retained reference under the documented private-mount mapping. Tails were mixed: the first application's p95 and maximum worsened. This is a bounded route-cost improvement, not an FPS result. See the [body route receipt](../../.artifacts/resume-20260915/body-local-route7ac/RESULT.md).

The redundant GL depth/blend state cache was removed in `7ac546e` after matching-work measurements showed no elapsed benefit. Lower call counts alone did not justify retaining it. See the [GL timing receipt](../../.artifacts/resume-20260915/gl-depth-blend-elapsed2/RESULT.md). The prepared-geometry fallback matched 5,000 queries exactly but accelerated none; that result establishes fallback correctness only, not a performance benefit. Earlier exact-envelope and endpoint-distance experiments likewise did not establish a useful speedup.

The earlier a16 public Q2 run exposed source-clock progression that did not track elapsed host time. The earlier `40c9042` build fixed Q2 scheduling with native 25 ms rerelease and 100 ms classic ticks and a 200 ms catch-up work budget; outstanding debt is retained. Its public rerelease check completed 30.155607 seconds of controls. Save-to-save host time advanced 37,811.956 ms against 37,800 ms of source time, differing by 11.956 ms. This validates bounded clock progression, not FPS or hitch reduction. See the [historical clock proof](../../.artifacts/resume-20260915/final-40c9042/runtime-proof.json).

Installed `80b8351` retains the clock fix and body change. Its public Q2 check measured 37,699.844 ms host progression against 37,700 ms source progression between saves, including 30.160867 seconds of controls. The separate body experiment above does not establish this binary’s FPS or hitch performance. See [installed evidence](../execution-status.md#installed-executable-and-recent-fixes). Continue from measured costs in the affected path, preserve complete behavior, and recheck profiles after accepted changes. Whole-frame responsiveness, hitches and the broader workload matrix remain open.
