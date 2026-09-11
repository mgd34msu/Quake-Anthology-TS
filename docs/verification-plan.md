# Verification and completion plan

This planning document defines completion evidence for the unified Bun TypeScript engine. It includes all games, expansions, singleplayer, multiplayer, inherited modes, and declared cross-game combinations. It introduces no implementation or completed verification claim. The separate machine work graph is the dependency authority. [Source assessment](source-assessment.md) records the source and binary inventory behind these requirements.

Completion means playable behavior on the final Linux executable, with traceable source fidelity and complete required-case accounting. Compilation, registered classnames, successful boots, and unchanged residual counts provide useful evidence but do not establish that outcome.

## Baselines and inherited evidence

Expectation sources have an explicit order. The user's declared behavior governs intentional extensions and cross-game combinations. For faithful classic and rerelease behavior, the applicable original source and observable retail behavior define the contract together. The fixture records its edition, revision, settings, and execution conditions. A disagreement between source and observation requires investigation and a documented disposition rather than an automatic choice of whichever output already passes.

Existing TypeScript ports are implementations under examination, not golden oracles. Q1 and Q2 quality is suspect, so matching their outputs cannot establish correctness. Q3 is the preferred verification foundation because its evidence machinery is stronger, but its assertions, fixtures, and runtime behavior still require independent verification. Preserve useful drivers while reviewing where each expected value came from.

Every parity expectation identifies its independent source: original code semantics, a controlled retail/reference observation, or an explicit project behavior contract. Shared helpers and two endpoints from the same TypeScript engine do not provide independent corroboration. Existing snapshots and residual tables may detect change; they cannot freeze accidental bugs into intended behavior. Triage disagreements before accepting a new baseline, retaining the competing observations and the reason for the decision.

The read-only audit inspected these port HEADs. Baseline capture must additionally hash dirty files, original-source trees, fixtures, and reference executables.

| Port | Inspected HEAD |
| --- | --- |
| Quake 1 rerelease | `6bc6a8bf29b66981e3b6ce7251ebbc6413120270` |
| Quake 2 rerelease | `0d73750cbe5683c7411934d0a5d4eb5acd4da676` |
| Quake 3 | `8453c49824eb7a5ed5aee452f74e19336965d1f8` |

The existing drivers are starting material with specific limitations:

- [Q1 sweep](../../quake-1-re-ts/test/support/sweep_lib.ts) boots each map under its own progs. [Its wrapper](../../quake-1-re-ts/scripts/sweep.sh) excludes rerelease trees by default. Neither establishes all cross-game permutations.
- [Q1 multiplayer manifests](../../quake-1-re-ts/test/e2e/t_manifest.json) already exercise selected protocols, coop, deathmatch, QuakeWorld, and demos. Preserve these obligations. [The cross-protocol driver](../../quake-1-re-ts/test/e2e/t_cross.ts) can count a busy-port skip as a passing check. Required release cases must instead remain unexecuted until rerun successfully.
- [Q2 map sweep](../../quake-2-re-ts/test/parity_map_sweep.test.ts) covers 222 maps under classic and kex modules for 100 headless coop frames, using constant randomness. Its `RESIDUAL_BASELINE` explicitly records unresolved differences. Each applicable residual needs a source-backed disposition or correction.
- [Q2 spawn coverage](../../quake-2-re-ts/test/g_spawn_rerelease_coverage.test.ts) exempts deathball entities and `weapon_grapple` from classic-module coverage because shipped singleplayer maps do not require them. Full multiplayer and cross-ruleset scope requires explicit behavior coverage. The rerelease [spawn table](../../quake-2-re-ts/src/kexgame/g_spawn.ts) registers deathball entities.
- [Q2 splitscreen tests](../../quake-2-re-ts/test/splitscreen.test.ts) explicitly supersede the former exclusion of local rendering. Preserve current seat behavior rather than stale scope prose.
- [Q3 check](../../quake-3-ts/tools/check.ts) captures an owned snapshot, detects drift, requires both retail products, and labels portable verification incomplete. Reuse this evidence model. [Q3 source coverage](../../quake-3-ts/tools/update-coverage.ts) checks mappings and evidence-file existence, which does not prove behavior.
- [Q3 mode verification](../../quake-3-ts/tools/verify-game-modes.ts) excludes bot integration and directly invokes some contacts. Add actual input, collision, networking, and bot objectives. Its [parity punch list](../../quake-3-ts/docs/PARITY_PUNCH_LIST.md) records further bounded evidence and open obligations.

Q1 and Q2 regex-based type checks are insufficient for the unified no-`any`, no-cast requirement. Adapt [Q3's AST/type policy](../../quake-3-ts/tools/type-policy.ts) across implementation, tests, and tools. Check implicit escapes, assertions, non-null assertions, unchecked declarations, and native implementation loading. Preserve reviewed native SDL2 and OpenGL boundaries and embedded GLSL conventions. Guest game code must execute through TypeScript.

## Exact configuration coverage

A versioned fixture manifest enumerates official products, editions, expansions, maps, assets, players, movement profiles, weapons, rulesets, modes, protocols, seats, and render backends. Content identity includes archive hash, member path, edition, and mount order. Equal map names do not imply equal content. Discovery cannot silently shrink the expected manifest when an archive is missing.

Generate the full declared configuration product with stable case IDs. Each cell carries executable expectations for loading, spawning, control, and its required gameplay outcomes. Foreign objective maps require explicit objective placement and spawn behavior. Foreign weapons require defined ammo, animation, damage, and pickup behavior. A missing adapter remains incomplete work rather than an excluded cell.

Official content and the declared mix dimensions are finite. Input sequences, network histories, floating-point states, and future mods form an effectively unbounded behavioral domain. Report these separately. Enumerate known objectives and branches, then supplement them with seeded generators, boundary cases, and invariants. Pairwise runs help development but cannot close the full product. Boot counts cannot establish campaign completion. Release evidence states the exact executed domain without claiming every possible play history.

## Required gameplay outcomes

| Area | Completion evidence |
| --- | --- |
| Campaigns | Every campaign reaches its ending through actual objectives and exits. Cover hub revisits, alternate routes with gameplay effects, secrets, bosses, keys, inventory, runes, monster and mover state, checkpoints, death/retry, and coop joins/leaves. Q3 includes tiers, unlocks, awards, and arena progression. Direct map commands only establish loader coverage. |
| Movement and collision | Source-differential traces for each movement profile cover steps, slides, corners, slopes, water, ladders, crouch hulls, rotating/moving brushes, platforms, teleports, knockback, and spawn occupancy. Exercise command timestamps, tick subdivision, clamping, wraparound, prediction replay, integer truncation, and source-specific numeric precision. |
| Weapons, damage, and items | Every weapon fires, switches, consumes ammo, impacts, and produces its required effects. Cover armor, resistance, splash, self-damage, friendly fire, scoring, pickups, drops, respawn timers, simultaneous contacts, and death ordering. Preserve deliberate classic/rerelease differences. |
| Multiplayer | Complete coop progression and competitive matches through distinct actual clients on dedicated and listen servers. Cover inherited discovery, admission, downloads, snapshots, reliable commands, reconnect, spectators, team changes, votes, intermission, restart, map rotation, and shutdown. Apply deterministic loss, latency, duplication, and reordering schedules. |
| Bots and seats | Bots traverse actual maps and complete every inherited objective, including team orders, role changes, blocked routes, and respawns. Exercise supported seat counts, controller routing, separate views/HUDs, private messages/audio, and mixed local/remote sessions. |
| Saves and replays | Compare uninterrupted play with save, process exit, fresh load, and continuation. Include world/hub state, callbacks, RNG, identity, and inventory. Record/replay input, network, and timing traces and compare authoritative states. Verify inherited demo formats and timedemo behavior. |

Self-play verifies the engine's two endpoints together. Wire-compatibility claims additionally require independent reference peers or source-derived packet oracles. Malformed packets must produce the specified recovery or rejection without corrupting the following session.

## Guest execution and mod behavior

The supplied binary corpus includes PE32 i386 with x87 behavior, PE32+ x64 with SSE, TLS, and MSVC runtime dependencies, and ELF32/ELF64 modules. Each fixture records its hash, architecture, loader needs, imports, relocations, entry points, and expected host callbacks. Missing fixture dependencies remain blockers for the corresponding required module.

All guest instructions and game-module logic execute through TypeScript. Qualification must trace instruction execution to imported engine calls and visible gameplay, including startup, exports, callbacks, shutdown, and unload/reload. A parsed executable or resolved export table is insufficient. Native guest execution, host emulators, and pretranslated replacement logic cannot satisfy the TypeScript guest-execution gate.

Differential cases cover integer flags, shifts, calling conventions, stack layout, pointer widths, memory access, x87 stack/control/rounding behavior, SSE scalar/vector semantics, relocations, TLS initialization, and required MSVC runtime behavior. ELF cases cover their actual imports and relocation/lifecycle requirements. Compare with authoritative references where available and retain exact divergence traces.

Each required guest module must support real campaign progression or complete matches through the engine. Test save/load callbacks, entity lifecycle, networking, cross-game services, and repeated module switches. Measure guest instruction cost and host-call overhead during representative gameplay, including demanding maps. Opcode microbenchmarks alone cannot establish playability.

QuakeC and QVM qualification covers supplied opcode, builtin, and trap behavior alongside real mods. Corrupt programs, archives, saves, and unsupported imports need reproducible diagnostics and source-appropriate recovery. Keep source undefined behavior distinct from specified behavior and project replacements. Future arbitrary mods remain outside any claim of exhaustive executed coverage.

## Linux rendering and measured performance

The software renderer must rasterize actual scenes on the CPU and present through SDL2. The OpenGL backend must submit actual GPU work and present through SDL2. Verify both against real animated gameplay and all declared material/model formats. CPU/GL agreement alone can preserve a shared defect.

Capture original-reference camera, viewport, clocks, cvars, gamma, lighting, resource hashes, and backend details. [Q3's render driver](../../quake-3-ts/tools/verify-render.ts) provides images and descriptive metrics, not a completed parity threshold. Set justified per-feature tolerances and inspect mismatches. Exercise menus, input, audio, controllers, resize/fullscreen, renderer/product switching, reconnect, recovery, and normal exit on the compiled Linux artifact. Label private-display and offscreen evidence with the actual driver and GPU. Dedicated servers must run without a display.

P0 records CPU, GPU, driver, display resolution, Bun version, thermal/power conditions, and reference workloads. Measure original and candidate performance using fixed paths, warmed assets, frame-time distributions, load time, memory, guest execution, and host-call overhead. P0 then records explicit proposed targets and their justification. Targets remain proposals until adopted in the project acceptance contract. No arbitrary FPS or latency number is user-approved by this plan. Unresolved targets cannot support a release performance claim.

## Runner, evidence, and release accounting

Owned snapshots isolate code, data mounts, home directories, ports, displays, and outputs. Deterministic shards derive from manifest IDs and pinned seeds. Resume only cases whose source, fixture, environment, and executable fingerprints still match. Preserve all attempts, including retries after resource conflicts.

Every record includes schema version, case/configuration ID, expected contract, source/reference/content hashes, snapshot and binary hashes, platform/runtime/library details, seed, clock/network schedule hashes, command/environment, timestamps, exit/timeout status, checkpoints, assertion count, tolerances, and artifact hashes. Reference comparisons retain their inputs and raw outputs.

Statuses are `PASS`, `FAIL`, `BLOCKED_MISSING_INPUT`, `TIMEOUT`, and `NOT_RUN`. Only `PASS` satisfies required release rows. Reject duplicate IDs, missing terminal records, zero-assertion success, unexpected skips, stale binaries, and absent fixtures. The final report reconciles actual records against the expected manifest, including combinations that failed before launch.

The following commands are future interface contracts, not existing runnable tools:

```bash
bun run verify --profile dev --changed
bun run verify --profile integration --manifest verification/fixtures.json
bun run verify --profile full --shard 0/16 --resume
bun run verify --profile release --executable dist/quake-typescript
```

Development runs select relevant policy, component, and interaction checks. Integration runs add source comparisons and actual subsystem joins. Full runs execute every declared configuration and mandatory behavioral suite across deterministic shards. Release runs reconcile the complete evidence set and drive the exact final compiled executable through Linux gameplay and recovery.

The machine work graph assigns exclusive owners to catalogue, runner, gameplay, guests, rendering, and release evidence. Independent review and combined verification close release. Remaining parity residuals, missing fixtures, unexecuted required configurations, guest progression failures, or unmet performance targets remain explicit completion blockers.
