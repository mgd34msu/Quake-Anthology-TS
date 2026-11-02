# APP — Application composition, lifecycle, startup, CLI and crash logging

## Coverage
Read in full (9,335 lines): src/main.ts (97), src/version.ts (2), src/app/bootstrap/application.ts (4817), remote-application.ts (2515), startup.ts (1473), options.ts (329), splash.ts (102).

Sampled (read specific regions or scripted scans, not whole files): effects.ts (753; map lifetimes, close), audio.ts (671; frame()), presentation.ts (540; close, prepare allocation scan), input.ts (1055; allocation scan, command forwarding), server-browser.ts (436; growth scan), server-browser-cache.ts (101; head), image-settings.ts (274; prepareClientSettings, close), content.ts (538; loadApplicationContent, resolveApplicationTravel), frame-time.ts (86), startup-saves.ts (135; external save resolve), save-requests.ts (17), prepared-startup.ts (497; forwarding only), configuration.ts (448; grep), selected-q3-presentation.ts (223; close), rerelease-presentation.ts (228; close scan), startup-source.ts (83; throws), addon-library.ts (219; close), q3-client.ts (598; serverSettings scan), q3-client/client-state.ts (120; retire).

Read outside scope only to complete a trace: src/llm/settings.ts:94-110, src/persistence/save-policy.ts:31-34, src/network/q1/profile.ts, src/content/user-data.ts, network/q1-client.ts, q2.ts, qw-client.ts, q3-client.ts, unified-client.ts, q3-client-content.ts close paths, network/remote.ts:193-200, remote-q1.ts:240-249, simulation/runtime.ts:5100-5108, tests/app/crash-log.test.ts.

Skipped: the remaining ~130 files under src/app/bootstrap (startup-menu.ts 973, startup-selection.ts 864, character-turntable.ts 549, presentation-state.ts 465, presentation-scene.ts 418, mod-presentation.ts 417, mod-presentations.ts 389, assets.ts 366, q3-client/** other than noted, and small helpers), about 21,000 lines. They got no line-by-line review. Findings below do not imply those files are clean.

Limitation: per the brief I did not read ~/.local/share/quake-typescript/crash.log. The crash-log investigation uses the three symptoms as relayed in the assignment and reproductions under a fake HOME in the clean checkout.

## Strengths
- World replacement is a staged candidate/publish protocol. prepareAndReplaceWorld validates before commit, collects retirement errors per step (application.ts:3037-3066), and rolls back candidates (3214-3240).
- Per-world state is held in WeakMaps keyed by simulation (keyProfiles, baseArenaProgress, teamArenaDemos, movieRequests, publishedUserinfo), so these do not pin retired worlds.
- Command queues are bounded EventRings (16384 and 32768) rather than unbounded arrays. reportedEffectGaps and event rings are reset on travel (application.ts:3128-3131).
- mapResourcePath rejects `..` and restricts characters. Save writes are contained by containedSaveName. LLM credentials are written with 0600 (llm/settings.ts:132), and malformed LLM files are reported rather than fatal (llm/settings.ts:107).
- The splash child exits on stdin EOF, so a hard parent exit cannot orphan it (splash.ts:45-49).
- Suspicions I traced and refuted, so not reported: native Q2 per-seat effects leak (presentation.ts close closes them when ownsEffects is true); leaked initial transport on primary seat drop (each network close() closes its transport); Q3ClientContent leak (it closes the same content already owned by loadedContent, and close is idempotent); candidate image settings leak (close only saves, and candidates defer persistence); retained `movies` entries for failed candidates (handle stop detaches).

## Findings

### APP-001 — A main loop error always ends the process; there is no Host_Error-style recovery
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: High.** A listen client recovers in Host_Error, but a dedicated server exits by design: WQ host.c:142 `Sys_Error ("Host_Error...")`, likewise Host_EndGame host.c:104. So "closes a dedicated server" on a QC error matches the original; the deviation for dedicated servers is the number of new throw paths, not the absence of recovery. Source review: SRCQ1
- Severity: High
- Category: robustness
- Location: src/app/bootstrap/application.ts:4693-4705, 4685-4689; remote-application.ts:2315-2326, 2286; startup.ts:1384, 1424-1431; src/main.ts:82-94
- Confidence: traced
- Evidence: `await this.step(elapsed);` (application.ts:4701) has no surrounding try. step's catch only rethrows: `if (!this.fatalWorldFailure) { await this.capture?.beforeWorldChange(); throw ... }` (4686). The same holds for RemoteApplication (`catch (error) { await this.capture?.beforeWorldChange(); throw error; }`, 2286) and StartupApplication (`const output = await active.step(...)`, startup.ts:1384, no try), which owns a working frontend it could return to. `fatalWorldFailure` exists to separate recoverable from unrecoverable failures, but the non-fatal branch is treated identically by every caller.
- Impact: A non-fatal exception in any per-frame path (a QuakeC or QVM runtime error, a throw from publish or poll, an audio or effect prepare failure) closes a dedicated server with all clients connected, or drops a graphical client to the desktop instead of the menu. Combined with previously reported peer-triggerable input exceptions, one bad event ends a multi-hour server.
- Remediation: Catch non-fatal step errors in the run loops. On a dedicated server, report and restart or travel to the current map; in StartupApplication, retire the source and return to the frontend with the message as status.

### APP-002 — A server can terminate the connected client process through world-load failures
- **Verification (VERIFY-A): confirmed. Final severity: High.** mapResourcePath (options.ts) only accepts `[a-zA-Z0-9_/-]` and rejects dots/plus/space/quote (verified by reading the regex); server-supplied map/sound/image names reach it and throw (remote-application.ts:1167,1233,1239). q3-client.ts:139 / unified-client.ts:90 mark rejected, call host.disconnected, then rethrow; no caller catches → client process exit (APP-001) instead of a menu return. Hostile-server client DoS. Traced.
- Severity: High
- Category: robustness
- Location: src/app/bootstrap/remote-application.ts:1167, 1176, 1233, 1239, 1042, 796; network/q3-client.ts:139; network/unified-client.ts:90; startup.ts:1384
- Confidence: traced (mapResourcePath rejection reproduced; the full path to exit was not run, because that needs a window)
- Evidence: Server-supplied names reach `mapResourcePath(world.map)` (1167) and `throw new Error(`Server sound is absent from mounted content: ${path}`)` (1233; only QW downgrades this to a print at 1232), plus the matching image case (1239). mapResourcePath only accepts `[a-zA-Z0-9_/-]`. Reproduced: `q3dm17.v2`, `dm3+`, `ctf-2.fort`, `foo bar` and `ab'c` all throw `RangeError: Invalid map name`. The network layers mark the connection rejected and notify the host, then rethrow: `catch (error) { this.state = 'rejected'; this.options.host.disconnected(...); throw error; }` (q3-client.ts:139, same shape at unified-client.ts:90). I found no catch in q2.ts poll or remote.ts:197. advanceSource rethrows (remote-application.ts:796), and no caller catches.
- Impact: Connecting to a server running a map with a dot or plus in its name, or using a sound or image the client lacks (with downloads off or failed), exits the client with a crash-log entry instead of showing a disconnect message. Any hostile server can do this at will. The process closes through main's finally, so this is a remote denial of service rather than memory corruption.
- Remediation: Treat loadContent failures as a disconnect with the reason: stop rethrowing after host.disconnected, and have StartupApplication return to the menu. Make missing sounds and images a warning for all families, as QW already does, and stop using the CLI map validator on server-supplied names.

### APP-003 — A missing or invalid rotation or changelevel map kills the server, while the console path survives
- **Verification (VERIFY-A): confirmed. Final severity: High.** Game-driven travel is unguarded — application.ts:3510 `await this.replaceWorld(mapResourcePath(matchMap), ...); return;` and :3560 `await this.replaceWorld(map, carry);` sit in no try, while the console path (3524) and the Q2 campaign path (3540-3542 via reportCampaignTravelError) are guarded. A bad rotation/changelevel map ends the server at match end though the prior world was intact. Traced.
- Severity: High
- Category: bug
- Location: src/app/bootstrap/application.ts:3507-3511, 3559-3561, 3540-3542 (unguarded); 3524-3530, 3499-3504 (guarded)
- Confidence: traced
- Evidence: Console map changes are guarded: `try { await this.replaceWorld(map, null, ...); } catch (error) { if (this.fatalWorldFailure || this.content !== previous) throw error; ...print... }` (3524). Game-driven travel is not: `await this.replaceWorld(mapResourcePath(matchMap), this.simulation.captureTravel()); return;` (3510) and `await this.replaceWorld(map, carry);` (3560). Only the Q2 campaign branch reports its error (3556-3557). A failed replaceWorld before commit rejects with the original error, which reaches APP-001.
- Impact: A typo in a Q2 map rotation, or a QuakeC `changelevel` to an absent map, ends the dedicated server at the end of a match, dropping every player. The preceding world was still valid and intact, because candidate preparation failed before commit.
- Remediation: Apply the guarded pattern at all travel sites and keep the current world on non-fatal failure. For rotation, advance to the next entry or restart the current map.

### APP-004 — EPIPE on stdout is treated as a crash, and on a server it is fatal mid-run
- **Verification (VERIFY-A): confirmed. Final severity: High.** main.ts:74 print sink calls `process.stdout.write(text)` unguarded; main.ts:48 and the crash path (92) also write unguarded. Author reproduced the `--list-content | head` / `--help | head` EPIPE crash entries under a fake HOME, and on a running server piped to a logger the next host.print throws inside its callback → APP-001. Code confirmed.
- Severity: High
- Category: bug
- Location: src/main.ts:34-35, 38-39, 41, 48, 74, 89-93
- Confidence: reproduced (CLI cases); traced (running server)
- Evidence: Reproduced under a fake HOME. `bun src/main.ts --help | head -0`, `--list-content ... | head -0` and `weapon-behavior --help | true` each exit 1, print a stack and append `Error: EPIPE: broken pipe, write` to crash.log. The write fails synchronously inside main (stack: `writeFast` called from `main (src/main.ts:48:62)`). The game's own output goes through the same unguarded call: `print: (text: string): undefined => { recentOutput.push(text); process.stdout.write(text); return undefined; }` (74). With both streams closed, one invocation writes two entries, and the second replaces the real message: `Unknown option: --bogus-option` then `EPIPE` (reproduced), because `process.stderr.write` at line 92 itself throws.
- Impact: This is the source of the `--list-content | head` crash entries. On a dedicated server piped to a logger that restarts or exits, the next `host.print` throws inside whichever callback printed, including guest-module callbacks, and the server shuts down through APP-001.
- Remediation: Make the print sink tolerate EPIPE: drop further stdout output and keep running. For one-shot commands, exit 0 on EPIPE without a crash entry. Guard the stderr writes in the crash path.

### APP-005 — Crash log drops the causes of AggregateError and Error.cause
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** main.ts:21 logs only `error.stack ?? error.message`. Rerun: the log for an AggregateError and an Error with `cause` contained neither root string. main.ts:34-35,92 use the same format on stderr.
- Severity: Medium
- Category: robustness
- Location: src/main.ts:21, 34-35, 92
- Confidence: reproduced
- Evidence: `${error instanceof Error ? error.stack ?? error.message : String(error)}`. Reproduced with writeCrashLog: for `new AggregateError([new Error("ROOT-CAUSE-A"), new Error("ROOT-CAUSE-B")], "Application shutdown failed")` and `new Error("outer", { cause: new Error("ROOT-CAUSE-C") })`, the log contains none of the three ROOT-CAUSE strings. AggregateError is the standard failure type for this layer: application.ts:966, 1865, 2030, 2136, 3241, 3796, 4728, 4813; remote-application.ts:579, 587, 2392; startup.ts:1471.
- Impact: Multi-step teardown failures and failed-world failures log only a summary title and the stack of the aggregator. The information needed to diagnose the failure is discarded on both stderr and disk.
- Remediation: Format errors recursively, walking `.errors` and `.cause` with a depth bound, and use that formatter for both the file and stderr.

### APP-006 — A close failure replaces the original fatal error
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** main.ts:82-86 has no catch, so a throw from `application.close()` in finally replaces the run error. close() returns the cached rejected promise (application.ts:4718), so the "World publication and shutdown failed" aggregate from :4728 is discarded.
- Severity: Medium
- Category: bug
- Location: src/main.ts:82-88; application.ts:4717-4730
- Confidence: traced
- Evidence: `try { await application.run(); } finally { ...; await application.close(); }` (82-86), followed by `finally { await llm?.close(); }` (88). A throw inside finally replaces the pending exception. Application.close returns the cached `this.closing` promise (4718), so after closeFailedWorld has built `AggregateError(errors, "World publication and shutdown failed")` with the original inside (4728), main's finally awaits the same rejected promise and rethrows `"Application shutdown failed"`, discarding the original.
- Impact: The most serious failures are also the ones most likely to have secondary teardown errors. In that case the crash log names the secondary failure and not the root cause. Together with APP-005, nothing about the root cause survives.
- Remediation: Capture the run error, attempt close separately, and report both (for example with SuppressedError or an AggregateError) so the original stays primary.

### APP-007 — Invalid CLI arguments are logged as crashes, with stack traces and sometimes the wrong message
- **Verification (VERIFY-E): confirmed. Final severity: Low.** Rerun: `--width abc` prints a stack and `--bogus-option` gives `Missing value for --bogus-option` (options.ts:176-177), and both append to crash.log (main.ts:37,91). The harm is a noisy message and log with no gameplay impact, so it is minor.
- Severity: Medium
- Category: bug
- Location: src/main.ts:36-37, 89-93; src/app/bootstrap/options.ts:176-177, 282
- Confidence: reproduced
- Evidence: parseApplicationCommand runs inside the crash-logging try. Reproduced: `bun src/main.ts --width abc` appends `=== Quake Anthology 1.2.6 crash ... RangeError: --width must be an integer` and prints a stack rather than usage. An unknown flag as the final argument is misreported, because options.ts:176 consumes a value before the switch: `--bogus-option` gives `Missing value for --bogus-option`, and `bogus` gives `Missing value for bogus`, while `bogus x` gives `Unknown option: bogus`. The same applies to ordinary launch failures such as `No installed game data found` (startup.ts:301) and `--q1-protocol 16` (`Unsupported NetQuake protocol 16`).
- Impact: Users get a stack trace for a typo, and crash.log fills with non-crashes, hiding real ones.
- Remediation: Parse outside the crash path with a distinct usage-error type: print one line plus a pointer to --help, exit 2, write no crash entry. Reject unknown flags before consuming a value.

### APP-008 — The crash-log test appends to the developer's real crash.log on every run
- **Verification (VERIFY-E): confirmed. Final severity: Low.** crash-log.test.ts:10 calls main() with no directory override and main.ts:91 uses the default directory. There is no bunfig or HOME override, and it is the only `main([` call in tests. Real test pollution, but it affects only a diagnostic log.
- Severity: Medium
- Category: test-gap
- Location: tests/app/crash-log.test.ts:10; src/main.ts:13, 91
- Confidence: reproduced
- Evidence: `expect(await main(["--definitely-invalid-option"])).toBe(1);` has no directory override, because main() always calls `writeCrashLog(error, argv)` with the default directory. The test's temporary `home` is only used by the later direct call at line 11. Running it under a fake HOME produced `=== Quake Anthology 1.2.6 crash ... argv=["--definitely-invalid-option"]` in that HOME's crash.log. It is the only test calling main(), and it also pins the APP-007 behavior (exit 1 through the crash path).
- Impact: Every `bun test` adds a false crash entry to the real log. This explains at least part of the "invalid CLI args logged as crashes" symptom. Entries with that exact argv are test noise, not user failures. The test also covers neither EPIPE nor nested errors.
- Remediation: Inject the crash directory into main (or a host object) and use the temporary directory in the test. Add cases for EPIPE, AggregateError and cause.

### APP-009 — "application composition is not yet wired" cannot come from any revision I could reach
- **Verification (VERIFY-J): confirmed. Final severity: Info.** git log --all -S and git grep at HEAD find nothing for "not yet wired". main.ts:20 header records only version; version.ts first read 1.2.6 at 1b703833. The fsck sample and worktree checks were not repeated.
- Severity: Info
- Category: docs
- Location: src/main.ts:20; src/version.ts:2
- Confidence: traced
- Evidence: Investigation of the crash-log message: `git log --all -S"not yet wired"`, `-S"application composition"` and `-S"phase hosts"` return nothing. `git log --all -g -S"not yet wired"` (reflogs) returns nothing. `git grep` at HEAD finds nothing in src or docs. There is no stash. A sample of 40 unreachable commits from `git fsck --unreachable` has no match in src (the sample was capped at 40, so it is not exhaustive). Worktree /tmp/qts-base (v1.2.0) has no match; /tmp/qa-base is listed as prunable and has no src to search. dist/ holds only runtime.json. version.ts has read 1.2.6 since 1b703833 (2026-10-26), and HEAD still reads 1.2.6.
- Impact: The most likely origin is an uncommitted working-tree state or another build after 2026-10-26, which I cannot prove. It is not a live code path at HEAD and needs no code fix. The underlying weakness is real: the log header records only `version`, which does not change between release commits, and every checkout or build writes to the same `~/.local/share/quake-typescript/crash.log`. Entries cannot be attributed to a revision or source tree.
- Remediation: Add the git revision (or a build id) and Bun.main to the crash header. Treat this one entry as stale unless it recurs.

### APP-010 — A console typo or bad `load` while connected exits the client
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** remote-application.ts:1597 and startup.ts:1337 have no catch, mapResourcePath (options.ts:142) and parseLoadRequest (save-requests.ts:10) throw, and commands/index.ts:268 rethrows. Reach is wider than the title: with no world, startup.ts:526 forwards to frontendCommand and routeCommand the same way, so the menu console is affected too.
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/startup.ts:699-711, 1337, 1365-1371; remote-application.ts:1592-1600; prepared-startup.ts:81; startup.ts:527
- Confidence: traced
- Evidence: `map` and `load` are deferred commands (prepared-startup.ts:81) forwarded to RemoteApplication.queueCommand. Borrowed dispatch is unguarded: `await this.ownership.client.dispatchApplicationRequest({...})` (remote-application.ts:1597). That calls routeCommand (startup.ts:1337), where `this.game === null` holds for a remote source, and these throw: `mapResourcePath(args[0])` (705-706), `parseLoadRequest(args)` (710, `Usage: load ...`), and `saveCommandPath` (711). executeRemoteCommand's catch at 1789 is never reached in borrowed mode. The rethrow travels through afterDispatch (1365-1371) to the run loop.
- Impact: Typing `map foo.bar` or `load a b c` in the console during a network game or demo closes the application. `+map foo.bar` and `+load` at startup also fail through startup.ts:527 as crash entries. I did not find this reachable through server stufftext: the one handler I opened (remote-q1.ts:242-249) filters by command name, but I did not check every family.
- Remediation: Catch and print in dispatchApplicationRequest or routeCommand, matching the handling of mvdconnect at startup.ts:672-677.

### APP-011 — World load time is fed into the next simulation step; Q2 has no upper clamp
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** server/sv_main.c:741-746 "never get more than one tic behind" clamps svs.realtime to sv.time. Source review: SRCQ2
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/application.ts:4694-4702; startup.ts:1351; frame-time.ts (Q2 branch `return controls.timescale === 0 ? rawMilliseconds : Math.max(1, rawMilliseconds * controls.timescale);`); simulation/runtime.ts:5103-5104
- Confidence: traced
- Evidence: run() sets `previous = now` before `await this.step(elapsed)`. In-game travel happens inside step via applyTransition (4471), so the next iteration's `elapsed` includes the whole load. It is only reset for video restarts: `if (this.videoRestart?.generation !== generation) previous = performance.now();` (4702). StartupApplication resets lastFrame on launches (1216) but not on travel inside a running source. sourceFrameMilliseconds clamps Q1 to 100 ms and Q3 to 200 ms local or 5000 ms dedicated, but Q2 has no bound. The guest loop `while (this.sourceSchedulingMilliseconds >= ... + profile.serverFrameMilliseconds)` then runs every tick.
- Impact: After a 5-second Q2 map load, the first frame simulates about 50 server ticks before the player sees the level, so monsters and timers advance unseen. A Q3 dedicated server jumps up to 5 seconds per map change.
- Remediation: Reset the frame timestamp after any world operation, and clamp the Q2 delta as the Q2 server's fall-behind clamp does.

### APP-012 — Secrets on the command line are persisted to a world-readable crash log
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** main.ts:20 writes argv verbatim. Rerun: `hunter2` appears in the log and the file mode is 644. Exposure to other local users also depends on home directory permissions, which the code does not control.
- Severity: Medium
- Category: security
- Location: src/main.ts:20, 19; options.ts:161-162
- Confidence: reproduced
- Evidence: `argv=${JSON.stringify(argv)}`. Reproduced: writeCrashLog with `["+set","rcon_password","hunter2"]` writes `hunter2` to the log. The file created under the fake HOME has mode `-rw-r--r--`. `+command` arguments are the documented way to set cvars, including `+set rcon_password`, `+set password` and `+mvdconnect -p <password>` (parseGtvConnect, startup.ts:674). The log is never redacted, while LLM credentials elsewhere are carefully 0600.
- Impact: Server and account passwords persist in plain text, readable by other local users, and are likely to be shared when someone attaches a crash log to a bug report. Recent output (up to 32 KB) has the same exposure.
- Remediation: Create the log 0600, redact values following password-like cvar names and `-p` in argv, and consider logging flag names only.

### APP-013 — Audio frame deduplicates actors and bodies in O(n²), doubled on remote clients
- **Verification (VERIFY-E): confirmed. Final severity: Low.** audio.ts:563-566 is quadratic and remote-application.ts:2254,2279 always duplicates the primary snapshot. By the finding's own numbers, 256 actors doubled costs about 1 ms per frame. The 12 ms figure needs a 1024-actor world, which is not typical.
- Severity: Medium
- Category: performance
- Location: src/app/bootstrap/audio.ts:563-566; remote-application.ts:2254, 2279
- Confidence: reproduced (micro-benchmark using the real ActorId.equals)
- Evidence: `actors.filter((actor, index) => actors.findIndex(other => other.id.equals(actor.id)) === index)` and the same for bodies, every frame. `snapshots = [snapshot, ...seatEvents.map(batch => batch.snapshot)]`, so a batch using the same snapshot doubles n. RemoteApplication always builds at least one batch from `output.snapshot` (2254), so the doubling is permanent there; locally it occurs on frames with private events. Measured per pass: n=256 0.20 ms, n=1024 1.75 ms, n=2048 6.05 ms. There are two passes per frame, about 12 ms at n=2048 (a 1024-actor world doubled), against a 16.7 ms frame at 60 Hz. These timings were taken on one machine with a synthetic actor list, not from a live game.
- Impact: Busy worlds and all network play spend a noticeable share of the frame on deduplication that is usually removing exact duplicates.
- Remediation: Skip batches whose snapshot is the same object, and deduplicate with a keyed Map or Set when more than one distinct snapshot exists.

### APP-014 — Per-frame allocation throughout step and presentOutput
- **Verification (VERIFY-H): confirmed. Final severity: Low.** Allocations are present at application.ts:1047, 4356-4369, 4430, 4441-4447, 4550-4551; remote-application.ts:234-237; startup.ts:253. Unprofiled, as the finding says.
- Severity: Low
- Category: performance
- Location: src/app/bootstrap/application.ts:4356, 4365-4372, 4430, 4441-4447, 4534, 4550-4551, 4572; 1047; remote-application.ts:234-237, 611, 2279-2283; startup.ts:253, 1410
- Confidence: traced (not profiled)
- Evidence: presentOutput rebuilds several filtered event arrays per frame (4356, 4365, 4367, 4369, plus per-seat `eventsFor` at 4430) and allocates listener objects (4441). `localPlayers` is a getter that maps on every read (1047) and is read repeatedly per frame. `[...this.clientCvars.values()].some`, `clientIdentities().filter(...botClients.some...)` (4550-4551) and userinfo strings (`infoString` at 4534 and `playerUserinfo` at 4572, per seat per frame, only to compare for change) add to it. RemoteApplication's `source` getter allocates a new object per read once a peer is promoted (236), and is read about 15 times per frame. The menu runs `JSON.stringify([movementDialect(options), this.model.bindingItems()])` every frame (startup.ts:253, called from 1410).
- Impact: Steady GC pressure at up to 250 Hz. The event arrays are mostly empty, so the cost is modest per frame, and I measured none of it. It is a candidate for cleanup, not a demonstrated bottleneck.
- Remediation: Early-out on empty event lists, cache locals until seats change, and use a cvar modification counter instead of rebuilding userinfo strings.

### APP-015 — A settings write failure before the launch try block exits the application
- **Verification (VERIFY-H): confirmed. Final severity: Low.** startup.ts:1171 and :257 are unguarded. step reaches launch at :1321 and the baseline at :1410; run (:1427) propagates to main.ts:90-94, which logs and returns 1. persistPreferences (:245-249) catches nothing.
- Severity: Low
- Category: robustness
- Location: src/app/bootstrap/startup.ts:1163-1174, 1171, 257, 1410
- Confidence: traced
- Evidence: `await this.persistPreferences();` (1171) runs before `try {` (1174), and refreshPreferenceBaseline writes at 257, called from the frame loop at 1410. Neither is guarded, while the onChange path handles the same failure: `void this.persistPreferences().catch(... "Could not save controls" ...)` (201), and close() does too (1443-1444).
- Impact: On a full disk or read-only settings directory, pressing Play or switching products in the menu exits the application rather than warning.
- Remediation: Use the same print-and-continue handling at these sites.

### APP-016 — LLM credential migration silently imports files from the current directory
- **Verification (VERIFY-H): confirmed-with-changes. Final severity: Low.** main.ts:55 uses cwd only for source runs; a compiled build imports from dirname(execPath), so "launch from that directory" means the executable's directory there. The re-import is proven: llm/settings.ts:278 rm's other.key, and main.ts:60 copies it back on next launch if a legacy copy exists. baseUrl is limited to HTTPS or loopback by settings.ts:50-51.
- Severity: Low
- Category: security
- Location: src/main.ts:55-60
- Confidence: traced
- Evidence: `const legacyLlmDirectory = compiled ? dirname(process.execPath) : process.cwd();` then `copyFileSync(resolve(legacyLlmDirectory, name), resolve(llmDirectory, name), constants.COPYFILE_EXCL)` for `llm.json`, `chatgpt.key`, `other.key`, `other.service`. This runs on every launch with no marker that migration finished. `other.service` holds `baseUrl` (llm/settings.ts:13, 45-52). Any of the four that is absent from the settings directory is imported again. copyFileSync does not apply the 0600 the service uses when writing (llm/settings.ts:132), and the source is left in place.
- Impact: A directory or download containing `other.service` can set the LLM endpoint when the user has not configured one, so a key added later would be sent to it. Requires the user to launch from that directory. A credential removed in settings could return from a leftover legacy copy on the next launch; I did not confirm how the service removes these files.
- Remediation: Migrate once with a marker, force 0600, remove the source on success, and do not import from cwd.

### APP-017 — The data root is hard-coded in six places and `--user-content-root` is only partly honored
- **Verification (VERIFY-H): confirmed-with-changes. Final severity: Low.** Five literal paths exist (application.ts:420, 467; remote-application.ts:533; startup.ts:209, 811). main.ts:13, 26 are not literals; they call defaultUserContentRoot() and ignore the option. remote-application.ts:532 does honor host.saveDirectory, while startup.ts:811 does not.
- Severity: Low
- Category: maintainability
- Location: src/main.ts:13, 26; application.ts:420, 467; remote-application.ts:533; startup.ts:209, 811
- Confidence: traced
- Evidence: `join(homedir(), ".local", "share", "quake-typescript", "settings")` and the `saves` variant recur independently of `options.userContentRoot`. application.ts:420 ignores the option even though ImageSettings honors it (image-settings.ts:76). startup.ts:811 builds the server-profile store from homedir although the instance already derives settings from saveDirectory (200, 211, 403).
- Impact: With a custom root, content and image settings move, while saves, server profiles, browser state, LLM settings and the crash log stay in HOME. Hosts that pass a custom saveDirectory get a mix: server profiles do not follow it.
- Remediation: Resolve one user-data layout object at startup and pass it down.

### APP-018 — CLI validation gaps
- **Verification (VERIFY-H): confirmed. Final severity: Low.** Re-run from clean: all six cited inputs parse as described (options.ts:176-177, 263-264, 304-305). `--game --dedicated` gives product "--dedicated", dedicated false. Explicit `--mode singleplayer` becomes coop with --seats 2 or --listen.
- Severity: Low
- Category: robustness
- Location: src/app/bootstrap/options.ts:176-177, 194, 263-264, 304-309
- Confidence: reproduced
- Evidence: Parser results from the clean checkout. `--game --dedicated` is accepted with `product: "--dedicated"`. `--connect-q2 --seats` is accepted with `remote: "--seats"`. `--bind "not a host" --listen 1` is accepted. `--dedicated --connect-q2 x` passes parsing and only fails later at application.ts:657, after content opens. `--dedicated` with no listener is accepted and runs a server nobody can reach. An explicit `--mode singleplayer` is silently changed to `coop` by `--seats 2` or `--listen`.
- Impact: Mistakes surface late with unrelated errors, or not at all. A flag consumed as a value also silently disables what the user asked for (`--game --dedicated` opens a window).
- Remediation: Reject values starting with `--` for options that cannot legitimately take them, validate conflicts in the parser, and error on contradictions with an explicit --mode.

### APP-019 — Crash log grows without bound
- **Verification (VERIFY-H): confirmed. Final severity: Low.** main.ts:19-21 appends up to 32768 tail characters per entry. No rotation or size check appears in main.ts, the only src file mentioning crash.log.
- Severity: Low
- Category: leak
- Location: src/main.ts:18-21
- Confidence: traced
- Evidence: `appendFileSync(resolve(directory, "crash.log"), ...)` with a tail of up to 32768 characters per entry, and no rotation or size check anywhere in src.
- Impact: Growth tracks crash count, up to about 32 KB per entry. A service manager restarting a server that fails on boot, or a script hitting APP-004, adds entries indefinitely.
- Remediation: Rotate at a fixed size and keep the last few files.

### APP-020 — Duplication and density in the two application classes
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** Rechecked 4817 and 2515 lines, 364196 bytes, 17 and 16 lines over 300 characters, and constructor counts 3/1/1, 3/1/1, 3/1/1, 4/1/1, 2/2/0. reportedEffectGaps clears at application.ts:3131 with no clear in remote; closingDuringStep is at remote-application.ts:2359; run() copies match.
- Severity: Medium
- Category: maintainability
- Location: src/app/bootstrap/application.ts (4817 lines, 364 KB); remote-application.ts (2515 lines, 192 KB); application.ts:2629-3245, 842, 1988, 3009, 3880; remote-application.ts:2315-2326
- Confidence: traced
- Evidence: Scripted comparison: 87 lines of 40+ non-whitespace characters are identical between the two files (fields, run-adjacent getters, publication and retirement fragments). The more important duplication is structural, because the copies have been edited apart. Construction sites: `new WorldSeatPresentation` 3 in application.ts plus 1 in remote plus 1 in remote-seat-view.ts, with up to 20+ positional arguments (3009, 3880); `new ApplicationSeatUi` 3+1+1; `new ApplicationEffects` 3+1+1; `new ApplicationAssets` 4+1+1; `new ConsoleScriptFiles` 2+2. Copies with behavior differences: reportedEffectGaps is cleared on travel in Application (3131) but never in RemoteApplication (286, 2251); close() waits for the step in Application (4732) but uses a `closingDuringStep` branch in RemoteApplication (2359). `run()` is effectively identical in both (4693-4705, 2315-2326). prepareAndReplaceWorld is one 617-line method with more than 20 mutable locals tracking commit state, and openSource is about 320 lines. Line length: 17 lines over 300 characters in application.ts and 16 in remote-application.ts.
- Impact: Lifecycle fixes must be made several times and are easily missed. APP-001, APP-002 and APP-003 are all consequences of per-site error handling that differs by copy. The size also limits how well the teardown ordering can be verified by review.
- Remediation: Extract a shared seat-presentation factory and frame-loop host first, then split prepareAndReplaceWorld into named stages with an explicit transaction object. No behavior change is needed for the first step.

### APP-021 — Candidate content opens outside the cleanup try
- **Verification (VERIFY-H): confirmed-with-changes. Final severity: Low.** application.ts:2651 opens content, :2669 can throw, and the try starts at :2723. Only startup-source.ts:80 is a realistic trigger (maxclients over 64). Line 68 clamps first (:67), so it is unreachable for finite values. The path also requires sameSourceOwner and no save, map or skirmish override.
- Severity: Low
- Category: leak
- Location: src/app/bootstrap/application.ts:2651, 2669, 2723, 3240
- Confidence: traced
- Evidence: `const content = await loadApplicationContent(options, recipe);` at 2651, with cleanup `await discard(() => content.close());` at 3240 inside the try that starts at 2723. Between them, `resolveStartupRules(...)` (2669) can throw (startup-source.ts:68, 80: `Invalid source startup difficulty`, `Source startup client capacity must be between...`), driven by cvars a user can set.
- Impact: Each failed travel with such a cvar leaves the destination's mounts open until process exit. It is narrow and needs repeated failed travel to matter.
- Remediation: Open the try immediately after loadApplicationContent.

### APP-022 — Unguarded steps in otherwise exhaustive shutdown sequences
- **Verification (VERIFY-H): confirmed-with-changes. Final severity: Low.** The cited addons.close rejection is refuted: addon-library.ts:119 wraps every pending in .catch, and HttpDownloadQueue.cancel (http-downloads.ts:358) is synchronous with no await-dependent failure. The bare steps at application.ts:4776, 4778 and startup.ts:1467 remain, plus uncited startup.ts:1445 (Promise.all of movie preparations), which is the stronger candidate after closed=true.
- Severity: Low
- Category: robustness
- Location: src/app/bootstrap/application.ts:4776-4778; startup.ts:1433-1441, 1465-1468
- Confidence: plausible
- Evidence: Application.closeOwned wraps almost every step, but `state.retire()` and `this.guestBrowser?.view.close()` are bare (4776, 4778). StartupApplication.close sets `this.closed = true` first (1434), then `await this.addons.close();` (1436), where `await this.pending` can reject (addon-library.ts:218). A rejection there skips everything below it, and `if (this.closed) return;` (1433) prevents a retry. `releaseSourceCommands.runAll()` (1467) is also bare. LocalQ3ClientState.retire itself only clears state and looks safe. I did not confirm that addons.pending can reject in practice.
- Impact: If triggered, settings saves, source retirement and renderer close are skipped on the way out.
- Remediation: Run these through the same collected-errors pattern as the neighboring steps.

### APP-023 — Minor retention of retired owners on the frontend
- **Verification (VERIFY-H): confirmed. Final severity: Low.** this.gtv is set at startup.ts:1266 and cleared only at :1439; returnToFrontend (:1071-1091) leaves it. savedGames is assigned only at application.ts:500 with ??=.
- Severity: Low
- Category: leak
- Location: src/app/bootstrap/startup.ts:1266, 1082, 1439; application.ts:500
- Confidence: traced
- Evidence: `this.gtv = { source: remote, id, label }` (1266) is only cleared in close() (1439); returnToFrontend (1071-1091) clears game and remote but not gtv. Separately, `this.savedGames ??= new StartupSaves(this.content.catalog, ...)` (application.ts:500) keeps the first world's catalog for the application's lifetime, though each travel discovers a new one (APP-024).
- Impact: Bounded to one retired RemoteApplication object graph until the next GTV connection or exit. Its native resources are already closed, so this is heap retention only, and it does not scale with session length.
- Remediation: Clear gtv in returnToFrontend; rebuild savedGames on travel or use the current catalog.

### APP-024 — Each map change repeats installed-content discovery
- **Verification (VERIFY-J): confirmed. Final severity: Info.** application.ts:2651 calls loadApplicationContent(options, recipe) with no catalog, so content.ts:439 discovers again. 58-80 ms figure not re-run.
- Severity: Info
- Category: performance
- Location: src/app/bootstrap/application.ts:2651; content.ts:439
- Confidence: reproduced
- Evidence: prepareAndReplaceWorld calls `loadApplicationContent(options, recipe)` with no catalog, so `installedCatalog ?? await discoverInstalledContent(...)` runs. Measured 58-80 ms per discovery with the local Steam Quake root (13 installed products).
- Impact: Small relative to a level load. Noted because it is avoidable, and because each world holds a distinct catalog instance.
- Remediation: Pass the current catalog unless content has changed.

### APP-025 — QuakeWorld server challenges use Math.random while Q2 and Q3 use the CSPRNG
- **Verification (VERIFY-H): confirmed-with-changes. Final severity: Low.** Correct path is src/app/bootstrap/network/qw-server.ts:93; the cited network/qw-server.ts does not exist. application.ts:1845 passes Math.random; handshake.ts:242 builds the challenge from two 15-bit draws. Q2 and Q3 use crypto at :1841.
- Severity: Low
- Category: security
- Location: src/app/bootstrap/application.ts:1841, 1845; network/qw-server.ts:93
- Confidence: traced
- Evidence: `random: () => Math.trunc(Math.random() * 0x7fffffff)` is passed to QwServerNetwork, where it feeds `new QuakeWorldChallenges(options.random)`; Q2 and Q3 get `crypto.getRandomValues` (1841).
- Impact: Math.random is not designed to resist prediction, which weakens the challenge's protection against spoofed connects. I did not attempt a practical attack.
- Remediation: Pass the existing crypto `random` to QW as well.

### APP-026 — No tests for the riskiest lifecycle failure paths
- **Verification (VERIFY-H): confirmed. Final severity: Low.** grep for EPIPE across tests and src is empty; "Server sound is absent" occurs only in remote-application.ts. tests/app/crash-log.test.ts:10 calls main without a directory override, as APP-008 states.
- Severity: Low
- Category: test-gap
- Location: tests/app/crash-log.test.ts; tests/first-playable/application/run-yield.test.ts
- Confidence: traced (grep-based)
- Evidence: `grep -rl EPIPE tests src` finds nothing. A grep for `Server sound is absent` plus `.run()` across tests/app and tests/first-playable matched only three files, by way of `.run()` (addon-library-menu, q3-selected-clock, run-yield), and I did not read their bodies. I found no test named for run-loop error behavior, remote world-load failure, failed travel on a game-driven transition, or nested crash-log errors.
- Impact: The behaviors in APP-001 to APP-006 are unpinned, and the one existing crash test pins the wrong behavior (APP-008).
- Remediation: Add focused tests with fake hosts for each path alongside the fixes.
