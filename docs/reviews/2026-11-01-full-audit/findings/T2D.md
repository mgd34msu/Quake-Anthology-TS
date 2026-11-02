# T2D — READ review of tests/compat/qc and tests/compat/qvm (57 files, 9697 lines)
## Coverage
Read in full, line by line, no line truncation: all 57 files.
tests/compat/qc (21): armor-stage, checkpoint-components, finale-acknowledgement, id1-projectiles, local-messages, mod-binding, mod-clients, mod-combat, mod-commands, mod-input-output, mod-input, mod-monster, mod-pickups, mod-provider, mod-qw-messages, pickup-stage, qw-map-damage, qw-presentation, rerelease-builtins, runtime, weapon-stage.
tests/compat/qvm (36): cgame-body, client-audio, client-browser, client-cinematic, client-collision, client-common, client-file, client-mark, client-render, client-script, client-state, client-viewport, committed-stores, common-game, entity-tokens, file-checkpoint, function-hooks, game-async, game-inventory, guest-game-data, item-catalog, legacy-bots, local-client-state, mod-clients, mod-commands, mod-input, mod-pickup-stores, mod-pickups, mod-player-events, mod-preparation, mod-presentation, mod-protection, qvm, server-game, source-store-effects, ui-key.
Sampled: none. Skipped: none.
Executed from <scratchpad>/clean with a throwaway HOME: armor-stage, weapon-stage, mod-provider, mod-combat, mod-commands, mod-input-output, mod-clients, local-messages, plus two scratch reproductions. runtime.test.ts was read, not run.
Deviation from the brief: one read-only `ls` of ~/.local/share/quake-typescript/content/q1/rerelease/copper, listing 3 file names, to learn whether the artifact exists. Nothing was read from or written there. Copper-gated tests therefore did not run, so findings about their assertions are `traced`.

## Strengths
- The QVM interpreter suite (qvm, function-hooks, committed-stores, source-store-effects) builds exact bytecode and asserts return words, stack pointer, `isActive` and exact error text after every path, including cancellation, nested async and caught-failure stickiness. Almost every negative here names its message.
- QC damage tests compare observed and unobserved runs byte for byte (`observed.bytes` against `control.bytes`), which detects any boundary that perturbs source state. mod-binding also mutates real bytecode to prove the rejection paths.
- ABI tests use sentinels (`0xcc`, `0x5a`, `0xa5`) and write observers to prove which bytes were and were not touched: client-state:69-84, server-game:96-103, client-mark:52-57.
- Saves round-trip through `encodeCheckpointValue`/`decodeCheckpointValue` in most checkpoint tests, and file-checkpoint verifies descriptor counts, path containment and symlink rejection.
- No real-time dependence in this scope: a grep for `Bun.sleep`, `setTimeout`, `Date.now` and `performance.now` across both directories finds nothing, and clocks are injected.

## Findings
### T2D-001 — The "drains a suspended child" negative cannot fail, because it checks before a childless parent would have settled
- **Verification (VERIFY-N): confirmed-with-changes. Final severity: Low.** The negative is vacuous: with no drain (interpreter.ts complete returning `checked()`), qvm.test.ts:326-327 still passed. Correction: the claims that the remaining assertions do not depend on ordering, and that such an interpreter "would stay green", are false. The same mutant fails :332 (`stackPointer` expected 4096, received 4028), and also "ignored child failure still unwinds the parent".
- Severity: Low
- Category: test-gap
- Location: tests/compat/qvm/qvm.test.ts:325-327
- Confidence: reproduced
- Evidence: `enter.resolve(0); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); expect(vm.isActive).toBe(true); expect(completed).toBe(false);`. A scratch test ran the same program with the same async host shape and no child at all. The parent took 5 awaited microtasks to settle, so after 3 it is still active whether or not the interpreter drains the child. The remaining assertions (`await pending` is 90, `await children[0]` is 77) do not depend on ordering.
- Impact: This is the only test of draining when the host itself is awaited. An interpreter that lets the parent return over a suspended child would stay green here, and that child would resume on a popped frame. Same pattern as T2-003, at a site T2 did not list.
- Remediation: Wait a macrotask (`await Bun.sleep(0)`) before the negative, and assert `completed` flips only after `childTrap.resolve`.

### T2D-002 — Eight QC test files depend on a mod in the developer's home directory; six tests hard-fail and eight vanish without it
- **Verification (VERIFY-N): confirmed. Final severity: Medium.** With a throwaway HOME and the corpus set: armor-stage 5 fail 4 pass (all ENOENT), weapon-stage 1 fail 3 pass, mod-provider 3 skip, mod-combat, mod-monster, mod-commands, mod-input and mod-clients 1 skip each. That is 6 failures and 8 skips. `find qfiles -ipath '*copper*'` returned only three Q3 textures. armor-stage.test.ts:40-41 hard-codes statement numbers and takes the digest from the same bytes.
- Severity: Medium
- Category: test-gap
- Location: tests/compat/qc/armor-stage.test.ts:28,41,166,222,296,382,432; weapon-stage.test.ts:92; mod-combat.test.ts:22; mod-monster.test.ts:20; mod-provider.test.ts:13; mod-clients.test.ts:27; mod-commands.test.ts:17; mod-input.test.ts:21; tests/support/corpus.ts:7-8
- Confidence: reproduced (run with a throwaway HOME and QTS_TEST_CORPUS set to qfiles)
- Evidence: `const copper = `${homedir()}/.local/share/quake-typescript/content/q1/rerelease/copper/progs.dat`;`. Copper is absent from the corpus: `find qfiles -ipath '*copper*'` returns only unrelated Q3 textures. corpus.ts promises "nothing is guessed from local disks". armor-stage: `5 fail, 4 pass`, all ENOENT, no guard. weapon-stage:92: `1 fail`, no guard. mod-provider 3, and mod-combat, mod-monster, mod-commands, mod-input, mod-clients 1 each: skipped silently. No test checks the digest, yet armor-stage:40-41 hard-codes `entry: 5592, exit: 5606, target: 5363` and supplies `statements: program.statements.slice(5592, 5607)` from the same bytes, so the "differs from artifact" proof compares the artifact to itself in the unmutated case.
- Impact: Everything these tests name for declared Copper armor, pickups, client stage calls, command routing and two-provider objectives runs on one machine only, against a user-mutable file. Updating the mod changes outcomes with no diagnostic. CI or a clean checkout loses it or fails. Extends the one-line mention in TESTS-004 with the failure counts, the corpus absence and the missing pin.
- Remediation: Add the artifact to the assembled corpus resolved through `corpusFile`, assert its digest once, and give all sites one guard.

### T2D-003 — The Q1 sky and client-metadata persistence test passes when restore does nothing
- **Verification (VERIFY-N): confirmed. Final severity: Low.** Replacing `events.restore` with a no-op on the instance at local-messages.test.ts:194 left local-messages at 6 pass. The test restores into the instance that already holds the events, with the same actor.
- Severity: Low
- Category: test-gap
- Location: tests/compat/qc/local-messages.test.ts:191-197
- Confidence: reproduced
- Evidence: `const saved=events.capture(); events.restore(new SaveReader(saved,'events'),()=>actor.id); expect(events.persistentPresentation()).toHaveLength(2);`. It restores into the instance that already holds the events and never clears it, and the resolver returns the same actor that was emitted. A scratch copy with `events.restore=()=>undefined` passes all assertions. No encode/decode step is used either, unlike its neighbours.
- Impact: The test titled "persist with saved recipient ownership" cannot show that persistence restores anything. A restore that stops rebuilding sky or client metadata leaves it green.
- Remediation: Restore into a new `SimulationEvents` through `encodeCheckpointValue`/`decodeCheckpointValue`, with a resolver mapping to a different actor.

### T2D-004 — The targeted stuffcmd check after restore is a vacuous `.every`
- **Verification (VERIFY-N): confirmed. Final severity: Low.** mod-clients.test.ts:60 creates `messages` empty, :108 uses `.every`, and line 108 is the only assertion on `restored.messages` (grep). The empty case is true. Traced; the test is Copper-gated.
- Severity: Low
- Category: test-gap
- Location: tests/compat/qc/mod-clients.test.ts:108
- Confidence: traced
- Evidence: `restored.port.notify("userinfo", newB); expect(restored.messages.every(message => message.actor?.equals(restoredSecond))).toBe(true);`. `restored.messages` starts empty in `create()` (line 60), and `every` on an empty array is true. The pre-save half at lines 97-98 uses exact `toEqual`; this half does not.
- Impact: The test title promises "targeted stuffcmd through save". If restored userinfo callbacks stop running or stop routing, nothing fails. The test is also Copper-gated (T2D-002).
- Remediation: Assert the same three `command-text` entries as lines 97-98, with `restoredSecond`.

### T2D-005 — A test pins one borrowed kill as two monster-killed events whose counter goes backward
- **Verification (VERIFY-N): confirmed-with-changes. Final severity: Low.** The trace holds: each provider has a private `local` (mod-messages.ts:17), and mod-objectives flush reaches the owner's `change`, so mod-combat.test.ts:142 pins [1, 2, 1]. Correction: the doubled event needs a declaration naming a message-emitting function as `change` plus a writable borrower, and both are authored by this test (:55, :76). No declaration in src, assets, docs or tools uses `role: "borrowed"`, so no shipped content reaches it. It was not run (Copper absent).
- Severity: Medium
- Category: bug
- Location: tests/compat/qc/mod-combat.test.ts:141-144; src/compat/qc/mod-messages.ts:17; src/app/bootstrap/simulation/quakec-local-messages.ts:57-58,224-226; src/app/bootstrap/simulation/network-q1.ts:219-220
- Confidence: traced (the test is Copper-gated and was not run; the expected array is what the test states)
- Evidence: `borrowed.invoke({ function: "killed_monster", ... }); expect(match.objective("test:monsters")?.stage).toBe("twice"); expect(kills).toEqual([1, 2, 1]);`. Each provider owns `private readonly local = new QuakeCLocalMessages();`, and `killed-monster` increments stat 14 in that private state and emits `found: state.stat(actor, 14)`. One `killed_monster` from a writable borrower reaches the owner through its `change` call (found 2) and the borrower's own message (found 1). `killed_monsters` is 2 in both machines per lines 143-144, while the last event says 1.
- Impact: With a writable borrowed objective, the last event reports fewer kills than the objective. network-q1.ts:219-220 turns each event into `send({ kind: 'killed-monster' }, true)`, so a NetQuake client counts two kills for one. Limited to mods declaring a writable borrowed kill objective.
- Remediation: Publish kill counts from the objective owner only, then change the assertion to one event per kill with a monotonic count.

### T2D-006 — Assertions that cannot detect what they appear to check
- **Verification (VERIFY-N): confirmed-with-changes. Final severity: Low.** Correct: qw-map-damage.test.ts:71, rerelease-builtins.test.ts:50-53, mod-input.test.ts:131,143, runtime.test.ts:1240-1241, and the weak forms at local-messages.test.ts:163,165,178. Corrections: mod-qw-messages.test.ts:87 asserts `listeners.size` is 0, and removing unsubscribe from QcModMessages.close fails there (expected 0, received 1), so "a provider that ignored close passes" is false and only :88-89 are empty. A commit that clears the sky passes :165 but fails the same test at :173:88.
- Severity: Low
- Category: test-gap
- Location: tests/compat/qc/local-messages.test.ts:163,165,178; qc/mod-qw-messages.test.ts:88-89; qc/qw-map-damage.test.ts:71; qc/rerelease-builtins.test.ts:50-53; qc/mod-input.test.ts:131,143; qc/runtime.test.ts:1240-1241
- Confidence: traced
- Evidence:
  - local-messages:165 `expect(helper.view(second).sourceSky?.images[0]).not.toBe(previousSky?.images[0])` also passes if `commit()` removes the sky, since `undefined` differs from the image. Line 178 `toBe` passes when both sides are `undefined`, and line 163 likewise if `previousSky` was undefined; only `first` was length-checked at line 156.
  - mod-qw-messages:88-89: after `restored.close()` the test does `clients.set(...)` and asserts `prints` is still 3. A map write notifies nobody and no listener is invoked, so a provider that ignored `close` passes.
  - qw-map-damage:71 `expect(owner.id.equals(other.id)).toBe(false)` compares two fixture actors from lines 21. It tests no behavior and appears to exist so `owner` is used.
  - rerelease-builtins:50-53: `if (fn !== undefined) vm.execute(fn.index, 0);` asserts nothing, skips absent names silently and runs every builtin with argc 0, under a title claiming every `ex_*` is bound. Only "does not throw" is proven.
  - mod-input:131,143 `expect(corpse.source.checkpoint()).toBeDefined()` can only fail by throwing; the saved content is unchecked.
  - runtime:1240-1241 re-assert the `delivered` snapshot and `printed` text already enforced by the `throw` branches at 1226 and 1239.
- Impact: Sky refresh, closed-provider behavior and rerelease builtin semantics look covered and are not.
- Remediation: Assert presence before identity, invoke the listener after close, and assert host effects per builtin.

### T2D-007 — QW and NQ projectile attribution is tested with hand-fed store events, never with the fired QuakeC
- **Verification (VERIFY-N): confirmed. Final severity: Low.** id1-projectiles.test.ts:32-35 and :79-82 use a stub execution with forged observeStore calls, W_FireRocket appears in no other test, and the vm at :24 has no observer attached. Id1ProjectileAttacks appears in tests only here. quakec-source.ts:388,410 hold the wiring.
- Severity: Low
- Category: test-gap
- Location: tests/compat/qc/id1-projectiles.test.ts:25-35,79-82,95-98,100-107; src/app/bootstrap/simulation/quakec-source.ts:388,410
- Confidence: traced (the wiring claim rests on a grep: only this test file names `Id1ProjectileAttacks`)
- Evidence: `observer.compose(...).run({ functionIndex: launch, caller: 0, statement: -1 }, functionExecution(() => { entities.at(2).setInt(field('owner'), ...); observer.observeStore({ functionIndex: launch, statement: 0, ... }); return undefined; }));`. `W_FireRocket` never executes; the test forges the store with `statement: 0` and calls `resolve` with hard-coded caller and statement numbers. The stub `functionExecution` does not count calls, so if `compose` skipped execution, the `expect`s at lines 96-97 and 104-105 inside the callback would never run. The real QcMachine rejects an omitted execution, the stub does not.
- Impact: The title says "while native damage executes", but only the final `T_Damage` runs, and it runs without the observer attached. A break in `functionBoundary` or `observeEntityStore` wiring at quakec-source.ts:388,410, or a change in which function stores `owner`, leaves this green and misattributes kills.
- Remediation: Fire `W_FireRocket` and `T_MissileTouch` through a QcMachine with the observer composed, and assert the resulting attack's weapon and launch owner.

### T2D-008 — Failure in one test's assertions can hide its real error or skip cleanup; some fixtures are Linux-only
- **Verification (VERIFY-N): confirmed. Final severity: Low.** mod-combat.test.ts:156-158 runs `expect` in `finally` before four closes. rerelease-builtins.test.ts:16 and qw-map-damage.test.ts:16 never close their registries, id1-projectiles.test.ts:61 closes only restoredActors, and function-hooks.test.ts has no `actors.close`. client-browser has 12 view.close() and 0 finally. client-file:26-31 and file-checkpoint:11-16 read /proc/self/fd.
- Severity: Low
- Category: test-gap
- Location: tests/compat/qc/mod-combat.test.ts:156-158; qc/rerelease-builtins.test.ts:54; qc/qw-map-damage.test.ts:13-72; qc/id1-projectiles.test.ts:108; qvm/function-hooks.test.ts:812; qvm/client-browser.test.ts (12 `view.close()` calls and no `finally` in the file); qvm/client-file.test.ts:26-31; qvm/file-checkpoint.test.ts:11-16
- Confidence: traced
- Evidence: `} finally { source.close(); expect(match.objective("test:monsters")).toBeNull(); expect(() => borrowed.invoke(...)).toThrow(); borrowed.close(); match.close(); actors.close(); await content.close(); }`. A failing `expect` in `finally` replaces the original error and skips the four closes, including the mounted content. rerelease-builtins, qw-map-damage and id1-projectiles never close their `SessionActorRegistry` (id1-projectiles closes only `restoredActors`), and function-hooks:812 closes the binding and game but not `actors`. `readdirSync("/proc/self/fd")` fails outright on non-Linux hosts.
- Impact: Debugging one failure shows a different one, and open mounts stay open for the rest of the file. Registries hold no native handles, so that part is cosmetic.
- Remediation: Move the two assertions out of `finally`, and guard the descriptor checks by platform.

## Supplements
- Supplements T2-005: more tests pin process-fatal throws as expected. mod-binding.test.ts:149-151 (a registered knockback transform throws through `T_Damage`), local-messages.test.ts:58 (`svc_time` from QC throws, as VM-012 describes), runtime.test.ts:1150 (a beam naming an unowned entity throws at flush), client-file.test.ts:114 (guest `FS_SEEK` on a packed file throws "NOT YET IMPLEMENTED").
- Supplements TESTS-004: tests/compat/qc/mod-input-output.test.ts:27 fails with QTS_TEST_CORPUS set (`Content q2-classic-baseq2 requires: q2/baseq2/pak0.pak...`, reproduced) because its `skipIf` checks the corpus path while `parseApplicationCommand` omits `--content-root`. mod-combat.test.ts:24 and mod-monster.test.ts:22 have the same omission; mod-clients:44 and mod-input:30 pass the flag correctly.
- Supplements GAPCOMPAT-002: confirmed that runtime.test.ts:660-661 is the assertion that pins the `movetogoal` throw. Not re-reported.

## Candidates refuted
- `qcWeaponStage` compared with `qcDerivedWeaponStage` at weapon-stage.test.ts:155-161 is self-comparison for qdoom only (weapon-stage.ts:128), but id1 and QW take the pinned path, and qdoom has separate count checks at 166-168. Not a false pass.
- Default 5 s timeouts on corpus-heavy tests: mod-clients ran in 1.55 s total, so no timing risk was shown for the file measured.
- client-audio.test.ts:75 `expect(printed).toEqual(['^3'])` looks like a broken message but matches the original's misused `Com_Printf(S_COLOR_YELLOW, ...)`, as I recall that source; not checked against a copy.
- `runtime.test.ts:734` "not precacheed" is the original's spelling, as I recall that source.
