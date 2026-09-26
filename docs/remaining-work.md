# Remaining project work

Current source summary: 22 of the T01–T23 targets are accepted. T10 remains open. This is an implementation status, not a claim that every original game, mod, device and campaign works correctly. The list below separates known work from unverified workflows. Fix confirmed defects through shared behavior; keep verification proportionate.

| Area | Targets | Remaining work |
|---|---|---|
| Native gameplay throughput | T10 | Reduce original DLL tick cost. Recent matched complete-base1 samples take about 65–68 ms per call against the 25 ms interval. Preserve original instructions, actor order and all simulation work. |
| Saving and loading | T10, T16 | Improve original save serialization, restoration and world startup. Current original level writing takes about 24.4 seconds. The older complete saved-world loading result remains slow and needs a fresh measurement after changes. |
| Whole-game performance | T03, T10, T11, T13 | Diagnose remaining freezes, input latency and expensive rendering/simulation scenes, including `end`. Measure complete frame cost and long stalls. Component speedups do not establish acceptable gameplay FPS. |
| Wider mod compatibility | T10, T12 | Qualify more original Q1/Q2/Q3, expansion and rerelease artifacts and simultaneous cross-game components. Private interfaces still need declarations. Discovery does not make every package compatible, and arbitrary private-layout discovery is not implemented. |
| Campaigns and gameplay | T11–T16 | Complete live playthrough coverage of movers, switches, replacements, combat, bosses, objectives, travel and save continuation. Cover mixed selections and additional authored maps. |
| Rendering, audio and input | T03–T05 | Broaden GL/CPU scene coverage, classic/rerelease fidelity checks, physical listening for quiet weapons/explosions and music, controller/device workflows, and split-screen behavior. |
| Native multiplayer | T07–T09, T13, T15 | Qualify remaining stock-peer protocol combinations, lobby/IPX paths, hosting/admin workflows, bots/navigation and mixed-game matches. Existing bounded peer runs do not qualify every direction or platform. |
| Console, menus and player services | T06, T17–T19 | Broaden original command/cvar parity checks, binding/settings persistence, device-driven menus, progression and source fidelity through public workflows. |
| Language and accessibility | T18 | Validate rendered languages, glyphs, captions and independent scales across more products and layouts. |
| Demos, media and tools | T20–T22 | Cover remaining recording/replay dialects, source/client ownership, cinematics, capture and device combinations. |
| LLM authentication | T23 | Fresh real-provider browser sign-in remains manually unverified. Existing-account ask and validated execution passed. |
| Documentation reconciliation | All | Reconcile the historical 477-row source inventory and older performance descriptions with current T01–T23 acceptance and delivery evidence. Old open-row counts are not a current implementation tally. |

The reported Q1 finale orb defect is fixed and installed in `72794d58`. Actual classic and rerelease `end` travel failed before the shared Q1 PUSH correction and passes afterward. The fix applies generally to translating Q1 pushers; further finale performance work remains in the table above.

T19's future ranking-service backend is the explicitly approved placeholder. It is the only permitted placeholder and does not block the agreed implementation scope.

See [functional target status](functional-targets/status.md), [installed delivery](execution-status.md#installed-executable-and-recent-fixes), and [tick execution](tick-execution.md).
