# Quake Anthology TypeScript code review

**Date:** 2026-10-27  
**Reviewed revision:** [`1b703833cfa7d4daef690c1cde37072b23a773d6`](https://github.com/mgd34msu/Quake-Anthology-TS/tree/1b703833cfa7d4daef690c1cde37072b23a773d6), `main`, version 1.2.6  
**Focus:** Bugs and concrete performance improvements.

Four reproducible bugs and three performance opportunities are detailed below. Fix the unified-input boundary first: it accepts commands that the authoritative movement providers reject, allowing a peer-originated error to reach the simulation loop. For performance, indexing guest-memory write observers has the strongest measured scaling evidence. No implementation changes are included in this review.

## Findings at a glance

P1 means high priority because a peer can disrupt host simulation. P2 means a functional defect to fix in normal development. Performance ranks indicate recommended investigation order, not measured whole-game impact.

| ID | Priority | Finding |
| --- | --- | --- |
| B1 | P1 | Unified input admits values that throw in authoritative movement |
| B2 | P2 | Legacy translucent world surfaces render before opaque entities |
| B3 | P2 | Valid gzip downloads fail the response-length check |
| B4 | P2 | Shared Q1 physics reverses trigger and impact callback order |
| PERF1 | Performance rank 1 | Unrelated guest-memory writes scan every observer |
| PERF2 | Performance rank 2 | Per-frame merged geometry defeats the packing cache |
| PERF3 | Performance rank 3 | BSP traversal applies PVS rejection only at leaves |

## Confirmed bugs

### B1 Unified input must enforce movement family bounds

**P1.** The decoder accepts Q3 movement axes in `-32768..32767` and Q2 rerelease durations in `0..1000`. The actual providers require signed-byte Q3 axes and a Q2 duration in `0..255`. This affects an admitted unified peer whose selected movement uses these implementations, not every protocol or game configuration. See the [decoder](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/app/bootstrap/network/unified-control.ts#L62-L65), [Q3 validation](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/movement/q3/move.ts#L508-L512), and [Q2 duration validation](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/movement/q2/index.ts#L29-L30), [called for rerelease movement](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/movement/q2/index.ts#L166-L171).

**Reproduction and impact.** A loopback fixture completed the production unified handshake and ready exchange through `UnifiedServerNetwork`, using a fixture application host. Sending an otherwise valid Q3 command with `forwardMove: 128`, or a Q2 rerelease command with `milliseconds: 256`, yielded one admitted command and zero peer disconnections in each case. Passing the admitted command to its real movement implementation threw `RangeError`.

The production [host input adapter](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/app/bootstrap/simulation/network-unified.ts#L231-L236) checks sequence and family, not these bounds. The application [polls network input](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/app/bootstrap/application.ts#L4537-L4539), then [advances simulation outside the peer-input handler](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/app/bootstrap/application.ts#L4629-L4631). The [step catch and run loop](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/app/bootstrap/application.ts#L4685-L4703) can propagate that error out of the host loop. That final application-level consequence is code-traced, not an end-to-end retail-server shutdown reproduction.

**Recommended fix.** Apply family-specific command validation before admission to the simulation queue, ideally sharing the bounds with the movement providers. Reject the invalid peer input at that boundary; do not broadly swallow genuine host/simulation failures. Verify both invalid values above and the valid boundary values `-128`, `127`, `0`, and `255`.

### B2 Defer legacy world transparency until after opaque entities

**P2.** [`prepareView`](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/render/scene/world.ts#L545-L552) appends all world operations, including translucent surfaces, before inline models and supplied entity operations. Legacy sequence groups deliberately retain insertion order in [`finishSceneOperations`](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/render/scene/submissions.ts#L114-L123); their phase label does not repair this ordering.

**Reproduction and impact.** Using the real Q2 material builder and CPU renderer, draw a near blue `TRANS66` pane and farther opaque red geometry through sequence groups. World-first ordering produces center-pixel RGB `(255, 0, 0)`: the later opaque draw overwrites the pane. Opaque-first ordering produces `(87, 0, 168)`. This is a rendered material/submission fixture reproducing the order assembled by `prepareView`, not a retail-map or GPU capture.

**Recommended fix.** Defer the legacy world translucent pass until opaque model/entity submission is complete. Preserve sequence barriers, required ordering within passes, and native Q3 shader ordering. Do not globally sort legacy sequence groups: their insertion-order behavior is intentional. Verify overlapping translucent world surfaces and opaque entities with the pixel fixture above.

### B3 Do not compare decoded download size with compressed Content Length

**P2.** The normal whole-file [GET request](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/network/services/http-downloads.ts#L59-L68) does not request identity encoding. Bun transparently decompresses its response body, but the [completion check](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/network/services/http-downloads.ts#L330-L332) compares decoded bytes with the compressed `Content-Length`.

**Reproduction and impact.** A local HTTP server returned a 1,700-byte payload as 57 gzip bytes with `Content-Encoding: gzip` and `Content-Length: 57`. Bun 1.3.14 advertised `gzip, deflate, br, zstd`; the real `HttpDownloadQueue`, configured for one stream, returned fallback with `Incomplete HTTP response body` and did not publish the final asset. A valid download therefore falls back unnecessarily. Native Q2 fallback can be slower, or a required asset can remain unavailable and prevent joining if that fallback is unavailable.

**Recommended fix.** Request identity encoding consistently and verify the representation, or compare `Content-Length` only when the streamed representation is identity encoded. Keep decoded-size limits and asset validation. Preserve the existing range/ETag checks rather than disabling length validation globally. Verify compressed whole-file responses, identity responses, genuinely truncated bodies, and ranged retries.

### B4 Preserve Q1 trigger callbacks before collision impact

**P2.** Shared physics [links the moved body, calls impact, then touches triggers](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/app/bootstrap/simulation/physics.ts#L362-L371) for every family. Original Q1 [`SV_PushEntity`](https://github.com/id-Software/Quake/blob/bf4ac424ce754894ac8f1dae6a3981954bc9852d/WinQuake/sv_phys.c#L397-L400) links with trigger touching enabled before impact. The repository's separate [NetQuake movement helper](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/movement/q1/netquake.ts#L97-L104) also follows that order.

**Reproduction and impact.** In `SharedPhysics`, a Q1-family flying box moves into a blocker while overlapping a trigger. Its collision callback releases the mover. The observed callback log is `['impact']`; Q1 order requires `['trigger', 'impact']`. The trigger never runs because the mover has already been removed. This affects source-defined item, teleport, and trigger behavior for Q1 bodies using this shared path, including toss/bounce/fly and pusher-carried bodies.

**Recommended fix.** Branch callback order by source family: for Q1, touch triggers after linking and before impact, rechecking actor liveness after callbacks. Preserve Q2's existing order and retry behavior. Verify the release-on-impact fixture and a trigger that removes the mover before impact.

## Concrete performance opportunities

These are isolated CPU measurements on Bun 1.3.14, not FPS predictions. The proposed full optimizations have not been implemented or benchmarked in retail gameplay.

### PERF1 Index guest write observers by backing memory range

**Rank 1.** [`SparseGuestMemory.#notifyWrite`](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/guest/core/memory.ts#L453-L461) copies and scans the entire observer set on every observed-memory write, even when all watched ranges are unrelated. The cost scales with stores times observers. This has concrete callers: [deferred damage installs two observers per tracked monster](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/compat/q2/rerelease/deferred-damage.ts#L81-L97), retained until [release/clear](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/compat/q2/rerelease/deferred-damage.ts#L128-L133), while [native mod items register field observers per admitted client](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/compat/q2/native-mod-items.ts#L232-L244).

**Measured fixture.** Perform 200,000 managed `writeUint32` operations to an unwatched stack region, after 10,000 warmup writes. Seven trials per observer count produced these medians; no callbacks fired:

| Registered observers | Median time |
| ---: | ---: |
| 0 | 8.48 ms |
| 1 | 20.61 ms |
| 16 | 142.29 ms |
| 64 | 555.80 ms |
| 256 | 2,247.07 ms |

An independent repeat showed the same scaling, with 6.72 ms at zero observers and 2,336.34 ms at 256 observers, again with no callbacks.

**Recommended change.** Index by backing `ArrayBuffer` and byte page or interval, so writes retrieve only potentially intersecting observers. Preserve aliased mappings, split mappings, observer insertion order, removal and reentrancy semantics, and post-commit callback error aggregation. Benchmark both unrelated stack writes and actual overlapping callbacks after the change.

### PERF2 Retain merged static geometry across frames

**Rank 2.** [`mergeDrawOperations`](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/render/scene/submissions.ts#L240-L244) creates fresh merged vertex/index arrays on each call. [`GeometryBuffer.pack`](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/render/gl/buffers.ts#L81-L96) promotes repeatedly encountered array identities into its packing cache. Unchanged merged runs receive new identities every frame, so they do not reach that cached path.

**Measured fixture.** With 512 unchanged compatible quads, totaling 2,048 vertices, five rounds of 1,000 frames measured merge-plus-pack at **0.465–0.603 ms/frame**. Packing a pre-retained identical merged result measured **0.000063–0.000190 ms/frame** after warmup. An independent rerun put the current path at **0.51–0.67 ms/frame**. The retained-result case isolates avoidable CPU preparation; it excludes cache lookup/invalidation work a real solution needs, GPU work, and the rest of rendering.

**Recommended change.** Retain geometry for ordered static runs, keyed by constituent geometry identity and order. Reuse packed geometry while updating only genuinely changing draw state. Account for visibility changes, dynamic lighting, transforms, and other geometry-affecting inputs; preserve barriers and primitive order. Measure representative scenes before assigning a frame-time benefit.

### PERF3 Reject invisible BSP subtrees before descending

**Rank 3.** [`visibleWorld`](https://github.com/mgd34msu/Quake-Anthology-TS/blob/1b703833cfa7d4daef690c1cde37072b23a773d6/src/render/scene/visibility.ts#L163-L186) rejects internal nodes by frustum only. PVS and area rejection happen at leaves, so an in-frustum subtree is traversed even when none of its leaves is potentially visible.

**Measured fixture.** A balanced synthetic Q3 BSP with 16,384 leaves and only one PVS-visible leaf visited all **16,383 internal nodes**, plus 14 node reads to locate the camera leaf. The visible leaf has only 14 ancestors. Timing without the node-counting proxy, after warmup and over 200 queries, was **2.35–2.78 ms/query** across two runs. No optimized runtime comparison was measured.

**Recommended change.** Cache visible ancestor marks and skip unmarked subtrees before frustum/light-mask work. Key or invalidate marks on primary/secondary cluster, area visibility, visibility settings, and map changes. Preserve traversal order and first-encounter dynamic-light masks. Validate sparse and dense PVS cases and measure on real maps.

## Verification and limits

- **Runtime:** Bun 1.3.14, installed outside the checkout. Source line links are pinned to the reviewed commit.
- **TypeScript:** Passed with TypeScript 5.9.3 and external dependencies, explicit `typeRoots`/`baseUrl`, and `NODE_OPTIONS=--max-old-space-size=8192`. An initial approximately 2 GiB heap run exhausted memory; that was not a compiler finding.
- **Full `bun test`:** 2,537 passed, 485 skipped, 546 failed, and 2 errors across 685 files. The run was not green. Observed blockers included missing retail corpus, native SDL timestamp/audio environment issues, and initial external TypeScript module-resolution errors. Not all 546 failures were individually established to be environment-only.
- **`bun run policy`:** Terminated by SIGKILL, exit 137, without source diagnostics. The cause is unconfirmed; this is neither a policy pass nor a demonstrated source-policy failure.
- **Targeted evidence:** Production-component loopback input and movement checks, a material/CPU-rendering pixel fixture, a local gzip HTTP transfer, a shared-physics callback-order fixture, and isolated memory/render-preparation/visibility benchmarks established the findings above. The fixture inputs and observed results are described inline; they do not depend on a checked-in reproduction harness.
- **Not exercised:** No `QTS_TEST_CORPUS`, retail-game session, full hosted-network shutdown, full GPU rendering run, or end-to-end gameplay performance measurement was available. Source tracing and synthetic measurements are distinguished from executed behavior above.

Recommended order: fix B1, address the three P2 correctness defects, then prototype the observer index before pursuing the renderer optimizations. Re-run the focused reproductions and the environment-dependent checks in a configured retail/native environment before treating the project as validated.
