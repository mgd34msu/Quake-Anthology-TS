# RETIME — Independent re-measurement of performance and leak figures

## Coverage
Scope: all 50 catalog entries with final severity Critical, High or Medium and category performance or leak. None are Critical.

Result: 35 re-measured, 6 of them only in part, and 15 with no usable measurement. Both groups are listed under "IDs I could not measure".

## Method
- Code: private copies at HEAD under `retime/`. `retime/build` is unmodified. `retime/inst` adds timers and a PERF3 toggle, and is used only where stated. Scripts are in `retime/s/`, raw logs in `retime/logs/`.
- Runs: 3 fresh sequential processes, each under `timeout 280`. "Measured" is the median and "spread" is min to max. Run-to-run spread does not include the machine load below.
- Scripts: earlier audit scripts were reused with only their paths changed where they exist. New scripts: `q2fp.ts`, `realq1b.ts`, `realmdl.ts`, `realjpeg.ts`, `realui.ts`, `ui5shuffle.ts`, `litreal.ts`, `sweep.ts`, `hull1.ts`, `core003.ts`, `misc.ts`.
- Machine: not fully quiet. Load average was 2.3 to 4.0 on 12 cores. `goodvibes-daemon` (about 90% CPU) and `muse` (about 48%) were running and I left them alone.
- Original timings: most came out 1.2x to 1.7x slower than mine, in about the same ratio across unrelated benchmarks. That points to contention during the audit, not to wrong code analysis. Differences inside that band are marked "holds".

### Deviations and limits
- **The 6 GB limit stops memory experiments early.** Under `ulimit -v 6000000`, JSC aborts with `MemoryExhaustion` or throws `Out of memory` at about 1.3 to 1.8 GB RSS, because Bun normally reserves far more address space (VmPeak about 135 GB here). I did not lift the limit for memory experiments, so some large figures could not be reached. Each is marked in the table.
- **Timing experiments that ran without the limit.** The brief applies the limit to memory experiments only. These are the native DLL runs, which abort under it, and three control runs. Peak RSS: instrumented 1.9 to 2.1 GB, sampled classic 5.2 to 5.3 GB, sampled rerelease 7.7 to 10.4 GB (profiler retention included).
- **The limit barely changes timing.** Controls with and without it: i386 1.17 vs 1.19 MIPS, Q3 getchallenge 0.21 vs 0.20 ms.
- **One call was moved to the background.** The harness backgrounded a foreground call at 180 s, against the no-background rule. I stopped it, confirmed no process was left, discarded its incomplete `fp-base1` run and re-ran it. All later calls stayed under 180 s.
- **Core dumps.** 13 aborted `bun` processes under the limit reached systemd-coredump (`coredumpctl list bun` shows 13). They were caused by the limit and may have raised desktop crash notifications.
- **Component level only.** No sockets were opened. NET figures come from in-process calls.

## Results
Original figures are quoted from the entry. "Synthetic" means the same fixture as the original.

| ID | Original | Measured (median) | Spread | Verdict |
|---|---|---|---|---|
| AUDIT-001 | Q1 18.3 MB/map, Q2 19.3, Q3 41.4; client 23.5 | Q1 18.4, Q2 19.2, Q3 43.5 over 2 travels only; client not reached | Q1 18.4-18.5; Q2 none; Q3 43.0-43.5 | holds (Q1, Q2); Q3 partial, aborts after 2 of 10 travels; client not measurable, aborts before the first travel |
| BOTS-004 | 100/100 replans; plan 17 ms; unreachable 10 ms | 100/100; 13.1 ms; 9.5 ms | 13.1-18.0; 9.3-9.6 | holds (synthetic graph) |
| BOTS-005 | 93.0 MB for 128 goals at 4900 nodes | 93.3 MB | 92.7-94.1 | holds; the 8-bot total was not run |
| GAPQ12C-002 | 20 of 20 beams kept | 20 of 20 | none | holds (effects side only) |
| GUEST-004 | i386 0.67 MIPS, x87 0.20 | Synthetic 1.17 and 0.32; **real retail frame 0.72** | 1.13-1.17; 0.30-0.33; real 0.718-0.727 | holds; see RETIME-001 |
| GUEST-005 | SSE 0.65 vs integer 4.83 MIPS (7x); "likely the largest limit" | Synthetic 0.98 vs 7.73 (7.9x); **real FP share 26.5% of export time** | 0.96-0.98; 26.4-26.7% | ratio holds; "largest limit" overstated; see RETIME-002 |
| LEFT-003 | RSS 96 at frame 100, 168 at 600; about 140 KB/frame | 97 and 170; 144 KB/frame. Real `armor_red.md3`: 96 to 228 over 1100 frames, 120 KB/frame | 97-98; 170; real 227-230 | holds |
| PLATFORM-001 | 100 updates: 1.4, 6.3, 29.8, 61.5 ms; over 60 Hz budget by about 30,000 actors; throws at 65,536 | 0.83, 4.25, 13.98, 71.1 ms; crosses budget near 35,000; throws at 65,536 | 13.2-14.7 at 30k; 64-74 at 60k | 30k figure overstated about 2x, conclusion holds; see RETIME-003 |
| RENDER-002 | RSS 408 MB at 600 draws, about 0.5 MB/draw | 409 MB, 0.5 MB/draw | 407-411 | holds |
| AUDIT-002 | 17m51s, about 13 GB | none | none | not measurable: brief forbids the policy run; also exceeds `timeout 280` and the 6 GB limit |
| BOTS-007 | 800 traces, about 4000 objects per frame | none | none | not measurable: arithmetic with no timing; needs a coop bot world with 100 monsters |
| BOTS-011 | 26.5 ms; 19361 traces, 19318 contents, 19318 hazards | 20.9 ms; 19361, 19318, 19318 | 19.4-22.3 | holds; counts exact (synthetic graph) |
| CORE-003 | 100 models over 30k nodes: +195 MiB, 373 ms | Heap +211 MiB, RSS +492 MiB, 330 ms. Real: e2m2 30.9 MiB, e4m3 32.1 MiB heap | heap 209-221; 312-331 ms; e4m3 29.1-33.1 | heap holds; RSS understated 2.5x; see RETIME-004 |
| CORE-004 | no figure | none | none | not measurable: no figure to retime; I did not look for a BRUSHLIST map in the corpus |
| CORE-008 | no figure ("share not measured") | none | none | not measurable: no figure to retime |
| FORMATS-005 | +842 MB after 30,000 calls | +842 MB | 842-842 | holds |
| FORMATS-015 | 5.8 MP/s, 2.66 MB/s, 718 ms | Synthetic 7.9 MP/s, 3.62 MB/s, 528 ms. Retail pak0: 7.75 MP/s | 7.8-8.3; 508-535 ms; 7.69-7.83 | holds; retail impact small; see RETIME-005 |
| GAPAPP-004 | 4096 entries: ping 8.2 ms, name 79.8 ms | 6.62 ms, 71.60 ms | 5.65-6.89; 69.99-71.83 | holds |
| GAPAPP2-006 | 200,000 voices kept, 0 after prepare | 200,000, then 0 | none | holds |
| GAPAPP2-007 | 0.73, 8.58, 31.17 ms/frame | 0.65, 8.33, 30.64 ms/frame | 512 entries: 28.37-32.26 | holds (synthetic model, as in the original) |
| GAPCOMPAT-005 | no figure | none | none | not measurable: the provider is not active in a retail DLL run; needs a native mod with component projections |
| GAPCOMPAT-006 | 986 and 1736 ns vs 26 and 22 ns | 1003 and 1695 ns vs 26 and 23 ns | 987-1016; 1668-1709 | holds |
| GAPCOMPAT-008 | no figure | none | none | not measurable: no figure; needs an owned combat actor in a native mod |
| GAPNET-005 | up to 65536 entries per message | none | none | not measurable: needs a hostile server stream, which the brief excludes; no component run |
| GAPNET-006 | no figure | none | none | not measurable: same reason as GAPNET-005 |
| GAPSIM-004 | about 370,000 records/frame (arithmetic) | none | none | not measurable: the entry says no retail content selects these components |
| GAPSIM-005 | fatal at 8192 slots (traced) | none | none | not measurable: this path was not exercised; VM-001's related limit does reproduce |
| GAPSIM-006 | no figure | none | none | not measurable: needs a long rerelease bot deathmatch |
| GUEST-003 | 20,000 mappings, 81,920,000 bytes, +135 MB | Same counts, +137 MB | 136-137 | holds |
| GUEST-011 | 4.83 to 3.45 MIPS (29% loss) | 7.73 to 5.62 MIPS (27% loss) | 7.71-7.84; 5.25-5.70 | holds |
| GUEST-012 | 0.413 ms per reconcile at 600 edicts | 0.390 ms | 0.382-0.401 | holds; real-frame bound below |
| NET-014 | no figure | none | none | not measurable: needs repeated download requests against a server, which the brief excludes |
| NET-018 | up to about 64 MiB per connection (arithmetic) | none | none | not measurable: same exclusion; 16 KiB x 4096 was not exercised |
| NET-019 | 0.270 ms/packet; 69 ms per 256 | 0.210 ms; 54 ms | 0.203-0.211; 52-54 | holds (in-process, no sockets) |
| NET-021 | 1.07 ms per 1400 bytes; 7.3 us; 15.2 ms per 2080 strings; 65 MiB | 0.73 ms; 4.6 us; 9.6 ms; 65 MiB | 0.73-0.83; 4.6-4.8; 9.5-10.0 | overstated about 1.5x; see RETIME-006 |
| PLATFORM-010 | 20,000 voices: start 935.7 ms, mix 88.6 ms | 947.0 ms, 97.1 ms | 844-971; 96.5-98.4 | holds |
| RENDER-001 | RSS 622 at 1,500; 2,003 at 6,000; 3,623 at 15,000 | 628 at 1,500; later points blocked by the limit. Real `soldier.mdl`: 1,331 at 6,000, about 1,725 at 9,000 | 553-633; real 1330-1331, 1722-1729 | holds; synthetic 2,003 and 3,623 not measurable under the limit; see RETIME-007 |
| RENDER-007 | 14 vs 16,397 node reads on a fixture | Fixture identical. Real maps: 756 vs 221 reads (e1m1 p50) | fixture none; reads none | trigger holds; magnitude overstated; see RETIME-008 |
| RENDER-008 | 1000 8x8 faces: 16-25 ms/frame | Same fixture: 15.5 ms cold, 10.5 warm. Real views: 0.6-2.4 ms at p50 | cold 15.3-19.8; warm 9.8-11.9 | overstated for typical views; see RETIME-009 |
| RENDER-013 | 3-5 copies (traced) | none | none | not measurable: needs a live GL worker renderer, and the brief forbids a window |
| RENDER-014 | no time figure | One extra traversal: 0.015-0.30 ms on real maps | across 6 maps, p50 and p95 views | holds; cost small, at most about 1.8% of a 16.7 ms frame |
| SIM-008 | 2 GiB limit (traced) | 8 bytes per `unnamed` allocation, about 268M commands to the limit | none | partial; arena only, the `setClientInfo` path was not driven |
| SIM-013 | 5,050 buffers, about 40 MB per tick | 38.5 MiB; allocation alone 16.8 ms | 16.67-17.50 | partial; allocation holds, encode time and the O(n^2) loop were not driven |
| UI-005 | +19,000 and +32,000 bytes; null after 19,694 pairs | Identical. Retail strings: 0 growth | none | synthetic holds; not reproducible on retail strings; see RETIME-010 |
| UI-009 | 5 images, 6.3 MB RGBA each | 6.0 MiB each from PNG headers (same size) | none | partial; dimensions hold, heap and GPU retention were not measured |
| UI-010 | 0.93 ms/frame; 326 freezes | 0.71 ms; 326 | 0.68-0.76 | holds; time 1.3x lower |
| UI-011 | 155K and 47K tokens/s; "200 KB about 1 s" | 218K and 66K tokens/s; real 163 KB `rchat.c` 410 ms | 201-227K; 65-67K; 400-436 ms | "1 s" overstated about 2x; see RETIME-011 |
| VM-001 | throws after 8191 actors, count 8192 | Same | none | holds |
| VM-010 | about 30 bytes per target; 86 MB/hour | 23 bytes per target with two real names; about 63 MiB/hour | none | partial; arena model only, the launch and think path was not driven |
| VM-011 | no figure | none | none | not measurable: no figure; needs a QVM mod with projected actors |

## Q2 native DLL: real frame floating point share
Setup: retail `gamex86.dll` and `game_x64.dll` from qfiles, in the real `Application`, with a local player, the CPU renderer at 320x240 and SDL dummy drivers. The first 60 frames are excluded as JIT warm-up. Instrumented timing and an uninstrumented sampling profile are independent methods.

| Measure | Classic base2, moving and firing, 300 frames | Classic base1, idle, 200 frames | Rerelease base2, moving and firing, 400 frames |
|---|---|---|---|
| Instructions per frame, median (max) | 82,782 (119,772) | 61,896 (137,648) | not instrumented |
| FP share of instructions | 14.44% | 11.79% | not instrumented |
| FP share of interpreter time | **28.5%** (28.3-28.7) | **23.1%** (22.7-23.5) | 20.7% (derived from sampling) |
| FP share of DLL export time | **26.5%** (26.4-26.7) | **21.7%** (21.4-22.0) | not instrumented |
| FP share of whole app step, instrumented | 18.9% (18.7-19.0) | 11.0% (10.9-11.1) | not instrumented |
| FP share of whole app step, sampled | **18.2%** (18.1-18.4) | not run | **7.8%** (7.7-8.0) |
| Interpreter share of step, sampled | 66.3% (66.3-66.4) | not run | 37.6% (37.5-38.2) |
| Real throughput | 0.724 MIPS (0.718-0.727) | 0.784 MIPS (0.706-0.787) | not instrumented |
| Time per FP / non-FP instruction | 2.71 / 1.16 us | 2.54 / 1.11 us | not instrumented |

Caveats:
- The two methods agree for classic: 18.9% vs 18.2% of the step, 28.5% vs 27.4% of interpreter time.
- Export share is the best general figure. The whole-step share depends on the renderer, which is the CPU renderer here (about 21% of the classic step, 36% of rerelease) and would differ under GL.
- FP time covers the FP handler only. Every instruction also pays the shared fetch and checkpoint cost, so an FP fast path cannot remove that part. The numeric core is 77% of classic FP time.
- The rerelease figure counts only code under `guest/floating-point/`, so it is a lower bound relative to the classic figure.
- The "active" scenario holds forward and fire from spawn. The player took 77 damage on classic base2, so monsters did engage, but this is one short engagement, not a worst-case battle.
- One of the four rerelease runs died with `Q2 BoxEdicts filter cannot modify world links`. That is the known DOCS3-007 / VERIFY-L fault, not new. Its log is kept as `logs/fprr-prof.3.log`, and run 4 replaced it in the statistics.

## Findings
### RETIME-001 — GUEST-004: the retail frame cost is now measured, and classic DLLs cannot hold 10 Hz in the interpreter
- Severity: High
- Category: performance
- Location: src/guest/x86/cpu.ts:53-60; src/guest/x86/decoder.ts:16-20
- Confidence: reproduced
- Evidence: The entry said the true cost of a retail frame was not measured. Retail `gamex86.dll` on base2 runs a median 82,782 instructions per frame at 0.724 MIPS. Interpreter time is about 110 ms per frame against a 100 ms frame, and export time about 118 ms. Instruction counts repeat almost exactly across runs (24,022,933 to 24,022,943). Top self time includes `byte` 8.0%, `freeze` 7.7%, `fetchByte` 5.4%, `asUintN` 4.6% and `BigInt` 4.2%. The synthetic loop's 1.17 MIPS is 1.6x faster than real code, so the original 0.67 was close to the real rate for the wrong reason.
- Impact: The severity stands, on measured retail data. App steps took a median of 161 to 166 ms for a 100 ms frame, renderer included. The 5,000,000 budget represents about 6.9 s of stall, not 7.5 s.
- Remediation: As in GUEST-004. Removing per-instruction decode and allocation comes first.

### RETIME-002 — GUEST-005: floating point is a real cost but is not the largest throughput limit
- Severity: Medium (recommended change from High; the decision is the orchestrator's)
- Category: performance
- Location: src/guest/floating-point/binary.ts:194-222; src/guest/floating-point/x87.ts
- Confidence: reproduced
- Evidence: See the share table. The 7x synthetic ratio reproduces (7.9x), but in real classic code an FP instruction costs only 2.3x a non-FP one (2.71 vs 1.16 us), because non-FP instructions are far slower than the integer loop suggests. Non-FP work is about 71.5% of classic interpreter time. In rerelease, FP is 7.8% of the step.
- Impact: Making FP free would cut classic base2 export time from about 118 ms to about 87 ms per frame, an upper bound that still leaves the interpreter busy for most of the frame. The entry's "likely the largest single throughput limit for rerelease mods" does not hold in this run.
- Remediation: Do the GUEST-004 decode work first, then the FP fast path.

### RETIME-003 — PLATFORM-001: the budget crossing is near 35,000 actors, not 30,000
- Severity: High (unchanged)
- Category: leak
- Location: src/audio/engine.ts:140-149
- Confidence: reproduced
- Evidence: `sweep.ts`, 100 updates: 8.7-9.0 ms at 20k, 11.8-12.3 at 30k, 15.3-16.1 at 35k, 26.3-26.9 at 40k, 37.1-40.2 at 50k. Cost rises faster than linearly above 35k, and the 40k and 45k points are out of order (about 26 vs 23 ms). The 60k point is noisy across all runs, 39 to 74 ms.
- Impact: The conclusion stands. The fatal throw at 65,536 reproduces exactly, and the 22-minute estimate is unaffected.
- Remediation: As in PLATFORM-001.

### RETIME-004 — CORE-003: RSS is 2.5x the reported heap cost, and stock maps match "tens of MB"
- Severity: Medium (unchanged)
- Category: leak
- Location: src/world/collision/q1/hull.ts:25-34
- Confidence: reproduced
- Evidence: I could not find the original script, so this fixture is my own. 100 models over 30,000 nodes: heap +211 MiB, RSS +492 MiB. All models of real maps: e1m1 7.6 MB RSS (one run), e2m2 31 MiB heap and 24 MB RSS, e4m3 32 MiB heap and 49 MB RSS. Real figures assume every submodel is traced.
- Impact: The projected 6.5 GB for a huge BSP2 map is a heap-based estimate and could be higher in RSS.
- Remediation: As in CORE-003.

### RETIME-005 — FORMATS-015: throughput holds, but retail textures make the stall small
- Severity: Medium (unchanged)
- Category: performance
- Location: src/formats/images/jpeg.ts:160-176
- Confidence: reproduced
- Evidence: Decoding all 1,099 JPEGs in baseq3 `pak0.pk3` (48.1 MP): 7.75 MP/s, 6.2 s total, largest image 0.49 MP, slowest file 63-65 ms.
- Impact: The seconds-long stall needs high-resolution replacement packs, as the entry says. Retail content costs at most tens of ms per image.
- Remediation: As in FORMATS-015.

### RETIME-006 — NET-021: the 64-client "exceeds a frame budget" claim is borderline at a 20 Hz server frame
- Severity: Medium (unchanged)
- Category: performance
- Location: src/network/q3/message.ts:97-120
- Confidence: reproduced (component); frame claim is arithmetic
- Evidence: 0.73 ms per 1400-byte message x 64 clients is about 47 ms. Against a 50 ms frame (assuming the Q3 default of 20 Hz, which I did not run) that is about 93% of the budget, not over it. The original 1.07 ms gave about 68 ms.
- Impact: Encoding still takes nearly the whole frame at full packets, leaving almost nothing for the game. The claim as written needs softening.
- Remediation: As in NET-021.

### RETIME-007 — RENDER-001: a real model confirms the growth, and one entity reaches about 1.7 GB
- Severity: Medium in the catalog; the real-model figures support reconsidering High
- Category: leak
- Location: src/render/scene/models/prepare.ts:362-373
- Confidence: reproduced
- Evidence: Real `soldier.mdl` (170 vertices, 328 triangles), one entity, stand and run loops only (17 frame pairs), random `backLerp`, 60 prepares per second assumed. RSS: 298 MB at 1,000 prepares, about 691 at 3,000, 1,331 at 6,000, about 1,725 at 9,000, then about 1,370 at 15,000 after per-pair clears. That is about 740 MB per minute, reaching about 1.7 GB in 2.5 minutes. One of 3 runs aborted at the limit before 9,000. Cycling all 114 frames gave 1,365 MB at 6,000 and stopped at the limit (one run threw `Out of memory` at 10,239 prepares, two aborted).
- Impact: The growth rate exceeds the entry's "hundreds of MB per minute". The synthetic 2,003 and 3,623 MB points could not be reached under the limit. Random `backLerp` follows the entry's trace of wall-clock presentation and was not observed in a live client.
- Remediation: As in RENDER-001.

### RETIME-008 — RENDER-007: the trigger is confirmed on real maps, but the time cost is negligible
- Severity: Low (recommended change from Medium)
- Category: performance
- Location: src/render/scene/visibility.ts:106,118
- Confidence: reproduced
- Evidence: e1m1 has 1,278 node children pointing at leaf 0, which confirms the entry's traced layout claim. I compared HEAD with a private copy that ignores shared-leaf reuse, over leaf-centre views in 4 directions. Node reads at p50/p95: e1m1 756/1823 vs 221/1319, e3m3 572/1580 vs 167/1099, e4m3 661/1635 vs 182/1196. These are nothing like the fixture's 16,397. Query time at p50: e1m1 0.171 vs 0.067 ms, e3m3 0.016 vs 0.017 ms, e4m3 0.027 vs 0.023 ms. At p95 there is no difference beyond noise.
- Impact: The largest saving is about 0.1 ms per query. I checked read counts and timing only, not rendering correctness, with the toggle on.
- Remediation: As in RENDER-007, at lower priority.

### RETIME-009 — RENDER-008: real views cost far less than the 1000-face fixture until p95
- Severity: Medium (unchanged)
- Category: performance
- Location: src/render/scene/world.ts:601-607; src/materials/lighting.ts:104-127
- Confidence: reproduced for the frontend; GL cost not measured
- Evidence: Real Q1 faces, leaf-centre views. Maps e1m1, e1m3, e2m2, e3m3, e4m3 and end: p50 182-260 faces at about 0.6 to 2.4 ms; p95 1,212-3,173 faces at 5.1 to 11.7 ms; maximum 1,865-5,743 faces at 8.7 to 20.1 ms. A real face averaged 26.6 texels in the one view sampled, against 64 in the fixture. Views are uniform across leaves, not weighted by where players stand.
- Impact: "A full frame budget on the frontend alone" holds only at the extreme. The entry's GL cost, about 20 FFI calls per update, comes on top and was not measured, so total cost could still be significant.
- Remediation: As in RENDER-008.

### RETIME-010 — UI-005: the pool burn does not occur with retail Team Arena strings
- Severity: Low (recommended change from Medium)
- Category: leak
- Location: src/ui/common/legacy/team-arena/memory.ts:334-351
- Confidence: reproduced for the strings tested
- Evidence: The entry assumed no corpus was available, but `missionpack/pak0.pk3` is present. I interned all 1,121 distinct quoted strings from its 53 UI files, then repeated the 15 values tested per frame (`cvarTest`, `showCvar`, `hideCvar`). Growth was 0 over 3,600 frames in file order, and 0 over 60 frames in each of 200 random intern orders. The synthetic collision still reproduces exactly (19,000 and 32,000 bytes, null after 19,694 pairs).
- Impact: The defect is real but needs a mod or custom HUD with a three-way collision. Limits of this test: strings came from a regex, not the real parser, and I did not separately test the 128 KB cgame pool with its own load order.
- Remediation: As in UI-005.

### RETIME-011 — UI-011: real bot files tokenize about twice as fast per byte as the estimate
- Severity: Medium (unchanged)
- Category: performance
- Location: src/ui/common/legacy/script/memory.ts:294-297
- Confidence: reproduced
- Evidence: BotMemory path, includes resolved. `botfiles/rchat.c` (162,698 bytes, 16,689 tokens): 410 ms, about 41K tokens/s. `botfiles/rnd.c` (64,918 bytes): 158 ms. `ui/skirmish.menu` (33,955 bytes): 123 ms. These real files average about 10 bytes per token, against 3.9 in the synthetic file, so 200 KB would take about 0.5 s, not 1 s.
- Impact: Token throughput on the slow path holds, and this answers the entry's unmeasured retail sizes. The largest bot file costs about 0.4 s on the main thread. Two of the 3 `perf.ts` runs aborted under the limit in the script's unrelated final stage, after the figures above were printed.
- Remediation: As in UI-011.

## IDs I could not measure
No usable measurement (15): AUDIT-002, BOTS-007, CORE-004, CORE-008, GAPCOMPAT-005, GAPCOMPAT-008, GAPNET-005, GAPNET-006, GAPSIM-004, GAPSIM-005, GAPSIM-006, NET-014, NET-018, RENDER-013, VM-011. Reasons are in the table.

Partial (6, claim not fully measured): SIM-008, SIM-013, UI-009, VM-010; AUDIT-001 (Q3 stops after 2 of 10 travels, client row not reached); RENDER-001 (synthetic 2,003 and 3,623 MB points not reached).
