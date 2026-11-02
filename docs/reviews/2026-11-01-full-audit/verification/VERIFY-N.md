# VERIFY-N — verification of T2B, T2C and T2D at HEAD fcdc8af5

Method: opened the cited code at HEAD (src matches clean/ by `diff -rq`; the only tests/ differences are first-playable output artifacts) and tried to falsify each claim. Mutants ran in a private copy, <scratchpad>/verifyN/mut, through verifyN/m.py, which restores each file afterward. The copy matched clean/ on src and tests/compat afterward. No server was run: T2B-001 was checked by a component reproduction and by reading the path. "### Candidates tested and refuted" in T2B.md is a section heading, not an ID. Copper-gated tests could not run because the mod is absent, so claims about their assertions are traced.

### T2B-001
Verdict: confirmed
Corrected severity: Medium
Reason: demo-commands.ts:141 exempts only q2 from the dedicated return, and :40-41 always throws. A component test with `dedicated: true` showed `playdemo`, `demo`, `demos`, `stopdemo` and `startdemos` are silent, while `demomap foo` rejects from `executeAsync` under q1-netquake, q2-classic and q3. application.ts:4522 has no enclosing try (the try blocks in step close by :4506), run() at :4693 has none, and main.ts catches only to return 1. End-to-end exit was not re-run. prepared-startup.test.ts:46 omits demomap.

### T2B-002
Verdict: confirmed
Corrected severity: Medium
Reason: Re-ran all three mutants of network-unified.ts. (a) `event.client < 0` left unified-host 1 pass, unified-events 1 pass and unified/server 7 pass. (b) missionpack-player `return false` and (c) addon `? false` left unified-host and unified-events at 1 pass each. No test names createUnifiedApplicationServerHost (only application.ts:1822,2849 call it).

### T2B-003
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The assertion cannot fail: deleting prepared-startup.ts:223 left prepared-startup at 23 pass and prepared-client-commands at 9 pass. Correction: the stated impact is overstated. allowCommand (prepared-startup.ts:191, wired at :113, applied at commands/index.ts:774) refuses a retired seat's command before executeScript reaches readScript at :861, so an `exec` from a departed seat is stopped by that gate even without this guard. The guard is largely redundant on that path.

### T2B-004
Verdict: confirmed
Corrected severity: Low
Reason: (a) prepared-startup.test.ts:222-223 compares a value with itself before adopt. (b) q3-product-launch.test.ts:89-90 passes prerelease-ta-demo or prerelease-demo under a "retail aliases" title; q3ProductPolicy(false,false) in q3-product-policy.test.ts:9 is the retail case. (c) startup-commands.test.ts:63 checks only seen[0], and the fixture's default.cfg and autoexec.cfg both call `record`. (d) prepared-startup.test.ts:426 loops over slice(1), which can be empty.

### T2C-001
Verdict: confirmed
Corrected severity: Medium
Reason: state.test.ts:87,:109,:132 use `?.generation` with `.not.toBe`, and :130-131 compare `?.id ?? null` with currentActor(). Adding `return null` after the lifetime release in host.ts actor() left state.test.ts at 10 pass.

### T2C-002
Verdict: confirmed
Corrected severity: Medium
Reason: state.test.ts:96,:99 use filters returning only 64 and 65. Mutant `if (outcome !== 0) break;` gave state 10, services 1, native 12 pass. Removing `count < maximum` gave state 10, services 1 pass (native not run for this one). grep finds BoxEdicts in no other test.

### T2C-003
Verdict: confirmed
Corrected severity: Medium
Reason: Reproduced: Q2_RR_SAVE_PROBE gives 1,672 bytes on the minimal map. With Q2_RR_FULL_MAP also set, the test fails with `GuestCallStopped: budget` at 20M after spawning 502 entities, and at a 200M budget it passes with 217,262 bytes. package.json does not set either variable. Production uses writeSaveLoading at runtime.ts:7997.

### T2C-004
Verdict: confirmed
Corrected severity: Low
Reason: Changing world.ts:17 fails native.test.ts:530 with `Received message: "The native map fixture STUB"`. Production text at rerelease-guest-services.ts:89 says "foreign actor ${slot}", which does not contain "foreign actors".

### T2C-005
Verdict: confirmed
Corrected severity: Low
Reason: world.ts:72 throws on a surface miss while production :103 matches by value and returns 0. world.ts:66 setSolid only unlinks. The fixture's spatial has no prepareLink (production :105,:243), and solid 0 is handled differently. RereleaseGuestServices appears in tests only at services.test.ts:12-33. T3-009 names other fixture families, not this set.

### T2C-006
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Reproduced: removing the equip loop left weapon-behavior at 5 pass; removing `host.runFrame(true)` (protection.test.ts:45) left 13 pass; removing ReadGame (host.test.ts:101) left 5 pass. weapon-behavior.test.ts:154 is the last statement. Correction: native.test.ts:711 can fail. `combat.read(actor.id)?.health` returns undefined if native slot reuse destroys the foreign actor's combat record, so it guards survival, not damage. Traced, not mutated.

### T2C-007
Verdict: confirmed
Corrected severity: Low
Reason: world.test.ts:109 runs ctf with deathmatch true, and :153-159 pin the "killed himself" result. runtime.ts:7989 and :8009 refuse native saves when deathmatch is nonzero. The 2.9 s cost was not re-measured.

### T2C-008
Verdict: confirmed
Corrected severity: Low
Reason: QuakeLiveGameModule and QuakeLiveGameImports appear only in src/compat/q3/native and tests/compat/q3/native/fixture.ts, which has no `test(` and nothing imports nativeGameFixture. src/compat/q3/native totals 235 lines. `find qfiles -iname bin.pk3` returns nothing, and fixtures.ts:9 needs quakelive/baseq3/bin.pk3.

### T2D-001
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The negative is vacuous: with no drain (interpreter.ts complete returning `checked()`), qvm.test.ts:326-327 still passed. Correction: the claims that the remaining assertions do not depend on ordering, and that such an interpreter "would stay green", are false. The same mutant fails :332 (`stackPointer` expected 4096, received 4028), and also "ignored child failure still unwinds the parent".

### T2D-002
Verdict: confirmed
Corrected severity: Medium
Reason: With a throwaway HOME and the corpus set: armor-stage 5 fail 4 pass (all ENOENT), weapon-stage 1 fail 3 pass, mod-provider 3 skip, mod-combat, mod-monster, mod-commands, mod-input and mod-clients 1 skip each. That is 6 failures and 8 skips. `find qfiles -ipath '*copper*'` returned only three Q3 textures. armor-stage.test.ts:40-41 hard-codes statement numbers and takes the digest from the same bytes.

### T2D-003
Verdict: confirmed
Corrected severity: Low
Reason: Replacing `events.restore` with a no-op on the instance at local-messages.test.ts:194 left local-messages at 6 pass. The test restores into the instance that already holds the events, with the same actor.

### T2D-004
Verdict: confirmed
Corrected severity: Low
Reason: mod-clients.test.ts:60 creates `messages` empty, :108 uses `.every`, and line 108 is the only assertion on `restored.messages` (grep). The empty case is true. Traced; the test is Copper-gated.

### T2D-005
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The trace holds: each provider has a private `local` (mod-messages.ts:17), and mod-objectives flush reaches the owner's `change`, so mod-combat.test.ts:142 pins [1, 2, 1]. Correction: the doubled event needs a declaration naming a message-emitting function as `change` plus a writable borrower, and both are authored by this test (:55, :76). No declaration in src, assets, docs or tools uses `role: "borrowed"`, so no shipped content reaches it. It was not run (Copper absent).

### T2D-006
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Correct: qw-map-damage.test.ts:71, rerelease-builtins.test.ts:50-53, mod-input.test.ts:131,143, runtime.test.ts:1240-1241, and the weak forms at local-messages.test.ts:163,165,178. Corrections: mod-qw-messages.test.ts:87 asserts `listeners.size` is 0, and removing unsubscribe from QcModMessages.close fails there (expected 0, received 1), so "a provider that ignored close passes" is false and only :88-89 are empty. A commit that clears the sky passes :165 but fails the same test at :173:88.

### T2D-007
Verdict: confirmed
Corrected severity: Low
Reason: id1-projectiles.test.ts:32-35 and :79-82 use a stub execution with forged observeStore calls, W_FireRocket appears in no other test, and the vm at :24 has no observer attached. Id1ProjectileAttacks appears in tests only here. quakec-source.ts:388,410 hold the wiring.

### T2D-008
Verdict: confirmed
Corrected severity: Low
Reason: mod-combat.test.ts:156-158 runs `expect` in `finally` before four closes. rerelease-builtins.test.ts:16 and qw-map-damage.test.ts:16 never close their registries, id1-projectiles.test.ts:61 closes only restoredActors, and function-hooks.test.ts has no `actors.close`. client-browser has 12 view.close() and 0 finally. client-file:26-31 and file-checkpoint:11-16 read /proc/self/fd.
