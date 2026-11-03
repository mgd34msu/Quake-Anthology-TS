# Architecture review of the audit-remediation diff (agent sarch)

Reviewed against DECISIONS section 9 (foundation primitives, EventRing, allocation-free hot paths, unified provider model).
Scope: `git diff f855f940 HEAD -- src` plus working-tree changes. Typecheck shows no errors in the touched files (remaining errors belong to other agents).

## Reworked

| File | Violation | Change | Test |
| --- | --- | --- | --- |
| src/audio/engine.ts | Actor table used a string-keyed `Map` plus a module-level `WeakMap` session counter; per-call template-string keys; `retireAbsentActors` built a `Set` of strings and spread loop maps per call | Foundation `IdIndex` keyed (slot, generation) with `ActorId.equals` and owner as the discriminator; no session counter (equals already encodes the session); `StampSet` for kept entities; batched `IdIndex.retain` for retirement; allocation-free loop check | tests/audio/component-loops, voice-events, round-reset, component-presentation, playback (47 pass) |
| src/network/services/admin.ts (FloodLimiter, ConnectionlessGate, RconService) | Per-peer `Map<string, ...>` keyed by `addressKey()` strings, allocating on every unauthenticated packet | New `src/network/common/peer-table.ts` (`PeerTable`: fixed-capacity slots over `IdIndex`, typed-array state, explicit exhaustion, bulk `retain`); limiters keep tokens/times in `Float64Array` by slot. Behavior identical (full table expires then refuses) | tests/network/hardening/limits.test.ts, new tests/network/common/peer-table.test.ts, tests/first-playable/server-administration.test.ts |
| src/network/common/rcon-guard.ts | String-keyed `Map` with insertion-order eviction | `PeerTable` slots, oldest-slot eviction by admission sequence | limits.test.ts |
| src/network/common/movement-budget.ts | Reviewed: one scalar object per client, no map or hot allocation | No change needed | covered by q2/qw network tests |
| src/network/common/endpoint.ts, src/network/q3/admission.ts | `sameAddress` formatted two key strings per call; Q3 challenge scan used a module-level `WeakMap` of cached key strings | `sameAddress` compares fields; admission scan uses it; the `WeakMap` and per-packet key are gone | tests/network/q3/network.test.ts, authorization.test.ts |
| src/network/q2/connectionless.ts, src/app/bootstrap/network/q2.ts | `handleQ2Rcon` referenced an undeclared module `WeakMap` (`rconGuards`, typecheck failure) keyed by a host object that is rebuilt per packet, so the guard never persisted | `handleQ2Rcon` takes the `RconGuard` as a parameter; `Q2ServerNetwork` owns one for its lifetime | tests/first-playable/server-administration.test.ts (test updated to pass a guard) |
| src/network/q1/netquake.ts | Module `WeakMap` of write codecs keyed by profile object | Three stateless codecs built once per protocol version | tests/network/q1/network.test.ts |
| src/bots/navigation/estimate-store.ts, estimates.ts, estimate-aas.ts (BOTS-005/007) | Four module `WeakMap`s (`incomingEdges`, `sharedTails`, `sharedCaches`, `edgeIndexes`) and a string-keyed LRU `Map` with a template string built per estimate query | One registry (`graphEstimateIndex`) holds all graph-derived state; `EstimateStore` is an LRU over `IdIndex` + `StringTable` (scope interned once), keyed by integers (goal, flags, tag); no per-query string | tests/bots/navigation estimate-sharing, estimates, estimate-adapter, checkpoint (22 pass) |
| src/app/bootstrap/application.ts | Dedicated frame-fault times were a reallocated array (`[...filter, now]`) | Fixed `Float64Array` ring of LIMIT+1 times; limit exceeded when the oldest of the last LIMIT+1 is inside the window (identical rule) | none dedicated (tests/network/remote-fault-containment.test.ts covers other fault paths); reasoned equivalence |
| src/content/q1/foundation (entity-services, spawns, weapons, types, checkpoint) | Module and instance `WeakMap`s keyed by `Q1PlayerState` (`protectSound`, `powerupCues`, `windFlySound`, `quadSoundAt`): a second store of player state; `powerupWarnings` also built a `Map` every frame per player | `Q1PlayerState.cues` (`Q1PlayerCues`) holds the gates; static warning table; cues excluded from checkpoints and rebuilt on restore as before | tests/gameplay/foundation/q1/foundation.test.ts, q1-addons items, ctf (37 pass) |
| src/content/q1/foundation/pickups.ts, addons/context.ts, base/*, weapons.ts | Exported `WeakSet`/`WeakMap` registries (`mg3Pickups`, `sourceNoMegaRot`, `sourceItemStart`) keyed by services object, written by the addon context | Fields on `Q1EntityServices` beside the existing `sourceDoorKeys`/`sourceGrenadeFix` flags | same q1 tests |
| src/content/q1/addons/monsters/ordinary/index.ts | `WeakMap<Q1AddonContext, Map<...>>` side store of monster controllers | `Q1AddonContext.ordinaryMonsters` | tests/gameplay/q1-addons/monsters (25 pass with movement test) |
| src/movement/q2/rerelease.ts | Per-usercmd `${flight}:${speed}` string key | Two numeric-keyed maps (walking/flying) per context | tests/movement/q2/movement.test.ts |
| src/render/scene/visibility.ts | Per-frame `${cluster}\|${second}` string key for merged PVS | Numeric pair key | tests/render/visibility.test.ts |

## Retained, with reason (no rework)

| File | Item | Reason |
| --- | --- | --- |
| src/bots/navigation/estimate-store.ts | One `WeakMap<edges, GraphEstimateIndex>` | Runtimes over copies of a graph (`{...graph}`) must share tails; the edge list identity is the only shared handle. Test enforces it. The `IdIndex` cursor from `begin()` is a small per-lookup object; the API has no reusable cursor |
| src/render/cpu/row-parallel.ts (RENDER-002) | Identity-to-wire-id `WeakMap`s, `#sentLevels` `Map`, string key for constant textures | Coordinator/worker registration protocol maps object identity to ids; it cannot be an integer index without an owner for the objects. The constant-texture key is a template string per constant bind and could become a numeric hash later |
| src/formats/q12-model/pose-lru.ts, src/world/collision/q1 (`brushCells`, `drawingByGeometry`), src/formats/images/jpeg.ts, src/compat/q2/rerelease/layouts.ts, src/movement/q2/math.ts | Identity-keyed derived memos of immutable inputs | Not state; die with their input. Left as-is |
| src/app/bootstrap/image-settings.ts, startup-selection.ts, q3-client/assets.ts, ui.ts, ui/hud/q2-native.ts | Cold-path memos (settings, catalog, menu, layout tokens) | Not hot paths; no foundation equivalent for their keys |
| src/audio/engine.ts line ~346 | Per-frame `.map/.filter` over seat loops (pre-existing shape) | Outside the audited diff; not changed |

## Noted for later (files owned by other agents, not touched)

- src/app/bootstrap/simulation/runtime.ts: `guestMonsterPlans = new Map<string, ...>` (string-keyed side store, line ~337); per-level `visited` maps are checkpoint state copies, acceptable.
- src/ui/common/legacy/runtime.ts: module `resourceKeys = new Map<string, string>()` string memo, and currently has unused imports failing typecheck (another agent's in-progress edit).
- remote-application.ts / remote-seat-view.ts do not exist; `src/app/bootstrap/network/remote-*.ts` were not reviewed in depth.
- Direct callbacks: `host.actors.onRelease(...)` in src/content/q1/addons/context.ts and `sourceBloodyNightmare`/`sourceItemStart` closures on the services object bypass the event ring; no ring event path exists for actor release today, so left.
