# TESTS — Test suite audit (tests/**, 705 tracked files, 701 .ts on disk, ~97K lines)

## Coverage
Method: AST and regex scanners over every `tests/**` .ts file (scripts in `<scratchpad>/tests-audit/`: `map2.ts`, `ast.ts`, `scan.ts`, `skip.ts`, `early.ts`, `nc.ts`, `noroot.ts`), plus direct reading.

Read in full (lines clipped at 150-200 columns where the file has very long lines): tests/app/crash-log, tests/app/loading-frames, tests/app/llm-settings-directory, tests/settings/server-ui, tests/settings/global-tuning, tests/world/q1-cell-split, tests/first-playable/application/frame-time-native-local, tests/first-playable/application/qw-expansions, tests/first-playable/simulation/intermission-character, tests/first-playable/simulation/round-policy-lifetime, tests/first-playable/operator-console, tests/content/q2/lmctf/application, tests/gameplay/composition/q2/application, tests/camera/workflow, tests/capture/application, tests/debug/settings, tests/debug/shapes, tests/platform/window-runner, tests/platform/window-headless, tests/render/worker-transport, tests/render/cpu/row-parallel, tests/policy/build, tests/support/corpus, tests/support/reflect (24 files).

Sampled (first 38-110 lines, or targeted excerpts): tests/policy/type-policy, tests/platform/audio, tests/render/worker-native, tests/render/gl/smoke, tests/first-playable/remote-socks, q3-horde, game-prompt, prediction/arsenal, q3-client/application, q3-guest, team-arena, team-arena-main-menu, server-browser-sort-filter, frame-time-native-remote, q2-downloads, tests/app/q3-product-launch, tests/composition/q1/source, tests/content/catalog/equipment, tests/content/catalog/mounts, tests/console/q1-client-settings, tests/core/session, tests/foundation/event-ring, tests/foundation/primitives, tests/formats/q3-map/retail, tests/gameplay/q3/modes/objectives, tests/gameplay/q2-base/monsters/monsters, tests/guest/x64/cpu, tests/guest/pe/installed-dll, tests/guest/runtime/windows/msvc, tests/guest/runtime/windows/installed, tests/input/input, tests/llm/request, tests/llm/settings, tests/materials/materials, tests/media/cinematic, tests/movement/q3/movement, tests/movement/q1/movement, tests/network/common/network, tests/network/q3/application, tests/network/q1/protocol-host, tests/persistence/save, tests/persistence/kex-saves, tests/ui/common/native-ui, tests/ui/common/menu-art-loading, tests/world/collision/retail, tests/bots/behavior/library/retail, tests/text/accessibility, tests/text/presentation, tests/audio/startup, tests/first-playable/remote-application/application, tests/bots/navigation/retail, tests/compat/qvm/qvm, tests/compat/q2/classic/world, tests/compat/qc/mod-provider, tests/formats/q2-map/retail (55 files). Total read: 79 files, with at least one file from each of the 31 top-level directories under tests/.

Skipped: the remaining ~620 test files were scanned only, not read. Large files such as tests/compat/qc/runtime (1294 lines) and tests/first-playable/simulation/actor-execution (1034) were not read.

Executed, all from `<scratchpad>/clean` with a throwaway `HOME`, no corpus, `SDL_VIDEODRIVER=dummy`:
- 259 corpus-dependent or application-launching test files, one `bun test <file>` per file (45 s limit, no timeouts hit). Results are in `<scratchpad>/tests-audit/loop.out`.
- `bun test --coverage` on tests/network/q2, tests/guest, tests/compat/q2, tests/compat/qvm.

No game corpus was available, so nothing here measures what the gated tests do when they run.

Deviation from the brief's "do not touch ~/.local/share/quake-typescript": one `ls -la` on the real `crash.log` for size and mtime only (30333 bytes, Oct 28 01:51). The contents were not read. Pollution was confirmed by reproducing in a throwaway HOME instead.

My runs wrote gitignored output into the shared `<scratchpad>/clean` (`tests/first-playable/application/local.json`, `.artifacts/resume-20260913/`). Other reviewers using that checkout may see them.

## Strengths
- Assertion density is high: ~24,100 `expect()` in ~3,000 test call sites (about 8 per test). Weak matchers are rare; only 1 file is dominated by `toBeDefined`/`not.toThrow`-style checks. The 12 tests with no `expect` in the body, and tests/world/q1-cell-split (which uses `node:assert`), all assert through helpers or `deepStrictEqual`. No truly assertion-free test was found, and tests/policy/type-policy is an unusually thorough negative-fixture suite.
- No `.only`. Only 6 files use `test.skip`, of which 2 are empty documentation placeholders.
- Temp-directory hygiene is good: all 191 files using `mkdtemp` also call `rm`, usually in `finally`. `tests/llm` fakes transports and uses temp bases.
- Synthetic parser coverage is better than the import map suggests. Line coverage without corpus (Bun's figure, which runs optimistic): q2pro 87%, vanilla 86%, q2repro 71%, r1q2 72%, kexdemo 73%, network/q2/message 93%, guest/pe/image and directories 100%, elf/parse 92%, x64/cpu 95%, x86/cpu 87%, qvm/interpreter 97%, qvm/abi 100%.
- Tests read as behavior witnesses, with real UDP over loopback, real renderers, and exact retail digests kept out of the repo.

## Findings

### TESTS-001 — Application tests that omit `--user-content-root` read and overwrite the developer's real settings
- **Verification (VERIFY-C): confirmed. Final severity: High.** Confidence rises from traced to reproduced. Unmodified tests/first-playable/q3-client/application.test.ts and tests/settings/server-ui.test.ts, run with cwd holding game data and a scratch HOME, wrote 20 and 11 files under `$HOME/.local/share/quake-typescript` (audio, input seats, cvars, images.cfg). A second run read a seeded musicVolume 0.25 and rewrote audio.json, and input/seat-1.json content changed. This machine has Steam Quake directories that `resolveDefaultContentRoot` searches (src/content/roots.ts), so these launches can resolve data under the real HOME. Not run against the real HOME, per the rules. Autosave overwrite was not observed.
- Severity: High
- Category: robustness
- Location: tests/settings/server-ui.test.ts:12-16,59; tests/first-playable/q3-client/application.test.ts:8; tests/first-playable/game-prompt.test.ts:12; src/app/bootstrap/application.ts:534-540,4754-4765; src/app/bootstrap/application.ts:467
- Confidence: traced (server-ui's profile path is explicit in the test; the rest follows the code path, and could not be run without a corpus)
- Evidence: server-ui targets the real profile directly and asserts the file appears there:
  `profilePath = join(homedir(), ".local", "share", "quake-typescript", "settings", "servers", `${profileName}.json`)`.
  Of 188 test files that launch or load the application, 93 never mention `--user-content-root` or `userContentRoot` (`tests-audit/nc.ts`, file-level). 35 pass neither a content root nor a user root (list in `nc.ts` output), and 68 that call `.open` pass no `saveDirectory`.
  The fallback is `options.userContentRoot ?? defaultUserContentRoot()` (application.ts:534,539), which resolves to `~/.local/share/quake-typescript/content`. `Application.close()` then runs `keyProfiles.save()`, `saveSourceArchive`, `saveClientArchives`, `input.saveSettings()`, `viewSettings.save`, `saveAudioSettings` (4754-4765), and `archivePersistence` is set true during normal open (application.ts:544).
  Test-driven cvars and bindings are therefore saved over the real product settings. Save defaults also point at the real profile (`join(homedir(), ".local", "share", "quake-typescript", "saves")`, application.ts:467); `autosaveLevel` (487-497) writes `autosave.sav` there for offline singleplayer Q1/Q2/QC worlds.
- Impact: on a developer machine with content installed, `bun test` can change the settings of the player's real game and overwrite an autosave. Those same real files are read back at open, so results also depend on the developer's local configuration. Refutation attempt: without a corpus these launches throw before any write (0 files appeared in the throwaway HOME across all 259 files), so the damage needs installed content.
- Remediation: make the test process hermetic with a shared preload that sets `HOME` to a temp directory for all of `bun test`, and require an explicit user root in test launches.

### TESTS-002 — Confirmed: crash-log test appends to the real user crash.log on every run
- Severity: Medium
- Category: robustness
- Location: tests/app/crash-log.test.ts:10; src/main.ts:13,91
- Confidence: reproduced
- Evidence: the test isolates only its second call. Line 10, `expect(await main(["--definitely-invalid-option"])).toBe(1);`, reaches `writeCrashLog(error, argv)` at main.ts:91 with the default directory `dirname(defaultUserContentRoot())`; line 11 passes `home` only for the probe call.
  Reproduced with `HOME=<throwaway> bun test tests/app/crash-log.test.ts`: the throwaway home gained `.local/share/quake-typescript/crash.log` containing `argv=["--definitely-invalid-option"]`.
- Impact: each suite run adds a fake crash to the file users and developers consult for real crashes, and `appendFileSync` never trims it. `main()` also prints the error stack to stderr in every test log.
- Remediation: make `main` take an injected crash directory or run it under a temp HOME. Assert on that directory.

### TESTS-003 — Without a corpus, unguarded tests fail rather than skip, so `bun test` and `bun run check` cannot pass
- **Verification (VERIFY-C): confirmed-with-changes. Final severity: Medium.** Reproduced on all 3 cited files with no corpus and empty HOME: q1/source 7 fail, equipment 7 fail, q3-horde 1 fail, each with `Content ... requires`. The file-count totals were not re-run. Downgraded because this is test-infrastructure noise, not a runtime defect, and README.md says some tests need game data. tests/support/corpus.ts:7 also allows "skip or report the missing files", so failing is within its wording; the real problem is a red baseline.
- Severity: High
- Category: test-gap
- Location: tests/support/corpus.ts:7-8; package.json `check`; README.md:161; unguarded examples tests/composition/q1/source.test.ts:24, tests/content/catalog/equipment.test.ts:15, tests/first-playable/application/q3-horde.test.ts:15
- Confidence: reproduced
- Evidence: corpus.ts promises "content-dependent tests skip or report the missing files". Running the 259 corpus-dependent or launching files one at a time with no corpus gave **654 pass, 413 fail, 452 skip**. 138 files have at least one failure, 95 fail entirely, 60 skip entirely. The failures are ungated `test(...)` calls that hit `Content ... requires: q2/baseq2/pak0.pak` or an open error.
  Fails by directory: first-playable 247, compat 42, gameplay 37, network 23, settings 14, content 13, render 11, audio 10, composition 7, bots 5.
- Impact: `bun run check` is red on any machine without the commercial data. That includes contributors and any future CI (the repo has no CI configuration; `git ls-files` finds none). When hundreds of failures are normal, a real regression in a corpus-free test is easy to miss. The failure is mixed in with data-dependent noise, so it cannot be told apart without triage.
- Remediation: put every data-dependent test behind one shared gate, such as `test.skipIf(!corpusHasFile(...))` or a `corpusTest` helper, and make the no-corpus run a green, meaningful baseline.

### TESTS-004 — QTS_TEST_CORPUS is ignored by about half of the launching tests
- **Verification (VERIFY-C): confirmed-with-changes. Final severity: Medium.** tests/first-playable/operator-console.test.ts fails 2/2 with QTS_TEST_CORPUS set and `Content q2-classic-baseq2 requires: ...`. A file-level recount gives 108 of 213 test files calling parse/open with no `--content-root` or `corpusRoot:`, which supports "about half" (the regex differs from the auditor's 99/188). 8 files key on the copper path. intermission-character passes with the corpus because Steam is only its fallback. Downgraded because it is a hermeticity defect in tests; the damaging consequence is already TESTS-001.
- Severity: High
- Category: test-gap
- Location: src/app/bootstrap/options.ts:286; src/content/roots.ts:136-152; tests/first-playable/operator-console.test.ts:6; tests/content/q2/lmctf/application.test.ts:10; tests/first-playable/q3-client/application.test.ts:8; tests/first-playable/simulation/intermission-character.test.ts:11; tests/first-playable/startup-selection.test.ts:542
- Confidence: reproduced
- Evidence: 99 of 188 launching files never pass `--content-root` or `corpusRoot:`. `parseApplicationCommand` then calls `resolveDefaultContentRoot` (own folder, parent, Steam), and `ownDirectory()` under `bun test` is `process.cwd()`. With `QTS_TEST_CORPUS=/x`, `options.corpusRoot` printed the checkout path, not `/x`. operator-console under a set `QTS_TEST_CORPUS` still fails with `Content q2-classic-baseq2 requires: q2/baseq2/pak0.pak`.
  intermission-character adds real Steam directories to its search (`[testCorpusRoot(), testCorpusRoot(), ...steamCommonDirectories()]`, the duplicate included). startup-selection uses `defaultUserContentRoot()` with `discoverMods: true`. 8 tests/compat/qc files key on `${homedir()}/.local/share/quake-typescript/content/q1/rerelease/copper/progs.dat`, and kex-q2-load and kex-saves read Steam roots through `nightdiveAddonDirectories(homedir())`.
  corpus.ts:8 claims "nothing is guessed from local disks".
- Impact: the same commit gives different results depending on the cwd, the Steam install, and whichever mods are in the real profile. Setting the documented variable does not make half of the application suite run against the supplied data. Combined with TESTS-001, that data is paired with the real profile.
- Remediation: route all launches through one test launcher that injects corpus and user roots, and remove default-disk discovery from tests.

### TESTS-005 — Corpus and env gating silently removes about a fifth of assertions overall and most of several subsystems
- **Verification (VERIFY-G): confirmed-with-changes. Final severity: Medium.** accessibility.test.ts:49 early return confirmed; gating is pervasive. Correction: `skipIf` appears on 355 lines in 156 files under tests/ at HEAD, not 374. Per-directory percentages taken from tests-audit, not recomputed.
- Severity: Medium
- Category: test-gap
- Location: tests/support/corpus.ts; repo-wide `test.skipIf` (374 grep lines), see `<scratchpad>/tests-audit/tests.json`
- Confidence: reproduced (skip counts for the 259 files); static counts for the percentages
- Evidence: static AST counts: 387 of ~3,000 test call sites are guarded (12.9%), holding 4,504 of ~24,141 `expect()` calls (18.7%). A further 155 unguarded sites holding 1,816 expects reference corpus data and fail without it. Loops expand call sites at runtime, so the executed skip count on the 259 files is 452. Share of expects behind a guard, by directory:

  | dir | guarded expects | dir | guarded expects |
  |---|---|---|---|
  | tests/capture | 100% | tests/compat | 31% |
  | tests/movement | 81% | tests/render | 31% |
  | tests/bots | 50% | tests/gameplay | 23% |
  | tests/formats | 42% | tests/content | 20% |
  | tests/text | 42% | tests/first-playable | 19% |
  | tests/media | 42% | tests/app | 11% |
  | tests/platform | 39% | tests/network, ui, console | ≤6% |

  Source areas with the weakest corpus-free reach (share of lines in files directly imported by a test file with no corpus or launch reference; a file-level heuristic that undercounts, since a file with a single gated test counts as corpus-dependent): src/movement/q1 0%, src/compat/qc 2%, src/content/monsters 2%, src/content/q1 4%, src/content/q2 17%, src/world/collision 21%, src/ui/common 26%. Overall 65% of source lines sit in a directly imported file, and 45% in one imported by a corpus-free file.
  One silent pass was also found, reported as pass rather than skip: tests/text/accessibility.test.ts:49 `if (!await file.exists()) return;`. That is the only top-level early return in any test body (`early.ts`).
- Impact: a green or skip-filled run says little about Q1 gameplay, QuakeC, collision or movement, and nothing in the output says which subsystem lost coverage.
- Remediation: print a per-subsystem skip summary, run the corpus suite on a schedule on a machine with the data, and convert the accessibility early return to `skipIf`.

### TESTS-006 — Broken guard paths permanently skip tests even with a valid corpus
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** presentation.test.ts:19 and :27 concatenate with no separator and corpus.ts:11 adds none; installed-dll.test.ts:24 and windows/installed.test.ts:17 join without q2/. qfiles has q2/ctf but no root ctf.
- Severity: Medium
- Category: bug
- Location: tests/text/presentation.test.ts:19,27,64,85,138; tests/guest/pe/installed-dll.test.ts:18,20,24; tests/guest/runtime/windows/installed.test.ts:16-17
- Confidence: reproduced for presentation and installed-dll; traced for windows/installed
- Evidence: presentation: `const corpus = testCorpusRoot();` followed by `` existsSync(`${corpus}q1/rerelease/QuakeEX.kpf`) `` has no separator. With a fake corpus holding those files: `QTS_TEST_CORPUS=$F` gives 1 pass, 4 skip; `QTS_TEST_CORPUS=$F/` gives 1 pass, 1 skip, 3 fail (the guards open, and fail only on junk bytes).
  installed-dll: `join(testCorpusRoot(), entry.relativePath)` with `"ctf/gamex86.dll"` and `"rerelease/baseq2/game_x64.dll"` lacks the `q2/` head that every other test uses. A corpus with `q2/ctf/gamex86.dll` and `q2/rerelease/baseq2/game_x64.dll` gives 0 pass, 2 skip, while msvc.test.ts, using `corpusFile("q2/rerelease/...")`, sees the same file and runs. windows/installed.test.ts:16-17 has the identical pattern for 3 DLLs.
  Related fragility: only 53 files use the case-resolving `corpusFile`/`corpusHasFile` against 149 using raw `testCorpusRoot()` paths, so the Steam layout that corpus.ts:6 advertises silently skips most guards. 44 hard-coded `q1/id1/` paths are split between `PAK0.PAK` (40) and `pak0.pak` (4). Corpus location is also spread across several env vars: QTS_TEST_CORPUS, QUAKE_DATA_PATH, QFILES_ROOT, Q3_DATA, Q3_DATA_PATH, Q2_DATA_PATH, QUAKE_Q2_CORPUS_ROOT, QUAKE_CONTENT_ROOT.
- Impact: Unicode/kfont text tests and native-DLL mapping and attach tests over untrusted guest code have been skipping with no signal, and this can hide regressions in exactly the code they guard. When the three DLL tests open, they might fail, since they have not been running on an assembled corpus.
- Remediation: fix the paths, resolve every corpus path through `corpusFile`, and collapse to one variable. Fail the corpus run when a guard skips while the corpus variable is set.

### TESTS-007 — GL and native tests are behind 80+ opt-in env vars that no script sets
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** A broad env regex finds 81 names (finding says 83); QUAKE_GL_SMOKE has 16 test lines and no setter in package.json, tools or docs; capture/application.test.ts:49 requires offscreen. The 19 ungated GL files not rechecked.
- Severity: Medium
- Category: test-gap
- Location: tests/render/gl/smoke.test.ts, tests/render/gl/buffer-reuse, tests/render/gl/fragment-clamping, tests/render/worker-native.test.ts:33, tests/text/world.test.ts:103, tests/capture/application.test.ts:49,139,202,230, tests/first-playable/network/download-workflow.test.ts:15; package.json
- Confidence: traced
- Evidence: 83 distinct env names are read across tests. Gates include QUAKE_GL_SMOKE (15 reads), SDL_VIDEODRIVER (14), QUAKE_STARTUP_NATIVE_TEST, QUAKE_DOWNLOAD_WORKFLOW_TEST, QUAKE_DEATH_APPLICATION_TEST, QUAKE_Q2_NATIVE_APP, QUAKE_MEDIA_NATIVE and QUAKE_FLARE_RENDER. A grep of package.json, tools and docs/*.md finds no setter or documentation for QUAKE_GL_SMOKE. No script enables them, and there is no CI. tests/capture requires `SDL_VIDEODRIVER=offscreen`; all 8 executed sites skip by default even with a corpus.
  Static count: 73 guarded sites holding 639 expects are env-gated. Only tests/platform/window-runner.test.ts spawns children with gates set, and only for the platform tests.
  Inversely, 19 test files request a real GL renderer without such a gate (list in `tests-audit/glun.list`, e.g. tests/settings/server-ui, tests/first-playable/application/frame-time-native-local), so on a headless host they fail, and on a desktop they create hidden windows on the developer's display.
- Impact: renderer, capture, worker and download workflows rot unnoticed unless someone remembers the right variables. Gate use is inconsistent across GL tests.
- Remediation: add documented `test:gl`, `test:native` scripts that set the gates, and gate every GL-requiring test on a single capability check.

### TESTS-008 — Frame-time tests write into the source tree and reuse stale state between runs
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** frame-time-native-local.test.ts:8 defaults output to import.meta.dir; the finally at :46 writes local.json unconditionally; local-content, remote-content, *.json and *-frozen.png exist and are gitignored (.gitignore:33-38).
- Severity: Medium
- Category: robustness
- Location: tests/first-playable/application/frame-time-native-local.test.ts:8,11,43,46; tests/first-playable/application/frame-time-native-remote.test.ts:10,50,84,99; .gitignore "Generated output from local application tests"
- Confidence: reproduced (overwrite on failure); traced (state reuse)
- Evidence: `const output = process.env["FRAME_TIME_PROOF"] ?? import.meta.dir;` and `'--user-content-root',resolve(output,'local-content')`. These directories are never cleared. tests/first-playable/application/ is carrying 21 such untracked files (Oct 23): `local.json` 23 KB, `remote.json` 77 KB, `local-frozen.png` 163 KB, `remote-frozen.png` 108 KB, and `local-content/`, `remote-content/` with seat bindings and cvar archives. All are gitignored, so `git status` hides them.
  The next run opens with those saved settings as its user root, so outcomes depend on the previous run. The `finally` writes `local.json` unconditionally: running it with no corpus replaced it with `completed=false frames=0` in the clean checkout, so any failing run destroys the retained evidence. The test has no gate and needs a GL context and q3dm1.
  Saved `remote-content/q3a/baseq3/settings/client.cfg` holds only empty `net_socksPassword`/`net_socksUsername` values; no secrets are present.
- Impact: non-hermetic results and clutter in the test tree that survives `git clean` without `-x`. A proof artifact can be silently overwritten.
- Remediation: default to `mkdtemp` and write artifacts only when `FRAME_TIME_PROOF` is set. Delete the stale outputs and the .gitignore lines.

### TESTS-009 — Tests write fixed-name files to /tmp and the project's .artifacts directory unconditionally
- **Verification (VERIFY-J): confirmed. Final severity: Low.** My grep reproduces 46 writes in 26 files to fixed /tmp names and 17 mkdtemp calls. protocol-host.test.ts:89-90, binding-actions.test.ts:86, game-prompt.test.ts:31-32 and startup.test.ts:34-37 match.
- Severity: Low
- Category: robustness
- Location: tests/first-playable/binding-actions.test.ts:86,107; tests/network/q1/protocol-host.test.ts:89-90; tests/first-playable/application/image-settings.test.ts:114-143; tests/first-playable/application/video-settings.test.ts:46-82; tests/first-playable/game-prompt.test.ts:31-32; tests/settings/server-ui.test.ts:23-24; tests/first-playable/simulation/hipnotic-selected.test.ts:146-151; tests/media/cinematic.test.ts:325-326; tests/first-playable/application/player-death.test.ts:93; tests/audio/startup.test.ts:34-37
- Confidence: traced
- Evidence: 46 `Bun.write`/`writeFile` calls in 26 files target fixed `/tmp/...` names with no capture flag, e.g. `` await Bun.write(`/tmp/nq-protocol-${version}-witness.ts`, ...) ``. `/tmp` currently holds 99 matching png/json/witness files, 17 MB for the png and witness files. 17 `mkdtemp("/tmp/...")` calls ignore `TMPDIR`.
  Other writes are cwd-relative (`".artifacts/tmp/game-prompts/local-two-seat.png"`), so running from another directory scatters output. tests/audio/startup.test.ts places its temp dirs under `.artifacts/resume-20260913`, a name from one past work session. Some are correctly gated (`QUAKE_SCENE_CAPTURE`, `TEAM_ARENA_ARTIFACTS`), so the pattern already exists.
- Impact: leftover output, overwrites between concurrent runs, and predictable names in a shared directory. Nothing removes them. Limited reach because this is test-only.
- Remediation: put all artifact writes behind one capture helper that does nothing unless an env directory is set.

### TESTS-010 — Real-time assertions and long waits make the suite load-sensitive
- **Verification (VERIFY-G): confirmed. Final severity: Low.** Sites confirmed at q3-guest.test.ts:203-209, remote-socks.test.ts:129, platform/audio.test.ts:64-66, worker-transport.test.ts:54-56. Lowered: the finding observed no flake and it affects test reliability only.
- Severity: Medium
- Category: robustness
- Location: tests/first-playable/application/q3-guest.test.ts:203-209; tests/network/q3/application.test.ts:571; tests/first-playable/remote-socks.test.ts:127-129; tests/first-playable/application/frame-time-native-local.test.ts:29,36; tests/platform/audio.test.ts:64-66 and child spawn at :16-25; tests/render/worker-transport.test.ts:54-56,65-67 (60 ms worker timeout); tests/settings/global-tuning.test.ts:84-87
- Confidence: plausible (no flake observed, but the listed corpus-dependent tests could not run here, and the others ran once at most)
- Evidence: q3-guest paces itself on the wall clock (`const remaining = 50 - (performance.now() - tickStarted)`) and asserts `activeMilliseconds >= 30000`, meaning at least 30 real seconds per test. remote-socks asserts `expect(performance.now() - start).toBeLessThan(1000)`. frame-time compares simulated time with wall time, `toBeGreaterThan((performance.now()-started)/1000*1.5)`, over `Bun.sleep(20)` steps. platform/audio sleeps 130 ms then requires `queuedFrames > 6000`. worker-transport depends on a 60 ms timeout firing and a 150 ms sleep being enough. global-tuning relies on 160 ms sleeps around a debounce.
  Scale: 61 files use sleeps or timers, 62 use `performance.now`/`Date.now`, and 234 tests declare timeouts ≥ 60 s, so a single hang costs minutes. tests/platform/audio spawns a child under a 15 s test timeout with no kill on timeout, unlike window-runner, which uses a SIGKILL timer.
- Impact: failures under memory or CPU pressure on this ~6 GB machine, and leftover children after a timeout. Mostly polling loops with deadlines are used, which is a strength of the suite and limits this to the listed sites.
- Remediation: inject clocks where a production seam exists, and compare simulated rather than wall time. Reserve wall-clock checks for an opt-in group.

### TESTS-011 — Reflection and prototype spies couple application tests to private fields, outside the type checker
- **Verification (VERIFY-G): confirmed-with-changes. Final severity: Medium.** reflect.ts:1-2 purpose and 120 spyOn prototype lines in 37 files confirmed. Correction: at HEAD 11 test files import support/reflect with 178 helper calls (foreign-lmctf 35, cross-family-q3 43), not 186 sites across 33 files with 28 and 25.
- Severity: Medium
- Category: maintainability
- Location: tests/support/reflect.ts:1-2; tests/first-playable/application/q3-horde.test.ts:23-33; tests/first-playable/application/foreign-lmctf.test.ts (28 sites); tests/first-playable/simulation/cross-family-q3.test.ts (25); tests/first-playable/simulation/intermission-character.test.ts:26-30
- Confidence: traced
- Evidence: reflect.ts states its purpose: "Policy-clean access to simulation internals in tests". 186 reflective read/call sites across 33 files, e.g. `readNumber(sim, "hordeWave")` and `readObject(readObject(readObject(sim, "source"), "game"), "records")`. `Object.assign(movement, { intermission: true })` writes internals past readonly types. 120 `spyOn(X.prototype, ...)` sites in 37 files replace methods process-wide in the single `bun test` process (restores are present, and the sampled ones sit in `finally`).
  Most reflective users are corpus-gated or corpus-failing, so renaming a private field passes `tsc`, passes `bun run policy`, and breaks only on a machine with data.
- Impact: refactors of the 8.6K-line `simulation/runtime.ts` and 4.8K-line `application.ts` break tests only late, and only on one class of machine. The string-keyed access defeats the strict-typing policy the project enforces elsewhere.
- Remediation: expose narrow typed test seams such as `sim.diagnostics()` for the state these tests need, and retire reflect.ts as they migrate.

### TESTS-012 — Largest and riskiest logic with no direct or corpus-free test
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** native-mod-provider.ts and ai-decision.ts have no direct test importer; UiRuntime appears only in retail.test.ts, gated at :23; BotBrain is never named in tests (reached through RereleaseBotBehavior, and rerelease tests reference corpus). Coverage percentages not re-run.
- Severity: Medium
- Category: test-gap
- Location: src/compat/q2/native-mod-provider.ts (1099 lines); src/ui/common/legacy/runtime.ts (2811); src/ui/common/legacy/menu.ts (2020); src/bots/behavior/rerelease/brain.ts (1992); src/bots/behavior/q3/ai-decision.ts (1183); src/network/q2/codecs/mvd.ts; src/network/q2/codecs/kex-usercmd.ts; src/guest/elf/unwind.ts; src/guest/elf/relocate.ts; src/compat/qvm/mod-provider.ts (1377); src/compat/q2/classic/world-profile.ts
- Confidence: reproduced for coverage percentages; traced for import data
- Evidence: import map with barrels expanded (`map2.ts`): files with no test importer directly or through a barrel include brain.ts, ui/common/legacy/script/lexer.ts 1224, ai-decision.ts, native-mod-provider.ts, content/q3/presentation/media.ts 847, render/cpu/triangle-kernel.ts 827 (exercised by renderer tests), ai-command.ts 800, q3/base/game/save-values.ts 681, aas-reachability-geometry.ts 663. These are indirect-only (depth 2-3 even with the app hubs blocked), so "no direct test" is not "untested"; q2repro.ts, for example, has no direct importer but has 71% line coverage through `Q2WireCodec`.
  Files whose only direct tests need a corpus or a launch: application.ts 4818, ui/common/legacy/runtime.ts 2811 (1 test file), remote-application.ts 2516, ui/common/legacy/menu.ts 2020 (1 test file), text/truetype.ts 1573 (1), quakec-source.ts 1509, startup.ts 1474.
  Corpus-free coverage measurements (lines): native-mod-provider.ts absent from the tests/compat/q2 coverage table, i.e. never loaded; qvm/mod-provider 57%; compat/q2/classic/host 57%; classic/world-profile 16%; network/q2/codecs/mvd 48%; codecs/kex-usercmd 12%; guest/elf/unwind 28%; guest/elf/relocate 59%.
  Malformed-input tests by keyword scan (malform, truncat, corrupt, oversize, hostile, out of bounds, fuzz): network 16 of 61 files, guest 4 of 20, compat 9 of 68, content 1 of 18, persistence 2 of 15. The scan found no byte-level fuzz or mutation harness for network or file parsers in the files read; seeded generators seen are for geometry and bot behavior (tests/world/q1-cell-split, tests/bots/behavior/library). This is a keyword scan, so it can miss differently named tests. `formats` does better (5 of 9 files), and individual truncation checks exist, such as tests/formats/q2-map/retail.test.ts:49 and tests/first-playable/prediction/arsenal.test.ts:38.
- Impact: code that handles native mod execution and untrusted peers (MVD/GTV streams, ELF relocation, save files, pk3 mounts) has the thinnest hostile-input coverage while being the most exposed. The legacy UI interpreter and the 1.1K-line native-mod layer depend entirely on retail data to run at all.
- Remediation: add seeded mutation tests over synthetic messages and images for network, guest loaders, persistence and archive code, and a synthetic fixture for the native-mod provider and legacy menu runtime.

### TESTS-013 — `test:verification`, `test:reference` and `reference:environment` scripts point at paths that do not exist
- Severity: Low
- Category: dead-code
- Location: package.json:14-15,18 (`"test:reference": "bun test tools/reference"`, `"reference:environment": "bun tools/reference/environment.ts"`, `"test:verification": "bun test tests/verification"`); docs/verification-plan.md:96; docs/comparison-q1.md:27-29
- Confidence: reproduced
- Evidence: `tests/verification` and `tools/reference` do not exist. `bun run test:verification` exits 1 with "The following filters did not match any test files". docs/verification-plan.md documents `bun run verify --profile integration --manifest verification/fixtures.json`, but package.json has no `verify` script, and the comparison docs cite `verification/*.json` at repo root (`verification/features/q1.json` and others), also absent at HEAD. `tools/verify/` holds `hash.ts`, `isolation.ts`, `snapshot.ts`.
- Impact: anyone following the docs or scripts hits an immediate failure, and the docs' provenance claims can't be checked from the repo.
- Remediation: remove the scripts and update docs, or restore the verification tree.

### TESTS-014 — Conditional and catch-only assertions can pass without checking anything
- **Verification (VERIFY-J): confirmed. Final severity: Low.** worker-transport.test.ts:49,57,68 use the quoted catch-only form; :42 and :95 check identity but still accept no throw. cpu.test.ts:29 skips if the exception kind changes. A rough grep gives 221 lines in 112 files, similar to the reported count.
- Severity: Low
- Category: test-gap
- Location: tests/render/worker-transport.test.ts:42,49,57,68,95; tests/guest/x64/cpu.test.ts:29 (`if (stopped.kind === "exception" && stopped.exception.kind === "processor") expect(...)`); tests/render/worker-native.test.ts:57-64
- Confidence: traced
- Evidence: 201 lines in 105 test files have `if (...) expect(...)`, `else expect(...)` or `catch (e) { expect(...) }`. Many are legitimate branching on a parameter. Sampled weak cases: `try { worker.close(); } catch (error) { expect(error).toBeInstanceOf(Error); }` accepts both outcomes, and the x64 processor-vector check is skipped if the exception kind changes, after only `kind === "exception"` was asserted. Bun has no default `expect.hasAssertions` guard in use.
- Impact: narrow; a behavior change turns these assertions off quietly. Most tests around them still assert plenty.
- Remediation: narrow with a thrown error, the pattern already used widely (`if (x === undefined) throw ...`), rather than guarding the expect.

### TESTS-015 — Unawaited `.rejects` assertions, including a path-traversal check, race with cleanup
- **Verification (VERIFY-J): confirmed. Final severity: Low.** mounts.test.ts:133-134 are unawaited and followed by rm at :135. equipment.test.ts:156,158 are unawaited too but have no cleanup to race. A grep finds these 4 sites only; server-browser-persistence.test.ts:160 is a different form.
- Severity: Low
- Category: test-gap
- Location: tests/content/catalog/mounts.test.ts:133-135; tests/content/catalog/equipment.test.ts:156,158
- Confidence: reproduced (runner behavior); traced (race)
- Evidence: `expect(mounted.read(before)).rejects.toThrow("bytes changed"); expect(mounted.read("../outside")).rejects.toThrow("Invalid relative");` is followed immediately by `finally { await rm(root, ...) }` and disposal of the `using` mount.
  This is not a false pass: in a scratch reproduction Bun 1.3.14 waited for a delayed floating `.rejects` and failed the correct test, and mounts.test.ts passes. But the reads race with removal of the root and closing of the mount, so the "bytes changed" assertion depends on the read reaching its check before `rm`. These are the only 4 such sites in the suite.
- Impact: possible flake only; the assertions do run.
- Remediation: add `await`.

### TESTS-016 — Candidates checked and refuted, plus minor observations
- **Verification (VERIFY-J): confirmed. Final severity: Info.** retail.test.ts:89 and controller.test.ts:249 are test.skip placeholders, main.ts:34-35 listeners exist, .artifacts/snapshots holds 23 entries at 1.8 GB, and player-service-status.ts and core/diagnostics.ts have no importer in src, tools or tests. Runner behaviour not re-run.
- Severity: Info
- Category: maintainability
- Location: as listed
- Confidence: reproduced or traced as noted
- Evidence:
  - **Source-text coupling is refuted.** The suggestion that hundreds of tests read .ts source with `readFileSync` does not hold at HEAD. A grep of `readFile`, `readFileSync`, and `Bun.file` finds 273 call sites, 47 of them `readFileSync`, and none reads `src/*.ts` as text; they read temp outputs, corpus files, tsconfig.json, menu PNGs and `/proc/self/maps`. The heavy "src/" hits are imports. Layout coupling is limited to `tests/platform/window-runner.test.ts:36,44,71` naming sibling test paths and to cwd-relative writes (TESTS-009).
  - **Listener leak has no observed effect in tests.** `main()` adds `process.on("unhandledRejection"/"uncaughtException")` (src/main.ts:34-35) and never removes them, and the crash-log test runs it in the shared process. I expected a stray rejection in a later test to trigger `process.exit(1)` and a crash-log write. In a reproduction, Bun's runner handled it first: the test failed normally, the run continued, and no extra crash.log entry appeared.
  - **`.artifacts/snapshots` is not scanned by the runner.** `.artifacts/snapshots/` holds 23 snapshots, 1.8 GB, containing copies of `.test.ts` files. Bun's scanner skips dot-directories (verified with a scratch hidden test), so they do not run. The size is a tools/build.ts matter, not a tests issue.
  - **Fixtures are small.** Tracked non-TS test data is under 10 KB per file (`tests/llm/fixtures`, `tests/camera/fixtures`). The largest items in tests/ are the untracked outputs of TESTS-008; the largest tracked file is tests/compat/qc/runtime.test.ts at 109 KB.
  - **Empty placeholders.** `test.skip` with an empty body is used as documentation at tests/formats/q3-model/retail.test.ts:89 and tests/platform/controller.test.ts:249, and adds to skip counts.
  - **Unimported modules seen in the map.** src/app/bootstrap/player-service-status.ts and src/core/diagnostics.ts have no importer in src, tools or tests by grep. Left for the dead-code reviewer to confirm.
- Impact: none beyond the notes.
- Remediation: none needed.
