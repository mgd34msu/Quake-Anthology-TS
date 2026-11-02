# DOCS3 — Round 3 READ review: ledgers, comparisons, research, in-tree READMEs and NATIVE_INTERPOSITION_REPORT.md
## Coverage
Read in full, line by line:
- NATIVE_INTERPOSITION_REPORT.md (1904), docs/mod-compatibility.md 250-482, docs/comparison-q1.md (157), docs/comparison-q2.md (678), docs/comparison-q3.md (173), docs/feature-coverage.md (51), docs/source-assessment.md (100), docs/source-inventory-reconciliation.md (88), docs/reference-contracts.md (193), docs/verification-plan.md (103), docs/tick-execution.md (229), docs/ui-art-review.md (71), docs/research/mod-execution.md (153), docs/research/q1-interoperability.md (207), docs/research/q2-interoperability.md (162).
- All six src/**/README.md: src/app/bootstrap (40), src/content/q1/foundation (50), src/guest/abi (33), src/guest/floating-point (13), src/guest/runtime/system-v (39), src/guest/runtime/windows (27).
- docs/menu-source-comparison.md lines 1-300 and 1700-1735 verbatim. Rows M0153-M0394 read one by one with link targets stripped.

NOT read line by line: docs/menu-source-comparison.md rows M0395-M1121 (about lines 680-1699). I read these as a per-section condensation of distinct (state, route text) groups with ID ranges and counts, so every section and route was seen, but the "Source control", "Source definition" and "Bound action" columns were not read per row. Reason: the file is 379 KB of repeated rows and the context budget was reserved for code checks. To finish, read those rows directly.

Code checks: claims were checked by grep plus reading the cited code at HEAD fcdc8af5. Not every row of the Q1/Q2/Q3 ledgers (180+193+104) was checked individually; the rows named below were. Native report items were checked by reading runtime.ts 6784-7195, native-input.ts 195-300, guest-monsters.ts, and the three foreign-native tests.

Run: copies of q2-native-foreign-movement and -character tests with `--content-root` added, from <scratchpad>/clean (scratchpad docs3/tests), corpus read-only, SDL dummy: movement 4 pass/0 fail, character 4 pass/0 fail. q2-native-foreign-enemies: taken from the orchestrator's perfile-gl log (4 pass) and test-corpus.log (1 fail).

## Strengths
- src/guest/floating-point, abi and system-v READMEs match code on the points checked: sse.ts:268 still rejects FXSAVE/FXRSTOR, no fyl2x/fprem/fscale exists, test paths exist.
- mod-compatibility.md 250-482 tool flags are exact: `--content --user-content --artifact --id --role --fire --activate --title --profile` all exist in weapon-behavior-tool-options.ts. `qts:snapshot-v10` matches unified-content.ts:92.
- comparison docs are disciplined about what they do not prove, which makes them useful history. Several open items remain true at HEAD (network/q2.ts:149 KEX unbound, network/q2.ts:722 one player per native Q2 connection).
- verification-plan.md:92 labels its commands as future, not existing.
- The native report's own measurements were honest. Its foreign-lane work landed with real corpus tests.

## NATIVE_INTERPOSITION_REPORT.md open items at HEAD
Basis was fbabc9a2 plus a dirty tree. "Closed" means test or code evidence at HEAD. DOCS-012 covers the stale verdict; this table is the per-item re-derivation it said was not done.

| Report item (line) | Status at HEAD | Evidence |
|---|---|---|
| Launch refusal, Gates 1-2 (13, 564-576) | Closed: removed | content.ts:217, 479 keep edition/single-execution checks only |
| Door freeze at x~236 (1247, 1836) | Closed for tested lanes, cause never documented | Ran movement test: classic Q1, classic Q3 actions, rerelease Q1 all displacement > 300 on base1 |
| QTS_NATIVE_MOVE_DEBUG logs (1758) | Closed | No hit in src/tests/tools/docs |
| native-commands.ts committed with dialect tests (1759) | Half closed | Committed; no test file references selectedNativeCommand or native-commands, so it is covered only through Application lanes |
| `mode==='live'` creation, restore loses foreign movement (1276, 1824) | Closed | runtime.ts:6804-6813 creates host on restore; save/load test passes |
| Character triple silent-ignore (1053-1145) | Closed for q1/q3 classic and q1 rerelease | runtime.ts:6853-6929, 7403; test passes. q3 character on rerelease has no test |
| Enemies never prepared (1376-1410, 1820) | Closed in part | runtime.ts:867 prepareGuestMonsters; guest-monsters.ts strips and admits; classic proxy edicts at runtime.ts:1651 replace the proposed classic/foreign-actors.ts |
| Enemies markings / killshot (1500-1547) | Narrowed, still real | Obligations kept guest-native (guest-monsters.ts:78-84). Rerelease stub still `svflags=1`, classname `foreign_actor` (foreign-actors.ts:257,259) |
| Complete pmove_t copy-back per field (1722-1732) | STILL REAL | DOCS3-001 |
| Provider-identity foreignness (1154, 1839) | STILL REAL, small reach | runtime.ts:6846-6851 compares clock kind only. DOCS3-004 |
| Loud failure instead of silent fallthrough (1700-1702) | Half real | runtime.ts:7055 still falls through to guest run() silently when no player exists |
| Time quoting slicer / guest time (1279-1329, 1736-1743) | STILL REAL | DOCS3-002 |
| Combat honesty, annulled mirror (1218-1221, 1744-1749) | STILL REAL | DOCS3-003 |
| Consumption audit in recipe (1549-1558, 1687-1691) | STILL REAL | DOCS3-004 |
| Committed dual-run trajectory test (1761-1774) | STILL REAL | DOCS3-005 |
| Corpse/gib/bodyque mapping (1715-1718, 1784) | STILL REAL, not exercised | DOCS3-006 |
| Network seats stair (1789) | Refused, not ignored | network-q2-guest.ts:72-73 returns unsupported on original wire. Unified replication of foreign lanes on native worlds has no test |
| Rerelease foreign trajectories never run (1869) | Closed for Q1 only | Movement test rerelease lane. Q3 movement on rerelease untested |
| Cadence enforced by fixed frame, classic 100 ms (319) | True, unchanged | runtime.ts:7179 |

## Findings

### DOCS3-001 — Native foreign movement still fabricates pmove outputs the report said must be replaced
- **Verification (VERIFY-L): confirmed. Final severity: Medium.** src/compat/q2/native-input.ts:277 zeroes viewoffset, :286 (not :285) writes normal (0,0,1); runtime.ts:7102 maps slotless ground to world; :7106-7109 unions overlap solids into touches. No write of pm_time, delta_angles and the other listed outputs. Player-visible effect remains unproven; reach is foreign-movement lanes only.
- Severity: Medium
- Category: bug
- Location: src/compat/q2/native-input.ts:277, :285; src/app/bootstrap/simulation/runtime.ts:7102, :7106-7109
- Confidence: traced
- Evidence: Rerelease writeOutputs zeroes viewoffset: `view.setFloat32(viewOffset, 0, true)` (277). Every touch gets a fabricated plane normal (0,0,1) (285). Unmapped ground becomes the world: `this.actors.sourceOf(player.ground.actor)?.slot ?? 0` (runtime 7102). The touch list is the slice touches plus every solid within a 1-unit inflated box (7106-7108), and actors with no guest slot are dropped by flatMap (7109). No code writes pm_time, delta_angles, groundplane, step_clip, impact_delta, screen_blend or rdflags for either edition. Report lines 1723-1732 list each of these as required dispositions.
- Impact: The DLL can receive touch callbacks for solids the sweep never hit, wrong plane normals on any guest touch logic that reads them, and "standing on world" while on a slotless mover. Which of these surface depends on DLL post-Pmove code, which is not inspected. Tests assert only displacement, peak speed, yaw, jump and crouch.
- Remediation: Carry real trace planes and sweep touches from the provider, or define and test a per-field disposition for each edition.

### DOCS3-002 — Foreign providers still get host-fabricated time and one unsliced move per command
- **Verification (VERIFY-L): confirmed-with-changes. Final severity: Low.** Host-derived serverTime (runtime.ts:7081) and one player.move per command (:7091) hold. "One long step" is wrong for Q3: src/movement/q3/move.ts:524-525 slices to its fixed step from serverTime. QW taking one msec step per command is source behavior. Remaining effect is unmeasured host-time quoting, hence Low.
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/simulation/runtime.ts:7081, :7088, :7091, :7182-7187; src/app/bootstrap/simulation/provider-frames.ts:8-18; src/app/bootstrap/simulation/players.ts:519
- Confidence: traced
- Evidence: `const serverTime = Math.trunc(this.timeSeconds * 1000) + command.milliseconds;` derives Q3 server time from the host clock. `player.move(input, frame)` runs once whatever `command.milliseconds` is, and moveCommand has no sub-slicing. providerFrame only shifts interval start and end. Grep finds no read of guest level.time in src/compat/q2/classic or the guest worlds. The only levelTime read is the Q2Eaks weapon profile. Host time still advances by count while the DLL accumulates its own binary32 time.
- Impact: Foreign trajectories depend on command batching, so a slow host step gives a QW or fixed-step Q3 provider one long step. Report section 6.3's drift remains unmeasured. Requirement Q1 in report section 7 is unmet.
- Remediation: Add the per-actor k-quanta plus remainder slicer the report describes, and state black-box time as frame-count only.

### DOCS3-003 — Black-box mirrored combat still overwrites foreign-movement damage and misreports team
- **Verification (VERIFY-L): confirmed. Final severity: Low.** runtime.ts:6941 creates the mirror with team:null, mass 200; :6935-6950 re-syncs from HUD and overwrites; :1686-1687 syncs before monster frames; :8110 omits it from saves. No player-visible damage loss was established.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/simulation/runtime.ts:6935-6950, :6941, :1687, :8110
- Confidence: traced for the overwrite; plausible for the player-visible effect
- Evidence: `this.combat.create(owned, { health: ui.health, armor: ui.armor, mass: 200, canTakeDamage: true, invulnerable, team: null })`, then `setHealth` from the HUD before every slice. The mirror is excluded from saves at 8110 and is now also read by selected monsters (1687). I found no fall-damage code in players.ts or player-movement.ts, so whether any provider writes damage to the mirror was not established.
- Impact: Any shared-combat write on a black-box guest is discarded on the next sync. Selected monsters and rules see `team:null`, `mass:200`, `canTakeDamage:true` as fact regardless of guest state. Report lines 1744-1749 asked for this to be either written back or declared.
- Remediation: Declare it in a consumption contract, and block shared damage writes to mirrored combat with a diagnostic.

### DOCS3-004 — Selection consumption is still unaudited; narrowing is one console line and the save re-promises it
- **Verification (VERIFY-L): confirmed. Final severity: Medium.** No honoredBy in src. Only signal is the deferred report (runtime.ts:1645,1677). guest-monsters.ts:78 keeps every monster when projection is false. foreignNativeMovement compares clock kind only (runtime.ts:6846-6851). The enemies test pins only console text.
- Severity: Medium
- Category: robustness
- Location: src/app/bootstrap/simulation/runtime.ts:1645, :6846-6851, :7055; src/app/bootstrap/simulation/guest-monsters.ts:78-84; src/contracts/session.ts SaveImage.recipe
- Confidence: traced
- Evidence: Grep finds no `honoredBy`, `honored-by` or equivalent in src. When enemies stay guest-native, the only signal is `Selected enemies: N replaced; M guest-native (...)` printed once at level 2 on the first stepped frame (1645). The recipe still records the replace selection. On unqualified classic baseq2, every monster stays guest-native (`projection` false, guest-monsters.ts:78), with the launch and save claiming replacement. Foreignness is still `clock !== edition clock`, so a same-clock provider that differs in identity or content is dropped silently.
- Impact: This is the report's section 8 failure in reduced form. A dedicated server, a save reload, or a player who misses the line gets a recorded selection that never took effect. The test at q2-native-foreign-enemies "unqualified classic guest" pins only the console text.
- Remediation: Record per-axis consumption in the running session and surface it in status/save metadata. Compare provider identity for foreignness.

### DOCS3-005 — The native interposition tests fail in any normal corpus run, and no trajectory comparison exists
- **Verification (VERIFY-L): confirmed. Final severity: Medium.** tests/first-playable/application/q2-native-foreign-movement.test.ts:19,72 and -character.test.ts:19,61 pass no --content-root or skip; test-corpus.log shows "requires:" failures in about 18 ms. No dual-run: "trajectories" appears only in a comment (movement.test.ts:10).
- Severity: Medium
- Category: test-gap
- Location: tests/first-playable/application/q2-native-foreign-movement.test.ts:19,:72, tests/first-playable/application/q2-native-foreign-character.test.ts:19,:61; test-corpus.log:4588-4703 in scratchpad
- Confidence: reproduced
- Evidence: Both files call `parseApplicationCommand(["--game", game, "--map", "base1", ...])` with no `--content-root`, unlike the enemies test, which passes `testCorpusRoot()`. With QTS_TEST_CORPUS set, all 8 tests failed in 12-65 ms: `Content q2-classic-baseq2 requires: q2/baseq2/pak0.pak...`, because roots.ts `ownDirectory()` returns the cwd. With `--content-root` added, I ran the copies and 8 of 8 pass. Grep for `trajector` or `dual` in these tests finds only a comment. No test runs native and TS lanes under the same foreign selection. Assertions are displacement > 300 and peak speed bounds.
- Impact: The only proof of a shipped headline feature (1.1.10) reads as failing unless the runner's cwd holds game data, and a real regression there is indistinguishable from the known failure. Report validation (a), including the per-frame `max(0.125, epsilon)` comparison, was never built.
- Remediation: Pass testCorpusRoot() and skip when absent. Add the dual-run trajectory test.

### DOCS3-006 — Foreign-character players likely leave guest male corpses in the body queue
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** p_client.c:959 `body->s = ent->s`, and cl_ents.c:936 maps modelindex 255 through clientinfo. Only the source half is settled; the TS run was not performed. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/simulation/runtime.ts:7403-7410; src/app/bootstrap/simulation/classic-guest-services.ts modelAppearance
- Confidence: plausible
- Evidence: `if (this.foreignNativeCharacter() && this.nativeCharacterHost(info.actor) !== undefined) continue;` suppresses only client edicts. A bodyque edict is a different actor, so it reaches `modelAppearance` and draws what the DLL stored. Original `CopyToBodyQue` copies `s` from the player, so modelindex 255 maps through CS_PLAYERSKINS to `players/male/tris.md2`. Not run: the DLL side is binary and no test covers death and respawn with a foreign character. Report line 1784 lists corpse-at-respawn as a required check.
- Impact: In coop or deathmatch on a native world, a Q1 or Q3 character would leave a Q2 male corpse. Cosmetic.
- Remediation: Run the respawn case and map bodyque entries through the owner's selected character.

### DOCS3-007 — Rerelease foreign enemies threw "Q2 BoxEdicts filter cannot modify world links" in one of two corpus runs
- **Verification (VERIFY-L): confirmed-with-changes. Final severity: High.** Cause found, and foreign enemies are not required. M_CheckDodge's BoxEdicts filter (game_x64.dll RVA 0x77400, passed at 0x77f6a) calls self->monsterinfo.dodge at edict+0x9d0; the duck path links the monster (guest return address RVA 0xfa1f8, after call 0xfa290), or a gunner's dodge fires a grenade that links, and host.ts:407 throws on any link under #filterDepth. Reproduced 5 of 5 on plain q2-rerelease-baseq2 base2 with --q2-game game_x64.dll, no foreign selection: player placed in front of soldier_light (3 runs), soldier_ss or infantry, real blaster, no projectile edits (a 6th lane, gunner, found no clear target spot and did not run). See cause note below.
- Severity: High
- Category: bug
- Location: src/compat/q2/rerelease/host.ts:379-384, :407, :434; test-corpus.log:4629-4648 in scratchpad
- Confidence: reproduced once; a later run of the same test passed (perfile-gl log, 4 pass), so it is intermittent
- Evidence: `if (this.#filterDepth !== 0) throw new Error("Q2 BoxEdicts filter cannot modify world links");`. Stack: runFrame -> #dispatchImport (BoxEdicts) -> guest filter -> #dispatchImport (linkentity). Test "rerelease native DLL world admits Quake 1 grunts" failed after 133 s of play. No existing finding names this error. I did not identify which filter links an entity or what the run differed by; the original rerelease engine has no such restriction that I can cite, and I did not establish whether a retail filter legitimately links.
- Impact: An exception here reaches the run loop and ends the process (APP-001), during ordinary combat with foreign enemies on the rerelease DLL. The trigger depends on world evolution, so it can pass in CI and crash in play.
- Remediation: Capture the guest filter address and call stack when this fires. Then either permit deferred link operations during filters or fix the path that re-enters them.

### DOCS3-008 — Comparison and reconciliation docs state unjoined features that are joined at HEAD
- **Verification (VERIFY-L): confirmed. Final severity: Low.** Sampled rows hold: audio.ts:576, input.ts:425,544, qvm-grapple-selection.ts:7, base-arena-progression.ts:39-40, runtime.ts:867,7971,8149, simulation/bots.ts:221, simulation/network.ts:102, seat-hud-state.ts:135; quake-mixer.ts deleted; 3 quake64 products with null unresolvedReason. These are dated comparison docs with an as-of statement, so Low, not Medium.
- Severity: Medium
- Category: docs
- Location: rows below
- Confidence: traced
- Evidence (doc claim -> HEAD):
  - comparison-q2.md:302,596-597,668 and comparison-q1.md:63,96: no caller of `setEnvironment` -> src/app/bootstrap/audio.ts:576.
  - comparison-q1.md:66,96 and comparison-q3.md:19,50: SeatHaptics has no constructor -> src/app/bootstrap/input.ts:425,544.
  - comparison-q3.md:22,47: no compat/qvm or guest imports under src/app -> qvm-grapple-selection.ts:7 and many others; q3-guest tests exist.
  - comparison-q1.md:56,94: "QC is an unproven application join" -> simulation/quakec-source.ts, weapon-stage.ts and the QC worlds in runtime.ts. The narrow fact is still true; see DOCS3-012.
  - comparison-q3.md:53,60 and comparison-q2.md:362: no demo or timedemo application path -> demo-recording.ts:11, demo-commands.ts:104,117.
  - comparison-q3.md:41,60: no g_spScores/g_spAwards -> base-arena-progression.ts:39-40, base-arena-menu.ts.
  - comparison-q3.md:55,60: runtime rejects q3 checkpoint and restore -> runtime.ts:7971,8149 now reject only `source.kind === "loading"`; tests/app/q3-server-save.test.ts exists.
  - comparison-q3.md:49: runtime.ts:508-513 rejects Q3-map monsters -> runtime.ts:867 routes q3 sources to prepareGuestMonsters; the old message at 1360 is no longer reached for them.
  - comparison-q3.md:43: foreign-map bots restricted to standard deathmatch -> bots.ts:611-619, except the legacy check still applied at :221 when `source === null`.
  - comparison-q3.md:50: MIDI routing unproved -> input-devices.ts:33. comparison-q3.md:56: spline/OmniTimer missing -> application-tools.ts:6-7,32.
  - comparison-q2.md:372,671: `wire.old_origin` from body.origin -> network.ts:102 uses `presentation?.previousOrigin ?? body.origin`.
  - comparison-q2.md:262,511,573,622,669: no help-path, flashlight or achievement consumer -> seat-hud-state.ts:135, effects.ts:101, application.ts:2274, player-progress.ts.
  - comparison-q2.md:292 and comparison-q3.md:18: QuakeMixer is a parallel mixer -> src/audio/quake-mixer.ts is deleted; only source-paint helper remains (mixer.ts:17). DOCS-014 covers just the dead link.
  - comparison-q1.md:84,117: Quake 64 identity blocked -> products.ts has q1-classic-quake64, q1-quakeworld-quake64 and q1-rerelease-quake64, all `unresolvedReason: null`. The "Exact catalog products" list at :104-117 is therefore also out of date.
  - reference-contracts.md:161,190: OGV absent -> src/media/ogv-playback.ts.
  - source-inventory-reconciliation.md:15,76: other eight debug-shape imports open -> rerelease/debug-shapes.ts, component-drawings.ts:51.
  - source-inventory-reconciliation.md:26: no Q1 chase-control registration -> q1-client-settings.ts:50-51,71.
- Impact: DOCS-013 flags these docs as lacking a banner. The new problem is row-level: checkbox rows and "Concrete gaps" lists read as today's work items, and a contributor would redo finished work. Each doc's "as of" date is a sentence nobody connects to the checkboxes.
- Remediation: Banner each file with its cutoff, and strike or annotate the rows above with the joining commit.

### DOCS3-009 — menu-source-comparison.md's "994 open" headline and its capability table describe a superseded menu
- **Verification (VERIFY-L): confirmed-with-changes. Final severity: Low.** Claims hold: ui.ts:221-222, gameplay.ts:29-46, rotation via server.ts:29, startup-menu.ts:132-133,369,839, 994 at :16, 133 and 68 row counts. Counts off: "No application-owned" is 15 rows, not 19; "in flight" is 18 lines, not 15. The file is unlinked from docs/README.md and dated to 392b3e37, so Low.
- Severity: Medium
- Category: docs
- Location: docs/menu-source-comparison.md:3,16,23,39,48,59,62,64,66,69; src/app/bootstrap/ui.ts:183-185,221-227; src/ui/settings/action-catalog.ts; src/ui/settings/gameplay.ts:29-46; src/ui/settings/rotation.ts; src/ui/settings/server.ts:29; src/app/bootstrap/startup-menu.ts:132-133,369,839; src/ui/library/match.ts
- Confidence: traced for the items named; the row count below is grep of route text, not per-row verification
- Evidence:
  - Line 3 and 48 "No paired in-game Save menu", M0014/15/69 -> ui.ts:221 "Save game", :222 "Load game".
  - Lines 39,62 "Seven binding actions", 68 rows "Not listed among the seven exposed commands" -> action-catalog.ts lists 18 base rows including walk, turn, look, weapon cycling, wheels and console, plus dialect and item rows. Center view, mlook and klook are examples still absent.
  - Line 64, M0158,M0160-61,M0181: no per-seat name/skin/handedness -> gameplay.ts:29-46 has name, skin, model, head model, hand, FOV, shirt and pants colors.
  - Line 66, 12 rows "No shared rotation editor" -> rotation.ts via server.ts:29.
  - Lines 67, M0123-M0133, M0230: no master source -> startup-menu.ts:369.
  - Line 69, M0273-M0285, M0895, M1090, 19 rows "No application-owned..." -> base-arena-menu.ts, team-arena-results.ts. M0168-M0172, M0286-M0295 demos/movies -> startup-menu.ts:132-133.
  - M0252-M0259 no Q3 team/bot menu -> ui/library/match.ts (team, join, vote, bot, skill), ui.ts:226.
  - 15 rows say work is "in flight" (line 23) -> bindNativeVideoSettings in ui.ts is now shipped.
  - 133 rows say "No equivalent prelaunch" server setup -> startup-menu.ts:839 has a "Host a game" menu; I did not check how many of those 133 are covered.
  - Line 1735 places the evidence under `/tmp/quake-menu-comparison/frozen-revision3`, which nobody else has. Baseline commit 392b3e37 predates all of the above.
- Impact: The doc says at line 23 "Recheck the final accepted artifact before changing these verdicts", and that recheck never happened. The count is the largest open-work number in the repo and is unusable as stated, and docs/README.md does not link it (DOCS-014). True residual gaps are hidden in it, such as crosshair shape (accessibility.ts:8 has visibility and size only), CD-key UI and config browser.
- Remediation: Regenerate against HEAD, or mark the file as a dated 392b3e37 snapshot and move real residual gaps to a tracked list.

### DOCS3-010 — tick-execution.md's "current" cycle and profile omit steps and cite evidence nobody has
- **Verification (VERIFY-L): confirmed. Final severity: Low.** docs/tick-execution.md has no step for tickNativeCharacters/runGuestMonsters (runtime.ts:7188-7189) and no foreign-provider branch at :16. Measurements cite 563f0a99, b72b9ad6, 72794d58; drivers are .artifacts paths.
- Severity: Low
- Category: docs
- Location: docs/tick-execution.md:3-5,16,25-44,66,82,107,136,203; runtime.ts:7183-7193, :7054-7115
- Confidence: traced
- Evidence: Line 3 says it follows "the current" path. The numbered table has no step for `tickNativeCharacters()` or `runGuestMonsters()`, which run right after `source.game.frame` at runtime.ts:7188-7189. Line 16 says each command invokes original ClientThink, without the foreign-provider branch that replaces Pmove (runtime 7054-7115). Measurements are on 563f0a99, b72b9ad6 and 72794d58, before later perf work and PERF1-3. Drivers are `/tmp/quake-native-current*` and `.artifacts/resume-20260925/*` as plain paths, which DOCS-009's link count did not include.
- Impact: T10 work is targeted from timings that cannot be rerun and a step list that misses per-frame native work.
- Remediation: Add the two steps and the foreign branch, date the measurements, and rerun or retire the profile.

### DOCS3-011 — Other contradictions inside mod-compatibility.md and the src READMEs
- **Verification (VERIFY-L): confirmed. Final severity: Low.** mod-compatibility.md:258 vs :401 conflict; :401 ab3e3adf note; :431 open under T12 vs status.md:20. Q2_RR_SPAWN_PROBE appears only in src/guest/runtime/windows/README.md:21. foundation/README.md:19 has the scrubbed path.
- Severity: Low
- Category: docs
- Location: docs/mod-compatibility.md:258,373,401,431; src/guest/runtime/windows/README.md:17,21,23; src/content/q1/foundation/README.md:19,50
- Confidence: traced
- Evidence:
  - mod-compatibility.md:258 "Original rerelease localized/table/health-bar drawing commands ... remain unfinished" against :401 "Rerelease native HUDs execute their own localized layout commands, tables, health bars". Both are present-tense.
  - :401 "These source changes are newer than installed `ab3e3adf`" is a stale delivery note.
  - :431 "remain open under T12", while status.md:20 has T12 complete (extends DOCS-004).
  - windows/README.md:21 `Q2_RR_SPAWN_PROBE=1 bun test ...` -> the variable appears only in this README, not in tests/ or src/. It also says the run "stopped at the engine's unbound `game.trace`; entity spawning is not yet qualified", and :17 "reaches PreInit and Init", :23 "No map/frame/save qualification". tests/compat/q2/rerelease/native.test.ts and the foreign lanes spawn, run and save the DLL. DOCS-018 covers only the ~/Projects path on line 17.
  - q1/foundation/README.md:19 cites `../the Q1 reference port/...` scrubbed paths (the DOCS-013 class, not listed there).
- Impact: Small individually. The windows README understates what works and gives a command that does nothing.
- Remediation: Fix these lines.

### DOCS3-012 — Stated gaps that remain unfixed and have no tracked home
- **Verification (VERIFY-L): confirmed-with-changes. Final severity: Medium.** Mostly holds: remaining-work.md:13; no MOTD/journal hits; network/q2.ts:149,722; tools/verify has three files; QuakeCExecutor only in compat/qc/index.ts and tests. Correction: "prompts reach only local QC" is too strong. network/remote-q1.ts has none, but unified transport carries them (simulation/network-unified.ts:62, network/unified-event-codec.ts:291, game-prompt.ts:50). VCR and MOTD overlap DOCS2-001/-002.
- Severity: Medium
- Category: docs
- Location: docs/remaining-work.md:13; docs/source-inventory-reconciliation.md:13,18,19,25; docs/comparison-q2.md:670,672; docs/mod-compatibility.md:373,399; docs/verification-plan.md:56,58,68-70; src/compat/qc/executor.ts:21
- Confidence: traced (absence by grep over src and tests)
- Evidence: remaining-work.md:13 says "No other implementation item is currently identified as a release blocker" and :3 frames T10 as the single open item. Still open at HEAD with no entry there or in any release note:
  - Q1 network VCR replay: no `vcr` hit. Q3 event/config journal: no `journal.dat`/`journaldata` hit. Q3 external MOTD: no `getmotd`/`ClientMotd` hit.
  - Q1 remote prompts: remote-q1.ts has no `prompt` reference; prompts reach only local QC (quakec-local-messages.ts:43-46).
  - KEX live transport unbound (network/q2.ts:149). One player per native Q2 connection (network/q2.ts:722).
  - mod-compatibility.md:373 "A separate stale local-player UI defect remains recorded", with no record found. :399 full remote multiplayer playthrough unverified.
  - verification-plan's "mandatory" seat, timing and guest-ownership fixtures (:56,:58,:68-70): no such suites located, and tools/verify holds only hash.ts, isolation.ts, snapshot.ts. The plan says failure "blocks dependent work" in a graph that was deleted.
  - `QuakeCExecutor` (compat/qc/executor.ts:21) has no production constructor, referenced only by compat/qc/index.ts and tests/compat/qc/runtime.test.ts, while production QC uses QcMachine. It is unused production code and its test exercises a path the game does not run.
- Impact: Open items live only in dated prose that readers are told not to trust. Some may be deliberate non-goals, and nothing records that decision.
- Remediation: Create one tracked list with a keep-or-drop decision for each item, and delete or adopt QuakeCExecutor.

### DOCS3-013 — NATIVE_INTERPOSITION_REPORT.md's recommendation and evidence pointers should not be kept in the tree as they stand
- **Verification (VERIFY-L): confirmed. Final severity: Info.** NATIVE_INTERPOSITION_REPORT.md:1624-1625 cites /tmp probes; :1801,:1849-1850 recommend honest refusal, opposite of the shipped design. File is untracked. ## DOCS3-007 cause note Trigger path: RunFrame -> monster think -> M_CheckDodge -> gi.BoxEdicts(filter 0x77400, data=self) -> filter -> self->monsterinfo.dodge -> gi.linkentity -> host.ts:407 throw. - Identification is from disassembly plus runtime DIAG. Function names come from my recollection of the published rerelease source and were matched to behavior, not to symbols. Static: of the 8 filters passed at the 9 BoxEdicts sites, only 0x77400 calls out through a guest pointer; the others are pure or math-only. - The filter is the retail DLL's own code, so the "cannot modify world links" rule contradicts it. That answers the question the finding left open. - Why intermittent: the dodge needs an FL_DODGE projectile on course for a dodging monster and passes a random gate. The foreign-enemies test's player never fires, so only guest monster projectiles can trigger it. RNG seed comes from _Xtime_get_ticks at RVA 0x6a9dc (mt19937 init at 0x6a9e2-0x6aa1f), which the host serves from trunc(performance.now()) (application.ts:590, crt.ts:12), so it varies with startup timing. Identical launches differed run to run (filter 0x77400 counts 51288, 52488, 52499 at the throw). That test passed 6 of 6 here and failed once in test-corpus.log; I did not capture a filter address from that failing run, so attributing it to 0x77400 is inference from the matching stack shape and the static result. - Separately, an early doctored run (repro-r1.log), where I moved a real bolt in front of a gunner, threw with target=grenade. - Reach: built-in q2-rerelease-* products default to the TS port (content.ts:159-165). It applies with --q2-game game_x64.dll and to add-on products requiring that DLL. Not tested on a dedicated server with a remote client; if that path holds, a remote player's shot could end the server, which would meet Critical. - Fix evidence: with the throw disabled for linkentity under filter (DODGE_NOGUARD), both lanes ran until the target died, with guardHits 1 and 2 and no error. spatial.boxEdicts iterates a snapshot (rerelease-guest-services.ts:104 returns .map output), so relinking does not invalidate the loop. Longer play and save/load after a filter-time link were not tested.
- Severity: Info
- Category: docs
- Location: NATIVE_INTERPOSITION_REPORT.md:1624-1625,1799-1802,1849-1850
- Confidence: traced
- Evidence: Its probes live at `/tmp/probe-native-lanes-empirical.ts` and `/tmp/probe-native-move.ts`. "Honest refusal per-axis" (1801, 1849) is the opposite of the shipped design. The table above replaces its section 13 for HEAD. Supplements DOCS-012.
- Impact: Low while untracked.
- Remediation: Move the still-real items (DOCS3-001 to -006) to a tracked list, and keep the report only as a dated record.
