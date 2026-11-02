# DOCS2 — Status and planning docs read in full, checked against code at HEAD fcdc8af5

## Coverage

Read line by line, untruncated:
- docs/execution-status.md (935), docs/functional-targets/README.md (124), performance.md (175), integration-20260918.md (60), remaining-source-rows.md (357), docs/implementation-priorities.md (514), docs/project-plan.md (216), docs/project-status-2026-09-11.md (211), docs/project-status-current.md (297)

Read through a lossless reduction, with the rest checked by script:
- docs/completion-status.md (969). Raw lines 1-140 were read directly. For the rest, every done row was read with its verdict, method and title. A reason repeated verbatim was read at its first occurrence and shown as a back-reference after that. Source-path cells were existence-checked by script, not read. Every not-done reason (184 rows) was machine-compared and is byte-identical to remaining-source-rows.md, which was read in full.
- docs/functional-targets/remaining-source-rows.json (3,654). Lines 1-80 were read directly. For all 184 rows, id, title, reason, family and area were machine-compared to the MD (no differences). Basis was tallied (all `missing-work`) and sourcePaths existence-checked. The `dependencies` block was not compared field by field against the MD table.

Not read: nothing else in scope. Code was checked by targeted reads and exhaustive `rg`, not by reading whole subsystems. No test suite, tsc or policy run.

Findings below exclude DOCS-001 to DOCS-019. Where a claim sits in a section the doc itself labels historical, the entry says so.

## Strengths

- Ledger arithmetic is sound. All section headings, family totals and method totals in completion-status.md match its rows (Q1 124/56, Q2 118/75, Q3 51/53; methods 102/16/6, 63/32/23, 39/7/5). The same 184 open IDs appear in completion-status.md, remaining-source-rows.md and .json, and the priorities appendix, each once. Priority subtotals sum to 184.
- All non-`.artifacts` relative links in the 10 Markdown docs in scope resolve. The one dead source path found is `verification/features/q3.json`, in the JSON row for `q3.source-applications.role-accounting`, already covered by DOCS-013.
- Specific technical claims I checked hold at HEAD:
  - exact-envelope cache limits 128/1024/4096/16384 (src/world/collision/q1/index.ts:210-214)
  - eight GL layouts (src/render/gl/buffers.ts:77)
  - weak-key split bounds (src/world/geometry/q1-solid/polyhedron.ts:11)
  - MD3 early rejection (src/render/scene/models/prepare.ts:400-401)
  - `qts:snapshot-v10` (src/app/bootstrap/network/unified-content.ts:92)
  - `r_smp` default 0 (src/app/bootstrap/image-settings.ts:90)
  - ranking provider "unavailable" state and "sole permitted placeholder" comment (src/network/services/rankings.ts:2,58)
  - the plan's assertion ban (tools/check-policy.ts:513-514)
- performance.md consistently states the limits of its evidence and records rejected experiments. These docs rarely over-claim on performance.

## Findings

### DOCS2-001 — T20 is recorded as complete with "journal/VCR ownership" joined, but src contains no Q1 VCR and no Q3 event/config journal
- **Verification (VERIFY-L): confirmed. Final severity: Medium.** docs/functional-targets/status.md:28 and integration-20260918.md:18 claim VCR/journal joined. Searches for vcr outside src/guest find only msvcrt strings; com_journal/net_vcr/vcrplay names return nothing; journal hits are unrelated (image-journal); git log has no vcr/journal commit. priorities:183-185 sets the done test.
- Severity: Medium
- Category: docs
- Location: docs/functional-targets/integration-20260918.md:18, docs/functional-targets/status.md:28, docs/functional-targets/README.md:49, docs/implementation-priorities.md:183-185,230,234, docs/project-status-current.md:48,53
- Confidence: traced (exhaustive search; no runtime launch)
- Evidence:
  - integration-20260918.md:18: "T20 | Public recording/replay, source libraries, MVD/GTV, KEX recorded views, server recording, VCR/journal ownership, and ordered shutdown have consumers." status.md:28 says the same under "Complete in accepted source". README:49 lists "Q1 VCR, Q3 event/config journals" as T20 obligations. priorities:185 sets the done test: "journal/VCR paths reproduce their specified inputs and configuration behavior". priorities:230,234 and project-status-current:48,53 still say Open.
  - `rg -i vcr src` outside src/guest returns only `msvcrt` strings (src/contracts/numeric.ts:37, src/world/session/clocks.ts:100, src/platform/freetype.ts:29, src/persistence/shared.ts:39-41). `rg -i 'com_journal|journalFile|net_vcr|vcrrecord|vcrplay|sv_vcr'` over src returns nothing.
  - `rg -i journal` over src finds only unrelated uses: `RenderImageJournal` (src/render/image-journal.ts:22), a mod-client comment (src/world/session/mod-client-applications.ts:12), an error string in src/app/bootstrap/simulation/runtime.ts:8525 and src/content/q1/missionpacks/world/campaign.ts:46.
  - `git log -i --grep='vcr\|journal'` returns no commits, and no file with vcr or journal in its name was deleted.
- Impact: The one target table that claims this work is wrong, and T20 is counted in the "22 of 23" headline. Anyone trusting it will not schedule the work. I searched by name, so an implementation under an unrelated name is possible, but no command, cvar or test exposes one.
- Remediation: Remove "journal/VCR" from status.md T20 and the integration table. Reopen those two obligations or record an explicit descope.

### DOCS2-002 — The Q3 external MOTD service is still unimplemented and no functional target carries it
- **Verification (VERIFY-L): confirmed. Final severity: Low.** docs/project-status-current.md:54 and implementation-priorities.md:235 hold MOTD open; no getmotd/motdResponse/client-motd in src or tests; g_motd is the separate configstring (spawn.ts:249,267). Minor: docs/menu-source-comparison.md also mentions motd.
- Severity: Low
- Category: docs
- Location: docs/project-status-current.md:28,54, docs/implementation-priorities.md:195,235, docs/functional-targets/README.md:28-52 (T01-T23 rows), docs/functional-targets/status.md
- Confidence: traced
- Evidence: project-status-current:28 says MOTD remains "part of the project scope" and :54 cites the donor `client-motd.ts`. priorities:235 says "Open source-inventory lead. Priority 24". The T01-T23 table and status.md never mention it; among non-scope docs only source-inventory-reconciliation.md does. `rg -i 'getmotd|motdResponse|client-motd' src tests` returns nothing. The only `motd` code is the server `g_motd` configstring (src/content/q3/base/game/spawn.ts:249,267, src/content/q3/presentation/info.ts:110), which project-status-current:54 says is a different feature.
- Impact: "22/23, T10 only remaining" (README:5, remaining-work.md) silently omits a stated in-scope service.
- Remediation: Assign it to T19 or T09 as open, or record a descope decision.

### DOCS2-003 — Open row `q2.save.eligibility-paths` still holds and is broader than stated: `save` and `load` escape the save directory
- **Verification (VERIFY-L): confirmed-with-changes. Final severity: Low.** The save half is refuted. saveGame goes through writeSavedGame to writeContainedSave (src/persistence/saved-game.ts:25, save-policy.ts:49), and containedSaveName throws. Reproduced: "../escape" and an absolute settings.conf both give RangeError "outside the save directory". So the row's "live save command accepts an arbitrary path" is stale for writes. The load half holds: application.ts:4275 then original-save.ts:17 read any path, and save-policy.test.ts:14-17 pins that as imports. No arbitrary write, so not Medium security.
- Severity: Medium
- Category: security
- Location: docs/functional-targets/remaining-source-rows.md:256, docs/implementation-priorities.md:329, src/persistence/save-policy.ts:31-34, src/app/bootstrap/application.ts:4261-4265,4273-4276, src/app/bootstrap/save-requests.ts:2-6
- Confidence: traced for the console and script path; plausible for guest-issued commands
- Evidence:
  - Row: "the live save command accepts an arbitrary path".
  - Code: `return resolve(directory, extname(name) === "" ? \`${name}.sav\` : name);`. An absolute path or `../..` passes, and any extension is kept. application.ts:4263-4264 then does `const path = saveCommandPath(this.saveDirectory, name); await this.saveGame(path, format);`. The usage string advertises it: "save <name or path>".
  - A `containedSaveName` helper exists beside it (save-policy.ts:36-38), but this command path does not call it.
  - The `save`/`load` commands are registered on the normal command buffer (application.ts:1075). So config scripts run them, and QC `localcmd` plausibly does too, since execution-status.md:704 says it joins application command phases. I did not trace localcmd through to this handler. Remote clients are refused (src/app/bootstrap/remote-application.ts:1770).
  - No finding in findings/ covers this. FORMATS-007 covers the contents of a loaded save, not this path. The row appears in status docs only as a historical open item, and T16 is "complete".
- Impact: A hostile `.cfg` or, if the localcmd path holds, a mod can write save bytes to any user-writable path that has a file extension, such as `save /home/user/.config/app/settings.conf`. An extensionless name gets `.sav` appended. I did not check whether `saveGame` refuses an existing target. It can also make `load` read a save from any path, which then reaches FORMATS-007.
- Remediation: Require explicit opt-in for out-of-directory paths and refuse them for script and guest-sourced commands. Keep the ledger row open until then.

### DOCS2-004 — At least 37 of the 184 "open" reason sentences are false at HEAD, so the backlog cannot be used to plan work
- **Verification (VERIFY-L): confirmed. Final severity: Medium.** 37 rows counted. Anchors opened for nearly all and they contradict the stated reasons, e.g. decode.ts:6 and bsp-kind.ts:10 (IBSP44), assets.ts:137 (materialMovie), input-devices.ts:22,34, application.ts:1092 (readScript), network/q2.ts:23,133, network/q3.ts:58-62, demo-commands.ts:59. As the finding says, a false reason does not prove the whole requirement complete.
- Severity: Medium
- Category: docs
- Location: docs/functional-targets/remaining-source-rows.md and .json, docs/completion-status.md, docs/implementation-priorities.md:250-505 (rows below)
- Confidence: traced for each stated reason. I checked that the stated reason is false, not that the whole requirement is complete.
- Evidence: DOCS-004 named only Tag/DeathBall and v5/v6. README:9 and priorities:248 warn that reasons may be stale, but no row is marked, and priorities:3-7 still calls this "the ordered common-engine backlog".

| Row (remaining-source-rows.md line) | Stated reason | HEAD |
|---|---|---|
| `q1.content.quake64` (72) | "no identified content" | src/content/catalog/products.ts:26,40,41 |
| `q3.formats.ibsp44-compatibility` (76) | "IBSP44 compatibility path is missing" | src/formats/q3-map/decode.ts:6, src/formats/bsp-kind.ts:10 |
| `q3.content.demo-product-profiles` (75) | "sets demoRestricted to false" | src/app/bootstrap/keys.ts:47,63, src/app/bootstrap/network/q3.ts:61 |
| `q3.presentation.materials-cpu-gl` (88), `q3.media.world-and-menu-video` (344) | registry has no cinematic provider | src/app/bootstrap/assets.ts:137 passes `materialMovie` |
| `q3.audio.raw-pcm-output-diagnostics` (101) | output "fixed at 44100 Hz, stereo, 16-bit" | src/audio/engine.ts:117-120, execution-status.md:349-353 |
| `q3.audio.a3d-geometry-contract` (99) | no per-source obstruction | src/audio/geometry.ts:6, src/app/bootstrap/audio.ts:6 |
| `q3.input.joystick-profiles-hotplug` (114) | SourceInputState "no application caller" | src/app/bootstrap/input-devices.ts:22,34 |
| `q3.input.midi-controller` (115) | no MIDI lifecycle | src/app/bootstrap/input.ts:640, src/input/midi.ts |
| `q3.configuration.console-scripts` (125) | no `readScript`, exec fails | src/app/bootstrap/application.ts:1092 |
| `q3.network.ipx-transport` (140) | no IPX joined | src/app/bootstrap/options.ts:115-116, src/network/common/ipx.ts |
| `q2.admin.masters-heartbeat` (158) | no heartbeat | src/app/bootstrap/network/q2.ts:23,133 |
| `q2.browser.master-lan`, `.status-details`, `.sort-filter` (162-164) | ServerBrowser "not constructed by the startup application" | src/app/bootstrap/server-browser.ts; see also the ledger's own `q2.browser.favorites` |
| `q1.mg3.lavasuit` (213) | item "absent" | src/content/q1/addons/items/lavasuit.ts:23, items/index.ts:16 |
| `q2.content.native-starts`, `q2.content.start-map-discovery` (229-230) | no mapdb parser | src/content/catalog/start-maps.ts:33 |
| `q1.accessibility.subtitles-captions` (294) | CaptionTimeline "no application consumer" | src/text/media-captions.ts:4,21 |
| `q1.ui.radial-weapon-wheel`, `q1.ui.weapon-quickswitch` (267,269) | wheel parsing "no application caller" | src/app/bootstrap/ui.ts:13,71, src/app/bootstrap/q1-wheel.ts:41 |
| `q3.presentation.fonts-and-glyphs` (302) | "without generation services" | src/app/bootstrap/q3-client/assets.ts:51-54 |
| `q3.services.authorization-endpoints` (317) | authorizeAddress null | src/app/bootstrap/network/q3.ts:61 |
| 10 demo rows: `q1.demos.*`, `q2.demo.*`, `q3.recording.*` (324-333) | no record/playback/timedemo command | src/app/bootstrap/demo-commands.ts:59,77,80,87 |
| `q1.tools.chase-camera-diagnostics` (350) | not joined | src/app/bootstrap/q1-client-settings.ts:50,71 |
| `q3.cameras.spline-runtime` (351) | not joined | src/app/bootstrap/application-tools.ts:7,28,32 |
| `q3.diagnostics.omnitimer` (352) | "no established application implementation" | src/core/omnitimer.ts:7, application-tools.ts:6,27 |
| `q3.bots.aas-reachability-clustering` (203) | writer "not joined" | src/bots/navigation/aas-write.ts:6, tools/navigation/aas.ts:3,55 |

- Impact: The 61.4% headline, the priorities appendix and the project-status-current category tables all understate the code by an unknown amount. A contributor following priorities:244-505 would reimplement existing code, despite README:122's warning. The rows left open after this check are the real backlog, but no doc can identify them.
- Remediation: Do one pass over the 184 rows, marking each closed, still open with a current reason, or descoped. Then archive the rest of the ledger, as DOCS-004 proposes.

### DOCS2-005 — completion-status.md gives opposite verdicts for the same code
- **Verification (VERIFY-L): confirmed. Final severity: Low.** completion-status.md:578 vs remaining-source-rows.md:111-112 on ConfigStore; :895 "remain unclaimed" vs :242 "persists per-seat enable flags and strength"; :679 vs rows:162. Rows:298 says "not fully wired", so scales is a softer conflict than "opposite".
- Severity: Low
- Category: docs
- Location: docs/completion-status.md:221,242,261,578,679,895, docs/functional-targets/remaining-source-rows.md:111-112,162-164,298
- Confidence: traced
- Evidence:
  - Input persistence: `q2.input.controller-assignment` is Done at :578 ("connects shared ConfigStore seat settings to ApplicationInput startup and shutdown") and `q1.seats.device-persistence` is Done at :221. `q2.input.binds-keyboard-mouse` and `q2.input.per-player-tuning` remain open because "ConfigStore seat/device persistence is not connected to ApplicationInput startup/shutdown" (rows :111-112).
  - Haptics: `q3.input.gyro-haptics` (:895) says "Haptic-settings persistence ... remain unclaimed", while `q1.input.haptics` (:242) says 36f395ee "persists per-seat enable flags and strength". Code persists it: src/settings/config.ts:20,26,101,116.
  - Scales: `q1.text.independent-scales` is Done (:261, "Independent text/menu/HUD scale settings") while `q2.accessibility.independent-scales` is open (rows :298) over the shared src/ui/settings/index.ts:276-291 and src/ui/settings/console.ts:6.
  - Browser: `q2.browser.favorites` is Done (:679, "extends the shared startup browser") while three sibling rows say the browser is "not constructed by the startup application" (rows :162-164).
- Impact: Line :3 says "only the remaining-work reason for `q2.admin.status-kick` changes among those records", so these contradictions are the direct result of the carry-forward method.
- Remediation: When a commit closes a join, update every row citing that join. The DOCS2-004 pass can do this now.

### DOCS2-006 — The scoped docs name seven different "current" installed executables
- **Verification (VERIFY-L): confirmed. Final severity: Low.** Seven SHAs present at the cited lines. README:113 names 07d54ae (2026-09-18), an ancestor of v1.0.0 (2026-09-26). execution-status.md:215 sits under the heading "Earlier installed executables" (:213), so that one is labelled history, as the finding notes.
- Severity: Low
- Category: docs
- Location: docs/functional-targets/README.md:7,113, docs/completion-status.md:3, docs/execution-status.md:5,43,215,295, docs/implementation-priorities.md:15,242, docs/functional-targets/performance.md:89,91,93,129,175, docs/functional-targets/integration-20260918.md:52, package.json:3
- Confidence: traced
- Evidence:
  - README:113: "Continue from delivered `07d54ae`" as priority 1 of remaining work.
  - completion-status:3: "locally installed executable was built from 1c805445...".
  - priorities:242: "The current installed executable is `8ec0b01`".
  - execution-status:5: v1.0.0 through `563f0a99`. :43 (same top section): "Installed executable `7e279d2a`". :215, under the heading "Earlier installed executables": "Current binary: `edcfada8...`". :295 says current identity is "recorded only in the top section", which :215 breaks.
  - performance.md:89: "Installed `74119b8`". performance.md:91,93,175 say "not installed" and "newer than the installed executable" about commits later docs call delivered.
  - HEAD is 1.2.6. DOCS-003 covers the 1.0.0 cutoff, not these conflicts.
- Impact: The sentence README:113 gives as the next action points at a commit from before 1.0.0.
- Remediation: Replace all of these with one pointer to the release notes. Delete README:111-116 or date it.

### DOCS2-007 — Remaining-work statements that are false at HEAD, outside the requirement rows
- **Verification (VERIFY-L): confirmed-with-changes. Final severity: Low.** Table holds where opened (priorities:225, performance:97, project-status-current:87,154, 2026-09-11:105, execution-status:353,427,722). Wrong citation: the s_info fix is at src/app/bootstrap/audio.ts:246, not :248.
- Severity: Low
- Category: docs
- Location: below
- Confidence: traced
- Evidence: Most sit in sections labelled historical or dated, except the two marked "current wording". They matter because project-status-current.md and implementation-priorities.md keep them under "Remaining" with no pointer forward.

| Doc:line | Claim | HEAD |
|---|---|---|
| implementation-priorities.md:225 (current wording), project-status-current.md:50 | "other eight debug-shape imports ... remain open" | src/compat/q2/rerelease/debug-shapes.ts:8-11; execution-status.md:453 records `87ac5b4` |
| functional-targets/performance.md:97 (current wording), execution-status.md:359 | actor-registry and model-light work "remain pending" | execution-status.md:341 lists both as accepted and installed in `68219cc` (doc-to-doc conflict; code not checked) |
| project-status-current.md:154 | `misc_flare` "not implemented" | src/content/q2/rerelease/entities.ts:73,361 |
| project-status-current.md:87 | "Output remains 44,100 Hz, stereo, 16-bit" | src/audio/engine.ts:117-120 |
| project-status-2026-09-11.md:105,209 | OGV "explicitly rejected" by the linked media files | src/media/playback.ts:4,12,47 |
| execution-status.md:353 | `s_info` "still displays floating-point noise" | src/app/bootstrap/audio.ts:248 uses `toPrecision(6)` |
| execution-status.md:427,431 | default.cfg/autoexec.cfg startup execution "remains open" | src/app/bootstrap/startup-config.ts:34-38 |
| execution-status.md:427 | Team Arena "remains disabled" | src/app/bootstrap/startup-selection.ts:34,389 |
| execution-status.md:722 | Q3 or rerelease fonts "currently required for proportional menus" | classic fallback when neither is installed, src/app/bootstrap/menu-font.ts:65-71. A partial install still throws at :79 or :103 |

- Impact: Each line can be quoted as a live defect, or used to schedule work already done.
- Remediation: Fix or annotate the two current-wording lines. The rest go with the archive pass.

### DOCS2-008 — project-plan.md's core execution rule and module map do not match the code
- **Verification (VERIFY-L): confirmed. Final severity: Low.** docs/project-plan.md:106 says synchronous; contracts/session.ts:151 and world/session/session.ts:441 await stepAsync. src/catalog, src/scene, src/connection and src/app/modules.ts do not exist.
- Severity: Low
- Category: docs
- Location: docs/project-plan.md:89-93,106,166-176,194, src/contracts/session.ts:151, src/world/session/session.ts:431,441
- Confidence: traced
- Evidence:
  - project-plan:106: "Simulation runs synchronously ... Promise completion cannot order gameplay." Code has `stepAsync?(input, progress?): Promise<SimulationOutput>` in the session contract, and session.ts:441 awaits `world.simulation.stepAsync?.(...)`. execution-status.md:534 records this as `babe71b` with "ordered awaited Q3 callbacks". The plan never records the change.
  - The module table (:168-175) names `src/catalog/`, `src/scene/` and `src/connection/`. None exists; the real locations are src/content/catalog, src/render/scene and src/network. :194 names a "`src/app/modules.ts` handoff" for native integration; that file is absent.
  - DOCS-013 covers the plan's lack of a superseded banner, not these specifics.
- Impact: The plan presents these as the architecture and invariants. A contributor reasoning about determinism from :106 will be wrong for guest worlds, where gameplay order depends on awaited work.
- Remediation: State the async guest exception and its ordering guarantee in a maintained contract doc, and correct or retire the table.

### DOCS2-009 — "Renderer-worker execution defaults off" omits that the CPU renderer starts worker threads by default
- **Verification (VERIFY-L): confirmed. Final severity: Low.** r_smp default 0 (image-settings.ts:90), but row-parallel.ts:193-200 defaults to min(4, cores-1) and rasterizer.ts:1164 creates the pool lazily. Scoped docs omit it; only docs/releases/1.2.1.md:33 mentions QTS_CPU_WORKERS.
- Severity: Low
- Category: docs
- Location: docs/functional-targets/README.md:7, docs/execution-status.md:309, src/render/cpu/row-parallel.ts:193-200,241-247, src/render/cpu/rasterizer.ts:1164, src/app/bootstrap/image-settings.ts:90
- Confidence: traced
- Evidence: `r_smp` defaults to 0, so the sentence is true of that switch. However `configuredWorkerCount()` returns `Math.max(0, Math.min(4, availableParallelism() - 1))` when `QTS_CPU_WORKERS` is unset, and rasterizer.ts:1164 lazily calls `RowParallelPool.tryCreate`, subject to the guard at :1163. None of the scoped docs mention this pool. performance.md:24 requires measured results and correct ownership for any off-main-thread work, and no evidence entry exists there. RENDER-002 reports a defect in the pool itself.
- Impact: Readers and CPU-renderer performance comparisons assume a single thread when up to four workers may run.
- Remediation: Document the default and the env var in performance.md, with a measurement entry.

### DOCS2-010 — Known limitations recorded only in dated paragraphs, with no tracker
- **Verification (VERIFY-L): confirmed. Final severity: Info.** Quoted statements exist at the cited lines (execution-status.md:173,199,241,243,257,406,494,499,700; project-plan.md:13,80), and no prepass hit in src/app/bootstrap/simulation. Whether each limitation is still live was not tested, as the finding states.
- Severity: Info
- Category: docs
- Location: below
- Confidence: Keyword search of the non-status docs found no tracking home for these terms (`plausible` that each is still live). I did not re-test any of them at HEAD.

| Doc:line | Open statement | Code pointer |
|---|---|---|
| execution-status.md:241 | Threewave cgame `Com_sprintf` overflow warning at init and restore, "Neither observation is claimed fixed" | src/compat/qvm/symbols.ts:89,107 |
| execution-status.md:241 | generic `--movement q3` failed native ownership validation on Threewave; needs explicit product. :283 may have changed this | none checked |
| execution-status.md:243 | "held-attack reset on loading remains a separate limitation" | none located |
| execution-status.md:494 | audio pump maximum 820 ms "is unresolved" | none |
| execution-status.md:499 | GL "whole-world command-hash difference remains unresolved" after `81eb805` | src/render/gl/buffers.ts |
| execution-status.md:173 | ambiguous legacy primary/component persistence "reports an explicit migration limit" | none located |
| execution-status.md:199 | original Team Arena portal models absent from official archives; default-model fallback | none located |
| execution-status.md:257 | "Fixed-limit source inventory owners remain unsupported" | none located |
| execution-status.md:406 | rerelease compact HUD "remains unqualified" | none |
| execution-status.md:700 | hazard lethal obituary and nested hazards "remain unverified" | none |
| execution-status.md:353, performance.md:113 | CPU renderer source-clock lag exceeded the 200 ms gate, "remains unresolved" | none |
| project-plan.md:80 | selected-Q3-projectile "host-clock prepass still requires unification" | `rg prepass` finds nothing in src/app/bootstrap/simulation, so possibly gone |
| project-plan.md:13 | exact `misc_explobox` BFG policy remains, `misc_explobox2` adaptation deferred | src/content/q1/foundation/spawns.ts:77,173 |

- Impact: These are the only record of observed defects. DOCS-010 covers disappearing release-note issues; these never reached a release note.
- Remediation: Triage them once. Fix, file or explicitly drop each.
