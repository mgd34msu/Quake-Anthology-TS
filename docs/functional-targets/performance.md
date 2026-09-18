# Performance and fidelity acceptance

The current executable is `07d54ae`. Older installed/pending labels below describe their recorded checkpoints. Current whole-game FPS is not established by those component experiments.

The September 18 delivery reuses MD5 poses between color/shadow passes, indexes pose lookup, skips unused shadow-only color work, and replaces native interpreter canonical-address shifts with equivalent range checks. Paired component results and exact-output boundaries are recorded in [the integration evidence](integration-20260918.md#performance-changes). These gains are not additive and do not establish gameplay FPS. Native Q2 rerelease saved-world opening still took 155.206 seconds in its last actual continuation workflow; load performance needs further work.


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

The final instruction-fetch change uses a live, lazy executable span and invalidates it when mappings change. It preserves aliases, self-modifying writes, per-byte faults, canonical-address boundaries and the 15-byte instruction limit. Three paired 120,003-instruction measurements reduced elapsed time by 18.9–25.1%, with matching complete interpreter state. This is a component result, not a measured native restore or gameplay improvement. [Fetch evidence](../../.artifacts/resume-20260918/instruction-fetch-cursor/freeze/RESULT.md).

The `4e82c5a` compiled mixed-game run completed 29.467 seconds of active input. Its public timer window recorded 731 frames over 45.002 seconds including console and capture overhead: mean simulation 11.343 ms, presentation preparation 0.866 ms, and rendering 19.476 ms. These stages omit other work and do not explain the whole elapsed interval. The private display, diagnostics and unpaired workload do not establish user-desktop FPS or an improvement over an earlier build. [Runtime scope and failure boundary](../../.artifacts/resume-20260918/compiled-mixed-gameplay/RESULT.md).

## Current evidence and remaining work

Installed `74119b8` includes indexed final PCM conversion (`e2f6e80`), material-pass projection reuse (`cf78bbb`) and lazy creation of reversed Q1 clip planes (`8b10b7f`). The actual shared mixer produced identical PCM in the checked blocks and boundaries; three retained component pairs reduced aggregate elapsed from 56.966 to 33.262 ms (41.61%), with substantial spread. Material projection retained exact ordered numeric results and reduced the installed multipass component aggregate by 5.109%. Lazy plane creation removes allocations on unsplit cells; no elapsed improvement was measured for that unit. Receipts: [PCM comparison](../../.artifacts/resume-20260915/audio-conversion94/RESULT2.md) and [material comparison](../../.artifacts/resume-20260916/material-project-f8db/component2/measurement/RESULT.md). None measures whole-frame FPS.

Accepted `b416aef` replaces callback/vector creation in Q1 clipping cap-membership checks with the same ordered scalar distance expression. All 5,000 complete retained traces matched. Three pairs improved 3.10–3.77%, aggregate 3.34%, with no memory or whole-frame measurement. It is committed but not yet installed. See the [cap-membership result](../../.artifacts/resume-20260915/cap-membership8b10/RESULT.md).

Accepted source, not installed: inventory count reads (`20e1411`) avoid validated snapshot copies while preserving one provider read per count. Three component pairs reduced aggregate time by 93.82% for 8 entries and 95.53% for 32; provider allocation/work remains unchanged. See the [inventory result](../../.artifacts/resume-20260915/inventory-count17c3/RESULT.md). Model vertex construction (`d4a0888`) retained exact ordered geometry and reduced MD2 component time by 13.012%. MD5 pairs changed by −7.808% and +5.070%, so no stable MD5 benefit is established. See the [model result](../../.artifacts/resume-20260916/model-vertices17c/measurement/RESULT.md). Canonical cvar snapshot reuse (`fcc6cbb`) reduced actual settings-signature component time by 15.27%, preserving values, ordering and signatures through mutations and restore; see the [cvar result](../../.artifacts/resume-20260916/cvar-snapshots17/RESULT.md). The receipts' earlier pending-qualification decisions predate source acceptance. These component results do not measure whole-frame performance.

The [fcc6 profile](../../.artifacts/resume-20260916/current-stage-costfcc6/RESULT.md) matched retained source clocks, the same 22,598 trace calls and per-kind counts, and recorded state/events except the documented private mount paths and derived identities ([workload proof](../../.artifacts/resume-20260916/current-stage-costfcc6/workload-proof.json)). Mean application time was 72.106 ms, presentation 27.084 ms, simulation 19.466 ms and model preparation 9.800 ms. Inclusive spans overlap; the separate retained run is not a paired speedup estimate. Current self hotspots include `splitCell`, `pack`, `finalVertexLight` and `boxSeparatingPlanes`; private swap/presentation waiting remains substantial. No gameplay FPS claim follows.

GL finite-validation unrolling and normal-scan candidates were rejected because they regressed measured performance; do not repeat them without new evidence. Actor-registry snapshot work and model-light ownership/music work remain pending. They are distinct from the accepted canonical cvar snapshot change and must not be counted as delivered improvements.

The `74119b8` compiled GL audio/menu check passed its bounded workflow. It did not repeat the CPU renderer workload or resolve the prior CPU source-clock lag. The separate CPU vertex-color allocation experiment is held: its final common-path pair showed no benefit and earlier pairs varied substantially. It is not installed or accepted as a performance improvement.

The earlier isolated mixed-game route measured about 14 FPS, with simulation and presentation waits each around 27 ms per frame and total render work around 11 ms, including about 5 ms of submission. Those nested timings describe that historical workload, not the current installed binary or the user's desktop bottleneck.

A separate [5bbc933 fixed-work profile](../../.artifacts/resume-20260915/current-stage-cost5bbc/RESULT.md) measured 65.108 ms mean application time over 140 steps after 16 warm-up steps. Presentation averaged 26.986 ms, simulation 16.503 ms and model preparation 7.469 ms. The spans overlap and must not be summed; instrumentation overhead was uncalibrated. The presentation span does not distinguish gamma processing, GPU/driver synchronization and swap waiting. This workload is separate from the installed Q2 public run and does not establish gameplay FPS. Shared renderer restart and bounded MD2/MD5 preparation optimizations are now installed; this earlier profile does not measure their effect.

Installed MD2 topology reuse (`c77cdca`) reduced component preparation time by about 27–28% across three pairs; 483 retail poses/blends matched exactly. MDL reuse was removed because its timing showed no benefit. See the [MD2 receipt](../../.artifacts/resume-20260915/alias-topology80/md2-only-receipt.md). Installed MD5 joint-row reuse (`f8dbf98`) reduced soldier/parasite component time by 18.29%/17.81%, with 749 full geometry comparisons exact. See the [MD5 result](../../.artifacts/resume-20260915/md5-joint-rows-c77/COMPONENT-RESULT.md). Neither result measures whole-frame performance or FPS.

Accepted body storage change `91fe177` removes binding callbacks for locally owned actor bodies. Two alternating fixed-work pairs reduced aggregate simulation elapsed by **6.055%** and application elapsed by **1.586%**. Geometry, state/events and complete query results matched the retained reference under the documented private-mount mapping. Tails were mixed: the first application's p95 and maximum worsened. This is a bounded route-cost improvement, not an FPS result. See the [body route receipt](../../.artifacts/resume-20260915/body-local-route7ac/RESULT.md).

The redundant GL depth/blend state cache was removed in `7ac546e` after matching-work measurements showed no elapsed benefit. Lower call counts alone did not justify retaining it. See the [GL timing receipt](../../.artifacts/resume-20260915/gl-depth-blend-elapsed2/RESULT.md). The prepared-geometry fallback matched 5,000 queries exactly but accelerated none; that result establishes fallback correctness only, not a performance benefit. Earlier exact-envelope and endpoint-distance experiments likewise did not establish a useful speedup.

The earlier a16 public Q2 run exposed source-clock progression that did not track elapsed host time. The earlier `40c9042` build fixed Q2 scheduling with native 25 ms rerelease and 100 ms classic ticks and a 200 ms catch-up work budget; outstanding debt is retained. Its public rerelease check completed 30.155607 seconds of controls. Save-to-save host time advanced 37,811.956 ms against 37,800 ms of source time, differing by 11.956 ms. This validates bounded clock progression, not FPS or hitch reduction. See the [historical clock proof](../../.artifacts/resume-20260915/final-40c9042/runtime-proof.json).

Previously installed `94d7f5b` completed the public renderer-transition workflow and three ten-second control segments, but its formal runner returned 1: CPU source-clock lag exceeded the unchanged 200 ms gate. The catch-up work budget retains debt rather than dropping simulation time; GL partially repaid it. Renderer operation and reviewed images do not establish full clock parity, FPS or hitch improvement. See [installed evidence](../execution-status.md#installed-executable-and-recent-fixes). Whole-frame responsiveness and the broader workload matrix remain open.

## Conservative MD3 rejection before geometry preparation

Qualified source now derives cached frame envelopes from decoded MD3 vertices, bounds the actual binary32 interpolation arithmetic (including extrapolation), and rejects off-camera geometry before allocating and lighting its vertices. Visible candidates keep the existing tight-cull and geometry path, and rejected parents still traverse attachments. Authored LOD/fog bounds and shadow/no-cull behavior are unchanged.

The existing model suite passed 14 tests with 1,286 assertions. There were 151 exact prepared-output comparisons and five exact draw-batch comparisons with shader deformation. A five-sample component workload with half the models outside the view reduced median preparation cost from 0.1742 to 0.0890 ms per model, about 49%. A visible-only sample increased from 0.1728 to 0.1831 ms (5.9%); another run was near neutral. This is a scene-dependent preparation improvement, not an overall FPS gain, and measurements exclude first-use envelope derivation. [Source and measurement receipt](../../.artifacts/resume-20260918/md3-early-rejection/receipt.md).

## MD2 corner preparation

Qualified source reuses the existing immutable MD2 topology to construct local material vertices directly from the interpolated pose. It removes the intermediate expanded vertex wrappers on warm preparations. First-use topology construction, corner order, texture coordinates, lighting calls, transforms, and public geometry-builder behavior are retained.

Forty-five exact prepared-output comparisons and a per-corner lighting trace matched. The existing model and alias-format checks passed 22 tests with 3,987 assertions; the two changed production roots passed strict/policy checks with 272 loaded dependencies. Seven alternating warmed component samples measured median MD2 preparation at 0.1546 → 0.1322 ms (14.5% less) and a mixed Q1/Q2 workload at 0.1359 → 0.1210 ms (11% less). The small Q1-only difference is treated as noise. These results are not an overall frame-rate claim. [Source and measurements](../../.artifacts/resume-20260918/md2-corner-preparation/receipt.md), [scoped check](../../.artifacts/resume-20260918/md2-corner-preparation/scoped-check.json).

## Installed optimization delivery

`065259c` includes the MD3 and MD2 changes above. Its [exact-binary GL follow-up](../../.artifacts/resume-20260918/compiled-mixed-065259c/RESULT.md) passed a bounded mixed scene and normal Quit with unchanged guards. This establishes delivery and the inspected runtime result, not a performance comparison. The component gains above remain the measured performance evidence.

## Bounded GL array-layout reuse

The shared geometry buffer now retains up to eight typed-array layouts on its existing storage. Repeated shapes reuse these views; every draw still writes and validates the actual vertex/index values. The prior same-shape fast path remains first, FIFO eviction limits retained wrappers, and storage growth invalidates the cache.

Nine alternating-order component samples measured small alternating layouts at 0.413 → 0.162 microseconds per pack and medium alternating layouts at 1.007 → 0.738 microseconds. Same-layout controls were effectively unchanged. More than eight recurring layouts can miss the cache and pay the bounded scan. [Measurements and limits](../../.artifacts/resume-20260918/gl-layout-cache/receipt.md).

The exact source passed strict/policy checks and three buffer tests with 805 assertions, including actual GL rendering: complete RGBA and all 256 depth values matched fresh packing on two retained-buffer frames, with failure cleanup and draw ownership preserved. [Native result](../../.artifacts/resume-20260918/gl-layout-native/RESULT.md). Installed `065259c` predates this qualified source change; it makes no whole-frame or GPU-speed claim.

## Direct native scalar stores

The guest memory owner now writes typed scalar values directly into a validated single mapping, avoiding a temporary byte buffer and copy. It retains full-range checks, fragmented-write atomicity, alias visibility and the same after-write observer delivery, including observer errors after committed writes.

The existing memory suite passed 15 tests with 481 assertions. Three paired 120,003-instruction interpreter runs preserved complete processor and memory state and reduced component time by 12.9–20.0% (16.2% across the three pairs). The final two paths passed strict/policy checks. [Component evidence](../../.artifacts/resume-20260918/scalar-store-direct/freeze/RESULT.md).

The [actual native component workflow](../../.artifacts/resume-20260918/scalar-store-native/receipt.json) also passed public external-profile installation, Q2Eaks code controlling a Q3 rocket, save/load, immediate restored state, and matching 500 ms continuation. All 2,582 inputs remained unchanged and processes were reaped. Its 56.801-second elapsed time is correctness evidence from one run, not a native performance comparison. This qualified source change is newer than installed `065259c`.
