# VERIFY-G — adversarial verification (verify-MED3 list, HEAD fcdc8af5)

### AUDIT-001
Verdict: confirmed
Corrected severity: High
Reason: application.ts:2653 binds previousSimulation; closures at :2771, :2833 and :3041 capture it, so it sits in the function's shared scope with promptSupported/playerIdentity (:2798-2799), which the new simulation retains. Clean copy matches HEAD; soak-q1.log grows to 424.8 MB vs 74-81 MB in soak-q1-patched.log. Soak not re-run.

### GAPQ12C-001
Verdict: confirmed-with-changes
Corrected severity: High
Reason: Re-ran tag.test.ts and got the throw. Route traced: runtime.ts:217-218 -> simulation/runtime.ts:1285 release -> clients.ts:31 delete; rogue-tag.ts:21 announces with owner still set. Correction: announce (rogue-tag.ts:26) calls playerName inside the host.players() loop, so it throws only if another player remains.

### GAPQ12C-002
Verdict: confirmed-with-changes
Corrected severity: High
Reason: dabeam.ts:33-34 emits visible:true then frees; entity-services.ts:221-229 emits only visibility; effects.ts:513 sets die=Infinity; beam.test.ts re-run shows 20 of 20 retained. Built-in products use TS (content.ts selectedQ2GameLibrary). Correction: fixbot is Xatrix (tables/xatrix-fixbot.ts), so drop the "Ground Zero" claim unless shown otherwise.

### GAPQ3B-001
Verdict: confirmed
Corrected severity: High
Reason: client-policy.ts:75 uses default preserve-authority; player-state.ts:173-219 skips origin, velocity, health, armor, weapons, ammo. network-q3.ts:169-171 snapshots those fields; visibility.ts:42 excludes clientNum. syncQ3Player (simulation/runtime.ts:4291) does not copy them. repro.ts re-run: health 77/125, armor 42/0, weapons 32/0, ammo 9/0.

### AUDIT-002
Verdict: confirmed
Corrected severity: Medium
Reason: policy.log shows 17m51s real, exit 0. tools/check-policy.ts:57, :87 and :163 default to a fresh visited set per call, reached per expression from visit (:488+). tools/build.ts:62 gates builds on policy. The 13 GB RSS is not in that log and was not re-measured.

### AUDIT-003
Verdict: confirmed
Corrected severity: Medium
Reason: No .github or other CI config tracked (git ls-files); 1,035 commits and 19 tags confirmed; package.json:19 `check` is the only gate. `gh run list` not re-run (no off-host requests).

### AUDIT-004
Verdict: confirmed
Corrected severity: Medium
Reason: tools/build.ts:98 gates are typecheck, policy, input-stability, with no tests. Evidence (:86-98) records sourceSha256, no commit. tools/verify/snapshot.ts:38 excludes only .git, .artifacts, dist, so untracked files are hashed. No tarball step in tools or package.json.

### AUDIT-007
Verdict: confirmed
Corrected severity: Medium
Reason: Measured exactly 13,686 src lines over 160 chars, longest 1,635 across the two cited files, unified-event-codec.ts 400 of 1,056. No formatter or linter config at root.

### AUDIT-008
Verdict: confirmed
Corrected severity: Medium
Reason: Declarations verified at runtime.ts:294 and :5123, application.ts:262, :2629, :3977, q2repro.ts:18, rerelease.ts:203. Files are 8,591 and 4,817 lines. Member and cyclomatic counts not recomputed.

### AUDIT-009
Verdict: confirmed
Corrected severity: Medium
Reason: Spot checks hold: movement/q3/move.ts:7 imports content/q3/base/game/grapple.ts; core and persistence import each other (2 and 4 files); input/settings/world import content in 9 files. Full cycle counts taken from evidence/architecture-metrics.txt, not recomputed.

### AUDIT-011
Verdict: confirmed
Corrected severity: Medium
Reason: 688 test files; test-rss.log peak 7,287,820 KB; package.json:12 is plain `bun test`. Aggregates TESTS-001/003/004/007; the 30-minute figure and TESTS-001/003/004 were not re-verified here.

### BOTS-006
Verdict: confirmed
Corrected severity: Low
Reason: routing.ts:93 `edges.find`, reached via controller.ts:59; graph.ts:83 sets id=index, so the scan is unnecessary. Severity lowered: the finding's own worst case is 36 ms/s (3.6%) with 16 bots on 30k edges.

### BOTS-007
Verdict: confirmed
Corrected severity: Medium
Reason: brain.ts:1035-1039 traces per live player/monster before cone use; senses.ts:107 and :133 consume lineOfSight only with a FOV flag. Allocation counts not measured.

### BOTS-008
Verdict: confirmed
Corrected severity: Medium
Reason: path-follow.ts:359-360 projects before brain.ts:964 aimStep; the comment at brain.ts:977-984 has no code, then section 7 begins; bot-commands.ts passes fields unchanged. 18 degrees per frame is 360 deg/s at 50 ms.

### BOTS-009
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The exponential DAG walk holds: aas.ts:92-97 range-checks only; :131 bounds depth, not visits. Correction: overlapping reach ranges do not exhaust memory silently; graph.ts:83 duplicate ids make runtime.ts:84 throw after one quadratic build, which is the BOTS-010 crash.

### BOTS-010
Verdict: confirmed
Corrected severity: Medium
Reason: load.ts:43-49 try covers only parsing; load.ts:58-59 builds the graph and NavigationRuntime outside it; runtime.ts:84 throws. estimate-aas.ts uses unvalidated cluster/portal values through `at`, and aas.ts:92-101 has no such checks.

### BOTS-011
Verdict: confirmed
Corrected severity: Medium
Reason: rerelease-path.ts:72-86 linear-min plus splice queue with edgeAllowed per relaxation; `nearest` (:52-64) traces candidates in scan order. Per-query timing not re-run; call frequency still unmeasured.

### BOTS-012
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: assets.ts:58-66 filter matches bots/navigation. Size now measured from paks: Q2 rerelease 174 .nav files, 3.31 MB; Q1 rerelease 51 files, 0.69 MB. That is a few MB per load plus hashing, not a meaningful memory cost.

### BOTS-013
Verdict: confirmed
Corrected severity: Low
Reason: weights.ts:77-80 builds a new DataView per access; memory.ts:88-93 getter creates a subarray each read. Severity lowered: by my estimate about 3 ms per 100 ms for 8 bots with 100 items at 10 Hz, assuming the finding's 3.6 us (not re-run).

### BOTS-014
Verdict: confirmed
Corrected severity: Medium
Reason: ai-navigation.ts:527 throws at depth 10 with no cycle check at :524-530; a self-targeting relay reaches it. Source loop behavior is from memory only; the TS throw itself is verified.

### BOTS-023
Verdict: confirmed
Corrected severity: Medium
Reason: The finding's grep returns nothing in tests. tests/bots/navigation/application.test.ts:90 covers a NAV for a different BSP and is corpus-gated, not malformed AAS. No AAS rejection `toThrow` found in tests/bots/navigation.

### CONTENT1-006
Verdict: confirmed
Corrected severity: Medium
Reason: foundation/monsters.ts:50 publishes sightEntity unconditionally; base/monsters.ts:137-147 reads sightEntity.monster.enemy with no player check. simulation/runtime.ts:3942 monsterTarget returns non-null for any live actor with a body, so nothing filters a monster candidate.

### CONTENT1-007
Verdict: confirmed
Corrected severity: Medium
Reason: base/monsters.ts:66-72 redirects to stand/walk/run; frames.ts zombie_paine10 sets solid none; only monster-actions.ts zombie_paine12 restores slidebox. An ineligible enemy during paine10-12 skips the restore.

### CONTENT1-008
Verdict: confirmed
Corrected severity: Medium
Reason: foundation/monsters.ts:10 imports ../base/projectiles.ts; foundation/pickups.ts:12-15 imports q3 and composition; initTrigger exists at foundation/spawns.ts:23, base/map-entities.ts:19, addons/context.ts:118. Changelevel duplicates not reopened.

### CORE-003
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: hull.ts:25-34 rebuilds `drawing` per call; index.ts:62-66 caches per model. Correction: this is per-map excess memory freed at map change, not a session leak; recategorize as performance/memory. The 195 MiB measurement not re-run.

### CORE-004
Verdict: confirmed
Corrected severity: Medium
Reason: index.ts:178-190 authored branch never tests brush.bounds against envelope and clips every brush; `brushList.find/some` runs per trace. Limited to BSPX BRUSHLIST maps.

### CORE-005
Verdict: confirmed
Corrected severity: Medium
Reason: commands/index.ts:649 throws for non-q3 dialects, text.ts:9 for non-byte text. The application.ts step catch rethrows when no fatal-world failure is set, and run() (~:4693-4704) has no catch.

### CORE-006
Verdict: confirmed
Corrected severity: Low
Reason: movement/q2/index.ts:134 always uses MASK_CLASSIC_PLAYERSOLID; rerelease.ts:244-247 selects MASK_DEADSOLID. Severity lowered: the effect is a dead player's body colliding with monsters while sliding, with no gameplay outcome shown.

### CORE-007
Verdict: confirmed
Corrected severity: Medium
Reason: q1-map/index.ts:162-164 range-checks clipnodes only; Q2 reader:248 and Q3 decode:208 fail cycles at load; hull.ts:66 and :86 throw only at runtime. Stall length still unmeasured.

### CORE-008
Verdict: confirmed
Corrected severity: Medium
Reason: contents.ts:72-80 loops 32 bits, called per trace at q2.ts:161 and q3/index.ts:52, :62; body.ts:10-17 builds hull objects per call. Remaining sites sampled; whole-game share still unmeasured.

### DOCS-001
Verdict: confirmed
Corrected severity: Medium
Reason: README.md:128-129 passes no listener; options.ts:291 sets network only with listen; application.ts:1831-1834 returns early for non-server selections. Not launched.

### DOCS-002
Verdict: confirmed
Corrected severity: Medium
Reason: console-and-llm.md:65-77 and content-layout.md:87-88 say beside the executable; src/main.ts llmSettingsDirectory uses the shared settings dir; main.ts:55-62 copies with COPYFILE_EXCL and never deletes the legacy plaintext files.

### DOCS-003
Verdict: confirmed
Corrected severity: Low
Reason: status.md and remaining-work.md last changed 5d6c6e31 (2026-09-26); execution-status.md 949c337c (2026-10-17); docs/README.md:32 calls them current. Lowered: stale internal status with no runtime or user-task impact.

### DOCS-004
Verdict: confirmed
Corrected severity: Low
Reason: status.md:3 says 22/23 and :59 says 21/23; :20 Complete vs :259 Reopened; completion-status.md:10 293/184 vs project-status-current.md:15 288/189; that file's title is "Historical". Lowered for the same reason as DOCS-003.

### DOCS-005
Verdict: confirmed
Corrected severity: Medium
Reason: playing.md:49-52 contradicts match-modes.ts:26-44 and releases/1.1.5.md:10-14. Foreign DeathBall and LMCTF need only deathmatch spawns; CTF comment says bases synthesize on every world. matchMapUnavailable not re-run.

### DOCS-007
Verdict: confirmed
Corrected severity: Medium
Reason: package.json:14, :15, :18, :21 target missing paths; tools/reference, tests/verification, docs/validate-plan.ts, docs/completion-status.json, tools/inventory all absent; tools/build.ts:50 and :55 abort on the first entry. Failure confirmed by path check, not by running the scripts.

### DOCS-009
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: .gitignore:3 ignores .artifacts; menu-source-comparison has 1,673 line links; implementation-checklist.md:99 -> application.ts:132 is the nativeAtoi import. Corrections: .artifacts/snapshots now holds build-* directories; raw mention counts are 157 and 33 where the finding lists 137 and 28 links. Lowered: docs-only.

### DOCS-011
Verdict: confirmed
Corrected severity: Medium
Reason: mod-compatibility.md:136 conflicts with releases/1.1.8.md:21 and simulation/runtime.ts:3324; no docs/*.md mentions black box; bootstrap README:34 says unified networking is separate work though options.ts:104 has --listen-unified.

### DOCS-015
Verdict: confirmed
Corrected severity: Medium
Reason: No CONTRIBUTING, CHANGELOG or SECURITY; QUAKE_*_LIBRARY (native-libraries.ts:8-11) is absent from README/docs outside this audit's reviews; crash.log and QTS_CPU_WORKERS appear only in release notes. docs/verification-plan.md is a completion plan, not a test guide.

### GAPBOTS-001
Verdict: confirmed
Corrected severity: Medium
Reason: ai-decision.ts:287 is the only setter and :1014 the only reader; no clear in src or tests; aiEnterBattleFight (:279-283) does not clear it. The C clear is from memory, but the TS latch holds regardless.

### GAPBOTS-002
Verdict: confirmed
Corrected severity: Medium
Reason: special.ts:110-112 returns origin null; the caller throws at :136 and at the approach path near :170; spawn.ts:198-206 removes filtered entities while AAS keeps the reachability. Custom maps only.

### GAPQ12-004
Verdict: confirmed
Corrected severity: Medium
Reason: ctf/index.ts:203-211 dispatches directly; join (:112-121) checks only matchLock/forceJoin, then spawnPlayer, with no team or death penalty unlike teamCommand (:122-134). match.ts:74-76 beginElection has no competition or phase check.

### GAPQ12-005
Verdict: confirmed
Corrected severity: Medium
Reason: lmctf/admin.ts:9-12 checks the referee flag only for pause_match; runtime.ts:154-155 runs admin commands before the pause filter; match.ts togglePause flips state and autoLock. Upstream LMCTF behavior remains unknown.

### GAPQ12-006
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Ungated impulses confirmed at addons/commands.ts:47-79 and items/commands.ts:68-90. Correction: commands.ts:48 and items/commands.ts:43 limit all but 219 to MG3, and 219 also reaches dopa. For MG1 only omnicide is ungated (99 is gated), so the listed impact is MG3-only apart from omnicide.

### GAPQ12-007
Verdict: confirmed
Corrected severity: Low
Reason: player.ts:50 spreads and finds; :52 creates; no removal found by grep. Measured 15.6 us per spread+find at 1,000 entities, so about 0.25 ms per tick for 8 players at two calls each. Growth bounded by the map.

### GAPQ12B-003
Verdict: confirmed
Corrected severity: Low
Reason: rogue-teams.ts:37-38 and grapple.ts:24, :78 do the spread and find; no removal of rogue_team_state. Using the same 15.6 us, about 0.5 ms per tick for 8 players at four copies each.

### GAPQ12C-003
Verdict: confirmed
Corrected severity: Medium
Reason: shambler.ts:100 emits a beam on the shambler's own actor; clearBeam (:18-25) hides only entity.beam/beam2; pain (:60) sets the pain move with no clearBeam; windup (:82) overwrites entity.beam. Persistence mechanism shown by beam.test.ts. C comparison from memory.

### GAPQ12C-004
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: mg1.dis:15120-15140 shows count mod #1135869952 (360.0f) passed straight to sin/cos; with 360/wait and the 360*delay phase, the QC is written for degrees, while brushes.ts:12-14 uses radian Math.sin. Kex's sin was not inspected and no run was done; degrees is an inference from the QC. No other mg1 sin/cos use settles it.

### GAPQ3-005
Verdict: confirmed
Corrected severity: High
Reason: server-commands.ts:493 and frame-audio.ts:21 increment without modulo, while drains at :514 and :31 wrap, so out can reach 32 and at(voices,32) throws. network/q3/server.ts:103-104 allows about 1 command/s per client vs 1/s drain. Raised: peers can crash Team Arena TS clients through APP-001.

### GAPQ3-006
Verdict: confirmed
Corrected severity: Medium
Reason: weapons.ts:529-535 chains with no rejection arm; registerWeaponNow adds to registeredWeapons before its awaits; frame.ts:111 adds ET_PLAYER current.weapon unclamped; events.ts:286-288 prepares es.weapon. Requires a hostile or corrupt server.

### GAPQ3-008
Verdict: confirmed
Corrected severity: Medium
Reason: console.ts:108 catch disposes and rethrows; dispose (:93) sets closed and resets clients. state.ts:159 sortedTeamPlayers has 8 slots, so console.ts:133 slot() throws at index 8, but only for a non-leader, because of the teamLeader short-circuit.

### GAPQ3-009
Verdict: confirmed
Corrected severity: Medium
Reason: Throws verified at server-commands.ts:121-127, :208, players.ts:316, :700, weapons.ts:447. instanceof CommonError exists only at library/weapons.ts:990 and base/game/spawn.ts:217; no .code === "drop" branch exists.

### GAPQ3-010
Verdict: refuted
Corrected severity: Info
Reason: Hosts do throw (client.ts:130-133, :204-205), but scene sessions use Q3SelectedSource: arsenal/q3-source.ts sets only configstrings 544+slot (:202, :298), with no spawn, match or remap, so CS 2/24 do not change. match.ts:311, :419 use console map_restart, and no src/app or src/content site emits it as a server-command. client.ts:320 weapon omission is real but selected weapons have their own presenter (presentation-scene.ts:192); whether scenes need it was not determined.

### GAPQ3B-002
Verdict: confirmed
Corrected severity: Medium
Reason: player-pose.ts:100-105 loops never progress at large binary32 magnitude; pitch is not normalized (:224-235) and reaches swingAngles (:124, :129). Hang repro not re-run; the arithmetic is deterministic. Hostile server only.

### GAPQ3B-003
Verdict: confirmed
Corrected severity: Medium
Reason: mover-spawn.ts:173-176 has no duration clamp while mover.ts:398 does; mover.ts:315-322 divides by duration. repro.ts re-run prints NaN origin immediately and after 100 ms. Custom maps only; client and server effects beyond link remain untested.

### TESTS-005
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: accessibility.test.ts:49 early return confirmed; gating is pervasive. Correction: `skipIf` appears on 355 lines in 156 files under tests/ at HEAD, not 374. Per-directory percentages taken from tests-audit, not recomputed.

### TESTS-006
Verdict: confirmed
Corrected severity: Medium
Reason: presentation.test.ts:19 and :27 concatenate with no separator and corpus.ts:11 adds none; installed-dll.test.ts:24 and windows/installed.test.ts:17 join without q2/. qfiles has q2/ctf but no root ctf.

### TESTS-007
Verdict: confirmed
Corrected severity: Medium
Reason: A broad env regex finds 81 names (finding says 83); QUAKE_GL_SMOKE has 16 test lines and no setter in package.json, tools or docs; capture/application.test.ts:49 requires offscreen. The 19 ungated GL files not rechecked.

### TESTS-008
Verdict: confirmed
Corrected severity: Medium
Reason: frame-time-native-local.test.ts:8 defaults output to import.meta.dir; the finally at :46 writes local.json unconditionally; local-content, remote-content, *.json and *-frozen.png exist and are gitignored (.gitignore:33-38).

### TESTS-010
Verdict: confirmed
Corrected severity: Low
Reason: Sites confirmed at q3-guest.test.ts:203-209, remote-socks.test.ts:129, platform/audio.test.ts:64-66, worker-transport.test.ts:54-56. Lowered: the finding observed no flake and it affects test reliability only.

### TESTS-011
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: reflect.ts:1-2 purpose and 120 spyOn prototype lines in 37 files confirmed. Correction: at HEAD 11 test files import support/reflect with 178 helper calls (foreign-lmctf 35, cross-family-q3 43), not 186 sites across 33 files with 28 and 25.

### TESTS-012
Verdict: confirmed
Corrected severity: Medium
Reason: native-mod-provider.ts and ai-decision.ts have no direct test importer; UiRuntime appears only in retail.test.ts, gated at :23; BotBrain is never named in tests (reached through RereleaseBotBehavior, and rerelease tests reference corpus). Coverage percentages not re-run.

### UI-004
Verdict: confirmed
Corrected severity: Medium
Reason: RangeErrors at lexer.ts:900, :917, :1087, token-memory.ts:185, preprocessor.ts:285, :505; lexer.ts:445 isSourceFailure requires ScriptLanguageError; menu.ts:971-975 and client-script-syscalls.ts:124 rethrow; loadHudMenu is unguarded at client.ts.

### UI-005
Verdict: confirmed
Corrected severity: Medium
Reason: memory.ts:334-351 replaces the penultimate node's next, with the comment acknowledging it; runtime.ts:2801-2803 parses per evaluation. Pool-growth numbers not re-run, and a retail three-way bucket collision remains unshown even though qfiles is available.

### UI-006
Verdict: confirmed
Corrected severity: Low
Reason: controller.ts:117 closeMenu leaves shift/control set; :299 returns before :245-246 when no menu is active. Lowered: needs a modifier held across menu close, and pressing Ctrl again clears it.

### UI-007
Verdict: confirmed
Corrected severity: Medium
Reason: router.ts:232-233 calls seat.releaseDevice only; seat.ts:207-212 sends no UI event; controller.ts:367-368 clears only below threshold; draw (:380-382) repeats held keys every 80 ms. Removal path traced, not run on hardware.

### UI-008
Verdict: confirmed
Corrected severity: Medium
Reason: settings/index.ts:290 allows textScale 2; layout.ts:33-36 height 28; controller.ts:385 scales font, :483 fixes y+6, :394-398 fits width only. menuRow is used by production menus (startup-menu.ts and others).

### UI-009
Verdict: confirmed
Corrected severity: Medium
Reason: assets.ts:20-25 registers four images; menu-theme.ts:25 nulls background/panel/focus and controller.ts:413-439 are the only readers. menu-art.ts:8 cache deletes only on decode failure (:18); :24 slices per load. File sizes match.

### UI-010
Verdict: confirmed
Corrected severity: Medium
Reason: Allocation pattern seen at sampled sites (runtime.ts:265-272, :356, itemPassesCvar at :2801). The 0.93 ms and 326 freezes per frame were not re-run. Limited to the Team Arena HUD.

### UI-011
Verdict: confirmed
Corrected severity: Medium
Reason: memory.ts:294-297 allocates a DataView per getter; lexer.ts:859-871 builds a Map per escape. Throughput not re-run and retail file sizes not measured.

### UI-012
Verdict: confirmed
Corrected severity: Low
Reason: Every listed symbol appears only in its defining file; LegacyUiSeat and defaultUiMenuPlan are also in retail.test.ts; sole production UiRuntime.create is mission-hud.ts:325. Lowered: dead code with no runtime consequence.

### UI-013
Verdict: confirmed
Corrected severity: Medium
Reason: retail.test.ts:23 is gated on a retail archive and is the only test naming UiRuntime; no test references any max* preprocessor limit.
