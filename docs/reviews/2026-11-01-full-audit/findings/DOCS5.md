# DOCS5 — Round 3 READ review: source-path cells of completion-status.md 351-969, all rows of remaining-source-rows.json
## Coverage
Read in full, line by line, with no truncation:
- docs/completion-status.md 351-969 (300 requirement rows), including every source-path cell.
- docs/functional-targets/remaining-source-rows.json 1-3654 (header, 21 groups, 184 rows, 29 dependency entries).

Scripted checks, all in the scratchpad and read-only against the project:
- Every in-scope cell was parsed: link label against link target, existence, and duplicates.
- All 184 JSON rows were compared field by field with the ledger: paths and their order, reason, title, verdict.
- The JSON group totals, family totals, areas and dependency block were recomputed.
- The JSON input SHA-256 was recomputed from `git show 949c337c^:docs/completion-status.json`.
- All 28 commit hashes cited in rows of this scope were resolved with `git cat-file`.
- Every identifier named in a reason (all 477 rows) was searched in src.
- Subject-term scan of cited files: 223 of the 300 in-scope rows got a hand-written term list. The other 77 rows (for example q2.weapon.*, q2.download.*, q2.input.*) were read and checked by judgment or targeted grep, not scanned. Term lists are approximate, so every row cited below was confirmed by reading code. A zero-hit result alone was not treated as a finding.

Code read for the checks (targeted ranges, not whole subsystems): application.ts 991-1012, 1505-1518, 4290-4312; simulation/runtime.ts 825-832, 3786-3796, 5598-5602, 6306-6312; simulation/bots.ts 605-625; simulation/bot-assets.ts 13-30; content.ts 160-176; content/catalog/index.ts 244-262; content/mods/catalog.ts (all); mod-selection.ts 1-60; diagnostic-tools.ts; q2-console.ts (all); missionpacks/players.ts and index.ts (all); foundation/weapons/index.ts (all); ui/settings/rotation.ts; settings/server/rotation.ts; q1-localization.ts 1-25. The rest was by `rg`.

Not done:
- Nothing was executed apart from the read-only scripts and git commands above.
- Done rows were not behaviourally re-verified. Only their citations and specific checkable statements were tested.
- The JSON Q1 rows sit outside the ledger line range but inside this scope. They were read, and they got the identifier check and targeted greps, not the subject-term scan.
- The DOCS4 "left out" rows q1.multiplayer.chat, q1.network.admission-admin, q1.render.fog-sky-liquids, q2.campaign.unit-backtracking remain undetermined.

## Strengths
- The JSON and the ledger agree exactly. All 184 rows have identical sourcePaths (including order), reason, title and verdict. All are `not-done` / `missing-work`, and every ledger open row is present in the JSON.
- JSON arithmetic is sound: all 21 group totals and family counts match their rows, and the top totals are 184 / 56 / 75 / 53.
- The dependency block matches each row's `classification` exactly. Three rows have a `note` without secondary dependencies and are correctly absent from the block.
- Provenance is real. The recorded SHA-256 `0aff4564...` reproduces from history, and the cutoff `167bfbf1` resolves. It is 748 commits behind HEAD. The input file's deletion is already DOCS-007/DOCS-008.
- Every in-scope link label equals its link target, and there are no duplicate paths in a cell. The only dead path is `verification/features/q3.json` (:957), which is already reported.
- All 28 cited commit hashes resolve.
- Most identifiers named in reasons still exist and sit in a cited file. The exceptions are `pauseMusic` (DOCS5-001) and `ItemLifecycle` (DOCS5-005).
- Rows that hold were confirmed where read: no Q3 server pause (`q3.admin.pause-flood-inactivity`: no `pause` in network/q3.ts, q3/runtime.ts or guest-runtime.ts; application.ts:4296 is Q1-only), and Q1 finales load English only (finale.ts:22 passes no language).

## Supplements
- Supplements DOCS4-006 ("Not established either way"): q1.bots.knowledge-skill, q2.music.pause-resume-gain and q3.content.mod-selection are now established as false. See DOCS5-001.
- Supplements DOCS4-009: three more dependency entries describe rows with false reasons: q1.content.launch-selection, q1.multiplayer.setup, q2.content.rotation-editor. That makes 18 of 29.

## Findings

### DOCS5-001 — 29 more open-row reasons are false at HEAD, bringing the known total to 143 of 184
- **Verification (VERIFY-O2): confirmed-with-changes. Final severity: Medium.** Recount: the table has 29 rows, all open, and DOCS2-004 (37), DOCS4-006 (77) and DOCS5-001 are pairwise disjoint, so 143 is correct only as raw addition. It carries two errors. VERIFY-O already removed :240, :709 from DOCS4-006 (68 false + 7 partial). Here :379 is true as written ("startup has no...": registerServerSettingsMenu is reached only from ui.ts:206, and the finding itself says "True for the startup menu only"), and :936 is not shown false (its "not registered" paraphrase omits "complete", and completeness is unestablished). :124 was wrongly excluded: its sentence is about the catalog, is identical to :122-:123, and expansions.ts:59, :164 also offer armagon. So DOCS5-001 is 28 rows, and the combined total is **140 of 184 (76%) with a false clause or partial, 119 (65%) wholly false, 44 not shown false**. Adding the 7 disjoint rows excluded here (DOCS-004 4, DOCS2-005 3) gives at most 147. Wholly false, held (14): :388, :376 (content.ts:163-164; q2-native-world.ts:20-26 and classic-guest-source.ts:22-32 have no digest gate), :43 (id1-program.ts:84 derives a binding for unknown programs), :846, :604, :572, :706, :212, :700, :647, :345, :122, :123, :124. Clause or partial (14): :915, :903, :930, :323, :208, :534, :25, :260, :285, :875, plus :525, :228, :229, :791 downgraded here. :525: "one player per connection" is true (network/q2.ts:722), and multi-seat works through independent connections (remote-application.ts:1829, :1936; remote-seat-source.ts:149). :1365 is the Q3 branch and q2.ts:254 is the host, so those anchors do not support it. :228, :229, :791: false only with rerelease data; classic-only still loads q3-baseq3 (bot-assets.ts:52) and hits bots.ts:221, :621-624. Anchor fix: :846's mod-selection.ts:12, :120 and ui/mods/menu.ts:20 are gameplay-mods.json add-ons, not fs_game. Real path is content.ts:210, :233, runtime.ts:3343. Supplement to DOCS4-009 becomes 16 of 29, not 18 (VERIFY-O's 14 plus launch-selection and multiplayer.setup; rotation-editor drops).
- Severity: Medium
- Category: docs
- Location: docs/completion-status.md lines below; the same rows in remaining-source-rows.json and .md. Excludes DOCS2-004, DOCS2-005, DOCS-004, DOCS4-006 and DOCS4-007.
- Confidence: traced. As in DOCS2-004 and DOCS4-006, the stated reason is shown false, not that the requirement is complete. "(clause)" means one clause is false and the rest of the reason may hold. Mod and program rows were traced through dispatch but not executed.
- Evidence:

| Line, row | Stated | HEAD |
|---|---|---|
| :388 q2.game.provider-selection, :376 q2.content.discovered-addons | "unknown native Q2 modules still lack executable guest application integration"; "only admits known Q2 programs" | content.ts:163-164 selects `gamex86.dll` / `game_x64.dll` for any product not in `expectedProducts`; catalog/index.ts:247-257 discovers those add-ons; prepared guest at content.ts:344; `prepareQ2Guest` at content.ts:8. This is the same class of error as DOCS4-007, on the Q2 native-DLL headline feature |
| :43 q1.execution.builtin-typescript-gameplay | "only pinned id1 QC admission is available and arbitrary programs remain rejected" | content.ts:168-172 selects `progs.dat` for non-built-in Q1 products; mod-selection.ts:11, :118 |
| :846 q3.content.mod-selection | arbitrary mod selection "not an implemented application workflow" | catalog/index.ts:233, :256 discovers `vm/qagame.qvm` add-ons; mod-selection.ts:12, :120; ui/mods/menu.ts:20 |
| :604 q2.music.pause-resume-gain | "ApplicationAudio.pauseMusic has no application command/menu caller" | `pauseMusic` has zero hits in src. `cd pause` / `cd resume` run through audio/music.ts:135-136, audio.ts:233-236, startup.ts:746; source pause events at audio.ts:491, :501 |
| :572 q2.accessibility.color-and-captions | "no application media-event producer"; "HUD initializes captions empty" | ui.ts:170 builds `SeatSoundCaptions`; ui.ts:337 `captions: this.soundCaptions.active(...)` |
| :915 q3.media.subtitles-captions (clause) | no event-to-visible path established | The same path, sound-captions.ts:12, reaches ui.ts:415-423 |
| :903 q3.audio.background-music (clause) | menu music not joined | startup-audio.ts:19, :34 frontend music through the shared mixer. Postgame transition not found, so that clause holds |
| :706 q2.config.archived-state | startup/shutdown "does not load/save that store" | configuration.ts:99-107 `loadCvarArchive`; application.ts:549-557 `saveCvarArchive` |
| :930 q3.configuration.persistence-startup (clause) | archived cvars and explicit writeconfig not joined | Same archive path; application.ts:1736 `writeConfig`; startup.ts:977, :1028. The ledger's own q1.config.commands-console says fc0c15e joined writeconfig |
| :323 q1.config.persistence-migration (clause) | archived per-seat writes not connected | configuration.ts:102 per-seat input archive; application.ts:557. Migration clause not established |
| :208 q1.multiplayer.setup (clause) | "Startup exposes only singleplayer/coop/deathmatch" | startup-selection.ts:368-369 Horde and :374 Tag presets for Q1; match-modes.ts:18 admits Q1 CTF |
| :212 q1.multiplayer.pause-kick-status | pause, ping, status not joined | application.ts:4296-4311 |
| :700 q2.admin.spectator-chase | "primaryUi reads the spectator own combat/inventory rather than the chased player" | runtime.ts:6306-6311 redirects `actor = target` when the observer is chasing. The cited file refutes the row |
| :525 q2.seats.remote-network | multi-seat remote "not implemented" | remote-application.ts:1831-1836 adds seats up to four; :1365 `splitScreen`; network/q2.ts:254-255 admits split seats on the host |
| :228, :229 q1.bots.population, q1.bots.knowledge-skill | "uses Q3 bot definitions"; "createBots" loads q3-baseq3; "only for standard deathmatch" | bot-assets.ts:13-30 loads native or `q1-rerelease` definitions with `loadQuake1Knowledge`; bots.ts:619 returns null for any Q1 source with a shared arsenal |
| :791 q3.bots.foreign-map-construction | application "explicitly rejects" foreign-map objective policies | bots.ts:611-619. Only Q3-map sources are restricted. Same evidence as DOCS4-006 Bots, for a row it did not list |
| :534 q2.bots.combat-campaign-goals (clause) | hook "still reports no-navigation" | runtime.ts:3790-3795 returns `no-navigation` only when `nativeNavigation` is null, otherwise a path |
| :647 q2.service.match-report-lobby | match report and lobby "not integrated" | application.ts:1508-1512 records q2MatchReports durably; q2-match-reports.ts; startup.ts:3-4, :145 ApplicationLocalLobby and LocalLobbyService |
| :345 q1.events.level-completed-lobby | no progression or lobby consumer | player-progress.ts:7, :18; remote-application.ts:2303; application.ts:1040, :1514-1517 returnToLobby |
| :379 q2.content.rotation-editor (clause) | no ordered editor or shuffle | ui/settings/rotation.ts:9-26 add, reorder, remove, in the in-game settings; settings/server/rotation.ts:8 `g_map_list_shuffle` (rerelease only). True for the startup menu only. Persistence not traced |
| :25 q1.content.launch-selection (clause) | "selected foreign Q1 arsenals remain id1-only" | q1-expansion-arsenal.ts:11-19 hipnotic, rogue, dopa, mg1, mg3; runtime.ts:164, :830, :1099 |
| :122, :123 q1.hipnotic.monster-scourge, -gremlin | catalog "exposes only id1 ordinary species" | monster-runtime.ts:39 `q1OrdinaryMonsters` includes both; monster-sources.ts:9. Armagon (:124) is absent from that set and appears only in roster.ts:22, so :124 is not counted |
| :260 q1.text.localization-overlays (clause) | messages "drawn raw"; selector not bound | presentation.ts:138 Q1MessageLocalization with `selectedLanguage`. The finale clause holds (finale.ts:22) |
| :285 q1.render.model-effects-particles (clause) | "does not publish raw actor alpha/scale" | runtime.ts:7390, :7438, :7473, :7522; presentation-scene.ts:203-204 |
| :875 q3.presentation.visual-options-restart (clause) | "still receives a generic hardware profile" | q3-client.ts:369 `q3Hardware(o.renderer.driver?.renderer ?? "") === "ragepro" ? "ragepro" : "generic"`. The cited file refutes it, although only two of the five classes reach the client |
| :936 q3.diagnostics.runtime-tools (clause) | primitives "not registered" | application-tools.ts:47-48 registers timers, timerstamp, meminfo, path, dir, touchFile, resourceinfo, frameinfo. Completeness of the set not established |

- Impact: With DOCS2-004 and DOCS4-006, at least 143 of 184 open reasons (78%) now have a false clause. The remaining 41 rows, plus the true clauses of partly false rows, are the only identified candidates for real backlog. The native-module and mod rows would make a reader think mod execution is absent.
- Remediation: Include these rows in the re-derivation DOCS2-004 asks for, and start with :388, :376, :43, :846, which contradict the product's stated scope.

### DOCS5-002 — 12 rows cite a 42-line lava-spawn selector as the source of Rogue and Xatrix weapons and powerups
- **Verification (VERIFY-O2): confirmed. Final severity: Low.** Scripted over the ledger: exactly 12 rows cite players.ts (:454, :461-471), 2 of them open. The file is 42 lines at HEAD and at 167bfbf1, with 0 matches for quad|double|chainfist|etf|heat at cutoff. Modifier and expiry code is at missionpacks/items.ts:17, :120, :144, :153.
- Severity: Low
- Category: docs
- Location: docs/completion-status.md:454, :461-471 (the JSON has the same cell for q2.xatrix.quadfire and q2.rogue.double-damage); src/content/q2/missionpacks/players.ts:1
- Confidence: traced
- Evidence: The whole file is `/* Original Rogue p_client.c lava-level cooperative spawn selection. */` plus `Q2RoguePlayerSpawns`.
  - :454 cites it for "source cadence modifier and expiry". :469 cites it for "Damage multiplier and source expiration/warnings". Those live in missionpacks/items.ts:17, :120, :144, :153.
  - The other ten Rogue rows cite it for weapons, spheres and the nuke. Their owners are weapons/player.ts, spheres.ts and projectiles/nuke.ts.
  - The file at cutoff `167bfbf1` is also 42 lines with no match for `quad|double|chainfist|etf|heat`. The citation was wrong when written, so this is not drift.
- Impact: An existence check passes, but anyone following the cell finds nothing. For the two open rows, the only cited non-UI file has no connection to the claim.
- Remediation: Cite items.ts and weapons/player.ts. Drop players.ts from every row except spawn-related ones.

### DOCS5-003 — Done-row cells are batch evidence, and many do not reach the code they certify
- **Verification (VERIFY-O2): confirmed. Final severity: Low.** Recounted: 300 rows, 169 done, 193 cells, max share 11, 95 done rows sharing with another done row (96 counting open rows), 14 cite tests, 38 re-export entries; no q2.weapon.* row cites weapons/player.ts. :466 and :509 cells have 0 hits for nuke and haste; multiplayer/lmctf/runes.ts:142 owns haste. client-think.ts:251 is the only PW_ check, client-effects.ts:129, :168, :184 hold the logic. :895's q3.ts and q3-client.ts have 0 haptic hits, though its cell also cites src/input/haptics.ts. team.ts has 0 subject hits for :800-802.
- Severity: Low
- Category: docs
- Location: docs/completion-status.md rows below
- Confidence: reproduced (counts by script); traced (named rows)
- Evidence:
  - Sharing: the 300 rows have 193 distinct cells. 95 of 169 done rows share an identical cell with another row, up to 11 rows (q2.weapon.*). q2.lmctf.voting and q2.lmctf.haste-rune cite the same four files. Only 14 of 169 done rows cite a test.
  - Re-export files: 38 cell entries point at files that are at least 70% re-exports: foundation/weapons/index.ts (13, 7 lines), lmctf/index.ts (8, 3 lines), media/index.ts (6), projectiles/index.ts (4, 2 lines), bots/behavior/index.ts (4), modes/index.ts (2), compat/qvm/index.ts (1). q2.weapon.* says "weapon state machine executes" but never cites weapons/player.ts.
  - Subject absent from every cited file: :466 q2.rogue.nuke (owner projectiles/nuke.ts) and :509 q2.lmctf.haste-rune (owner lmctf/runes.ts:142, lmctf/types.ts:14).
  - Cited file unrelated to the claim: :778 cites team-arena/client-think.ts for Guard, Scout, Doubler and Ammo Regen. That file's only powerup check is invulnerability (:251); the real code is client-effects.ts:124-222. :895 cites audio/q3.ts and q3-client.ts for haptics, and neither contains `haptic`, `rumble` or `BNVIB`.
  - :797-802 q3.team-ai.* cite team-arena/team.ts for orders, leadership and voice. The implementations are bots/behavior/q3/ai-team.ts, ai-orders.ts and ai-command.ts, cited by none of the six. For :800-802, team.ts has zero hits for the row subject.
- Impact: The column looks like per-requirement evidence, but a done row cannot be audited from it. The existence check that earlier rounds relied on passes all of these. This limits what "done" can mean as a ledger state, and it may hide overstated rows like DOCS4-008.
- Remediation: If the ledger is retained, cite implementation files per row and a test per done row. Otherwise state in its header that the column is a batch-level pointer.

### DOCS5-004 — Open-row cells omit the file that ships the feature, so following a cell appears to confirm the stale reason
- **Verification (VERIFY-O2): confirmed-with-changes. Final severity: Low.** 7 of the 10 "no hit" rows hold, not 10. :372 and :377 cite startup-selection.ts, whose :317 calls `catalog.authoredStartsFor`, so the cell reaches the owner. :906 cites app/bootstrap/audio.ts, whose :6 imports `geometryTransmission` with 13 geometry hits. The other owner-table gaps hold: every listed owner file exists and is uncited in the rows sampled, and q1.config.commands-console names capture.ts in its reason but not its cell.
- Severity: Low
- Category: docs
- Location: docs/completion-status.md and remaining-source-rows.json rows below
- Confidence: reproduced (scan), traced (owners)
- Evidence: 10 open rows cite only files with no hit for their subject: :372, :377, :454, :469, :559, :748, :906, :922, :936, :937. Each cell predates or misses the owner. Representative gaps:

| Rows | Cell points at | Owner at HEAD, uncited |
|---|---|---|
| q2.content.native-starts, start-map-discovery | products.ts, startup-selection.ts | catalog/start-maps.ts, authored-start.ts |
| q2.hud.*, q2.powerup.*, q2.xatrix.quadfire, q2.rogue.double-damage | ui.ts | seat-hud-state.ts, simulation/powerup-timers.ts, ui/hud/q2-rerelease-layout.ts |
| q2.media.* (6), q2.audio.raw-pcm | q3-client/cinematics.ts | campaign-cinematic.ts |
| q2.demo.*, q3.recording.* | application.ts, options.ts | demo-commands.ts, network/recorded-source.ts, network/q2/gtv.ts, network/q2/mvd-playback.ts |
| q3.progression.* (7) | application.ts | base-arena-progression.ts, base-arena-postgame.ts, team-arena-skirmish.ts, team-arena-scores.ts |
| q3.diagnostics.* | application.ts, console/commands.ts | core/omnitimer.ts, application-tools.ts, diagnostic-tools.ts |
| q2.accessibility.contrast-typeface, q1.accessibility.contrast-color | settings/index.ts | ui/settings/accessibility.ts |
| q2.browser.*, q3.discovery.* | network/services/discovery.ts | server-browser.ts (cited only by the done row q2.browser.favorites) |
| q3.input.joystick-profiles-hotplug, midi-controller | input.ts | input-devices.ts |
| q2.config.renderer-restart, q1.video.mode-restart-capture | startup.ts, application.ts, renderer.ts | video-restart.ts |

  Also, q1.config.commands-console names src/app/bootstrap/capture.ts in its reason but not in its cell.
- Impact: The JSON and MD present these paths as where the work lives. A contributor who opens them sees no implementation and concludes the row is correct. That is why the errors in DOCS2-004, DOCS4-006 and DOCS5-001 survived a path-existence check.
- Remediation: Do not treat cells as a search scope. Re-derive them with the DOCS2-004 pass, or remove the column from the frozen JSON.

### DOCS5-005 — Four specific statements in done rows are false or stale
- **Verification (VERIFY-O2): confirmed. Final severity: Low.** :716 says "current five capture tests"; tests/capture/application.test.ts generates 8 (:49 x2, :139 x3, :202 x2, :230), all skipIf on SDL_VIDEODRIVER, and package.json `test` is plain `bun test`. :371 says eleven; products.ts:42-55 has 14 Q2 rows. :775: `rg -w ItemLifecycle` over src has zero hits. :374 says the world change "releases the prior runtime"; AUDIT-001 was confirmed High in VERIFY-G.
- Severity: Low
- Category: docs
- Location: docs/completion-status.md:374, :716, :371, :775
- Confidence: traced
- Evidence:
  - :374 q2.content.launch-lifecycle: "World replacement creates the requested source mode/program and releases the prior runtime/presentation". AUDIT-001 measured every map change retaining the whole previous world. Both cited files are the ones involved, and the row was never qualified.
  - :716 q2.capture.screenshots: "the current five capture tests". The cited tests/capture/application.test.ts generates 8 cases (:49 ×2, :139 ×3, :202 ×2, :230). All are `test.skipIf(process.env["SDL_VIDEODRIVER"] !== "offscreen")`, and `bun test` in package.json:12 does not set it, so the row's evidence does not run by default. TESTS covers env gating generally; this is the specific ledger link.
  - :371 q2.content.campaign-catalog: "all eleven classic/rerelease products". products.ts declares 14 q2 products.
  - :775 q3.combat.pickups-and-respawn: names `ItemLifecycle`. No such symbol exists; item-lifecycle.ts:46, :117 has `ItemRegistry` and `ItemLifecycleContext`.
- Impact: Small individually. :374 matters because a done row states the opposite of a measured High leak.
- Remediation: Qualify :374 until AUDIT-001 is fixed. Correct the counts or remove them.
