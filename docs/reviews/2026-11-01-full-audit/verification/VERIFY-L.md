# VERIFY-L — verification of verify-L.txt (T4, T4B, DOCS2, DOCS3) at HEAD fcdc8af5

Method: opened the cited code at HEAD in the project tree and tried to falsify each claim. Experiments ran from a copy under <scratchpad>/verifyL/inst (instrumented host.ts for DOCS3-007 only), with HOME/XDG/TMPDIR under the scratchpad and SDL dummy drivers; game data read-only. Project unchanged. No tsc, full policy run or full test suite. Test mutations reported by T4/T4B (T4B-001, -002, -007) were not re-run; I confirmed them by reading the assertions. DOCS3-008 rows were sampled, not every row re-opened. Logs: <scratchpad>/verifyL/real-q*.log, real-n*.log, repro-r1.log, run-a*.log, filters.txt.

### T4-001
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Paths at tests/persistence/source-saves.test.ts:16-17 are absent (.artifacts holds only resume-20260913, snapshots), no generator, no env override; both tests can never run. Overstated: "checked only against fixtures this project wrote" is false where Steam saves exist, since tests/persistence/kex-saves.test.ts:66,81 read installed KEX saves (gated on homedir). saved-game.test.ts:27 is corpus-relative, so redirectable, but start.sav is absent from the corpus.

### T4-002
Verdict: confirmed
Corrected severity: Low
Reason: tests/settings/mouse-axis.test.ts:58-59 writes 201 and asserts toBeCloseTo(0.044) at default precision; unclamped 0.04422 passes, so the clamp at src/ui/settings/index.ts:179 is unobserved. Line 34's 0.011 tolerates 45%.

### T4-003
Verdict: confirmed
Corrected severity: Low
Reason: tests/llm/settings.test.ts:60-65 asserts only the replacement key; no test calls saveApiKey after a subscription exists (settings.test.ts:87 saves before sign-in; models.test.ts:21 seeds without saving). src/llm/settings.ts:267 is correct today, so this is a guard gap with no live defect: Low, not Medium.

### T4-004
Verdict: confirmed
Corrected severity: Low
Reason: tests/llm/request.test.ts:136 is the only tool_calls fixture and also fails src/llm/api.ts:33 (finish not "stop") and :39 (no [DONE]), so :25-26 are not isolated; no refusal fixture in that file. Lines 25-26 are correct at HEAD, so no live defect: Low, not Medium.

### T4-005
Verdict: confirmed
Corrected severity: Low
Reason: The test spies prepareQ1ClipSolids, memoized in preparedClip (src/world/collision/q1/index.ts:200-201) and never evicted, so call counts hold whether clipCells evicts or not. No test asserts the limits. Remediation caveat: :202 only calls deriveQ1ClipSolids when prepared() returns null, so that spy alone may also miss re-derivation.

### T4-006
Verdict: confirmed
Corrected severity: Low
Reason: tests/platform/controller.test.ts:96-97 expects exact instances; src/platform/controller.ts:253 takes the first unclaimed device, with no virtual filter. Line 5 reads the runtime getter (controller.ts:194-197, calls sdl()) at import. Not run with hardware.

### T4-007
Verdict: confirmed
Corrected severity: Low
Reason: q3-native-graph.test.ts:62-69 never calls restoreQ3Graph; digest-cache.test.ts:14 counts no reads; rocket-effects.test.ts:48,65-66 assert the literal just built. frontend-mouse: after selecting Q2 the test asserts sensitivity 7.5 and filter true despite the Q2 profile holding 9, because startup.ts:200 passes shared settings and frontend-preferences.ts:135-141 overlays global tuning.

### T4-008
Verdict: confirmed
Corrected severity: Low
Reason: tests/persistence/q2-classic-guest.test.ts:112-117 has nine mutations under one bare toThrow, including maps/../escape.bsp. Count is higher than stated: about 56 non-negated bare toThrow() lines in the scoped directories, not about 40.

### T4-009
Verdict: confirmed
Corrected severity: Low
Reason: tests/input/input.test.ts:348 uses the retail file only for one readEntry; kex-saves.test.ts:87 gates on the corpus and uses the catalog for rows/s1?.game (:98,:106). tests/support/corpus.ts returns "" when unset, so template paths probe /q3a/... and resolve/join probe the cwd, against the comment at corpus.ts:8. equipment.test.ts:15 discovers at import.

### T4-011
Verdict: confirmed
Corrected severity: Info
Reason: tests/llm/settings.test.ts:178 spawns bash and curl unguarded; a missing curl yields Number("")=0 and the failure reads as a listener bug.

### T4-012
Verdict: confirmed
Corrected severity: Info
Reason: Refuted-candidate list holds where opened: image-settings.ts:273 close only saves; animation.ts:64 documents MDL fresh objects; playback.test.ts:126 spawns native-smoke.ts. Ran toEqual({a:0}) against {a:-0} under Bun: it fails, so core/math.test.ts:53 does discriminate -0.

### T4B-001
Verdict: confirmed
Corrected severity: Low
Reason: tests/movement/q1/movement.test.ts:343-344 and q2/movement.test.ts:320-321 have only toBeLessThanOrEqual after the loop, so no forward motion passes. Measured positions and the Q2 precheck values were read, not re-run.

### T4B-002
Verdict: confirmed
Corrected severity: Low
Reason: tests/audio/bootstrap.test.ts:153-158 asserts only some(sample !== 0) after each playMusic, so a track that never changes passes. :159 stopsound precedes the "0" silence check at :160-161, so that check is not isolated.

### T4B-003
Verdict: confirmed
Corrected severity: Low
Reason: images.test.ts:83 reads typed-array length, which cannot change. q2-native.test.ts:105 reads a literal freshly built by environment() (:75-81). playback.test.ts:440 applies Number.isFinite to Int16Array samples.

### T4B-004
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Holds for tests/audio/bootstrap.test.ts (Application.open at :47,:241,:326; :114 asserts outputState "playing"), with no bunfig preload and package.json:12 setting no driver. Citation wrong for playback.test.ts:191,197: UnifiedAudio's constructor opens nothing (src/audio/engine.ts:100-106), only openDevice (:429) does, and that test is at :525 under the :509 dummy gate.

### T4B-005
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Re-ran auditProgram on fixtures: 0 diagnostics for node:vm, data: import, new Worker eval:true, Reflect.get(Bun,'spawn') narrowed and called, Reflect.get(process,'dlopen'). Control Bun.spawn is caught. The sixth does not hold in my form: Reflect.get(Object.getPrototypeOf(async function(){}),'constructor') drew unsafe-any and unsafe-argument. tools/check-policy.ts has no Reflect handling. No use in src.

### T4B-006
Verdict: confirmed
Corrected severity: Low
Reason: tests/materials/materials.test.ts:97 is the only test reference to cloudTexCoord, and it checks that .x is finite; no test names SkyBuilder or cloudCoords. Rendered-output coverage through src/render/scene/shaders.ts:9,55 was not excluded.

### T4B-007
Verdict: confirmed
Corrected severity: Low
Reason: playback.test.ts:69-84 has no second sound on an occupied channel; :107-124 hard-codes reverbPreset(5). q2 movement.test.ts:124-127 sets upMove once with no release step. :340,:349,:364,:371 assert only not.toEqual, which falling satisfies.

### T4B-008
Verdict: confirmed
Corrected severity: Info
Reason: tests/audio/startup.test.ts:160 creates the spy before try; :448 restores inside the try body, not finally; tests/materials/images.test.ts:142 closes outside finally.

### T4B-009
Verdict: confirmed
Corrected severity: Info
Reason: Refuted-candidate list. bootstrap.test.ts:126,336 and native-ui.test.ts:113-114 read as described. Instrumented counts were not re-run.

### DOCS2-001
Verdict: confirmed
Corrected severity: Medium
Reason: docs/functional-targets/status.md:28 and integration-20260918.md:18 claim VCR/journal joined. Searches for vcr outside src/guest find only msvcrt strings; com_journal/net_vcr/vcrplay names return nothing; journal hits are unrelated (image-journal); git log has no vcr/journal commit. priorities:183-185 sets the done test.

### DOCS2-002
Verdict: confirmed
Corrected severity: Low
Reason: docs/project-status-current.md:54 and implementation-priorities.md:235 hold MOTD open; no getmotd/motdResponse/client-motd in src or tests; g_motd is the separate configstring (spawn.ts:249,267). Minor: docs/menu-source-comparison.md also mentions motd.

### DOCS2-003
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The save half is refuted. saveGame goes through writeSavedGame to writeContainedSave (src/persistence/saved-game.ts:25, save-policy.ts:49), and containedSaveName throws. Reproduced: "../escape" and an absolute settings.conf both give RangeError "outside the save directory". So the row's "live save command accepts an arbitrary path" is stale for writes. The load half holds: application.ts:4275 then original-save.ts:17 read any path, and save-policy.test.ts:14-17 pins that as imports. No arbitrary write, so not Medium security.

### DOCS2-004
Verdict: confirmed
Corrected severity: Medium
Reason: 37 rows counted. Anchors opened for nearly all and they contradict the stated reasons, e.g. decode.ts:6 and bsp-kind.ts:10 (IBSP44), assets.ts:137 (materialMovie), input-devices.ts:22,34, application.ts:1092 (readScript), network/q2.ts:23,133, network/q3.ts:58-62, demo-commands.ts:59. As the finding says, a false reason does not prove the whole requirement complete.

### DOCS2-005
Verdict: confirmed
Corrected severity: Low
Reason: completion-status.md:578 vs remaining-source-rows.md:111-112 on ConfigStore; :895 "remain unclaimed" vs :242 "persists per-seat enable flags and strength"; :679 vs rows:162. Rows:298 says "not fully wired", so scales is a softer conflict than "opposite".

### DOCS2-006
Verdict: confirmed
Corrected severity: Low
Reason: Seven SHAs present at the cited lines. README:113 names 07d54ae (2026-09-18), an ancestor of v1.0.0 (2026-09-26). execution-status.md:215 sits under the heading "Earlier installed executables" (:213), so that one is labelled history, as the finding notes.

### DOCS2-007
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Table holds where opened (priorities:225, performance:97, project-status-current:87,154, 2026-09-11:105, execution-status:353,427,722). Wrong citation: the s_info fix is at src/app/bootstrap/audio.ts:246, not :248.

### DOCS2-008
Verdict: confirmed
Corrected severity: Low
Reason: docs/project-plan.md:106 says synchronous; contracts/session.ts:151 and world/session/session.ts:441 await stepAsync. src/catalog, src/scene, src/connection and src/app/modules.ts do not exist.

### DOCS2-009
Verdict: confirmed
Corrected severity: Low
Reason: r_smp default 0 (image-settings.ts:90), but row-parallel.ts:193-200 defaults to min(4, cores-1) and rasterizer.ts:1164 creates the pool lazily. Scoped docs omit it; only docs/releases/1.2.1.md:33 mentions QTS_CPU_WORKERS.

### DOCS2-010
Verdict: confirmed
Corrected severity: Info
Reason: Quoted statements exist at the cited lines (execution-status.md:173,199,241,243,257,406,494,499,700; project-plan.md:13,80), and no prepass hit in src/app/bootstrap/simulation. Whether each limitation is still live was not tested, as the finding states.

### DOCS3-001
Verdict: confirmed
Corrected severity: Medium
Reason: src/compat/q2/native-input.ts:277 zeroes viewoffset, :286 (not :285) writes normal (0,0,1); runtime.ts:7102 maps slotless ground to world; :7106-7109 unions overlap solids into touches. No write of pm_time, delta_angles and the other listed outputs. Player-visible effect remains unproven; reach is foreign-movement lanes only.

### DOCS3-002
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Host-derived serverTime (runtime.ts:7081) and one player.move per command (:7091) hold. "One long step" is wrong for Q3: src/movement/q3/move.ts:524-525 slices to its fixed step from serverTime. QW taking one msec step per command is source behavior. Remaining effect is unmeasured host-time quoting, hence Low.

### DOCS3-003
Verdict: confirmed
Corrected severity: Low
Reason: runtime.ts:6941 creates the mirror with team:null, mass 200; :6935-6950 re-syncs from HUD and overwrites; :1686-1687 syncs before monster frames; :8110 omits it from saves. No player-visible damage loss was established.

### DOCS3-004
Verdict: confirmed
Corrected severity: Medium
Reason: No honoredBy in src. Only signal is the deferred report (runtime.ts:1645,1677). guest-monsters.ts:78 keeps every monster when projection is false. foreignNativeMovement compares clock kind only (runtime.ts:6846-6851). The enemies test pins only console text.

### DOCS3-005
Verdict: confirmed
Corrected severity: Medium
Reason: tests/first-playable/application/q2-native-foreign-movement.test.ts:19,72 and -character.test.ts:19,61 pass no --content-root or skip; test-corpus.log shows "requires:" failures in about 18 ms. No dual-run: "trajectories" appears only in a comment (movement.test.ts:10).

### DOCS3-006
Verdict: confirmed
Corrected severity: Low
Reason: Host side confirmed: runtime.ts:7403 skips only host actors, so a bodyque edict reaches modelAppearance (classic-guest-services.ts:339 resolves index 255). DLL side not run; still plausible rather than reproduced, and cosmetic.

### DOCS3-007
Verdict: confirmed-with-changes
Corrected severity: High
Reason: Cause found, and foreign enemies are not required. M_CheckDodge's BoxEdicts filter (game_x64.dll RVA 0x77400, passed at 0x77f6a) calls self->monsterinfo.dodge at edict+0x9d0; the duck path links the monster (guest return address RVA 0xfa1f8, after call 0xfa290), or a gunner's dodge fires a grenade that links, and host.ts:407 throws on any link under #filterDepth. Reproduced 5 of 5 on plain q2-rerelease-baseq2 base2 with --q2-game game_x64.dll, no foreign selection: player placed in front of soldier_light (3 runs), soldier_ss or infantry, real blaster, no projectile edits (a 6th lane, gunner, found no clear target spot and did not run). See cause note below.

### DOCS3-008
Verdict: confirmed
Corrected severity: Low
Reason: Sampled rows hold: audio.ts:576, input.ts:425,544, qvm-grapple-selection.ts:7, base-arena-progression.ts:39-40, runtime.ts:867,7971,8149, simulation/bots.ts:221, simulation/network.ts:102, seat-hud-state.ts:135; quake-mixer.ts deleted; 3 quake64 products with null unresolvedReason. These are dated comparison docs with an as-of statement, so Low, not Medium.

### DOCS3-009
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Claims hold: ui.ts:221-222, gameplay.ts:29-46, rotation via server.ts:29, startup-menu.ts:132-133,369,839, 994 at :16, 133 and 68 row counts. Counts off: "No application-owned" is 15 rows, not 19; "in flight" is 18 lines, not 15. The file is unlinked from docs/README.md and dated to 392b3e37, so Low.

### DOCS3-010
Verdict: confirmed
Corrected severity: Low
Reason: docs/tick-execution.md has no step for tickNativeCharacters/runGuestMonsters (runtime.ts:7188-7189) and no foreign-provider branch at :16. Measurements cite 563f0a99, b72b9ad6, 72794d58; drivers are .artifacts paths.

### DOCS3-011
Verdict: confirmed
Corrected severity: Low
Reason: mod-compatibility.md:258 vs :401 conflict; :401 ab3e3adf note; :431 open under T12 vs status.md:20. Q2_RR_SPAWN_PROBE appears only in src/guest/runtime/windows/README.md:21. foundation/README.md:19 has the scrubbed path.

### DOCS3-012
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Mostly holds: remaining-work.md:13; no MOTD/journal hits; network/q2.ts:149,722; tools/verify has three files; QuakeCExecutor only in compat/qc/index.ts and tests. Correction: "prompts reach only local QC" is too strong. network/remote-q1.ts has none, but unified transport carries them (simulation/network-unified.ts:62, network/unified-event-codec.ts:291, game-prompt.ts:50). VCR and MOTD overlap DOCS2-001/-002.

### DOCS3-013
Verdict: confirmed
Corrected severity: Info
Reason: NATIVE_INTERPOSITION_REPORT.md:1624-1625 cites /tmp probes; :1801,:1849-1850 recommend honest refusal, opposite of the shipped design. File is untracked.

## DOCS3-007 cause note
Trigger path: RunFrame -> monster think -> M_CheckDodge -> gi.BoxEdicts(filter 0x77400, data=self) -> filter -> self->monsterinfo.dodge -> gi.linkentity -> host.ts:407 throw.
- Identification is from disassembly plus runtime DIAG. Function names come from my recollection of the published rerelease source and were matched to behavior, not to symbols. Static: of the 8 filters passed at the 9 BoxEdicts sites, only 0x77400 calls out through a guest pointer; the others are pure or math-only.
- The filter is the retail DLL's own code, so the "cannot modify world links" rule contradicts it. That answers the question the finding left open.
- Why intermittent: the dodge needs an FL_DODGE projectile on course for a dodging monster and passes a random gate. The foreign-enemies test's player never fires, so only guest monster projectiles can trigger it. RNG seed comes from _Xtime_get_ticks at RVA 0x6a9dc (mt19937 init at 0x6a9e2-0x6aa1f), which the host serves from trunc(performance.now()) (application.ts:590, crt.ts:12), so it varies with startup timing. Identical launches differed run to run (filter 0x77400 counts 51288, 52488, 52499 at the throw). That test passed 6 of 6 here and failed once in test-corpus.log; I did not capture a filter address from that failing run, so attributing it to 0x77400 is inference from the matching stack shape and the static result.
- Separately, an early doctored run (repro-r1.log), where I moved a real bolt in front of a gunner, threw with target=grenade.
- Reach: built-in q2-rerelease-* products default to the TS port (content.ts:159-165). It applies with --q2-game game_x64.dll and to add-on products requiring that DLL. Not tested on a dedicated server with a remote client; if that path holds, a remote player's shot could end the server, which would meet Critical.
- Fix evidence: with the throw disabled for linkentity under filter (DODGE_NOGUARD), both lanes ran until the target died, with guardHits 1 and 2 and no error. spatial.boxEdicts iterates a snapshot (rerelease-guest-services.ts:104 returns .map output), so relinking does not invalidate the loop. Longer play and save/load after a filter-time link were not tested.
