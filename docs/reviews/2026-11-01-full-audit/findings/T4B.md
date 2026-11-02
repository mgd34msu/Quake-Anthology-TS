# T4B — READ review of the test files and fixtures T4 did not read
## Coverage
Read in full, line by line, at HEAD fcdc8af5, no truncation: tests/audio/bootstrap (386), audio/component-presentation (199), audio/playback (559), audio/startup (858); materials/image-resolution (468), materials/images (181), materials/materials (334); media/cinematic (528); movement/q1/movement (365), movement/q2/movement (375); policy/type-policy (323); ui/common/native-ui (424), ui/hud/q2-native (196). That is all 13 files, 5,196 lines.
Data files read in full: llm/fixtures/api-models.json, llm/fixtures/codex-models.json, llm/fixtures/subscription-empty-completion.json (the 127 lines T4 read only 30 of), camera/fixtures/inspection.camera. Their consumers were checked: llm/models.test.ts:16-40, llm/responses.test.ts:47-61, camera/workflow.test.ts:15-22.
Skipped: nothing in scope.

Executed from <scratchpad>/clean with HOME/XDG under the scratchpad, SDL dummy drivers and QTS_TEST_CORPUS set:
- All 13 files as written: all pass, with 8 opt-in skips.
- Six opt-in skips run separately, all pass: QUAKE_IMAGE_HUD; QUAKE_MEDIA_NATIVE (two tests); QUAKE_UI_NATIVE_SMOKE; QUAKE_IMAGE_RENDER on cpu; the videoMap test on cpu with SDL_VIDEODRIVER=offscreen.
- Not run: the two GL variants (image render, videoMap).
- Temporary mutated copies of the tests were run from clean and deleted. No src was changed. The project directory is unchanged.
- One side effect: the QUAKE_IMAGE_RENDER run wrote /tmp/shared-image-cpu-{gif,pcx}.png (image-resolution.test.ts:439). I deleted both.
Source read only where a test led there: src/ui/hud/q2-native.ts (full), src/app/bootstrap/q2-native-hud.ts:1-70, src/audio/engine.ts:522-552, src/app/bootstrap/input.ts:793-800.

## Strengths
- audio/startup uses in-memory mounts and detached engines, and asserts exact PCM (`[250]`, `[500]`), open order and stream closure across pending-open races. 31 of its 32 tests need no corpus, and those open no device.
- media/cinematic `compareContinuation` compares a restored run with an uninterrupted one, tick by tick, on frames, PCM and completion latches, including a terminal restore that must not fire completion again.
- policy/type-policy leaves no fixture unasserted. A script matched 123 fixtures against 91 rejection rules and 32 `safe` controls, with no orphans in either direction. The safe controls assert `toEqual([])`, so over-rejection also fails.
- ui/hud/q2-native asserts exact coordinates, picture names and text rather than counts.
- Prototype patches in audio/bootstrap are all restored in `finally`.
- The LLM fixtures hold no credentials. The captured subscription stream contains only a message id and benign text.

## Findings

### T4B-001 — The flight "collides" tests have only an upper bound, so they pass when forward flight does nothing
- **Verification (VERIFY-L): confirmed. Final severity: Low.** tests/movement/q1/movement.test.ts:343-344 and q2/movement.test.ts:320-321 have only toBeLessThanOrEqual after the loop, so no forward motion passes. Measured positions and the Q2 precheck values were read, not re-run.
- Severity: Low
- Category: test-gap
- Location: tests/movement/q1/movement.test.ts:342-344; tests/movement/q2/movement.test.ts:319-321
- Confidence: reproduced
- Evidence: `for (let index = 0; index < 200; index++) step(320, 0); expect(current.state.origin.x).toBeLessThanOrEqual(wallOrigin.x - 8 - shape.bounds.max.x + 0.1);`. Nothing requires the player to reach the wall. With `step(0, 0)` in place of the forward steps, all 5 tests pass: the player stays at x=544 against a bound of 621 in q1 start, and at x=128 against 204 in q2 base1. In the unmutated runs the player does stop at the wall (620.97 of 621; 203.875 of 204), so behavior is correct today.
  The Q2 precheck `expect(wall.fraction).toBeLessThan(1)` cannot show the linked wall is visible to traces. It returns 0.0337 (classic) and 0.0385 (rerelease) whether or not `scene.link` runs, because world geometry about 35 units ahead satisfies it. The Q1 precheck does change with the link (0.075 with, 0.35-0.91 without).
- Impact: a regression that stops flight from applying forward movement, or that stops the player early, passes all 5 tests. In Q2 the map wall sits only 12-32 units beyond the linked wall, so the margin that catches a missing actor collision is small and map-dependent.
- Remediation: add a lower bound, such as `toBeGreaterThan(bound - 1)`. In Q2, move the wall trace to a position where only the linked wall can answer it.

### T4B-002 — The bootstrap test titled "replaces music" passes with every replacement call removed
- **Verification (VERIFY-L): confirmed. Final severity: Low.** tests/audio/bootstrap.test.ts:153-158 asserts only some(sample !== 0) after each playMusic, so a track that never changes passes. :159 stopsound precedes the "0" silence check at :160-161, so that check is not isolated.
- Severity: Low
- Category: test-gap
- Location: tests/audio/bootstrap.test.ts:153-161
- Confidence: reproduced
- Evidence: each step only asserts `expect(audioWet.engine.mix(22050).some(sample => sample !== 0)).toBe(true)`. Deleting `playMusic("03.ogg")` and the following `playMusic("2")` still passes, because the first track keeps playing. Deleting `playMusic("0")` also passes, because the `stopsound` on line 159 already silences music. Deleting `stopsound` instead also passes, so track "0" does work today, but the test as written cannot detect it breaking.
- Impact: this is the only corpus-backed application-level music path in the file, and it does not distinguish a replaced track from the old one still playing. The in-memory tests in audio/startup do cover replacement at the ApplicationMusic level, so the gap is in the bootstrap wiring (`ApplicationAudio.playMusic`).
- Remediation: compare the replaced PCM with a reference mix of the expected track, and drop the `stopsound` before asserting that track "0" is silent.

### T4B-003 — Three assertions can never fail
- **Verification (VERIFY-L): confirmed. Final severity: Low.** images.test.ts:83 reads typed-array length, which cannot change. q2-native.test.ts:105 reads a literal freshly built by environment() (:75-81). playback.test.ts:440 applies Number.isFinite to Int16Array samples.
- Severity: Low
- Category: test-gap
- Location: tests/materials/images.test.ts:75,83; tests/ui/hud/q2-native.test.ts:97,105; tests/audio/playback.test.ts:440
- Confidence: traced
- Evidence:
  - images:83, under the title "image processing preserves source bytes": `expect(input.pixels.length).toBe(16)`. A typed array's length is fixed, so an in-place write to `input.pixels` by `resampleImage` cannot change it. Compare images:70, which correctly uses `expect(source).toEqual(new Uint8Array([16, 224, 255]))`.
  - q2-native:105, under "table scratch is scoped to the HUD owner": `expect(environment().table?.rows).toEqual([])`. `environment()` (lines 75-81) returns a new literal `table: { rows: [], columns: [] }` on each call, so this checks a value the helper just created. No test runs `draw_table` with a second environment and expects nothing, which is what the title requires.
  - playback:440: `Number.isFinite(sample)` on an `Int16Array` element is always true. The `Math.sign` half of that line is real.
- Impact: in-place mutation of a source image by the last resample call goes unseen. So does HUD table state leaking between owners, the exact property named in the q2-native title.
- Remediation: compare against a copy of the pixels, and run `draw_table` on a fresh environment expecting no table operations.

### T4B-004 — Audio tests open the default output device with no driver gate, while their sibling tests require dummy
- **Verification (VERIFY-L): confirmed-with-changes. Final severity: Low.** Holds for tests/audio/bootstrap.test.ts (Application.open at :47,:241,:326; :114 asserts outputState "playing"), with no bunfig preload and package.json:12 setting no driver. Citation wrong for playback.test.ts:191,197: UnifiedAudio's constructor opens nothing (src/audio/engine.ts:100-106), only openDevice (:429) does, and that test is at :525 under the :509 dummy gate.
- Severity: Low
- Category: robustness
- Location: tests/audio/playback.test.ts:191,197; tests/audio/bootstrap.test.ts:47,90,114,241,326; package.json:12,19
- Confidence: traced (not run on a real device, by audit rule)
- Evidence: bootstrap:90 says `// Run with SDL_AUDIODRIVER=dummy`, but nothing enforces it, and `"test": "bun test"` sets no driver. There is no bunfig.toml preload. Other tests do handle this: playback:509 and cinematic:360 use `skipIf(SDL_AUDIODRIVER !== "dummy")`, round-reset:91 and platform/audio:38 throw, and startup-queue:8 spawns a child with dummy set.
  bootstrap:53 issues `play weapons/rocket1i`, and bootstrap:114-116 starts a looping `weapons/rg_hum.wav` with `outputState` asserted as `"playing"`.
- Impact: `bun test` on a developer machine sends game audio to the speakers. On a machine with no audio device these tests fail instead of skipping. Their device-backed assertions also then depend on the real backend rather than the dummy one they were written against.
- Remediation: set the dummy driver in a shared test preload, or apply the same gate used at playback:509.

### T4B-005 — The policy tool and its test miss node:vm, data: imports, worker eval and Reflect-based access
- **Verification (VERIFY-L): confirmed-with-changes. Final severity: Low.** Re-ran auditProgram on fixtures: 0 diagnostics for node:vm, data: import, new Worker eval:true, Reflect.get(Bun,'spawn') narrowed and called, Reflect.get(process,'dlopen'). Control Bun.spawn is caught. The sixth does not hold in my form: Reflect.get(Object.getPrototypeOf(async function(){}),'constructor') drew unsafe-any and unsafe-argument. tools/check-policy.ts has no Reflect handling. No use in src.
- Severity: Low
- Category: test-gap
- Location: tests/policy/type-policy.test.ts:58-63,98-115; tools/check-policy.ts
- Confidence: reproduced
- Evidence: I ran `auditProgram` on small fixtures placed under `src/`, with the same compiler options as the test. Each of these produced no diagnostics:
  - `import { runInThisContext } from 'node:vm'; export const v: unknown = runInThisContext('1');`
  - `await import('data:text/javascript,globalThis.x=1')`
  - `new Worker('1', { eval: true })`
  - `Reflect.get(Bun, 'spawn')`, narrowed with `typeof` and then called
  - `Reflect.get(process, 'dlopen')`
  - `Reflect.get(Object.getPrototypeOf(async function () {}), 'constructor')`, narrowed and then called with source text

  The test covers `eval`, `Function`, `.constructor`, WebAssembly, `Bun.spawn` aliases and `process.dlopen` aliases, so the same goals are only partly enforced. These forms were caught: `globalThis.Bun.spawn`, `Reflect.construct(Function, ...)`, `Reflect.apply(eval, ...)` and `import.meta.require`.
  A grep of src finds no `node:vm`, `eval: true` or `data:text/javascript`, so nothing uses these today.
- Impact: no current violation. The policy's rules on dynamic code and subprocesses can be bypassed by accident or by a contributor, and the test suite gives no sign of it. Authors are trusted here, so the risk is erosion rather than attack.
- Remediation: add `node:vm` and `eval: true` workers to the forbidden list, reject `data:` import specifiers, and add `Reflect.get` on `Bun` and `process` to the existing alias checks. Add a fixture for each.

### T4B-006 — The only direct test of sky cloud coordinates checks that one axis is finite
- **Verification (VERIFY-L): confirmed. Final severity: Low.** tests/materials/materials.test.ts:97 is the only test reference to cloudTexCoord, and it checks that .x is finite; no test names SkyBuilder or cloudCoords. Rendered-output coverage through src/render/scene/shaders.ts:9,55 was not excluded.
- Severity: Low
- Category: test-gap
- Location: tests/materials/materials.test.ts:97; src/materials/sky.ts:84,112
- Confidence: traced
- Evidence: `expect(Number.isFinite(cloudTexCoord(4, 0.5, 0.5, 512).x)).toBe(true);`. A grep of tests/ finds no other reference to `cloudTexCoord`, `cloudCoords` or `SkyBuilder`. `SkyBuilder` builds the 81-point coordinate table for each of the 6 faces from this function, and render/scene/shaders.ts imports it. This covers identifier references only; a rendered-output test elsewhere could still exercise it indirectly.
- Impact: a wrong face mapping or height term on Q3 cloud skies passes this test, including a wrong `.y`.
- Remediation: pin a few values per face, derived from the original `R_InitSkyTexCoords` math.

### T4B-007 — Test titles that promise more than the body checks
- **Verification (VERIFY-L): confirmed. Final severity: Low.** playback.test.ts:69-84 has no second sound on an occupied channel; :107-124 hard-codes reverbPreset(5). q2 movement.test.ts:124-127 sets upMove once with no release step. :340,:349,:364,:371 assert only not.toEqual, which falling satisfies.
- Severity: Low
- Category: test-gap
- Location: tests/audio/playback.test.ts:69-84,107-124; tests/movement/q2/movement.test.ts:98,124-127,326,339-340,348-349
- Confidence: reproduced for the movement "release" case; traced for the rest
- Evidence: same family as T4-007, in files T4 did not read.
  - playback:69 "channel replacement": each actor plays only one sound, and `stopSound` is used instead. No second sound on an occupied channel occurs at the UnifiedAudio level. Mixer-level replacement is covered at line 143.
  - playback:107 "selects presets": `reverbPreset(5)` is hard-coded and the parsed environments are only counted. The tail check is `Math.abs(value) > 0.01`, while the measured tail peak is 53.85, a margin of about 5000 times.
  - q2 movement:98 "jump release": the test asserts `PMF_JUMP_HELD` is set after one jump, and no later step releases it.
  - q2 movement:326 "release cleanly": with `forwardMove` changed to 0 at lines 339 and 348, the test still passes, because the origin changes from falling. The `state not.toEqual` checks at lines 364 and 371 passed the same mutation.
- Impact: a reader trusts coverage these bodies lack. The "release" assertions do show the freeze ended, but not that movement input resumes.
- Remediation: retitle, or add the missing step and a directional assertion on x.

### T4B-008 — Failure paths leak spies and registries in a few tests
- **Verification (VERIFY-L): confirmed. Final severity: Info.** tests/audio/startup.test.ts:160 creates the spy before try; :448 restores inside the try body, not finally; tests/materials/images.test.ts:142 closes outside finally.
- Severity: Info
- Category: test-gap
- Location: tests/audio/startup.test.ts:160-161,442-448; tests/materials/images.test.ts:123-142
- Confidence: traced
- Evidence: startup:160 creates `spyOn(MusicPlayer.prototype, "start")` before the awaited `StartupAudio.open`, outside the `try`. If open rejects, the spy stays installed, and calls it accumulates can then skew `toHaveBeenCalledTimes` at lines 662-686 (not run). startup:448 restores `closed` outside `finally`. images:142 calls `images.close()` outside any `finally`, and that `textures` loader is never closed.
- Impact: only after a first failure, when it can add misleading secondary failures.
- Remediation: move creation inside `try`.

### T4B-009 — Candidates checked and refuted
- **Verification (VERIFY-L): confirmed. Final severity: Info.** Refuted-candidate list. bootstrap.test.ts:126,336 and native-ui.test.ts:113-114 read as described. Instrumented counts were not re-run.
- Severity: Info
- Category: test-gap
- Location: tests/audio/bootstrap.test.ts:126,336; tests/ui/common/native-ui.test.ts:113; tests/policy/type-policy.test.ts:211-216; opt-in gates listed in Coverage
- Confidence: reproduced
- Evidence:
  - bootstrap:336 `motors.every(...)` looked vacuous if no rumble fired. Instrumented, motors held 1 entry at that line and 6 later, all on device 100, so the check is real.
  - bootstrap:126 `expect(wet).not.toEqual(dry)` looked like it could pass for unrelated reasons. With `underwater: false`, wet equals dry and the test fails, so it does detect the filter.
  - native-ui:113 falls back to -1 when `health` is missing, which passes `toBeLessThan(480)`, but line 114 fails on the same -1.
  - type-policy has no orphan fixtures (see Strengths).
  - Bit rot in the opt-in tests: the six I ran all pass today, GL not checked.
- Impact: none.
- Remediation: none.

## Supplements
- Supplements UI-002: ui/hud/q2-native.test.ts:47,94,106 pin the thrown RangeErrors as expected behavior (`toThrow("outside playerstate")`, `toThrow("source limits")`). Fixing UI-002 by dropping the layout instead of throwing means changing these tests; they are not independent evidence that throwing is correct.
- Supplements PLATFORM-010: audio/playback.test.ts:202-213,274-284,386-406 pin voice growth past the requested capacity, including 600 simultaneous voices. A voice cap must change these tests.
- Supplements TESTS-006 (its note on raw corpus paths): corpus.ts:5 advertises the Steam layout, but these sites use raw `${testCorpusRoot()}/q2/...` paths with `existsSync`, so they skip silently under that layout: materials/images:20,101,118,153,159,169; media/cinematic:148,174,520; movement/q1/movement:38,77; movement/q2/movement:45,59,61-63,217; ui/common/native-ui:117.
- Supplements TESTS-006: media/cinematic:149 gates on idlog.cin only, but lines 152-153 also require xatrix and rogue movies, so a partial corpus fails rather than skips.
- Supplements TESTS-009: materials/image-resolution:439 writes fixed `/tmp/shared-image-*` names whenever QUAKE_IMAGE_RENDER=1 is set; ui/common/native-ui:242 uses `mkdtemp("/tmp/...")`, ignoring TMPDIR.
- Supplements TESTS-010: ui/common/native-ui:268 waits for settings I/O with `attempt < 100` of `Bun.sleep(1)`, then asserts `busy` is false. That is a budget of roughly 100 ms for real file I/O, which could flake under load (plausible; no flake seen).
- Supplements TESTS-014: media/cinematic:252-256 makes its reentrancy assertions inside the upload callback, and nothing asserts the callback ran. audio/startup:475-476 ends with no assertion on the promised post-close behavior.
- Supplements T4-008: bare `toThrow()` at audio/playback:269,271,297,542,554 and media/cinematic:257,408.
