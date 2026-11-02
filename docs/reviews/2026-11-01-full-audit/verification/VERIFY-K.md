# VERIFY-K — T1, T2 and T3 findings against HEAD fcdc8af5

Method: cited lines were opened in the project at HEAD; experiments ran from the scratchpad with SDL dummy drivers and a private HOME and TMPDIR. T2 mutants ran in a throwaway copy, since deleted. Harnesses are in `<scratchpad>/vk/x/`. "Read" below means checked by reading, not re-run.

## T1-003 detail
- **Is it a product bug? Yes.** The throw comes from production code (`content.ts:362`, reached from `remote-application.ts:2113` → `:2054`). The test does not cause it.
- **Is a display involved? No.** The test uses `--renderer cpu --hidden` with a `--dedicated` server, and the stack has no GL frame. It passed 9 times under `SDL_VIDEODRIVER=dummy`, so a missing display does not explain it.
- **Does it reproduce reliably? No, it is intermittent.** The unmodified test gave 9 pass and 4 fail in 13 isolated runs (31%). Each failure stopped at 33 `expect()` calls with this error. T1's "red at HEAD" is wrong; the test is flaky.
- **Rate per reload (harness, repeated same-map reloads):**
  - After a primary-seat drop and rejoin: 6 of 6 runs threw, within 29 reloads in total (about 1 in 5).
  - No drop: 0 throws in 33 completed reloads.
- **Corrected order of events (traced in 3 of 3 throwing runs with logging):**
  1. The non-primary seat's own load runs first and captures the old content.
  2. The primary load starts.
  3. The primary load closes the old content.
  4. `bindRemoteSeat` uses the closed content.

  T1 had this backwards; it said the bind happens before the seat's load refreshes the content.
- **Why the drop matters:** `primaryViewCurrent` (`:270`) short-circuits to true when `primaryPeer !== null`. The seat's load guard (`:1971`) is therefore open during a promoted primary's reload. With no promoted primary it also requires `primaryViewGeneration===worldLoadGeneration`. This link comes from reading the code; the logs confirm the order and the drop dependency.
- **Why the same-map reload closes content:** `replaceContent` is true through `pending !== null` (`:1179`). The trace logged `pending=true`.
- **T1's proposed fix is not sufficient.** I tested it by wrapping `peerWorldCurrent` to also require `peer.loadedContent===this.loadedContent`. In 3 of 3 runs the throw became a seat that stayed without a view (`view:false, active:true, contentCurrent:false`) past the 10 s wait. The seat's load has to wait for the primary's load, or be redone after it.
- **Separate, undiagnosed observation:** in the no-drop harness, seat 2 sometimes stayed unadmitted past 10 s (5 of 7 runs; `players:1`, server clients 1 or 2). At least the later of those runs overlapped other test runs, and the one run known to have no concurrent load did not stall; overlap was not controlled for. No throw occurred. This may be load or harness timing and is not claimed as a finding.

## Verdicts

### T1-001
Verdict: confirmed
Corrected severity: High
Reason: Re-run: `q1-quakeworld` with attack held gave `PlayerPostThink` 0 while `PlayerPreThink` went 1440→4320, `W_Attack` 0→0, shells 25→25. Local binding at runtime.ts:4092-4103 has no post-think; the only post-think is runtime.ts:4999, fed only through network-qw.ts:216.

### T1-002
Verdict: confirmed-with-changes
Corrected severity: High
Reason: Symptom reproduced, but T1's cause is refuted: `PlayerPostThink` ran 2449→4849, because `sourceCommand` is undefined locally and runtime.ts:4086 selects "immediate". Measured: `selectedArsenal.frame` called 0 times with `--movement qw` or `q2` and 30 with `q1`, so the fault also covers Q2 movement. Likely cause (read, not patched): runtime.ts:5406 serves only `q1-netquake`, and the `quakec` branch continues at :5421 before the :5441 frame call.

### T1-003
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Real product bug, but intermittent (4 of 13 test runs) and needs a promoted primary seat, so reach is narrow. The order is the reverse of T1's, and T1's fix only turns the throw into a seat with no view. See "T1-003 detail" above; remote-application.ts:270,1179,1971,2038.

### T1-004
Verdict: confirmed
Corrected severity: Medium
Reason: Read: qw-local-play:23-28 and lrctf-mixed:23-28 assert only health > 0 around held fire; q3-blackbox-arsenal:37 is conditional; classic-rerelease-campaigns:20-25 checks only program, edition and engine content. T1-001 and T1-002 pass these same assertion shapes.

### T1-005
Verdict: confirmed
Corrected severity: Medium
Reason: q2-native-foreign-enemies:62 uses `f >= 46`; grunt.ts has `army_run1` 73, `army_atk1` 81, `army_walk1` 90, so run and walk frames satisfy it. Lane not re-run; T1's measurement relied on.

### T1-006
Verdict: confirmed
Corrected severity: Medium
Reason: Re-run: Q2 peak 260.4 and Q1 peak 342.5, displacement 703.93 in both. The window at q2-native-foreign-movement:63-64,113-114 accepts both, and the baseline lane (:45-52) asserts no speed. Q1 is faster, so the comment is backwards.

### T1-007
Verdict: confirmed
Corrected severity: Low
Reason: Read: foreign-q3-maps:47-53 rechecks only presentation count after load; q2-native-foreign-enemies:102-111 uses `>= 5` both times.

### T1-008
Verdict: confirmed
Corrected severity: Low
Reason: Read: kex-q2-load:38,43,55 records base1, launches base1 and asserts base1, which holds even if `loadGame` does nothing.

### T1-009
Verdict: confirmed
Corrected severity: Low
Reason: Read: kex-q2-load:78-92 gates on the real Steam save under `homedir()` and asserts `toContain("rboss")`.

### T1-010
Verdict: confirmed
Corrected severity: Medium
Reason: Read: console-input:19-24, run-yield:7-11, level-autosave:88-92, save-menu:13-17, q2-application:21-25 and q2-downloads:246-249 all await an open before the `try` that removes the directory. The count of 56 was not recounted.

### T1-011
Verdict: confirmed
Corrected severity: Low
Reason: Read: hipnotic:33 discards the content; q2-shadow-light:52 omits `content.close()`; rerelease-presentation:150 with :187 omits `simulation.close()`; rerelease-flare:43,84 never closes the session; startup-selection:339 does not await `close()`.

### T1-012
Verdict: confirmed
Corrected severity: Low
Reason: Read: q1-fog:95 compares a structured clone with a literal; q2-preworld:31 prints itself; q3-ctf:45-46 asserts `>= 0`; base-arena-public:103 only logs.

### T1-013
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: 33 occurrences is right, but 10 are `.not.toThrow()`, which do not "accept any error". That leaves 23 checks. q2-travel:16 is representative.

### T1-014
Verdict: confirmed
Corrected severity: Low
Reason: Read: foreign-tag:13 documents scores of 3 and 5, while :91,:100 assert `>= 2` and `>= 4`; foreign-lmctf:109 and qw-ctf-rules:89 use `>= 15`.

### T1-015
Verdict: confirmed
Corrected severity: Low
Reason: q2-native-original:15-17 hard-links from the corpus and is gated at :12. `link()` to tmpfs at `/tmp` was not re-run, but a link to the tmpfs scratchpad returned EXDEV here.

### T1-016
Verdict: confirmed
Corrected severity: Low
Reason: Read: q2-downloads:261,266 have uncapped `while` loops, and the test closes at :275 with no timeout argument.

### T1-017
Verdict: confirmed
Corrected severity: Low
Reason: Read: `dropdownPick` is 47 lines at startup-monster-roster:158-204 and the startup-native `fixture` matches the finding. The helper-count totals were not recounted.

### T1-018
Verdict: confirmed
Corrected severity: Info
Reason: Read only, not re-run: server-browser-sort-filter:140-144 never checks `ping-low` values, q2-boss2 has the `< 30` bound, and hipnotic:136 has armor 0. The candidates remain refuted as T1 states.

### T2-001
Verdict: confirmed
Corrected severity: Medium
Reason: Mutant: removing the origin check at http-downloads.ts:54 left the test at 1 pass, 0 fail. A refused connection to `localhost:1` (test:291) also yields `fallback`.

### T2-002
Verdict: confirmed
Corrected severity: Low
Reason: Mutant: removing `socket.destroy()` at gtv-transport.ts:74 left 1 pass. The test's `finally` destroys the peers itself (test:40) before asserting at :44.

### T2-003
Verdict: confirmed
Corrected severity: Medium
Reason: Mutant: removing both `writes` from q2.ts:582 left 2 pass, 0 fail. application-recording:146 waits only one microtask before asserting.

### T2-004
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The gate at qw-host-download-policy:13 is real and no script sets it. Impact narrows to QuakeWorld: Q2 `allow_download*` paths run by default in tests/first-playable/network/q2-downloads.test.ts:53-55,260-265, which were outside T2's scope.

### T2-005
Verdict: confirmed
Corrected severity: Low
Reason: Read: q1/application:387, demo-input:180, q2/application-recording:83-88, unified/server:62-69 and q3/network:408 assert that errors propagate from `poll`.

### T2-006
Verdict: confirmed
Corrected severity: Low
Reason: Read: q1/application:244, qw-application:93,123 and q3/application:311 count distinct bytes from `readPixels` with a threshold of 16.

### T2-007
Verdict: confirmed
Corrected severity: Low
Reason: Read: the `exchange` pump is duplicated at q1/application:44 and :439; `musicWave` and `MusicContent` appear in both demo-input and remote-music. The pk3 writer copies were not reopened.

### T2-008
Verdict: confirmed
Corrected severity: Info
Reason: Read: q3/application:287-292 mutates `ps.ammo` under an env var; :299,:312 are capture branches; q2/old-demo:70 logs on each run.

### T2-009
Verdict: confirmed
Corrected severity: Low
Reason: Mutant: making `clear` a no-op at ranking-account.ts:10 left 1 pass. Submission already blanks the password (:48), and the button refuses an empty one (:45).

### T2-010
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: 128 occurrences is right, but 20 are `.not.toThrow()`, leaving 108. qw-downloads:48, mvd-encoding:57 and gtv-source:21 are bare as stated.

### T2-011
Verdict: confirmed
Corrected severity: Info
Reason: options.ts:67-71: `ApplicationCommand` has no `"error"` kind, so match-modes:27's `.not.toBe("error")` cannot fail. Only a throw fails the test.

### T3-001
Verdict: confirmed
Corrected severity: Medium
Reason: Re-run: widow.test.ts has 4 tests and reports 8; native-scan reports 13 for its single test, in 10.9 s here (T3 measured 17.5 s). Imports at widow:2, native-scan:5, debug-shapes:3, monster-damage:5, protection:5.

### T3-002
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The stub reproduced all three blind tests. Two cited sites are wrong and should be dropped: widow:35 zeroes `widowShotsFired` before restoring and checks the resulting shot, and rerelease.test.ts:142 clears events and asserts those restore emits. rerelease.test.ts:286 and the others stand.

### T3-003
Verdict: confirmed
Corrected severity: Medium
Reason: Re-run: with `WireDecoder.operation` stubbed to return only `kind`, the test at worker-protocol.test.ts:78-90 stays at 1 pass. No other test calls `decoder.operation` directly.

### T3-004
Verdict: confirmed
Corrected severity: Medium
Reason: Read: source.test.ts:23-24 opens `rerelease/<pack>` by default while guards at :62,:77,:90,:104 check classic; shared-world:22 guards Q2 and Q3 while :259,:361,:420 launch Q1; monster-application:305 and retail:19 match. Partial-corpus runs not repeated.

### T3-005
Verdict: confirmed
Corrected severity: Low
Reason: Read: arena.test.ts:197,:276,:314 wrap assertion blocks in `if` on corpus presence within one test ending at :464 with a 30 s timeout.

### T3-006
Verdict: confirmed
Corrected severity: Low
Reason: Read: q2-missionpacks monsters:105 uses a synthetic-row fallback with only `size > 3`; foundation/q2 monsters:93 is conditional; ctf:86-93 never checks team starts; horde:55 asserts `>= 2`.

### T3-007
Verdict: confirmed
Corrected severity: Low
Reason: Read: ai-save:73 checks the original store, not `restored`; image-lifetime:74 falls back to `operation`; worker-native:64 restates its branch condition.

### T3-008
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: 86 occurrences is right, but 29 are `.not.toThrow()`, including the audio-stale-actor site cited. That leaves 57 against 174, so about a quarter rather than a third.

### T3-009
Verdict: confirmed
Corrected severity: Low
Reason: Counts match within scope: 11 Q1 host files, 16 Q2 host files with 18 sites, 32 `GameplayAuthority` files. Drift confirmed at base.test.ts:51-56 against heavy/source.test.ts:41-44, and foundation/q2 monsters:57 against q2-base monsters:47.

### T3-010
Verdict: confirmed
Corrected severity: Low
Reason: Read: navigation/application:22,:87 and world-checkpoint:21,:57 close only content; bot-moving-geometry:37 never closes its `ApplicationBots`; `SceneTextureLoader.close` exists but models.test.ts does not call it on `textures1/2/3`. Retained size unmeasured.

### T3-011
Verdict: confirmed
Corrected severity: Low
Reason: Re-run: `"x {{{..."` throws only on the 1023-character token limit, while binary garbage gives 1 entry. This contradicts the comment at shaders.ts:104-106 and the one at unlexable-shader.test.ts:8-9.

### T3-012
Verdict: confirmed
Corrected severity: Info
Reason: Read: aas-reachability:11 fixes `ladder=false` and `options={}`, so the branches at :13,:25,:27-28,:33,:36 are dead; "Retail start.bsp missing" is at source.test.ts:25 and world.test.ts:24.

### T3-013
Verdict: confirmed
Corrected severity: Info
Reason: Read: runtime.ts:127 calls `#refresh()` from the getter, and checkpoint.test.ts:39-42 pins the resulting change to `worldRevision`.
