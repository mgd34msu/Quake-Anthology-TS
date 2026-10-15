# Shared foundation: primitives and the event system

`src/foundation` is the TypeScript counterpart of the native C project's
shared foundation in [Quake-Anthology](https://github.com/mgd34msu/quake-anthology)
(`include/qa/*.h`, `src/core/*.c`, adoption history in its
`docs/core-adoption.md`). It applies the same data-processing rules here:

- One definition per shared capability; game/protocol differences stay at
  their boundaries as numeric rules or field adapters, never as a second
  store of the same state.
- Storage is sized at load (construction) and retained. Hot paths reuse
  slots, cursors, arenas and scratch instead of allocating per call, per
  event or per frame. Exhaustion is counted and explicit, never a silent
  heap fallback or overwrite.
- Identities are integers in hot code (interned string IDs, packed actor
  keys, provider ranks). Text resolves once at admission.
- Events are admitted once into one ring. Consumers advance independent
  cursors in admission order, retirement frees only the prefix every cursor
  passed, and leases pin records that must outlive lookup retirement.

## C to TypeScript map

| C foundation | This project | Notes |
| --- | --- | --- |
| `qa_vec2/3/4`, `qa_bounds`, inline math (`qa/math.h`) | `src/foundation/vec.ts`, `*Into` helpers in `src/core/math.ts` | Flat `Float32Array` slots (3 per vector, 6 per bounds) plus out-parameter object math. Staged binary32 rounding matches object math for finite values; NaN payloads canonicalize through typed-array storage. |
| `qa_strings` (`qa_string_id`) | `StringTable` in `src/foundation/strings.ts` | Intern once, compare uint32 IDs. Name classification bits are computed at admission (`quakeNameFlags`), mirroring `strings.c`. Persist text, never IDs. |
| `qa_arena` | `ByteArena` in `src/foundation/arena.ts` | Bump allocation over one load-sized buffer; offsets fixed until `reset`; overflow counted. |
| `qa_pool` | `FixedPool` in `src/foundation/pool.ts` | O(1) free-list slots created at construction; `takeSlot`/`release` never allocate. |
| `qa_stamp_set` | `StampSet` in `src/foundation/stamp.ts` | `begin()` is an epoch increment instead of clearing a set or flag array. |
| `qa_id_index` | `IdIndex` in `src/foundation/id-index.ts` | `(string-id, discriminator)` hash over typed arrays; reserve at load, cursor iteration for duplicates. |
| `qa_actor_id` value handle | Packed keys in `src/foundation/handles.ts` | `generation * 2^20 + slot` in one safe integer for hot storage/comparison within a session. Contract `ActorId` objects remain the API-boundary handle. |
| `qa_load_*le` / `qa_store_*le` (`qa/binary.h`) | `src/foundation/binary.ts` | Plain byte arithmetic plus one retained scratch word for float reinterpretation. |
| `qa_event_ring` + transactions/leases (THE-870) | `EventRing` in `src/foundation/event-ring.ts` | Power-of-two slot ring, append returns id or 0 (backpressure), `appendAll` is the all-or-nothing transaction, cursors, min-cursor retirement, leases, visitor drain with no allocation. |
| `qa_sys_event` + `qa_platform_events` (THE-864) | `SysEventQueue` in `src/foundation/sys-queue.ts` | One timestamped tagged record, admission before destructive reads, payload bytes in a sealed arena, per-cursor consumption, latched quit, per-kind deferred/oversize counters. Byte capacity reclaims on full drain where the C pages reclaim per page. |
| Provider registration order (`qa_scheduler`) | Stored `providerRank` in `src/world/scheduler.ts` | Think ordering compares bound integers; no `indexOf` scans in the dispatch comparator. |

`MutableVec3` storage semantics are unchanged on purpose: the
`Float32VectorView` backing (including its NaN-read canonicalization) is
observable through guest memory, so retained binary32 scratch keeps it.
Fast engine-side scratch is a plain `{x, y, z}` (`vec3Scratch`) written by
the `*Into` helpers, which apply binary32 rounding on every write.

## Adopted

The foundation is the only implementation of each capability below; the
per-game code that used to duplicate it is deleted or delegates here.
Remaining per-title files are extensions (numeric rules, field adapters,
protocol codecs) layered on these shared stores, never second stores of
the same state.

- Scalar conversion: `src/core/numeric.ts` bit reinterpretation, the Q3
  message float codec, QVM scalar returns/input, CRT `nextafterf` and the
  script numeric formatting all reuse the foundation scratch word; no
  per-call `ArrayBuffer`/`DataView` conversion remains in `src/`.
- Vector math: one rule-parameterized implementation in
  `src/core/math.ts` (`angleVectorsRule`, `vectorToAnglesRule`,
  `lerpAngleRule`, `rotatePointAroundVectorRuleInto`, the `*Into` family,
  double-precision helpers and the stored-intermediate forms).
  `src/core/qvm-math.ts` and `src/content/q2/foundation/weapons/vectors.ts`
  are deleted; Q1 foundation types, Q2 fields/ai/weapons, bot brains,
  collision polylib/patch and Q3 presentation/prediction delegate to the
  shared rules (`float`/`vm`/`donor`/`q1`/`native`/`native-ai`/`bot`/
  `bot-q3`, verified bit-identical per variant). Scheduler ordering
  compares bound provider ranks instead of `indexOf` scans.
- Events: simulation, presentation, physics, guest services (classic and
  rerelease), remote/unified/Q1 presentation, HUD/effects/mod
  presentation, audio, input staging, per-client session events, QW/Q1
  reliable backlogs, prediction-independent network queues, application
  command requests, the console command buffer, QuakeC routed messages,
  bot director output and ranking reports all admit through `EventRing`
  (with the bounded drop-oldest `BoundedQueue` for capped presentation
  histories: dynamic lights, damage indicators, pings, bot chat, audio
  pump intervals, scene commands, console history, prediction commands).
  Overflow of a must-not-drop ring is an explicit capacity error;
  capacities are named constants sized at load like the C output ring.
- Visit marks: collision leaf/brush queries and renderer surface dedup
  run on owner-retained `StampSet` epochs instead of per-query `Set`
  allocations.
- Identities: presentation resources and QW recording fields resolve
  through `StringTable` + `IdIndex`; audio loops, sound bank families,
  Windows import/data lookup, MD5 joint scales, local QC message state
  and opened-resource dedup use interned or numeric composite keys with
  no per-lookup key strings.
- Cleanup: binding/teardown remover lists across compat, world session
  and cvar mirroring are one `CleanupStack` (`src/foundation/cleanup.ts`)
  with snapshot, reverse-order and retained-scope runs.

Intentional non-queue retention stays as-is and is not legacy duplication:
signon message buffers (append-only retained bytes), saved player-state
arrays in checkpoint shapes (e.g. flood times), playlist order bags,
audio stream segment state, and the sorted packet delay scheduler.
Distinct source extensions also stay: `renderer-math` (renderer tables),
`game-numeric` (bg_lib dialect), `resource-name-index` (source slot
semantics), format quaternions, and the per-domain clocks.

## Measured component results

`bun run bench:foundation` (`tools/bench-foundation.ts`, median of three
rounds over retained structures, this machine, Bun 1.3.14). Component
timings only; no whole-frame or FPS claim follows from them.

| Work | Former | Foundation | Ratio |
| --- | ---: | ---: | ---: |
| `float32ToBits` | 275 ns | 5 ns | 50.6x |
| normalize(cross(sub)), plain scratch | 70 ns | 23 ns | 3.03x |
| angleVectors (Into / store) | 67–66 ns | 55 / 54 ns | 1.22–1.23x |
| projectPointOnPlane | 19 ns | 14 ns | 1.35x |
| lookAtMat4 | 59 ns | 56 ns | 1.07x |
| Visit marks x256 | 5,235 ns | 275 ns | 19.1x |
| Resource lookup, 897 entries | 115 ns | 20 ns | 5.88x |
| Think ordering sort x256 | 44,894 ns | 17,819 ns | 2.52x |
| Bulk normalize x512, retained | 5,650 ns | 1,664 ns | 3.39x |
| Event batch x64 drain | 212 ns | 326 ns | 0.65x |

Honest limits: Bun's JIT can scalar-replace short-lived object chains in
tight loops, so single-vector microbenchmarks understate allocation costs
that appear as GC pressure in full ticks; the bulk/retained rows are the
representative shape. Out-parameter math into retained binary32
(`Float32VectorView`) scratch measured far slower than allocating object
math (DataView accessors dominate) — that storage remains for guest
semantics, not speed. Ring visitor drain of small numeric batches is
slower than a tight `splice`; the ring's value is bounded retention,
independent cursors, leases and all-or-nothing batches, not raw drain
speed for trivial payloads.

Bit-exactness of the rewritten math and codecs was checked with an
independent probe encoding outputs as binary32 patterns (including NaN
signs and signed zero) over sampled and degenerate inputs, run against
the pre-change tree and this tree: 817 output lines identical.

## Remaining adoption, in expected-value order

1. Migrate the hottest remaining allocating callers (movement providers,
   camera, particle/sprite preparation) to `*Into` helpers with
   owner-retained plain scratch. Each site needs its aliasing check
   first: normalize-into-state is only valid when no other holder
   observes the previous vector object.
2. Give spatial/body storage a flat layout (`vec.ts` stores plus
   `FixedPool` snapshot slots) so broadphase and trace candidate work
   stop materializing per-query objects — the collision counterpart of
   the C caller-scratch migration. Visit marks already landed there.
3. Feed platform intake through `SysEventQueue` (SDL/socket conversion at
   intake, frame time as `SYS_TIME` records), as in THE-864/865. Window
   and controller staging already ride the output ring; the numeric
   tagged-record conversion at the SDL boundary is the remaining step.
4. Move presentation/simulation consumers from `take()` arrays to ring
   cursors and visitors (`drainPresentation`/`drainEvents` first), then
   let persistent presentation records hold ring leases instead of
   parallel retention.
5. Intern provider/content identities at session construction so hot
   comparisons (event audiences, resource ownership) compare IDs end to
   end; text stays at catalog/wire/save boundaries. Packed actor keys
   (`handles.ts`) are ready for hot actor-keyed storage to adopt.
6. Allocate network and codec scratch from `ByteArena`/`FixedPool`
   instead of per-packet buffers, following the C whole-frame allocation
   census (THE-2874): zero heap calls per warmed frame is the target
   shape to approximate under a GC runtime.

## Check a foundation change

```sh
bun test tests/foundation tests/core
bun tools/check-policy.ts src/foundation
bun run bench:foundation
```
