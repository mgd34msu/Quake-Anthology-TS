# T2C — Compatibility tests: tests/compat/q2/** and tests/compat/q3/**
## Coverage
Read in full, line by line (13 of 13 files, 2,424 lines): q2/classic/records.test.ts (74), services.test.ts (118), host.test.ts (224), world.test.ts (296); q2/rerelease/protection.test.ts (48), debug-shapes.test.ts (87), world.ts (94), services.test.ts (124), weapon-behavior.test.ts (155), monster-damage.test.ts (192), state.test.ts (248), native.test.ts (713); q3/native/fixture.ts (51).
Sampled from src, only to trace tests: compat/q2/rerelease/host.ts, weapon-behavior-profile.ts, app/bootstrap/simulation/classic-guest-files.ts, rerelease-guest-services.ts, runtime.ts (saves), original-save.ts.
Skipped: nothing in scope. tests/compat/q3/native/fixture.ts could not be run because the corpus has no quakelive/baseq3/bin.pk3.
Runs: every in-scope test file passes with the corpus at <game-data>. debug-shapes also passes with QUAKE_DEBUG_SHAPES_NATIVE=1. Mutations ran only in a scratchpad copy.
Candidates checked and dropped:
- Default 5 s timeout flake on host.test.ts:61. It measured 4.4 s alone and 5.8 s with 4 parallel runs, and it still passes, including with `--timeout 3000`. Bun does not fail it during the long synchronous segment.
- Assertions inside guest callbacks being swallowed. mod-composition.ts and authority.ts rethrow, and the callers check that the callback ran.
- Unawaited `mounts.close()` at host.test.ts:186. `close()` is synchronous.
- resourceIndex values at rerelease/services.test.ts:56-62. They match first-empty search and the reserved model index 255 (rerelease-guest-services.ts:56), so no wrong behavior is shown.
- Sync rerelease `writeSave` over budget as a production crash. See T2C-003. Production native saves use `writeSaveLoading`; the sync `checkpoint()` callers in original-save.ts do not select a native guest.
- Symlink containment at classic/services.test.ts:42-43. classic-guest-files.ts uses a contained parent plus O_NOFOLLOW, and it is sound.

## Strengths
- Retail tests inject a fixed clock (native.test.ts:124) and use `Bun.sleep(0)` only as a pump. native.test.ts ran 3 times under different importers plus once directly, with no flakes.
- Save and damage tests pin exact sequences and values (monster-damage.test.ts:107, :145; world.test.ts:288-292), and the combat comparison in world.test.ts:264-292 checks against the DLL's own results.
- Layout, declaration-rejection and travel-masking tests (records.test.ts, weapon-behavior.test.ts:63-88, host.test.ts:190-224) use specific error substrings and observe the masked state from inside the callback.

## Findings
### T2C-001 — Lifetime-replacement assertions pass when no replacement actor exists
- **Verification (VERIFY-N): confirmed. Final severity: Medium.** state.test.ts:87,:109,:132 use `?.generation` with `.not.toBe`, and :130-131 compare `?.id ?? null` with currentActor(). Adding `return null` after the lifetime release in host.ts actor() left state.test.ts at 10 pass.
- Severity: Medium
- Category: test-gap
- Location: tests/compat/q2/rerelease/state.test.ts:87, :109, :130-132
- Confidence: reproduced
- Evidence: `expect(first.raw.currentActor()?.generation).not.toBe(actor.id.generation);` When `currentActor()` is null the left side is `undefined`, which is "not" any number. :109 and :132 have the same shape. :130-131 use `?.id ?? null` with `.toBe(currentActor())`, which passes as null === null. Mutation: src/compat/q2/rerelease/host.ts `actor()` never rebinds a slot whose lifetime was replaced. state.test.ts stayed at 10 pass, and a probe printed `currentActor = null` at :87. records.test.ts:28 shows the sound form (`toBeGreaterThan`, which fails on undefined).
- Impact: The test titled "replace source lifetimes" (:63) and the corpus-free guard for slot reuse accept an entity that silently loses its actor. With the corpus, native.test.ts "retail projectile..." caught the same mutant. Without the corpus that test is skipped and nothing catches it.
- Remediation: Assert a non-null current actor first, then compare generations.

### T2C-002 — The only BoxEdicts test never returns plain Keep or Skip, and never fills the capacity
- **Verification (VERIFY-N): confirmed. Final severity: Medium.** state.test.ts:96,:99 use filters returning only 64 and 65. Mutant `if (outcome !== 0) break;` gave state 10, services 1, native 12 pass. Removing `count < maximum` gave state 10, services 1 pass (native not run for this one). grep finds BoxEdicts in no other test.
- Severity: Medium
- Category: test-gap
- Location: tests/compat/q2/rerelease/state.test.ts:90-101; src/compat/q2/rerelease/host.ts:386-391
- Confidence: reproduced
- Evidence: The title claims "return Keep/Skip/End", but filters return only 64 (Keep|End) and 65 (Skip|End), so the first candidate always ends the loop. Mutation of host.ts: `if ((outcome & 64) !== 0) break;` to `if (outcome !== 0) break;`, plus removal of the `count < maximum` guard. state, rerelease/services and native tests gave 23 pass, 0 fail. Grep finds no other test naming BoxEdicts. The `Q2 BoxEdicts filter cannot modify world links` path (host.ts:407, :434) also has no test (see Supplements).
- Impact: A regression that ends the search on Skip would drop radius-query victims. Removing the capacity guard writes guest pointers past the caller's list. Neither fails any test in this scope.
- Remediation: Add filters returning 0 and 1 across two candidates, and a nonzero capacity smaller than the candidate count.

### T2C-003 — Default retail runs save and restore only trivial maps; real-map JSON is 130 times larger and is exercised only by a debug env path that fails
- **Verification (VERIFY-N): confirmed. Final severity: Medium.** Reproduced: Q2_RR_SAVE_PROBE gives 1,672 bytes on the minimal map. With Q2_RR_FULL_MAP also set, the test fails with `GuestCallStopped: budget` at 20M after spawning 502 entities, and at a 200M budget it passes with 217,262 bytes. package.json does not set either variable. Production uses writeSaveLoading at runtime.ts:7997.
- Severity: Medium
- Category: test-gap
- Location: tests/compat/q2/rerelease/native.test.ts:130, :351-356, :367, :403-414; monster-damage.test.ts:69, :119, :129; protection.test.ts:15-22; src/compat/q2/rerelease/host.ts:286-291
- Confidence: reproduced
- Evidence: Every default retail spawn is a hand-written worldspawn plus 1-3 entities. `Q2_RR_FULL_MAP` and `Q2_RR_SAVE_PROBE` appear in no script. Measured: the save probe on the minimal map gives 1,672 bytes of level JSON, and on real base1 gives 217,262 bytes (502 entities). With both variables set the test fails: `GuestCallStopped: Guest call stopped: budget`. It fails at the fixture's 20M budget and at 40M, and passes at 200M. `if (fullMap) expect(...some(message => message.bytes.length > 0))` at :367 means the message assertion runs only in that gated mode. Tests also call the sync `writeSave`, while production uses `writeSaveLoading` (runtime.ts:7997).
- Impact: The native save size and instruction cost on a real level, and the restore of that JSON, are unmeasured in this directory. A passing "retail" result says nothing about a real map. Lines 403-414 are diagnostics in a mode that is red at HEAD.
- Remediation: Add a corpus test that spawns real base1 and round-trips it through `writeSaveLoading` and `readSave`. Delete the probe branch, or make it a real assertion.

### T2C-004 — A "retail" assertion checks the test fixture's stub message, not production behavior
- **Verification (VERIFY-N): confirmed. Final severity: Low.** Changing world.ts:17 fails native.test.ts:530 with `Received message: "The native map fixture STUB"`. Production text at rerelease-guest-services.ts:89 says "foreign actor ${slot}", which does not contain "foreign actors".
- Severity: Low
- Category: test-gap
- Location: tests/compat/q2/rerelease/native.test.ts:530; tests/compat/q2/rerelease/world.ts:17, :82; src/app/bootstrap/simulation/rerelease-guest-services.ts:89
- Confidence: reproduced
- Evidence: `...toThrow("foreign actors")` matches world.ts:17 `"The native map fixture has no foreign actors or combat transport"`, reached through host.ts:216 and `foreignAddress: unavailable`. Changing only that fixture string fails the test: `Expected substring: "foreign actors"`, `Received message: "The native map fixture STUB"`. Production's fallback text is `API2023 module requires a semantic projection extension for foreign actor ${actor.slot}`, which does not contain the substring, and no test names it.
- Impact: The assertion looks like coverage of foreign attackers on a native death callback, but it only proves that the stub throws. The production fallback throw is unpinned.
- Remediation: Use a fixture that supplies the production semantics, or assert only that the callback requested a foreign address.

### T2C-005 — Retail engine wiring is a hand-written copy of production, and it has drifted
- **Verification (VERIFY-N): confirmed. Final severity: Low.** world.ts:72 throws on a surface miss while production :103 matches by value and returns 0. world.ts:66 setSolid only unlinks. The fixture's spatial has no prepareLink (production :105,:243), and solid 0 is handled differently. RereleaseGuestServices appears in tests only at services.test.ts:12-33. T3-009 names other fixture families, not this set.
- Severity: Low
- Category: maintainability
- Location: tests/compat/q2/rerelease/world.ts:39-50, :66, :72-80; native.test.ts:319, :134; classic/services.test.ts:61-78; classic/world.test.ts:40-56; src/app/bootstrap/simulation/rerelease-guest-services.ts:103-105, :243-252
- Confidence: traced
- Evidence: native.test.ts:319's title says "use shared BSP, body and inventory authorities", but those are test-authored callbacks. Differences from production:
  - `surfaceId` throws on a miss at world.ts:72, while production matches by value and returns 0 (:103).
  - The fixture has no `prepareLink` (production :105, :243), and it links from `onLink` instead.
  - `setSolid` only unlinks (world.ts:66).
  - Zero-solid handling differs: `solid === 0 ? 0` contents in production, unlink in the fixture.
  - With the retail DLL, no test in this scope runs production `RereleaseGuestServices`; rerelease/services.test.ts uses authored bytes only. :134 asserts identity of what the fixture itself passed in.
  - T3-009 covers copied fixtures elsewhere and does not list this set.
- Impact: Link, contents and surface defects in the production adapter cannot fail these retail tests, and a fixture-only failure can look like a game defect. Application-level tests elsewhere remain the only retail check of that adapter.
- Remediation: Build the retail fixture on `RereleaseGuestServices` with `hostOptions`, and keep only recording hooks in the test.

### T2C-006 — Assertions and steps that survive removal of the behavior they name
- **Verification (VERIFY-N): confirmed-with-changes. Final severity: Low.** Reproduced: removing the equip loop left weapon-behavior at 5 pass; removing `host.runFrame(true)` (protection.test.ts:45) left 13 pass; removing ReadGame (host.test.ts:101) left 5 pass. weapon-behavior.test.ts:154 is the last statement. Correction: native.test.ts:711 can fail. `combat.read(actor.id)?.health` returns undefined if native slot reuse destroys the foreign actor's combat record, so it guards survival, not damage. Traced, not mutated.
- Severity: Low
- Category: test-gap
- Location: tests/compat/q2/rerelease/weapon-behavior.test.ts:99, :121, :140, :154; protection.test.ts:45-46; classic/host.test.ts:61, :101-102; rerelease/native.test.ts:711; native.test.ts:155-156
- Confidence: reproduced for the first three; traced for the rest
- Evidence:
  - weapon-behavior: the "executes authored callback sequences" test sets `equip` and `free` to bare `ret` functions, and `profile.free(projectile);` is the last statement with nothing after it. Mutating `equip` (the call loop) and `free` to no-ops gave 5 pass.
  - protection: title says "remains absolute across a frame". Making `host.runFrame` a no-op still passes, because nothing shows a frame ran or that level time advanced.
  - host.test: title says "source save IO". `ReadGame` as a no-op still passes; only `capacity` is read back, and ReadLevel is never called in that test.
  - native.test.ts:711: `expect(...health).toBe(100)` in the reuse test, where no damage is ever applied, so it cannot fail.
  - native.test.ts:155-156: `expect(fieldOffset(edictLayout, "sv.health")).not.toBe(fieldOffset(edictLayout, "s.origin"))` is near-tautological.
- Impact: These lines read as coverage for equip, free, time semantics and read-back, but they do not provide it. The classic read-back is covered by world.test.ts; the others are not covered in this scope.
- Remediation: Make the authored `equip` and `free` bytes observable. Assert time advanced across the frame. Damage the actor before :711, or remove the line.

### T2C-007 — The CTF half of the restore test pins a self-telefrag on a path production refuses
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** sv_ccmds.c:657-659 forbids deathmatch saves. original/ctf/p_client.c:1190 calls KillBox. The test comment is accurate about the source. Source review: SRCQ2
- Severity: Low
- Category: test-gap
- Location: tests/compat/q2/classic/world.test.ts:109, :151-159; src/app/bootstrap/simulation/runtime.ts:8009
- Confidence: traced
- Evidence: The comment reads `The original server forbids deathmatch saves. CTF's real Begin reinitializes this restored body and KillBox telefrags it; preserve that source behavior.` The test asserts `movement.type` 2 and "killed himself". Production throws `Native Quake II original saves require a non-deathmatch source game`. So this half of the loop runs a save a player cannot make, and its title says "restores".
- Impact: This costs 2.9 s and encodes a death as the expected restore result for an unreachable path, which could be read as approved behavior. The xatrix half is the only part matching a production save.
- Remediation: Replace it with an assertion that a deathmatch save is refused, or rename the test to state that it covers module-level API behavior only.

### T2C-008 — tests/compat/q3 holds no tests: an orphan fixture with a debug main
- **Verification (VERIFY-N): confirmed. Final severity: Low.** QuakeLiveGameModule and QuakeLiveGameImports appear only in src/compat/q3/native and tests/compat/q3/native/fixture.ts, which has no `test(` and nothing imports nativeGameFixture. src/compat/q3/native totals 235 lines. `find qfiles -iname bin.pk3` returns nothing, and fixtures.ts:9 needs quakelive/baseq3/bin.pk3.
- Severity: Low
- Category: dead-code
- Location: tests/compat/q3/native/fixture.ts:12, :41-51; src/compat/q3/native/*
- Confidence: traced
- Evidence: Grep finds no importer of `nativeGameFixture`, and this file is the only user of `QuakeLiveGameModule` and `QuakeLiveGameImports` outside src/compat/q3/native. The `if (import.meta.main)` block prints registers. The data it needs (quakelive/baseq3/bin.pk3) is absent from the corpus. GUEST.md already records the src as unreachable from production; this finding adds that the 235 lines have no test execution at all, and the directory name implies coverage.
- Impact: The Quake Live native import table cannot fail any test.
- Remediation: Delete the fixture along with the dead src, or add a corpus-gated test that uses it.

## Supplements
- Supplements TESTS-003: tests/compat/q2/rerelease/services.test.ts:16 is unguarded and needs corpus base1 through world.ts:20. Without a corpus it fails in 4 ms: `ENOENT ... 'q2/rerelease/baseq2/pak0.pak'`. Its "authored" module needs only BSP geometry.
- Supplements TESTS-005: classic host, services and world tests guard with raw `${testCorpusRoot()}/q2/...` rather than `corpusFile`, so the Steam layout that corpus.ts documents silently skips all classic DLL tests. `new URL(path, "file:///")` in native.test.ts:45 and protection.test.ts:8 also reports false for a corpus path containing `#` (reproduced; a path with a space works).
- Supplements TESTS-007: debug-shapes.test.ts:12, :48 are gated by `QUAKE_DEBUG_SHAPES_NATIVE`, which no script sets. Both pass when enabled and need only the corpus, so the gate only hides them.
- Supplements T3-001: debug-shapes, monster-damage and protection run the native suite again; debug-shapes reports 14 tests, 12 of them imported.
- Supplements T3-005: rerelease/services.test.ts:16-124 is one test of over 100 lines covering configstring indexing, attachments, clip, frozen layouts, Info imports and messaging. The first failure hides the rest.
- Supplements DOCS3-007: the `filterDepth` throw at host.ts:407, :434 has no test in the repo (grep), so neither its intent nor its reachability is pinned.
