# DOCS4 — Round 3 READ review: menu rows M0153-M1121, completion-status.md 141+, dependency block
## Coverage
Read in full, line by line:
- docs/menu-source-comparison.md 301-1704 (M0153-M1121, 969 rows), every column including link targets. Every link target was also resolved by script to its line at HEAD.
- docs/completion-status.md 141-350 verbatim, including source-path cells.
- docs/functional-targets/remaining-source-rows.json 3402-3653 (dependencies, 29 entries).

Read with one column removed:
- docs/completion-status.md 351-969: every row's id, title, verdict, method and reason was read. The source-path cell was not read per row. A script confirmed that all of those paths exist (0 missing).

Code read for the checks: src/ui/settings/{action-catalog,bindings,gameplay,accessibility,images,console,rotation,input-routing,local-lobby,index,services,server}.ts, src/ui/library/{match,inventory,menu}.ts, src/app/bootstrap/q2-match-ui.ts, src/settings/server/{q2,q2-owner,q3,q1,lmctf,rotation,library,selection}.ts, team-arena-results.ts, startup-menu.ts 60-520, ui.ts 150-329, and startup.ts 809-825 and 890-1034.

Sampled by grep, not read in full: startup-menu.ts 521-973, seat-hud-state.ts, runtime.ts, network/q2.ts, network/q3.ts and others cited below.

Limits:
- Done rows were read, but most were not re-verified in code. Only done rows making a specific checkable claim were checked. Finding the remaining false done rows would need a behavioural review.
- Donor citations (`client/menu.ts:…`, `ui/*.menu:…`) were not checked, because the donor trees are outside the repository.
- Nothing was executed. No tsc, policy or test run.

## Strengths
- Many open rows hold at HEAD. Grep or code reading confirmed these:
  - Download policy has cvars but no menu row (client-download-policy.ts:21-26): M0163-67, M0215.
  - No connection-rate menu: M0162, M0204, M1026.
  - No r_picmip, r_lodbias, r_vertexlight, r_texturemode or r_colorbits in src: M0186-M0194, M1007-M1017.
  - No credits screen (M0309), no CD-key UI (M0307-08, M0760-65), no find-player (M0906-11).
  - No Q3 team-order menu (M0260-68), no connect-password field (M1044, M1077).
  - LMCTF referee tree is console-only (lmctf/admin.ts:13-31; M0614, M0625-M0710).
  - No crosshair shape (M0205, M0982), no handicap, color1 or clan fields (M0182-83, M0999-M1000, M1004).
- This resolves the check DOCS3-009 left open. The 133 "No equivalent prelaunch" rows hold as to their state:
  - The hosting menu offers only connection kind, port and Q1 protocol (startup-menu.ts:212-229).
  - A saved server profile can be selected before launch (startup.ts:823), but no limit or flag can be edited there.
- The dependency block is structurally clean. All 29 IDs resolve, every `assigned` value equals the row's group `area`, and all secondary values are valid areas.
- The honest-limit language in done rows ("physical controller not qualified") was sound wherever I checked it.

## Supplements
- Supplements DOCS3-009 (correction): it lists M1090 among rows contradicted by base-arena-menu.ts and team-arena-results.ts. M1090 is `uiScript resetScores` in Team Arena. The reset at base-arena-menu.ts:42-45 is base-arena only, and team-arena-results.ts:23-24 has no reset, so M1090 holds at HEAD.
- Supplements DOCS3-009 (the 68 rows): 30 are contradicted, 9 are partial, 29 hold. See DOCS4-004.
- Supplements DOCS-009: all row link targets were resolved. See DOCS4-005.

## Findings

### DOCS4-001 — 57 Open menu rows are contradicted by controls that ship at HEAD, and DOCS3 did not name them
- **Verification (VERIFY-O): confirmed-with-changes. Final severity: Low.** All 17 table groups and the count of 57 hold at their cited lines (bindings.ts:97-106, gameplay.ts:13,17,24,29-31, input-devices.ts:106,110, startup.ts:909,951,973, team-arena-results.ts:23-24, match.ts vote/bot rows, lmctf/presentation.ts:25,27, ctf/match.ts:116 with ctf/index.ts:268 handling "close"). Change: M0838, M0900 and M1106 are already Open-partial, so only their wording is wrong, and M0838 (createserver) maps to the Custom flow, which really has four skills (startup-selection.ts:713); its reason holds for its own menu. M0445 keeps a true "no prelaunch" clause; only "no same-named binding" is false (q2.ts:20). Low to match DOCS3-009, which this table itemizes.
- Severity: Medium
- Category: docs
- Location: rows below
- Confidence: traced (code read; not launched)
- Evidence:

| Rows (count) | Row claims | HEAD |
|---|---|---|
| M0300-M0306 (7) | "no visible unbind or secondary binding editor", no reset | src/ui/settings/bindings.ts:97 "Add binding", :99 "Remove key", :101 "Clear action", :106 "Reset bindings" |
| M0203, M1024 (2) | "No user quality/output-format control" | src/ui/settings/index.ts:229-231 rate, bits, channels; src/app/bootstrap/ui.ts:191; s_khz alias at audio/output-settings.ts:21 |
| M1025 (1) | Doppler: "No corresponding exposed common control" | startup-menu.ts:250 `this.rows(["environment", "doppler"])`, which the doc's own line 36 also states |
| M0206, M0207, M0210, M0221, M0792, M0963, M0964, M0968, M0969 (9) | No common row for simple items, marks, target names, draw gun, autoswitch | src/ui/settings/gameplay.ts:13, :17, :24; passed in at application.ts:2268 (`cvars.find` gates each row) |
| M0222, M0223 (2) | "no enable/assignment chooser or exact source threshold policy" | src/app/bootstrap/input-devices.ts:106 "Source joystick input" and "Joystick player", :110 "Joystick axis threshold" |
| M0838, M0900, M1106 (3) | "source five-skill Q3 control is missing" | startup-selection.ts:357-358 five Q3 difficulties in the preset flow. Custom game still has four (:713), so these are partial, not missing |
| M0179, M0180, M0296-M0299 (6) | "No common license/config import-export/reset", "no config browser" | startup.ts:973-1034 lists config files, activates `exec`, creates via `writeconfig`, labelled "Save config" |
| M0881, M0884 (2) | No demo list or run | startup.ts:951-971, startup-menu.ts:132 |
| M0766, M0768 (2) | No cinematic list or play | startup.ts:909-948, including tier unlock from g_spVideos |
| M1066, M1068 (2) | No mod list or run | startup-menu.ts:200, :684; src/ui/mods/menu.ts:20 |
| M0896, M0898, M0905, M1105, M1119 (5) | "No application-owned Team Arena progression/score/next-skirmish workflow", no opponent | team-arena-results.ts:23-24 Next, Retry, Watch demo; startup-menu.ts:189-192 Your team, Opponent, Play; startup-selection.ts:388-389 |
| M0932-M0934 (3) | Add-bot name, team, skill: "No corresponding" | src/ui/library/match.ts Bot name and Bot difficulty 1-5; `addbot` passes the selected team |
| M0580, M0581, M0583, M0613 (4) | LMCTF observer, change team, vote menu: "No equivalent action" | lmctf/presentation.ts:25, :27; vote.ts:15. Row M0608 gives the same action Open-partial |
| M0738, M0754 (2) | CTF admin Cancel: "No equivalent action" | ctf/match.ts:116 `{ label: "Cancel", action: "close" }` |
| M0998, M0185 (2) | No Q3 name field; no model preview | gameplay.ts:29-31; startup-menu.ts:705, :729 characterTurntable |
| M1033, M1093 (2) | Net source; server info feeder | startup-menu.ts:369, :372 master entry and discover; :355, :376 Details with server-browser.ts:214 rules and players |
| M0445, M0837, M1104 (3) | Goal limit and Q3 match type: "Open-unexposed" | src/settings/server/q2.ts:20; q3.ts:27 in-game setting, the same treatment M0234-37 receive as Open-partial |

  Also partial rather than unexposed: M0184, M1001, M1002 (free-text model and headmodel, gameplay.ts:30), M0946, M0948 (free-text target, match.ts).
- Impact: These rows are hidden inside the "994 open" count and name finished work as missing. DOCS3-009 flagged the headline. This table is the row-level correction that was missing.
- Remediation: Re-state these rows against HEAD when the file is regenerated or archived per DOCS3-009.

### DOCS4-002 — 12 "Present (source verified)" rows are false, and 11 more are true only by accident
- **Verification (VERIFY-O): confirmed. Final severity: Low.** Script lists 24 rows on the "Shared Quit/Resume" route: the 12 false, the 11 accidental, and M0962 (real quit). Vote choices are exactly map_restart, nextmap, map, kick (src/ui/library/match.ts vote row); no teamtask, vsay_team, teamvote, voteGame or voteLeader in src/ui or ui.ts; the only hit is the userinfo cvar (q3-client/userinfo.ts:27). The match menu is q3-dialect only (ui.ts:173). 12 of 1123 doc rows with no runtime effect is Low.
- Severity: Medium
- Category: docs
- Location: docs/menu-source-comparison.md M0943, M0945, M0951, M0991-M0997, M1031, M1032; src/ui/library/match.ts; src/app/bootstrap/ui.ts:173
- Confidence: traced
- Evidence: All 12 use the route "Shared Quit/Resume actions close the application/menu through their owners". The scraper credited the trailing `uiScript closeingame` and ignored the command before it.
  - M0943 `callvote g_doWarmup 1`, M0945 `voteGame`, M0951 `voteLeader`: the match menu's vote choices are only `map_restart`, `nextmap`, `map`, `kick`.
  - M0991-M0997 `teamtask N ; vsay_team`: `rg 'teamtask|vsay_team' src/ui src/app/bootstrap/ui.ts` finds no menu. The `teamtask` cvar exists only as userinfo (q3-client/userinfo.ts:27).
  - M1031, M1032 `teamvote`: no such row in match.ts. A game-side backend exists (team-arena/match.ts:466), but the doc's own line 3 says backend flags do not count.
  - True only by accident, with the same wrong route: M0935, M0941, M0942, M0947, M0949, M0952-M0955, M1029, M1030. These are real only because of match.ts, added later, and only when `local.builder.dialect === "q3"` (ui.ts:173). They contradict sibling rows M0252-59 at baseline.
- Impact: These are the only row class that overstates. Removing them cuts the "Present" count, while DOCS3-009 and DOCS4-001 push the other way, so the 129/994 split is wrong in both directions.
- Remediation: Set the 12 to open and fix the route text on the 11.

### DOCS4-003 — 21 rerelease server rows are "Open-unexposed / no binding found" while the setting is in the in-game Server settings menu
- **Verification (VERIFY-O): confirmed-with-changes. Final severity: Low.** All 21 rows have settings (q2.ts:24-43, rotation.ts:8) and M0428 shows the Open-partial wording. Changes: consumption is not all in bindQ2PlayerCvars; several cvars are registered at q2-owner.ts:99 and read at runtime.ts:3700,4744-4745 or q2SourceDeathmatchFlags (q2-owner.ts:36). Line fixes: g_no_* consumed at q2-owner.ts:29-31, not :31-33; maxspectators is :50, not :52. M0468, M0469, M0553, M0554 should drop from the "at least 21": no matchlock or matchtime cvar exists, ctf/types.ts:72 is the runtime clock, and the rule fields are types.ts:29 and match.ts:125, so "no same-named" is literally true. The extra list is at least 17.
- Severity: Low
- Category: docs
- Location: M0525-27, M0531-35, M0537-38, M0540, M0545, M0562, M0564, M0568-69, M0574-78; src/settings/server/q2.ts:24-43, rotation.ts:8
- Confidence: traced
- Evidence: Each row says "No same-named common binding found; the donor reader or a renamed equivalent still needs a shared owner". Each cvar has a `serverToggle` or `serverLimit` in `q2RereleaseSettings()` and is live-bound in q2-owner.ts `bindQ2PlayerCvars`. Line 19 defines Open-partial for exactly this situation, and M0428 uses that wording. The correct state is Open-partial.

  "No same-named" is also false where the state itself holds (no menu, but the binding exists):
  - M0565-67 q2-owner.ts:19, consumed at :31-33
  - M0457, M0513, M0515 q2-owner.ts:52, :56, :108
  - M0523 server-administration.ts:126
  - M0847, M0850, M0851, M0857, M0859 q3-common-cvars.ts:8-16
  - M0848, M0852, M0853 content/q3/base/settings.ts:28, :37
  - M0974 client-download-policy.ts:21
  - M0980 presentation/config.ts:224
  - M0468, M0469, M0553, M0554 CTF rules (src/content/q2/multiplayer/ctf/types.ts:72)

  That is at least 21 more of the 105 "no same-named" rows.
- Impact: A contributor would add a second owner for settings that already exist and are consumed.
- Remediation: Use the same state and wording as M0428.

### DOCS4-004 — Binding rows: exact breakdown, plus 11 Team Arena rows outside the DOCS3 count
- **Verification (VERIFY-O): confirmed-with-changes. Final severity: Low.** 68 rows, the listed 30 contradicted, 9 partial, 11 and 12 Team Arena rows all match action-catalog.ts:17-26,32-38 and ui.ts:184. The undetermined pair resolves as contradicted: Q3 `+use` sets the same use-holdable input as `+button2` (input/seat.ts:22, input/user-command.ts:130, app/bootstrap/input.ts:828), so M0392 is contradicted and M0809 joins the Team Arena set (12). M0334 and M0352 (Q1 `impulse 10`) are functionally the offered "Next weapon" `weapnext` (application.ts:4266, network/remote-q1.ts:342), not a clean hold. Corrected: 33 contradicted, 9 partial, 26 hold.
- Severity: Low
- Category: docs
- Location: src/ui/settings/action-catalog.ts:17-26, :32-34, :37-38; rows below
- Confidence: traced
- Evidence: Of the 68 "Not listed among the seven exposed commands" rows:
  - 30 contradicted: M0338-40, M0344-45, M0350, M0356-58, M0362-63, M0368, M0370, M0373-75, M0379-80, M0385, M0391, M0393, M0399-M0401, M0403-04, M0418-19, M0421-22.
  - 9 partial: M0408-16. Weapons appear as `use <item>` rows for non-guest worlds only (ui.ts:184 passes `[]` when `guestUi`).
  - 29 hold: +strafe, +mlook, +klook, centerview, +zoom, +button2, +button3, impulse 10, inv*, messagemode3/4, and M0349/M0367 (+moveup is not offered on Q1 dialects, action-catalog.ts:19).

  New rows with a different route text ("No corresponding shared menu action/setting"), so not in DOCS3's grep:
  - 11 contradicted: M0770, M0771, M0778, M0784-86, M0790-91, M0806, M0829-30.
  - 12 partial: M0793-M0804.

  Not determined: M0392 and M0809 (+button2 against the catalog's `+use`). I did not find a Q3 mapping, so both are counted as holding.
- Impact: Gives the exact residual binding work, which DOCS3-009 described only by example.
- Remediation: As DOCS3-009.

### DOCS4-005 — Row evidence is stale: 40 of 83 "located at" citations miss, and three rows claim readers that do not exist
- **Verification (VERIFY-O): confirmed. Final severity: Low.** Reproduced by script: 83 "located at" rows, 40 miss, with the quoted targets (q2-console.ts:57, triangle-kernel.ts:500, remote-application.ts:143, q3/catalog.ts:216). In-scope link counts are exact: 333, 98, 175, 175, 155, 25; each target line is as quoted. `rg -i` finds no r_dynamiclight, r_fastsky or r_finish in src. Master entry at startup-menu.ts:369 falsifies the M1037-M1043 "master absent" text.
- Severity: Low
- Category: docs
- Location: rows below
- Confidence: reproduced (script over all rows) for the counts; traced for the rest
- Evidence:
  - 83 rows say "A same-named source occurrence is located at path:line". At 40, that line no longer contains the name. Examples: M0425-M0443 → q2-console.ts:57 `return () => { for (const [name, handler]...`; M1026 → bots/behavior/q3/catalog.ts:216.
  - Some never meant anything: M0455 `public` → render/cpu/triangle-kernel.ts:500 (`readonly cv: number`), M0451 `maxclients` → a bots file, M0456 `password` → remote-application.ts:143 (`}`). These were word matches, not bindings.
  - M0209, M0211, M0212 say "Native presentation settings have source readers" for r_dynamiclight, r_fastsky, r_finish. `rg -i` across src finds zero cvar hits. M0967 and M0970 correctly say no binding, so the file disagrees with itself.
  - Link targets, in rows: ui.ts#L139 (333 rows) lands on `const icons = await assetsOwner.prepare`; ui.ts#L115 "seven-action list" (98) on a blank line; ctf/index.ts#L254 "CTF actions" (175) on `}`; lmctf/presentation.ts#L22 "LMCTF menu" (175) on a blank line; q2-owner.ts#L13 "admitted host settings" (155) on an import; startup-menu.ts#L83 (25) on a const. The ui.ts#L115 list is now action-catalog.ts.
  - M1037-M1043 "master ... absent" and M0242-45 "No prelaunch host controls" are false in route text (startup-menu.ts:369, :212-229), though the rows stay open for other reasons.
- Impact: The doc's evidence claim (line 9, "retains exact file/line references") cannot be used to audit any row without its missing extraction.
- Remediation: Remove same-name citations, which are grep artifacts rather than evidence, and pin any kept links to a commit.

### DOCS4-006 — 77 more open-row reasons in completion-status.md are false at HEAD, bringing the known total to 114 of 184
- **Verification (VERIFY-O): confirmed-with-changes. Final severity: Medium.** 77 lines counted and 68 are false as stated (e.g. video-restart.ts:55, seat-hud-state.ts:135-153, rerelease-presentation.ts:77, effects.ts:408, game-prompt.ts:48, network/q2.ts:206,211, network/q3.ts:48, remote-application.ts:1371,1685,1829, simulation/save.ts:156; timers now traced to source at powerup-timers.ts:11-14). Not false: :240, :709 say "unqualified" (acceptance status), which code presence cannot falsify. Partial, 7 rows: :230, :231, :544 because classic data still throws at bots.ts:221,621-624 and only rerelease assets bypass it (bot-rerelease.ts:246); :163 keeps that bot clause. :309 level-start is false, but sv_autosave_interval has no reader in src (only application.ts:1351, startup-source.ts:45), and the row is about timed autosave. :560 "always instant" is false only on the service path (q2-service-presentation.ts:122); no producer sets durationSeconds and local emitters fall to `?? true` (ui.ts:290). :812 rcon is false, but g_log is only registered (q3/base/settings.ts:29). Corrected total: 105 of 184 outright (57%), 112 with partials, 2 not false. The majority conclusion holds; "114" and "62%" do not.
- Severity: Medium
- Category: docs
- Location: docs/completion-status.md, lines below (also the same rows in remaining-source-rows.md and .json); excludes the DOCS2-004 rows, the Tag, DeathBall, v5 and v6 rows DOCS-004 named, and the input, haptic, scale and browser rows in DOCS2-005
- Confidence: traced. As in DOCS2-004, the stated reason is shown false, not that the requirement is complete. Lines marked (light) were confirmed by grep without reading the whole path.
- Evidence:

| Group (count) | completion-status.md lines | Stated reason | HEAD |
|---|---|---|---|
| Settings (8) | :218, :240, :249, :250, :267, :570, :605, :699 | local drop quits; no outer threshold; no autosave, pickup, lookspring or rate options; no in-game save; no typeface/color; no shuffle; identity not bound | ui.ts:211-212, :221; settings/index.ts:191-193, :229-231, :284-289, :311-319, :203-211; gameplay.ts:13-27, :29-50; accessibility.ts registers typeface and colorMode as Archive |
| Renderer restart (3) | :291, :709, :710 | no live renderer switch | video-restart.ts:55 "Restart the client renderer while retaining the current game"; ui.ts:196-200 |
| Rerelease and Q2 HUD (19) | :423, :424, :445, :454, :469, :479, :480, :550, :551, :552, :553, :554, :555, :556, :557, :558, :559, :560, :627 | no consumer for healthbar, POI, help-path, item visibility; icon:null; carousel not called; instant=true; no timers; no flashlight | seat-hud-state.ts:52, :135-139; rerelease-presentation.ts:77; ui.ts:140, :172, :180, :279, :290, :337 `powerups: player.powerups`; input.ts:622 → ui.ts:263; effects.ts:101 (DOCS3-008 cites this for the comparison docs, not these rows). Timers: traced to the HUD, not to each source powerup |
| Q1 events (8) | :163, :201, :202, :253, :309, :342, :344, :646 | no CTF HUD or prompt consumer; horde cvar omitted; autosave Q2-only; no achievement store | seat-hud-state.ts:146-153; game-prompt.ts:48; horde/index.ts:89 `setCvar("horde","1")`; application.ts:489, :1351; application.ts:2274-2278, player-progress.ts:6, startup.ts:890 |
| Q2 rules (4) | :481, :488, :489, :490 | "deathmatchFlags=0", options not bound | composition/q2/index.ts:222-224; q2-owner.ts bindQ2PlayerCvars and q2SourceDeathmatchFlags; runtime.ts:88 |
| Browser and network (10) | :333, :665, :670, :811, :812, :821, :829, :830, :843, :894 | no browser; no status or rcon; no Q3 rcon; "Q2-only remote application"; no levelshot; no client pure; downloads missing | startup-menu.ts:340-372; network/q2.ts:206, :211; network/q3.ts:48, :53; network/q3-client.ts, remote-q3.ts:118, q3-client-content.ts:23; application.ts:4026. :665 and :811 also contradict this file's own done rows :685-689 and row :923 |
| Q3 products (14) | :746-:752, :760, :837, :853, :860, :861, :864, :944 | no progression store or UI; no skirmish; no rankings; no QVM; no world save | base-arena-progression.ts:38, :112; base-arena-menu.ts:42; team-arena-skirmish.ts:136, team-arena-scores.ts (light); q3-rankings.ts:41, :55; runtime.ts:3350; match.ts; library menus; tests/app/q3-server-save.test.ts:4 |
| Media and demos (8) | :220, :594, :611-:616 | no Q2 cinematic presentation or recorded-view consumer | campaign-cinematic.ts:32, :57; application.ts:145; demo-commands.ts (DOCS2-004 cites this for other rows) |
| Bots (3) | :230, :231, :544 | "botAdmissionError explicitly rejects Q1 team and campaign objectives" | bots.ts:611-619 returns null for any q1/q2 source with a shared arsenal. Note :221 retains a legacy check when `source === null` (DOCS3-008) |

  The :163 row and done row :164 both rest on "missing horde cvar", which is stale.

  Not established either way (left out): q1.bots.knowledge-skill, q1.multiplayer.chat, q1.network.admission-admin, q1.render.fog-sky-liquids, q2.campaign.unit-backtracking (a `visited` map exists at runtime.ts:284 for the native rerelease guest only), q2.music.pause-resume-gain, q3.content.mod-selection.
- Impact: With DOCS2-004, at least 114 of 184 open reasons, 62%, are false. The 61.4% headline and the priorities appendix cannot be used. This changes DOCS2-004's "backlog cannot be used" from a sample to a majority.
- Remediation: Do the one-pass re-derivation DOCS2-004 asks for. Start from the rows not listed in either finding, because those are the likely real backlog.

### DOCS4-007 — `q3.execution.qvm-roles` says QVMs are not executed, which is the opposite of a headline feature
- **Verification (VERIFY-O): confirmed. Final severity: Low.** completion-status.md:853 is the sole row under "execution — 0 done / 1 total" and is false: runtime.ts:3350 builds Q3QvmServerGame, q3-client.ts:345 builds QvmApplicationScalars. The open UI question resolves: q3-client/qvm.ts:206 `QvmUi.create`, so all three roles are joined and the row can close. Low because one stale ledger row has no runtime effect, and :853 is also counted in DOCS4-006.
- Severity: Medium
- Category: docs
- Location: docs/completion-status.md:853, docs/functional-targets/remaining-source-rows.md (same row); src/app/bootstrap/simulation/runtime.ts:3350, :3074; src/app/bootstrap/q3-client.ts:345
- Confidence: traced (the DOCS3 and GAPQ3 reviews cover the QVM code itself)
- Evidence: Row: "application game/cgame/UI roles execute native TypeScript controllers; loading and running the required bytecode roles is not joined." Code: `const game: Q3QvmServerGame = new Q3QvmServerGame({ artifact: guest.prepared.artifact, state,` (runtime.ts:3350), and `new QvmApplicationScalars(` for the client (q3-client.ts:345). The row is also the only entry in its section and is reported as "0 done / 1 total".
- Impact: A reader of the only ledger sees the project's mod-compatibility core recorded as absent. It is called out separately because it would mislead planning and release statements.
- Remediation: Close the row, or narrow it to the specific UI-QVM role if that remains open. I did not establish full UI-QVM coverage.

### DOCS4-008 — Done row `q2.lmctf.voting` claims referee selection, which has no vote path
- **Verification (VERIFY-O): confirmed. Final severity: Low.** Row :513 is done and titled with referee selection, but its reason never mentions it. lmctf/vote.ts:15-16 offers only skip plus yes/no; lmctf/runtime.ts:159 handles only `skip`; vote.ts has no "referee"; lmctf/admin.ts:13-19 gives password-only referee status. M0717 and M0718 remain open in the menu doc, so the ledgers disagree.
- Severity: Low
- Category: docs
- Location: docs/completion-status.md:513; src/content/q2/multiplayer/lmctf/vote.ts:15-16; runtime.ts:159; docs/menu-source-comparison.md M0718
- Confidence: traced
- Evidence: Title: "Vote on map changes and referee selection" | done. vote.ts's menu offers `Skip to next map` and voting state, and `lmctf-vote` handles only `skip`. `rg 'referee|ref ' lmctf/vote.ts` returns nothing. M0717 (jump to map) and M0718 (referee a player) are correctly open in the menu doc, so the two ledgers disagree. Referee status exists only through the password `referee` command (admin.ts:13-19).
- Impact: This is one of the few overstated done rows found. It is small, but it is the only kind that hides real work.
- Remediation: Mark partial and list the vote kinds that are missing, or record a descope.

### DOCS4-009 — 15 of the 29 dependency entries describe rows whose premise is already gone
- **Verification (VERIFY-O): confirmed-with-changes. Final severity: Info.** 29 dependency entries; all 15 named IDs appear once, and notes at remaining-source-rows.json:3642,3651 read as quoted. Change: q2.config.audio-video-input-menus rests on completion-status.md:709, whose "unqualified" reason is not false (see DOCS4-006), so the count is 14 of 29.
- Severity: Info
- Category: docs
- Location: docs/functional-targets/remaining-source-rows.json:3402-3653
- Confidence: traced via DOCS2-004 and DOCS4-006
- Evidence: Entries for rows with false reasons: q1.ctf.grapple-observer-vote, q1.events.prompts, q2.config.audio-video-input-menus, q2.content.start-map-discovery, q2.media.cin-soundtrack, q2.media.timed-subtitles, q2.network.connectionless-rcon, q3.cameras.spline-runtime, q3.content.pure-policy, q3.presentation.fonts-and-glyphs, q3.progression.catalog, q3.progression.podium-postgame, q3.ui.base-demos-cinematics-configs, q3.ui.base-host-browser-ingame, q3.ui.team-arena-skirmish.

  Two notes also read wrongly now. :3642 "no backend row is duplicated" sits beside separate q3.discovery rows covering the same browser. :3651 "Skirmish launch/next-match flow" describes shipped code.
- Impact: The block adds no separate error, but priority ordering derived from it inherits the stale rows.
- Remediation: Regenerate it with the DOCS2-004 pass.
