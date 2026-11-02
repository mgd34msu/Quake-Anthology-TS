# T2B — tests/app remainder from T2 (22 files)
## Coverage
Read in full, line by line, no line truncation: 22 files, 2713 lines:
tests/app/configuration-content.test.ts (406) tests/app/prepared-startup.test.ts (678) tests/app/q3-guest-runtime.test.ts (266) tests/app/q3-local-round.test.ts (107) tests/app/q3-model-registration.test.ts (64) tests/app/q3-product-launch.test.ts (135) tests/app/q3-product-policy.test.ts (13) tests/app/q3-routed-cvars.test.ts (81) tests/app/q3-runtime-warnings.test.ts (107) tests/app/q3-server-save.test.ts (48) tests/app/qvm-command-context.test.ts (49) tests/app/qw-movement.test.ts (83) tests/app/source-program-inheritance.test.ts (106) tests/app/source-transition.test.ts (45) tests/app/startup-commands.test.ts (144) tests/app/startup-config.test.ts (173) tests/app/startup-image-provenance.test.ts (19) tests/app/startup-source.test.ts (86) tests/app/startup-world.test.ts (32) tests/app/team-arena-demo.test.ts (12) tests/app/unified-host.test.ts (22) tests/app/weapon-view.test.ts (37)

Not read: none of the assigned files. The other 70 files on T2's "Not read" list (tests/compat/**) were outside this assignment.

Runs: every scope file ran once at HEAD, each wrapped in `timeout 120`, from a private copy at <scratchpad>/t2b/mut, with QTS_TEST_CORPUS=<game-data> and HOME/XDG under the scratchpad. All passed; startup-world skipped by its env gate. Mutants ran only in that copy, which matched <scratchpad>/clean afterwards by `diff -rq` on src and tests. The project directory was not changed. Two dedicated server processes ran for about 20 seconds each, driven only through stdin.

## Strengths
- Candidate isolation is checked directly and well: configuration-content.test.ts:134-160 and :312-320 assert that a staged profile leaves live bindings, pending text, mouse settings and session owners unchanged.
- Ordering is asserted as exact sequences, not presence: prepared-startup.test.ts:529, q3-local-round.test.ts:95-99, startup-config.test.ts:37,57.
- Scope files use no sleeps, so I found no timing flakiness. q3-guest-runtime runs 9 tests in 1.78s even though each fixture digests the 479 MB pak0, so the default 5s timeout is not a near risk on this machine.
- Temp roots are removed in `finally`. No scope run left a directory in /tmp and none created /unused, the path about 20 fixtures pass as an unused root.
- qvm-command-context.test.ts and q3-routed-cvars.test.ts drive real syscall decoding and the real command buffer instead of fakes.

### Candidates tested and refuted
- qw-movement.test.ts:81 has a bare `toThrow()` but is not a false pass. Removing the `movementContentProduct` check at content.ts:190 fails the test.
- configuration-content.test.ts:380 `.not.toContain` on a possibly undefined value is not vacuous. On Bun 1.3.14, `expect(undefined).not.toContain("b")` fails, and Set contents are compared correctly.
- team-arena-demo.test.ts:11 uses a bare `rejects.toThrow()`, but its `exists` stub returns false for the traversal path, so a missing validation resolves null and fails the test.
- discoverInstalledContent in qw-movement.test.ts and source-program-inheritance.test.ts does not touch the real profile: userContentRoot defaults to null (src/content/catalog/index.ts:512).

## Findings
### T2B-001 — `demomap` on a dedicated server console ends the process, and the test skips exactly that command
- **Verification (VERIFY-N): confirmed. Final severity: Medium.** demo-commands.ts:141 exempts only q2 from the dedicated return, and :40-41 always throws. A component test with `dedicated: true` showed `playdemo`, `demo`, `demos`, `stopdemo` and `startdemos` are silent, while `demomap foo` rejects from `executeAsync` under q1-netquake, q2-classic and q3. application.ts:4522 has no enclosing try (the try blocks in step close by :4506), run() at :4693 has none, and main.ts catches only to return 1. End-to-end exit was not re-run. prepared-startup.test.ts:46 omits demomap.
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/demo-commands.ts:40-41,141; src/app/bootstrap/application.ts:4522; src/main.ts:75-76,82; tests/app/prepared-startup.test.ts:46,49-51
- Confidence: reproduced
- Evidence: `play` returns early on dedicated for every demo command except Q2's: `if (this.host.dedicated && selected !== "q2") return;`. `demomap` therefore reaches `stage`, and localWorldDemoCommands' `stage` always throws: `Demo playback (${intent.request.name}) requires the graphical launcher; this application owns a local game.`. The dedicated stdin console drains into `await this.sourceCommands?.executeAsync(...)` (application.ts:4522), which has no guard. I started `bun src/main.ts --dedicated ... --game q2-classic-baseq2 --map base1` and sent `demomap foo` on stdin: the process printed that error with a stack through `step`, `run` and `main`, and exited rc=1 before the later `echo` and `quit` lines. `--game q1-classic-id1 --map e1m1` behaved the same. The test's dedicated branch runs `demos\nplaydemo demo1\nstopdemo\n` (prepared-startup.test.ts:46), which omits `demomap`, the one command that throws. Its non-dedicated branch pins the same throw as expected at :49-51. That branch is not reached from main, because non-dedicated launches go through StartupApplication (main.ts:75-76) and Application.openBorrowed (startup.ts:1203), which installs a working `stage` (startup.ts:610).
- Impact: `demomap` is a stock Q2 server command. An operator who types it stops the server and drops every connected client, with a message that mentions a launcher a dedicated server does not have. By the same path, a `demomap` line in a server script should abort the server (traced, not run). rcon is not affected: the path at application.ts:1746-1750 catches the error and prints it. `local(source)` refuses remote-client origins.
- Remediation: make `demomap` on dedicated either a no-op with a printed message or a real server demo, and do not throw from `stage` for console input. Add `demomap` to the dedicated list at prepared-startup.test.ts:46.

### T2B-002 — The unified audience filter's tests only prove denial, so dropping a player's own private events stays green
- **Verification (VERIFY-N): confirmed. Final severity: Medium.** Re-ran all three mutants of network-unified.ts. (a) `event.client < 0` left unified-host 1 pass, unified-events 1 pass and unified/server 7 pass. (b) missionpack-player `return false` and (c) addon `? false` left unified-host and unified-events at 1 pass each. No test names createUnifiedApplicationServerHost (only application.ts:1822,2849 call it).
- Severity: Medium
- Category: test-gap
- Location: src/app/bootstrap/simulation/network-unified.ts:61,81,96; tests/app/unified-host.test.ts:11-21; tests/network/unified-events.test.ts
- Confidence: reproduced
- Evidence: unified-host.test.ts is the main test of `unifiedPresentationFor`. It has one owner-positive case (q2 inventory, :12) and otherwise tests foreign or denied events, for example `client: 1` with the viewer on slot 0 (:20). No case targets the viewer's own slot. Three mutants left unified-host and unified-events green, 1 pass each: (a) `event.client < 0 || event.client === client.slot` to `event.client < 0`; (b) `missionpack-player` to `return false`; (c) q1 addon `own(event.event.player)` to `false`. Mutant (a) also left tests/network/unified/server.test.ts at 7 pass. A grep finds no test that references `createUnifiedApplicationServerHost`.
- Impact: a regression could silently stop delivering targeted Q3 server commands (centerprints, scores, per-client prints), IR goggles or punch angles to the player who owns them on a unified server. The suite would still pass because the filter would be stricter, not leakier.
- Remediation: pair each denied case with an owner case of the same event, including `client: 0` for the viewer's slot. A small table covers every `own(...)` branch.

### T2B-003 — The inactive-seat script read assertion cannot fail
- **Verification (VERIFY-N): confirmed-with-changes. Final severity: Low.** The assertion cannot fail: deleting prepared-startup.ts:223 left prepared-startup at 23 pass and prepared-client-commands at 9 pass. Correction: the stated impact is overstated. allowCommand (prepared-startup.ts:191, wired at :113, applied at commands/index.ts:774) refuses a retired seat's command before executeScript reaches readScript at :861, so an `exec` from a departed seat is stopped by that gate even without this guard. The guard is largely redundant on that path.
- Severity: Low
- Category: test-gap
- Location: tests/app/prepared-startup.test.ts:462,486; src/app/bootstrap/prepared-startup.ts:223
- Confidence: reproduced
- Evidence: `expect(await prepared.readScript("inactive.cfg", nested)).toBeUndefined();` runs with `consoleRoot: "/unused"`, `settings: new ConfigStore("/unused")` and `mounted: undefined`, so every script name reads as undefined whichever path runs. Deleting the guard `if (!this.currentContext(context)) return Promise.resolve(undefined);` leaves prepared-startup at 23 pass and prepared-client-commands at 9 pass.
- Impact: this is the only check I found of the guard that stops an inactive or retired seat's script chain from reading configuration. Removing the guard would go unnoticed, and an `exec` already queued for a departed seat would read its private seat directory.
- Remediation: give the fixture a `mounted` reader that returns a sentinel and counts calls, then assert zero calls for the inactive context and one for an active one.

### T2B-004 — Several assertions check less than their test title claims
- **Verification (VERIFY-N): confirmed. Final severity: Low.** (a) prepared-startup.test.ts:222-223 compares a value with itself before adopt. (b) q3-product-launch.test.ts:89-90 passes prerelease-ta-demo or prerelease-demo under a "retail aliases" title; q3ProductPolicy(false,false) in q3-product-policy.test.ts:9 is the retail case. (c) startup-commands.test.ts:63 checks only seen[0], and the fixture's default.cfg and autoexec.cfg both call `record`. (d) prepared-startup.test.ts:426 loops over slice(1), which can be empty.
- Severity: Low
- Category: test-gap
- Location: tests/app/prepared-startup.test.ts:222-223; tests/app/q3-product-launch.test.ts:79,89-90; tests/app/startup-commands.test.ts:63; tests/app/prepared-startup.test.ts:426
- Confidence: traced
- Evidence: (a) `const nextCommands = prepared.commands; expect(nextCommands).toBe(prepared.commands);` compares a value with itself, before `adopt` runs, in a test about the original buffer retaining its continuation. (b) q3-product-launch:79 is titled "registers retail aliases", but the non-demo branch passes `{ kind: "prerelease-ta-demo" }`, so `{ kind: "retail" }` never reaches PreparedStartup here. q3-product-policy.test.ts:9 does cover the map list for retail through q3ProductPolicy(false, false). (c) startup-commands:63 checks only `seen[0]`, although each dialect's scripts can call `record` more than once, so a duplicate or missing later phase is not seen. (d) `for (const source of seen.slice(1)) expect(source).toEqual(nested);` runs zero times if only one output arrived; the `rendered` checks above it reduce but do not remove that gap.
- Impact: small, since neighbouring assertions cover most of the same behavior. Each one gives false confidence on its stated point.
- Remediation: move (a) after `adopt`, add a real retail case for (b), and assert the full `seen` list and output count for (c) and (d).

## Supplements
- Supplements T2-003: the one-tick negative at prepared-startup.test.ts:606 is vacuous, as T2-003 suspected. With `Promise.all([settled, this.writes])` changed to `Promise.all([settled])` at config-scripts.ts:176, the assertion `expect(retired).toBe(false)` still passes. The test fails later, at :609, with ENOENT because `closing` no longer waits for the write. So the drain regression is caught, but by the file read and not by the assertion written for it.
- Supplements T2-010: scope sites with bare `.toThrow()` are configuration-content.test.ts:80,93; q3-guest-runtime.test.ts:111; qw-movement.test.ts:81; q3-server-save.test.ts:40,43,46; team-arena-demo.test.ts:11. The grep's other two configuration-content hits (:212,:226) are `.not.toThrow()`. None gave a false pass where tested; q3-server-save's three validation rejections were not mutated.
- Supplements TESTS-003: q3-product-launch.test.ts:34 fails without a corpus (reproduced, 5 pass 1 fail) because `retailId` opens pak0 at :27 only to get productid.txt. configuration-content.test.ts:47 already embeds those bytes as base64, so this corpus dependency is avoidable.
- Supplements TESTS-004: startup-world.test.ts fails when enabled with QUAKE_STARTUP_RETAIL_TEST=1 and QTS_TEST_CORPUS set, because :9 omits `--content-root` (`Content q2-rerelease-baseq2 requires: ...`). Adding `--content-root` and `--user-content-root` makes it pass, 7 expects in 2.16s, so the test is sound and only its launch arguments are wrong.
- Supplements TESTS-005: q3-guest-runtime.test.ts runs 1 pass and 8 skips without a corpus. The guest lifecycle tests use pak0 only for the q3dm7 scene and default.cfg (:54-58, :87), and the QVM is generated in the test, so a small synthetic archive and map could ungate them.
- Supplements TESTS-001: q3-runtime-warnings.test.ts:72-74 and startup-world.test.ts:9-11 call loadApplicationContent without `--user-content-root`, so catalog discovery uses defaultUserContentRoot() (src/app/bootstrap/content.ts:439). This is a read of the real profile; I traced no write from these two tests.
