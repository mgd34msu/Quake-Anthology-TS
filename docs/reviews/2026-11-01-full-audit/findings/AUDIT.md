# AUDIT — Measured leak, tooling, build, repository, and architecture

Written by the audit lead from direct measurement. Raw outputs are in `../evidence/`.

## Coverage
Read in full: tools/build.ts, tools/check-policy.ts, tools/verify/*, tools/profile-frame.ts, tools/source-camera.ts, tools/content/generate-mg3-monster-resources.ts, package.json, tsconfig.json, .gitignore, bun.lock.
Measured by script: every tracked .ts file (import graph, exports, function size and complexity, nesting, line length, module state; `evidence/architecture-metrics.txt`), and all of src through the type checker for promise handling and empty catches (`evidence/promise-scan.txt`).
Executed against a clean HEAD export with an isolated home directory: typecheck, policy, the full test suite, and map-travel soak runs with real game data.

## Strengths
- Type discipline is exceptional: `as any`, `as unknown as`, `@ts-ignore` and non-null assertions all count 0 in src, and the policy tool enforces it. `tsc --noEmit` passes in 33 s.
- The type-aware scan found 20 empty catches, all commented, and 0 silent. Of 79 expression statements typed as promises, nearly all are deliberate assignments to tracked chains; 2 are genuinely floating (`src/app/bootstrap/splash.ts:79`, `src/content/q3/presentation/client.ts:378`, see GAPQ3-007).
- Only 2 dev dependencies and no runtime npm dependencies. Versions and the Bun version are pinned. The lockfile is present. History scan found no API keys or private keys.
- Only 2 TODO/FIXME-style markers exist in src, and both reproduce original source (UI-025, CONTENT1-020).
- The build snapshots inputs, gates on typecheck and policy, and detects source changes during a build.

## Findings

### AUDIT-001 — Every map change retains the entire previous world through a closure chain
- **Verification (VERIFY-G): confirmed. Final severity: High.** application.ts:2653 binds previousSimulation; closures at :2771, :2833 and :3041 capture it, so it sits in the function's shared scope with promptSupported/playerIdentity (:2798-2799), which the new simulation retains. Clean copy matches HEAD; soak-q1.log grows to 424.8 MB vs 74-81 MB in soak-q1-patched.log. Soak not re-run.
- Severity: High
- Category: leak
- Location: src/app/bootstrap/application.ts:2653, 2798-2799, 2793
- Confidence: reproduced
- Evidence: `const previousContent = this.content, previous = this.graphical, previousSimulation = this.simulation, previousLocalGuest = this.localGuest;` is declared in `prepareAndReplaceWorld`. Closures created in the same scope (`promptSupported`, `playerIdentity`, `prepareRereleaseNavigation`) are stored in the new simulation's `options`, and they hold the function's shared scope, which includes `previousSimulation`. Heap snapshot after 6 travels: 7 of 7 `SharedSimulation` instances reachable from the module graph, along the path `Application.worldSimulation -> options -> playerIdentity -> scope -> previousSimulation -> options -> ...`.
  Retained heap after a forced full GC, dedicated server, one tick every 50 ms simulated:
  | Scenario | Baseline heap | After travels | Growth per map | RSS |
  | --- | --- | --- | --- | --- |
  | Q1 e1m1/e1m2, 20 travels | 58.9 MB | 424.8 MB | 18.3 MB, ~353K objects | 407 -> 865 MB |
  | Q2 base1/base2, 10 travels | 64.1 MB | 257.1 MB | 19.3 MB | 429 -> 620 MB |
  | Q3 q3dm1/q3dm2 + 4 bots, 10 travels | 108.9 MB | 522.6 MB | 41.4 MB | 678 -> 1988 MB |
  | Q1 hidden client, CPU renderer, 8 travels | 279.7 MB | 467.9 MB | 23.5 MB | 1507 -> 2002 MB |
  Control: in the throwaway copy, clearing those four variables at the end of the function kept the heap flat at 74-81 MB over 12 travels (`evidence/soak-q1-patched.log`). This is the proof of cause. No project code was changed.
- Impact: Applies to every game and to both clients and servers. A Q3 server rotating maps every 20 minutes retains roughly 3 GB of heap per day, more in RSS, and eventually runs out of memory. Long single-player sessions degrade too. Peer-initiated votes and `changelevel` can accelerate it. Round 1 tested create/step/close cycles, which do not exercise this path, so `tests/` would not catch it.
- Remediation: Move closures that outlive the function into a helper with no access to `previous*`, or clear the bindings on every exit path. Add a soak test that asserts a bounded `SharedSimulation` count after repeated travel.

### AUDIT-002 — The policy gate takes 18 minutes and about 13 GB, and every build depends on it
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** policy.log shows 17m51s real, exit 0. tools/check-policy.ts:57, :87 and :163 default to a fresh visited set per call, reached per expression from visit (:488+). tools/build.ts:62 gates builds on policy. The 13 GB RSS is not in that log and was not re-measured.
- Severity: Medium
- Category: performance
- Location: tools/check-policy.ts:488-599, 492-495, 518-519; tools/build.ts:62
- Confidence: reproduced
- Evidence: A clean run passed in 17m51s wall, 19m47s CPU, with peak RSS of about 13 GB. The comparable `tsc --noEmit` takes 33 s. The visitor calls `getContextualType`, `erasesUnsafeValue`, `erasesAsyncReturn` and `hasAny` for almost every expression, with a fresh `visited` map per call, which walks type structures repeatedly. The earlier code review saw this step die with exit 137 (out of memory is the likely cause).
- Impact: `bun run check` and `bun run build` are unusable on a typical 16 GB machine and too slow as a pre-commit check. Any future CI runner would need an oversized instance.
- Remediation: Cache by type identity across the program instead of per call, or run syntax-only rules first and restrict deep type rules to changed files. Profile before changing it.

### AUDIT-003 — No continuous integration exists for a public repository
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** No .github or other CI config tracked (git ls-files); 1,035 commits and 19 tags confirmed; package.json:19 `check` is the only gate. `gh run list` not re-run (no off-host requests).
- Severity: Medium
- Category: maintainability
- Location: repository root (no .github, no CI config); package.json `check`
- Confidence: reproduced
- Evidence: No workflow files are tracked and `gh run list` returns nothing, across 1,035 commits and 19 tagged releases. The `check` script is the only gate and is run by hand.
- Impact: Regressions rely on one developer's discipline and a local game-data copy. Scripts have silently rotted (DOCS-007), and `src/version.ts` was wrong at two tags (DOCS-010).
- Remediation: Add a corpus-free CI job after fixing TESTS-003 and AUDIT-002: typecheck, an affordable policy mode, and tests that do not need game data.

### AUDIT-004 — Releases are not gated on tests, and the release process is undocumented and unscripted
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** tools/build.ts:98 gates are typecheck, policy, input-stability, with no tests. Evidence (:86-98) records sourceSha256, no commit. tools/verify/snapshot.ts:38 excludes only .git, .artifacts, dist, so untracked files are hashed. No tarball step in tools or package.json.
- Severity: Medium
- Category: maintainability
- Location: tools/build.ts:61-62, 98, 86; package.json; docs/releases/
- Confidence: traced
- Evidence: Gates are `["typecheck", "policy", "input-stability"]`, with no test step. Nothing in tools/ or package.json produces the published `quake-anthology-1.2.6-linux-x64.tar.gz` (58 MB). Build evidence records a content hash, not a git revision, and the hash covers untracked files because the snapshot walks the working tree. A build from a dirty tree therefore identifies as the same `version`, which is how crash reports became unattributable (APP-009).
- Impact: Published artifacts cannot be traced to a commit from their metadata, nor reproduced from a documented procedure.
- Remediation: Script the release, refuse a dirty tree, record the commit, and run corpus-free tests.

### AUDIT-005 — Build output and snapshots accumulate without pruning
- **Verification (VERIFY-H): confirmed. Final severity: Low.** Measured now: dist 2.5G with 16 entries, .artifacts/snapshots 1.8G with 23 entries, .git 42M, tree 4.3G. tools/build.ts's only rm is on an unpublished candidate (:117).
- Severity: Low
- Category: leak
- Location: tools/build.ts:60, 86; .artifacts/snapshots/; dist/
- Confidence: reproduced
- Evidence: `dist/` holds 16 runtime builds at about 168 MB each, 2.5 GB in total. `.artifacts/snapshots/` holds 23 snapshots at about 75 MB each, 1.8 GB in total, each including node_modules. The working directory is 4.3 GB against 42 MB of `.git`. Nothing prunes either.
- Impact: About 245 MB of disk per build, indefinitely.
- Remediation: Keep the last N builds, and remove the snapshot after a successful build unless asked to keep it.

### AUDIT-006 — Build snapshots copy local credentials and machine paths
- **Verification (VERIFY-H): confirmed. Final severity: Low.** tools/verify/snapshot.ts:37 excludes only .git, .artifacts and dist; :46 refuses only q3key names. .gitignore:18-31 lists the credential names that would be copied. build.ts:90-94 records absolute paths. No such credential file was present in the project root at this check, so exposure is conditional.
- Severity: Low
- Category: security
- Location: tools/verify/snapshot.ts:37-38, 46, 57; tools/build.ts:90-94, 104-106; .gitignore lines for chatgpt.key, other.key, llm.json
- Confidence: traced
- Evidence: The snapshot excludes only `.git`, `.artifacts` and `dist`, and refuses only `q3key`-style names. `.env`, `chatgpt.key`, `other.key` and `llm.json`, which `.gitignore` shows may sit in the project root, are copied into a retained snapshot directory. `build.json` and `quake-typescript.build.json` record absolute local paths such as the Bun executable. The published v1.2.6 tarball was inspected, and it does not contain them.
- Impact: Secrets persist in forgotten directories after being rotated.
- Remediation: Reuse the .gitignore credential patterns in the snapshot refusal, and write relative paths.

### AUDIT-007 — No formatter or general linter, and code density is a measurable problem
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** Measured exactly 13,686 src lines over 160 chars, longest 1,635 across the two cited files, unified-event-codec.ts 400 of 1,056. No formatter or linter config at root.
- Severity: Medium
- Category: maintainability
- Location: repository-wide; examples src/compat/q2/rerelease/layouts.ts (a 1,635-character line), src/console/llm-batch.ts (1,609), src/app/bootstrap/network/unified-event-codec.ts (400 of 1,057 lines exceed 160 characters), src/persistence (10.3% of lines over 160)
- Confidence: reproduced
- Evidence: 13,686 lines exceed 160 characters. Comment density is 1-5% across most of the tree. The policy tool checks type safety, not style, complexity or size.
- Impact: Dense one-liners hide control flow in the most failure-prone code, inflate review cost, and make diffs and blame less useful. Round 1 and 2 reviewers truncated reads at these widths.
- Remediation: Adopt a formatter in a dedicated commit and set size and complexity budgets for new code.

### AUDIT-008 — God objects and extreme functions concentrate risk
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** Declarations verified at runtime.ts:294 and :5123, application.ts:262, :2629, :3977, q2repro.ts:18, rerelease.ts:203. Files are 8,591 and 4,817 lines. Member and cyclomatic counts not recomputed.
- Severity: Medium
- Category: maintainability
- Location: src/app/bootstrap/simulation/runtime.ts:294 (`SharedSimulation`, 8,260 lines, 498 members), :5123 (`step`, 463 lines, cyclomatic 326); src/app/bootstrap/application.ts:262 (`Application`, 4,554 lines, 250 members), :2629 (`prepareAndReplaceWorld`, 617 lines), :3977 (`commands`, 358 lines, cyclomatic 300, nesting depth 17); src/network/q2/codecs/q2repro.ts:18 (a 1,104-line function); src/movement/q2/rerelease.ts:203 (`Pmove`, 753 lines)
- Confidence: reproduced
- Evidence: 42,965 functions, with 210 over 100 lines, 59 over 200, 9 over 500.
- Impact: AUDIT-001, APP-001 and APP-003 live in these bodies. A leak via a shared closure scope is exactly the kind of defect that a 617-line function hides. See SIM-018 and APP-020.
- Remediation: Split along existing seams, starting with world replacement as an explicit transaction object.

### AUDIT-009 — No enforced layering; cycles exist between and inside subsystems
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** Spot checks hold: movement/q3/move.ts:7 imports content/q3/base/game/grapple.ts; core and persistence import each other (2 and 4 files); input/settings/world import content in 9 files. Full cycle counts taken from evidence/architecture-metrics.txt, not recomputed.
- Severity: Medium
- Category: maintainability
- Location: `evidence/architecture-metrics.txt`, sections "Layer dependency edges", "Mutual layer dependencies", "File import cycles"
- Confidence: reproduced
- Evidence: 13 mutually dependent directory pairs, including `compat <-> content` (40/30), `content <-> persistence` (77/6), `app <-> compat` (155/7), `network <-> platform`, `render <-> text`, `core <-> persistence`. Low layers import high ones: `input -> content` (10), `settings -> content` (10), `world -> content`, `persistence -> compat`, `movement/q3/move.ts -> content/q3/base/game/grapple.ts`. There are 12 strongly connected file groups among value imports, the largest being 10 files in `bots/behavior/q3` and 9 in `content/q1`.
- Impact: Subsystems cannot be tested or replaced independently, and initialization order is fragile with cycles. The policy tool guards FFI boundaries, not these.
- Remediation: Add a layer rule to the policy tool with an allowlist of today's edges, then reduce it.

### AUDIT-010 — Dead and test-only code
- **Verification (VERIFY-H): confirmed. Final severity: Low.** evidence/architecture-metrics.txt states 2104 files, 64 unreachable, 4119 lines, 1816 unimported exports and 235 test-only exports. Sample modules have no importers from reachable runtime code per that scan; the counts were not re-derived.
- Severity: Low
- Category: dead-code
- Location: `evidence/architecture-metrics.txt`, sections "Reachability" and "Exports"
- Confidence: reproduced (statically; dynamic imports with literal names are followed)
- Evidence: 64 of 2,104 src modules (4,119 lines) are unreachable from `src/main.ts` and the worker entries. These include the ELF loader and System V guest runtime (about 1,600 lines; GUEST-017), `compat/q3/native`, `compat/q2/rerelease/cgame.ts`, `network/q3/rcon.ts`, `network/services/rank-codec.ts`, and most barrel `index.ts` files. A further 1,816 exports are never imported anywhere, many of them types; 235 exports are imported only by tests. The check treats star imports as using the whole module, so the counts are lower bounds.
- Impact: Readers cannot tell live code from dormant code, and unused security code gives false assurance (NET-029).
- Remediation: Delete or clearly mark dormant modules. Add an unused-export check to the policy tool.

### AUDIT-011 — The test suite cannot be run safely or quickly by anyone, including its author
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** 688 test files; test-rss.log peak 7,287,820 KB; package.json:12 is plain `bun test`. Aggregates TESTS-001/003/004/007; the 30-minute figure and TESTS-001/003/004 were not re-verified here.
- Severity: Medium
- Category: test-gap
- Location: package.json `test`; see TESTS-001, TESTS-003, TESTS-004, TESTS-007
- Confidence: reproduced
- Evidence: See "Test results" in the main report. The suite takes 30 minutes serially at 7.3 GB peak RSS across 688 files, and 59 minutes when a display lets the GL paths run.
- Impact: Combined with the isolation defects in TESTS-001 and APP-008, a developer who runs the tests modifies their real profile and cannot get a green result without a specific local data layout. An unknown number of real regressions can hide among expected failures.
- Remediation: Fix corpus discovery in one helper, make user roots mandatory in tests, and split corpus, GL and unit tiers into scripts.

### AUDIT-012 — License attribution is inconsistent across ported files
- **Verification (VERIFY-H): confirmed. Final severity: Info.** Re-counted: 1058 of 2104 files have no copyright, license, SPDX or GPL text in their first 2 KB; 232 use SPDX. classic.ts:3 follows imports. This is a provenance observation, and the audit has shown no attribution defect, so Info.
- Severity: Low
- Category: docs
- Location: README.md:176-179; for example src/movement/q2/classic.ts:3 places the header after imports, while 1,058 of 2,104 src files carry no copyright or license text in their first 2 KB
- Confidence: reproduced (count); plausible (legal significance)
- Evidence: The README says existing source headers retain attribution, and many ported files do have one-line notices, using several different formats. Only 232 use SPDX. Some files without a header are likely original work or data tables derived from GPL sources; this audit did not classify them. This is not legal advice.
- Impact: Provenance of tables and ported logic is hard to establish later. CONTENT1-016 and CONTENT2-017 note tables with partial provenance.
- Remediation: Standardize on an SPDX line, applied by a script with a reviewed list, and add a third-party notices file.

### AUDIT-013 — Generators live in the wrong places and have no recorded inputs
- **Verification (VERIFY-H): confirmed. Final severity: Low.** All four files exist. generate-tables.ts has no reference from src, tools, tests or package.json; generate-mg3-monster-resources.ts:3-4 requires an external donor; profile-frame.ts:17 defaults to a home path.
- Severity: Low
- Category: maintainability
- Location: src/content/q2/rerelease/monsters/generate-tables.ts (unreachable, in src); tools/content/generate-mg3-monster-resources.ts:3; docs/functional-targets/group-remaining.ts; tools/profile-frame.ts:17
- Confidence: reproduced
- Evidence: Output tables are committed but their inputs are not recorded. The MG3 tool needs an external donor directory, the Q2 generator sits in the runtime tree, and `profile-frame.ts` still defaults to one developer's home path.
- Impact: Tables cannot be regenerated, so bugs in them must be fixed by hand.
- Remediation: Move generators to tools/, document inputs and hashes, and remove the default path.

### AUDIT-014 — Performance observations with real data
- **Verification (VERIFY-J): confirmed. Final severity: Info.** docs/reviews/2026-11-01-full-audit/evidence/soak-q3.log shows median step 12.09 ms and travel about 6.7-6.9 s in the final cycles, up to 9.3 s max; soak-q1.log shows travel about 0.5-0.7 s. --version and compiled binary figures not re-run.
- Severity: Info
- Category: performance
- Location: `evidence/soak-*.log`
- Confidence: reproduced
- Evidence: On this machine, Q1 and Q2 dedicated steps cost about 1.4 ms. Q3 with 4 bots costs 12-15 ms per step. A dedicated map travel takes about 0.5 s for Q1 and Q2 and 7-9.5 s for Q3 with bots. A Q1 hidden client with the CPU renderer takes 4.3-5 s per travel. Dedicated baseline RSS is about 400 MB for Q1 and Q2 and 680 MB for Q3. `--version` runs in 64 ms from source and 565 ms from the 137 MB compiled executable, and `--list-content` in 615 ms.
- Impact: The Q3 travel stall is the largest user-visible number here and blocks the server's frame loop while it happens. Worth profiling; no cause was established.
- Remediation: Profile Q3 travel, separating bot asset loading (BOTS-012) from the world load.

### AUDIT-015 — The title art reproduces the Quake logo and id characters, and only one image records its origin
- **Verification (VERIFY-M): confirmed-with-changes. Final severity: Medium.** Viewed title.png: Quake Q logo with a small registered-style mark, QUAKE ANTHOLOGY, Q3-style emblem on a banner, Shambler-like creature, marine. Bundled by splash.ts:1, with no origin record; README has no trademark or non-affiliation text. Corrections: docs/ui-art-review.md:48-68 records prompts for the menu background, panel and focus frame, so only title.png lacks a record. README:176-179 scopes GPL to "Engine code", not project-wide. Legal significance not assessed.
- Severity: Medium
- Category: docs
- Location: assets/ui/title.png; assets/ui/main-menu-background.prompt.md; src/app/bootstrap/splash.ts; README.md:1-16, 176-179
- Confidence: reproduced (viewed the images); plausible (legal significance)
- Evidence: Each PNG was viewed. `title.png`, shown on the splash screen and bundled into the release executable, shows the Quake "Q" logo with a registered-trademark mark, the words "QUAKE ANTHOLOGY", a Quake III-style emblem on a banner, and creatures and a marine resembling id characters. `main-menu-background.prompt.md` records that the main menu background is generated art. No equivalent record exists for `title.png`, `menu-background.png`, `menu-panel.png` or `menu-focus.png`, and docs/ui-art-review.md does not cover the title (DOCS-018). The README says game data is not included and that the engine is GPL, but says nothing about this art, its license, or trademarks. This is not legal advice.
- Impact: A public repository and published binaries distribute a third party's logo under a project-wide GPL statement. The rights holder could object, and contributors cannot tell what terms the art is under.
- Remediation: Get legal input on the name and logo, consider art that does not use the logo, record the origin and license of every asset, and add a non-affiliation and trademark notice to the README.

### AUDIT-016 — Tests that only run with a display fail at HEAD, and a test depends on Bun's reporter output
- **Verification (VERIFY-M): confirmed-with-changes. Final severity: Low.** Reproduced under dummy drivers: window-runner.test.ts:44 output holds only totals; display-preferences.test.ts:45 fullscreen false; monster-roster fails at :108 loadApplicationContent with QTS_TEST_CORPUS set (no --content-root at :97). Traced: prepared-startup.ts:81, :118 registers connect, disconnect, quit first, so startup.ts:621-627 prints "already defined" (commands/index.ts:451-452) and the prepared forwarder wins. Corrections: window-runner's dummy subtest has no gate and no bunfig exclusion, so it is not display-only or invisible in `bun test`. video-settings and q3-selected-clock were not run (need real GL).
- Severity: Low
- Category: test-gap
- Location: tests/first-playable/application/q3-selected-clock.test.ts:48; tests/first-playable/application/video-settings.test.ts:75; tests/platform/window-runner.test.ts:44; tests/settings/display-preferences.test.ts:45; tests/content/catalog/monster-roster.test.ts:96-98; src/core/commands/index.ts:453
- Confidence: reproduced
- Evidence: Run under a private X display with real OpenGL:
  - `q3-selected-clock` failed repeatably on both products, printing `Cmd_AddCommand: connect already defined`, and the same for `disconnect` and `quit`. The test asserts this does not happen, so with selected Q3 presentation these commands register twice at HEAD. Which owner wins was not traced.
  - `video-settings` failed repeatably because a saved 800x600 display returns as width 686. This is a test assumption, not a product bug. Printing the values at `src/app/bootstrap/image-settings.ts:214-216` showed SDL reporting desktop bounds of 686x890 for the private Xwayland display, as `xrandr` also did, and the product correctly clamped the restored window with `Math.min(width, desktop.width)`. The test needs a display at least 800 wide, or should set its bounds.
  - `window-runner` looks for a test name in captured output, but Bun 1.3.14 prints only totals when stdout is not a terminal, so its dummy-driver subtest fails on any machine.
  - `display-preferences` is gated to the dummy driver and asserts fullscreen, which the dummy driver did not report here. It therefore fails only in runs with that driver, and it was skipped in the final display run.
  - `monster-roster` discovers its catalog from `QTS_TEST_CORPUS` but launches with no `--content-root`, so mount paths differ. It fails unless the two roots are spelled identically.
- Impact: These failures are invisible in normal runs, because display tests are opt-in (TESTS-007). The first is a real, if minor, behavior regression; the rest are test defects.
- Remediation: Fix command registration ownership, query the reporter in a structured way, and pass the corpus root consistently.

### AUDIT-017 — Real OpenGL client confirms the map-change leak and steady frame costs
- **Verification (VERIFY-M): confirmed-with-changes. Final severity: Info.** <scratchpad>/soak-q1-gl.log matches: heap 233.8 to 425.2 MB, 24 MB per map, RSS 1388 to 1891, about 25 ms per step, about 2.2 s per travel. soak-q1-client.log CPU figures: 84-96 ms per step and 4.3-5.0 s per travel, in line with the finding. Correction: the cited `evidence/soak-q1-gl.log` is absent from docs/reviews/2026-11-01-full-audit/evidence/, so it should be published. The soak was not re-run, and the log itself does not show the renderer used.
- Severity: Info
- Category: performance
- Location: `evidence/soak-q1-gl.log`; see AUDIT-001
- Confidence: reproduced
- Evidence: A hidden Q1 client using the real GL renderer at 640x480, under a private display, retained 233.8 MB rising to 425.2 MB of heap over 8 map changes (24 MB per map), and RSS rose from 1,388 to 1,891 MB. Steady state cost about 25 ms per step and map travel about 2.2 s, against 85-95 ms and 4.3-5 s with the CPU renderer at 320x240.
- Impact: Confirms that AUDIT-001 is not specific to the dedicated or CPU paths.
- Remediation: None beyond AUDIT-001.

### AUDIT-018 — The published release archive contains only the executable, with no license text or source offer
- **Verification (VERIFY-M): confirmed. Final severity: Medium.** Not independently re-listed: <scratchpad>/tar is empty, no copy exists on disk, and the network is off limits, so the one-entry listing and digest are carried from the original. Could not disprove: tools/ has no packaging step that adds LICENSE or notices (no tar use), and docs/releases/1.2.1.md describes extracting and running `./quake-typescript`. Legal significance not assessed.
- Severity: Medium
- Category: docs
- Location: quake-anthology-1.2.6-linux-x64.tar.gz (SHA-256 matches the published GitHub asset digest prefix `afdea94d`); LICENSE; README.md:176-179
- Confidence: reproduced
- Evidence: `tar tzvf` lists one entry, `quake-typescript`. There is no LICENSE, no notices, no README and no written source offer. GPL version 2 section 1 asks distributors to give recipients a copy of the license, and section 3 covers access to source. The GitHub release page and repository do link to source, which may address part of this. This is not legal advice.
- Impact: A recipient of the archive alone gets no license or attribution, including for the id Software code and the IJG-derived JPEG code the project credits in `src/formats/images/IJG-LICENSE.md`. Users also get no instructions, native library list or game-data guidance inside the archive.
- Remediation: Add LICENSE, third-party notices, README and a source pointer to the release tarball, as part of the scripted release in AUDIT-004.
