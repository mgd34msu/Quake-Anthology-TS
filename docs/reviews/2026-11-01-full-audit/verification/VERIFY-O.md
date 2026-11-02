# VERIFY-O — verification of DOCS4 at HEAD fcdc8af5

### DOCS4-001
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: All 17 table groups and the count of 57 hold at their cited lines (bindings.ts:97-106, gameplay.ts:13,17,24,29-31, input-devices.ts:106,110, startup.ts:909,951,973, team-arena-results.ts:23-24, match.ts vote/bot rows, lmctf/presentation.ts:25,27, ctf/match.ts:116 with ctf/index.ts:268 handling "close"). Change: M0838, M0900 and M1106 are already Open-partial, so only their wording is wrong, and M0838 (createserver) maps to the Custom flow, which really has four skills (startup-selection.ts:713); its reason holds for its own menu.
M0445 keeps a true "no prelaunch" clause; only "no same-named binding" is false (q2.ts:20). Low to match DOCS3-009, which this table itemizes.

### DOCS4-002
Verdict: confirmed
Corrected severity: Low
Reason: Script lists 24 rows on the "Shared Quit/Resume" route: the 12 false, the 11 accidental, and M0962 (real quit). Vote choices are exactly map_restart, nextmap, map, kick (src/ui/library/match.ts vote row); no teamtask, vsay_team, teamvote, voteGame or voteLeader in src/ui or ui.ts; the only hit is the userinfo cvar (q3-client/userinfo.ts:27). The match menu is q3-dialect only (ui.ts:173). 12 of 1123 doc rows with no runtime effect is Low.

### DOCS4-003
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: All 21 rows have settings (q2.ts:24-43, rotation.ts:8) and M0428 shows the Open-partial wording. Changes: consumption is not all in bindQ2PlayerCvars; several cvars are registered at q2-owner.ts:99 and read at runtime.ts:3700,4744-4745 or q2SourceDeathmatchFlags (q2-owner.ts:36). Line fixes: g_no_* consumed at q2-owner.ts:29-31, not :31-33; maxspectators is :50, not :52.
M0468, M0469, M0553, M0554 should drop from the "at least 21": no matchlock or matchtime cvar exists, ctf/types.ts:72 is the runtime clock, and the rule fields are types.ts:29 and match.ts:125, so "no same-named" is literally true. The extra list is at least 17.

### DOCS4-004
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: 68 rows, the listed 30 contradicted, 9 partial, 11 and 12 Team Arena rows all match action-catalog.ts:17-26,32-38 and ui.ts:184. The undetermined pair resolves as contradicted: Q3 `+use` sets the same use-holdable input as `+button2` (input/seat.ts:22, input/user-command.ts:130, app/bootstrap/input.ts:828), so M0392 is contradicted and M0809 joins the Team Arena set (12).
M0334 and M0352 (Q1 `impulse 10`) are functionally the offered "Next weapon" `weapnext` (application.ts:4266, network/remote-q1.ts:342), not a clean hold. Corrected: 33 contradicted, 9 partial, 26 hold.

### DOCS4-005
Verdict: confirmed
Corrected severity: Low
Reason: Reproduced by script: 83 "located at" rows, 40 miss, with the quoted targets (q2-console.ts:57, triangle-kernel.ts:500, remote-application.ts:143, q3/catalog.ts:216). In-scope link counts are exact: 333, 98, 175, 175, 155, 25; each target line is as quoted. `rg -i` finds no r_dynamiclight, r_fastsky or r_finish in src. Master entry at startup-menu.ts:369 falsifies the M1037-M1043 "master absent" text.

### DOCS4-006
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: 77 lines counted and 68 are false as stated (e.g. video-restart.ts:55, seat-hud-state.ts:135-153, rerelease-presentation.ts:77, effects.ts:408, game-prompt.ts:48, network/q2.ts:206,211, network/q3.ts:48, remote-application.ts:1371,1685,1829, simulation/save.ts:156; timers now traced to source at powerup-timers.ts:11-14). Not false: :240, :709 say "unqualified" (acceptance status), which code presence cannot falsify. Partial, 7 rows: :230, :231, :544 because classic data still throws at bots.ts:221,621-624 and only rerelease assets bypass it (bot-rerelease.ts:246); :163 keeps that bot clause.
:309 level-start is false, but sv_autosave_interval has no reader in src (only application.ts:1351, startup-source.ts:45), and the row is about timed autosave. :560 "always instant" is false only on the service path (q2-service-presentation.ts:122); no producer sets durationSeconds and local emitters fall to `?? true` (ui.ts:290). :812 rcon is false, but g_log is only registered (q3/base/settings.ts:29).
Corrected total: 105 of 184 outright (57%), 112 with partials, 2 not false. The majority conclusion holds; "114" and "62%" do not.

### DOCS4-007
Verdict: confirmed
Corrected severity: Low
Reason: completion-status.md:853 is the sole row under "execution — 0 done / 1 total" and is false: runtime.ts:3350 builds Q3QvmServerGame, q3-client.ts:345 builds QvmApplicationScalars. The open UI question resolves: q3-client/qvm.ts:206 `QvmUi.create`, so all three roles are joined and the row can close. Low because one stale ledger row has no runtime effect, and :853 is also counted in DOCS4-006.

### DOCS4-008
Verdict: confirmed
Corrected severity: Low
Reason: Row :513 is done and titled with referee selection, but its reason never mentions it. lmctf/vote.ts:15-16 offers only skip plus yes/no; lmctf/runtime.ts:159 handles only `skip`; vote.ts has no "referee"; lmctf/admin.ts:13-19 gives password-only referee status. M0717 and M0718 remain open in the menu doc, so the ledgers disagree.

### DOCS4-009
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: 29 dependency entries; all 15 named IDs appear once, and notes at remaining-source-rows.json:3642,3651 read as quoted. Change: q2.config.audio-video-input-menus rests on completion-status.md:709, whose "unqualified" reason is not false (see DOCS4-006), so the count is 14 of 29.
