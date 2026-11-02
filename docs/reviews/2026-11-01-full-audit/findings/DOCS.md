# DOCS — Documentation accuracy, staleness, and coverage (README, docs/**, in-tree .md, NATIVE_INTERPOSITION_REPORT.md, inline API docs)

## Coverage

The doc set is 2.1 MB. The brief asks for every doc to be read. I did not read every doc end to end. The three largest ledgers alone are ~890 KB. Those docs were covered by scripts plus sampling, as listed here.

Read in full:
- README.md (179 lines), docs/README.md (33), docs/getting-started.md (102), docs/playing.md (149), docs/content-layout.md (137), docs/console-and-llm.md (77), docs/networking-unified.md (21), docs/remaining-work.md (28)
- docs/functional-targets/status.md (269), docs/project-status-current.md (297), docs/implementation-checklist.md (155)
- docs/foundation.md (165), docs/contracts.md (45), docs/mod-held-models.md (39), docs/native-primary-declarations.md (70), docs/ranking-services.md (27), docs/console-source-parity.md (48)
- all 19 docs/releases/*.md (~1,100 lines)
- src/app/bootstrap/README.md (40), assets/ui/main-menu-background.prompt.md (7)
- Code checked against: src/app/bootstrap/options.ts (329), src/content/roots.ts (153), src/app/bootstrap/match-modes.ts (52), src/app/bootstrap/match-preflight.ts (32), src/main.ts (98), tools/build.ts (135), package.json

Read in part:
- docs/mod-compatibility.md: lines 1-249, 300-304, 403-412, 431, 470-482 of 482
- NATIVE_INTERPOSITION_REPORT.md: lines 1-110, 1804-end, and all section headers, of 1904
- docs/functional-targets/README.md: lines 1-10 and 90-124 of 124

Sampled (first ~12 lines truncated at 520 chars, plus targeted greps):
- docs/execution-status.md (935), docs/completion-status.md (969), docs/menu-source-comparison.md (1735)
- docs/comparison-q1.md, docs/comparison-q2.md (678), docs/comparison-q3.md
- docs/project-plan.md, docs/project-status-2026-09-11.md, docs/implementation-priorities.md (514), docs/reference-contracts.md
- docs/source-assessment.md, docs/source-inventory-reconciliation.md, docs/feature-coverage.md, docs/verification-plan.md
- docs/tick-execution.md, docs/functional-targets/performance.md, docs/functional-targets/integration-20260918.md, docs/functional-targets/remaining-source-rows.md
- docs/research/*.md, docs/ui-art-review.md, docs/reviews/2026-10-27-code-review.md
- src/guest/**/README.md and src/content/q1/foundation/README.md (first ~18 lines, truncated)

Script-only (every tracked .md plus the untracked report): relative links and anchors (4,213 links), line-number link targets (1,689), backticked path existence, CLI flag extraction, env var extraction, orphan detection, banner keyword scan. Line-number and orphan results depend on those scripts' heuristics.

Skipped: src/formats/images/IJG-LICENSE.md (vendor license), docs/functional-targets/remaining-source-rows.json (153 KB data, not reviewed beyond existence), docs/functional-targets/group-remaining.ts (first 30 lines read, then executed).

Not checked: GitHub URLs and release assets were not fetched, because the brief forbids off-localhost requests. Whether the README's release tarball exists and how it is laid out is unverified.

## Strengths

- README and getting-started are accurate on the main facts. The content-root search order (own folder, parent, Steam, stop at first anchor) matches src/content/roots.ts:141-152. `--steam` is Steam-only as stated. Gamma 0.5 to 3 with default 1 matches options.ts:242 and rejected 0.49 and 3.01 when run. Renderer default gl and Linux-only build are correct. The cited product IDs (`q3-baseq3`, `q1-classic-id1`, `q2-classic-baseq2`, `q2-rerelease-baseq2`) exist in src/content/catalog/products.ts, and `q3-classic-lrctf` is used by tests.
- `--help` lists every flag the parser accepts. The only exception is the `-h` alias.
- Relative file links are almost entirely sound: 1 dead link outside `.artifacts`, 5 bad heading anchors. The 198 `#gNN` links in comparison-q2.md resolve through explicit `<a id>` tags.
- Menu and command labels named in the user guides were all found in src (Play a game, Map set, Hook style, LLM options, Paste API key, Autosave on level load, modcmd, llm_exec, `qts://`, and others). `Kit` was the only label with no literal match, and I did not trace how that section is labelled.
- docs/README.md, project-status-current.md and implementation-priorities.md state that dated reports are historical, and evidence docs are careful about what a check does not prove.
- Every tag v1.0.0 to v1.2.6 has a matching release note and package.json version. The main-menu prompt's recorded SHA-256 matches the PNG on disk. foundation.md's `bench:foundation` command exists.

## Findings

### DOCS-001 — README's "Dedicated server" example never opens a listening socket
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** README.md:128-129 passes no listener; options.ts:291 sets network only with listen; application.ts:1831-1834 returns early for non-server selections. Not launched.
- Severity: Medium
- Category: docs
- Location: README.md:127-129, src/app/bootstrap/README.md:10, src/app/bootstrap/options.ts:291, src/app/bootstrap/application.ts:1831-1834
- Confidence: traced (the parser half was reproduced)
- Evidence: README shows `# Dedicated server, no window` with `./quake-typescript --content-root /path/to/games --game q1-classic-id1 --map e1m1 --mode deathmatch --dedicated`. No `--listen*` flag is passed. `options.ts:291` sets `network` only when `listen !== null`. Running the parser with `--dedicated --game q1-classic-id1` returned `{"kind":"offline"}`. `openNetwork` then returns early for any selection that is not a server: `if (selection.kind !== "q2-server" && selection.kind !== "native-server") { ...; return; }`.
- Impact: A user following the only server example in the README gets a headless process that no client can reach, and no "Listening" message. I traced this and did not launch it with game data.
- Remediation: Add `--listen 26000` to the README example and add a listener to the bootstrap README example. Consider having `--dedicated` without a listener warn or default to a port.

### DOCS-002 — LLM credential location is documented wrongly in two user guides
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** console-and-llm.md:65-77 and content-layout.md:87-88 say beside the executable; src/main.ts llmSettingsDirectory uses the shared settings dir; main.ts:55-62 copies with COPYFILE_EXCL and never deletes the legacy plaintext files.
- Severity: Medium
- Category: docs
- Location: docs/console-and-llm.md:65-77, docs/content-layout.md:87-88, src/main.ts:26, src/main.ts:55-62, docs/releases/1.1.1.md
- Confidence: traced
- Evidence: console-and-llm.md says "For a compiled executable, these files live beside the executable. When running source, they live in the working directory" and "These locations are separate from the game's writable content, saves, and settings." content-layout.md says "LLM credentials and preferences use separate executable-directory rules". The code does the opposite: `llmSettingsDirectory()` returns `resolve(dirname(defaultUserContentRoot()), "settings")`, and the comment reads "LLM credentials ... live with the other shared settings". The 1.1.1 release note announced this move. The executable-side path is now only a legacy copy source, using `copyFileSync(..., COPYFILE_EXCL)`.
- Impact: Users looking for OAuth refresh tokens and API keys to back up, rotate or delete look in the wrong place. Migration copies and does not delete, so the old plaintext files stay beside the executable. The docs give no hint that both copies exist, which is a credential-handling gap.
- Remediation: Rewrite both passages to name `~/.local/share/quake-typescript/settings/` and state that legacy files are copied and left behind.

### DOCS-003 — The designated "current status" pages stopped at 1.0.0, 18 releases ago
- **Verification (VERIFY-G): confirmed. Final severity: Low.** status.md and remaining-work.md last changed 5d6c6e31 (2026-09-26); execution-status.md 949c337c (2026-10-17); docs/README.md:32 calls them current. Lowered: stale internal status with no runtime or user-task impact.
- Severity: Medium
- Category: docs
- Location: docs/README.md:25,32, README.md:171, docs/getting-started.md:82, docs/functional-targets/status.md:3-5, docs/execution-status.md:5, docs/remaining-work.md:3-13
- Confidence: traced
- Evidence: docs/README.md:32 says "Use the target status and installed-build pages for current completion claims." status.md:3 opens "**1.0.0 is the accepted release scope.**" and execution-status.md:5 opens "Release `v1.0.0` includes the accepted runtime through `563f0a99`". By git log, status.md and remaining-work.md were last changed 2026-09-26 (commit 5d6c6e31). execution-status.md was last touched by the 2026-10-17 path scrub. HEAD is v1.2.6 plus 11 commits. remaining-work.md still gives "41.23 ms native and 45.55 ms per application step" as the latest measurement and says "No other implementation item is currently identified". Later notes record further known issues (DOCS-010) and major work such as the 1.1.8 black-box guests and 1.2.1 unified hosting.
- Impact: A contributor following the index gets a five-week-old project state presented as current. None of the status pages mentions any 1.1.x or 1.2.x release.
- Remediation: Add a dated banner to each page naming its cutoff, or replace them with one short maintained status page.

### DOCS-004 — Status documents contradict each other, and status.md contradicts itself
- **Verification (VERIFY-G): confirmed. Final severity: Low.** status.md:3 says 22/23 and :59 says 21/23; :20 Complete vs :259 Reopened; completion-status.md:10 293/184 vs project-status-current.md:15 288/189; that file's title is "Historical". Lowered for the same reason as DOCS-003.
- Severity: Medium
- Category: docs
- Location: docs/functional-targets/status.md:3,18,20,59,61,259, docs/functional-targets/README.md:5, docs/functional-targets/integration-20260918.md:10, docs/completion-status.md:5,306-307,491-492, docs/project-status-current.md:15, docs/project-status-2026-09-11.md, src/app/bootstrap/startup-selection.ts:376, src/app/bootstrap/save-requests.ts:4-5
- Confidence: traced
- Evidence:
  - Target count: status.md:3 says 22/23 with T12 complete. Line 59 says "target totals are 21/23" and sits above the "Earlier implementation checkpoints" heading at line 61, so it reads as current. Lines 65-89 repeat 21/23 but are under that heading. status.md:259, outside that section, says of T12 "**Reopened September 18; still active.**", while status.md:20 says "Complete in accepted source". integration-20260918.md:10 still says T12 "Reopened".
  - T10's open item: status.md:18 and remaining-work.md call it performance only. functional-targets/README.md:5 says "T10 mod interoperability remains active".
  - Requirement counts: completion-status.md gives 293 done / 184 open. project-status-current.md:15 gives 288 / 189. project-status-2026-09-11.md gives "0/477 formally accepted" and "1/74" packages. Each states a different cutoff, but nothing tells the reader which to use.
  - Ledger against code: completion-status.md:491-492 says Tag and DeathBall are not done because "startup exposes no actual Tag/DeathBall launch", yet startup-selection.ts:376 builds those presets and `--rules` accepts them. completion-status.md:306-307 marks Q1 v5/v6 saves not done, while status.md T16, playing.md:132-133 and save-requests.ts accept `v5|v6`.
  - Naming: `project-status-current.md` is titled "Historical project status at 98074c6e".
- Impact: No two status pages can be read together without knowing commit-level history. Someone auditing completion can quote any of 21/23, 22/23, 61.4% or 0/477, and each is defensible from the tree.
- Remediation: Pick one authority. Move the rest under `docs/archive/` with a superseded banner, and rename `project-status-current.md`.

### DOCS-005 — playing.md says DeathBall, LMCTF and generic CTF need authored or Threewave content; code synthesizes them on every world
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** playing.md:49-52 contradicts match-modes.ts:26-44 and releases/1.1.5.md:10-14. Foreign DeathBall and LMCTF need only deathmatch spawns; CTF comment says bases synthesize on every world. matchMapUnavailable not re-run.
- Severity: Medium
- Category: docs
- Location: docs/playing.md:45-52, src/app/bootstrap/match-modes.ts:26-44, docs/releases/1.1.5.md, commits e610c9a2, b8b464ad, fbabc9a2
- Confidence: reproduced
- Evidence: playing.md:49-52 says "**Capture the Flag** runs natively in Quake II and Quake III on maps with authored flags; Quake uses the Threewave Capture the Flag product." and "**DeathBall** and **Loki's Minions CTF** are Quake II modes and need their authored Quake II maps." The 1.1.5 notes say the reverse: "Loki's Minions CTF and Rogue DeathBall now play on every game ... Objectives synthesize from deathmatch spawns". I called `matchMapUnavailable` with only `info_player_deathmatch`: Q1 DeathBall, Q3 LMCTF, Q1 CTF and Q2 CTF all returned null (available). match-modes.ts:37 comments "Foreign LMCTF synthesizes flag bases" and line 42 says "on every world".
- Impact: The user guide tells players that features advertised since 1.1.5 do not exist. This is the guide's description of its match-rules menu.
- Remediation: Rewrite the Match rules list from match-modes.ts. See DOCS-006 for the Horde line in the same list.

### DOCS-006 — playing.md's "campaign monster waves in Quake II" conflicts with the Horde preflight on TypeScript Q2 worlds
- **Verification (VERIFY-H): confirmed. Final severity: Low.** match-modes.ts:34-35 refuses without horde_manager. horde.ts:94 also does nothing without a manager, and nothing in src synthesizes one for Q2. docs/playing.md:45-46 is therefore wrong for TypeScript Q2. No launch was run.
- Severity: Low
- Category: docs
- Location: docs/playing.md:45-46, src/app/bootstrap/match-modes.ts:34-35, src/app/bootstrap/match-preflight.ts:15,29
- Confidence: plausible (the check is reproduced; the runtime launch is not)
- Evidence: `matchMapUnavailable({family:"q2",mode:"coop",rules:"horde",...}, ["worldspawn","info_player_start","monster_soldier"])` returned "Horde requires an authored horde_manager and monster spawn points". The preflight runs that check only when `execution?.kind === "typescript"`, so guest DLL worlds skip it.
- Impact: Horde on an ordinary Q2 campaign map with TypeScript execution appears to be refused despite the guide's description. Needs a real launch with game data to confirm, or a decision on which side is wrong.
- Remediation: Run `--rules horde` on Q2 base1 with a corpus, then correct the doc or the preflight.

### DOCS-007 — npm scripts and docs commands point at deleted paths and fail when run
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** package.json:14, :15, :18, :21 target missing paths; tools/reference, tests/verification, docs/validate-plan.ts, docs/completion-status.json, tools/inventory all absent; tools/build.ts:50 and :55 abort on the first entry. Failure confirmed by path check, not by running the scripts.
- Severity: Medium
- Category: docs
- Location: package.json:14,15,18,21, tools/build.ts:50,55, docs/functional-targets/README.md:124, docs/functional-targets/remaining-source-rows.md:357, docs/source-inventory-reconciliation.md:85, docs/contracts.md (policy command not run)
- Confidence: reproduced
- Evidence: Run from the clean checkout:
  - `bun run reference:environment`: `Module not found "tools/reference/environment.ts"`, exit 1.
  - `bun run test:reference` and `bun run test:verification`: bun test finds no tests, exit 1.
  - `bun run build:tools`: `Build failed: Build entry is missing: docs/validate-plan.ts`, exit 1.
  - `bun docs/functional-targets/group-remaining.ts`: ENOENT, because its default input `docs/completion-status.json` was deleted.
  - Commit 949c337c removed tools/reference, tests/verification, docs/validate-plan.ts and completion-status.json, and did not update these entries.
  - `bun tools/inventory/merge-integration-candidates.ts` in source-inventory-reconciliation.md:85 also targets a deleted directory.
  - tools/build.ts:55 still prints "W73 owns the real application entry", a work-package ID from the retired plan.
- Impact: Four of the 14 scripts in package.json are broken. `build:tools` cannot build any of its other three tools because the first entry aborts the build.
- Remediation: Remove the three dead scripts and the validate-plan entry, and delete the stale regeneration instructions.

### DOCS-008 — docs/functional-targets/group-remaining.ts is unrunnable code stored in docs and typechecked as part of the project
- **Verification (VERIFY-H): confirmed. Final severity: Low.** File is 17,343 bytes; tsconfig.json:26 includes **/*.ts; docs/completion-status.json does not exist, though remaining-source-rows.md:357 names it as the default input.
- Severity: Low
- Category: maintainability
- Location: docs/functional-targets/group-remaining.ts (17,343 bytes), tsconfig.json `"include": ["**/*.ts"]`, docs/functional-targets/remaining-source-rows.md:357
- Confidence: reproduced
- Evidence: It fails with ENOENT as described in DOCS-007. tsconfig's `**/*.ts` include pulls it into every typecheck and it is outside `tools/`. Its input, `docs/completion-status.json`, can only be recovered from git history. Its output is explicitly a frozen 2026-09-15 mechanical grouping.
- Impact: A dead generator is maintained by every typecheck and implies that the frozen table can be regenerated.
- Remediation: Delete it and keep the JSON and MD as a historical artifact, or move it to tools/ and restore its input from git history.

### DOCS-009 — 232 evidence links point into gitignored `.artifacts` and none resolve, and 1,689 line-number links are not pinned to a commit
- **Verification (VERIFY-G): confirmed-with-changes. Final severity: Low.** .gitignore:3 ignores .artifacts; menu-source-comparison has 1,673 line links; implementation-checklist.md:99 -> application.ts:132 is the nativeAtoi import. Corrections: .artifacts/snapshots now holds build-* directories; raw mention counts are 157 and 33 where the finding lists 137 and 28 links. Lowered: docs-only.
- Severity: Medium
- Category: docs
- Location: docs/execution-status.md (137 links), docs/functional-targets/status.md (46), docs/functional-targets/performance.md (28), docs/functional-targets/integration-20260918.md (15), docs/console-source-parity.md (6), docs/menu-source-comparison.md (1,673 line links), docs/implementation-checklist.md:99-131 (16), .gitignore:3
- Confidence: reproduced
- Evidence:
  - `.artifacts` links: 232 of 232 are missing even on the development machine, where `.artifacts/` now contains only an empty `resume-20260913` and `snapshots`. status.md calls some "machine-local". Most of the acceptance evidence those docs rely on is therefore unavailable to anyone, and the docs' core claims ("passed N assertions") cannot be checked.
  - Line links: none is pinned to a SHA. Of 1,689 targets, 284 are blank lines, 225 are lone closing tokens and 166 are import lines, so at least 675 (40%) cannot be what the link describes.
  - Examples: implementation-checklist.md:99 "Application constructs EngineSession" links to application.ts#L132, which is `import { nativeAtoi } ...`. Line 106 "Foreign Q3 holdables" links to runtime.ts#L401, `private selectedQ3Next = 0;`. "NativeRenderer" links to renderer.ts#L14, while the class is at line 82. "prepareSelectedMonsters" links to runtime.ts#L508, while the method is at line 1355. menu-source-comparison's "seven-action list" links to a blank line, ui.ts#L115.
- Impact: The doc set's evidentiary backbone cannot be followed, and readers are sent to unrelated code.
- Remediation: Rewrite line links to commit-pinned permalinks using the doc's stated baseline. Mark `.artifacts` links as plain text "evidence not retained", or drop them.

### DOCS-010 — Known issues disappear from release notes with no resolution, and some features ship unannounced
- **Verification (VERIFY-H): confirmed. Final severity: Low.** src/version.ts is 1.1.9 at both v1.1.10 and v1.2.0. The four commits are ancestors of v1.1.10, and its notes do not mention movement or characters. Known-issue sections end at 1.1.6. HEAD is 11 commits past v1.2.6 at version 1.2.6.
- Severity: Low
- Category: docs
- Location: docs/releases/1.1.3.md, 1.1.4.md, 1.1.5.md, 1.1.6.md, 1.1.7.md, 1.1.10.md, git history of v1.1.10 and v1.2.0
- Confidence: traced
- Evidence:
  - Dropped issues: 1.1.3 lists Q3 `give`/`giveall` not granting items and the Brain power screen mishandling foreign shots. 1.1.5-1.1.6 list foreign Tag/LMCTF/DeathBall state missing from saves, mid-level KEX saves refused, unverified QW expansion launches and the unified HUD. From 1.1.7 on, "Known issue" sections are gone with no resolution stated. A git log search for fixes found only candidates for give, and I did not establish that any of these issues is fixed or still open.
  - Unannounced work: v1.1.10 contains db69fc92, d6874ea9 and e1c8620a (foreign movement and characters on native Q2 worlds) and fbabc9a2 (shared CTF on every world). The 1.1.10 notes mention enemies, travel and custom guests only.
  - Version string: `src/version.ts` at tags v1.1.10 and v1.2.0 is `"1.1.9"`, so those releases report the wrong `--version`.
  - "--steam": notes 1.1.1-1.1.10 say "`--steam` to search Steam first". The code (already `steamOnly` at v1.1.0) searches only Steam.
  - Unreleased: B1-B4 and PERF1-3 are at HEAD with package version still 1.2.6, so a build from HEAD identifies itself as 1.2.6.
- Impact: Users cannot learn the state of a previously disclosed defect, and the notes understate what shipped.
- Remediation: Add a "resolved/still open" line for each carried issue and an unreleased section. Bump or suffix the dev version.

### DOCS-011 — mod-compatibility.md and the bootstrap README describe gates removed in later releases
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** mod-compatibility.md:136 conflicts with releases/1.1.8.md:21 and simulation/runtime.ts:3324; no docs/*.md mentions black box; bootstrap README:34 says unified networking is separate work though options.ts:104 has --listen-unified.
- Severity: Medium
- Category: docs
- Location: docs/mod-compatibility.md:3,136,228,411, docs/releases/1.1.7.md, docs/releases/1.1.8.md, src/app/bootstrap/README.md:32,34,40, src/content/q1/quakec/weapon-stage.ts:92, src/app/bootstrap/simulation/runtime.ts:3324
- Confidence: traced
- Evidence: mod-compatibility.md was last changed by the 2026-10-17 path scrub, before these lines could reflect later behavior.
  - mod-compatibility.md:136: "Shared equipment on a native primary game needs that module's original combat interface ... Unknown private layouts remain unsupported". 1.1.8 notes: "hook and offhand-grenade equipment no longer require a qualified guest combat interface to launch". runtime.ts:3324 has "Without a qualified primary weapon interface the guest runs as a black box".
  - mod-compatibility.md:228: "does not qualify altered programs, QuakeWorld or original QVM/native-primary selected arsenals", and line 411 excludes "mixed native primary movement/character combinations". 1.1.7-1.1.10 and `qcDerivedWeaponStage` (weapon-stage.ts:92) now derive the QC stage without declarations, and commits db69fc92 and e1c8620a add native movement and characters. The term "black box" does not appear in any docs/*.md.
  - The doc's status lines may be partly right for "deep" integration, but the user-visible refusal it describes is gone and the fallback behavior is undocumented.
  - mod-compatibility.md:3 sends readers to the "README's recommended layout", which now lives in content-layout.md. playing.md:72 links "the project's fidelity requirement" to a README with no such section.
  - bootstrap README:34: "Unified mixed-game networking remains separate work", though `--listen-unified` exists. README:32: "Native Quake III whole-game checkpoints ... report an error", though implementation-checklist.md:108 records a667293 joining native Q3 saves. README:40: "This entry point is still receiving source provider joins."
- Impact: Mod authors read that they must author a complete artifact-bound profile when the engine has a black-box path, and cannot learn what black-box mode does or does not do.
- Remediation: Add a section describing qualified versus black-box guest behavior, and fix or date the listed sentences.

### DOCS-012 — NATIVE_INTERPOSITION_REPORT.md's verdict describes a tree that is 78 commits old
- **Verification (VERIFY-H): confirmed. Final severity: Low.** fbabc9a2..HEAD is 78 commits; `git diff --stat HEAD -- src` is empty; both named files are absent; native-commands.ts was added in db69fc92. Report lines 54, 84 and 1815 match.
- Severity: Low
- Category: docs
- Location: NATIVE_INTERPOSITION_REPORT.md:13-23,54-63,84,1815-1850
- Confidence: traced
- Evidence: The basis is HEAD `fbabc9a2` plus an uncommitted 8-file experiment. fbabc9a2 is an ancestor of HEAD, with 78 commits since. `git diff --stat HEAD -- src` is empty, so no dirty tree exists. The untracked `native-commands.ts` it names is now committed (db69fc92). The headline "launch refusal" and the table's "NOT REAL" for character and enemies are overtaken by commits e1c8620a ("Foreign characters stand in native Quake II worlds") and 0898e0f8 plus the 1.1.10 notes. It names `src/compat/q2/classic/foreign-actors.ts` and `src/app/bootstrap/source-program.ts`, which do not exist at HEAD. Line 84 holds a local absolute path. Nothing links to it, and it has no date or banner. Its recommendations include restoring "honest refusal", the opposite of what shipped. I did not re-derive whether each per-lane verdict is now true.
- Impact: Low while untracked, but if committed or read as current it misstates native guest capability. Its open items, such as the door freeze, dual-run trajectory test and save/restore of foreign selections, may still be useful and have no tracked home.
- Remediation: Do not commit as is. Add a dated basis banner, re-verify the lanes, and move still-open items to a tracked issue or doc.

### DOCS-013 — Stale planning and audit docs have no superseded banner and describe deleted infrastructure
- **Verification (VERIFY-H): confirmed. Final severity: Low.** Cited lines match at verification-plan.md:3, source-assessment.md:3, project-plan.md:3, comparison-q2.md:3 and reference-contracts.md:37. verification/, work-packages.json and dependency-graph.mmd are absent. I count 12 docs with the placeholder outside the audit directory, not 13.
- Severity: Low
- Category: docs
- Location: docs/verification-plan.md:3,95-98, docs/source-assessment.md:3, docs/project-plan.md:3, docs/comparison-q2.md:3, docs/comparison-q1.md, docs/execution-status.md, docs/reference-contracts.md:37, docs/console-source-parity.md, docs/feature-coverage.md
- Confidence: traced
- Evidence:
  - verification-plan.md:3 says "The separate machine work graph is the dependency authority", though the graph was deleted. feature-coverage.md admits this in passing; verification-plan.md does not.
  - source-assessment.md:3 says "Implementation has not started." project-plan.md opens as an active plan ("Implementation is authorized").
  - 20 references across 5 docs cite `verification/` (execution-status 11, comparison-q1 6, others), including comparison-q2.md:3 "193 Q2 feature IDs in verification/features/q2.json". `docs/work-packages.json`, `dependency-graph.mmd`, `validate-plan.ts` and `completion-status.json` are also cited but deleted.
  - Scrubbed placeholders such as `../the Q1 reference port` remain in 13 docs. reference-contracts.md:37 is a command importing from "../the Q1 reference port/...", which cannot run for anyone. Bare `src/...` paths in comparison-q1/q2/q3 mix donor and unified paths: comparison-q2 has 209 of 376 and comparison-q3 207 of 326 path references that do not exist in this tree, and the reader cannot tell which are donor paths without per-section context.
  - The banner scan found 32 of 41 non-release docs without a keyword in the first 8 lines. That scan is coarse and over-counts live guides, but the docs named here have none.
- Impact: New contributors can reasonably read retired plans as active and look for files that were deliberately deleted.
- Remediation: Move them to `docs/archive/` with one banner naming commit 949c337c, and prefix donor paths.

### DOCS-014 — Broken links and anchors in tracked docs
- **Verification (VERIFY-H): confirmed. Final severity: Low.** quake-mixer.ts is absent; the five #installed-build links exist and execution-status.md has no matching heading; all six orphan docs have zero references; only releases 1.0.0 and 1.2.6 are linked.
- Severity: Low
- Category: docs
- Location: docs/comparison-q2.md:288, docs/execution-status.md:620,739, docs/implementation-checklist.md:17, docs/project-plan.md:21, docs/project-status-2026-09-11.md:60
- Confidence: reproduced
- Evidence: comparison-q2.md:288 links `../src/audio/quake-mixer.ts`, deleted in 484b651f. Five links use `#installed-build`, but the headings are "Installed executable and recent fixes" and "Historical installed build". Separately, no doc links to implementation-checklist.md, menu-source-comparison.md, project-status-2026-09-11.md, remaining-work.md, reviews/2026-10-27-code-review.md or ui-art-review.md. Only 1.0.0 and 1.2.6 of the release notes are linked from anywhere.
- Impact: Minor navigation failure. The orphaning matters most for remaining-work.md and the release notes, which readers need to find.
- Remediation: Fix the six links. Add a release-notes index and link remaining-work.md, or retire it.

### DOCS-015 — Missing contributor and operator documentation
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** No CONTRIBUTING, CHANGELOG or SECURITY; QUAKE_*_LIBRARY (native-libraries.ts:8-11) is absent from README/docs outside this audit's reviews; crash.log and QTS_CPU_WORKERS appear only in release notes. docs/verification-plan.md is a completion plan, not a test guide.
- Severity: Medium
- Category: docs
- Location: repository root and docs/ (absent files), docs/networking-unified.md, src/platform/native-libraries.ts:8-11, src/render/cpu/row-parallel.ts:194, src/main.ts:13-24, src/persistence/save-image.ts:13, tools/build.ts
- Confidence: traced
- Evidence: Absent: CONTRIBUTING, CHANGELOG, SECURITY, a current architecture overview, troubleshooting, a save-format doc, a protocol doc, a test guide, a release/packaging process and any CI config (no `.github`).
  - Security: the project runs guest DLLs and QVMs from user content, accepts untrusted network peers and stores OAuth credentials. SECURITY has no replacement in the docs, and nothing states the trust model for running third-party mods or how to report a vulnerability.
  - Architecture: contracts.md and foundation.md cover pieces and bootstrap README is stale (DOCS-011). No page maps the ~376K-line src tree to its subsystems.
  - Save format: `QTSAVE3` appears only in passing in mod-compatibility.md:190.
  - Protocol: `qts://`, `qts:snapshot-v10` and negotiation have no spec. docs/README.md lists only mixed-game hosting, so `--listen`, `--connect-q1/qw/q3`, `--q1-protocol`, `--q2-protocol`, `--ipx-*`, `--server-profile` (including its JSON schema), `--rules`, `--bot-skill`, rcon and dedicated stdin appear only in `--help` or nowhere user-facing.
  - Troubleshooting: `~/.local/share/quake-typescript/crash.log` appears only in the 1.1.0 notes. `QUAKE_SDL2_LIBRARY`, `QUAKE_SDL3_LIBRARY`, `QUAKE_GL_LIBRARY`, `QUAKE_VORBISFILE_LIBRARY`, `QUAKE_THEORA_LIBRARY` and `QUAKE_FREETYPE_LIBRARY` are undocumented, though they are the fix when a library is not found. `QTS_CPU_WORKERS` is only in the 1.2.1 notes. `QTS_NO_DIGEST_CACHE`, `QTS_WORLD_SPACE` and `QTS_STARTUP_TIMING` are undocumented.
  - Tests: README names only `QTS_TEST_CORPUS`. The `QUAKE_DATA_PATH`/`QFILES_ROOT` aliases (tests/support/corpus.ts:11) and about 60 test gates (`QUAKE_GL_SMOKE` is used 15 times, for example) are undocumented, so a contributor cannot tell which tests silently skip.
  - Release: README advertises a tarball, but nothing in tools/ or package.json produces one and no process is written down.
- Impact: Contributors and server operators must read source, and users have no documented answer for the most likely first-run failure (missing native library) beyond installing packages.
- Remediation: Add a one-page architecture map, SECURITY with a mod trust model, troubleshooting with the env vars and crash log, a save and wire-format note, a server guide, and a test guide.

### DOCS-016 — Inline API documentation covers 12.3% of exported declarations
- **Verification (VERIFY-H): confirmed. Final severity: Info.** Re-run of docs-audit/jsdoc.ts reproduces app/bootstrap 10.8% and content/q2 5.4%. It measures presence only and shows no defect, and the finding itself rejects a coverage goal, so Info.
- Severity: Low
- Category: docs
- Location: scratchpad script docs-audit/jsdoc.ts over src/ (TypeScript AST, exported top-level declarations and non-private class methods); examples src/app/bootstrap/application.ts, src/network/services/rankings.ts, src/contracts/*.ts
- Confidence: reproduced
- Evidence: 2,275 of 18,534 exported declarations have a JSDoc block.
  - By kind: classes 52.6%, functions 23.9%, interfaces 6.8%, types 5.8%, public methods 5.4%, enums 4.9%, consts 3.8%.
  - By area: foundation 37.1%, materials 28.5%, core 24.2%, contracts 14.9%, app/bootstrap 10.8%, network 8.0%, llm 7.4%, content/mods 6.1%, content/q2 5.4%.
  - Zero-doc large API files: app/bootstrap/application.ts (0/50), network/q1/constants.ts (0/128), movement/q2/types.ts (0/41). Declarations mod authors are pointed at are thin: contracts/mod-callbacks.ts 1/22, contracts/mods.ts 3/12. network/services/rankings.ts is 1/21 despite ranking-services.md presenting it as the extension point.
  - Scope limit: this is presence only. It says nothing about quality, and it counts constants and ported source identifiers, where a comment adds little. Plain `//` comments are not counted.
- Impact: Limited for internal code. It matters where docs send external authors to read a TypeScript contract as the schema reference (mod-compatibility.md:70,124,126; native-primary-declarations.md:36).
- Remediation: Target the contract files named as schemas first. A blanket coverage goal is not justified.

### DOCS-017 — GitHub URL casing differs from origin, and repo identity varies across docs
- **Verification (VERIFY-J): confirmed. Final severity: Info.** Origin is lowercase; README.md:10,30, getting-started.md:27 and the review doc use Quake-Anthology-TS. foundation.md:4 links quake-anthology, and foundation.md:33-34,143,156 cite THE- tickets.
- Severity: Info
- Category: docs
- Location: README.md:10,30, docs/getting-started.md:27, docs/reviews/2026-10-27-code-review.md:4 and others, docs/foundation.md:4
- Confidence: traced
- Evidence: Origin is `https://github.com/mgd34msu/quake-anthology-ts`. README, getting-started and the review use `.../Quake-Anthology-TS/...`. GitHub normally treats these paths case-insensitively, so they likely work, but I did not test this because off-localhost requests are forbidden. foundation.md:4 links a different repo, `mgd34msu/quake-anthology` (the C project), under the label "Quake-Anthology", and cites private-looking tickets (THE-864, THE-870, THE-2874) readers cannot resolve.
- Impact: Cosmetic unless the repo moves.
- Remediation: Normalize to one spelling.

### DOCS-018 — Smaller factual errors in current docs and CLI help
- **Verification (VERIFY-H): confirmed-with-changes. Final severity: Low.** Parser, foundation, art-review, windows README, profile-frame and prompt items hold (--bot-skill error re-run). Correction: README.md:63-71 is followed by more shapes in prose at :76-79 (single game folder, symlinks), so "shows one shape" overstates it; only the "these shapes" wording is off.
- Severity: Low
- Category: docs
- Location: src/app/bootstrap/options.ts:75,107,294, README.md:63-71, docs/foundation.md:51-54, docs/ui-art-review.md:3, src/guest/runtime/windows/README.md:17, tools/profile-frame.ts:17, assets/ui/main-menu-background.prompt.md:3
- Confidence: reproduced for the parser items, traced for the others
- Evidence:
  - options.ts:75: `Usage: bun run src/main.ts [options]` is printed by the compiled `quake-typescript` too, since main.ts writes `applicationHelp` unchanged.
  - options.ts:294: `--connect-q3 h --bot-skill 2` and `--connect-unified h --bot-skill 2` both fail with "--bot-skill is not a native Quake II client setting", which is misleading for those protocols.
  - README.md:63-64 says "in any of these shapes — all work" and then shows one shape.
  - foundation.md:54: "no per-call `ArrayBuffer`/`DataView` conversion remains in `src/`". Examples of per-call allocation exist, such as src/compat/qvm/module.ts:184 `new DataView(new ArrayBuffer((args.length + 1) * 4))`, although that one is argument marshalling, not the scalar conversion the sentence is about. Treat this as an overbroad wording, not a proven regression.
  - ui-art-review.md:3 covers "Three reusable raster assets". title.png (1.2.5) and main-menu-background.png have no equivalent review entry there.
  - windows/README.md:17 says the tests read `~/Projects/qfiles/q2`, while tests now use QTS_TEST_CORPUS. tools/profile-frame.ts:17 still defaults to `<game-data>`, despite commit 949c337c's statement that hardcoded home paths were removed.
  - The prompt file cites `/tmp/codex-clipboard-yTontn.png`, which cannot be reproduced.
- Impact: Small and individually cheap to fix.
- Remediation: Fix each line. Derive the usage line from `process.execPath` for compiled builds.

### DOCS-019 — The code review doc has no status marker for fixes that landed the same day
- **Verification (VERIFY-J): confirmed. Final severity: Info.** The review doc has no match for fixed, resolved or landed, and its table at :15-21 lists items without status. bde6c9ae confirmed as the B4 fix; other commit IDs not opened individually.
- Severity: Info
- Category: docs
- Location: docs/reviews/2026-10-27-code-review.md:15-21,106, commits 524fe0f4, 03dd5306, fea675d9, bde6c9ae, d54179d9, 7870041d, d746e21a
- Confidence: traced
- Evidence: The findings table lists B1-B4 and PERF1-3 as open and recommends an order of work. The commits named above fix them. The doc is pinned to revision 1b703833, which keeps it honest as a dated record, but it has no pointer to the fixes.
- Impact: Readers may re-investigate closed issues.
- Remediation: Add a one-line resolution column with commit IDs.
