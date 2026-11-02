# VERIFY-M — verification of verify-M.txt at HEAD fcdc8af5

Method: opened the cited code at HEAD (src matches clean/ by `diff -rq`) and tried to falsify each claim. Scripts are in <scratchpad>/verifyM/ (cp.ts, modr2.ts, regex.ts, roq.ts, pe.py, t1-t5.py). No server was run or attacked. No window was opened: tests needing real GL were traced, not run. LEFT-003's script was re-run. AUDIT-017's soak and AUDIT-018's archive listing were not, as stated in those blocks.

### TABLES-001
Verdict: confirmed
Corrected severity: Medium
Reason: definitions.ts:20 has v_launch/g_launch. gitem rows in rogue/gamex86.dll (0x20060dcc) and game_x64.dll (0x180196168) read g_plaunch and v_plaunch; rogue/pak0.pak contains both models and no v_launch/g_launch. The only v_plaunch reference in src is the proxskin preload at catalog/weapons.ts:124.

### TABLES-002
Verdict: confirmed
Corrected severity: Medium
Reason: rogue-variants.ts:90-99 spreads boss2Definition with no `moves`. Read the six mmoves at the cited rogue DLL addresses: walk/run 10, pre_mg/mg/post_mg 2, rocket 2 with -5 at index 12. Base DLL and boss2.ts have 8, 1, and 1 with -20.

### TABLES-003
Verdict: confirmed
Corrected severity: Medium
Reason: game_x64.dll rows: ammo_tesla quantity 3, ammo_disruptor 3, item_armor_body misc/ar3_pkup.wav, item_armor_shard i_armor_shard. missionpacks/items.ts:29-30 and foundation/items.ts:78-79 have 5, 15, ar1_pkup, i_jacketarmor. missionpacks/items.ts:113 overrides only ammo_trap for rerelease; no src file names ar3_pkup or i_armor_shard.

### TABLES-004
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: index.ts:40 lists 16 classnames and :54 registers them for all editions. Independent scan confirms gekk_move_death1 [5], carrier_move_spawn [6,7,8,11], carrier_move_death [0], stalker_move_walk [0,4], widow2_move_walk [0,5] against the table. Correction: the gekk_move_swim_start example is wrong; game_x64.dll has an exact match at 0x180146e08 with callbacks at 8, 14, 20, alongside two other [291,322] moves without callbacks. The count of 18 was not re-derived (my scan of 4 table files alone finds 20 moves with no exact match).

### TABLES-005
Verdict: confirmed
Corrected severity: Low
Reason: foundation/items.ts:46 has `rotate: true`, and :528 applies `entity.effects |= item.rotate ? 1 : 0`. world_model_flags for ammo_grenades is 0 in the baseq2, xatrix, rogue and game_x64 rows read by verifyM/t1.py.

### TABLES-006
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Parsed OP_STATE from progs: q1/id1 has knight_atk2..10 = 44..52 and old_thrash13..20 = 59..66; rerelease/id1 and frames.ts:48-56, :1304-1311 have 43..51 and 58..65. Correction: reach is wider than q1-classic-id1. Classic and rerelease hipnotic and rogue progs also have 44..52 and 59..66, and no other knight_atk table exists (monsters.ts:73 falls back to monsterFrames), so those campaigns look affected too (traced, not run).

### TABLES-007
Verdict: confirmed
Corrected severity: Low
Reason: Read monster_flash_offset in three DLLs: xatrix row 57 (-24.8,-9,39), row 98 (41.4,11.52,7.32); base and rogue (24.8,-9,39), (37.8,11.52,12.12), matching muzzle.ts:62, :103. muzzleOffset (muzzle.ts:579) takes only an edition, and chick-heat.ts:21 uses flash 57.

### TABLES-008
Verdict: confirmed
Corrected severity: Info
Reason: All 19 cited lines resolve to move names with zero references outside monsters/tables in src and tests, and no dynamic `_move_${` name construction exists in src/content/q2. Absence from the DLL was spot-checked on tank_move_stop_walk only (no valid mmove at [50,54]); the rest is carried from the original scan.

### TABLES-009
Verdict: refuted
Corrected severity: Info
Reason: prepare.ts:42-44 applies `frame %= count` only to q2-sp2, md5, and q3 entities with bit 512, not q2-md2. For q2-md2, prepare.ts:46-47 sets `frame = 0; previousFrame = 0` when out of range, which is the reset the finding says is missing. misc_actor uses players/male/tris.md2 (actor.ts:26). Only the source-faithful out-of-range table data remains, which is no defect.

### LEFT-001
Verdict: confirmed
Corrected severity: Critical
Reason: verifyM/cp.ts ran the real botCheckConsoleMessages, retail BotChatLibrary and effective pak4 match.c (lines 212-215, `EC"("|EC"["...`): `say_team` and `tell` text `checkpoint a is at 5` or `at 1 2` threw RangeError from game-numeric.ts:30; `1 2 3` and FFA did not. No outer guard: ai-command.ts:503 (no addressed/team check), ai-main.ts:481, director.ts:206 (try/finally), runtime.ts:5253/5301 (catch rethrows at :5581-5583), application.ts:4686 rethrow, :4701 unguarded, main.ts:89 exits.
Reach: plain `say` does not match (prefix), so it needs `say_team` to a same-team bot, or `tell <botslot>` from any connected client on any team (commands.ts:429-437, sayTo team check only for mode team). Needs gametype >= GT_TEAM (:500) and native bots (botAdmissionError admits `q3:` weapons at any gametype; q3:ctf gives 4). spawn.ts:85, :172 share the throw for local maps. QVM qagame's own sscanf does not use this code.

### LEFT-002
Verdict: confirmed-with-changes
Corrected severity: High
Reason: verifyM/modr2.ts: discoverMods true or default throws "Mod directory needs a valid content identity: q1/Arcane Dimensions"; false returns 40 products. index.ts:213 throws where :283 and :316 `continue`; startup-selection.ts:860 awaits with discoverMods true; main.ts:89 handles it. Correction: the listed caller startup-selection.ts:195 has a `.catch` that shows the error as status, so it is not a startup failure path. addons.ts:147-151 also throws on a missing file, not just bad JSON.

### LEFT-003
Verdict: confirmed-with-changes
Corrected severity: High
Reason: Re-ran left/lit.ts on real prepareSceneEntity: RSS 49 to 169 MB over 600 rotating frames, about 140 KB per frame. prepare.ts:230-232 keys on transformKey; no production context sets lightVertex; renderer.ts:320 sets key "q3". Corrections: this is a bounded cache with near-zero hit rate, not unbounded growth (cap 512 per pose and surface, :279). The comment at :98-100 describes the pose and world layers; the lit layer's own comment at :92-94 says retained "while all match", so the misleading-comment claim is wrong.

### LEFT-004
Verdict: confirmed
Corrected severity: Medium
Reason: browser-view.ts:170, :182 throw when resolveQ3 returns null, and server-browser.ts:127, :129 return null on resolve failure or non-IPv4. client-browser-syscalls.ts:80, :84 return the promise with no catch, and q3-client/qvm.ts has no catch around post-init syscalls. slotAt throws at :56 via getPing :209. Team Arena ui.qvm contains createFavorite; no retail baseq3 ui.qvm does. Not run end to end.

### LEFT-005
Verdict: confirmed
Corrected severity: Low
Reason: legacy-client-abi.ts:7-9: 20-23 remap first, so 12-19 and 24-26 throw, and a non-numeric or absent index throws at :7. Called from getServerCommand at q3-client/qvm.ts:176 for any profile other than q3-modern, with no catch in that file. Modern profile returns at :5.

### LEFT-006
Verdict: refuted
Corrected severity: Info
Reason: The leak does not occur. A closed playback's decoder checkpoint carries closed=true, and construction restores it: roq-stream.ts:82 `if (closed) this.close()` via roq-playback.ts:111, :121, and cin.ts:128, :173 via cin-playback.ts:60, :71. verifyM/roq.ts: after restore, opens 2, closes 2, so the reopened RoQ input is closed during construction. OGV closes in `finally` (playback.ts:93) and images hold no handle. CIN was traced (my harness did not run it).

### LEFT-007
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: verifyM/regex.ts: parseAddonCatalog accepts `-game ..` and `-game .` with unavailable null; addon-library.ts:168 join gives the parent `.addons`, then :171 writes into it and :174 renames it. Bad row and bad URL both throw. Correction: "blanks the browser" holds only with no cache. addon-library.ts:72-75 falls back to the cached catalog (the new text is not cached because parse throws first), and shows a status message otherwise.

### LEFT-008
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: toQ3Snapshot and toQ3EntityState have no callers (adapters.ts:27, :181), so trajectoryKind's throw (:18, via :23, :51) is unreachable. Corrections: formats/q3-model/animation.ts:34 has no src importer but tests/formats/q3-model/retail.test.ts:7, :41 imports it through the barrel. QuakeWorldPredictionHistory as a whole (not only `bundle`) appears only in prediction.ts:24, so the dead code is wider than stated.

### AUDIT-015
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Viewed title.png: Quake Q logo with a small registered-style mark, QUAKE ANTHOLOGY, Q3-style emblem on a banner, Shambler-like creature, marine. Bundled by splash.ts:1, with no origin record; README has no trademark or non-affiliation text. Corrections: docs/ui-art-review.md:48-68 records prompts for the menu background, panel and focus frame, so only title.png lacks a record. README:176-179 scopes GPL to "Engine code", not project-wide. Legal significance not assessed.

### AUDIT-016
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Reproduced under dummy drivers: window-runner.test.ts:44 output holds only totals; display-preferences.test.ts:45 fullscreen false; monster-roster fails at :108 loadApplicationContent with QTS_TEST_CORPUS set (no --content-root at :97). Traced: prepared-startup.ts:81, :118 registers connect, disconnect, quit first, so startup.ts:621-627 prints "already defined" (commands/index.ts:451-452) and the prepared forwarder wins. Corrections: window-runner's dummy subtest has no gate and no bunfig exclusion, so it is not display-only or invisible in `bun test`. video-settings and q3-selected-clock were not run (need real GL).

### AUDIT-017
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: <scratchpad>/soak-q1-gl.log matches: heap 233.8 to 425.2 MB, 24 MB per map, RSS 1388 to 1891, about 25 ms per step, about 2.2 s per travel. soak-q1-client.log CPU figures: 84-96 ms per step and 4.3-5.0 s per travel, in line with the finding. Correction: the cited `evidence/soak-q1-gl.log` is absent from docs/reviews/2026-11-01-full-audit/evidence/, so it should be published. The soak was not re-run, and the log itself does not show the renderer used.

### AUDIT-018
Verdict: confirmed
Corrected severity: Medium
Reason: Not independently re-listed: <scratchpad>/tar is empty, no copy exists on disk, and the network is off limits, so the one-entry listing and digest are carried from the original. Could not disprove: tools/ has no packaging step that adds LICENSE or notices (no tar use), and docs/releases/1.2.1.md describes extracting and running `./quake-typescript`. Legal significance not assessed.
